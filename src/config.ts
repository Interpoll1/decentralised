/**
 * Centralised application configuration.
 *
 * Every value can be overridden at build-time through Vite environment
 * variables (prefixed with VITE_).  Defaults are tuned for local
 * development so the app works out-of-the-box without an .env file.
 *
 * Usage:
 *   import config from '@/config';
 *   const ws = new WebSocket(config.relay.websocket);
 */

const apiBase: string =
  import.meta.env.VITE_API_BASE_URL || 'http://localhost:8080';

const config = {
  /** Network relay endpoints */
  relay: {
    /** WebSocket relay used for real-time peer communication */
    websocket: (import.meta.env.VITE_WS_RELAY_URL as string) || 'ws://localhost:8080',

    /** GunDB relay peer URL */
    gun: (import.meta.env.VITE_GUN_RELAY_URL as string) || 'http://localhost:8765/gun',

    /** Base URL for the HTTP API (audit, auth, etc.) */
    api: apiBase,
  },

  /** OAuth / authentication endpoints (derived from relay.api) */
  auth: {
    googleStart: `${apiBase}/auth/google/start`,
    microsoftStart: `${apiBase}/auth/microsoft/start`,
  },
} as const;

export default config;
