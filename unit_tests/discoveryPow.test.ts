import { describe, expect, it, vi } from 'vitest';

// Keep Gun out of the test; we only exercise the pure PoW helpers (which use the
// real CryptoService hash).
vi.mock('@/services/gunService', () => ({
  GUN_NAMESPACE: 'v3',
  GunService: { getGun: vi.fn(), onReconnect: vi.fn(), map: vi.fn() },
  default: {},
}));

import { DiscoveryService } from '@/services/discoveryService';

const D = DiscoveryService as any;

describe('DiscoveryService announcement PoW (Sybil gate)', () => {
  it('computes a nonce that satisfies its own verification', () => {
    const sig = 'a'.repeat(128);
    const pow = D.computePow(sig);
    expect(typeof pow).toBe('string');
    expect(pow.length).toBeGreaterThan(0);
    expect(D.verifyPow(sig, pow)).toBe(true);
  });

  it('rejects a missing or bogus PoW', () => {
    const sig = 'b'.repeat(128);
    expect(D.verifyPow(sig, '')).toBe(false);
    expect(D.verifyPow(sig, 'not-a-valid-nonce')).toBe(false);
  });

  it('binds the PoW to the specific signature', () => {
    const sig1 = 'c'.repeat(128);
    const sig2 = 'd'.repeat(128);
    const pow = D.computePow(sig1);
    expect(D.verifyPow(sig1, pow)).toBe(true);
    expect(D.verifyPow(sig2, pow)).toBe(false); // same nonce doesn't transfer
  });

  it('counts leading zero bits correctly', () => {
    expect(D.leadingZeroBits('ffff')).toBe(0);
    expect(D.leadingZeroBits('0fff')).toBe(4);
    expect(D.leadingZeroBits('00ff')).toBe(8);
    expect(D.leadingZeroBits('1fff')).toBe(3);
  });
});
