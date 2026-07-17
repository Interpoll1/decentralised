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
