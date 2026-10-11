/**
 * Tiered WebRTC signaling.
 *
 * WebRTC needs *some* channel to exchange SDP offers/answers and ICE candidates
 * before a direct DataChannel exists. This service abstracts that channel so the
 * mesh can bootstrap even when the usual relays are down. Tiers, in order of
 * preference:
 *
 *   1. WSS relay  — fast, real-time. Routes by ephemeral `peerId`. Signed.
 *   2. Gun inbox  — used when WSS is down but a Gun relay is reachable. Signed
 *                   envelopes written to `server-config/rtc-signal/<recipientPubkey>`,
 *                   tombstoned once consumed. Routes by stable signing pubkey.
 *   3. Mesh relay — used when neither relay is reachable but we already hold at
 *                   least one WebRTC datachannel. The signed envelope is flooded
 *                   over existing datachannels (hop-limited, deduped) so peers
 *                   already in the mesh introduce new peers to each other with
 *                   zero servers. Routes by stable signing pubkey.
 *   4. Manual     — total blackout. The caller drives the QR/paste bundle flow in
 *                   WebRTCService; this service only reports the tier state.
 *
 * Every automatic tier carries the SAME Schnorr-signed envelope, so a hostile
 * relay/peer can delay or drop signals but cannot forge or tamper with them.
 *
 * WebRTCService stays transport-agnostic: it deals in opaque `remoteId`s and a
 * `reply` descriptor handed back with every inbound signal.
 */

import { CryptoService } from '@/services/cryptoService';
import { GunService } from '@/services/gunService';
import { KeyService } from '@/services/keyService';
import { BoundedMap, BoundedSet } from '../utils/boundedMap';

/** How a peer can be reached on a signaling channel. */
export interface SignalTarget {
  /** Ephemeral relay peer id (WSS tier). */
  peerId?: string;
  /** Stable signing pubkey (Gun / mesh tiers). */
  pubkey?: string;
}

export type CallSignalKind =
  | 'call-invite' | 'call-accept' | 'call-decline' | 'call-end'
  | 'call-offer' | 'call-answer' | 'call-ice';
export type SignalKind = 'offer' | 'answer' | 'ice' | CallSignalKind;

const CALL_KINDS: readonly CallSignalKind[] = [
  'call-invite', 'call-accept', 'call-decline', 'call-end', 'call-offer', 'call-answer', 'call-ice',
];
export const isCallKind = (k: string): k is CallSignalKind =>
  (CALL_KINDS as readonly string[]).includes(k);

/** Extra payload carried by call kinds (signed). */
export interface SignalPayload {
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
  callId?: string;
  meta?: Record<string, unknown>;
}
const CALL_META_MAX = 512;

/** Normalized inbound signal delivered to WebRTCService. */
export interface InboundSignal {
  kind: SignalKind;
  /** Connection key for this peer (peerId on WSS, pubkey on Gun/mesh). */
  remoteId: string;
  /** Address to send our reply back to. */
  reply: SignalTarget;
  remotePubkey?: string;
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
  /** Call kinds only: id binding the signal to one call. */
  callId?: string;
  meta?: Record<string, unknown>;
}

export type SignalTier = 'wss' | 'gun' | 'mesh' | 'none';

/** The signed wire object shared by every automatic tier. */
interface SignedSignal {
  kind: SignalKind;
  fromPubkey: string;
  fromPeerId: string;
  targetPubkey: string;
  targetPeerId: string;
  ts: number;
  msgId: string;
  sdp: string;       // JSON-encoded RTCSessionDescriptionInit, or ''
  candidate: string; // JSON-encoded RTCIceCandidateInit, or ''
  callId?: string;   // call kinds only
  meta?: string;     // call kinds only, JSON
  signature: string;
}

/** Parsed + verified envelope (payload decoded). */
interface ParsedSignal {
  kind: SignalKind;
  fromPubkey: string;
  fromPeerId: string;
  targetPubkey: string;
  targetPeerId: string;
  msgId: string;
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
  callId?: string;
  meta?: Record<string, unknown>;
}

const GUN_SIGNAL_ROOT = 'server-config';
const GUN_SIGNAL_PATH = 'rtc-signal';
const SIGNAL_TTL_MS = 60_000;
const SEEN_MAX = 500;
/** Mesh-relay flood hop limit — bounds how far a signal travels through the mesh. */
const SIGNAL_HOP_MAX = 4;
/** Datachannel message type used for mesh-relayed signaling. */
export const MESH_SIGNAL_TYPE = 'signal-relay';

export class SignalingService {
  private static initialized = false;
  private static myPubkey = '';
  private static myPrivkey = '';
  private static listeners = new Set<(sig: InboundSignal) => void>();
  private static callListeners = new Set<(sig: InboundSignal) => void>();
  // Replay guard. Bounded with a TTL comfortably longer than any signal's useful
  // life; unbounded before, growing one entry per signal received forever.
  private static seen = new BoundedSet<string>({ maxSize: 5000, ttlMs: 10 * 60_000 });
  private static gunSubscribed = false;

  static async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    const keyPair = await KeyService.getKeyPair();
    this.myPubkey = keyPair.publicKey;
    this.myPrivkey = keyPair.privateKey;

    // Tier 1: WSS relay signaling, routed by peerId (now signature-verified).
    const { WebSocketService } = await import('@/services/websocketService');
    const myPeerId = () => WebSocketService.getPeerId();

    WebSocketService.subscribe('rtc-offer', (d: any) => this.onWssSignal(d, myPeerId()));
    WebSocketService.subscribe('rtc-answer', (d: any) => this.onWssSignal(d, myPeerId()));
    WebSocketService.subscribe('rtc-ice', (d: any) => this.onWssSignal(d, myPeerId()));
    for (const k of CALL_KINDS) {
      WebSocketService.subscribe(`rtc-${k}`, (d: any) => this.onWssSignal(d, myPeerId()));
    }

    // Tier 2: Gun inbox addressed to our pubkey.
    this.subscribeGunInbox();

    // A relay switch rebuilds the Gun instance, orphaning the inbox subscription
    // above. Re-attach it to the new instance so automatic (non-manual) WebRTC
    // signaling keeps working across relay changes.
    GunService.onReconnect(() => {
      this.gunSubscribed = false;
      this.subscribeGunInbox();
    });
  }

  static getMyPubkey(): string {
    return this.myPubkey;
  }

  /** Register a handler for inbound signals addressed to us. Returns an unsubscribe fn. */
  static onSignal(cb: (sig: InboundSignal) => void): () => void {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  }

  /** Register a handler for inbound call-* signals. Returns an unsubscribe fn. */
  static onCallSignal(cb: (sig: InboundSignal) => void): () => void {
    this.callListeners.add(cb);
    return () => { this.callListeners.delete(cb); };
  }

  /** Best signaling tier currently available for automatic connection setup. */
  static async currentTier(): Promise<SignalTier> {
    try {
      const { WebSocketService } = await import('@/services/websocketService');
      if (WebSocketService.getConnectionStatus()) return 'wss';
    } catch { /* fall through */ }
    if (GunService.getPeerStats().isConnected) return 'gun';
    try {
      const { WebRTCService } = await import('@/services/webrtcService');
      if (WebRTCService.getConnectedPeers().length > 0) return 'mesh';
    } catch { /* fall through */ }
    return 'none';
  }

  /**
   * Send a signal to a peer over the best available tier.
   * Returns false when no automatic channel is available (caller must fall back
   * to manual signaling).
   */
  static async sendSignal(target: SignalTarget, kind: SignalKind, payload: SignalPayload): Promise<boolean> {
    const { WebSocketService } = await import('@/services/websocketService');

    // Tier 1: WSS — addressable by relay peerId. Now sends a signed envelope.
    if (WebSocketService.getConnectionStatus() && target.peerId) {
      const env = this.buildEnvelope(target, kind, payload, WebSocketService.getPeerId());
      WebSocketService.broadcast(`rtc-${kind}`, env);
      return true;
    }

    // Tier 2: Gun inbox — addressed by stable pubkey.
    if (target.pubkey && GunService.getPeerStats().isConnected) {
      await this.sendGunSignal(target.pubkey, kind, payload);
      return true;
    }

    // Calls never use the mesh flood (latency + exposes call metadata to unrelated peers).
    if (isCallKind(kind)) return false;

    // Tier 3: Mesh relay — flood a signed envelope over existing datachannels so
    // peers we're already connected to introduce us to the target. Zero servers.
    if (target.pubkey) {
      try {
        const { WebRTCService } = await import('@/services/webrtcService');
        if (WebRTCService.getConnectedPeers().length > 0) {
          const env = this.buildEnvelope(target, kind, payload, WebSocketService.getPeerId());
          this.markSeen(env.msgId); // don't act on our own relayed message
          WebRTCService.broadcastToAll(MESH_SIGNAL_TYPE, { ...env, hop: SIGNAL_HOP_MAX });
          return true;
        }
      } catch { /* mesh unavailable */ }
    }

    return false;
  }

  // ── Signed envelope (shared by all automatic tiers) ────────

  private static buildEnvelope(
    target: SignalTarget,
    kind: SignalKind,
    payload: SignalPayload,
    fromPeerId: string,
  ): SignedSignal {
    const ts = Date.now();
    const msgId = `${this.myPubkey.slice(0, 8)}-${ts}-${Math.random().toString(36).slice(2, 8)}`;
    const body: Omit<SignedSignal, 'signature'> = {
      kind,
      fromPubkey: this.myPubkey,
      fromPeerId,
      targetPubkey: target.pubkey || '',
      targetPeerId: target.peerId || '',
      ts,
      msgId,
      sdp: payload.sdp ? JSON.stringify(payload.sdp) : '',
      candidate: payload.candidate ? JSON.stringify(payload.candidate) : '',
    };
    if (isCallKind(kind)) {
      body.callId = payload.callId ?? '';
      body.meta = JSON.stringify(payload.meta ?? {});
    }
    const signature = CryptoService.sign(this.signingMessage(body), this.myPrivkey);
    return { ...body, signature };
  }

  /**
   * Verify a signed envelope from any tier. Checks field formats, freshness, and
   * the Schnorr signature — but NOT the target, so relayers can inspect whether a
   * message is for them or should be forwarded. Returns the decoded payload.
   */
  private static verifyEnvelope(env: Record<string, unknown>): ParsedSignal | null {
    if (!env || typeof env !== 'object') return null;

    const kind = String(env.kind || '');
    const isCall = isCallKind(kind);
    if (kind !== 'offer' && kind !== 'answer' && kind !== 'ice' && !isCall) return null;

    const fromPubkey = String(env.fromPubkey || '');
    const signature = String(env.signature || '');
    const ts = Number(env.ts || 0);
    if (!/^[0-9a-f]{64}$/i.test(fromPubkey) || !/^[0-9a-f]{128}$/i.test(signature)) return null;
    if (!Number.isFinite(ts) || Date.now() - ts > SIGNAL_TTL_MS) return null;

    const body = {
      kind: kind as SignalKind,
      fromPubkey,
      fromPeerId: String(env.fromPeerId || ''),
      targetPubkey: String(env.targetPubkey || ''),
      targetPeerId: String(env.targetPeerId || ''),
      ts,
      msgId: String(env.msgId || ''),
      sdp: String(env.sdp || ''),
      candidate: String(env.candidate || ''),
    } as Omit<SignedSignal, 'signature'>;
    let meta: Record<string, unknown> | undefined;
    if (isCall) {
      body.callId = String(env.callId || '');
      body.meta = String(env.meta || '');
      if (!/^[0-9a-f]{32}$/.test(body.callId)) return null;
      if (body.meta.length > CALL_META_MAX) return null;
      try {
        const m = JSON.parse(body.meta);
        if (!m || typeof m !== 'object' || Array.isArray(m)) return null;
        meta = m;
      } catch { return null; }
    }
    if (!body.msgId) return null;
    if (!CryptoService.verify(this.signingMessage(body), signature, fromPubkey)) return null;

    let sdp: RTCSessionDescriptionInit | undefined;
    let candidate: RTCIceCandidateInit | undefined;
    try { if (body.sdp) sdp = JSON.parse(body.sdp); } catch { return null; }
    try { if (body.candidate) candidate = JSON.parse(body.candidate); } catch { return null; }

    return {
      kind: body.kind,
      fromPubkey,
      fromPeerId: body.fromPeerId,
      targetPubkey: body.targetPubkey,
      targetPeerId: body.targetPeerId,
      msgId: body.msgId,
      sdp,
      candidate,
      ...(isCall ? { callId: body.callId, meta } : {}),
    };
  }

  private static signingMessage(body: {
    kind: string; fromPubkey: string; fromPeerId: string; targetPubkey: string;
    targetPeerId: string; ts: number; msgId: string; sdp: string; candidate: string;
    callId?: string; meta?: string;
  }): string {
    const parts: unknown[] = [
      body.kind, body.fromPubkey, body.fromPeerId, body.targetPubkey, body.targetPeerId,
      body.ts, body.msgId, body.sdp, body.candidate,
    ];
    // Legacy kinds keep the exact legacy byte format; call kinds also bind callId + meta.
    if (isCallKind(body.kind)) parts.push(body.callId ?? '', body.meta ?? '');
    return JSON.stringify(parts);
  }

  // ── WSS tier (private) ─────────────────────────────────────

  private static onWssSignal(d: any, myPeerId: string): void {
    const parsed = this.verifyEnvelope(d);
    if (!parsed) return;
    if (parsed.targetPeerId !== myPeerId) return;   // addressed to us?
    if (this.seen.has(parsed.msgId)) return;
    this.markSeen(parsed.msgId);
    this.emit({
      kind: parsed.kind,
      remoteId: parsed.fromPeerId,          // WSS namespace = peerId
      reply: { peerId: parsed.fromPeerId },
      remotePubkey: parsed.fromPubkey,
      sdp: parsed.sdp,
      candidate: parsed.candidate,
      callId: parsed.callId,
      meta: parsed.meta,
    });
  }

  // ── Gun tier (private) ─────────────────────────────────────

  private static subscribeGunInbox(): void {
    if (this.gunSubscribed || !this.myPubkey) return;
    this.gunSubscribed = true;
    try {
      const inbox = GunService.getGun()
        .get(GUN_SIGNAL_ROOT)
        .get(GUN_SIGNAL_PATH)
        .get(this.myPubkey);

      inbox.map().on((raw: unknown, msgId: string) => {
        if (!raw || typeof raw !== 'object' || !msgId) return;
        const parsed = this.verifyEnvelope(raw as Record<string, unknown>);
        if (!parsed || parsed.targetPubkey !== this.myPubkey) return;

        if (this.seen.has(parsed.msgId)) return;
        this.markSeen(parsed.msgId);

        // Consume: tombstone so we (and other tabs) don't reprocess it.
        try { inbox.get(msgId).put(null); } catch { /* best-effort */ }

        this.emit({
          kind: parsed.kind,
          remoteId: parsed.fromPubkey,        // Gun namespace = pubkey
          reply: { pubkey: parsed.fromPubkey, peerId: parsed.fromPeerId || undefined },
          remotePubkey: parsed.fromPubkey,
          sdp: parsed.sdp,
          candidate: parsed.candidate,
        });
      });
    } catch {
      this.gunSubscribed = false;
    }
  }

  private static async sendGunSignal(targetPubkey: string, kind: SignalKind, payload: SignalPayload): Promise<void> {
    const { WebSocketService } = await import('@/services/websocketService');
    const env = this.buildEnvelope({ pubkey: targetPubkey }, kind, payload, WebSocketService.getPeerId());

    return new Promise<void>((resolve) => {
      try {
        GunService.getGun()
          .get(GUN_SIGNAL_ROOT)
          .get(GUN_SIGNAL_PATH)
          .get(targetPubkey)
          .get(env.msgId)
          .put(env, () => resolve());
      } catch {
        resolve();
      }
    });
  }

  // ── Mesh-relay tier ────────────────────────────────────────

  /**
   * Handle a signed envelope flooded over the WebRTC mesh. Delivers it if it is
   * for us, otherwise re-floods it toward the target with a decremented hop
   * count. The `seen` set + hop limit + signature gate bound the flood.
   */
  static handleRelayEnvelope(env: Record<string, unknown>): void {
    const parsed = this.verifyEnvelope(env);
    if (!parsed || isCallKind(parsed.kind)) return; // calls never travel the mesh flood
    if (this.seen.has(parsed.msgId)) return;    // already delivered/relayed → drop (loop guard)
    this.markSeen(parsed.msgId);

    if (parsed.targetPubkey === this.myPubkey) {
      this.emit({
        kind: parsed.kind,
        remoteId: parsed.fromPubkey,        // mesh namespace = pubkey
        reply: { pubkey: parsed.fromPubkey },
        remotePubkey: parsed.fromPubkey,
        sdp: parsed.sdp,
        candidate: parsed.candidate,
        callId: parsed.callId,
        meta: parsed.meta,
      });
      return;
    }

    const hop = Number((env as { hop?: unknown }).hop) || 0;
    if (hop <= 0) return;
    void import('@/services/webrtcService').then(({ WebRTCService }) => {
      WebRTCService.broadcastToAll(MESH_SIGNAL_TYPE, { ...env, hop: hop - 1 });
    }).catch(() => { /* mesh unavailable */ });
  }

  private static markSeen(id: string): void {
    this.seen.add(id);
    if (this.seen.size > SEEN_MAX) {
      const first = this.seen.values().next().value;
      if (first) this.seen.delete(first);
    }
  }

  private static emit(sig: InboundSignal): void {
    const targets = isCallKind(sig.kind) ? this.callListeners : this.listeners;
    for (const cb of targets) {
      try { cb(sig); } catch { /* ignore listener errors */ }
    }
  }
}

export default SignalingService;
