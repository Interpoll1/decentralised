import { describe, it, expect } from 'vitest';
import { foldPollContentVotes, resolvePollOptionVotes } from '../src/services/pollService';

describe('foldPollContentVotes', () => {
  it('counts each voter once, independent of arrival order', () => {
    const votes = new Map([
      ['alice', 'up' as const],
      ['bob', 'up' as const],
      ['carol', 'down' as const],
    ]);
    expect(foldPollContentVotes(votes)).toEqual({ upvotes: 2, downvotes: 1, score: 1 });
  });

  it('ignores cleared votes', () => {
    const votes = new Map([
      ['alice', 'up' as const],
      ['bob', 'none' as const],
    ]);
    expect(foldPollContentVotes(votes)).toEqual({ upvotes: 1, downvotes: 0, score: 1 });
  });

  it('a flip moves the voter from one side to the other, not both', () => {
    const before = new Map([['alice', 'up' as const]]);
    expect(foldPollContentVotes(before)).toEqual({ upvotes: 1, downvotes: 0, score: 1 });

    const after = new Map([['alice', 'down' as const]]);
    expect(foldPollContentVotes(after)).toEqual({ upvotes: 0, downvotes: 1, score: -1 });
  });

  it('accepts a plain iterable of vote values as well as a Map', () => {
    expect(foldPollContentVotes(['up', 'up', 'down', 'none'])).toEqual({ upvotes: 2, downvotes: 1, score: 1 });
  });

  it('returns zero for an empty vote set', () => {
    expect(foldPollContentVotes(new Map())).toEqual({ upvotes: 0, downvotes: 0, score: 0 });
  });

  // The property that motivated the rewrite: the old `upvotes - 1` /
  // `downvotes + 1` read-modify-write on the poll node lost a vote whenever
  // two people voted within one round trip, because both writers read the
  // same scalar and both wrote the same N+1. Per-voter keys cannot collide.
  it('keeps every vote when many voters vote at once', () => {
    const votes = new Map(Array.from({ length: 60 }, (_, i) => [`voter-${i}`, 'up' as const]));
    expect(foldPollContentVotes(votes).upvotes).toBe(60);
  });

  it('a large simultaneous mix of up/down/clear tallies exactly', () => {
    const votes = new Map<string, 'up' | 'down' | 'none'>();
    for (let i = 0; i < 30; i++) votes.set(`up-${i}`, 'up');
    for (let i = 0; i < 12; i++) votes.set(`down-${i}`, 'down');
    for (let i = 0; i < 5; i++) votes.set(`cleared-${i}`, 'none');
    expect(foldPollContentVotes(votes)).toEqual({ upvotes: 30, downvotes: 12, score: 18 });
  });
});

describe('resolvePollOptionVotes', () => {
  it('prefers the derived voter-leaf count over the raw scalar when voters are present', () => {
    // Simulates the exact bug: the scalar under-counted (stuck at 1 after a
    // lost concurrent write) while the voter leaves — which cannot lose a
    // write — correctly hold 3.
    expect(resolvePollOptionVotes(1, ['a', 'b', 'c'])).toBe(3);
  });

  it('falls back to the raw scalar when no voter data came back', () => {
    expect(resolvePollOptionVotes(7, [])).toBe(7);
  });

  it('treats a missing/non-numeric scalar with no voters as zero', () => {
    expect(resolvePollOptionVotes(undefined, [])).toBe(0);
    expect(resolvePollOptionVotes('not-a-number', [])).toBe(0);
  });
});
