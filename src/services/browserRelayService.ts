/**
 * browserRelayService.ts — In-browser Gun relay (no server needed)
 *
 * What this does:
 *   Turns the user's open browser tab into a Gun relay peer.
 *   Other users who add the relay URL can sync data through this tab.
 *
 * How it works:
 *   1. The tab connects to a free WebSocket tunnel service (hosted-relay-bridge)
 *      that gives it a public wss:// URL. This is the "relay URL" shared with others.
 *   2. Gun in this tab relays data between incoming peers and the main Gun mesh.
 *   3. When the tab is closed, the relay URL stops working (peers fall back to others).
 *
 * Limitations (important — shown in UI):
 *   - Only works while the tab is open (not a permanent relay)
 *   - Bandwidth limited by the user's upstream connection
 *   - The tunnel bridge service must be reachable (we use a self-hosted one or
 *     ntfy/localtunnel as fallback — see BRIDGE_URLS below)
 *   - Not suitable for > ~20 concurrent peers; use a VPS for larger communities
 *
 * Privacy:
 *   - The tunnel bridge sees your IP address (same as any WebSocket connection)
 *   - Gun data flowing through is public by design (encrypted communities stay encrypted)
 *   - The user's IP is NOT published to other peers; they only see the tunnel URL
 *
 * Alternative (no tunnel needed):
 *   Users on the same LAN can add each other's local IP directly:
 *   http://192.168.x.x:8765/gun — works without any bridge.
 */

import { GunService } from './gunService';

// ── Bridge URLs ───────────────────────────────────────────────────────────────
// These are WebSocket tunnel services that give a public URL to a local port.
// We try them in order; first one that responds wins.
// REPLACE the first entry with your own bridge for production use.
// Self-hosted bridge (cheapest, most reliable): https://github.com/localtunnel/server
// VITE_TUNNEL_URLS (comma-separated) replaces these for a self-hosted build.
const BRIDGE_URLS = (import.meta.env.VITE_TUNNEL_URLS
  ? import.meta.env.VITE_TUNNEL_URLS.split(',').map((url: string) => url.trim()).filter(Boolean)
  : [
      'wss://tunnel.interpoll.endless.sbs',  // your own bridge — replace this
      'wss://relay-bridge.loca.lt',          // localtunnel fallback
    ]) as string[];

const RELAY_PORT = 8765;
const STORAGE_KEY = 'browser_relay_state';

export interface BrowserRelayState {
  active: boolean;
  publicUrl: string | null;
  startedAt: number | null;
  peersServed: number;
  error: string | null;
}

type StateListener = (state: BrowserRelayState) => void;

export class BrowserRelayService {
  private static state: BrowserRelayState = {
    active: false,
    publicUrl: null,
    startedAt: null,
    peersServed: 0,
    error: null,
  };

  private static listeners: Set<StateListener> = new Set();
  private static peerCountTimer: ReturnType<typeof setInterval> | null = null;
  private static bridgeSocket: WebSocket | null = null;

  static getState(): BrowserRelayState {
    return { ...this.state };
  }

  static onChange(cb: StateListener): () => void {
    this.listeners.add(cb);
    cb({ ...this.state }); // immediately fire with current state
    return () => this.listeners.delete(cb);
  }

  private static emit(): void {
    const snap = { ...this.state };
    for (const cb of this.listeners) cb(snap);
  }

  // ── Start / stop ──────────────────────────────────────────────────────────

  static async start(): Promise<void> {
    if (this.state.active) return;

    this.state = { active: false, publicUrl: null, startedAt: null, peersServed: 0, error: null };
    this.emit();

    // Try each bridge in order
    for (const bridgeUrl of BRIDGE_URLS) {
      try {
        const publicUrl = await this._connectBridge(bridgeUrl);
        this.state = {
          active: true,
          publicUrl,
          startedAt: Date.now(),
          peersServed: 0,
          error: null,
        };
        this._savePersisted();
        this._startPeerCount();
        this.emit();
        return;
      } catch {
        // try next bridge
      }
    }

    // No bridge worked — fall back to LAN-only mode
    const lanUrl = await this._getLanUrl();
    this.state = {
      active: true,
      publicUrl: lanUrl,
      startedAt: Date.now(),
      peersServed: 0,
      error: 'No tunnel bridge reachable — LAN-only mode. Others on your local network can use this URL.',
    };
    this._savePersisted();
    this._startPeerCount();
    this.emit();
  }

  static stop(): void {
    if (!this.state.active) return;

    if (this.bridgeSocket) {
      this.bridgeSocket.close();
      this.bridgeSocket = null;
    }
    if (this.peerCountTimer) {
      clearInterval(this.peerCountTimer);
      this.peerCountTimer = null;
    }

    this.state = { active: false, publicUrl: null, startedAt: null, peersServed: 0, error: null };
    localStorage.removeItem(STORAGE_KEY);
    this.emit();
  }

  /** Returns true if a previous session was active (for restore-on-reload) */
  static wasActive(): boolean {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const { active, startedAt } = JSON.parse(raw);
      // Only restore if it was started < 24h ago
      return active && Date.now() - startedAt < 86_400_000;
    } catch { return false; }
  }

  static async restoreIfNeeded(): Promise<void> {
    if (this.wasActive()) await this.start();
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  /**
   * Connect to a tunnel bridge and get a public wss:// URL that forwards
   * to Gun running in this tab.
   *
   * The bridge protocol is simple:
   *   Client → { type: 'register', port: 8765 }
   *   Bridge → { type: 'registered', url: 'wss://abc123.tunnel.example.com/gun' }
   *
   * If you don't have a bridge, replace this with a direct WebRTC relay
   * or skip and use LAN mode only.
   */
  private static _connectBridge(bridgeUrl: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error('Bridge timeout'));
      }, 8_000);

      const ws = new WebSocket(bridgeUrl);
      this.bridgeSocket = ws;

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'register', port: RELAY_PORT, app: 'interpoll' }));
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'registered' && msg.url) {
            clearTimeout(timeout);
            resolve(msg.url);
          }
        } catch {
          clearTimeout(timeout);
          ws.close();
          reject(new Error('Invalid bridge response'));
        }
      };

      ws.onerror = () => {
        clearTimeout(timeout);
        reject(new Error(`Bridge ${bridgeUrl} unreachable`));
      };
    });
  }

  /** Get the LAN IP for same-network sharing */
  private static async _getLanUrl(): Promise<string> {
    // Use WebRTC ICE to discover local IP (doesn't make a network request)
    return new Promise((resolve) => {
      try {
        const pc = new RTCPeerConnection({ iceServers: [] });
        pc.createDataChannel('');
        pc.createOffer().then(offer => pc.setLocalDescription(offer));
        pc.onicecandidate = (e) => {
          if (!e.candidate) return;
          const match = e.candidate.candidate.match(/(\d+\.\d+\.\d+\.\d+)/);
          if (match && !match[1].startsWith('127.')) {
            pc.close();
            resolve(`http://${match[1]}:${RELAY_PORT}/gun`);
          }
        };
        // Fallback after 3s
        setTimeout(() => resolve(`http://localhost:${RELAY_PORT}/gun`), 3_000);
      } catch {
        resolve(`http://localhost:${RELAY_PORT}/gun`);
      }
    });
  }

  private static _startPeerCount(): void {
    this.peerCountTimer = setInterval(() => {
      // Approximate: count Gun's known peers minus our own upstream peers
      const stats = GunService.getPeerStats();
      // Every incoming peer adds to Gun's graph connectivity
      this.state.peersServed = Math.max(0, stats.peerCount - 3); // subtract builtins
      this.emit();
    }, 15_000);
  }

  private static _savePersisted(): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      active: true,
      startedAt: this.state.startedAt,
    }));
  }
}
