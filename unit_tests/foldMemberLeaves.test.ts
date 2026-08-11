import { describe, it, expect } from 'vitest';
import { foldMemberLeaves } from '../src/utils/gunAsync';

const leaf = (key: string, userId?: string) => ({ key, value: userId ? { userId } : true });

describe('foldMemberLeaves', () => {
  it('counts each member once, keyed by userId inside the leaf', () => {
    const entries = [leaf('a', 'alice'), leaf('b', 'bob'), leaf('c', 'carol')];
    expect(foldMemberLeaves(entries)).toBe(3);
  });

  it('falls back to the Gun key itself when the leaf has no userId field', () => {
    const entries = [{ key: 'alice', value: true }, { key: 'bob', value: true }];
    expect(foldMemberLeaves(entries)).toBe(2);
  });

  it('ignores the Gun metadata key ("_")', () => {
    const entries = [leaf('alice', 'alice'), { key: '_', value: { some: 'meta' } }];
    expect(foldMemberLeaves(entries)).toBe(1);
  });

  it('returns the fallback when there are no members at all', () => {
    expect(foldMemberLeaves([], 1)).toBe(1);
    expect(foldMemberLeaves([], 5)).toBe(5);
  });

  it('deduplicates the same member appearing under two different Gun keys', () => {
    // Can happen if a legacy write and a new-scheme write both exist for the
    // same person — the userId inside the leaf is the source of truth.
    const entries = [leaf('legacy-key-1', 'alice'), leaf('new-key-2', 'alice')];
    expect(foldMemberLeaves(entries)).toBe(1);
  });

  // The property that motivated the rewrite: the old `memberCount + 1`
  // read-modify-write lost a join whenever two people joined within one round
  // trip, because both writers read the same scalar and wrote the same N+1.
  // Per-member keys cannot collide.
  it('keeps every join when many members join at once', () => {
    const entries = Array.from({ length: 40 }, (_, i) => leaf(`u${i}`, `user-${i}`));
    expect(foldMemberLeaves(entries)).toBe(40);
  });
});
