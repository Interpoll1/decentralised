/**
 * Auto full-mesh manager.
 *
 * Keeps a capped set of direct WebRTC connections to known peers so the mesh is
 * already formed *before* a relay drops — when it does, sync simply continues.
 * Peers are discovered two ways:
 *   - WSS up: the relay's live peer list (addressable by ephemeral peerId).
 *   - Via Gun: signed discovery announcements advertising the `webrtc` capability
 *     (addressable by stable signing pubkey — works even with no live WSS relay).
 *
 * It also bridges Gun's wire protocol over the datachannels, so content
 * (polls/posts/comments) replicates P2P with no Gun relay.
 */

import { WebRTCService } from '@/services/webrtcService';
import { GunService } from '@/services/gunService';
import { SignalingService, type SignalTarget } from '@/services/signalingService';
import { DiscoveryService } from '@/services/discoveryService';

const STORAGE_KEY = 'interpoll_mesh_enabled';
const MAX_CONNECTIONS = 10;
const RECONCILE_INTERVAL_MS = 5000;
const REDIAL_COOLDOWN_MS = 30_000;
const ANNOUNCE_INTERVAL_MS = 120_000;

export class MeshService {
  private static initialized = false;
  private static reconcileTimer: ReturnType<typeof setInterval> | null = null;
  private static announceTimer: ReturnType<typeof setInterval> | null = null;
  private static dialed = new Map<string, number>();
  private static wireBridgeAttached = false;

  static initialize(): void {
    if (this.initialized) return;
    if (typeof RTCPeerConnection === 'undefined') return;
    this.initialized = true;

    // Default-on, but respect an explicit opt-out.
    if (localStorage.getItem(STORAGE_KEY) === null) {
      WebRTCService.setEnabled(true);
    }
    if (!WebRTCService.isEnabled()) return;

    // Live Gun announcements let us find webrtc-capable peers even with no relay.
    void DiscoveryService.initialize({ subscribeLive: true });
    void this.announce();
    this.announceTimer = setInterval(() => { void this.announce(); }, ANNOUNCE_INTERVAL_MS);

    this.attachGunWireBridge();

    void this.reconcile();
    this.reconcileTimer = setInterval(() => { void this.reconcile(); }, RECONCILE_INTERVAL_MS);

    // React quickly to topology changes instead of waiting for the next tick.
    void import('@/services/websocketService').then(({ WebSocketService }) => {
      WebSocketService.onStatusChange(() => { void this.reconcile(); });
    });
    WebRTCService.onPeersChange(() => { /* keeps peer listeners warm for UI */ });
  }

  /** Publish our own webrtc-capable announcement so peers can dial us via Gun. */
  private static async announce(): Promise<void> {
    if (!WebRTCService.isEnabled()) return;
    try {
      const { WebSocketService } = await import('@/services/websocketService');
      const peerId = WebSocketService.getPeerId();
      await DiscoveryService.publishLocalAnnouncement({
        nodeId: peerId,
        peerId,
        capabilities: ['webrtc'],
      });
    } catch {
      // Gun unreachable (total blackout) — manual signaling is the fallback.
    }
  }

  /** Bridge Gun graph traffic over the datachannels (content sync without a Gun relay). */
  private static attachGunWireBridge(): void {
    if (this.wireBridgeAttached) return;
    this.wireBridgeAttached = true;
    const bridge = GunService.attachWireBridge(
      (msg) => { WebRTCService.broadcastToAll('gun-wire', msg); },
      { active: () => WebRTCService.getConnectedPeers().length > 0 },
    );
    WebRTCService.onMessage('gun-wire', (msg) => bridge.receive(msg));
  }

  private static async reconcile(): Promise<void> {
    if (!WebRTCService.isEnabled()) return;

    const connected = new Set(WebRTCService.getConnectedPeers());
    let budget = MAX_CONNECTIONS - connected.size;
    if (budget <= 0) return;

    const tier = await SignalingService.currentTier();
    const myPubkey = SignalingService.getMyPubkey();
    const candidates = new Map<string, SignalTarget>();

    // WSS-addressable peers (preferred while the relay is up).
    if (tier === 'wss') {
      const { WebSocketService } = await import('@/services/websocketService');
      for (const peerId of WebSocketService.getPeerIds()) {
        candidates.set(peerId, { peerId });
      }
    }

    // Gun-discovered, WebRTC-capable peers (pubkey-addressable; works relay-down).
    for (const entry of DiscoveryService.getEntries()) {
      if (!entry.capabilities?.includes('webrtc')) continue;
      if (!entry.signerPubkey || entry.signerPubkey === myPubkey) continue;
      if (candidates.has(entry.signerPubkey)) continue;
      candidates.set(entry.signerPubkey, { pubkey: entry.signerPubkey, peerId: entry.peerId });
    }

    const now = Date.now();
    for (const [remoteId, target] of candidates) {
      if (budget <= 0) break;
      if (connected.has(remoteId)) continue;
      const last = this.dialed.get(remoteId) ?? 0;
      if (now - last < REDIAL_COOLDOWN_MS) continue;
      this.dialed.set(remoteId, now);
      budget--;
      void WebRTCService.connectToPeer(remoteId, target).catch(() => { /* retried after cooldown */ });
    }
  }

  static getStatus(): { enabled: boolean; peerCount: number } {
    return {
      enabled: WebRTCService.isEnabled(),
      peerCount: WebRTCService.getConnectedPeers().length,
    };
  }

  /** Enable/disable the mesh at runtime (e.g. from Settings). */
  static setEnabled(value: boolean): void {
    WebRTCService.setEnabled(value);
    if (value && this.initialized) {
      this.attachGunWireBridge();
      void this.reconcile();
    }
  }

  static cleanup(): void {
    if (this.reconcileTimer) {
      clearInterval(this.reconcileTimer);
      this.reconcileTimer = null;
    }
    if (this.announceTimer) {
      clearInterval(this.announceTimer);
      this.announceTimer = null;
    }
    this.dialed.clear();
  }
}

export default MeshService;
