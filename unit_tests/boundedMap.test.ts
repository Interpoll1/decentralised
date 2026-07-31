import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BoundedMap, BoundedSet } from '@/utils/boundedMap';

describe('BoundedMap', () => {
  it('stores and reads values like a Map', () => {
    const m = new BoundedMap<string, number>({ maxSize: 10 });
    m.set('a', 1).set('b', 2);
    expect(m.get('a')).toBe(1);
    expect(m.has('b')).toBe(true);
    expect(m.size).toBe(2);
    expect(m.get('missing')).toBeUndefined();
  });

  it('evicts the least-recently-used entry past maxSize', () => {
    const m = new BoundedMap<string, number>({ maxSize: 3 });
    m.set('a', 1).set('b', 2).set('c', 3);
    m.set('d', 4);
    expect(m.size).toBe(3);
    expect(m.has('a')).toBe(false);
    expect(m.has('d')).toBe(true);
  });

  it('counts a read as a use, so the read key survives eviction', () => {
    const m = new BoundedMap<string, number>({ maxSize: 3 });
    m.set('a', 1).set('b', 2).set('c', 3);
    m.get('a');       // 'a' is now most-recently-used, 'b' is oldest
    m.set('d', 4);
    expect(m.has('a')).toBe(true);
    expect(m.has('b')).toBe(false);
  });

  it('peek does not affect LRU order', () => {
    const m = new BoundedMap<string, number>({ maxSize: 3 });
    m.set('a', 1).set('b', 2).set('c', 3);
    m.peek('a');
    m.set('d', 4);
    expect(m.has('a')).toBe(false);
  });

  it('re-setting an existing key does not grow the map', () => {
    const m = new BoundedMap<string, number>({ maxSize: 2 });
    m.set('a', 1).set('a', 2).set('a', 3);
    expect(m.size).toBe(1);
    expect(m.get('a')).toBe(3);
  });

  it('notifies onEvict for size eviction but not explicit delete', () => {
    const onEvict = vi.fn();
    const m = new BoundedMap<string, number>({ maxSize: 1, onEvict });
    m.set('a', 1).set('b', 2);
    expect(onEvict).toHaveBeenCalledWith('a', 1);
    onEvict.mockClear();
    m.delete('b');
    expect(onEvict).not.toHaveBeenCalled();
  });

  it('trimTo drops least-recently-used first', () => {
    const m = new BoundedMap<string, number>({ maxSize: 10 });
    m.set('a', 1).set('b', 2).set('c', 3);
    expect(m.trimTo(1)).toBe(2);
    expect(m.has('c')).toBe(true);
    expect(m.has('a')).toBe(false);
  });

  it('iteration yields live entries', () => {
    const m = new BoundedMap<string, number>({ maxSize: 10 });
    m.set('a', 1).set('b', 2);
    expect([...m.keys()].sort()).toEqual(['a', 'b']);
    expect([...m.values()].sort()).toEqual([1, 2]);
    expect([...m].length).toBe(2);
    const seen: string[] = [];
    m.forEach((_v, k) => seen.push(k));
    expect(seen.sort()).toEqual(['a', 'b']);
  });

  describe('TTL', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('treats expired entries as absent', () => {
      const m = new BoundedMap<string, number>({ maxSize: 10, ttlMs: 1000 });
      m.set('a', 1);
      expect(m.get('a')).toBe(1);
      vi.advanceTimersByTime(1500);
      expect(m.get('a')).toBeUndefined();
      expect(m.has('a')).toBe(false);
      expect(m.size).toBe(0);
    });

    it('prune reclaims cold expired entries that are never read again', () => {
      const m = new BoundedMap<string, number>({ maxSize: 10, ttlMs: 1000 });
      m.set('a', 1).set('b', 2);
      vi.advanceTimersByTime(1500);
      // Nothing has read them, so lazy expiry has not fired — this is the case
      // that previously retained memory indefinitely.
      expect(m.size).toBe(2);
      expect(m.prune()).toBe(2);
      expect(m.size).toBe(0);
    });

    it('prune is a no-op without a TTL', () => {
      const m = new BoundedMap<string, number>({ maxSize: 10 });
      m.set('a', 1);
      expect(m.prune()).toBe(0);
      expect(m.size).toBe(1);
    });

    it('expired entries are skipped by iteration', () => {
      const m = new BoundedMap<string, number>({ maxSize: 10, ttlMs: 1000 });
      m.set('a', 1);
      vi.advanceTimersByTime(1500);
      m.set('b', 2);
      expect([...m.keys()]).toEqual(['b']);
    });
  });
});

describe('BoundedSet', () => {
  it('bounds membership tracking', () => {
    const s = new BoundedSet<string>({ maxSize: 2 });
    s.add('a').add('b').add('c');
    expect(s.size).toBe(2);
    expect(s.has('a')).toBe(false);
    expect(s.has('c')).toBe(true);
  });

  it('expires entries by TTL', () => {
    vi.useFakeTimers();
    try {
      const s = new BoundedSet<string>({ maxSize: 10, ttlMs: 500 });
      s.add('a');
      expect(s.has('a')).toBe(true);
      vi.advanceTimersByTime(800);
      expect(s.has('a')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
