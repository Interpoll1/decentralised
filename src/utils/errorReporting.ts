// Lightweight, framework-agnostic error reporting used by the global error
// handlers (main.ts) and the app-level error boundary (AppErrorBoundary.vue).
//
// Design note: only genuinely view-breaking errors (Vue render/lifecycle errors
// surfaced via `onErrorCaptured` / `app.config.errorHandler`) escalate to the
// full-screen fallback. Raw `window` 'error'/'unhandledrejection' events are
// recorded for diagnostics ONLY — the app produces many benign background
// promise rejections (Gun sync, network probes) and taking over the screen for
// those would be worse than doing nothing.

import { ref } from 'vue';

export interface AppErrorInfo {
  message: string;
  stack?: string;
  source: string;
  time: number;
}

const RECENT_LIMIT = 12;
const recentErrors: AppErrorInfo[] = [];

/** Reactive: set to the first fatal error; drives AppErrorBoundary's fallback. */
export const fatalError = ref<AppErrorInfo | null>(null);

function toInfo(source: string, err: unknown): AppErrorInfo {
  return {
    message: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
    source,
    time: Date.now(),
  };
}

/** Record an error for diagnostics without disrupting the UI. */
export function recordError(source: string, err: unknown): AppErrorInfo {
  const info = toInfo(source, err);
  recentErrors.push(info);
  if (recentErrors.length > RECENT_LIMIT) recentErrors.shift();
  return info;
}

export function getRecentErrors(): AppErrorInfo[] {
  return [...recentErrors];
}

/** Escalate a view-breaking error to the full-screen fallback (keeps the first). */
export function reportFatal(source: string, err: unknown): AppErrorInfo {
  const info = recordError(source, err);
  if (!fatalError.value) fatalError.value = info;
  return info;
}

export function clearFatal(): void {
  fatalError.value = null;
}

/**
 * Best-effort wipe of local app data: Gun's localStorage cache + the IndexedDB
 * database. Used by the error screen's "Reset local data" recovery action so a
 * user stuck behind corrupt/oversized local state can get back to a clean load.
 */
export async function resetLocalData(): Promise<void> {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k.startsWith('gun/') || k.startsWith('gap/') || k.startsWith('rad/'))) {
        keys.push(k);
      }
    }
    keys.forEach((k) => localStorage.removeItem(k));
  } catch {
    /* localStorage unavailable */
  }
  try {
    if (typeof indexedDB !== 'undefined' && indexedDB?.deleteDatabase) {
      await new Promise<void>((resolve) => {
        const req = indexedDB.deleteDatabase('interpoll-db');
        req.onsuccess = req.onerror = req.onblocked = () => resolve();
        // Never hang the recovery flow if the delete request stalls.
        setTimeout(resolve, 3_000);
      });
    }
  } catch {
    /* ignore */
  }
}
