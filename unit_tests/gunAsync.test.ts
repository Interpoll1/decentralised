import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/config', () => ({
  default: { relay: { gun: 'http://relay.test/gun', websocket: 'ws://relay.test', api: 'http://relay.test' } },
}));

import { gunPut, gunOnce, gunReadChildren, verifySoulOnRelay, toGunRecord } from '../src/utils/gunAsync';

/** Minimal stand-in for a Gun chain node. */
function fakeNode(options: {
  putAck?: any;
  putSilent?: boolean;
  onceValue?: any;
  onceSilent?: boolean;
  children?: Array<[string, any, number]>;
} = {}) {
  return {
    put(_data: unknown, cb?: (ack: any) => void) {
      if (options.putSilent) return;
      setTimeout(() => cb?.(options.putAck ?? {}), 0);
    },
    once(cb: (data: any) => void) {
      if (options.onceSilent) return;
      setTimeout(() => cb(options.onceValue), 0);
    },
    map() {
      return {
        once(cb: (value: any, key: string) => void) {
          for (const [key, value, delay] of options.children ?? []) {
            setTimeout(() => cb(value, key), delay);
          }
          return { off() { /* detach */ } };
        },
      };
    },
  };
}

describe('gunPut', () => {
  it('resolves ok when Gun acks without an error', async () => {
    await expect(gunPut(fakeNode(), { a: 1 })).resolves.toEqual({ ok: true });
  });

  it('reports the error Gun returned rather than resolving ok', async () => {
    const ack = await gunPut(fakeNode({ putAck: { err: 'no peers' } }), { a: 1 });
    expect(ack).toEqual({ ok: false, err: 'no peers' });
  });

  it('settles on timeout instead of hanging when no ack ever arrives', async () => {
    const ack = await gunPut(fakeNode({ putSilent: true }), { a: 1 }, 40);
    expect(ack).toEqual({ ok: false, err: 'timeout' });
  });

  it('turns a throwing chain into a value, never a rejection', async () => {
    const exploding = { put() { throw new Error('chain is dead'); } };
    await expect(gunPut(exploding, {})).resolves.toMatchObject({ ok: false, err: 'chain is dead' });
  });
});

describe('gunOnce', () => {
  it('returns the value Gun delivered', async () => {
    await expect(gunOnce(fakeNode({ onceValue: { id: 'x' } }))).resolves.toEqual({ id: 'x' });
  });

  it('resolves null rather than hanging on a node no peer holds', async () => {
    await expect(gunOnce(fakeNode({ onceSilent: true }), 40)).resolves.toBeNull();
  });

  it('normalizes undefined to null', async () => {
    await expect(gunOnce(fakeNode({ onceValue: undefined }))).resolves.toBeNull();
  });
});

describe('gunReadChildren', () => {
  it('waits for quiet instead of a fixed stopwatch, so slow children still arrive', async () => {
    // The third child lands well after the old hard-coded 1500ms window that
    // used to silently truncate comment threads.
    const node = fakeNode({
      children: [['a', { v: 1 }, 0], ['b', { v: 2 }, 120], ['c', { v: 3 }, 300]],
    });
    const children = await gunReadChildren(node, { idleMs: 120, minMs: 100, maxMs: 3_000 });
    expect(children.map((c) => c.key).sort()).toEqual(['a', 'b', 'c']);
  });

  it('gives up at maxMs even while children keep trickling in', async () => {
    const trickle: Array<[string, any, number]> = [];
    for (let i = 0; i < 40; i++) trickle.push([`k${i}`, { v: i }, i * 50]);
    const started = Date.now();
    const children = await gunReadChildren(fakeNode({ children: trickle }), {
      idleMs: 200, minMs: 100, maxMs: 400,
    });
    expect(Date.now() - started).toBeLessThan(1_500);
    expect(children.length).toBeLessThan(40);
  });

  it('skips null children — Gun surfaces deleted entries that way', async () => {
    const node = fakeNode({ children: [['a', { v: 1 }, 0], ['gone', null, 10]] });
    const children = await gunReadChildren(node, { idleMs: 80, minMs: 60, maxMs: 1_000 });
    expect(children.map((c) => c.key)).toEqual(['a']);
  });

  it('returns an empty list for a node with no children instead of never settling', async () => {
    await expect(gunReadChildren(fakeNode(), { idleMs: 60, minMs: 60, maxMs: 500 }))
      .resolves.toEqual([]);
  });
});

describe('toGunRecord', () => {
  it('drops undefined and null so an all-empty node is never written', () => {
    // A node whose every value is null is empty, and Gun never acks an empty
    // put — the failure mode that once stopped polls replicating entirely.
    expect(toGunRecord({ a: 1, b: undefined, c: null })).toEqual({ a: 1 });
  });

  it('keeps primitives and drops nested objects and arrays', () => {
    expect(toGunRecord({
      s: 'x', n: 0, t: true, f: false,
      nested: { a: 1 }, list: [1, 2],
    })).toEqual({ s: 'x', n: 0, t: true, f: false });
  });
});

describe('verifySoulOnRelay', () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => { vi.useRealTimers(); });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('true when the relay reports it holds the soul', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200 })) as any;
    await expect(verifySoulOnRelay('v3/comments/abc', 2_000)).resolves.toBe(true);
  });

  it('false when the endpoint answers but does not have it — a real negative', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 404 })) as any;
    await expect(verifySoulOnRelay('v3/comments/abc', 1_000)).resolves.toBe(false);
  });

  it('null when the endpoint is unreachable, so callers retry instead of assuming loss', async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error('offline'); }) as any;
    await expect(verifySoulOnRelay('v3/comments/abc', 1_000)).resolves.toBeNull();
  });

  it('queries the relay origin with the soul encoded', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }));
    globalThis.fetch = fetchMock as any;
    await verifySoulOnRelay('v3/chats/a:b/msg-1', 2_000);
    expect(fetchMock.mock.calls[0][0]).toBe(
      'http://relay.test/db/soul?soul=v3%2Fchats%2Fa%3Ab%2Fmsg-1',
    );
  });
});
