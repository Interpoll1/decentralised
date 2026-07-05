/**
 * WebRTC P2P sync service.
 *
 * Signaling (offer/answer/ICE) is delegated to SignalingService, which picks the
 * best available channel (WSS relay → Gun inbox → manual). Once a DataChannel is
 * established, peers exchange blockchain blocks, events and Gun graph deltas
 * directly, so sync survives even when every relay is down.
 *
 * Connections are keyed by an opaque `remoteId` (the relay peerId on the WSS
 * tier, the signing pubkey on the Gun tier). Each connection remembers a `reply`
 * descriptor so answers/ICE go back over a channel the peer can hear.
 */

import { SignalingService, MESH_SIGNAL_TYPE, type SignalTarget, type InboundSignal } from '@/services/signalingService';
import config from '@/config';


const STORAGE_KEY = 'interpoll_mesh_enabled';
const CHANNEL_LABEL = 'interpoll-data';
/** Manual (offline) signaling uses a fixed key so both sides agree on the connection id. */
const MANUAL_REMOTE_ID = 'manual';

interface ManualBundle {
  v: 1;
  kind: 'offer' | 'answer';
  sdp: RTCSessionDescriptionInit;
}

export class WebRTCService {
  private static connections: Map<string, RTCPeerConnection> = new Map();
  private static channels: Map<string, RTCDataChannel> = new Map();
  private static pendingCandidates: Map<string, RTCIceCandidateInit[]> = new Map();
  /** Where to send replies (answer/ICE) for each connection. */
  private static replyTargets: Map<string, SignalTarget> = new Map();
  private static initialized = false;
  private static enabled = false;
  private static messageHandlers: Map<string, Set<(data: unknown) => void>> = new Map();
  private static peerListeners: Set<(peers: string[]) => void> = new Set();

  // ── public API ──────────────────────────────────────────────

  static async initialize(): Promise<void> {
    if (this.initialized) return;
    if (typeof RTCPeerConnection === 'undefined') return;

    this.enabled = localStorage.getItem(STORAGE_KEY) === 'true';
    this.initialized = true;

    await SignalingService.initialize();
    SignalingService.onSignal((sig) => { void this.handleSignal(sig); });

    // Mesh-relay signaling tier: forward flooded signed envelopes to the
    // signaling service, which delivers or re-floods them toward their target.
    this.onMessage(MESH_SIGNAL_TYPE, (env) =>
      SignalingService.handleRelayEnvelope(env as Record<string, unknown>));
  }

  static isEnabled(): boolean {
    return this.enabled;
  }

  static setEnabled(value: boolean): void {
    this.enabled = value;
    try { localStorage.setItem(STORAGE_KEY, String(value)); } catch { /* quota / privacy */ }
    if (!value) this.cleanup();
  }

  /**
   * Initiate a connection to a peer over the automatic signaling tiers.
   * `target` tells the signaling layer how to reach them (peerId and/or pubkey).
   */
  static async connectToPeer(remoteId: string, target: SignalTarget = { peerId: remoteId }): Promise<void> {
    if (!this.enabled || this.connections.has(remoteId)) return;
    if (typeof RTCPeerConnection === 'undefined') return;

    this.replyTargets.set(remoteId, target);
    const pc = this.createPeerConnection(remoteId);
    try {
      const channel = pc.createDataChannel(CHANNEL_LABEL);
      this.setupChannel(remoteId, channel);

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const sent = await SignalingService.sendSignal(target, 'offer', { sdp: offer });
      if (!sent) this.disconnectPeer(remoteId);
    } catch {
      this.disconnectPeer(remoteId);
    }
  }

  static sendToPeer(peerId: string, type: string, data: unknown): boolean {
    const channel = this.channels.get(peerId);
    if (!channel || channel.readyState !== 'open') return false;
    try {
      channel.send(JSON.stringify({ type, data }));
      return true;
    } catch {
      return false;
    }
  }

  static broadcastToAll(type: string, data: unknown): void {
    const payload = JSON.stringify({ type, data });
    for (const [, channel] of this.channels) {
      if (channel.readyState === 'open') {
        try { channel.send(payload); } catch { /* peer gone */ }
      }
    }
  }

  static onMessage(type: string, callback: (data: unknown) => void): () => void {
    if (!this.messageHandlers.has(type)) {
      this.messageHandlers.set(type, new Set());
    }
    this.messageHandlers.get(type)!.add(callback);
    return () => { this.messageHandlers.get(type)?.delete(callback); };
  }

  static getConnectedPeers(): string[] {
    const peers: string[] = [];
    for (const [id, channel] of this.channels) {
      if (channel.readyState === 'open') peers.push(id);
    }
    return peers;
  }

  /** Subscribe to changes in the connected-peer set. Returns an unsubscribe fn. */
  static onPeersChange(cb: (peers: string[]) => void): () => void {
    this.peerListeners.add(cb);
    cb(this.getConnectedPeers());
    return () => { this.peerListeners.delete(cb); };
  }

  static disconnectPeer(peerId: string): void {
    const channel = this.channels.get(peerId);
    if (channel) {
      channel.onopen = channel.onmessage = channel.onclose = channel.onerror = null;
      channel.close();
    }
    this.channels.delete(peerId);
    const pc = this.connections.get(peerId);
    if (pc) {
      pc.onicecandidate = pc.onconnectionstatechange = pc.ondatachannel = null;
      pc.close();
    }
    this.connections.delete(peerId);
    this.pendingCandidates.delete(peerId);
    this.replyTargets.delete(peerId);
    this.notifyPeers();
  }

  static cleanup(): void {
    for (const [id] of this.connections) {
      this.disconnectPeer(id);
    }
  }

  // ── manual (offline) signaling — tier 3 ────────────────────

  /**
   * Create a self-contained offer bundle for out-of-band exchange (copy/paste, QR).
   * ICE is gathered non-trickle so all candidates ship inside the SDP — no live
   * signaling channel is required. The peer pastes it into `acceptManualOffer`.
   */
  static async createManualOffer(): Promise<string> {
    this.ensureEnabled();
    this.disconnectPeer(MANUAL_REMOTE_ID);
    const pc = this.createPeerConnection(MANUAL_REMOTE_ID);
    const channel = pc.createDataChannel(CHANNEL_LABEL);
    this.setupChannel(MANUAL_REMOTE_ID, channel);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await this.waitForIceGathering(pc);

    return this.encodeBundle({ v: 1, kind: 'offer', sdp: pc.localDescription!.toJSON() });
  }

  /**
   * Accept a peer's offer bundle and return an answer bundle to send back.
   */
  static async acceptManualOffer(bundleText: string): Promise<string> {
    this.ensureEnabled();
    const bundle = this.decodeBundle(bundleText);
    if (bundle.kind !== 'offer') throw new Error('Expected an offer bundle');

    this.disconnectPeer(MANUAL_REMOTE_ID);
    const pc = this.createPeerConnection(MANUAL_REMOTE_ID);
    pc.ondatachannel = (event) => this.setupChannel(MANUAL_REMOTE_ID, event.channel);

    await pc.setRemoteDescription(new RTCSessionDescription(bundle.sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await this.waitForIceGathering(pc);

    return this.encodeBundle({ v: 1, kind: 'answer', sdp: pc.localDescription!.toJSON() });
  }

  /**
   * Apply the answer bundle returned by the peer to complete a manual connection.
   */
  static async acceptManualAnswer(bundleText: string): Promise<void> {
    const bundle = this.decodeBundle(bundleText);
    if (bundle.kind !== 'answer') throw new Error('Expected an answer bundle');
    const pc = this.connections.get(MANUAL_REMOTE_ID);
    if (!pc) throw new Error('No pending manual offer — create an offer first');
    await pc.setRemoteDescription(new RTCSessionDescription(bundle.sdp));
  }

  // ── signaling handler (private) ─────────────────────────────

  private static async handleSignal(sig: InboundSignal): Promise<void> {
    if (!this.enabled || typeof RTCPeerConnection === 'undefined') return;
    if (sig.kind === 'offer' && sig.sdp) return this.handleOffer(sig);
    if (sig.kind === 'answer' && sig.sdp) return this.handleAnswer(sig);
    if (sig.kind === 'ice' && sig.candidate) return this.handleIceCandidate(sig);
  }

  private static async handleOffer(sig: InboundSignal): Promise<void> {
    const remoteId = sig.remoteId;

    // Glare: both sides sent offers simultaneously. The "impolite" peer (higher
    // id) ignores the incoming offer. The comparison must use ids from the same
    // namespace as `remoteId` — peerId on the WSS tier, pubkey on the Gun tier —
    // or the two sides won't agree on who backs off.
    if (this.connections.has(remoteId)) {
      const existingPc = this.connections.get(remoteId)!;
      if (existingPc.signalingState !== 'stable') {
        const selfId = await this.selfIdFor(sig);
        if (selfId > remoteId) return;
      }
      this.disconnectPeer(remoteId);
    }

    this.replyTargets.set(remoteId, sig.reply);
    const pc = this.createPeerConnection(remoteId);
    try {
      pc.ondatachannel = (event) => this.setupChannel(remoteId, event.channel);

      await pc.setRemoteDescription(new RTCSessionDescription(sig.sdp!));
      await this.flushCandidates(remoteId, pc);

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      await SignalingService.sendSignal(sig.reply, 'answer', { sdp: answer });
    } catch {
      this.disconnectPeer(remoteId);
    }
  }

  private static async handleAnswer(sig: InboundSignal): Promise<void> {
    const pc = this.connections.get(sig.remoteId);
    if (!pc || pc.signalingState !== 'have-local-offer') return;
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(sig.sdp!));
      await this.flushCandidates(sig.remoteId, pc);
    } catch {
      this.disconnectPeer(sig.remoteId);
    }
  }

  private static async handleIceCandidate(sig: InboundSignal): Promise<void> {
    const pc = this.connections.get(sig.remoteId);
    if (!pc) return;

    if (!pc.remoteDescription) {
      if (!this.pendingCandidates.has(sig.remoteId)) this.pendingCandidates.set(sig.remoteId, []);
      this.pendingCandidates.get(sig.remoteId)!.push(sig.candidate!);
      return;
    }

    try {
      await pc.addIceCandidate(new RTCIceCandidate(sig.candidate!));
    } catch {
      // ICE candidate failure is non-fatal; NAT traversal may still succeed
    }
  }

  // ── helpers (private) ──────────────────────────────────────

  /** Our own id in the same namespace as the inbound signal's remoteId (for glare tie-break). */
  private static async selfIdFor(sig: InboundSignal): Promise<string> {
    if (sig.reply.peerId && sig.reply.peerId === sig.remoteId) {
      const { WebSocketService } = await import('@/services/websocketService');
      return WebSocketService.getPeerId();
    }
    return SignalingService.getMyPubkey();
  }

  private static async flushCandidates(remoteId: string, pc: RTCPeerConnection): Promise<void> {
    const queued = this.pendingCandidates.get(remoteId) ?? [];
    this.pendingCandidates.delete(remoteId);
    for (const candidate of queued) {
      try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch { /* non-fatal */ }
    }
  }

  private static createPeerConnection(remoteId: string): RTCPeerConnection {
    // ICE servers are config-driven: diverse STUN by default, plus any user TURN.
    const pc = new RTCPeerConnection({ iceServers: config.getIceServers() });
    this.connections.set(remoteId, pc);

    pc.onicecandidate = (event) => {
      if (!event.candidate) return;
      const target = this.replyTargets.get(remoteId);
      if (!target) return; // manual connections gather ICE non-trickle
      void SignalingService.sendSignal(target, 'ice', { candidate: event.candidate.toJSON() })
        .catch((e) => console.warn('[WebRTC] Failed to send ICE candidate', e));
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      if (state === 'disconnected' || state === 'failed' || state === 'closed') {
        this.disconnectPeer(remoteId);
      }
    };

    return pc;
  }

  private static setupChannel(remoteId: string, channel: RTCDataChannel): void {
    this.channels.set(remoteId, channel);

    channel.onopen = () => {
      console.log(`[WebRTC] DataChannel open with ${remoteId}`);
      this.notifyPeers();
    };

    channel.onmessage = (event) => {
      try {
        const { type, data } = JSON.parse(event.data as string) as { type: string; data: unknown };
        const handlers = this.messageHandlers.get(type);
        if (handlers) {
          for (const handler of handlers) handler(data);
        }
      } catch {
        // Ignore malformed messages
      }
    };

    channel.onclose = () => {
      console.log(`[WebRTC] DataChannel closed with ${remoteId}`);
      this.disconnectPeer(remoteId);
    };

    channel.onerror = (event) => {
      console.warn(`[WebRTC] DataChannel error with ${remoteId}`, event);
      this.disconnectPeer(remoteId);
    };
  }

  private static waitForIceGathering(pc: RTCPeerConnection): Promise<void> {
    if (pc.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise((resolve) => {
      const timeout = setTimeout(finish, 4000); // ship whatever we have after 4s
      const check = () => {
        if (pc.iceGatheringState === 'complete') finish();
      };
      function finish() {
        clearTimeout(timeout);
        pc.removeEventListener('icegatheringstatechange', check);
        resolve();
      }
      pc.addEventListener('icegatheringstatechange', check);
    });
  }

  private static encodeBundle(bundle: ManualBundle): string {
    return btoa(unescape(encodeURIComponent(JSON.stringify(bundle))));
  }

  private static decodeBundle(text: string): ManualBundle {
    let parsed: ManualBundle;
    try {
      parsed = JSON.parse(decodeURIComponent(escape(atob(text.trim()))));
    } catch {
      throw new Error('Invalid signaling bundle');
    }
    if (parsed?.v !== 1 || !parsed.sdp || (parsed.kind !== 'offer' && parsed.kind !== 'answer')) {
      throw new Error('Unrecognized signaling bundle');
    }
    return parsed;
  }

  private static ensureEnabled(): void {
    if (typeof RTCPeerConnection === 'undefined') throw new Error('WebRTC is not supported in this browser');
    if (!this.enabled) this.setEnabled(true);
  }

  private static notifyPeers(): void {
    const peers = this.getConnectedPeers();
    for (const cb of this.peerListeners) {
      try { cb(peers); } catch { /* ignore */ }
    }
  }
}
