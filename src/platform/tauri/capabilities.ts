import type { PlatformCapabilities } from '../types';

/**
 * What the desktop build can do.
 *
 * These flags describe the SHIPPED state, so the UI never advertises an
 * affordance that does not work yet. Phase 0 is the shell only; each flag flips
 * to true in the phase that actually implements it:
 *
 *   canSeed          → Phase 3 (embedded axum relay hub, tray-resident)
 *   unlimitedStorage → Phase 1 (SQLite + FTS5, pruning disabled)
 *   protectedKeys    → Phase 4 (OS keychain, signing in Rust)
 *   tor              → Phase 6 (arti client + onion service)
 *
 * `directP2P` is true from the start because the webview's own WebRTC works
 * today; Phase 5 upgrades it to native QUIC + mDNS + hole punching.
 */
export const capabilities: PlatformCapabilities = {
  name: 'tauri',
  canSeed: false,
  unlimitedStorage: false,
  directP2P: true,
  protectedKeys: false,
  tor: false,
};

export default capabilities;
