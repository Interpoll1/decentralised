/**
 * A Map with a size ceiling and optional per-entry TTL.
 *
 * Most of the app's service-level caches were plain `Map`s that only ever grew:
 * one entry per post, comment, community, pubkey or message the session had ever
 * touched, with no eviction path at any memory-pressure level. Over a long
 * session that is the dominant source of heap growth, and the memory watchdog
 * could not reach any of it.
 *
 * Deliberately Map-compatible (`get`/`set`/`has`/`delete`/`clear`/`size`/`keys`/
 * `values`/`entries`/`forEach`/iterator) so existing call sites change by their
 * construction line alone.
 *
 * Eviction is least-recently-used: `get()` and `set()` both mark an entry as
 * recently used by reinserting it, which moves it to the end of the JS Map's
 * insertion order, so the oldest key is always the first one iteration yields.
 */

export interface BoundedMapOptions {
  /** Maximum live entries. The least-recently-used entry is dropped on overflow. */
  maxSize: number;
  /** Optional entry lifetime in ms. Expired entries read as absent and are dropped lazily. */
  ttlMs?: number;
  /** Optional callback invoked when an entry is evicted for size or age (not on explicit delete/clear). */
  onEvict?: (key: any, value: any) => void;
}

interface Entry<V> {
  value: V;
  /** Epoch ms at which this entry was written; only meaningful when ttlMs is set. */
  storedAt: number;
}

export class BoundedMap<K, V> {
  private readonly store = new Map<K, Entry<V>>();
  private readonly maxSize: number;
  private readonly ttlMs: number | undefined;
  private readonly onEvict: ((key: K, value: V) => void) | undefined;

  constructor(options: BoundedMapOptions) {
    this.maxSize = Math.max(1, Math.floor(options.maxSize));
    this.ttlMs = options.ttlMs;
    this.onEvict = options.onEvict as ((key: K, value: V) => void) | undefined;
  }

  private isExpired(entry: Entry<V>): boolean {
    return this.ttlMs !== undefined && Date.now() - entry.storedAt > this.ttlMs;
  }

  get(key: K): V | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (this.isExpired(entry)) {
      this.store.delete(key);
      this.onEvict?.(key, entry.value);
      return undefined;
    }
    // Mark as recently used: delete + re-set moves the key to the end of the
    // Map's insertion order, which is what makes the LRU victim selection in
    // set() correct.
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value;
  }

  /** Read without affecting LRU order — for diagnostics and bulk scans. */
  peek(key: K): V | undefined {
    const entry = this.store.get(key);
    if (!entry || this.isExpired(entry)) return undefined;
    return entry.value;
  }

  set(key: K, value: V): this {
    if (this.store.has(key)) this.store.delete(key);
    this.store.set(key, { value, storedAt: Date.now() });

    while (this.store.size > this.maxSize) {
      const oldest = this.store.keys().next();
      if (oldest.done) break;
      const evicted = this.store.get(oldest.value);
      this.store.delete(oldest.value);
      if (evicted) this.onEvict?.(oldest.value, evicted.value);
    }
    return this;
  }

  has(key: K): boolean {
    const entry = this.store.get(key);
    if (!entry) return false;
    if (this.isExpired(entry)) {
      this.store.delete(key);
      this.onEvict?.(key, entry.value);
      return false;
    }
    return true;
  }

  delete(key: K): boolean {
    return this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }

  /**
   * Drop every expired entry now. Lazy expiry only reclaims entries that are read
   * again, so a cache that has gone cold holds its memory indefinitely; the memory
   * watchdog calls this on `light` pressure. Returns the number of entries dropped.
   */
  prune(): number {
    if (this.ttlMs === undefined) return 0;
    let dropped = 0;
    for (const [key, entry] of Array.from(this.store.entries())) {
      if (this.isExpired(entry)) {
        this.store.delete(key);
        this.onEvict?.(key, entry.value);
        dropped++;
      }
    }
    return dropped;
  }

  /** Shrink to at most `n` entries, dropping least-recently-used first. */
  trimTo(n: number): number {
    let dropped = 0;
    while (this.store.size > Math.max(0, n)) {
      const oldest = this.store.keys().next();
      if (oldest.done) break;
      const evicted = this.store.get(oldest.value);
      this.store.delete(oldest.value);
      if (evicted) this.onEvict?.(oldest.value, evicted.value);
      dropped++;
    }
    return dropped;
  }

  // ── Map-compatible iteration (skips expired entries) ───────────────────────

  *entries(): IterableIterator<[K, V]> {
    for (const [key, entry] of this.store.entries()) {
      if (!this.isExpired(entry)) yield [key, entry.value];
    }
  }

  *keys(): IterableIterator<K> {
    for (const [key] of this.entries()) yield key;
  }

  *values(): IterableIterator<V> {
    for (const [, value] of this.entries()) yield value;
  }

  forEach(cb: (value: V, key: K, map: BoundedMap<K, V>) => void): void {
    for (const [key, value] of this.entries()) cb(value, key, this);
  }

  [Symbol.iterator](): IterableIterator<[K, V]> {
    return this.entries();
  }
}

/**
 * A Set with a size ceiling and optional TTL, built on BoundedMap. Used for the
 * "have I already seen this id" guards, which are the purest unbounded growth
 * case in the codebase — one entry per message/nonce/signal, forever.
 */
export class BoundedSet<T> {
  private readonly map: BoundedMap<T, true>;

  constructor(options: BoundedMapOptions) {
    this.map = new BoundedMap<T, true>(options);
  }

  add(value: T): this { this.map.set(value, true); return this; }
  has(value: T): boolean { return this.map.has(value); }
  delete(value: T): boolean { return this.map.delete(value); }
  clear(): void { this.map.clear(); }
  prune(): number { return this.map.prune(); }
  trimTo(n: number): number { return this.map.trimTo(n); }
  get size(): number { return this.map.size; }
  values(): IterableIterator<T> { return this.map.keys(); }
  [Symbol.iterator](): IterableIterator<T> { return this.map.keys(); }
}
