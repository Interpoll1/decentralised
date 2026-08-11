import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Minimal in-memory fake of the slice of Gun's chain API that
 * `gunAsync.ts` and `postVoteService.ts` use:
 *   gun.get(a).get(b)... .put(data, cb) / .once(cb) / .map().on(cb) / .off()
 *
 * Real enough to prove the fix: each `.get(key)` on a node returns a stable
 * child node backed by a shared store, `.put()` merges fields the way Gun
 * does (rather than replacing the node wholesale), and every vote lands on
 * its own key so concurrent writers cannot stomp on each other's value.
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
        // replacing it wholesale — mirror that here, since `ensureBaseline`
        // writing baseline fields followed by a later hint write both rely on
        // partial updates not clobbering unrelated fields.
        const key = pathKey(path);
        const existing = store.get(key);
        const merged = existing && typeof existing === 'object' && data && typeof data === 'object'
          ? { ...existing, ...data }
          : data;
        store.set(key, merged);
        notify(path, merged);
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

import { PostVoteService } from '../src/services/postVoteService';

describe('PostVoteService', () => {
  beforeEach(() => {
    fakeGun.store.clear();
    fakeGun.listeners.clear();
  });

  it('casting a vote is reflected in both the tally and getMyVote', async () => {
    const result = await PostVoteService.castVote('post-1', 'alice', 'up');
    expect(result.myVote).toBe('up');
    expect(result.tally).toEqual({ upvotes: 1, downvotes: 0, score: 1 });
    expect(await PostVoteService.getMyVote('post-1', 'alice')).toBe('up');
  });

  it('clicking the same direction again toggles the vote off', async () => {
    await PostVoteService.castVote('post-1', 'alice', 'up');
    const second = await PostVoteService.castVote('post-1', 'alice', 'up');
    expect(second.myVote).toBeNull();
    expect(second.tally).toEqual({ upvotes: 0, downvotes: 0, score: 0 });
  });

  it('flipping direction moves the vote instead of adding a second one', async () => {
    await PostVoteService.castVote('post-1', 'alice', 'up');
    const flipped = await PostVoteService.castVote('post-1', 'alice', 'down');
    expect(flipped.myVote).toBe('down');
    expect(flipped.tally).toEqual({ upvotes: 0, downvotes: 1, score: -1 });
  });

  // Regression test for the phantom-vote bug: `ensureBaseline` used to return
  // an *unwritten* `{0, 0}` baseline for a post that did not exist yet,
  // without ever stamping the `voteBaselineAt` guard on that first vote. The
  // advisory tally-hint written at the end of `writeVote` then left
  // `upvotes: 1` sitting on the post node with nothing marking it as a hint
  // rather than real legacy data — so the *second* vote's `ensureBaseline`
  // call froze that hint as if it were a pre-existing count, permanently
  // baking a phantom vote into the tally that nobody actually cast. This is
  // the "likes/upvotes/downvotes seem broken" symptom: two people upvoting a
  // brand-new post produced a total of 3, not 2.
  it('does not fabricate a phantom vote from its own advisory tally hint', async () => {
    const r1 = await PostVoteService.castVote('post-1', 'alice', 'up');
    expect(r1.tally).toEqual({ upvotes: 1, downvotes: 0, score: 1 });

    const r2 = await PostVoteService.castVote('post-1', 'bob', 'up');
    expect(r2.tally).toEqual({ upvotes: 2, downvotes: 0, score: 2 });

    const r3 = await PostVoteService.castVote('post-1', 'carol', 'up');
    expect(r3.tally).toEqual({ upvotes: 3, downvotes: 0, score: 3 });
  });

  it('keeps every distinct voter across many sequential votes', async () => {
    let tally;
    for (const user of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) {
      ({ tally } = await PostVoteService.castVote('post-2', user, 'up'));
    }
    expect(tally!.upvotes).toBe(7);
  });

  it('different posts do not share vote state', async () => {
    await PostVoteService.castVote('post-1', 'alice', 'up');
    await PostVoteService.castVote('post-2', 'alice', 'down');

    expect(await PostVoteService.getMyVote('post-1', 'alice')).toBe('up');
    expect(await PostVoteService.getMyVote('post-2', 'alice')).toBe('down');
  });

  it('clearVote removes the vote unconditionally', async () => {
    await PostVoteService.castVote('post-1', 'alice', 'down');
    const cleared = await PostVoteService.clearVote('post-1', 'alice');
    expect(cleared.myVote).toBeNull();
    expect(cleared.tally).toEqual({ upvotes: 0, downvotes: 0, score: 0 });
  });

  it('getTally matches the result of casting the votes', async () => {
    await PostVoteService.castVote('post-1', 'alice', 'up');
    await PostVoteService.castVote('post-1', 'bob', 'up');
    await PostVoteService.castVote('post-1', 'carol', 'down');

    const tally = await PostVoteService.getTally('post-1');
    expect(tally).toEqual({ upvotes: 2, downvotes: 1, score: 1 });
  });
});
