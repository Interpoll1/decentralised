import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import config from '@/config';

/**
 * Anonymity (Tor) Mode config contract. The security-critical behavior is that
 * while the mode is on, `getIceServers()` returns an EMPTY list — any
 * RTCPeerConnection built from it cannot gather server-reflexive (real-IP)
 * candidates via STUN, so the user's real IP cannot leak while they believe they
 * are anonymous.
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

describe('config anonymity (Tor) mode', () => {
  beforeEach(() => {
    installLocalStorage();
    config.setAnonymityMode(false);
    config.resetIceServers();
  });

  afterEach(() => {
    config.setAnonymityMode(false);
  });

  it('is off by default and exposes STUN servers', () => {
    expect(config.anonymityMode).toBe(false);
    expect(config.getIceServers().length).toBeGreaterThan(0);
  });

  it('returns an empty ICE list when enabled (no STUN => no real-IP candidates)', () => {
    config.setAnonymityMode(true);
    expect(config.anonymityMode).toBe(true);
    expect(config.getIceServers()).toEqual([]);
  });

  it('returns empty ICE even with a user TURN override while on', () => {
    config.setIceServers([{ urls: 'turn:turn.example.com:3478', username: 'u', credential: 'p' }]);
    config.setAnonymityMode(true);
    expect(config.getIceServers()).toEqual([]);
  });

  it('restores ICE servers when disabled again', () => {
    config.setAnonymityMode(true);
    config.setAnonymityMode(false);
    expect(config.getIceServers().length).toBeGreaterThan(0);
  });

  it('persists the flag to localStorage', () => {
    config.setAnonymityMode(true);
    expect(localStorage.getItem('interpoll_anonymity_mode')).toBe('true');
    config.setAnonymityMode(false);
    expect(localStorage.getItem('interpoll_anonymity_mode')).toBe(null);
  });
});
