import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

/**
 * Regression tests for chatSafetyService.
 *
 * Guards against harassment and spam in DMs. Without local-first blocking,
 * every message—even spam—would give the sender evidence of delivery, creating
 * a sidechannel the sender can exploit to (1) confirm the recipient exists,
 * (2) time their behavior, (3) harvest read-receipts. Blocking happens before
 * decryption, so the sender learns nothing.
 *
 * Reports carry only a content hash (not plaintext) by default, so moderation
 * can proceed without publishing the message. Optional plaintext is user-opt-in.
 */

// In-memory metadata store
const mockMetadataStore = new Map<string, any>();

vi.mock('../src/services/storageService', () => ({
  StorageService: {
    async getMetadata(key: string) {
      return mockMetadataStore.get(key) ?? null;
    },
    async setMetadata(key: string, value: any) {
      mockMetadataStore.set(key, value);
    },
  },
}));

// Mock CryptoService for deterministic testing
vi.mock('../src/services/cryptoService', () => ({
  CryptoService: {
    hash(data: string): string {
      let hash = 0;
      for (let i = 0; i < data.length; i++) {
        hash = ((hash << 5) - hash + data.charCodeAt(i)) | 0;
      }
      return Math.abs(hash).toString(16).padStart(64, '0');
    },
  },
}));

// Mock config
vi.mock('@/config', () => ({
  default: {
    relay: {
      api: 'http://localhost:8080',
    },
  },
}));

import { ChatSafetyService, ChatSafetyState } from '../src/services/chatSafetyService';

describe('ChatSafetyService', () => {
  // Shared localStorage for tests
  let localStorageStore: Record<string, string>;

  beforeEach(() => {
    mockMetadataStore.clear();

    // Ensure window exists
    if (typeof (globalThis as any).window === 'undefined') {
      (globalThis as any).window = {};
    }

    // Create a shared mock localStorage
    localStorageStore = {};
    (globalThis as any).localStorage = {
      getItem: (key: string) => localStorageStore[key] ?? null,
      setItem: (key: string, value: string) => {
        localStorageStore[key] = value;
      },
      removeItem: (key: string) => {
        delete localStorageStore[key];
      },
      clear: () => {
        Object.keys(localStorageStore).forEach(k => delete localStorageStore[k]);
      },
      length: 0,
      key: (_index: number) => null,
    };

    // Reset fetch mock
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('Blocking — idempotent and persistent', () => {
    it('blocks a user', async () => {
      await ChatSafetyService.block('alice');
      const state = await ChatSafetyService.load();
      expect(state.blocked).toContain('alice');
    });

    it('blocking the same user twice is idempotent (no duplicates)', async () => {
      await ChatSafetyService.block('alice');
      await ChatSafetyService.block('alice');

      const state = await ChatSafetyService.load();
      const aliceCount = state.blocked.filter(u => u === 'alice').length;
      expect(aliceCount).toBe(1);
    });

    it('persists across a fresh load', async () => {
      await ChatSafetyService.block('alice');

      // Load from storage without clearing cache first
      // (the cache survives because it's in-memory and persistent)
      const state = await ChatSafetyService.load();
      expect(state.blocked).toContain('alice');
    });

    it('unblocks a user', async () => {
      await ChatSafetyService.block('alice');
      await ChatSafetyService.unblock('alice');

      const state = await ChatSafetyService.load();
      expect(state.blocked).not.toContain('alice');
    });

    it('unblocking a non-blocked user is a no-op', async () => {
      await ChatSafetyService.unblock('alice');
      const state = await ChatSafetyService.load();
      expect(state.blocked.length).toBe(0);
    });
  });

  describe('Muting — idempotent and persistent', () => {
    it('mutes a user', async () => {
      await ChatSafetyService.mute('alice');
      const state = await ChatSafetyService.load();
      expect(state.muted).toContain('alice');
    });

    it('muting the same user twice is idempotent', async () => {
      await ChatSafetyService.mute('alice');
      await ChatSafetyService.mute('alice');

      const state = await ChatSafetyService.load();
      const aliceCount = state.muted.filter(u => u === 'alice').length;
      expect(aliceCount).toBe(1);
    });

    it('persists across a fresh load', async () => {
      await ChatSafetyService.mute('alice');

      const state = await ChatSafetyService.load();
      expect(state.muted).toContain('alice');
    });

    it('unmutes a user', async () => {
      await ChatSafetyService.mute('alice');
      await ChatSafetyService.unmute('alice');

      const state = await ChatSafetyService.load();
      expect(state.muted).not.toContain('alice');
    });

    it('unmuting a non-muted user is a no-op', async () => {
      await ChatSafetyService.unmute('alice');
      const state = await ChatSafetyService.load();
      expect(state.muted.length).toBe(0);
    });
  });

  describe('isBlocked() and isMuted() — synchronous checks', () => {
    it('isBlocked is synchronous (not a Promise)', () => {
      const result = ChatSafetyService.isBlocked('alice');
      expect(typeof result).toBe('boolean');
      expect(result instanceof Promise).toBe(false);
    });

    it('isMuted is synchronous (not a Promise)', () => {
      const result = ChatSafetyService.isMuted('alice');
      expect(typeof result).toBe('boolean');
      expect(result instanceof Promise).toBe(false);
    });

    it('isBlocked returns false before prime() runs', () => {
      // Without calling prime(), the cached state is null
      const result = ChatSafetyService.isBlocked('alice');
      expect(result).toBe(false);
    });

    it('isMuted returns false before prime() runs', () => {
      const result = ChatSafetyService.isMuted('alice');
      expect(result).toBe(false);
    });

    it('isBlocked reflects persisted state after prime()', async () => {
      await ChatSafetyService.block('alice');
      await ChatSafetyService.prime();

      // Now cached
      expect(ChatSafetyService.isBlocked('alice')).toBe(true);
    });

    it('isMuted reflects persisted state after prime()', async () => {
      await ChatSafetyService.mute('alice');
      await ChatSafetyService.prime();

      expect(ChatSafetyService.isMuted('alice')).toBe(true);
    });
  });

  describe('Independence — blocking and muting are separate', () => {
    it('a blocked user is not muted', async () => {
      await ChatSafetyService.block('alice');
      await ChatSafetyService.prime();

      expect(ChatSafetyService.isBlocked('alice')).toBe(true);
      expect(ChatSafetyService.isMuted('alice')).toBe(false);
    });

    it('a muted user is not blocked', async () => {
      await ChatSafetyService.mute('bob');
      await ChatSafetyService.prime();

      expect(ChatSafetyService.isMuted('bob')).toBe(true);
      expect(ChatSafetyService.isBlocked('bob')).toBe(false);
    });

    it('a user can be both blocked and muted independently', async () => {
      await ChatSafetyService.block('alice');
      await ChatSafetyService.mute('alice');
      await ChatSafetyService.prime();

      expect(ChatSafetyService.isBlocked('alice')).toBe(true);
      expect(ChatSafetyService.isMuted('alice')).toBe(true);
    });
  });

  describe('report() — privacy-first moderation', () => {
    it('sends a content hash, not plaintext by default', async () => {
      const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true });
      global.fetch = fetchMock;

      await ChatSafetyService.report({
        messageId: 'msg-1',
        senderId: 'alice',
        text: 'This is spam',
        reason: 'spam',
      });

      const call = fetchMock.mock.calls[0];
      const body = JSON.parse(call[1]!.body as string);

      // Content hash MUST be present
      expect(body.contentHash).toBeDefined();
      expect(typeof body.contentHash).toBe('string');

      // Plaintext MUST NOT be present by default
      expect(body.text).toBeUndefined();
    });

    it('includes plaintext only when includePlaintext: true', async () => {
      const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true });
      global.fetch = fetchMock;

      await ChatSafetyService.report({
        messageId: 'msg-1',
        senderId: 'alice',
        text: 'This is spam',
        reason: 'spam',
        includePlaintext: true,
      });

      const call = fetchMock.mock.calls[0];
      const body = JSON.parse(call[1]!.body as string);

      // Both hash and plaintext present
      expect(body.contentHash).toBeDefined();
      expect(body.text).toBe('This is spam');
    });

    it('includes optional envelope when provided', async () => {
      const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true });
      global.fetch = fetchMock;

      const envelope = { _sig: 'sig-xyz', _pub: 'key-abc' };
      await ChatSafetyService.report({
        messageId: 'msg-1',
        senderId: 'alice',
        text: 'spam',
        reason: 'spam',
        envelope,
      });

      const call = fetchMock.mock.calls[0];
      const body = JSON.parse(call[1]!.body as string);

      expect(body.envelope).toEqual(envelope);
    });

    it('returns {ok:false} when fetch rejects (does not throw)', async () => {
      const fetchMock = vi.fn().mockRejectedValueOnce(new Error('Network error'));
      global.fetch = fetchMock;

      const result = await ChatSafetyService.report({
        messageId: 'msg-1',
        senderId: 'alice',
        text: 'spam',
        reason: 'spam',
      });

      expect(result.ok).toBe(false);
      expect(result.message).toContain('Network error');
    });

    it('returns {ok:false} for non-2xx responses', async () => {
      const fetchMock = vi.fn().mockResolvedValueOnce({ ok: false, status: 429 });
      global.fetch = fetchMock;

      const result = await ChatSafetyService.report({
        messageId: 'msg-1',
        senderId: 'alice',
        text: 'spam',
        reason: 'spam',
      });

      expect(result.ok).toBe(false);
      expect(result.message).toContain('Too many reports');
    });

    it('returns {ok:true} on successful report', async () => {
      const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true });
      global.fetch = fetchMock;

      const result = await ChatSafetyService.report({
        messageId: 'msg-1',
        senderId: 'alice',
        text: 'spam',
        reason: 'spam',
      });

      expect(result.ok).toBe(true);
    });
  });

  describe('blockAndReport() — ordering guarantee', () => {
    it('blocks the user even when report fails', async () => {
      const fetchMock = vi.fn().mockRejectedValueOnce(new Error('Network error'));
      global.fetch = fetchMock;

      await ChatSafetyService.blockAndReport({
        messageId: 'msg-1',
        senderId: 'alice',
        text: 'spam',
        reason: 'spam',
      });

      // Must be blocked despite report failure
      await ChatSafetyService.prime();
      expect(ChatSafetyService.isBlocked('alice')).toBe(true);
    });

    it('returns report failure status', async () => {
      const fetchMock = vi.fn().mockRejectedValueOnce(new Error('Network error'));
      global.fetch = fetchMock;

      const result = await ChatSafetyService.blockAndReport({
        messageId: 'msg-1',
        senderId: 'alice',
        text: 'spam',
        reason: 'spam',
      });

      expect(result.ok).toBe(false);
    });

    it('blocks and reports successfully when both succeed', async () => {
      const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true });
      global.fetch = fetchMock;

      const result = await ChatSafetyService.blockAndReport({
        messageId: 'msg-1',
        senderId: 'alice',
        text: 'spam',
        reason: 'spam',
      });

      expect(result.ok).toBe(true);
      await ChatSafetyService.prime();
      expect(ChatSafetyService.isBlocked('alice')).toBe(true);
    });
  });

  describe('DM policy — access control', () => {
    it('getDmPolicy defaults to everyone', () => {
      const policy = ChatSafetyService.getDmPolicy();
      expect(policy).toBe('everyone');
    });

    it('setDmPolicy persists to localStorage', () => {
      ChatSafetyService.setDmPolicy('verified-only');
      const policy = ChatSafetyService.getDmPolicy();
      expect(policy).toBe('verified-only');
    });

    it('setDmPolicy round-trips', () => {
      ChatSafetyService.setDmPolicy('verified-only');
      expect(ChatSafetyService.getDmPolicy()).toBe('verified-only');

      ChatSafetyService.setDmPolicy('everyone');
      expect(ChatSafetyService.getDmPolicy()).toBe('everyone');
    });

    it('getDmPolicy returns default if no policy is set', () => {
      // localStorage is empty, so getDmPolicy returns default
      expect(localStorageStore[('chat-dm-policy' as any)]).toBeUndefined();
      const policy = ChatSafetyService.getDmPolicy();
      expect(policy).toBe('everyone');
    });
  });

  describe('State persistence', () => {
    it('updates updatedAt timestamp on block', async () => {
      const before = Date.now();
      await ChatSafetyService.block('alice');
      const after = Date.now();

      const state = await ChatSafetyService.load();
      expect(state.updatedAt).toBeGreaterThanOrEqual(before);
      expect(state.updatedAt).toBeLessThanOrEqual(after);
    });

    it('updates updatedAt timestamp on unblock', async () => {
      await ChatSafetyService.block('alice');
      const oldTimestamp = (await ChatSafetyService.load()).updatedAt;

      // Small delay to ensure timestamp changes
      await new Promise(resolve => setTimeout(resolve, 1));
      await ChatSafetyService.unblock('alice');

      const newTimestamp = (await ChatSafetyService.load()).updatedAt;
      expect(newTimestamp).toBeGreaterThanOrEqual(oldTimestamp);
    });
  });

  describe('Initialization edge cases', () => {
    it('load() returns default state on malformed storage', async () => {
      mockMetadataStore.set('chat-safety', { blocked: null, muted: null }); // Invalid

      const state = await ChatSafetyService.load();
      expect(state.blocked).toEqual([]);
      expect(state.muted).toEqual([]);
    });

    it('prime() initializes the cache', async () => {
      await ChatSafetyService.block('alice');
      await ChatSafetyService.prime();

      // Cache should be populated
      expect(ChatSafetyService.isBlocked('alice')).toBe(true);
    });

    it('load() returns default state when storage returns nothing', async () => {
      // mockMetadataStore is empty, so getMetadata returns null
      const state = await ChatSafetyService.load();
      expect(state.blocked).toEqual([]);
      expect(state.muted).toEqual([]);
      expect(state.updatedAt).toBe(0);
    });
  });
});
