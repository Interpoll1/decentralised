import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * `writeVote` used to throw on *any* non-ok Gun ack, including a bare timeout.
 * Gun's ack proves only that some peer answered in time — the record is in the
 * local graph and queued for the peers either way — so a timeout was rolling
 * back votes that had in fact been cast.
 */

const gunPut = vi.fn();
const gunOnce = vi.fn();
const gunReadChildren = vi.fn();

vi.mock('../src/utils/gunAsync', () => ({
  gunPut: (...args: any[]) => gunPut(...args),
  gunOnce: (...args: any[]) => gunOnce(...args),
  gunReadChildren: (...args: any[]) => gunReadChildren(...args),
}));

const { createDerivedVoteTally } = await import('../src/services/derivedVoteTally');

/** A Gun-shaped chain stub: every `.get()` returns another stub. */
function node(): any {
  const n: any = { get: () => node(), put: () => n, map: () => n, once: () => n, on: () => n };
  return n;
}

function makeTally() {
  return createDerivedVoteTally({
    contentNode: () => node(),
    votesNode: () => node(),
    mirrorNodes: () => [node()],
  });
}

describe('writeVote ack handling', () => {
  beforeEach(() => {
    gunPut.mockReset();
    gunOnce.mockReset();
    gunReadChildren.mockReset();
    // A content node with a frozen baseline, and no existing vote from this user.
    gunOnce.mockResolvedValue({ voteBaselineAt: 1, voteBaselineUp: 5, voteBaselineDown: 1 });
    gunReadChildren.mockResolvedValue([]);
  });

  it('records the vote when no peer acks in time, marked unconfirmed', async () => {
    gunPut.mockResolvedValue({ ok: false, err: 'timeout' });

    const result = await makeTally().castVote('post-1', 'user-1', 'up');

    expect(result.myVote).toBe('up');
    expect(result.confirmed).toBe(false);
    // Counts are advisory while unconfirmed, so the caller keeps its own.
    expect(result.tallyAuthoritative).toBe(false);
  });

  it('does not publish the advisory mirror for an unconfirmed write', async () => {
    gunPut.mockResolvedValue({ ok: false, err: 'timeout' });

    await makeTally().castVote('post-1', 'user-1', 'up');
    await new Promise((r) => setTimeout(r, 0));

    // Only the vote node was written — no mirror puts of upvotes/downvotes.
    expect(gunPut.mock.calls.some(([, data]: any[]) => 'upvotes' in data)).toBe(false);
  });

  it('still throws when a peer rejects the write', async () => {
    gunPut.mockResolvedValue({ ok: false, err: 'no permission' });

    await expect(makeTally().castVote('post-1', 'user-1', 'up')).rejects.toThrow('no permission');
  });

  it('reports an acked write as confirmed and authoritative', async () => {
    gunPut.mockResolvedValue({ ok: true });

    const result = await makeTally().castVote('post-1', 'user-1', 'up');

    expect(result.confirmed).toBe(true);
    expect(result.tallyAuthoritative).toBe(true);
    expect(result.tally).toEqual({ upvotes: 6, downvotes: 1, score: 5 });
  });
});
