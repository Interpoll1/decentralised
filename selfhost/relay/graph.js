/**
 * graph.js — everything this relay knows about the Gun graph.
 *
 * The browser runs Gun with `{localStorage:false, radisk:false}`
 * (src/services/gunService.ts), so the relay is the *only* durable store on a
 * self-hosted instance. Gun's radisk handles the bytes; this module adds the
 * three things radisk cannot answer on its own:
 *
 *   1. a soul index (which souls exist, when they were first seen) so the
 *      `/db/search?prefix=` and `/api/*` read routes have something to list;
 *   2. node resolution (following `{'#': soul}` refs) so a poll can be returned
 *      as one JSON object with its options inlined;
 *   3. TTL expiry — the point of the whole branch: content that ages out is
 *      dropped from the index and nulled in the graph.
 */

import fs from 'fs';
import path from 'path';
import config from './env.js';

const INDEX_FILE = 'soul-index.json';
/** Souls we never expire — they are instance plumbing, not user content. */
const PERMANENT_PREFIXES = ['v3/server-config', 'server-config'];

/** soul → { firstSeen, lastSeen } */
const index = new Map();
/**
 * soul → merged field values, mirroring every put we have seen.
 *
 * Gun's own `.once()` is not a reliable read path on a relay: with radisk off
 * (EPHEMERAL) there is no store behind it at all, and with radisk on it costs a
 * disk round-trip per node. Since the wire hook already sees every put, keeping
 * the merged result is both cheaper and the only thing that makes an in-memory
 * instance readable.
 */
const cache = new Map();
const MAX_CACHED_NODES = 50_000;
let gun = null;
let dirty = false;
let flushTimer = null;
let sweepTimer = null;

function indexPath() {
  return path.join(config.dataDir, INDEX_FILE);
}

function isPermanent(soul) {
  // Collection nodes (`v3`, `v3/polls`) are the routes to everything else — if
  // they aged out, live content would stop being reachable by traversal.
  if (soul.split('/').length < 3) return true;
  return PERMANENT_PREFIXES.some(p => soul.startsWith(p));
}

function loadIndex() {
  if (config.ephemeral) return;
  try {
    const raw = fs.readFileSync(indexPath(), 'utf8');
    const parsed = JSON.parse(raw);
    for (const [soul, meta] of Object.entries(parsed)) {
      if (meta && typeof meta.firstSeen === 'number') index.set(soul, meta);
    }
  } catch {
    // No index yet (first run) or it was corrupted — rebuilt from live traffic.
  }
}

function flushIndex() {
  if (config.ephemeral || !dirty) return;
  dirty = false;
  try {
    fs.mkdirSync(config.dataDir, { recursive: true });
    const out = {};
    for (const [soul, meta] of index) out[soul] = meta;
    fs.writeFileSync(indexPath(), JSON.stringify(out), 'utf8');
  } catch (err) {
    console.warn('[graph] could not persist soul index:', err.message);
  }
}

/** Real souls only — never the `#`/`.`/`:`/`>` keys of a leaf-diff message. */
const SOUL_PATTERN = /^[A-Za-z0-9_\-~][A-Za-z0-9_\-./:~+=]{0,999}$/;

function touch(soul) {
  if (typeof soul !== 'string' || !SOUL_PATTERN.test(soul)) return;
  const now = Date.now();
  const existing = index.get(soul);
  if (existing) {
    existing.lastSeen = now;
  } else {
    index.set(soul, { firstSeen: now, lastSeen: now });
  }
  dirty = true;
}

/**
 * Attach to a live Gun instance. The wire hook sees every `put` that passes
 * through the relay — from browsers, from other relays, and from our own
 * writes — which is exactly the set of souls this instance holds.
 */
export function attach(gunInstance) {
  gun = gunInstance;
  loadIndex();

  gun.on('put', function (msg) {
    this.to.next(msg);
    const put = msg && msg.put;
    if (!put || typeof put !== 'object') return;

    // Gun puts arrive in two shapes on the wire: a full graph
    // (`{soul: {_:…, field: value}}`) and a single-leaf diff
    // (`{'#':soul, '.':key, ':':value, '>':state}`). Indexing only the first
    // silently misses every incremental write a browser makes.
    if (typeof put['#'] === 'string' && typeof put['.'] === 'string') {
      touch(put['#']);
      merge(put['#'], { [put['.']]: put[':'] });
      return;
    }
    for (const [soul, node] of Object.entries(put)) {
      touch(soul);
      merge(soul, node);
    }
  });

  if (!config.ephemeral) {
    flushTimer = setInterval(flushIndex, 10_000);
    if (flushTimer.unref) flushTimer.unref();
  }
  startSweeper();
}

/** Fold one put into the node cache. `null` values are Gun's tombstones. */
function merge(soul, node) {
  if (!index.has(soul) || !node || typeof node !== 'object') return;
  let entry = cache.get(soul);
  if (!entry) {
    if (cache.size >= MAX_CACHED_NODES) {
      // Oldest-first eviction; evicted nodes fall back to the Gun read path.
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    entry = {};
    cache.set(soul, entry);
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === '_') continue;
    if (value === null) {
      delete entry[key];
    } else if (value && typeof value === 'object') {
      // Gun stores any nested object as its own node under `<soul>/<key>`, so
      // the cache holds a ref rather than an inline copy. Inlining it would go
      // stale the moment someone writes to the child — which is exactly what a
      // vote does to `…/options/<n>`.
      entry[key] = { '#': typeof value['#'] === 'string' ? value['#'] : `${soul}/${key}` };
    } else {
      entry[key] = value;
    }
  }
}

/** Read one node by soul. Resolves to `null` if the relay does not hold it. */
export function readSoul(soul, timeoutMs = 1500) {
  const cached = cache.get(soul);
  if (cached && Object.keys(cached).length > 0) return Promise.resolve({ ...cached });
  // The index — not radisk — is the authority on what this instance still
  // serves. Without this check an expired soul would come straight back from
  // disk on the next read and TTL would be decorative.
  if (!gun || !index.has(soul)) return Promise.resolve(null);
  return new Promise(resolve => {
    let settled = false;
    const done = value => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => done(null), timeoutMs);
    try {
      gun.get(soul).once(data => {
        if (data === undefined || data === null) return done(null);
        const node = stripMeta(data);
        touch(soul);
        merge(soul, node);
        done(node);
      });
    } catch {
      done(null);
    }
  });
}

/** Drop Gun's `_` metadata and turn refs into `{'#': soul}` plain values. */
function stripMeta(node) {
  if (!node || typeof node !== 'object') return node;
  const out = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === '_') continue;
    if (value && typeof value === 'object' && typeof value['#'] === 'string') {
      out[key] = { '#': value['#'] };
    } else {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Read a node and inline its child refs, `depth` levels deep. Poll options live
 * one level down (`v3/polls/<id>` → `options` → `0..n`), so depth 2 returns a
 * complete poll.
 */
export async function readDeep(soul, depth = 2, timeoutMs = 1500) {
  const node = await readSoul(soul, timeoutMs);
  if (!node || depth <= 0) return node;
  const out = {};
  const pending = [];
  for (const [key, value] of Object.entries(node)) {
    if (value && typeof value === 'object' && typeof value['#'] === 'string') {
      pending.push(
        readDeep(value['#'], depth - 1, timeoutMs).then(child => { out[key] = child; }),
      );
    } else {
      out[key] = value;
    }
  }
  await Promise.all(pending);
  return out;
}

/** Write a node. Used by `/db/write` and by TTL expiry (with `null` fields). */
export function writeSoul(soul, data, { link = true } = {}) {
  if (!gun) return;
  try {
    touch(soul);
    gun.get(soul).put(data);
    merge(soul, data);
    if (link) linkAncestors(soul);
  } catch (err) {
    console.warn('[graph] write failed for', soul, err.message);
  }
}

/**
 * Make `a/b/c` reachable by traversal, not just by its flat soul.
 *
 * The client reads `gun.get('v3').get('polls').get(id)`, which walks node `v3`
 * → node `v3/polls` → node `v3/polls/<id>`. Writing the leaf soul alone leaves
 * those parent links missing, so the poll exists but no browser can find it.
 */
function linkAncestors(soul) {
  const parts = soul.split('/');
  for (let depth = 1; depth < parts.length; depth++) {
    const parent = parts.slice(0, depth).join('/');
    const key = parts[depth];
    const child = parts.slice(0, depth + 1).join('/');
    const existing = cache.get(parent);
    if (existing && existing[key] && existing[key]['#'] === child) continue;
    touch(parent);
    gun.get(parent).put({ [key]: { '#': child } });
    merge(parent, { [key]: { '#': child } });
  }
}

/** Souls under a prefix, newest first. Backs `/db/search`. */
export function soulsWithPrefix(prefix, limit = 100) {
  const matches = [];
  for (const [soul, meta] of index) {
    if (soul.startsWith(prefix)) matches.push({ soul, ...meta });
  }
  matches.sort((a, b) => b.firstSeen - a.firstSeen);
  return matches.slice(0, Math.max(0, limit));
}

/** Direct children of a collection soul, e.g. `v3/polls` → every poll soul. */
export function childSouls(root, limit = 200) {
  const prefix = `${root}/`;
  return soulsWithPrefix(prefix, Infinity)
    .filter(entry => !entry.soul.slice(prefix.length).includes('/'))
    .slice(0, limit);
}

export function has(soul) {
  return index.has(soul);
}

export function stats() {
  const counts = {};
  for (const soul of index.keys()) {
    const root = soul.split('/').slice(0, 2).join('/');
    counts[root] = (counts[root] || 0) + 1;
  }
  return { souls: index.size, cachedNodes: cache.size, byRoot: counts };
}

// ── TTL: the short-lived-hosting feature ─────────────────────────────────────

/**
 * Expire everything first seen longer than `ttlMs` ago.
 *
 * Gun has no real delete, so "expired" means: gone from the index (so no read
 * route lists or serves it) and nulled in the graph (so peers that still hold a
 * copy see the tombstone). Bytes already on a peer's disk are not our call to
 * make — that is the nature of a replicated graph, and the README says so.
 */
export function sweep(now = Date.now()) {
  if (!config.ttlMs) return { expired: 0 };
  const cutoff = now - config.ttlMs;
  let expired = 0;
  for (const [soul, meta] of [...index]) {
    if (meta.firstSeen > cutoff || isPermanent(soul)) continue;
    index.delete(soul);
    cache.delete(soul);
    dirty = true;
    expired++;
    try {
      gun?.get(soul).put(null);  // tombstone for peers that still hold a copy
    } catch {
      // Best effort — the index removal is what makes it invisible here.
    }
  }
  if (expired > 0) {
    console.log(`[ttl] expired ${expired} soul(s) older than ${config.ttlHours}h`);
    flushIndex();
  }
  return { expired };
}

function startSweeper() {
  if (!config.ttlMs || sweepTimer) return;
  sweepTimer = setInterval(() => sweep(), config.sweepIntervalMs);
  if (sweepTimer.unref) sweepTimer.unref();
  sweep();
}

export function shutdown() {
  clearInterval(flushTimer);
  clearInterval(sweepTimer);
  flushIndex();
}
