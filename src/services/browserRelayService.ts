/**
 * browserRelayService.ts — In-browser Gun relay (no server needed)
 *
 * Turns the user's open tab into a Gun relay peer that anyone can connect to.
 *
 * A browser cannot accept inbound connections, so the tab registers with the
 * tunnel bridge (community-relay/relay-bridge-server.js, served at
 * `<api>/tunnel`). The bridge hands back a public URL
 * (`wss://<api host>/tunnel/<id>/gun`); every Gun peer that connects to it is
 * multiplexed over the tab's single socket, and this service plugs each one
 * into the tab's Gun mesh as a virtual peer. Gun then relays between those
 * peers and the tab's own upstream relays exactly as a server relay would.
 *
 * Limits: only runs while the tab is open; the bridge caps a tab at 50 peers;
 * bandwidth is the user's upstream. The bridge sees the tab's IP, remote peers
 * do not. The public URL changes every time the relay (re)starts.
 */

import { GunService } from './gunService';
import config from '@/config';

const STORAGE_KEY = 'browser_relay_state';
const PING_MS = 25_000;
const RECONNECT_MS = 5_000;

export interface BrowserRelayState {
  active: boolean;
  publicUrl: string | null;
  startedAt: number | null;
  peersServed: number;
  error: string | null;
}

type StateListener = (state: BrowserRelayState) => void;

interface VirtualPeer {
  id: string;
  wire: any;
  root: any;
}

function bridgeUrls(): string[] {
  const toWs = (origin: string) => `${origin.replace(/\/+$/, '').replace(/^http/, 'ws')}/tunnel`;
  return [...new Set([toWs(config.relay.api), toWs(config.auth.api)])];
}

export class BrowserRelayService {
  private static state: BrowserRelayState = {
    active: false,
    publicUrl: null,
    startedAt: null,
    peersServed: 0,
    error: null,
  };

  private static listeners: Set<StateListener> = new Set();
  private static bridgeSocket: WebSocket | null = null;
  private static peers = new Map<number, VirtualPeer>();
  private static pingTimer: ReturnType<typeof setInterval> | null = null;
  private static reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private static stopping = false;

  static getState(): BrowserRelayState {
    return { ...this.state };
  }

  static onChange(cb: StateListener): () => void {
    this.listeners.add(cb);
    cb({ ...this.state });
    return () => this.listeners.delete(cb);
  }

  private static emit(): void {
    const snap = { ...this.state };
    for (const cb of this.listeners) cb(snap);
  }

  private static patch(p: Partial<BrowserRelayState>): void {
    this.state = { ...this.state, ...p };
    this.emit();
  }

  // ── Start / stop ──────────────────────────────────────────────────────────

  static async start(): Promise<void> {
    if (this.state.active || this.bridgeSocket) return;
    this.stopping = false;
    this.patch({ error: null });

    let lastErr: unknown = null;
    for (const url of bridgeUrls()) {
      try {
        const { ws, publicUrl } = await this.connectBridge(url);
        this.attach(ws);
        this.patch({
          active: true,
          publicUrl,
          startedAt: this.state.startedAt ?? Date.now(),
          peersServed: 0,
          error: null,
        });
        this.savePersisted();
        return;
      } catch (e) {
        lastErr = e;
      }
    }
    this.patch({ active: false, error: 'Could not reach the tunnel bridge. Check your connection and try again.' });
    throw lastErr instanceof Error ? lastErr : new Error('Tunnel bridge unreachable');
  }

  static stop(): void {
    this.stopping = true;
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    this.teardown();
    this.state = { active: false, publicUrl: null, startedAt: null, peersServed: 0, error: null };
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* storage unavailable */ }
    this.emit();
  }

  /** Returns true if a previous session was active (for restore-on-reload) */
  static wasActive(): boolean {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const { active, startedAt } = JSON.parse(raw);
      return active && Date.now() - startedAt < 86_400_000;
    } catch { return false; }
  }

  static async restoreIfNeeded(): Promise<void> {
    if (this.state.active || this.bridgeSocket || !this.wasActive()) return;
    try { await this.start(); } catch { /* error surfaced via state */ }
  }

  // ── Bridge ────────────────────────────────────────────────────────────────

  private static connectBridge(url: string): Promise<{ ws: WebSocket; publicUrl: string }> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const timeout = setTimeout(() => { ws.close(); reject(new Error('Bridge timeout')); }, 8_000);

      ws.onopen = () => ws.send(JSON.stringify({ type: 'register', app: 'interpoll' }));
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'registered' && msg.url) {
            clearTimeout(timeout);
            ws.onmessage = null; ws.onerror = null; ws.onclose = null;
            resolve({ ws, publicUrl: msg.url });
          }
        } catch { /* ignore non-JSON */ }
      };
      ws.onerror = () => { clearTimeout(timeout); reject(new Error(`Bridge ${url} unreachable`)); };
      ws.onclose = (e) => { clearTimeout(timeout); reject(new Error(e.reason || 'Bridge closed')); };
    });
  }

  private static attach(ws: WebSocket): void {
    this.bridgeSocket = ws;
    ws.onmessage = (event) => {
      let msg: any;
      try { msg = JSON.parse(event.data); } catch { return; }
      switch (msg.type) {
        case 'open': this.openPeer(msg.c); break;
        case 'msg': this.deliver(msg.c, msg.d); break;
        case 'close': this.closePeer(msg.c); break;
        case 'peers': this.patch({ peersServed: Number(msg.n) || 0 }); break;
      }
    };
    ws.onclose = () => {
      if (this.bridgeSocket !== ws) return;
      this.teardown();
      if (this.stopping) return;
      // Bridge dropped (deploy, network blip) — re-register. The URL changes.
      this.patch({ active: false, publicUrl: null, peersServed: 0, error: 'Tunnel lost — reconnecting…' });
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        this.start().catch(() => {
          if (!this.stopping) this.reconnectTimer = setTimeout(() => this.restoreIfNeeded(), RECONNECT_MS * 6);
        });
      }, RECONNECT_MS);
    };
    this.pingTimer = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send('{"type":"ping"}');
    }, PING_MS);
  }

  private static teardown(): void {
    if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
    for (const c of [...this.peers.keys()]) this.closePeer(c);
    const ws = this.bridgeSocket;
    this.bridgeSocket = null;
    if (ws && ws.readyState <= WebSocket.OPEN) ws.close();
  }

  // ── Virtual Gun peers ─────────────────────────────────────────────────────

  private static openPeer(c: number): void {
    const root = GunService.getRawGun()?._;
    const mesh = root?.opt?.mesh;
    if (!mesh) return;
    const send = (raw: string) => {
      const ws = this.bridgeSocket;
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'msg', c, d: raw }));
    };
    // Gun only calls wire.send(). readyState is reported as CLOSED on purpose so
    // app code that scans opt.peers for an *upstream* socket (chat fallback,
    // peer stats, RTC signalling) skips these served peers.
    const wire = {
      readyState: 3,
      __tunnel: true,
      send,
      close: () => this.bridgeSocket?.send(JSON.stringify({ type: 'close', c })),
      addEventListener: () => {},
      removeEventListener: () => {},
    };
    const peer: VirtualPeer = { id: `tunnel:${c}`, wire, root };
    this.peers.set(c, peer);
    mesh.hi(peer);
  }

  private static deliver(c: number, data: unknown): void {
    const peer = this.peers.get(c);
    if (!peer || typeof data !== 'string') return;
    const root = GunService.getRawGun()?._;
    if (!root?.opt?.mesh) return;
    if (peer.root !== root) {
      // GunService re-initialised (relay change); move the peer to the new instance.
      peer.root = root;
      root.opt.mesh.hi(peer);
    }
    root.opt.mesh.hear(data, peer);
  }

  private static closePeer(c: number): void {
    const peer = this.peers.get(c);
    if (!peer) return;
    this.peers.delete(c);
    try {
      peer.root?.opt?.mesh?.bye(peer);
      delete peer.root?.opt?.peers?.[peer.id];
    } catch { /* instance already torn down */ }
  }

  private static savePersisted(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ active: true, startedAt: this.state.startedAt }));
    } catch { /* storage unavailable */ }
  }
}
