import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Force StorageService onto its in-memory fallback, exactly as socialStorage.test.ts
// does — the outbox behaviour under test is storage-shape agnostic.
vi.mock('idb', () => ({
  openDB: vi.fn(async () => { throw new Error('IndexedDB disabled'); }),
}));

// The outbox only needs the reconnect hook from GunService; a real Gun instance
// would open sockets.
vi.mock('../src/services/gunService', () => ({
  GunService: { onReconnect: vi.fn(() => () => {}) },
}));

const verifySoulOnRelay = vi.fn<[string, number?], Promise<boolean | null>>();
vi.mock('../src/utils/gunAsync', () => ({
  verifySoulOnRelay: (soul: string, deadline?: number) => verifySoulOnRelay(soul, deadline),
}));

import { OutboxService, type OutboxSendResult } from '../src/services/outboxService';
import { StorageService } from '../src/services/storageService';

const SOUL = 'postVotes/post-1/user-1';

async function rows() {
  return StorageService.getAllOutboxEntries();
}

async function row(id = SOUL) {
  return StorageService.getOutboxEntry(id);
}

/** Enqueue a standard vote-shaped entry. */
function enqueue(overrides: Record<string, unknown> = {}) {
  return OutboxService.enqueue({
    id: SOUL,
    kind: 'test-vote',
    soul: SOUL,
    payload: { postId: 'post-1', userId: 'user-1', type: 'up' },
    ...overrides,
  });
}

/** Register a handler that always reports `result` and counts its calls. */
function handler(result: OutboxSendResult) {
  const fn = vi.fn(async () => result);
  OutboxService.registerHandler('test-vote', fn);
  return fn;
}

describe('OutboxService', () => {
  beforeEach(async () => {
    OutboxService.reset();
    verifySoulOnRelay.mockReset();
    await StorageService.clearAll();
  });

  afterEach(() => {
    OutboxService.stop();
    vi.useRealTimers();
  });

  describe('persistence', () => {
    it('persists the entry before any send is attempted', async () => {
      // The handler asserts the row already exists at send time — this is the
      // whole point: a crash mid-send must not lose the write.
      let seenAtSendTime: unknown;
      OutboxService.registerHandler('test-vote', async () => {
        seenAtSendTime = await row();
        return 'unreachable';
      });
      await enqueue();
      expect(seenAtSendTime).toMatchObject({ id: SOUL, kind: 'test-vote' });
    });

    it('keeps the original createdAt when the same id is re-enqueued', async () => {
      handler('unreachable');
      await enqueue();
      const first = await row();
      await new Promise((r) => setTimeout(r, 5));
      await enqueue();
      expect((await row())!.createdAt).toBe(first!.createdAt);
    });

    it('survives with no handler registered rather than discarding the write', async () => {
      await enqueue();
      // No handler for this kind — the row must remain for a later build/session.
      expect(await row()).toBeDefined();
    });
  });

  describe('confirmation', () => {
    it('deletes the entry once the relay confirms the soul', async () => {
      handler('sent');
      verifySoulOnRelay.mockResolvedValue(true);
      await enqueue();
      expect(await rows()).toHaveLength(0);
    });

    it('keeps the entry when the relay answers but does not hold the soul', async () => {
      handler('sent');
      verifySoulOnRelay.mockResolvedValue(false);
      await enqueue();
      const entry = await row();
      expect(entry).toBeDefined();
      expect(entry!.state).toBe('attempted');
      expect(entry!.attempts).toBe(1);
    });

    it('does not spend an attempt when confirmation is inconclusive', async () => {
      // `null` = no reachable /db/soul endpoint. That says nothing about the
      // write, so burning an attempt on it would let an outage exhaust the
      // budget and drop a vote that was never really tried.
      handler('sent');
      verifySoulOnRelay.mockResolvedValue(null);
      await enqueue();
      expect((await row())!.attempts).toBe(0);
    });

    it('clears an entry with no soul on the handler’s word alone', async () => {
      handler('sent');
      await OutboxService.enqueue({
        id: 'no-soul', kind: 'test-vote', payload: { x: 1 },
      });
      expect(await rows()).toHaveLength(0);
      expect(verifySoulOnRelay).not.toHaveBeenCalled();
    });
  });

  describe('offline behaviour', () => {
    it('does not spend an attempt when nothing accepted the write', async () => {
      const send = handler('unreachable');
      await enqueue();
      const entry = await row();
      expect(send).toHaveBeenCalledTimes(1);
      expect(entry!.state).toBe('pending');
      expect(entry!.attempts).toBe(0);
      expect(verifySoulOnRelay).not.toHaveBeenCalled();
    });

    it('survives an outage longer than the attempt budget', async () => {
      // 20 drains with the relay down must not discard the vote.
      handler('unreachable');
      await enqueue();
      for (let i = 0; i < 20; i++) {
        // Clear the backoff so each drain actually attempts.
        const entry = (await row())!;
        await StorageService.saveOutboxEntry({ ...entry, nextAttemptAt: 0 });
        await OutboxService.drain();
      }
      expect(await row()).toBeDefined();
    });

    it('sends the queued write once the relay comes back', async () => {
      const send = handler('unreachable');
      await enqueue();
      expect(await row()).toBeDefined();

      // Relay returns: handler now succeeds and the soul verifies.
      send.mockResolvedValue('sent');
      verifySoulOnRelay.mockResolvedValue(true);
      const entry = (await row())!;
      await StorageService.saveOutboxEntry({ ...entry, nextAttemptAt: 0 });
      await OutboxService.drain();

      expect(await rows()).toHaveLength(0);
    });
  });

  describe('backoff and give-up', () => {
    it('honours nextAttemptAt', async () => {
      const send = handler('unreachable');
      await enqueue();
      send.mockClear();
      await OutboxService.drain(); // still inside the backoff window
      expect(send).not.toHaveBeenCalled();
    });

    it('drops an entry that exhausted its attempts', async () => {
      handler('sent');
      verifySoulOnRelay.mockResolvedValue(false);
      await enqueue();
      const entry = (await row())!;
      await StorageService.saveOutboxEntry({ ...entry, attempts: 8, nextAttemptAt: 0 });
      await OutboxService.drain();
      expect(await rows()).toHaveLength(0);
    });

    it('drops an entry older than the TTL', async () => {
      handler('unreachable');
      await enqueue();
      const entry = (await row())!;
      const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60_000;
      await StorageService.saveOutboxEntry({ ...entry, createdAt: eightDaysAgo });
      await OutboxService.drain();
      expect(await rows()).toHaveLength(0);
    });

    it('drops an entry the handler rejects as permanently invalid', async () => {
      handler('permanent');
      await enqueue();
      expect(await rows()).toHaveLength(0);
    });
  });

  describe('markSent', () => {
    it('lets a drain confirm an inline write without resending it', async () => {
      const send = handler('sent');
      await enqueue({ sendNow: false });
      expect(send).not.toHaveBeenCalled();

      await OutboxService.markSent(SOUL);
      expect((await row())!.state).toBe('attempted');

      verifySoulOnRelay.mockResolvedValue(true);
      await OutboxService.drain();

      expect(await rows()).toHaveLength(0);
      expect(send).not.toHaveBeenCalled(); // confirmed, never resent
    });

    it('resends when the inline write was never marked sent', async () => {
      const send = handler('sent');
      await enqueue({ sendNow: false });
      verifySoulOnRelay.mockResolvedValue(true);
      await OutboxService.drain();
      expect(send).toHaveBeenCalledTimes(1);
    });
  });

  describe('cancel', () => {
    it('removes a superseded entry', async () => {
      handler('unreachable');
      await enqueue();
      await OutboxService.cancel(SOUL);
      expect(await rows()).toHaveLength(0);
    });
  });
});
