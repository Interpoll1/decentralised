import type { PlatformCapabilities } from '../types';

/**
 * What the browser build can do.
 *
 * Every `false` here is a structural limit of the web platform, not a missing
 * feature: a tab cannot relay once closed, IndexedDB is quota-bound, and — see
 * the Anonymity Mode note in `src/config.ts` — a web app cannot route its own
 * traffic through Tor, which is why that mode subtracts capability (kills
 * WebRTC/STUN so nothing leaks around Tor Browser) rather than adding it.
 */
export const capabilities: PlatformCapabilities = {
  name: 'web',
  canSeed: false,
  unlimitedStorage: false,
  directP2P: true, // WebRTC only, and only while the tab is open
  protectedKeys: false,
  tor: false,
};

export default capabilities;
