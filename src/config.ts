/**
 * Centralised application configuration.
 *
 * Every value can be overridden at runtime via Settings/localStorage.
 * Defaults always point to Render deployment URLs.
 *
 * Usage:
 *   import config from '@/config';
 *   const ws = new WebSocket(config.relay.websocket);
 */

const STORAGE_KEY = 'interpoll_relay_config';
const ENCRYPTION_STORAGE_KEY = 'interpoll_encryption_config';
// v3 — removed dead Heroku relays; existing installs get clean defaults
const GUN_PEERS_STORAGE_KEY = 'interpoll_gun_peers_v3';
// Dev-only: relax discovery/rendezvous endpoint-scheme validation so ws://localhost
// endpoints validate between two local browser profiles. HARD-GATED on a dev build
// (`import.meta.env.DEV`), so a production bundle ignores the flag entirely and an
// attacker cannot enable insecure endpoints by planting this localStorage key.
const DEV_INSECURE_DISCOVERY_KEY = 'interpoll_rdv_dev_insecure';
const ICE_SERVERS_STORAGE_KEY = 'interpoll_ice_servers';
const IDENTITY_CONFIG_STORAGE_KEY = 'interpoll_identity_config';
const WIRE_FILTER_STORAGE_KEY = 'interpoll_wire_filter_mode';

/**
 * How the WebRTC mesh wire bridge treats inbound Gun `put`s whose souls fall
 * outside GUN_NAMESPACE (CRITICAL-2 mesh hardening):
 * - `off`     — no checking (legacy behavior).
 * - `log`     — inject as before, but console.warn each out-of-namespace soul.
 *   The default: lets us observe real sync traffic before enforcing.
 * - `enforce` — drop any message touching an out-of-namespace soul.
 * Flip to `enforce` once `log` mode shows real P2P traffic produces no warnings.
 */
export type WireFilterMode = 'off' | 'log' | 'enforce';

function loadWireFilterMode(): WireFilterMode {
  try {
    const raw = localStorage.getItem(WIRE_FILTER_STORAGE_KEY);
    if (raw === 'off' || raw === 'log' || raw === 'enforce') return raw;
  } catch {
    // Storage unavailable; fall through to default.
  }
  return 'log';
}

let wireFilterMode: WireFilterMode = loadWireFilterMode();

/**
 * Anonymity (Tor) Mode.
 *
 * A browser web app cannot route its own traffic through Tor — only Tor Browser
 * or a system Tor proxy / Orbot can. What this flag does is make the app SAFE to
 * use over Tor by killing the vectors that would otherwise reveal the user's real
 * IP despite Tor:
 *   - `getIceServers()` returns `[]`, so no `RTCPeerConnection` can gather
 *     server-reflexive (real-IP) candidates via STUN.
 *   - `WebRTCService` refuses to enable/connect (see webrtcService.ts), which
 *     tears down the peer mesh — WebRTC leaks the real IP even inside Tor Browser,
 *     which is exactly why Tor Browser disables it.
 * Relay (WSS/Gun/API) traffic is unaffected: inside Tor Browser it is already
 * proxied through Tor, and the UI prefers `.onion` relays when available.
 */
const ANONYMITY_MODE_KEY = 'interpoll_anonymity_mode';
function loadAnonymityMode(): boolean {
  try {
    return localStorage.getItem(ANONYMITY_MODE_KEY) === 'true';
  } catch {
    return false;
  }
}
let anonymityMode: boolean = loadAnonymityMode();

const RELAY_ATT_PUBKEY_STORAGE_KEY = 'interpoll_relay_attestation_pubkey';
function loadRelayAttestationPubkey(): string {
  try { return localStorage.getItem(RELAY_ATT_PUBKEY_STORAGE_KEY) || ''; } catch { return ''; }
}
let relayAttestationPubkey: string = loadRelayAttestationPubkey();

// Diverse public STUN across independent providers, so no single vendor outage
// blocks NAT traversal. Users can add a TURN entry via setIceServers() for
// symmetric-NAT / restrictive-firewall cases where STUN alone can't connect.
const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'stun:global.stun.twilio.com:3478' },
  { urls: 'stun:stun.nextcloud.com:443' },
];

function loadIceServers(): RTCIceServer[] | null {
  try {
    const raw = localStorage.getItem(ICE_SERVERS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {
    // Corrupted data; ignore
  }
  return null;
}

let iceServers: RTCIceServer[] | null = loadIceServers();

type IdentityPrimaryKey = 'deviceId' | 'pubkey';

interface IdentityConfig {
  primaryKey?: IdentityPrimaryKey;
}

function loadIdentityConfig(): IdentityConfig {
  try {
    const raw = localStorage.getItem(IDENTITY_CONFIG_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // Corrupted data; ignore
  }
  return {};
}

let identityConfig: IdentityConfig = loadIdentityConfig();

interface RelayOverrides {
  websocket?: string;
  gun?: string;
  api?: string;
}

interface EncryptionConfig {
  encryptAll?: boolean;
  serverPassword?: string;
  requireInviteToJoin?: boolean;
}

function loadOverrides(): RelayOverrides {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // Corrupted data; ignore
  }
  return {};
}

function loadGunPeers(): string[] | null {
  try {
    const raw = localStorage.getItem(GUN_PEERS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {
    // Corrupted data; ignore
  }
  return null;
}

// Defaults always point to Render URLs
//const defaults = {
//  websocket: 'wss://interpoll.onrender.com',
 // gun: 'https://interpoll2.onrender.com/gun',
 // api: 'https://interpoll.onrender.com',
//};

// Defaults point to VPS
const defaults = {
  websocket: 'wss://interpoll.endless.sbs',
  gun: 'https://interpoll2.endless.sbs/gun',
  api: 'https://interpoll.endless.sbs',
};

// Canonical public web origin where the browser build of the app is hosted.
// Used to construct shareable links from the native app (see config.web).
const WEB_ORIGIN = 'https://endless.sbs';
function loadEncryptionConfig(): EncryptionConfig {
  try {
    const raw = localStorage.getItem(ENCRYPTION_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // Corrupted data; ignore
  }
  return {};
}

let overrides = loadOverrides();
let encryptionConfig = loadEncryptionConfig();
let gunPeers: string[] | null = loadGunPeers();

function ws(): string {
  return overrides.websocket || defaults.websocket;
}
function gun(): string {
  return overrides.gun || defaults.gun;
}
function api(): string {
  return overrides.api || defaults.api;
}

const config = {
  /** Network relay endpoints (mutable at runtime) */
  relay: {
    get websocket() { return ws(); },
    get gun() { return gun(); },
    get api() { return api(); },
  },

  /** Trusted backend origin for auth/session-gated requests */
  auth: {
    get api() { return defaults.api; },
  },

  /**
   * Canonical public web origin for the app. Used to build shareable links.
   * In a browser this is just the current origin, but inside the native
   * (Capacitor) shell `window.location.origin` is `https://localhost`, which
   * is not a real, openable link — so native shares must use this instead.
   */
  web: {
    get origin() { return WEB_ORIGIN; },
  },

  /** Server-wide encryption settings (mutable at runtime) */
  encryption: {
    /** Whether all content should be encrypted by default */
    get encryptAll() { return encryptionConfig.encryptAll ?? false; },
    /** Password for server-wide encryption (used to derive AES key) */
    get serverPassword() { return encryptionConfig.serverPassword; },
    /** Whether new users need an invite link to access the server */
    get requireInviteToJoin() { return encryptionConfig.requireInviteToJoin ?? false; },
  },

  /**
   * Identity model rollout (protocol formalization, Phase 2).
   * During the migration window this stays 'deviceId' — profiles are keyed by
   * device fingerprint, and the pubkey is authoritative only for identity
   * *comparisons*. Flip to 'pubkey' once the by-pubkey index has converged in a
   * deployment. See src/services/userService.ts and docs/protocol/IPP-01-identity.md.
   */
  identity: {
    get primaryKey(): IdentityPrimaryKey { return identityConfig.primaryKey || 'deviceId'; },
  },

  /** Set which key is authoritative for actor identity ('deviceId' | 'pubkey'). */
  setIdentityPrimaryKey(key: IdentityPrimaryKey) {
    identityConfig = { ...identityConfig, primaryKey: key };
    try { localStorage.setItem(IDENTITY_CONFIG_STORAGE_KEY, JSON.stringify(identityConfig)); } catch { /* ignore */ }
  },

  /** Mesh wire-bridge filtering mode for inbound out-of-namespace Gun puts. */
  security: {
    get wireFilterMode(): WireFilterMode { return wireFilterMode; },
    /**
     * x-only Schnorr public key (hex) the relay uses to sign vote attestations
     * (Sybil-resistance `relay` tier). Empty until the relay publishes one and
     * it is configured here — until then relay-attested votes cannot be verified
     * and simply fall to a lower tier. See voteTierService.ts.
     */
    get relayAttestationPubkey(): string { return relayAttestationPubkey; },
  },

  /**
   * Anonymity (Tor) Mode. When true, all IP-leaking transports are shut off
   * (WebRTC/STUN) so the app is safe to use over Tor Browser. See the
   * ANONYMITY_MODE_KEY block above for the full rationale.
   */
  get anonymityMode(): boolean { return anonymityMode; },

  /** Enable/disable Anonymity (Tor) Mode. Persisted to localStorage. */
  setAnonymityMode(on: boolean) {
    anonymityMode = !!on;
    try {
      if (anonymityMode) localStorage.setItem(ANONYMITY_MODE_KEY, 'true');
      else localStorage.removeItem(ANONYMITY_MODE_KEY);
    } catch { /* storage unavailable */ }
  },

  /** Set the relay's vote-attestation public key (hex). */
  setRelayAttestationPubkey(pubkeyHex: string) {
    relayAttestationPubkey = pubkeyHex || '';
    try {
      if (relayAttestationPubkey) localStorage.setItem(RELAY_ATT_PUBKEY_STORAGE_KEY, relayAttestationPubkey);
      else localStorage.removeItem(RELAY_ATT_PUBKEY_STORAGE_KEY);
    } catch { /* ignore */ }
  },

  /** Set the mesh wire-bridge filter mode ('off' | 'log' | 'enforce'). */
  setWireFilterMode(mode: WireFilterMode) {
    wireFilterMode = mode;
    try { localStorage.setItem(WIRE_FILTER_STORAGE_KEY, mode); } catch { /* ignore */ }
  },

  /** Default (build-time) relay URLs */
  defaults,

  /** Save runtime relay overrides and return the new active values */
  setRelayOverrides(partial: RelayOverrides) {
    overrides = { ...overrides, ...partial };
    // Strip empty strings so defaults apply
    for (const key of Object.keys(overrides) as (keyof RelayOverrides)[]) {
      if (!overrides[key]) delete overrides[key];
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
  },

  /** Clear all runtime overrides and revert to build-time defaults */
  resetRelayOverrides() {
    overrides = {};
    localStorage.removeItem(STORAGE_KEY);
  },

  /** Get current overrides (if any) */
  getRelayOverrides(): RelayOverrides {
    return { ...overrides };
  },

  /**
   * Get the active Gun peer list.
   * Falls back to DEFAULT_GUN_PEERS (imported lazily to avoid circular deps at module load).
   */
  getGunPeers(): string[] {
    if (gunPeers && gunPeers.length > 0) return [...gunPeers];
    return [
      defaults.gun,
      'https://relay.peer.ooo/gun',
    ];
  },

  /** Persist a new Gun peer list */
  setGunPeers(urls: string[]) {
    gunPeers = urls.filter(u => !!u.trim());
    if (gunPeers.length === 0) {
      gunPeers = null;
      localStorage.removeItem(GUN_PEERS_STORAGE_KEY);
    } else {
      localStorage.setItem(GUN_PEERS_STORAGE_KEY, JSON.stringify(gunPeers));
    }
  },

  /** Reset Gun peers to built-in defaults */
  resetGunPeers() {
    gunPeers = null;
    localStorage.removeItem(GUN_PEERS_STORAGE_KEY);
  },

  /** Check if server-wide encryption is active */
  isServerEncrypted(): boolean {
    return this.encryption.encryptAll;
  },

  /** Update encryption settings */
  setEncryptionConfig(partial: EncryptionConfig) {
    encryptionConfig = { ...encryptionConfig, ...partial };
    for (const key of Object.keys(encryptionConfig) as (keyof EncryptionConfig)[]) {
      if (encryptionConfig[key] === undefined || encryptionConfig[key] === '') delete encryptionConfig[key];
    }
    localStorage.setItem(ENCRYPTION_STORAGE_KEY, JSON.stringify(encryptionConfig));
  },

  /** Clear encryption settings */
  resetEncryptionConfig() {
    encryptionConfig = {};
    localStorage.removeItem(ENCRYPTION_STORAGE_KEY);
  },

  /** Get current encryption config */
  getEncryptionConfig(): EncryptionConfig {
    return { ...encryptionConfig };
  },

  /**
   * Dev-only escape hatch: when true, discovery/rendezvous accepts insecure
   * (`ws://` / `http://`) endpoints so the rendezvous path can be exercised
   * locally between two browser profiles. Always false in a production build —
   * `import.meta.env.DEV` is compile-time `false` there, so the localStorage flag
   * has no effect and cannot be abused to inject non-TLS endpoints.
   */
  get allowInsecureDiscovery(): boolean {
    if (!import.meta.env.DEV) return false;
    try {
      return localStorage.getItem(DEV_INSECURE_DISCOVERY_KEY) === 'true';
    } catch {
      return false;
    }
  },

  /** Toggle the dev-only insecure-discovery flag (no-op in production builds). */
  setAllowInsecureDiscovery(value: boolean) {
    if (!import.meta.env.DEV) return;
    try {
      if (value) localStorage.setItem(DEV_INSECURE_DISCOVERY_KEY, 'true');
      else localStorage.removeItem(DEV_INSECURE_DISCOVERY_KEY);
    } catch {
      // Storage unavailable — nothing to persist.
    }
  },

  /** WebRTC ICE servers (STUN/TURN). Falls back to the diverse default STUN set. */
  getIceServers(): RTCIceServer[] {
    // Anonymity Mode: never hand out STUN/TURN. Any RTCPeerConnection built with
    // an empty ICE list cannot gather server-reflexive candidates, so it cannot
    // leak the user's real public IP while they believe they are anonymous.
    if (anonymityMode) return [];
    if (iceServers && iceServers.length > 0) return [...iceServers];
    return [...DEFAULT_ICE_SERVERS];
  },

  /** Override ICE servers (e.g. to add a TURN server). Empty/undefined resets to default. */
  setIceServers(servers: RTCIceServer[] | null | undefined) {
    if (!servers || servers.length === 0) {
      iceServers = null;
      try { localStorage.removeItem(ICE_SERVERS_STORAGE_KEY); } catch { /* ignore */ }
      return;
    }
    iceServers = servers;
    try { localStorage.setItem(ICE_SERVERS_STORAGE_KEY, JSON.stringify(servers)); } catch { /* ignore */ }
  },

  /** Reset ICE servers to the built-in diverse STUN default. */
  resetIceServers() {
    iceServers = null;
    try { localStorage.removeItem(ICE_SERVERS_STORAGE_KEY); } catch { /* ignore */ }
  },

  /** The built-in default ICE servers (for UI reset/display). */
  getDefaultIceServers(): RTCIceServer[] {
    return [...DEFAULT_ICE_SERVERS];
  },
};

export default config;
