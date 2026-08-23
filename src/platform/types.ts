/**
 * The platform-adapter seam.
 *
 * One `src/` serves three targets — web (Vite+PWA), Android (Capacitor,
 * `CAP_BUILD=1`) and desktop (Tauri, `TAURI_BUILD=1`). Everything that differs
 * between them is expressed as one of the interfaces below and resolved through
 * the `@platform` alias, which Vite points at `src/platform/web` or
 * `src/platform/tauri` at BUILD time (see vite.config.ts).
 *
 * Build-time selection, not runtime branching: the web bundle then never ships
 * `@tauri-apps/api`, and the desktop bundle never ships the code paths it has
 * natively replaced. A runtime `if (isTauri)` would ship both to everyone.
 *
 * Nothing above this seam — no component, view, store, or service — may import
 * from `src/platform/web` or `src/platform/tauri` directly. Import `@platform/*`.
 */

/* ------------------------------------------------------------------ config */

/**
 * Settings transport.
 *
 * `src/config.ts` reads localStorage at module top level and is imported by ~29
 * files, so it MUST stay synchronous — making it async is a multi-week refactor
 * with a long tail of startup races. Instead the desktop build treats Rust as
 * the authoritative store and localStorage as a synchronously-readable mirror:
 * `hydrate()` runs to completion in `main.ts` BEFORE the app module graph is
 * dynamically imported, so by the time `config.ts` evaluates, the mirror is warm.
 */
export interface ConfigBackend {
  /**
   * Populate the synchronous localStorage mirror from the authoritative store.
   * Resolves before any module that imports `@/config` is evaluated.
   * On web this is a no-op: localStorage already *is* the source of truth.
   */
  hydrate(): Promise<void>;

  /**
   * Mirror a settings write back to the authoritative store. Fire-and-forget:
   * `config.ts`'s setters are synchronous and must stay that way, so this may
   * not reject into a caller. Failures are logged, never thrown.
   */
  save(key: string, value: string | null): void;

  /**
   * Extra Gun peers the platform wants tried FIRST. On desktop this is the
   * embedded relay hub (`ws://127.0.0.1:<port>`), reported by Rust during
   * `hydrate()`, so the app talks to its own relay before any remote one.
   * Empty on web.
   */
  preferredGunPeers(): string[];
}

/* ---------------------------------------------------------------- database */

/**
 * Opens the durable store and hands back a handle shaped like `idb`'s
 * `IDBPDatabase` — the surface `StorageService`'s ~30 static methods already
 * call (`get`/`put`/`getAll`/`getAllFromIndex`/`transaction`+cursors).
 *
 * Keeping the *existing* shape, rather than inventing a narrower one, is what
 * lets Phase 0 move storage behind the seam without touching a single one of
 * those methods or their 25 importers. The desktop build satisfies this with a
 * facade over SQLite; the browser satisfies it with real IndexedDB.
 *
 * `KvBackend` below is the narrower Phase-1 target, once the desktop backend is
 * real and the `idb` shape is no longer worth emulating.
 */
export interface DatabaseBackend {
  open(): Promise<import('idb').IDBPDatabase>;
  /** True when the opened store is volatile (no persistence across reloads). */
  readonly ephemeral: boolean;
}

/* --------------------------------------------------------------- key/value */

/**
 * Durable key/value storage — the shape `StorageService` actually needs from
 * IndexedDB, so its ~30 static methods can keep their exact signatures while
 * their bodies swap between `idb` (web) and SQLite (desktop).
 *
 * Store names match the existing IndexedDB object stores: blocks, votes,
 * receipts, polls, metadata, encryption-keys, comments, chat-messages.
 */
export interface KvBackend {
  get<T = any>(store: string, key: IDBValidKey): Promise<T | undefined>;
  getAll<T = any>(store: string): Promise<T[]>;
  getAllFromIndex<T = any>(store: string, index: string, query: IDBValidKey): Promise<T[]>;
  put(store: string, value: any, key?: IDBValidKey): Promise<void>;
  delete(store: string, key: IDBValidKey): Promise<void>;
  clear(store: string): Promise<void>;
  count(store: string): Promise<number>;
  /** True when the active store is volatile (no persistence). */
  readonly ephemeral: boolean;
}

/* ------------------------------------------------------------------ signal */

/**
 * The relay socket. `websocketService.ts` keeps all ~773 LOC of reconnect,
 * backoff, peer-address and discovery logic; only socket *construction* is
 * abstracted here.
 *
 * On desktop the socket lives in Rust, so it survives a webview reload and keeps
 * running while the window is hidden to tray — which is what makes always-on
 * seeding possible. The message envelope is byte-identical on both sides.
 */
export interface SignalSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  readonly readyState: number;
  onopen: ((ev?: any) => void) | null;
  onclose: ((ev?: any) => void) | null;
  onerror: ((ev?: any) => void) | null;
  onmessage: ((ev: { data: string }) => void) | null;
}

export interface SignalBackend {
  open(url: string): SignalSocket;
}

/* ------------------------------------------------------------------ signer */

/**
 * BIP-340 Schnorr signing over secp256k1.
 *
 * On desktop the private key never enters JS: it is sealed by the OS keychain
 * and signing happens in Rust. `exportPrivateKey` therefore MAY reject, and
 * callers must handle that rather than assuming key material is reachable.
 */
export interface SignerBackend {
  hasKey(): Promise<boolean>;
  getPublicKey(): Promise<string>;
  /** Sign a 32-byte message hash (hex) → 64-byte signature (hex). */
  sign(messageHashHex: string): Promise<string>;
  /** Rejects on desktop when the key is hardware-protected. */
  exportPrivateKey(): Promise<string>;
  importFromMnemonic(mnemonic: string): Promise<string>;
}

/* ------------------------------------------------------------------ search */

export interface SearchHit {
  id: string;
  type: 'post' | 'poll' | 'comment' | 'community' | 'chat';
  title?: string;
  snippet?: string;
  score?: number;
}

/**
 * Full-text search. Desktop answers from a local SQLite FTS5 index over the
 * complete history; web must ask the relay. Desktop still merges remote results
 * for content it has not synced, de-duplicated by id.
 */
export interface SearchBackend {
  /** null = this platform has no local index; fall back to the relay API. */
  searchLocal(query: string, limit?: number): Promise<SearchHit[] | null>;
  index(doc: { id: string; type: SearchHit['type']; text: string }): Promise<void>;
}

/* ------------------------------------------------------------------- graph */

/**
 * The Gun graph surface, as consumed through `gunService`'s namespaced Proxy.
 *
 * Deliberately NOT implemented natively in Phase 0-2. Gun-JS stays in the
 * webview as the API layer with `peers: []`, and the existing
 * `attachWireBridge()` hook — which already taps `root.on('out')` and re-injects
 * inbound messages — carries the wire traffic to Rust. This interface exists so
 * Stage B (dropping Gun-JS entirely) has a target, and is unused until then.
 */
export interface GraphBackend {
  get(path: string): GraphBackend;
  put(value: any): Promise<void>;
  once(cb: (data: any, key: string) => void): void;
  on(cb: (data: any, key: string) => void): () => void;
  map(): GraphBackend;
}

/* -------------------------------------------------------------- capability */

/**
 * What this build can actually do. Lets the UI show desktop-only affordances
 * (tray seeding, unlimited history, LAN peers, Tor) without sniffing user agents
 * or probing for `window.__TAURI__`.
 */
export interface PlatformCapabilities {
  readonly name: 'web' | 'tauri';
  /** Relays for other peers even when the window is closed. */
  readonly canSeed: boolean;
  /** No storage quota — full history is retained, pruning is disabled. */
  readonly unlimitedStorage: boolean;
  /** mDNS / QUIC / hole punching available without a relay. */
  readonly directP2P: boolean;
  /** Private key can be sealed outside JS reach. */
  readonly protectedKeys: boolean;
  /** Can route its own traffic over Tor and publish an onion service. */
  readonly tor: boolean;
}
