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

// Defaults always point to Render URLs
const defaults = {
  websocket: 'wss://interpoll.onrender.com',
  gun: 'https://interpoll2.onrender.com/gun',
  api: 'https://interpoll.onrender.com',
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

  /** Server-wide encryption settings (mutable at runtime) */
  encryption: {
    /** Whether all content should be encrypted by default */
    get encryptAll() { return encryptionConfig.encryptAll ?? false; },
    /** Password for server-wide encryption (used to derive AES key) */
    get serverPassword() { return encryptionConfig.serverPassword; },
    /** Whether new users need an invite link to access the server */
    get requireInviteToJoin() { return encryptionConfig.requireInviteToJoin ?? false; },
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
};

export default config;
