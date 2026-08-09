import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Content votes — up/down on a post or a poll card — derived from per-user vote
 * nodes rather than a mutable counter.
 *
 * These exercise the paths that made scores visibly wrong: a poll whose legacy
 * total was read off the wrong Gun node (`posts/<id>` holds only a category
 * patch for a poll, so its total is zero), a toggle-off that has to survive as
 * an explicit tombstone because Gun deletes do not propagate, and simultaneous
 * voters who must not overwrite one another.
 */

vi.mock('../src/config', () => ({
  default: { relay: { gun: 'http://relay.test/gun', websocket: 'ws://relay.test', api: 'http://relay.test' } },
}));

// An in-memory stand-in for the Gun graph: nested plain objects, `put` merges,
// `once` reads, `map()` walks children. Enough of the chain API for the tally
// paths, and — unlike the real thing — deterministic.
type Graph = Record<string, any>;
const graph: Graph = {};

function nodeAt(path: string[], create = false): any {
  let cursor: any = graph;
  for (const key of path) {
    if (cursor[key] === undefined) {
      if (!create) return undefined;
      cursor[key] = {};
    }
    cursor = cursor[key];
  }
  return cursor;
}

function chain(path: string[]): any {
  return {
    get(key: string) { return chain([...path, key]); },
    put(data: any, cb?: (ack: any) => void) {
      const target = nodeAt(path, true);
      if (data === null) {
        const parent = nodeAt(path.slice(0, -1), true);
        delete parent[path[path.length - 1]];
      } else {
        Object.assign(target, data);
      }
      cb?.({ ok: 1 });
      return chain(path);
    },
    once(cb: (data: any) => void) {
      cb(nodeAt(path) ?? undefined);
      return chain(path);
    },
    map() {
      const walk = (cb: (value: any, key: string) => void) => {
        const target = nodeAt(path);
        if (target && typeof target === 'object') {
          for (const [key, value] of Object.entries(target)) cb(value, key);
        }
        return { off() { /* detach */ } };
      };
      return { once: walk, on: walk };
    },
  };
}

vi.mock('../src/services/gunService', () => ({
  GUN_NAMESPACE: 'v3',
  GunService: {
    getGun: () => chain([]),
    onReconnect: () => () => { /* no reconnects in tests */ },
  },
}));

import { PostVoteService } from '../src/services/postVoteService';

beforeEach(() => {
  for (const key of Object.keys(graph)) delete graph[key];
});

describe('PostVoteService baselines', () => {
  it('freezes a post baseline from the post node and adds derived votes on top', async () => {
    chain(['posts', 'post-1']).put({ id: 'post-1', upvotes: 40, downvotes: 3 });

    const { tally } = await PostVoteService.castVote('post-1', 'alice', 'up');

    expect(tally).toEqual({ upvotes: 41, downvotes: 3, score: 38 });
    expect(graph.posts['post-1'].voteBaselineUp).toBe(40);
  });

  // A poll's `posts/<id>` node carries only its category patch; the real
  // counters live under `polls/<id>`. Reading the wrong one silently reset every
  // existing poll's score to whatever had been cast since the migration.
  it('freezes a poll baseline from the polls node, not the posts node', async () => {
    chain(['polls', 'poll-1']).put({ id: 'poll-1', upvotes: 12, downvotes: 2 });
    chain(['posts', 'poll-1']).put({ category: 'news' });

    const { tally } = await PostVoteService.castVote('poll-1', 'alice', 'up');

    expect(tally).toEqual({ upvotes: 13, downvotes: 2, score: 11 });
    expect(graph.polls['poll-1'].voteBaselineUp).toBe(12);
    expect(graph.posts['poll-1'].voteBaselineUp).toBeUndefined();
  });

  it('never rewrites a baseline once frozen, so later mirror writes cannot move it', async () => {
    chain(['posts', 'post-1']).put({ id: 'post-1', upvotes: 40, downvotes: 0 });

    await PostVoteService.castVote('post-1', 'alice', 'up');
    // The advisory mirror writes 41 back onto the node; a second voter must add
    // to the frozen 40, not re-freeze 41.
    const { tally } = await PostVoteService.castVote('post-1', 'bob', 'up');

    expect(tally).toEqual({ upvotes: 42, downvotes: 0, score: 42 });
  });

  // A pre-migration poll voter is already inside the frozen baseline, so their
  // first vote under the new scheme has to subtract that old one. The legacy
  // poll key is shaped differently from the post one — miss it and the baseline
  // counts them twice.
  it('subtracts a pre-migration poll vote from the baseline when the voter flips it', async () => {
    chain(['polls', 'poll-1']).put({ id: 'poll-1', upvotes: 12, downvotes: 0 });
    chain(['votes', 'vote_alice_poll_poll-1']).put({ type: 'up', userId: 'alice' });

    const flipped = await PostVoteService.castVote('poll-1', 'alice', 'down');

    expect(flipped.myVote).toBe('down');
    expect(flipped.tally).toEqual({ upvotes: 11, downvotes: 1, score: 10 });
  });

  it('treats a click matching a pre-migration poll vote as clearing it', async () => {
    chain(['polls', 'poll-1']).put({ id: 'poll-1', upvotes: 12, downvotes: 0 });
    chain(['votes', 'vote_alice_poll_poll-1']).put({ type: 'up', userId: 'alice' });

    const cleared = await PostVoteService.castVote('poll-1', 'alice', 'up');

    expect(cleared.myVote).toBeNull();
    expect(cleared.tally).toEqual({ upvotes: 11, downvotes: 0, score: 11 });
  });
});

describe('PostVoteService toggling', () => {
  it('clears a vote by writing a tombstone rather than deleting the node', async () => {
    chain(['posts', 'post-1']).put({ id: 'post-1', upvotes: 0, downvotes: 0 });

    await PostVoteService.castVote('post-1', 'alice', 'up');
    const { tally, myVote } = await PostVoteService.castVote('post-1', 'alice', 'up');

    expect(myVote).toBeNull();
    expect(tally).toEqual({ upvotes: 0, downvotes: 0, score: 0 });
    // The node must still exist — a Gun delete would not reach other peers.
    expect(graph.postVotes['post-1'].alice.type).toBe('none');
  });

  it('moves one across when a voter switches sides, rather than counting both', async () => {
    chain(['posts', 'post-1']).put({ id: 'post-1', upvotes: 0, downvotes: 0 });

    await PostVoteService.castVote('post-1', 'alice', 'up');
    const { tally, myVote } = await PostVoteService.castVote('post-1', 'alice', 'down');

    expect(myVote).toBe('down');
    expect(tally).toEqual({ upvotes: 0, downvotes: 1, score: -1 });
  });

  // The property the whole scheme exists for: the old read-modify-write counter
  // lost a vote whenever two landed inside one round trip.
  it('keeps every vote when many users vote at once', async () => {
    chain(['posts', 'post-1']).put({ id: 'post-1', upvotes: 0, downvotes: 0 });

    await Promise.all(
      Array.from({ length: 20 }, (_, i) => PostVoteService.castVote('post-1', `user-${i}`, 'up')),
    );

    expect((await PostVoteService.getTally('post-1')).upvotes).toBe(20);
  });

  it('reports the graph’s answer for myVote, not the direction that was clicked', async () => {
    chain(['posts', 'post-1']).put({ id: 'post-1', upvotes: 0, downvotes: 0 });
    // A vote cast elsewhere (another device, another tab) that the UI has no
    // record of. Clicking "up" is a *clear*, and the caller must be told so.
    chain(['postVotes', 'post-1', 'alice']).put({ type: 'up', userId: 'alice' });

    const { myVote } = await PostVoteService.castVote('post-1', 'alice', 'up');

    expect(myVote).toBeNull();
  });
});

describe('PostVoteService.getTally', () => {
  it('reports the legacy counters until someone votes under the new scheme', async () => {
    chain(['posts', 'post-1']).put({ id: 'post-1', upvotes: 7, downvotes: 1 });
    expect(await PostVoteService.getTally('post-1')).toEqual({ upvotes: 7, downvotes: 1, score: 6 });
  });

  it('reads a poll’s legacy counters from the polls node', async () => {
    chain(['polls', 'poll-1']).put({ id: 'poll-1', upvotes: 9, downvotes: 4 });
    expect(await PostVoteService.getTally('poll-1')).toEqual({ upvotes: 9, downvotes: 4, score: 5 });
  });
});

/**
 * Comment votes share the same folding rule. The regression worth pinning: the
 * stored counters used to be honoured *only while no vote node existed at all*,
 * so the first vote cast under the new scheme threw the whole previous total
 * away — a comment sitting at 12 dropped to 1 the moment anyone touched it.
 */
describe('comment vote tallies', () => {
  it('keeps the pre-existing total when the first new vote lands', async () => {
    const { CommentService } = await import('../src/services/commentService');
    chain(['comments', 'comment_1']).put({ id: 'comment_1', upvotes: 12, downvotes: 0 });

    const { tally, myVote } = await CommentService.voteOnComment('comment_1', 'up', 'alice');

    expect(myVote).toBe('up');
    expect(tally).toEqual({ upvotes: 13, downvotes: 0, score: 13 });
  });

  it('reports the tally and this user’s own vote from one pass over the vote set', async () => {
    const { CommentService } = await import('../src/services/commentService');
    chain(['comments', 'comment_1']).put({ id: 'comment_1', upvotes: 0, downvotes: 0 });
    chain(['commentVotes', 'comment_1', 'alice']).put({ type: 'up', userId: 'alice' });
    chain(['commentVotes', 'comment_1', 'bob']).put({ type: 'down', userId: 'bob' });
    chain(['commentVotes', 'comment_1', 'carol']).put({ type: 'none', userId: 'carol' });

    const state = await CommentService.getCommentVoteState('comment_1', 'bob');

    expect(state.tally).toEqual({ upvotes: 1, downvotes: 1, score: 0 });
    expect(state.myVote).toBe('down');
  });

  it('clears with a tombstone so the vote does not come back on the next sync', async () => {
    const { CommentService } = await import('../src/services/commentService');
    chain(['comments', 'comment_1']).put({ id: 'comment_1', upvotes: 0, downvotes: 0 });

    await CommentService.voteOnComment('comment_1', 'up', 'alice');
    const { tally, myVote } = await CommentService.voteOnComment('comment_1', 'up', 'alice');

    expect(myVote).toBeNull();
    expect(tally).toEqual({ upvotes: 0, downvotes: 0, score: 0 });
    expect(graph.commentVotes['comment_1'].alice.type).toBe('none');
  });
});
