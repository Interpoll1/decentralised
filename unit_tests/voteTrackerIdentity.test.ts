import { describe, it, expect, vi, beforeEach } from 'vitest';

// In-memory IndexedDB metadata store
const meta = new Map<string, any>();
vi.mock('../src/services/storageService', () => ({
  StorageService: {
    getMetadata: async (k: string) => meta.get(k),
    setMetadata: async (k: string, v: any) => { meta.set(k, v); },
  },
}));

// Swappable current pubkey (undefined = no keypair available)
let mockPubkey: string | undefined = 'pubkey_AAA';
vi.mock('../src/services/keyService', () => ({
  KeyService: {
    getPublicKeyHex: async () => {
      if (mockPubkey === undefined) throw new Error('no keypair');
      return mockPubkey;
    },
  },
}));

import { VoteTrackerService, type VoteRecord } from '../src/services/voteTrackerService';

const CURRENT_DEVICE = 'device_XYZ';

beforeEach(() => {
  meta.clear();
  meta.set('device-id', CURRENT_DEVICE); // avoids browser fingerprinting path
  mockPubkey = 'pubkey_AAA';
});

function seed(records: VoteRecord[]) {
  meta.set('vote-records', records);
}

describe('VoteTrackerService identity precedence (pubkey-primary, deviceId-fallback)', () => {
  it('a legacy record (deviceId only) still blocks a re-vote after a pubkey exists', async () => {
    seed([{ pollId: 'p1', deviceId: CURRENT_DEVICE, timestamp: 1, blockIndex: 0 }]);
    expect(await VoteTrackerService.hasVoted('p1')).toBe(true);
  });

  it('a pubkey match blocks a re-vote even from a different device', async () => {
    seed([{ pollId: 'p1', deviceId: 'some_other_device', pubkey: 'pubkey_AAA', timestamp: 1, blockIndex: 0 }]);
    expect(await VoteTrackerService.hasVoted('p1')).toBe(true);
  });

  it('returns false when neither pubkey nor deviceId matches', async () => {
    seed([{ pollId: 'p1', deviceId: 'other_device', pubkey: 'pubkey_BBB', timestamp: 1, blockIndex: 0 }]);
    expect(await VoteTrackerService.hasVoted('p1')).toBe(false);
  });

  it('records both deviceId and pubkey on a new vote', async () => {
    await VoteTrackerService.recordVote('p2', 5);
    const records = meta.get('vote-records') as VoteRecord[];
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ pollId: 'p2', deviceId: CURRENT_DEVICE, pubkey: 'pubkey_AAA', blockIndex: 5 });
  });

  it('falls back to deviceId matching when no keypair is available', async () => {
    mockPubkey = undefined;
    seed([{ pollId: 'p1', deviceId: CURRENT_DEVICE, timestamp: 1, blockIndex: 0 }]);
    expect(await VoteTrackerService.hasVoted('p1')).toBe(true);

    // A pubkey-only record from another device must NOT match when we have no key
    seed([{ pollId: 'p3', deviceId: 'other_device', pubkey: 'pubkey_AAA', timestamp: 1, blockIndex: 0 }]);
    expect(await VoteTrackerService.hasVoted('p3')).toBe(false);
  });
});
