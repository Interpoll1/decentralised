import { describe, it, expect, vi, beforeEach } from 'vitest';

// In-memory IndexedDB metadata store. Like a real IDB transaction, a read
// snapshots the value before yielding, and a write lands after a delay — so
// concurrent first-run callers genuinely interleave between read and write.
const meta = new Map<string, any>();
const tick = () => new Promise((r) => setTimeout(r, 5));
const setMetadata = vi.fn(async (k: string, v: any) => { await tick(); meta.set(k, v); });
vi.mock('../src/services/storageService', () => ({
  StorageService: {
    getMetadata: async (k: string) => {
      const value = meta.get(k);
      await tick();
      return value;
    },
    setMetadata: (k: string, v: any) => setMetadata(k, v),
  },
}));

import { KeyService } from '../src/services/keyService';

describe('KeyService first-run identity', () => {
  beforeEach(() => {
    meta.clear();
    setMetadata.mockClear();
    KeyService.clearCache();
  });

  it('concurrent cold callers get one identity, generated and stored once', async () => {
    const keys = await Promise.all([
      KeyService.getPublicKeyHex(),
      KeyService.getPublicKeyHex(),
      KeyService.getKeyPair().then((k) => k.publicKey),
    ]);

    expect(new Set(keys).size).toBe(1);
    expect(setMetadata).toHaveBeenCalledTimes(1);
    expect(meta.get('nostr-keypair').publicKey).toBe(keys[0]);
  });

  it('getPublicKeyHex returns a 64-char x-only pubkey (what onboarding displays)', async () => {
    expect(await KeyService.getPublicKeyHex()).toMatch(/^[0-9a-f]{64}$/);
  });

  it('reuses a stored key pair instead of generating a new one', async () => {
    const first = await KeyService.getPublicKeyHex();
    KeyService.clearCache();
    expect(await KeyService.getPublicKeyHex()).toBe(first);
    expect(setMetadata).toHaveBeenCalledTimes(1);
  });
});
