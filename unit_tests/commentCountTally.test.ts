import { describe, it, expect } from 'vitest';
import { foldCommentIds } from '../src/services/commentService';

describe('foldCommentIds', () => {
  it('unions the relay index and the local mirror without double-counting', () => {
    expect(foldCommentIds(['a', 'b'], ['b', 'c'])).toBe(3);
  });

  it('counts correctly when one source is empty', () => {
    expect(foldCommentIds([], ['a', 'b', 'c'])).toBe(3);
    expect(foldCommentIds(['a', 'b', 'c'], [])).toBe(3);
  });

  it('returns zero when both sources are empty', () => {
    expect(foldCommentIds([], [])).toBe(0);
  });

  it('is independent of arrival order between the two sources', () => {
    const a = foldCommentIds(['x', 'y', 'z'], ['y', 'w']);
    const b = foldCommentIds(['y', 'w'], ['x', 'y', 'z']);
    expect(a).toBe(4);
    expect(b).toBe(4);
  });

  // The property that motivated the rewrite: the old `commentCount + 1`
  // read-modify-write on the post node lost a comment whenever two landed
  // within one round trip. Deriving the count from the comment index (a set
  // of distinct comment ids) cannot lose an entry the same way.
  it('reflects every comment when many land at once, regardless of the old race', () => {
    const ids = Array.from({ length: 45 }, (_, i) => `comment-${i}`);
    expect(foldCommentIds(ids, [])).toBe(45);
  });
});
