/**
 * WebRTC P2P sync service.
 * Uses the existing WebSocket relay only for signaling (offer/answer/ICE).
 * Once a DataChannel is established, peers exchange blockchain blocks and
 * posts directly without the relay.
 */

const STUN_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

const STORAGE_KEY = 'interpoll_webrtc_enabled';
const CHANNEL_LABEL = 'interpoll-data';

export class WebRTCService {
  private static connections: Map<string, RTCPeerConnection> = new Map();
  private static channels: Map<string, RTCDataChannel> = new Map();
  private static pendingCandidates: Map<string, RTCIceCandidateInit[]> = new Map();
  private static initialized = false;
  private static enabled = false;
  private static messageHandlers: Map<string, Set<(data: unknown) => void>> = new Map();
  private static wsServicePromise: Promise<typeof import('./websocketService')> | null = null;

  // ── public API ──────────────────────────────────────────────

  static async initialize(): Promise<void> {
    if (this.initialized) return;
    if (typeof RTCPeerConnection === 'undefined') return;

    this.enabled = localStorage.getItem(STORAGE_KEY) === 'true';
    this.initialized = true;

    const { WebSocketService } = await this.getWsService();

    WebSocketService.subscribe('rtc-offer', (data: unknown) => {
      const d = data as { peerId: string; targetPeerId: string; sdp: RTCSessionDescriptionInit };
      if (d.targetPeerId === WebSocketService.getPeerId()) {
        void this.handleOffer(d);
      }
    });

    WebSocketService.subscribe('rtc-answer', (data: unknown) => {
      const d = data as { peerId: string; targetPeerId: string; sdp: RTCSessionDescriptionInit };
      if (d.targetPeerId === WebSocketService.getPeerId()) {
        void this.handleAnswer(d);
      }
    });

    WebSocketService.subscribe('rtc-ice', (data: unknown) => {
      const d = data as { peerId: string; targetPeerId: string; candidate: RTCIceCandidateInit };
      if (d.targetPeerId === WebSocketService.getPeerId()) {
        void this.handleIceCandidate(d);
      }
    });
  }

  static isEnabled(): boolean {
    return this.enabled;
  }

  static setEnabled(value: boolean): void {
    this.enabled = value;
    try { localStorage.setItem(STORAGE_KEY, String(value)); } catch { /* quota / privacy */ }
    if (!value) this.cleanup();
  }

  static async connectToPeer(peerId: string): Promise<void> {
    if (!this.enabled || this.connections.has(peerId)) return;
    if (typeof RTCPeerConnection === 'undefined') return;

    const pc = this.createPeerConnection(peerId);
    try {
      const channel = pc.createDataChannel(CHANNEL_LABEL);
      this.setupChannel(peerId, channel);

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const { WebSocketService } = await this.getWsService();
      WebSocketService.broadcast('rtc-offer', {
        peerId: WebSocketService.getPeerId(),
        targetPeerId: peerId,
        sdp: offer,
      });
    } catch {
      this.disconnectPeer(peerId);
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
  }

  static cleanup(): void {
    for (const [id] of this.connections) {
      this.disconnectPeer(id);
    }
  }

  // ── signaling handlers (private) ───────────────────────────

  private static async handleOffer(data: { peerId: string; sdp: RTCSessionDescriptionInit }): Promise<void> {
    if (!this.enabled) return;
    if (typeof RTCPeerConnection === 'undefined') return;

    const { peerId, sdp } = data;
    const { WebSocketService } = await this.getWsService();
    const myId = WebSocketService.getPeerId();

    // Glare: both sides sent offers simultaneously.
    // The "impolite" peer (higher ID) ignores the incoming offer.
    if (this.connections.has(peerId)) {
      const existingPc = this.connections.get(peerId)!;
      if (existingPc.signalingState !== 'stable') {
        if (myId > peerId) return;
      }
      this.disconnectPeer(peerId);
    }

    const pc = this.createPeerConnection(peerId);
    try {
      pc.ondatachannel = (event) => {
        this.setupChannel(peerId, event.channel);
      };

      await pc.setRemoteDescription(new RTCSessionDescription(sdp));

      // Flush any ICE candidates that arrived before the remote description
      const queued = this.pendingCandidates.get(peerId) ?? [];
      this.pendingCandidates.delete(peerId);
      for (const candidate of queued) {
        try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch { /* non-fatal */ }
      }

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      WebSocketService.broadcast('rtc-answer', {
        peerId: myId,
        targetPeerId: peerId,
        sdp: answer,
      });
    } catch {
      this.disconnectPeer(peerId);
    }
  }

  private static async handleAnswer(data: { peerId: string; sdp: RTCSessionDescriptionInit }): Promise<void> {
    if (!this.enabled) return;
    const pc = this.connections.get(data.peerId);
    if (!pc || pc.signalingState !== 'have-local-offer') return;
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));

      // Flush queued ICE candidates
      const queued = this.pendingCandidates.get(data.peerId) ?? [];
      this.pendingCandidates.delete(data.peerId);
      for (const candidate of queued) {
        try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch { /* non-fatal */ }
      }
    } catch {
      this.disconnectPeer(data.peerId);
    }
  }

  private static async handleIceCandidate(data: { peerId: string; candidate: RTCIceCandidateInit }): Promise<void> {
    if (!this.enabled) return;
    const pc = this.connections.get(data.peerId);
    if (!pc) return;

    if (!pc.remoteDescription) {
      if (!this.pendingCandidates.has(data.peerId)) this.pendingCandidates.set(data.peerId, []);
      this.pendingCandidates.get(data.peerId)!.push(data.candidate);
      return;
    }

    try {
      await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
    } catch {
      // ICE candidate failure is non-fatal; NAT traversal may still succeed
    }
  }

  // ── helpers (private) ──────────────────────────────────────

  private static getWsService() {
    if (!this.wsServicePromise) this.wsServicePromise = import('./websocketService');
    return this.wsServicePromise;
  }

  private static createPeerConnection(peerId: string): RTCPeerConnection {
    const pc = new RTCPeerConnection(STUN_SERVERS);
    this.connections.set(peerId, pc);

    pc.onicecandidate = (event) => {
      if (!event.candidate) return;
      void (async () => {
        try {
          const { WebSocketService } = await this.getWsService();
          WebSocketService.broadcast('rtc-ice', {
            peerId: WebSocketService.getPeerId(),
            targetPeerId: peerId,
            candidate: event.candidate!.toJSON(),
          });
        } catch (e) {
          console.warn('[WebRTC] Failed to send ICE candidate', e);
        }
      })();
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      if (state === 'disconnected' || state === 'failed' || state === 'closed') {
        this.disconnectPeer(peerId);
      }
    };

    return pc;
  }

  private static setupChannel(peerId: string, channel: RTCDataChannel): void {
    this.channels.set(peerId, channel);

    channel.onopen = () => {
      console.log(`[WebRTC] DataChannel open with ${peerId}`);
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
      console.log(`[WebRTC] DataChannel closed with ${peerId}`);
      this.disconnectPeer(peerId);
    };

    channel.onerror = (event) => {
      console.warn(`[WebRTC] DataChannel error with ${peerId}`, event);
      this.disconnectPeer(peerId);
    };
  }
}
