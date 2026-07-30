import { describe, it, expect } from 'vitest';
import { compareMessages, sortMessages } from '../src/utils/messageOrder';

// Ordering used to be `a.timestamp - b.timestamp` alone. Timestamps come from
// whichever device sent the message, so a skewed clock reordered a conversation
// differently on every screen, and same-millisecond messages had no defined
// order at all — the "chats are horrible" symptom of messages jumping around.

describe('compareMessages', () => {
  it('orders by timestamp first', () => {
    const a = { id: 'z', senderId: 'alice', timestamp: 100, seq: 9 };
    const b = { id: 'a', senderId: 'bob', timestamp: 200, seq: 1 };
    expect(compareMessages(a, b)).toBeLessThan(0);
  });

  it("uses the sender's own counter for their own same-millisecond messages", () => {
    const first = { id: 'msg-zz', senderId: 'alice', timestamp: 100, seq: 1 };
    const second = { id: 'msg-aa', senderId: 'alice', timestamp: 100, seq: 2 };
    // Alphabetically 'msg-aa' sorts first, but Alice sent it second.
    expect(compareMessages(first, second)).toBeLessThan(0);
  });

  it('ignores seq across different senders — the counters are unrelated', () => {
    const alice = { id: 'msg-a', senderId: 'alice', timestamp: 100, seq: 900 };
    const bob = { id: 'msg-b', senderId: 'bob', timestamp: 100, seq: 1 };
    // Falls through to the id tiebreak, not to 900 vs 1.
    expect(compareMessages(alice, bob)).toBeLessThan(0);
  });

  it('is deterministic for ties, so both devices render the same order', () => {
    const x = { id: 'msg-1', senderId: 'alice', timestamp: 100, seq: 1 };
    const y = { id: 'msg-2', senderId: 'bob', timestamp: 100, seq: 1 };
    expect(compareMessages(x, y)).toBeLessThan(0);
    expect(compareMessages(y, x)).toBeGreaterThan(0);
    expect(compareMessages(x, { ...x })).toBe(0);
  });

  it('handles messages with no seq (legacy rows) without reordering by it', () => {
    const older = { id: 'msg-b', senderId: 'alice', timestamp: 100 };
    const newer = { id: 'msg-a', senderId: 'alice', timestamp: 100 };
    expect(compareMessages(older, newer)).toBeGreaterThan(0);
  });

  it('produces the same sequence regardless of input order', () => {
    const messages = [
      { id: 'm3', senderId: 'bob', timestamp: 300, seq: 1 },
      { id: 'm1', senderId: 'alice', timestamp: 100, seq: 1 },
      { id: 'm2b', senderId: 'alice', timestamp: 200, seq: 3 },
      { id: 'm2a', senderId: 'alice', timestamp: 200, seq: 2 },
    ];
    const forward = sortMessages(messages).map(m => m.id);
    const backward = sortMessages([...messages].reverse()).map(m => m.id);

    expect(forward).toEqual(['m1', 'm2a', 'm2b', 'm3']);
    expect(backward).toEqual(forward);
  });

  it('does not mutate the input array', () => {
    const messages = [
      { id: 'b', senderId: 'x', timestamp: 2 },
      { id: 'a', senderId: 'x', timestamp: 1 },
    ];
    sortMessages(messages);
    expect(messages.map(m => m.id)).toEqual(['b', 'a']);
  });
});
