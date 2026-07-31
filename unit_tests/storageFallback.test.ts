import { describe, it, expect, vi } from 'vitest';

// StorageService must degrade to an in-memory store instead of hanging/throwing
// when IndexedDB is unavailable (iOS Safari Private mode). Simulate by making
// `openDB` reject; the service should return a working store.
vi.mock('idb', () => ({
  openDB: vi.fn(async () => {
    throw new Error('IndexedDB disabled');
  }),
}));

import { StorageService } from '../src/services/storageService';

describe('StorageService — in-memory fallback when IndexedDB fails', () => {
  it('out-of-line metadata read/write works and flags the fallback', async () => {
    await expect(StorageService.setMetadata('k', { hi: 1 })).resolves.toBeUndefined();
    expect(await StorageService.getMetadata('k')).toEqual({ hi: 1 });
    expect(StorageService.usingMemoryFallback).toBe(true);
  });

  it('inline-keyPath stores derive their key from the value', async () => {
    await StorageService.savePoll({ id: 'poll-1', question: 'q' } as any);
    expect(await StorageService.getPoll('poll-1')).toMatchObject({ id: 'poll-1' });
    expect((await StorageService.getAllPolls()).length).toBeGreaterThan(0);
  });

  it('getLatestBlock returns the highest-index block via the cursor shim', async () => {
    await StorageService.saveBlock({ index: 0, currentHash: 'a' } as any);
    await StorageService.saveBlock({ index: 2, currentHash: 'c' } as any);
    await StorageService.saveBlock({ index: 1, currentHash: 'b' } as any);
    const latest = await StorageService.getLatestBlock();
    expect(latest).toMatchObject({ index: 2 });
  });

  it('by-poll index queries filter on the indexed field', async () => {
    await StorageService.saveVote({ timestamp: 1, pollId: 'p1' } as any);
    await StorageService.saveVote({ timestamp: 2, pollId: 'p2' } as any);
    await StorageService.saveVote({ timestamp: 3, pollId: 'p1' } as any);
    const p1 = await StorageService.getVotesByPoll('p1');
    expect(p1.map((v: any) => v.timestamp).sort()).toEqual([1, 3]);
  });
});
