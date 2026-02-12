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

interface RelayOverrides {
  websocket?: string;
  gun?: string;
  api?: string;
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

let overrides = loadOverrides();

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

  /** OAuth / authentication endpoints (derived from relay.api) */
  auth: {
    get googleStart() { return `${api()}/auth/google/start`; },
    get microsoftStart() { return `${api()}/auth/microsoft/start`; },
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
};

export default config;
