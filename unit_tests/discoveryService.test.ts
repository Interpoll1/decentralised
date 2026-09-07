import { describe, expect, it, vi, beforeEach } from 'vitest';
import { schnorr } from '@noble/curves/secp256k1.js';
import { bytesToHex, hexToBytes, randomBytes } from '@noble/hashes/utils';

vi.mock('@/services/gunService', () => ({
  GUN_NAMESPACE: 'v3',
  GunService: { getGun: vi.fn(), onReconnect: vi.fn(), addPeer: vi.fn() },
  default: {},
}));

import { DiscoveryService } from '@/services/discoveryService';
import { CryptoService } from '@/services/cryptoService';

const D = DiscoveryService as any;

const privateKey = bytesToHex(randomBytes(32));
const publicKey = bytesToHex(schnorr.getPublicKey(hexToBytes(privateKey)));

function makePayload(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    version: 1,
    nodeId: 'node-1',
    peerId: 'peer-1',
    websocket: 'wss://relay.example/ws',
    gun: 'https://relay.example/gun',
    api: 'https://relay.example/api',
    capabilities: ['ws-sync', 'gun-relay'],
    timestamp: Date.now(),
    ttlMs: 60_000,
    ...overrides,
  };
}

function signAnnouncement(payload: ReturnType<typeof makePayload>, key = privateKey, pub = publicKey) {
  const message = D.signingMessage(payload);
  const signature = CryptoService.sign(message, key);
  return {
    ...payload,
    signerPubkey: pub,
    signature,
    pow: D.computePow(signature),
  };
}

beforeEach(() => {
  D.entries = new Map();
});

describe('DiscoveryService.normalizeAndValidate', () => {
  it('accepts a well-formed, correctly signed announcement', () => {
    const announcement = signAnnouncement(makePayload());
    const result = D.normalizeAndValidate(announcement);
    expect(result).not.toBeNull();
    expect(result.nodeId).toBe('node-1');
    expect(result.expiresAt).toBe(announcement.timestamp + announcement.ttlMs);
  });

  it('rejects an announcement with a tampered field after signing', () => {
    const announcement = signAnnouncement(makePayload());
    const tampered = { ...announcement, gun: 'https://attacker.example/gun' };
    expect(D.normalizeAndValidate(tampered)).toBeNull();
  });

  it('rejects an announcement signed by a different key than claimed', () => {
    const otherPriv = bytesToHex(randomBytes(32));
    const announcement = signAnnouncement(makePayload(), otherPriv, publicKey);
    expect(D.normalizeAndValidate(announcement)).toBeNull();
  });

  it('rejects an already-expired announcement (timestamp + ttl in the past)', () => {
    const announcement = signAnnouncement(
      makePayload({ timestamp: Date.now() - 120_000, ttlMs: 60_000 }),
    );
    expect(D.normalizeAndValidate(announcement)).toBeNull();
  });

  it('rejects insecure (non-wss/https) endpoints', () => {
    const announcement = signAnnouncement(
      makePayload({ websocket: 'ws://relay.example/ws' }),
    );
    expect(D.normalizeAndValidate(announcement)).toBeNull();
  });

  it('rejects a malformed pubkey/signature shape', () => {
    const announcement = signAnnouncement(makePayload());
    expect(D.normalizeAndValidate({ ...announcement, signerPubkey: 'not-hex' })).toBeNull();
    expect(D.normalizeAndValidate({ ...announcement, signature: 'short' })).toBeNull();
  });

  it('rejects a valid signature without proof-of-work', () => {
    const announcement = signAnnouncement(makePayload());
    expect(D.normalizeAndValidate({ ...announcement, pow: '' })).toBeNull();
  });

  it('round-trips capabilities through the Gun map encoding', () => {
    const asMap = D.capabilitiesToGunMap(['b', 'a', 'c']);
    const restored = D.normalizeCapabilities(asMap);
    expect(restored).toEqual(['a', 'b', 'c']);
  });

  it('rejects non-object input without throwing', () => {
    expect(D.normalizeAndValidate(null)).toBeNull();
    expect(D.normalizeAndValidate(undefined)).toBeNull();
    expect(D.normalizeAndValidate('garbage')).toBeNull();
  });
});

describe('DiscoveryService entry store', () => {
  it('evicts the oldest entry once maxEntries is exceeded', () => {
    D.maxEntries = 2;
    const e1 = signAnnouncement(makePayload({ nodeId: 'n1', timestamp: Date.now() }));
    const e2 = signAnnouncement(makePayload({ nodeId: 'n2', timestamp: Date.now() + 1 }));
    const e3 = signAnnouncement(makePayload({ nodeId: 'n3', timestamp: Date.now() + 2 }));

    [e1, e2, e3].forEach((a) => {
      const normalized = D.normalizeAndValidate(a);
      D.upsertEntry(D.discoveryKey(normalized), normalized);
    });

    const entries = DiscoveryService.getEntries();
    expect(entries.length).toBe(2);
    expect(entries.some((e) => e.nodeId === 'n1')).toBe(false);
    D.maxEntries = 100;
  });

  it('prunes expired entries out of getEntries()', () => {
    const expiringSoon = signAnnouncement(
      makePayload({ nodeId: 'expiring', timestamp: Date.now() - 25_000, ttlMs: 30_000 }),
    );
    const normalized = D.normalizeAndValidate(expiringSoon);
    expect(normalized).not.toBeNull();
    D.upsertEntry(D.discoveryKey(normalized), normalized);
    expect(DiscoveryService.getEntries().some((e) => e.nodeId === 'expiring')).toBe(true);

    // Move the wall clock forward past expiry.
    const entry = D.entries.get(D.discoveryKey(normalized));
    entry.expiresAt = Date.now() - 1;
    expect(DiscoveryService.getEntries().some((e) => e.nodeId === 'expiring')).toBe(false);
  });

  it('getDiscoveredGunPeers only returns https:// gun URLs', () => {
    const httpsOne = signAnnouncement(makePayload({ nodeId: 'https-node' }));
    const normalized = D.normalizeAndValidate(httpsOne);
    D.upsertEntry(D.discoveryKey(normalized), normalized);

    // Force an http:// gun url directly into the store (bypassing validation,
    // as if a legacy/insecure entry made it through some other path) to prove
    // getDiscoveredGunPeers itself filters, not just normalizeAndValidate.
    D.entries.set('forced-http', { ...normalized, nodeId: 'http-node', gun: 'http://insecure.example/gun', expiresAt: Date.now() + 60_000 });

    const peers = DiscoveryService.getDiscoveredGunPeers();
    expect(peers).toContain('https://relay.example/gun');
    expect(peers.every((u) => u.startsWith('https://'))).toBe(true);
  });
});
