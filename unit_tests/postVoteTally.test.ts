import { describe, it, expect } from 'vitest';
import { foldVotes } from '../src/services/postVoteService';

type Node = { vote: 'up' | 'down' | 'none' | null; baselineType: 'up' | 'down' | null };

const node = (vote: Node['vote'], baselineType: Node['baselineType'] = null): Node => ({ vote, baselineType });

describe('foldVotes', () => {
  const empty = { up: 0, down: 0 };

  it('counts each user once, independent of arrival order', () => {
    const nodes = [node('up'), node('up'), node('down')];
    expect(foldVotes(empty, nodes)).toEqual({ upvotes: 2, downvotes: 1, score: 1 });
    expect(foldVotes(empty, [...nodes].reverse())).toEqual({ upvotes: 2, downvotes: 1, score: 1 });
  });

  it("ignores cleared votes and nodes it can't parse", () => {
    expect(foldVotes(empty, [node('up'), node('none'), node(null)]))
      .toEqual({ upvotes: 1, downvotes: 0, score: 1 });
  });

  it('reports the legacy counters when nobody has voted under the new scheme', () => {
    expect(foldVotes({ up: 40, down: 3 }, [])).toEqual({ upvotes: 40, downvotes: 3, score: 37 });
  });

  it('adds new votes on top of the frozen baseline rather than replacing it', () => {
    expect(foldVotes({ up: 40, down: 3 }, [node('up')]))
      .toEqual({ upvotes: 41, downvotes: 3, score: 38 });
  });

  // A user whose pre-migration vote is already inside the baseline carries a
  // `baselineType` correction, so migrating their vote must not double-count it.
  describe('baseline corrections', () => {
    it('nets zero when a pre-existing vote is migrated unchanged', () => {
      expect(foldVotes({ up: 40, down: 0 }, [node('up', 'up')]))
        .toEqual({ upvotes: 40, downvotes: 0, score: 40 });
    });

    it('removes one when a pre-existing vote is cleared', () => {
      expect(foldVotes({ up: 40, down: 0 }, [node('none', 'up')]))
        .toEqual({ upvotes: 39, downvotes: 0, score: 39 });
    });

    it('moves one across when a pre-existing vote is flipped', () => {
      expect(foldVotes({ up: 40, down: 3 }, [node('down', 'up')]))
        .toEqual({ upvotes: 39, downvotes: 4, score: 35 });
    });
  });

  it('never reports a negative count when the baseline disagrees with the corrections', () => {
    expect(foldVotes(empty, [node('none', 'up'), node('none', 'up')]))
      .toEqual({ upvotes: 0, downvotes: 0, score: 0 });
  });

  // The property that motivated the rewrite: the old read-modify-write lost a
  // vote whenever two landed inside one round trip. Distinct keys cannot.
  it('keeps every vote when many users vote at once', () => {
    const nodes = Array.from({ length: 50 }, () => node('up'));
    expect(foldVotes(empty, nodes).upvotes).toBe(50);
  });
});
