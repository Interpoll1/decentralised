

import Gun from '../lib/gun-shim';
import config, { getPeerPreferences } from '../config';

export const GUN_NAMESPACE = 'v3';

// Roots that get namespaced under GUN_NAMESPACE — Gun is now live-updates only,
// not the initial load source. These namespaced paths are still written to on
// createPost/createPoll so Gun relay peers can pick up new content in real time.
// `commentVotes`, `chats`, `chat-presence` and `chat-read` were previously
// written to un-namespaced roots. That put them outside `isInNamespaceSoul()`,
// so the WebRTC wire bridge drops them in `enforce` mode — comment votes and
// direct messages could never replicate P2P. They are namespaced now; the chat
// service still reads the legacy un-namespaced paths so no history is lost.
const NAMESPACED_ROOTS = new Set(['posts', 'communities', 'polls', 'postVotes', 'users', 'comments', 'commentVotes', 'events', 'chatrooms', 'chats', 'chat-presence', 'chat-read', 'chat-p2p', 'server-config', 'user-pubkey-index']);

function createNamespacedProxy(gun: any, nsNode: any): any {
  return new Proxy(gun, {
    get(target, prop) {
      if (prop === 'get') {
        return (path: string) => {
          if (NAMESPACED_ROOTS.has(path)) {
            return nsNode.get(path);
          }
          return target.get(path);
        };
      }
      const val = target[prop];
      return typeof val === 'function' ? val.bind(target) : val;
    }
  });
}

export interface GunPeerDetail {
  url: string;
  connected: boolean;
  latencyMs?: number;
}

/** Extended peer health record — updated by the health poll timer */
export interface PeerHealth {
  url: string;
  lastSeenMs: number;
  latencyMs: number | null;
  failures: number;
  connected: boolean;
}

export type PresetProbeStatus = 'pending' | 'live' | 'dead';

// ── Peer health map (keyed by URL) ────────────────────────────────────────────
const _peerHealth = new Map<string, PeerHealth>();

export function getPeerHealthReport(): PeerHealth[] {
  return [..._peerHealth.values()];
}

// ── ServiceWorker tab-relay registration ──────────────────────────────────────
// Progressive enhancement — fails silently if SW not supported or disabled.
async function maybeRegisterServiceWorkerRelay(): Promise<void> {
  const prefs = getPeerPreferences();
  if (!prefs.swRelayEnabled) return;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  try {
    await navigator.serviceWorker.register('/gun-relay-sw.js', { scope: '/' });
  } catch {
    // Not fatal — app works fine without it
  }
}

export class GunService {
  private static gun: any = null;
  private static proxiedGun: any = null;
  private static user: any = null;
  private static evicting = false;
  private static isInitialized = false;
  private static gunWarningTraceInstalled = false;
  private static chainLogMuzzleInstalled = false;
  /** Callbacks fired after reconnect() rebuilds the Gun instance, so Gun-bound
   *  subscriptions (signaling inbox, discovery, rendezvous) can re-attach. */
  private static reconnectListeners = new Set<() => void>();
  /** Wire-bridge configuration, kept so the bridge can be re-installed on the
   *  fresh root after reconnect() (see attachWireBridge). */
  private static wireBridgeSend: ((msg: unknown) => void) | null = null;
  private static wireBridgeOptions: { active?: () => boolean } | undefined;
  /** Receiver bound to the *current* root; the handle returned to callers
   *  delegates through this so it never pins a discarded Gun instance. */
  private static wireBridgeReceive: ((msg: unknown) => void) | null = null;
  /** Latency measurements keyed by peer URL (updated on each connection event) */
  private static peerLatency = new Map<string, number>();
  private static peerConnectTime = new Map<string, number>();
  /** Probe results for all presets — populated by probePresetsAndExpand() */
  static presetProbeResults = new Map<string, PresetProbeStatus>();
  /** True while the startup probe is running */
  static presetProbeRunning = false;

  static initialize() {
    if (this.isInitialized && this.gun) return this.proxiedGun;
    this.installGunWarningTrace();

    this.installGunChainLogMuzzle();

    const peers = config.getGunPeers();
    this.gun = Gun({
      peers,
      localStorage: false,
      radisk: false,
      axe: false,
      wait: 250,
      chunk: 150,
    });

    this.trackPeerLatency(peers);

    const nsNode = this.gun.get(GUN_NAMESPACE);
    this.proxiedGun = createNamespacedProxy(this.gun, nsNode);
    this.user = this.gun.user();
    this.isInitialized = true;

    // Progressive: register SW tab relay (non-blocking)
    void maybeRegisterServiceWorkerRelay();

    return this.proxiedGun;
  }

  /**
   * Gun logs `console.log("chain not yet supported for", tmp, '...', msg, cat)`
   * (gun.js input()) for every message whose node lost its state metadata. Each
   * of those lines hands the console a live reference to `cat` — the Gun *root*
   * context — and an open DevTools retains every logged argument forever. Under
   * a re-sync storm this alone grows the heap by gigabytes, which then trips the
   * memory watchdog, which evicts more graph nodes, which produces more of these
   * logs. Collapse the flood to one throttled, reference-free line.
   */
  private static installGunChainLogMuzzle(): void {
    if (this.chainLogMuzzleInstalled) return;
    if (typeof console === 'undefined') return;
    this.chainLogMuzzleInstalled = true;

    const originalLog = console.log.bind(console);
    let suppressed = 0;
    let lastReport = 0;
    const REPORT_INTERVAL_MS = 10_000;

    // Both of these are the same benign eviction artifact: when a graph node is
    // evicted while its chain still has a pending get/listener, later updates are
    // emitted with `'>': undefined`, and Gun logs either "chain not yet supported
    // for" (input()) or "Invalid get request!" (get()). Neither is an app bug —
    // no caller is passing an undefined key — so collapse both floods together.
    const isEvictionArtifact = (first: unknown): boolean =>
      typeof first === 'string' &&
      (first.startsWith('chain not yet supported for') ||
        first.startsWith('Invalid get request!'));

    console.log = (...args: unknown[]) => {
      if (isEvictionArtifact(args[0])) {
        suppressed++;
        const now = Date.now();
        if (now - lastReport > REPORT_INTERVAL_MS) {
          lastReport = now;
          originalLog(`[GunService] suppressed ${suppressed} Gun eviction-artifact logs`);
          suppressed = 0;
        }
        return;
      }
      originalLog(...args);
    };
  }

  private static installGunWarningTrace(): void {
    if (this.gunWarningTraceInstalled) return;
    if (typeof window === 'undefined') return;
    if (window.localStorage.getItem('interpoll_sync_debug') !== 'true') return;

    const originalWarn = console.warn.bind(console);
    const originalLog = console.log.bind(console);

    const traceIfGunFloodWarning = (args: unknown[]): boolean => {
      try {
        const first = args[0];
        if (typeof first === 'string' && first.includes('syncing 1K+ records a second')) {
          originalWarn(...args);
          originalWarn('[SyncDebug] Gun warning trace', new Error('Gun warning origin trace').stack);
          return true;
        }
      } catch {
        // keep original warn behavior on any tracing failure
      }
      return false;
    };

    console.warn = (...args: unknown[]) => {
      if (traceIfGunFloodWarning(args)) return;
      originalWarn(...args);
    };

    console.log = (...args: unknown[]) => {
      if (traceIfGunFloodWarning(args)) return;
      originalLog(...args);
    };

    this.gunWarningTraceInstalled = true;
    originalWarn('[SyncDebug] Gun warning trace enabled');
  }

  static getGun() {
    if (!this.gun) this.initialize();
    return this.proxiedGun;
  }

  static getRawGun() {
    if (!this.gun) this.initialize();
    return this.gun;
  }

  static getUser() {
    if (!this.user) this.initialize();
    return this.user;
  }

  /** Track open-time latency by watching Gun peer WebSocket open events */
  private static trackPeerLatency(peers: string[]) {
    for (const url of peers) {
      this.peerConnectTime.set(url, performance.now());
    }
    // Gun creates peers lazily — poll after a short delay for WS objects
    setTimeout(() => {
      try {
        const gunPeers = this.gun?._.opt?.peers || {};
        for (const [, peer] of Object.entries(gunPeers) as [string, any][]) {
          const peerUrl: string = peer?.id || peer?.url || '';
          if (!peerUrl) continue;
          const connectStart = this.peerConnectTime.get(peerUrl) ?? performance.now();
          const ws: WebSocket | undefined = peer?.wire;
          if (!ws) continue;
          if (ws.readyState === 1) {
            this.peerLatency.set(peerUrl, Math.round(performance.now() - connectStart));
          }
          ws.addEventListener('open', () => {
            this.peerLatency.set(peerUrl, Math.round(performance.now() - connectStart));
          }, { once: true });
        }
      } catch { /* best-effort */ }
    }, 2000);
  }

  /**
   * Probes every preset URL concurrently at startup via WebSocket (5 s timeout).
   * Gun relays speak WebSocket — HTTP GET probes give false results (404 on valid relays).
   * Live peers are added to Gun dynamically and saved to localStorage.
   * Results are stored in `presetProbeResults` for the network UI.
   */
  static async probePresetsAndExpand(): Promise<void> {
    if (this.presetProbeRunning) return;
    this.presetProbeRunning = true;
    try {
      const { GUN_RELAY_PRESETS } = await import('./gunRelayPresets');
      const existing = new Set(config.getGunPeers());

      for (const { url } of GUN_RELAY_PRESETS) {
        this.presetProbeResults.set(url, 'pending');
      }

      const probeOneWs = (url: string): Promise<boolean> => {
        return new Promise(resolve => {
          const wsUrl = url.replace(/^https:\/\//, 'wss://').replace(/^http:\/\//, 'ws://');
          const start = performance.now();
          let done = false;
          const finish = (live: boolean) => {
            if (done) return;
            done = true;
            if (live) {
              this.peerConnectTime.set(url, start);
              this.peerLatency.set(url, Math.round(performance.now() - start));
            }
            resolve(live);
          };
          try {
            const ws = new WebSocket(wsUrl);
            const timer = setTimeout(() => { ws.close(); finish(false); }, 5000);
            ws.onopen = () => { clearTimeout(timer); ws.close(); finish(true); };
            ws.onerror = () => { clearTimeout(timer); finish(false); };
          } catch {
            finish(false);
          }
        });
      };

      const entries = GUN_RELAY_PRESETS.map(p => p.url);
      const results = await Promise.allSettled(
        entries.map(async url => ({ url, live: await probeOneWs(url) }))
      );

      const liveUrls: string[] = [];
      for (const r of results) {
        if (r.status === 'fulfilled') {
          const { url, live } = r.value;
          this.presetProbeResults.set(url, live ? 'live' : 'dead');
          if (live && !existing.has(url)) liveUrls.push(url);
        }
      }

      for (const url of liveUrls) {
        this.addPeerDynamic(url);
      }

      if (liveUrls.length > 0) {
        const merged = [...existing, ...liveUrls];
        config.setGunPeers(merged);
      }

      const liveCount = liveUrls.length + [...existing].filter(u => this.presetProbeResults.get(u) === 'live').length;
      console.info(`[GunService] Probe complete: ${liveUrls.length} new live peers added (${liveCount} total live)`);
    } finally {
      this.presetProbeRunning = false;
    }
  }

  /** Dynamically add a peer to the running Gun instance without full reconnect */
  static addPeerDynamic(url: string): void {
    if (!this.gun) return;
    try {
      this.gun.opt({ peers: [url] });
      if (!this.peerConnectTime.has(url)) {
        this.peerConnectTime.set(url, performance.now());
      }
    } catch { /* ignore */ }
  }

  /**
   * Add a new peer at runtime and persist it via config so it reconnects on reload.
   * Immediately connects — no restart required.
   */
  static addPeer(peerUrl: string): void {
    config.addGunPeer(peerUrl);
    this.addPeerDynamic(peerUrl);
    _peerHealth.set(peerUrl, { url: peerUrl, lastSeenMs: 0, latencyMs: null, failures: 0, connected: false });
  }

  /**
   * Remove a user-added peer (persists the removal).
   * Note: Gun doesn't support disconnecting a peer without reinitialising.
   * The peer will be dropped on the next full reconnect().
   */
  static removePeer(peerUrl: string): void {
    config.removeGunPeer(peerUrl);
    _peerHealth.delete(peerUrl);
  }


  static reconnect(newPeerUrls?: string | string[]) {
    const peers: string[] = newPeerUrls
      ? (Array.isArray(newPeerUrls) ? newPeerUrls : [newPeerUrls])
      : config.getGunPeers();

    // Close existing peer WebSockets before discarding the instance. Only close
    // sockets that are actually OPEN or still CONNECTING — calling close() on an
    // already CLOSING/CLOSED socket (or letting Gun keep sending against it)
    // produces a flood of "WebSocket is already in CLOSING or CLOSED state".
    if (this.gun?._.opt?.peers) {
      for (const peer of Object.values(this.gun._.opt.peers) as any[]) {
        try {
          const wire = peer?.wire;
          if (wire && (wire.readyState === 0 || wire.readyState === 1)) wire.close();
        } catch { /* ignore */ }
      }
    }
    // Strip the discarded instance down to an empty shell *before* dropping our
    // reference to it. Callers all over the app hold long-lived chains built from
    // this root (postActiveListeners, pollActiveListeners, chat/discovery subs,
    // HomePage's map().on handles). Those chains keep `root` — and therefore
    // `root.graph` and `root.next` — reachable, so simply nulling `this.gun`
    // leaks the entire in-memory graph on every reconnect. With `radisk` and
    // `localStorage` disabled the graph is the whole dataset, so each reconnect
    // used to double the heap: pressure → watchdog reset → old graph retained +
    // new graph re-synced → more pressure.
    this.dismantleRoot(this.gun);

    this.isInitialized = false;
    this.gun = null;
    this.proxiedGun = null;
    this.user = null;
    this.peerLatency.clear();
    this.peerConnectTime.clear();

    this.gun = Gun({
      peers,
      localStorage: false,
      radisk: false,
      axe: false,
      wait: 250,
      chunk: 150,
    });
    this.trackPeerLatency(peers);
    const nsNode = this.gun.get(GUN_NAMESPACE);
    this.proxiedGun = createNamespacedProxy(this.gun, nsNode);
    this.user = this.gun.user();
    this.isInitialized = true;

    // The old root's 'out' handler died with it — re-install the bridge against
    // the new one so mesh peers keep receiving our wire traffic.
    if (this.wireBridgeSend) this.installWireBridge();

    // Notify subscribers so they can re-attach to the freshly-built instance —
    // otherwise Gun-bound `.on()` handlers (signaling inbox, discovery, rendezvous)
    // stay bound to the discarded instance and silently stop firing.
    for (const cb of this.reconnectListeners) {
      try { cb(); } catch { /* a bad listener must not break reconnect */ }
    }

    return this.proxiedGun;
  }

  /**
   * Empty out a Gun instance that is about to be discarded.
   *
   * Anything the app still holds a chain to will keep the root object itself
   * alive — that is unavoidable without rewriting every subscriber — but a root
   * whose graph, chain table, dedup table and event tags have been cleared costs
   * a few hundred bytes instead of the whole dataset. Detaching each chain first
   * also stops orphaned handlers from firing against a dead wire.
   */
  private static dismantleRoot(gun: any): void {
    const root = gun?._;
    if (!root) return;
    try {
      const next: Record<string, any> = root.next || {};
      for (const soul of Object.keys(next)) {
        try { next[soul]?.off?.(); } catch { /* best-effort detach */ }
        delete next[soul];
      }
    } catch { /* best-effort */ }
    try {
      if (root.graph) for (const soul of Object.keys(root.graph)) delete root.graph[soul];
    } catch { /* best-effort */ }
    try {
      // Message-id dedup table — one entry per wire message ever seen.
      if (root.dup?.s) root.dup.s = {};
    } catch { /* best-effort */ }
    try {
      // Event tags ('in', 'out', 'put', …). The listeners registered here are the
      // last thing holding closures over the old graph.
      if (root.tag) for (const tag of Object.keys(root.tag)) delete root.tag[tag];
    } catch { /* best-effort */ }
    try {
      if (root.opt?.peers) for (const id of Object.keys(root.opt.peers)) delete root.opt.peers[id];
    } catch { /* best-effort */ }
    try { root.stop = true; } catch { /* best-effort */ }
  }

  /**
   * Register a callback fired after every reconnect() rebuilds the Gun instance.
   * Used by Gun-bound subscribers (signaling inbox, discovery, rendezvous) to
   * re-subscribe against the new instance. Returns an unsubscribe function.
   */
  static onReconnect(cb: () => void): () => void {
    this.reconnectListeners.add(cb);
    return () => { this.reconnectListeners.delete(cb); };
  }

  static getPeerStats(): { isConnected: boolean; peerCount: number; connectedCount: number; avgLatencyMs?: number } {
    if (typeof window === 'undefined') return { isConnected: false, peerCount: 0, connectedCount: 0 };
    if (!this.gun) {
      try { this.initialize(); } catch { return { isConnected: false, peerCount: 0, connectedCount: 0 }; }
    }
    try {
      const peers = this.gun?._.opt?.peers || {};
      const allPeers = Object.values(peers) as any[];
      const activePeers = allPeers.filter((peer: any) => peer?.wire?.readyState === 1);
      const latencies = activePeers
        .map((peer: any) => this.peerLatency.get(peer?.id || peer?.url || ''))
        .filter((l): l is number => l !== undefined);
      const avgLatencyMs = latencies.length
        ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
        : undefined;
      return {
        isConnected: activePeers.length > 0,
        peerCount: allPeers.length,
        connectedCount: activePeers.length,
        avgLatencyMs,
      };
    } catch {
      return { isConnected: false, peerCount: 0, connectedCount: 0 };
    }
  }

  /** Returns per-peer connection details for the network UI */
  static getDetailedPeerStats(): GunPeerDetail[] {
    if (!this.gun) return [];
    try {
      const peers = this.gun?._.opt?.peers || {};
      return Object.values(peers).map((peer: any) => {
        const url: string = peer?.id || peer?.url || 'unknown';
        const connected = peer?.wire?.readyState === 1;
        const latencyMs = this.peerLatency.get(url);
        return { url, connected, latencyMs };
      });
    } catch {
      return [];
    }
  }

  static async put(path: string, data: any): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.getGun().get(path).put(data, (ack: any) => {
          if (ack.err) reject(ack.err);
          else resolve();
        });
      } catch (error) { reject(error); }
    });
  }

  static async get(path: string): Promise<any> {
    return new Promise((resolve) => {
      try {
        this.getGun().get(path).once((data: any) => resolve(data));
      } catch { resolve(null); }
    });
  }

  /** Subscribe to a path. Returns an unsubscribe function — call it on teardown,
   *  otherwise the chain (and the graph it reaches) lives for the session. */
  static subscribe(path: string, callback: (data: any) => void): () => void {
    try {
      const chain = this.getGun().get(path);
      chain.on(callback);
      return () => { try { chain.off(); } catch { /* already detached */ } };
    } catch {
      return () => {};
    }
  }

  // Throttled map — prevents 1K+ records/sec DOM warning
  /** Returns an unsubscribe function; it also cancels any pending flush timer. */
  static map(path: string, callback: (data: any) => void): () => void {
    const batch: any[] = [];
    let timer: ReturnType<typeof setTimeout> | null = null;

    const flush = () => {
      if (batch.length > 0) batch.splice(0).forEach(data => callback(data));
    };

    try {
      const chain = this.getGun().get(path).map();
      chain.on((data: any) => {
        if (!data || data._) return;
        batch.push(data);
        if (timer) clearTimeout(timer);
        timer = setTimeout(flush, 100);
        if (batch.length >= 50) { if (timer) clearTimeout(timer); flush(); }
      });
      return () => {
        if (timer) { clearTimeout(timer); timer = null; }
        batch.length = 0;
        try { chain.off(); } catch { /* already detached */ }
      };
    } catch {
      return () => {};
    }
  }

  /**
   * Bridge Gun's wire protocol over an arbitrary transport (used for the WebRTC
   * mesh). Outbound Gun messages are forwarded through `send`; call the returned
   * `receive` with messages arriving from peers. Gun's own CRDT + message-id
   * dedup handle conflict resolution and convergence, so content (polls, posts,
   * comments) replicates P2P with no Gun relay. A bounded seen-set guards against
   * trivially reflecting a message straight back to the network.
   */
  /**
   * Whether a Gun soul belongs to this app's namespace (or is a Gun/SEA system
   * soul). Souls are hierarchical path strings — `v3`, `v3/polls/<id>`,
   * `v3/communities/<cid>/polls/<pid>` — so a namespace prefix check is exact.
   * `~`/`_`-prefixed souls are SEA user-space / Gun internals and always allowed
   * (mirrors the keep-prefixes in evictCache).
   */
  static isInNamespaceSoul(soul: string): boolean {
    if (typeof soul !== 'string' || soul.length === 0) return false;
    if (soul === GUN_NAMESPACE || soul.startsWith(`${GUN_NAMESPACE}/`)) return true;
    return soul.startsWith('~') || soul.startsWith('_');
  }

  /**
   * Souls in a wire `put` message that fall outside the namespace. A Gun `put`
   * is `{ [soul]: node }`, so the souls are simply the keys. Returns [] for
   * non-put messages (handshakes, get requests, acks) — those carry no writes.
   */
  static outOfNamespaceSouls(msg: unknown): string[] {
    const put = (msg as any)?.put;
    if (!put || typeof put !== 'object') return [];
    const offenders: string[] = [];
    for (const soul of Object.keys(put)) {
      if (!this.isInNamespaceSoul(soul)) offenders.push(soul);
    }
    return offenders;
  }

  static attachWireBridge(
    send: (msg: unknown) => void,
    options?: { active?: () => boolean },
  ): { receive: (msg: unknown) => void } {
    this.wireBridgeSend = send;
    this.wireBridgeOptions = options;
    this.installWireBridge();
    // The handle is long-lived (the mesh registers it as a WebRTC message
    // handler for the session), so it must not close over a specific root —
    // otherwise instance #1 could never be collected and the bridge would go
    // silently dead after the first reconnect.
    return { receive: (msg: unknown) => this.wireBridgeReceive?.(msg) };
  }

  /** Bind the wire bridge to the current Gun root. Called on attach and again
   *  after every reconnect(). */
  private static installWireBridge(): void {
    const send = this.wireBridgeSend;
    if (!send) return;
    const options = this.wireBridgeOptions;
    if (!this.gun) this.initialize();
    const root = this.gun._;
    const seen = new Set<string>();
    const MAX_SEEN = 1000;
    const MAX_WIRE_BYTES = 256 * 1024;
    const isActive = options?.active;

    // Per-soul write-frequency guard: even in-namespace, a peer shouldn't be able
    // to flood a single soul (e.g. hammering one poll's counts). Bounded to keep
    // memory flat; counts decay by periodic reset of the window.
    const soulHits = new Map<string, number>();
    const SOUL_WINDOW_MS = 10_000;
    const MAX_SOUL_WRITES_PER_WINDOW = 60;
    let soulWindowStart = Date.now();
    const isSoulFlooding = (souls: string[]): boolean => {
      const now = Date.now();
      if (now - soulWindowStart > SOUL_WINDOW_MS) {
        soulHits.clear();
        soulWindowStart = now;
      }
      let flooding = false;
      for (const soul of souls) {
        const n = (soulHits.get(soul) || 0) + 1;
        soulHits.set(soul, n);
        if (n > MAX_SOUL_WRITES_PER_WINDOW) flooding = true;
      }
      return flooding;
    };

    const remember = (id: string) => {
      if (!id) return;
      seen.add(id);
      if (seen.size > MAX_SEEN) {
        const first = seen.values().next().value;
        if (first) seen.delete(first);
      }
    };

    root.on('out', function (this: any, msg: any) {
      this.to.next(msg); // preserve default outbound handling
      try {
        if (isActive && !isActive()) return; // no mesh peers — skip serialization work
        const id = msg && msg['#'];
        if (id && seen.has(id)) return; // just heard this from the mesh; don't echo it back
        const json = JSON.stringify(msg);
        if (json.length > MAX_WIRE_BYTES) return; // respect datachannel backpressure
        send(msg);
      } catch { /* best-effort */ }
    });

    this.wireBridgeReceive = (msg: unknown) => {
      try {
        const id = (msg as any)?.['#'];
        if (id) remember(id);

        // CRITICAL-2: an inbound put should only touch souls in our namespace.
        // Out-of-namespace souls are graph-pollution / forgery attempts from a
        // mesh peer. Behavior is gated so we can observe before enforcing.
        const mode = config.security.wireFilterMode;
        if (mode !== 'off') {
          const put = (msg as any)?.put;
          if (put && typeof put === 'object') {
            const souls = Object.keys(put);
            const offenders = souls.filter((s) => !this.isInNamespaceSoul(s));
            if (offenders.length > 0) {
              console.warn(
                `[GunService] wire put with ${offenders.length} out-of-namespace soul(s) [mode=${mode}]:`,
                offenders.slice(0, 5),
              );
              if (mode === 'enforce') return; // drop the whole message
            }
            if (mode === 'enforce' && isSoulFlooding(souls)) {
              console.warn('[GunService] dropping wire put — per-soul write flood');
              return;
            }
          }
        }

        root.on('in', msg);
      } catch { /* malformed wire message */ }
    };
  }

  static cleanup(): void {
    this.isInitialized = false;
  }

  static getGraphNodeCount(): number {
    if (!this.gun) return 0;
    try {
      const graph = this.gun._.graph;
      return graph && typeof graph === 'object' ? Object.keys(graph).length : 0;
    } catch { return 0; }
  }

  static evictCache(level: 'light' | 'aggressive' | 'emergency' = 'light'): void {
    if (!this.gun || this.evicting) return;
    this.evicting = true;

    try {
      const graph = this.gun._.graph;
      if (!graph || typeof graph !== 'object') return;

      const keys = Object.keys(graph);
      const totalBefore = keys.length;

      const keepPrefixes = ['~', '_'];

      let evictedCount = 0;

      // Gun keeps a *chain* per soul in `root.next` alongside the data in
      // `root.graph`. Deleting a graph node while its chain is still live leaves
      // the chain with no `put`, so every subsequent child update is emitted with
      // `'>': undefined` — Gun then fails to convert it, logs "chain not yet
      // supported", and drops the data. Subscribers never resolve, re-request,
      // and the relay re-sends everything ("syncing 1K+ records a second"), which
      // grows the heap far faster than the eviction shrank it. So: never evict a
      // soul whose chain still has listeners, and always drop chain + graph
      // together (the chain is where the retained memory actually lives).
      const root: any = this.gun._;
      const next: Record<string, any> = root.next || {};
      const hasLiveListeners = (soul: string): boolean => {
        const chain = next[soul];
        // `onto` deletes the tag when its last listener detaches, so the presence
        // of an `in` tag means at least one handler is still attached.
        return !!(chain && chain.tag && chain.tag.in);
      };
      const evict = (key: string) => {
        delete graph[key];
        delete next[key];
        evictedCount++;
      };

      if (level === 'emergency') {
        const keepRoots = new Set([
          GUN_NAMESPACE,
          `${GUN_NAMESPACE}/communities`,
          `${GUN_NAMESPACE}/posts`,
          `${GUN_NAMESPACE}/polls`,
          `${GUN_NAMESPACE}/users`,
        ]);
        // At emergency severity, a soul with a live `.map().on()` listener (e.g. a
        // whole-feed subscription) would otherwise be permanently eviction-immune —
        // on pages that subscribe broadly, that made eviction a total no-op and the
        // heap climbed until the tab crashed. Force-detach the chain and evict
        // anyway; staying alive matters more than one subscriber missing an update.
        for (const key of keys) {
          if (keepRoots.has(key) || keepPrefixes.some(p => key.startsWith(p))) continue;
          if (hasLiveListeners(key)) {
            try { next[key]?.off?.(); } catch { /* best-effort detach */ }
          }
          evict(key);
        }
      } else if (level === 'aggressive') {
        const keepRoots = new Set([
          GUN_NAMESPACE,
          `${GUN_NAMESPACE}/communities`,
          `${GUN_NAMESPACE}/posts`,
          `${GUN_NAMESPACE}/polls`,
          `${GUN_NAMESPACE}/users`,
        ]);
        for (const key of keys) {
          if (keepRoots.has(key) || keepPrefixes.some(p => key.startsWith(p))) continue;
          if (hasLiveListeners(key)) continue;
          if (key.includes('/')) evict(key);
        }
      } else {
        const MAX_NODES = 2000;
        if (totalBefore > MAX_NODES) {
          const toEvict = keys.slice(0, totalBefore - MAX_NODES);
          for (const key of toEvict) {
            if (keepPrefixes.some(p => key.startsWith(p))) continue;
            if (hasLiveListeners(key)) continue;
            evict(key);
          }
        }
      }

      if (evictedCount > 0) {
        console.info(`[GunService] Evicted ${evictedCount}/${totalBefore} graph nodes (${level})`);
      }
    } catch (e) {
      console.warn('[GunService] Cache eviction error:', e);
    } finally {
      this.evicting = false;
    }
  }
}