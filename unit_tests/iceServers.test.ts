import { beforeEach, describe, expect, it } from 'vitest';
import config from '@/config';

function installLocalStorage(): void {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => { store.clear(); },
  };
}

describe('config ICE servers', () => {
  beforeEach(() => {
    installLocalStorage();
    config.resetIceServers();
  });

  it('defaults to a diverse multi-provider STUN set', () => {
    const servers = config.getIceServers();
    expect(servers.length).toBeGreaterThanOrEqual(3);
    const hosts = servers.map((s) => String(s.urls));
    // Not single-vendor: at least one non-Google provider present.
    expect(hosts.some((u) => !u.includes('google'))).toBe(true);
  });

  it('round-trips a TURN override and resets to default', () => {
    const turn: RTCIceServer[] = [
      ...config.getDefaultIceServers(),
      { urls: 'turn:turn.example.com:3478', username: 'u', credential: 'p' },
    ];
    config.setIceServers(turn);
    const got = config.getIceServers();
    expect(got.some((s) => String(s.urls).startsWith('turn:'))).toBe(true);

    config.resetIceServers();
    expect(config.getIceServers().some((s) => String(s.urls).startsWith('turn:'))).toBe(false);
  });

  it('treats an empty override as a reset', () => {
    config.setIceServers([{ urls: 'turn:x' }]);
    config.setIceServers([]);
    expect(config.getIceServers().every((s) => String(s.urls).startsWith('stun:'))).toBe(true);
  });
});
