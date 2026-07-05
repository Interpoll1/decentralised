/**
 * Automatic local snapshot persistence.
 *
 * `SnapshotService` already round-trips the full app state (IndexedDB chain +
 * Gun content), but only when the user clicks a button on the Resilience page.
 * This service runs it on a schedule and on page-hide, storing the latest
 * snapshot in the IndexedDB `metadata` store, and restores it on startup.
 *
 * Why it matters for resilience:
 *   - Content (posts/polls/comments) lives only in Gun's in-memory graph; a
 *     reload with no reachable relay would otherwise lose it. A restored snapshot
 *     lets the app work offline.
 *   - After an outage, a node holding a fresh snapshot can **re-seed** the network
 *     by writing that content back into Gun (which `import()` does).
 *
 * Only the latest snapshot is kept (bounded), and saves are skipped when nothing
 * material changed, so the cost stays low.
 */

import { SnapshotService } from '@/services/snapshotService';
import { StorageService } from '@/services/storageService';

const SNAPSHOT_KEY = 'last-snapshot';
const SAVE_INTERVAL_MS = 5 * 60_000;

export class SnapshotAutoService {
  private static timer: ReturnType<typeof setInterval> | null = null;
  private static initialized = false;
  private static saving = false;
  private static lastSignature = '';

  /** Start periodic auto-save + save-on-hide. Idempotent. */
  static initialize(): void {
    if (this.initialized) return;
    this.initialized = true;

    this.timer = setInterval(() => { void this.save(); }, SAVE_INTERVAL_MS);

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) void this.save();
      });
    }
    if (typeof window !== 'undefined') {
      // pagehide fires on tab close / navigation more reliably than beforeunload.
      window.addEventListener('pagehide', () => { void this.save(); });
    }
  }

  /** Export current state and persist it locally, skipping unchanged snapshots. */
  static async save(): Promise<void> {
    if (this.saving) return;
    this.saving = true;
    try {
      const snapshot = await SnapshotService.export();
      const sig = this.signatureOf(snapshot);
      if (sig === this.lastSignature) return; // nothing material changed
      this.lastSignature = sig;
      await StorageService.setMetadata(SNAPSHOT_KEY, snapshot);
    } catch {
      // Best-effort; a failed auto-save must never surface to the user.
    } finally {
      this.saving = false;
    }
  }

  /**
   * Restore the last local snapshot into IndexedDB (chain) + Gun (content).
   * Returns true if a snapshot was found and imported. Callers should refresh
   * chain-backed state (e.g. `chainStore.loadBlocks()`) afterwards; Gun content
   * surfaces automatically as the import writes fire subscriptions.
   */
  static async restore(): Promise<boolean> {
    try {
      const snapshot = await StorageService.getMetadata(SNAPSHOT_KEY);
      if (!snapshot || typeof snapshot !== 'object') return false;
      await SnapshotService.import(snapshot as Parameters<typeof SnapshotService.import>[0]);
      this.lastSignature = this.signatureOf(snapshot);
      return true;
    } catch {
      return false;
    }
  }

  static cleanup(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.initialized = false;
  }

  /** Cheap change-detection key from the snapshot's meta counts. */
  private static signatureOf(snapshot: any): string {
    const m = snapshot?.meta ?? {};
    return `${m.blockHeight ?? 0}:${m.postCount ?? 0}:${m.commentCount ?? 0}:${m.communityCount ?? 0}:${m.userCount ?? 0}`;
  }
}

export default SnapshotAutoService;
