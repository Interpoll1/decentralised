import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Minimal in-memory fake of the slice of Gun's chain API that
 * `gunAsync.ts` and `pollContentVoteService.ts` use:
 *   gun.get(a).get(b)... .put(data, cb) / .once(cb) / .map().on(cb) / .off()
 *
 * Real enough to prove the fix: each `.get(key)` on a node returns a stable
 * child node backed by a shared store, so concurrent writers to different
 * keys land in different slots instead of racing on one shared value — which
 * is exactly the property the old read-modify-write counter lacked.
 */
function createFakeGun() {
  const store = new Map<string, any>();
  const listeners = new Map<string, Set<(value: any, key: string) => void>>();

  function pathKey(path: string[]): string {
    return path.join('/');
  }

  function notify(path: string[], value: any) {
    const key = pathKey(path);
    const leafKey = path[path.length - 1];
    for (const [listenerPath, cbs] of listeners) {
      if (listenerPath === key) {
        for (const cb of cbs) cb(value, leafKey);
      }
    }
  }

  function makeNode(path: string[]): any {
    return {
      get(key: string) {
        return makeNode([...path, key]);
      },
      put(data: any, cb?: (ack: any) => void) {
        // Gun's real `.put()` merges fields onto the existing node rather than
        // replacing it wholesale — mirror that here, since callers (like
        // `ensureBaseline` writing baseline fields, then later hint writes)
        // rely on partial updates not clobbering unrelated fields.
        const key = pathKey(path);
        const existing = store.get(key);
        const merged = existing && typeof existing === 'object' && data && typeof data === 'object'
          ? { ...existing, ...data }
          : data;
        store.set(key, merged);
        notify(path, merged);
        // Also notify the parent's `.map()` listener with this node's key/value.
        const parentPath = path.slice(0, -1);
        notify(parentPath, merged);
        cb?.({ ok: 1 });
      },
      once(cb: (data: any) => void) {
        cb(store.get(pathKey(path)) ?? null);
      },
      map() {
        return {
          on(cb: (value: any, key: string) => void) {
            const key = pathKey(path);
            if (!listeners.has(key)) listeners.set(key, new Set());
            listeners.get(key)!.add(cb);
            // Replay existing children immediately, like Gun does.
            for (const [storedKey, value] of store) {
              if (storedKey.startsWith(`${key}/`) && storedKey.slice(key.length + 1).indexOf('/') === -1) {
                cb(value, storedKey.slice(key.length + 1));
              }
            }
            return {
              off() {
                listeners.get(key)?.delete(cb);
              },
            };
          },
          once(cb: (value: any, key: string) => void) {
            // gunReadChildren uses .map().once(); behave the same as .map().on()
            // for this fake — both are told about every future put.
            const key = pathKey(path);
            if (!listeners.has(key)) listeners.set(key, new Set());
            listeners.get(key)!.add(cb);
            for (const [storedKey, value] of store) {
              if (storedKey.startsWith(`${key}/`) && storedKey.slice(key.length + 1).indexOf('/') === -1) {
                cb(value, storedKey.slice(key.length + 1));
              }
            }
            return {
              off() {
                listeners.get(key)?.delete(cb);
              },
            };
          },
        };
      },
    };
  }

  return { root: makeNode([]), store, listeners };
}

const fakeGun = createFakeGun();

vi.mock('../src/services/gunService', () => ({
  GunService: {
    getGun: () => fakeGun.root,
    onReconnect: () => () => {},
  },
}));

import { PollContentVoteService } from '../src/services/pollContentVoteService';

describe('PollContentVoteService', () => {
  beforeEach(() => {
    fakeGun.store.clear();
    fakeGun.listeners.clear();
  });

  it('starts with an empty tally and no vote for a fresh poll', async () => {
    const tally = await PollContentVoteService.getTally('poll-1');
    expect(tally).toEqual({ upvotes: 0, downvotes: 0, score: 0 });
    expect(await PollContentVoteService.getMyVote('poll-1', 'alice')).toBeNull();
  });

  it('casting a vote is reflected in both the tally and getMyVote', async () => {
    const result = await PollContentVoteService.castVote('poll-1', 'alice', 'up');
    expect(result.myVote).toBe('up');
    expect(result.tally).toEqual({ upvotes: 1, downvotes: 0, score: 1 });
    expect(await PollContentVoteService.getMyVote('poll-1', 'alice')).toBe('up');
  });

  it('clicking the same direction again toggles the vote off', async () => {
    await PollContentVoteService.castVote('poll-1', 'alice', 'up');
    const second = await PollContentVoteService.castVote('poll-1', 'alice', 'up');
    expect(second.myVote).toBeNull();
    expect(second.tally).toEqual({ upvotes: 0, downvotes: 0, score: 0 });
  });

  it('flipping direction moves the vote instead of adding a second one', async () => {
    await PollContentVoteService.castVote('poll-1', 'alice', 'up');
    const flipped = await PollContentVoteService.castVote('poll-1', 'alice', 'down');
    expect(flipped.myVote).toBe('down');
    expect(flipped.tally).toEqual({ upvotes: 0, downvotes: 1, score: -1 });
  });

  // This is the property the old read-modify-write counter in
  // PollService.voteOnPollContent broke: each voter has their own node, so a
  // second voter's write cannot stomp on the first voter's count.
  it('keeps every distinct voter — the bug the per-user vote nodes fix', async () => {
    await PollContentVoteService.castVote('poll-1', 'alice', 'up');
    await PollContentVoteService.castVote('poll-1', 'bob', 'up');
    await PollContentVoteService.castVote('poll-1', 'carol', 'down');

    const tally = await PollContentVoteService.getTally('poll-1');
    expect(tally).toEqual({ upvotes: 2, downvotes: 1, score: 1 });
  });

  it('different polls do not share vote state', async () => {
    await PollContentVoteService.castVote('poll-1', 'alice', 'up');
    await PollContentVoteService.castVote('poll-2', 'alice', 'down');

    expect(await PollContentVoteService.getMyVote('poll-1', 'alice')).toBe('up');
    expect(await PollContentVoteService.getMyVote('poll-2', 'alice')).toBe('down');
  });

  it('clearVote removes the vote unconditionally', async () => {
    await PollContentVoteService.castVote('poll-1', 'alice', 'down');
    const cleared = await PollContentVoteService.clearVote('poll-1', 'alice');
    expect(cleared.myVote).toBeNull();
    expect(cleared.tally).toEqual({ upvotes: 0, downvotes: 0, score: 0 });
  });

  // Regression test for the phantom-vote bug: `ensureBaseline` used to return
  // an *unwritten* `{0, 0}` baseline for a poll that did not exist yet,
  // without stamping the `voteBaselineAt` guard. The advisory tally-hint
  // written at the end of the first vote then left `upvotes: 1` sitting on
  // the poll node with nothing marking it as a hint rather than legacy data —
  // so the second vote's `ensureBaseline` call froze that hint as if it were
  // a pre-existing count, permanently baking in a vote nobody cast.
  it('does not fabricate a phantom vote from its own advisory tally hint', async () => {
    const r1 = await PollContentVoteService.castVote('poll-1', 'alice', 'up');
    expect(r1.tally).toEqual({ upvotes: 1, downvotes: 0, score: 1 });

    const r2 = await PollContentVoteService.castVote('poll-1', 'bob', 'up');
    expect(r2.tally).toEqual({ upvotes: 2, downvotes: 0, score: 2 });

    const r3 = await PollContentVoteService.castVote('poll-1', 'carol', 'up');
    expect(r3.tally).toEqual({ upvotes: 3, downvotes: 0, score: 3 });
  });
});
