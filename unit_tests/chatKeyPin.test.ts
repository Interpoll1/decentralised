import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Regression tests for chatKeyPinService.
 *
 * Guards against MITM attacks on DMs: a malicious relay or compromised Gun peer
 * could replace a peer's public key with their own, intercepting all future messages.
 * This service implements Signal-style trust-on-first-use (TOFU) key pinning with
 * manual verification via out-of-band safety numbers.
 */

// Simple in-memory metadata store for testing
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

// Mock CryptoService to provide deterministic hashing
vi.mock('../src/services/cryptoService', () => ({
  CryptoService: {
    hash(data: string): string {
      // Simple deterministic hash for testing (not cryptographically sound)
      let hash = 0;
      for (let i = 0; i < data.length; i++) {
        hash = ((hash << 5) - hash + data.charCodeAt(i)) | 0;
      }
      return Math.abs(hash).toString(16).padStart(64, '0');
    },
  },
}));

import { ChatKeyPinService, PinnedKey } from '../src/services/chatKeyPinService';

describe('ChatKeyPinService', () => {
  beforeEach(() => {
    mockMetadataStore.clear();
  });

  describe('First contact — new peer', () => {
    it('returns status:new when no pin exists', async () => {
      const result = await ChatKeyPinService.check('alice', 'key-abc');
      expect(result.status).toBe('new');
    });

    it('pins a key on first contact', async () => {
      const pin = await ChatKeyPinService.pin('alice', 'key-abc');
      expect(pin.userId).toBe('alice');
      expect(pin.keyB64).toBe('key-abc');
      expect(pin.pinnedAt).toBeGreaterThan(0);
      expect(pin.verifiedAt).toBeUndefined();
    });

    it('returns status:match after pinning the same key', async () => {
      await ChatKeyPinService.pin('alice', 'key-abc');
      const result = await ChatKeyPinService.check('alice', 'key-abc');
      expect(result.status).toBe('match');
      expect(result).toHaveProperty('pin');
      expect((result as any).pin.keyB64).toBe('key-abc');
    });
  });

  describe('MITM detection — changed key', () => {
    it('detects a different key and reports both pinned and incoming', async () => {
      // Pin a key
      await ChatKeyPinService.pin('alice', 'key-abc');

      // Try to check with a different key (attacker-controlled relay)
      const result = await ChatKeyPinService.check('alice', 'key-xyz');
      expect(result.status).toBe('changed');
      expect(result).toHaveProperty('pin');
      expect(result).toHaveProperty('incomingKeyB64');
      expect((result as any).pin.keyB64).toBe('key-abc');
      expect((result as any).incomingKeyB64).toBe('key-xyz');
    });

    it('changed status is the clearest MITM signal', async () => {
      // This is THE regression guard: any relay attack must be caught here
      await ChatKeyPinService.pin('alice', 'original-key');
      const attack = await ChatKeyPinService.check('alice', 'attacker-key');

      // CRITICAL: changed status indicates someone may be intercepting messages
      expect(attack.status).toBe('changed');
      // Both keys visible so user can investigate
      expect((attack as any).pin.keyB64).toBe('original-key');
      expect((attack as any).incomingKeyB64).toBe('attacker-key');
    });
  });

  describe('Key rotation — acceptChange', () => {
    it('moves old key to history when accepting a rotation', async () => {
      await ChatKeyPinService.pin('alice', 'key-v1');
      const updated = await ChatKeyPinService.acceptChange('alice', 'key-v2');

      expect(updated.keyB64).toBe('key-v2');
      expect(updated.history).toBeDefined();
      expect(updated.history?.length).toBe(1);
      expect(updated.history?.[0].keyB64).toBe('key-v1');
    });

    it('clears verifiedAt on rotation (rotated keys start unverified)', async () => {
      await ChatKeyPinService.pin('alice', 'key-v1');
      await ChatKeyPinService.markVerified('alice');

      const verified = await ChatKeyPinService.isVerified('alice');
      expect(verified).toBe(true);

      // Accept rotation
      const updated = await ChatKeyPinService.acceptChange('alice', 'key-v2');
      expect(updated.verifiedAt).toBeUndefined();

      // Confirm verification was cleared
      const stillVerified = await ChatKeyPinService.isVerified('alice');
      expect(stillVerified).toBe(false);
    });

    it('cumulatively builds history on repeated rotations', async () => {
      await ChatKeyPinService.pin('alice', 'key-v1');
      await ChatKeyPinService.acceptChange('alice', 'key-v2');
      await ChatKeyPinService.acceptChange('alice', 'key-v3');

      const pin = await ChatKeyPinService.getPin('alice');
      expect(pin?.history?.length).toBe(2);
      // Newest first
      expect(pin?.history?.[0].keyB64).toBe('key-v2');
      expect(pin?.history?.[1].keyB64).toBe('key-v1');
    });

    it('caps history at 10 entries, dropping the oldest', async () => {
      // Start with key-v1
      await ChatKeyPinService.pin('alice', 'key-v1');

      // Rotate 12 times (v1 -> v2 -> ... -> v13)
      for (let i = 2; i <= 13; i++) {
        await ChatKeyPinService.acceptChange('alice', `key-v${i}`);
      }

      const pin = await ChatKeyPinService.getPin('alice');
      expect(pin?.history?.length).toBe(10);
      expect(pin?.history?.[0].keyB64).toBe('key-v12'); // Most recent
      expect(pin?.history?.[9].keyB64).toBe('key-v3'); // Oldest (v1 and v2 pruned)
    });
  });

  describe('Verification — manual out-of-band confirmation', () => {
    it('markVerified sets verifiedAt timestamp', async () => {
      await ChatKeyPinService.pin('alice', 'key-abc');
      await ChatKeyPinService.markVerified('alice');

      const pin = await ChatKeyPinService.getPin('alice');
      expect(pin?.verifiedAt).toBeGreaterThan(0);
    });

    it('isVerified returns true only after manual verification', async () => {
      await ChatKeyPinService.pin('alice', 'key-abc');
      expect(await ChatKeyPinService.isVerified('alice')).toBe(false);

      await ChatKeyPinService.markVerified('alice');
      expect(await ChatKeyPinService.isVerified('alice')).toBe(true);
    });

    it('isVerified returns false for unpinned peer', async () => {
      expect(await ChatKeyPinService.isVerified('unknown')).toBe(false);
    });
  });

  describe('Clearing pins', () => {
    it('clear() removes the pin entirely', async () => {
      await ChatKeyPinService.pin('alice', 'key-abc');
      expect(await ChatKeyPinService.getPin('alice')).not.toBeNull();

      await ChatKeyPinService.clear('alice');
      expect(await ChatKeyPinService.getPin('alice')).toBeNull();
    });

    it('cleared peer reads as new on next check', async () => {
      await ChatKeyPinService.pin('alice', 'key-abc');
      await ChatKeyPinService.clear('alice');

      const result = await ChatKeyPinService.check('alice', 'key-abc');
      expect(result.status).toBe('new');
    });
  });

  describe('Safety numbers — Signal-style verification', () => {
    it('safety number is symmetric (order-independent)', () => {
      const num1 = ChatKeyPinService.safetyNumber('key-a', 'key-b');
      const num2 = ChatKeyPinService.safetyNumber('key-b', 'key-a');
      expect(num1).toBe(num2);
    });

    it('safety number is deterministic', () => {
      const num1 = ChatKeyPinService.safetyNumber('key-a', 'key-b');
      const num2 = ChatKeyPinService.safetyNumber('key-a', 'key-b');
      expect(num1).toBe(num2);
    });

    it('different key pairs produce different safety numbers', () => {
      const num1 = ChatKeyPinService.safetyNumber('key-a', 'key-b');
      const num2 = ChatKeyPinService.safetyNumber('key-a', 'key-c');
      expect(num1).not.toBe(num2);
    });

    it('formats as exactly 12 groups of 5 digits', () => {
      const num = ChatKeyPinService.safetyNumber('key-a', 'key-b');
      // Format: "12345 67890 12345 67890 12345 67890 12345 67890 12345 67890 12345 67890"
      expect(num).toMatch(/^(\d{5} ){11}\d{5}$/);
      const groups = num.split(' ');
      expect(groups.length).toBe(12);
      groups.forEach(group => {
        expect(group).toMatch(/^\d{5}$/);
      });
    });
  });

  describe('safetyNumberFor() — convenience wrapper', () => {
    it('returns null when no pin exists', async () => {
      const num = await ChatKeyPinService.safetyNumberFor('my-key', 'alice');
      expect(num).toBeNull();
    });

    it('returns safety number when pin exists', async () => {
      await ChatKeyPinService.pin('alice', 'alice-key');
      const num = await ChatKeyPinService.safetyNumberFor('my-key', 'alice');
      expect(num).not.toBeNull();
      expect(num).toMatch(/^(\d{5} ){11}\d{5}$/);
    });

    it('matches safetyNumber() with the pinned key', async () => {
      const aliceKey = 'alice-key-v1';
      const myKey = 'my-key-v1';

      await ChatKeyPinService.pin('alice', aliceKey);
      const fromWrapper = await ChatKeyPinService.safetyNumberFor(myKey, 'alice');
      const direct = ChatKeyPinService.safetyNumber(myKey, aliceKey);

      expect(fromWrapper).toBe(direct);
    });
  });

  describe('Storage failure degradation', () => {
    it('getPin returns null on storage error (does not throw)', async () => {
      // Make getMetadata reject
      vi.mocked(require('../src/services/storageService').StorageService).getMetadata = vi.fn()
        .mockRejectedValueOnce(new Error('Storage error'));

      const result = await ChatKeyPinService.getPin('alice');
      expect(result).toBeNull();
    });

    it('check still works when storage fails', async () => {
      // Inject an error only for the first call
      const originalGetMetadata = require('../src/services/storageService').StorageService.getMetadata;
      vi.mocked(require('../src/services/storageService').StorageService).getMetadata = vi.fn()
        .mockRejectedValueOnce(new Error('Storage error'));

      const result = await ChatKeyPinService.check('alice', 'key-abc');
      expect(result.status).toBe('new'); // Treated as no pin

      // Restore
      require('../src/services/storageService').StorageService.getMetadata = originalGetMetadata;
    });

    it('pin proceeds despite storage failure (in-memory state survives)', async () => {
      // Make setMetadata reject
      const originalSetMetadata = require('../src/services/storageService').StorageService.setMetadata;
      vi.mocked(require('../src/services/storageService').StorageService).setMetadata = vi.fn()
        .mockRejectedValueOnce(new Error('Storage error'));

      const pin = await ChatKeyPinService.pin('alice', 'key-abc');
      expect(pin.keyB64).toBe('key-abc');

      // Restore
      require('../src/services/storageService').StorageService.setMetadata = originalSetMetadata;
    });

    it('isVerified returns false on storage error (does not throw)', async () => {
      vi.mocked(require('../src/services/storageService').StorageService).getMetadata = vi.fn()
        .mockRejectedValueOnce(new Error('Storage error'));

      const result = await ChatKeyPinService.isVerified('alice');
      expect(result).toBe(false);
    });
  });

  describe('getPin() data validation', () => {
    it('returns null for malformed stored record (missing keyB64)', async () => {
      mockMetadataStore.set('chat-pin:alice', { userId: 'alice' });
      const result = await ChatKeyPinService.getPin('alice');
      expect(result).toBeNull();
    });

    it('returns null for empty keyB64', async () => {
      mockMetadataStore.set('chat-pin:bob', { userId: 'bob', keyB64: '' });
      const result = await ChatKeyPinService.getPin('bob');
      expect(result).toBeNull();
    });

    it('accepts valid record with history', async () => {
      const validPin: PinnedKey = {
        userId: 'alice',
        keyB64: 'key-current',
        pinnedAt: 100,
        verifiedAt: 200,
        history: [
          { keyB64: 'key-old', pinnedAt: 50, replacedAt: 100 },
        ],
      };
      mockMetadataStore.set('chat-pin:alice', validPin);

      const result = await ChatKeyPinService.getPin('alice');
      expect(result).toEqual(validPin);
    });
  });
});
