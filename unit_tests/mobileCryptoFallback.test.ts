import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// getDeviceId() must not throw when crypto.subtle is unavailable (insecure
// context / mobile http://). It should fall back to pure-JS noble SHA-256.

const meta = new Map<string, any>();
vi.mock('../src/services/storageService', () => ({
  StorageService: {
    getMetadata: async (k: string) => meta.get(k),
    setMetadata: async (k: string, v: any) => { meta.set(k, v); },
  },
}));
vi.mock('../src/services/keyService', () => ({
  KeyService: { getPublicKeyHex: async () => 'pubkey_AAA' },
}));

import { VoteTrackerService } from '../src/services/voteTrackerService';
import { CryptoService } from '../src/services/cryptoService';

// The fingerprint path (no persisted device-id) touches document/screen, which
// the node test env lacks — stub the minimum it reads.
function stubDom() {
  if (typeof (globalThis as any).document === 'undefined') {
    (globalThis as any).document = {
      createElement: () => ({ getContext: () => null, toDataURL: () => 'data:,' }),
    };
  }
  if (typeof (globalThis as any).screen === 'undefined') {
    (globalThis as any).screen = { width: 375, height: 812 };
  }
}

describe('VoteTrackerService.getDeviceId — crypto.subtle fallback', () => {
  const realSubtle = globalThis.crypto?.subtle;

  beforeEach(() => {
    meta.clear();
    stubDom();
  });

  afterEach(() => {
    if (realSubtle) {
      Object.defineProperty(globalThis.crypto, 'subtle', { value: realSubtle, configurable: true });
    }
  });

  it('produces a stable 64-hex device id when crypto.subtle is undefined', async () => {
    Object.defineProperty(globalThis.crypto, 'subtle', { value: undefined, configurable: true });

    const id = await VoteTrackerService.getDeviceId();
    expect(id).toMatch(/^[0-9a-f]{64}$/); // SHA-256 hex
    expect(await VoteTrackerService.getDeviceId()).toBe(id); // memoised
    expect(meta.get('device-id')).toBe(id);
  });

  it('noble fallback output matches crypto.subtle SHA-256 for the same input', async () => {
    const input = 'the-same-fingerprint-string';
    const digest = await realSubtle!.digest('SHA-256', new TextEncoder().encode(input));
    const subtleHex = Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    expect(CryptoService.hash(input)).toBe(subtleHex);
  });
});
