/**
 * Entry point.
 *
 * This file exists to guarantee ONE ordering property, and does nothing else.
 *
 * `src/config.ts` reads its settings from localStorage at module top level, and
 * ~29 modules import it — so by the time any of them evaluate, those values must
 * already be correct. In the browser that is free: localStorage IS the store.
 * In the desktop shell the authoritative store is a Rust-owned settings file,
 * and localStorage is only a synchronous mirror of it, so the mirror has to be
 * filled *before* the module graph loads.
 *
 * Hence the dynamic import: `await hydrate()` runs to completion, and only then
 * is `./bootstrap` — which transitively pulls in `@/config`, the router, every
 * store and every service — fetched and evaluated. A static import would be
 * hoisted above the await and the ordering would be lost.
 *
 * The alternative was making `config.ts` async. That is a multi-week refactor
 * across 29 modules with a long tail of startup races, to solve a problem two
 * lines of sequencing solve here.
 */
import { platformConfig } from '@platform/config';

async function start(): Promise<void> {
  try {
    await platformConfig.hydrate();
  } catch (err) {
    // Never block startup on settings. A failed hydrate leaves the previous
    // launch's mirrored values in place, which is a usable degraded state.
    console.warn('[Boot] Platform config hydrate failed; continuing with mirrored settings:', err);
  }

  await import('./bootstrap');
}

void start();
