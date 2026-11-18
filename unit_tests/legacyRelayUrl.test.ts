import { expect, it, vi, afterEach } from 'vitest';
import { migrateLegacyRelayUrl } from '../src/utils/legacyRelayUrl';

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules(); });
it('migrates known legacy transports while preserving paths and custom relays', () => {
  expect(migrateLegacyRelayUrl('wss://interpoll.endless.sbs')).toBe('wss://interpoll.endless.social');
  expect(migrateLegacyRelayUrl('https://interpoll2.endless.sbs/gun')).toBe('https://interpoll2.endless.social/gun');
  for (const url of ['https://custom.example/gun', 'https://interpoll.endless.sbs.evil.example/gun', 'admin@endless.sbs']) {
    expect(migrateLegacyRelayUrl(url)).toBe(url);
  }
});
it('migrates saved relay overrides and peer lists without rewriting stored identities', async () => {
  vi.resetModules();
  const values = new Map([
    ['interpoll_relay_config', JSON.stringify({ websocket: 'wss://interpoll.endless.sbs', api: 'https://custom.example' })],
    ['interpoll_gun_peers_v3', JSON.stringify(['https://interpoll2.endless.sbs/gun', 'https://custom.example/gun'])],
    ['identityUsername', 'alice@endless.sbs'],
  ]);
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null });
  const { default: config } = await import('../src/config');
  expect(config.relay.websocket).toBe('wss://interpoll.endless.social');
  expect(config.relay.api).toBe('https://custom.example');
  expect(config.getUserGunPeers()).toEqual(['https://interpoll2.endless.social/gun', 'https://custom.example/gun']);
  expect(values.get('identityUsername')).toBe('alice@endless.sbs');
});
it('honors documented build-time endpoint overrides', async () => {
  vi.resetModules(); vi.stubGlobal('localStorage', { getItem: () => null });
  vi.stubEnv('VITE_WS_RELAY_URL', 'wss://custom.example');
  vi.stubEnv('VITE_GUN_RELAY_URL', 'https://custom.example/gun');
  vi.stubEnv('VITE_API_BASE_URL', 'https://custom.example');
  vi.stubEnv('VITE_WEB_ORIGIN', 'https://web.example');
  const { default: config, PRIVATE_PEERS } = await import('../src/config');
  expect(config.relay.websocket).toBe('wss://custom.example');
  expect(config.auth.api).toBe('https://custom.example');
  expect(PRIVATE_PEERS[0]).toBe('https://custom.example/gun');
  expect(config.web.origin).toBe('https://web.example');
});
