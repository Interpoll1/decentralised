import type { ConfigBackend } from '../types';

/**
 * Web settings backend.
 *
 * localStorage IS the authoritative store in the browser, so hydration and
 * mirroring are both no-ops. The interface exists for the desktop build, where
 * Rust owns a settings file and localStorage is only a synchronous mirror.
 */
export const platformConfig: ConfigBackend = {
  async hydrate() {
    /* localStorage is already the source of truth. */
  },

  save() {
    /* Written directly by config.ts's setters. */
  },

  preferredGunPeers() {
    return [];
  },
};

export default platformConfig;
