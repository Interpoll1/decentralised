import { createPublicAction } from './publicEngagementService';
import { ACTION_MAX_AGE_MS, type PublicAction } from '../../shared-validation/engagement.js';
/**
 * viewTrackingService.ts — Post and poll view counting
 *
 * Tracks feed card scroll-into-view (IntersectionObserver, 800ms dwell at 15%+
 * visibility) AND detail page opens. Flushes in 10s batches or on page leave.
 */

import config from '../config';

const RELAY_BASE = (() => {
  const ws = config.relay.websocket;
  return ws.replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://').replace(/\/$/, '');
})();

const DWELL_MS  = 800;   // ms visible before counting — lower = catches faster scrollers
const FLUSH_MS  = 10_000; // flush every 10s (was 30s — too slow for debugging)
const MAX_BATCH = 32;
const MAX_PENDING = 256;
const MAX_SENT = 4096;

// Singletons — survive component unmount/remount
type PendingView = { type: 'post' | 'poll'; ts: number; actor: string; action: Promise<PublicAction | null>; ready?: PublicAction };
const pendingViews = new Map<string, PendingView>();
let flushing = false;
const activeObs    = new Map<string, IntersectionObserver>();
// sentIds is session-scoped but we DON'T block re-observation — only block re-sending
const sentIds      = new Set<string>();

let flushTimer:      ReturnType<typeof setTimeout> | null = null;
let authTokenGetter: (() => string | null) | null = null;

// ── Public API ───────────────────────────────────────────────────────────────

export function initViewTracking(getToken: () => string | null) {
  authTokenGetter = getToken;
  if (typeof window !== 'undefined') {
    (window as any).__viewTracking = {
      pending:    () => [...pendingViews.keys()],
      sent:       () => [...sentIds],
      token:      () => authTokenGetter?.() ?? null,
      forceFlush: flush,
      reset:      () => { sentIds.clear(); pendingViews.clear(); activeObs.forEach(o => o.disconnect()); activeObs.clear(); console.log('[views] reset'); },
    };
  }
}

/**
 * Observe a card element. Call from onMounted after nextTick.
 * Idempotent — safe to call multiple times with same id.
 * Does NOT block re-observation if already sent — allows view refreshes on long sessions.
 */

/** Returns a snapshot of all IDs sent this session (i.e. confirmed-viewed content).
 *  Used by the feed to deprioritise already-seen items in the For You ranking. */
export function getViewedIds(): Set<string> {
  return new Set(sentIds);
}

export function isAlreadyTracked(id: string): boolean {
  return activeObs.has(id) || sentIds.has(id) || pendingViews.has(id);
}

/** Optional callback fired when a view dwell completes (800ms in-viewport).
 *  Set this from the app layer to record engagement signals for feed personalisation.
 *  Receives the content id, type, and the data-* attributes on the card element. */
export let onViewConfirmed: ((id: string, type: 'post' | 'poll', el: Element) => void) | null = null;

export function setOnViewConfirmed(cb: typeof onViewConfirmed) {
  onViewConfirmed = cb;
}

export function observePost(el: Element, id: string, type: 'post' | 'poll') {
  if (!el || !id) return;

  // Disconnect any existing observer for this id (component remounted)
  if (activeObs.has(id)) {
    activeObs.get(id)!.disconnect();
    activeObs.delete(id);
  }

  // Don't re-send if already flushed this session, but still observe for UX
  if (sentIds.has(id)) return;

  let dwellTimer: ReturnType<typeof setTimeout> | null = null;

  const obs = new IntersectionObserver(
    (entries) => {
      const entry = entries[0];
      if (entry.isIntersecting && entry.intersectionRatio >= 0.1) {
        // Visible — start dwell timer
        if (!dwellTimer) {
          dwellTimer = setTimeout(() => {
            if (!sentIds.has(id)) {
              queueView(id, type);
              scheduleFlush();
              console.debug(`[views] tracked ${type} ${id.slice(0, 16)} (scroll)`);
              // Fire engagement hook — allows feed personalisation to learn from reads
              try { onViewConfirmed?.(id, type, el); } catch { /* non-fatal */ }
            }
            obs.disconnect();
            activeObs.delete(id);
            dwellTimer = null;
          }, DWELL_MS);
        }
      } else {
        // Left viewport — cancel dwell
        if (dwellTimer) { clearTimeout(dwellTimer); dwellTimer = null; }
      }
    },
    { threshold: [0, 0.1, 0.5], rootMargin: '0px' }
  );

  obs.observe(el);
  activeObs.set(id, obs);
}

/** Track a detail page open immediately — higher intent than scroll.
 *  Detail visits are always counted even if a feed scroll was already sent
 *  this session; they represent distinct user intent and should not be
 *  deduplicated against scroll events. sentIds is NOT checked here. */
export function trackDetailView(id: string, type: 'post' | 'poll') {
  if (!id) return;
  // Remove from sentIds so the flush sends this event fresh.
  // The scroll-view dedup still applies to subsequent feed observations.
  sentIds.delete(id);
  queueView(id, type);
  scheduleFlush();
  console.debug(`[views] tracked ${type} ${id.slice(0, 16)} (detail)`);
}

// ── Internal ─────────────────────────────────────────────────────────────────

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(flush, FLUSH_MS);
}

function queueView(id: string, type: 'post' | 'poll') {
  const actor = authTokenGetter?.();
  if (!actor || pendingViews.has(id) || pendingViews.size >= MAX_PENDING) return;
  const ts = Date.now();
  const entry: PendingView = { type, ts, actor, action: Promise.resolve(null) };
  entry.action = createPublicAction(actor, 'view', type, id, 'view', ts)
    .then(a => { entry.ready = a; return a; }).catch(() => null);
  pendingViews.set(id, entry);
}

async function flush() {
  flushTimer = null;
  if (flushing || !pendingViews.size) return;
  flushing = true;
  try {
    for (const [id, meta] of Array.from(pendingViews)) {
      if (meta.ts < Date.now() - ACTION_MAX_AGE_MS || meta.actor !== authTokenGetter?.()) pendingViews.delete(id);
    }
    const batch: Array<[string, PendingView, PublicAction]> = [];
    for (const [id, meta] of Array.from(pendingViews).slice(0, MAX_BATCH)) {
      const action = await meta.action;
      if (!action) { pendingViews.delete(id); continue; }
      if (pendingViews.get(id) === meta && meta.actor === authTokenGetter?.()) batch.push([id, meta, action]);
    }
    if (!batch.length) return;
    const res = await fetch(`${RELAY_BASE}/api/views`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actions: batch.map(([, , action]) => action) }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const result = await res.json();
    const accepted = new Set<string>((Array.isArray(result.results) ? result.results : [])
      .filter((r: any) => r && ['accepted', 'duplicate'].includes(r.status)).map((r: any) => r.id));
    const ids: string[] = [];
    for (const [id, meta, action] of batch) {
      if (!accepted.has(action.id) || pendingViews.get(id) !== meta || meta.actor !== authTokenGetter?.()) continue;
      pendingViews.delete(id); sentIds.add(id); ids.push(id);
      if (sentIds.size > MAX_SENT) sentIds.delete(sentIds.values().next().value!);
    }
    void refreshViewCountsInStores(ids);
  } catch { /* Pending entries retain the identical signed action for retry. */ }
  finally {
    flushing = false;
    if (pendingViews.size) scheduleFlush();
  }
}

/** Pull fresh view counts from the relay and patch both stores reactively. */
async function refreshViewCountsInStores(ids: string[]) {
  if (ids.length === 0) return;
  try {
    const { fetchViewCounts } = await import('./relayFeedService');
    const counts = await fetchViewCounts(ids);
    if (Object.keys(counts).length === 0) return;
    const [{ usePostStore }, { usePollStore }] = await Promise.all([
      import('../stores/postStore'),
      import('../stores/pollStore'),
    ]);
    usePostStore().patchViewCounts(counts);
    usePollStore().patchViewCounts(counts);
    console.debug('[views] patched view counts for', Object.keys(counts).length, 'items');
  } catch {
    // non-fatal — counts update on next warmup/reload
  }
}

export function flushViewsSync() {
  const actions = Array.from(pendingViews.values())
    .filter(m => m.actor === authTokenGetter?.() && m.ts >= Date.now() - ACTION_MAX_AGE_MS && m.ready)
    .slice(0, MAX_BATCH).map(m => m.ready);
  if (!actions.length) return;
  navigator.sendBeacon(`${RELAY_BASE}/api/views`, new Blob([JSON.stringify({ actions })], { type: 'application/json' }));
  // Beacon queueing is not server acceptance. Leave entries retryable.
}

export async function fetchPersonalisedFeed(
  userPub: string,
  limit = 20,
): Promise<{ posts: any[]; derivedFrom: { categories: string[]; tags: string[] } }> {
  try {
    const res = await fetch(
      `${RELAY_BASE}/api/feed/personalised?limit=${limit}`,
      { headers: { Authorization: `Bearer ${userPub}` } }
    );
    if (!res.ok) return { posts: [], derivedFrom: { categories: [], tags: [] } };
    return await res.json();
  } catch {
    return { posts: [], derivedFrom: { categories: [], tags: [] } };
  }
}
