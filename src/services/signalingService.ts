/**
 * Tiered WebRTC signaling.
 *
 * WebRTC needs *some* channel to exchange SDP offers/answers and ICE candidates
 * before a direct DataChannel exists. This service abstracts that channel so the
 * mesh can bootstrap even when the usual relays are down. Tiers, in order of
 * preference:
 *
 *   1. WSS relay  — fast, real-time. Routes by ephemeral `peerId`.
 *                   (Wire-compatible with the legacy `rtc-offer/answer/ice` format.)
 *   2. Gun inbox  — used when WSS is down but a Gun relay is reachable. Signed
 *                   envelopes are written to `server-config/rtc-signal/<recipientPubkey>`
 *                   and tombstoned once consumed. Routes by stable signing pubkey.
 *   3. Manual     — total blackout. The caller drives `createManualOffer()` /
 *                   `acceptManualOffer()` / `acceptManualAnswer()` and ships the
 *                   resulting bundle out-of-band (copy/paste, QR). Implemented in
 *                   WebRTCService; this service only exposes the tier state.
 *
 * WebRTCService stays transport-agnostic: it deals in opaque `remoteId`s and a
 * `reply` descriptor handed back with every inbound signal.
 */

import { CryptoService } from '@/services/cryptoService';
import { GunService } from '@/services/gunService';
import { KeyService } from '@/services/keyService';

/** How a peer can be reached on a signaling channel. */
export interface SignalTarget {
  /** Ephemeral relay peer id (WSS tier). */
  peerId?: string;
  /** Stable signing pubkey (Gun tier). */
  pubkey?: string;
}

export type SignalKind = 'offer' | 'answer' | 'ice';

/** Normalized inbound signal delivered to WebRTCService. */
export interface InboundSignal {
  kind: SignalKind;
  /** Connection key for this peer (peerId on WSS, pubkey on Gun). */
  remoteId: string;
  /** Address to send our reply back to. */
  reply: SignalTarget;
  remotePubkey?: string;
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
}

export type SignalTier = 'wss' | 'gun' | 'none';

const GUN_SIGNAL_ROOT = 'server-config';
const GUN_SIGNAL_PATH = 'rtc-signal';
const SIGNAL_TTL_MS = 60_000;
const SEEN_MAX = 500;

export class SignalingService {
  private static initialized = false;
  private static myPubkey = '';
  private static myPrivkey = '';
  private static listeners = new Set<(sig: InboundSignal) => void>();
  private static seen = new Set<string>();
  private static gunSubscribed = false;

  static async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    const keyPair = await KeyService.getKeyPair();
    this.myPubkey = keyPair.publicKey;
    this.myPrivkey = keyPair.privateKey;

    // Tier 1: WSS relay signaling (legacy wire format, routed by peerId).
    const { WebSocketService } = await import('@/services/websocketService');
    const myPeerId = () => WebSocketService.getPeerId();

    WebSocketService.subscribe('rtc-offer', (d: any) => this.onWssSignal('offer', d, myPeerId()));
    WebSocketService.subscribe('rtc-answer', (d: any) => this.onWssSignal('answer', d, myPeerId()));
    WebSocketService.subscribe('rtc-ice', (d: any) => this.onWssSignal('ice', d, myPeerId()));

    // Tier 2: Gun inbox addressed to our pubkey.
    this.subscribeGunInbox();
  }

  static getMyPubkey(): string {
    return this.myPubkey;
  }

  /** Register a handler for inbound signals addressed to us. Returns an unsubscribe fn. */
  static onSignal(cb: (sig: InboundSignal) => void): () => void {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  }

  /** Best signaling tier currently available for automatic connection setup. */
  static async currentTier(): Promise<SignalTier> {
    try {
      const { WebSocketService } = await import('@/services/websocketService');
      if (WebSocketService.getConnectionStatus()) return 'wss';
    } catch { /* fall through */ }
    if (GunService.getPeerStats().isConnected) return 'gun';
    return 'none';
  }

  /**
   * Send a signal to a peer over the best available tier.
   * Returns false when no automatic channel is available (caller must fall back
   * to manual signaling).
   */
  static async sendSignal(target: SignalTarget, kind: SignalKind, payload: {
    sdp?: RTCSessionDescriptionInit;
    candidate?: RTCIceCandidateInit;
  }): Promise<boolean> {
    const { WebSocketService } = await import('@/services/websocketService');

    // Tier 1: WSS — only usable when we can address the peer by its relay peerId.
    if (WebSocketService.getConnectionStatus() && target.peerId) {
      WebSocketService.broadcast(`rtc-${kind}`, {
        peerId: WebSocketService.getPeerId(),
        targetPeerId: target.peerId,
        ...(payload.sdp ? { sdp: payload.sdp } : {}),
        ...(payload.candidate ? { candidate: payload.candidate } : {}),
      });
      return true;
    }

    // Tier 2: Gun inbox — addressed by stable pubkey.
    if (target.pubkey && GunService.getPeerStats().isConnected) {
      await this.sendGunSignal(target.pubkey, kind, payload);
      return true;
    }

    return false;
  }

  // ── WSS tier (private) ─────────────────────────────────────

  private static onWssSignal(kind: SignalKind, d: any, myPeerId: string): void {
    if (!d || d.targetPeerId !== myPeerId || !d.peerId) return;
    this.emit({
      kind,
      remoteId: d.peerId,
      reply: { peerId: d.peerId },
      sdp: d.sdp,
      candidate: d.candidate,
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
        const env = raw as Record<string, unknown>;
        const parsed = this.verifyGunEnvelope(env, msgId);
        if (!parsed) return;

        if (this.seen.has(msgId)) return;
        this.markSeen(msgId);

        // Consume: tombstone so we (and other tabs) don't reprocess it.
        try { inbox.get(msgId).put(null); } catch { /* best-effort */ }

        this.emit({
          kind: parsed.kind,
          remoteId: parsed.fromPubkey,
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

  private static async sendGunSignal(targetPubkey: string, kind: SignalKind, payload: {
    sdp?: RTCSessionDescriptionInit;
    candidate?: RTCIceCandidateInit;
  }): Promise<void> {
    const { WebSocketService } = await import('@/services/websocketService');
    const ts = Date.now();
    const msgId = `${this.myPubkey.slice(0, 8)}-${ts}-${Math.random().toString(36).slice(2, 8)}`;
    const body = {
      kind,
      fromPubkey: this.myPubkey,
      fromPeerId: WebSocketService.getPeerId(),
      targetPubkey,
      ts,
      msgId,
      sdp: payload.sdp ? JSON.stringify(payload.sdp) : '',
      candidate: payload.candidate ? JSON.stringify(payload.candidate) : '',
    };
    const signature = CryptoService.sign(this.signingMessage(body), this.myPrivkey);

    return new Promise<void>((resolve) => {
      try {
        GunService.getGun()
          .get(GUN_SIGNAL_ROOT)
          .get(GUN_SIGNAL_PATH)
          .get(targetPubkey)
          .get(msgId)
          .put({ ...body, signature }, () => resolve());
      } catch {
        resolve();
      }
    });
  }

  private static verifyGunEnvelope(env: Record<string, unknown>, msgId: string): {
    kind: SignalKind;
    fromPubkey: string;
    fromPeerId: string;
    sdp?: RTCSessionDescriptionInit;
    candidate?: RTCIceCandidateInit;
  } | null {
    const kind = String(env.kind || '');
    if (kind !== 'offer' && kind !== 'answer' && kind !== 'ice') return null;

    const fromPubkey = String(env.fromPubkey || '');
    const signature = String(env.signature || '');
    const ts = Number(env.ts || 0);
    if (!/^[0-9a-f]{64}$/i.test(fromPubkey) || !/^[0-9a-f]{128}$/i.test(signature)) return null;
    if (!Number.isFinite(ts) || Date.now() - ts > SIGNAL_TTL_MS) return null;
    if (env.msgId && env.msgId !== msgId) return null;

    const body = {
      kind,
      fromPubkey,
      fromPeerId: String(env.fromPeerId || ''),
      targetPubkey: String(env.targetPubkey || ''),
      ts,
      msgId: String(env.msgId || msgId),
      sdp: String(env.sdp || ''),
      candidate: String(env.candidate || ''),
    };
    if (body.targetPubkey !== this.myPubkey) return null;
    if (!CryptoService.verify(this.signingMessage(body), signature, fromPubkey)) return null;

    let sdp: RTCSessionDescriptionInit | undefined;
    let candidate: RTCIceCandidateInit | undefined;
    try { if (body.sdp) sdp = JSON.parse(body.sdp); } catch { return null; }
    try { if (body.candidate) candidate = JSON.parse(body.candidate); } catch { return null; }

    return { kind, fromPubkey, fromPeerId: body.fromPeerId, sdp, candidate };
  }

  private static signingMessage(body: {
    kind: string; fromPubkey: string; fromPeerId: string; targetPubkey: string;
    ts: number; msgId: string; sdp: string; candidate: string;
  }): string {
    return JSON.stringify([
      body.kind, body.fromPubkey, body.fromPeerId, body.targetPubkey,
      body.ts, body.msgId, body.sdp, body.candidate,
    ]);
  }

  private static markSeen(id: string): void {
    this.seen.add(id);
    if (this.seen.size > SEEN_MAX) {
      const first = this.seen.values().next().value;
      if (first) this.seen.delete(first);
    }
  }

  private static emit(sig: InboundSignal): void {
    for (const cb of this.listeners) {
      try { cb(sig); } catch { /* ignore listener errors */ }
    }
  }
}

export default SignalingService;
