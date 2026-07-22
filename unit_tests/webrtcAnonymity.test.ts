import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import config from '@/config';
import { WebRTCService } from '@/services/webrtcService';

/**
 * WebRTCService is the single choke point that keeps every caller (mesh reconcile,
 * blackout recovery, manual QR) leak-safe under Anonymity (Tor) Mode: it refuses
 * to enable or open any peer connection while the mode is on.
 */
function installLocalStorage(): void {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => { store.clear(); },
  };
}

describe('WebRTCService under anonymity mode', () => {
  beforeEach(() => {
    installLocalStorage();
    config.setAnonymityMode(false);
    WebRTCService.setEnabled(false);
  });

  afterEach(() => {
    config.setAnonymityMode(false);
    WebRTCService.setEnabled(false);
  });

  it('refuses to enable the mesh while anonymity mode is on', () => {
    config.setAnonymityMode(true);
    WebRTCService.setEnabled(true);
    expect(WebRTCService.isEnabled()).toBe(false);
  });

  it('enables normally when anonymity mode is off', () => {
    WebRTCService.setEnabled(true);
    expect(WebRTCService.isEnabled()).toBe(true);
  });

  it('connectToPeer opens no connection under anonymity mode', async () => {
    config.setAnonymityMode(true);
    await WebRTCService.connectToPeer('peer-1');
    expect(WebRTCService.getConnectedPeers()).toHaveLength(0);
  });

  it('manual offer throws a clear error under anonymity mode', async () => {
    config.setAnonymityMode(true);
    await expect(WebRTCService.createManualOffer()).rejects.toThrow(/anonymity/i);
  });
});
