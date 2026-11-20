import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock localStorage
const storage = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
  clear: () => storage.clear(),
});

// Import config after mocking
import config from '../src/config';

describe('config', () => {
  beforeEach(() => {
    storage.clear();
    config.resetRelayOverrides();
    config.resetEncryptionConfig();
  });

  describe('relay defaults', () => {
    it('returns default websocket URL', () => {
      expect(config.relay.websocket).toContain('interpoll');
    });

    it('returns default gun URL', () => {
      expect(config.relay.gun).toContain('gun');
    });

    it('returns default api URL', () => {
      expect(config.relay.api).toBeTruthy();
    });
  });

  describe('setRelayOverrides', () => {
    it('overrides websocket URL', () => {
      config.setRelayOverrides({ websocket: 'wss://custom.example.com' });
      expect(config.relay.websocket).toBe('wss://custom.example.com');
    });

    it('overrides gun URL', () => {
      config.setRelayOverrides({ gun: 'https://custom-gun.example.com' });
      expect(config.relay.gun).toBe('https://custom-gun.example.com');
    });

    it('preserves unset overrides', () => {
      const defaultApi = config.relay.api;
      config.setRelayOverrides({ websocket: 'wss://new.com' });
      expect(config.relay.api).toBe(defaultApi);
    });

    it('strips empty strings', () => {
      config.setRelayOverrides({ websocket: '' });
      expect(config.relay.websocket).toBe(config.defaults.websocket);
    });

    it('persists to localStorage', () => {
      config.setRelayOverrides({ websocket: 'wss://test.com' });
      const stored = JSON.parse(storage.get('interpoll_relay_config')!);
      expect(stored.websocket).toBe('wss://test.com');
    });
  });

  describe('resetRelayOverrides', () => {
    it('reverts to defaults', () => {
      config.setRelayOverrides({ websocket: 'wss://custom.com' });
      config.resetRelayOverrides();
      expect(config.relay.websocket).toBe(config.defaults.websocket);
    });

    it('clears localStorage', () => {
      config.setRelayOverrides({ websocket: 'wss://test.com' });
      config.resetRelayOverrides();
      expect(storage.has('interpoll_relay_config')).toBe(false);
    });
  });

  describe('getRelayOverrides', () => {
    it('returns empty object when no overrides', () => {
      expect(config.getRelayOverrides()).toEqual({});
    });

    it('returns current overrides', () => {
      config.setRelayOverrides({ websocket: 'wss://x.com' });
      expect(config.getRelayOverrides().websocket).toBe('wss://x.com');
    });
  });

  describe('encryption config', () => {
    it('defaults encryptAll to false', () => {
      expect(config.encryption.encryptAll).toBe(false);
    });

    it('defaults requireInviteToJoin to false', () => {
      expect(config.encryption.requireInviteToJoin).toBe(false);
    });

    it('isServerEncrypted returns false by default', () => {
      expect(config.isServerEncrypted()).toBe(false);
    });

    it('setEncryptionConfig enables encryption', () => {
      config.setEncryptionConfig({ encryptAll: true, serverPassword: 'test' });
      expect(config.encryption.encryptAll).toBe(true);
      expect(config.encryption.serverPassword).toBe('test');
      expect(config.isServerEncrypted()).toBe(true);
    });

    it('resetEncryptionConfig clears settings', () => {
      config.setEncryptionConfig({ encryptAll: true });
      config.resetEncryptionConfig();
      expect(config.encryption.encryptAll).toBe(false);
    });

    it('getEncryptionConfig returns clone', () => {
      config.setEncryptionConfig({ encryptAll: true });
      const cfg = config.getEncryptionConfig();
      expect(cfg.encryptAll).toBe(true);
    });

    it('strips empty/undefined values', () => {
      config.setEncryptionConfig({ serverPassword: '' });
      const cfg = config.getEncryptionConfig();
      expect(cfg.serverPassword).toBeUndefined();
    });
  });
});
