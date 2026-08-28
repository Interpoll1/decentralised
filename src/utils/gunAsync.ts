/**
 * Async primitives over Gun's callback API.
 *
 * Gun's chain methods are fire-and-forget callbacks with no completion
 * guarantee: `.once()` may never fire for a node the relay does not hold, and
 * `.put()`'s optional ack only proves *some* peer accepted the write — which,
 * with `localStorage:false` and `radisk:false` (see `GunService.initialize`),
 * can be nothing more than this tab's own in-memory graph.
 *
 * Every helper here is guaranteed to settle. Callers that need proof a write
 * left the browser use `verifySoulOnRelay`, which asks the relay's own DB
 * mirror rather than re-reading the local graph (re-reading always "succeeds",
 * because the value was just written locally).
 */

import config from '../config';

export interface GunAck {
  ok: boolean;
  err?: string;
}

export interface GunChild<T> {
  key: string;
  value: T;
}

const DEFAULT_PUT_TIMEOUT_MS = 8_000;
const DEFAULT_READ_TIMEOUT_MS = 5_000;

/** Relay origin for HTTP side-channels (`config.relay.gun` ends in `/gun`). */
export function gunRelayBase(): string {
  return config.relay.gun.replace(/\/gun$/, '');
}

/**
 * `put` a value and wait for Gun's ack (or a timeout). Never rejects — a failed
 * write is a value, not an exception, because every caller wants to fall back
 * to the local outbox rather than unwind.
 */
export function gunPut(node: any, data: unknown, timeoutMs = DEFAULT_PUT_TIMEOUT_MS): Promise<GunAck> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ack: GunAck) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(ack);
    };
    const timer = setTimeout(() => finish({ ok: false, err: 'timeout' }), timeoutMs);
    try {
      node.put(data, (ack: any) => {
        if (ack && ack.err) finish({ ok: false, err: String(ack.err) });
        else finish({ ok: true });
      });
    } catch (err) {
      finish({ ok: false, err: err instanceof Error ? err.message : String(err) });
    }
  });
}

/** Read a single node, resolving `null` rather than hanging when it never arrives. */
export function gunOnce<T = any>(node: any, timeoutMs = DEFAULT_READ_TIMEOUT_MS): Promise<T | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: T | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    try {
      node.once((data: any) => finish((data ?? null) as T | null));
    } catch {
      finish(null);
    }
  });
}

export interface ReadChildrenOptions {
  /** Settle once this long passes with no new child arriving. */
  idleMs?: number;
  /** Never settle before this — the first child from a cold relay takes a moment. */
  minMs?: number;
  /** Hard ceiling regardless of traffic. */
  maxMs?: number;
}

/**
 * Collect the children of a Gun node.
 *
 * Gun gives no "done" signal for `.map()`, so the old code guessed with fixed
 * `setTimeout`s — 1500 ms for a whole comment thread — and silently truncated
 * whatever had not arrived. This settles on *quiet* instead: keep collecting
 * until nothing new has shown up for `idleMs`, bounded by `maxMs`. A slow relay
 * gets the time it needs; a fast one returns immediately.
 */
export function gunReadChildren<T = any>(node: any, options: ReadChildrenOptions = {}): Promise<GunChild<T>[]> {
  const idleMs = options.idleMs ?? 450;
  const minMs = options.minMs ?? 700;
  const maxMs = options.maxMs ?? 8_000;

  return new Promise((resolve) => {
    const collected = new Map<string, T>();
    const startedAt = Date.now();
    let lastActivity = startedAt;
    let settled = false;
    let chain: any = null;

    const finish = () => {
      if (settled) return;
      settled = true;
      clearInterval(poll);
      try { chain?.off?.(); } catch { /* chain already detached */ }
      resolve([...collected.entries()].map(([key, value]) => ({ key, value })));
    };

    const poll = setInterval(() => {
      const now = Date.now();
      if (now - startedAt >= maxMs) finish();
      else if (now - startedAt >= minMs && now - lastActivity >= idleMs) finish();
    }, 100);

    try {
      chain = node.map().once((value: any, key: string) => {
        lastActivity = Date.now();
        // Gun surfaces deleted/empty children as null — record nothing for them.
        if (value === null || value === undefined || typeof key !== 'string') return;
        collected.set(key, value as T);
      });
    } catch {
      finish();
    }
  });
}

/**
 * Ask the relay's DB mirror whether a soul actually reached it.
 *
 * Returns `true` (relay holds it), `false` (endpoint answered but the soul is
 * absent), or `null` (endpoint unreachable — inconclusive, so the caller should
 * retry later rather than treat it as a lost write).
 *
 * This is deliberately an HTTP side-channel and not a Gun read: a `.once()`
 * against the local graph resolves from the copy we just wrote and therefore
 * confirms nothing. Peers running without this endpoint simply report `null`,
 * which degrades to "keep retrying in the background" — never to data loss.
 */
export async function verifySoulOnRelay(soul: string, deadlineMs = 8_000): Promise<boolean | null> {
  if (typeof fetch !== 'function') return null;
  const url = `${gunRelayBase()}/db/soul?soul=${encodeURIComponent(soul)}`;
  const deadline = Date.now() + deadlineMs;
  const retryDelayMs = 1_500;
  let endpointReachable = false;

  for (;;) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3_000);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (res.ok) return true;
      // A 404 proves the endpoint exists and simply does not hold the soul.
      if (res.status === 404) endpointReachable = true;
    } catch {
      // Network error or abort — this attempt says nothing either way.
    } finally {
      clearTimeout(timer);
    }

    if (Date.now() + retryDelayMs > deadline) {
      return endpointReachable ? false : null;
    }
    await sleep(retryDelayMs);
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Gun rejects `undefined` and treats nested objects as links, so every record
 * written to the graph must be a flat bag of primitives. Dropping undefined
 * keys here (rather than writing `null`) matters: a node whose every value is
 * null is an *empty* node, and Gun never acks an empty put — the failure mode
 * that once made polls silently fail to replicate.
 */
export function toGunRecord(source: Record<string, unknown>): Record<string, string | number | boolean> {
  const record: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      record[key] = value;
    }
  }
  return record;
}