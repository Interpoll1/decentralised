import { invoke } from '@tauri-apps/api/core';
import type { ConfigBackend } from '../types';

/**
 * Desktop settings backend.
 *
 * Rust owns `$APPDATA/interpoll/settings.json`; localStorage is a mirror that
 * exists purely so `src/config.ts` can stay synchronous. `config.ts` is imported
 * by ~29 modules and reads localStorage at module top level, so making it async
 * would mean auditing every one of them for startup races — this keeps that
 * whole class of bug from existing.
 *
 * Ordering guarantee: `hydrate()` is awaited in `src/main.ts` BEFORE the app
 * module graph is dynamically imported, so the mirror is warm by the time
 * `config.ts` first evaluates. Rust is authoritative and overwrites the mirror
 * on every launch, so a stale or hand-edited localStorage cannot win.
 */

/** Settings keys Rust mirrors into localStorage. Must match `config.ts`. */
const MIRRORED_KEYS = [
  'interpoll_relay_config',
  'interpoll_encryption_config',
  'interpoll_gun_peers_v3',
  'interpoll_ice_servers',
  'interpoll_identity_config',
  'interpoll_wire_filter_mode',
  'interpoll_anonymity_mode',
  'interpoll_relay_attestation_pubkey',
] as const;

interface SettingsSnapshot {
  /** key → raw string value, exactly as localStorage would hold it. */
  values: Record<string, string>;
  /** Port the embedded relay hub is listening on, or 0 before Phase 3. */
  hubPort: number;
}

let hubPort = 0;

export const platformConfig: ConfigBackend = {
  async hydrate() {
    try {
      const snapshot = await invoke<SettingsSnapshot>('settings_load');
      hubPort = snapshot.hubPort ?? 0;

      // Rust is authoritative: clear any mirrored key it did not supply, so a
      // setting removed on the Rust side cannot linger in the mirror.
      for (const key of MIRRORED_KEYS) {
        const value = snapshot.values?.[key];
        if (value === undefined || value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
      }
    } catch (err) {
      // A failed hydrate must not block startup — the app falls back to
      // whatever the mirror already holds, which is the previous launch's
      // settings. Degraded, but usable and non-destructive.
      console.warn('[Platform] Settings hydrate failed; using last-known mirror:', err);
    }
  },

  save(key, value) {
    // Fire-and-forget by contract: `config.ts`'s setters are synchronous and
    // cannot await, so this may never reject into a caller.
    void invoke('settings_save', { key, value }).catch((err) => {
      console.warn(`[Platform] Failed to persist setting "${key}":`, err);
    });
  },

  preferredGunPeers() {
    // Talk to our own embedded relay before any remote one. Phase 3 lights this
    // up; until the hub exists `hubPort` is 0 and we add nothing.
    return hubPort > 0 ? [`ws://127.0.0.1:${hubPort}/gun`] : [];
  },
};

export default platformConfig;
