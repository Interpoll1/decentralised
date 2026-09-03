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
const MAX_BATCH = 50;

// Singletons — survive component unmount/remount
const pendingViews = new Map<string, { type: 'post' | 'poll'; ts: number }>();
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
              pendingViews.set(id, { type, ts: Date.now() });
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
  pendingViews.set(id, { type, ts: Date.now() });
  scheduleFlush();
  console.debug(`[views] tracked ${type} ${id.slice(0, 16)} (detail)`);
}

// ── Internal ─────────────────────────────────────────────────────────────────

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(flush, FLUSH_MS);
}

async function flush() {
  flushTimer = null;
  if (pendingViews.size === 0) return;

  let token = authTokenGetter?.() ?? null;

  // Self-resolve token if not ready yet
  if (!token) {
    try {
      const { UserService } = await import('./userService');
      const u = await Promise.race([
        UserService.getCurrentUser(),
        new Promise<null>(r => setTimeout(() => r(null), 3000)),
      ]);
      token = (u as any)?.id || (u as any)?.publicKey || null;
      if (token) {
        const resolved = token;
        authTokenGetter = () => resolved;
      }
    } catch { /* silent */ }
  }

  if (!token) {
    console.debug('[views] no token — rescheduling');
    scheduleFlush();
    return;
  }

  const batch = [...pendingViews.entries()].slice(0, MAX_BATCH);
  // Mark sent BEFORE fetch to prevent duplicate sends on slow networks
  batch.forEach(([id]) => { pendingViews.delete(id); sentIds.add(id); });

  try {
    const res = await fetch(`${RELAY_BASE}/api/views`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body:    JSON.stringify({
        views: batch.map(([id, { type, ts }]) => ({ id, type, ts })),
      }),
    });
    console.debug('[views] flushed', batch.length, '→ status', res.status);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    // Refresh view counts in both stores so cards update immediately after flush
    refreshViewCountsInStores(batch.map(([id]) => id));
  } catch {
    // Network failed — restore to pending
    batch.forEach(([id, meta]) => { sentIds.delete(id); pendingViews.set(id, meta); });
    scheduleFlush();
  }

  if (pendingViews.size > 0) scheduleFlush();
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
  const token = authTokenGetter?.();
  if (!token || pendingViews.size === 0) return;
  const batch   = [...pendingViews.entries()].slice(0, MAX_BATCH);
  const payload = JSON.stringify({
    views: batch.map(([id, { type, ts }]) => ({ id, type, ts })),
  });
  navigator.sendBeacon(
    `${RELAY_BASE}/api/views`,
    new Blob([payload], { type: 'application/json' })
  );
  batch.forEach(([id]) => { pendingViews.delete(id); sentIds.add(id); });
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
