/**
 * Drop everything the browser holds for the app shell — service workers and Cache Storage — then
 * reload so the newest build is fetched. User data (IndexedDB, localStorage, keys) is NOT touched.
 */
export async function uncache(reload = true): Promise<void> {
  try {
    const regs = await navigator.serviceWorker?.getRegistrations?.();
    await Promise.all((regs ?? []).map(r => r.unregister()));
  } catch { /* best effort */ }
  try {
    const keys = await caches?.keys?.();
    await Promise.all((keys ?? []).map(k => caches.delete(k)));
  } catch { /* best effort */ }
  if (reload) location.replace(location.pathname + location.search + location.hash);
}

const entryOf = (html: string) => html.match(/\/assets2\/index-[\w-]+\.js/)?.[0] ?? '';
const RELOAD_KEY = 'interpoll_uncache_at';

/** True when the server is serving a newer build than the one this tab is running. */
export async function isBuildStale(): Promise<boolean> {
  const running = (document.querySelector('script[type="module"][src*="/assets2/index-"]') as HTMLScriptElement | null)?.getAttribute('src') ?? '';
  if (!running) return false; // dev server / native build
  try {
    const res = await fetch(`/index.html?_=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return false;
    const latest = entryOf(await res.text());
    return !!latest && latest !== running;
  } catch { return false; }
}

/** Check on load, on tab focus and every 10 minutes; self-heals a stale tab at most once a minute. */
export function startStaleBuildWatch(): void {
  if (typeof window === 'undefined') return;
  (window as any).uncache = uncache; // console escape hatch: `uncache()`
  const check = async () => {
    try {
      const last = Number(sessionStorage.getItem(RELOAD_KEY) || 0);
      if (Date.now() - last < 60_000) return;
      if (await isBuildStale()) {
        sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
        await uncache(true);
      }
    } catch { /* never block the app */ }
  };
  setTimeout(check, 3000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void check(); });
  setInterval(check, 10 * 60_000);
}
