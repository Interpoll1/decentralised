// Resilience orchestrator — the escalation ladder that keeps InterPoll reachable
// under takedown / censorship pressure.
//
// Modeled on how the GameOver-Zeus P2P botnet survived coordinated takedowns:
// it did not depend on any single channel. It preferred its fast peer list,
// fell back to gossiped peers, and — when everything it knew was blocked —
// reconverged on a deterministically-rotated rendezvous set (its DGA) so nodes
// could find each other again from scratch. This service applies that same
// escalation, honestly, for censorship resistance in the user's own app.
//
// It owns NO transport logic. It only detects "blackout" and drives the
// existing layers in order:
//   1. RelayManager.autoFailover()            — try other configured/known relays
//   2. gossip refresh (server-list + Gun discovery)
//   3. rendezvous  (DiscoveryService publish/subscribe on rotating souls) ← new
//   4. WebRTC mesh (MeshService) + manual/QR signaling
//
// Everything is surfaced and toggleable in the Resilience Center; nothing acts
// covertly.

import { DiscoveryService } from '@/services/discoveryService';
import { GunService } from '@/services/gunService';
import { MeshService } from '@/services/meshService';
import { PeerReputationService, type ReputationRecord } from '@/services/peerReputationService';
import { RelayManager } from '@/services/relayManager';
import { WebSocketService } from '@/services/websocketService';

const AUTO_TOGGLE_KEY = 'interpoll_rendezvous_enabled';
const EVALUATE_INTERVAL_MS = 15_000;
const RENDEZVOUS_REPUBLISH_MS = 2 * 60_000;
// How long connectivity must stay fully lost before we escalate to rendezvous.
// Gives rung-1 failover a couple of evaluate ticks to reconnect first, so a
// transient blip doesn't spin up the rendezvous/mesh machinery.
const BLACKOUT_GRACE_MS = 30_000;

export type ResilienceTier = 'relay' | 'gossip' | 'rendezvous' | 'mesh';

export interface ResilienceStatus {
  /** Highest-cost tier currently engaged. */
  tier: ResilienceTier;
  /** True when no relay, no Gun peer, and no fresh known-servers are reachable. */
  blackout: boolean;
  /** Whether rendezvous publish/subscribe is currently running. */
  rendezvousActive: boolean;
  /** Whether auto-escalation to rendezvous is enabled. */
  autoEnabled: boolean;
  /** Last time we (re)converged connectivity, ms epoch, or null. */
  lastReconvergeAt: number | null;
  /** Top reputation records for display. */
  reputation: Array<ReputationRecord & { id: string }>;
}

export class ResilienceService {
  private static initialized = false;
  private static rendezvousActive = false;
  private static autoActivated = false;
  private static blackout = false;
  private static blackoutSince: number | null = null;
  private static lastReconvergeAt: number | null = null;
  private static evaluateTimer: ReturnType<typeof setInterval> | null = null;
  private static republishTimer: ReturnType<typeof setInterval> | null = null;
  private static wsUnsubscribe: (() => void) | null = null;
  private static evaluating = false;

  static initialize(): void {
    if (this.initialized) return;
    this.initialized = true;

    this.wsUnsubscribe = WebSocketService.onStatusChange(() => {
      void this.evaluate();
    });
    this.evaluateTimer = setInterval(() => {
      void this.evaluate();
    }, EVALUATE_INTERVAL_MS);

    // Prime state shortly after startup so the UI reflects reality immediately.
    void this.evaluate();
  }

  static cleanup(): void {
    if (this.wsUnsubscribe) {
      this.wsUnsubscribe();
      this.wsUnsubscribe = null;
    }
    if (this.evaluateTimer) {
      clearInterval(this.evaluateTimer);
      this.evaluateTimer = null;
    }
    this.stopRepublish();
    this.initialized = false;
  }

  /** Whether auto-escalation to rendezvous on blackout is enabled (default on). */
  static isAutoEnabled(): boolean {
    try {
      return localStorage.getItem(AUTO_TOGGLE_KEY) !== 'false';
    } catch {
      return true;
    }
  }

  static setAutoEnabled(value: boolean): void {
    try {
      localStorage.setItem(AUTO_TOGGLE_KEY, value ? 'true' : 'false');
    } catch {
      // Storage unavailable — in-memory behavior still honors the last call site.
    }
    if (!value && this.autoActivated) {
      // User turned auto off while we had auto-activated rendezvous — stand down.
      this.deactivateRendezvous();
      this.autoActivated = false;
    }
  }

  static getStatus(): ResilienceStatus {
    return {
      tier: this.currentTier(),
      blackout: this.blackout,
      rendezvousActive: this.rendezvousActive,
      autoEnabled: this.isAutoEnabled(),
      lastReconvergeAt: this.lastReconvergeAt,
      reputation: PeerReputationService.snapshot().slice(0, 12),
    };
  }

  /** Manually engage the rendezvous tier (the "Reconnect via rendezvous" button). */
  static async activateRendezvous(): Promise<void> {
    if (this.rendezvousActive) {
      await this.publishRendezvousNow();
      return;
    }
    this.rendezvousActive = true;

    // Ensure the WebRTC mesh is on so peers found via rendezvous can actually
    // bridge content once discovered.
    try {
      MeshService.setEnabled(true);
    } catch {
      // Mesh optional; rendezvous discovery still populates known servers.
    }

    DiscoveryService.subscribeRendezvous();
    await this.publishRendezvousNow();

    if (!this.republishTimer) {
      this.republishTimer = setInterval(() => {
        void this.publishRendezvousNow();
      }, RENDEZVOUS_REPUBLISH_MS);
    }
  }

  static deactivateRendezvous(): void {
    this.rendezvousActive = false;
    this.autoActivated = false;
    this.stopRepublish();
  }

  private static async publishRendezvousNow(): Promise<void> {
    try {
      // Refresh subscriptions too, in case an epoch rolled since last publish.
      DiscoveryService.subscribeRendezvous();
      await DiscoveryService.publishRendezvous({
        nodeId: WebSocketService.getPeerId(),
        peerId: WebSocketService.getPeerId(),
        capabilities: ['ws-sync', 'gun-relay', 'relay-api', 'webrtc'],
      });
    } catch {
      // Publish failure must not break the evaluation loop.
    }
  }

  private static stopRepublish(): void {
    if (this.republishTimer) {
      clearInterval(this.republishTimer);
      this.republishTimer = null;
    }
  }

  private static currentTier(): ResilienceTier {
    if (this.rendezvousActive) {
      return MeshService.getStatus().peerCount > 0 ? 'mesh' : 'rendezvous';
    }
    if (this.blackout) return 'gossip';
    return 'relay';
  }

  private static detectBlackout(): boolean {
    // Blackout is defined by ACTUAL connectivity, not by whether the address book
    // is empty. A non-empty known-servers list (which always contains at least our
    // own self-seeded relay) says nothing about whether any of them still work —
    // that address book is what rung-1 failover consumes, not a gate on isolation.
    const wsConnected = WebSocketService.getConnectionStatus();
    const gunConnected = GunService.getPeerStats().isConnected;
    const peers = WebSocketService.getPeerCount();
    return !wsConnected && !gunConnected && peers === 0;
  }

  private static async evaluate(): Promise<void> {
    if (this.evaluating) return;
    this.evaluating = true;
    try {
      const wsConnected = WebSocketService.getConnectionStatus();
      const gunConnected = GunService.getPeerStats().isConnected;
      const connected = wsConnected || gunConnected;

      if (connected) {
        this.lastReconvergeAt = Date.now();
      }

      const nowBlackout = this.detectBlackout();
      this.blackout = nowBlackout;

      if (!nowBlackout) {
        // Connectivity is back (or was never lost). Clear the blackout clock and,
        // if WE auto-activated rendezvous, stand it down; leave a manually-activated
        // rendezvous alone.
        this.blackoutSince = null;
        if (this.autoActivated && connected) {
          this.deactivateRendezvous();
        }
        return;
      }

      // Start (or keep) the blackout clock the moment full isolation is observed.
      if (this.blackoutSince === null) this.blackoutSince = Date.now();

      // --- Blackout escalation ladder ---
      // Rung 1 + 2: let the failover brain try other relays and refresh gossip.
      try {
        await RelayManager.autoFailover();
      } catch {
        // continue escalating
      }
      try {
        await DiscoveryService.refreshFromGun();
      } catch {
        // continue escalating
      }

      // Re-check: a lower rung may have restored us.
      if (!this.detectBlackout()) {
        this.blackout = false;
        this.blackoutSince = null;
        return;
      }

      // Only escalate past gossip once we've been continuously isolated long
      // enough that rung-1 failover clearly can't recover us on its own.
      const isolatedFor = Date.now() - this.blackoutSince;
      if (isolatedFor < BLACKOUT_GRACE_MS) return;

      // Rung 3: rendezvous reconvergence (+ mesh), if auto-escalation is enabled.
      if (this.isAutoEnabled() && !this.rendezvousActive) {
        this.autoActivated = true;
        await this.activateRendezvous();
      }

      // Rung 4: promote rendezvous/Gun-discovered endpoints into an actual
      // connection. Runs on subsequent ticks once peers have had time to publish
      // their presence to the rotating soul. On success the next tick sees
      // `connected` and stands rendezvous back down.
      if (this.rendezvousActive) {
        try {
          await RelayManager.recoverFromBlackout();
        } catch {
          // Recovery is best-effort; keep escalating on the next tick.
        }
      }
    } finally {
      this.evaluating = false;
    }
  }
}

export default ResilienceService;
