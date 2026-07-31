// Persistent, time-decaying reputation for relays / peers.
//
// GameOver-Zeus did not treat all peers as equal — it scored them by how
// reliably they answered and demoted or dropped the ones that stopped
// responding, so a node under takedown pressure spent its reconnection budget
// on the peers most likely to still be alive. This service is the honest,
// legitimate version of that idea: a decaying success/failure score per
// endpoint that lets the failover brain (RelayManager) prefer proven-good
// endpoints and evict dead ones first.
//
// Standalone static service with no service dependencies (so any layer can call
// it without import cycles). Persists to localStorage, mirroring the
// load/persist-with-validation shape used by RelayManager.

export interface ReputationRecord {
  /** Reliability score in [0, 1]. Starts neutral at 0.5. */
  score: number;
  /** Last time this endpoint was observed (success or failure), ms epoch. */
  lastSeen: number;
  successes: number;
  failures: number;
}

const STORAGE_KEY = 'interpoll_peer_reputation';
const INITIAL_SCORE = 0.5;
/** Weight of each new observation against the running score (EWMA alpha). */
const ALPHA = 0.3;
/** Below this score AND stale past PRUNE_TTL_MS, an endpoint is prune-eligible. */
const PRUNE_FLOOR = 0.2;
const PRUNE_TTL_MS = 24 * 60 * 60_000;
/** Cap on stored records; lowest-scoring are dropped past this. */
const MAX_RECORDS = 200;

export class PeerReputationService {
  private static records: Map<string, ReputationRecord> = new Map();
  private static loaded = false;

  /** Record a successful interaction (probe online, connect, sync) with `id`. */
  static recordSuccess(id: string): void {
    this.update(id, true);
  }

  /** Record a failed interaction (probe offline, connect error) with `id`. */
  static recordFailure(id: string): void {
    this.update(id, false);
  }

  /** Current reputation score in [0, 1]; neutral 0.5 for never-seen endpoints. */
  static scoreFor(id: string): number {
    this.ensureLoaded();
    return this.records.get(id)?.score ?? INITIAL_SCORE;
  }

  /** Read-only snapshot of a stored record, if any. */
  static getRecord(id: string): ReputationRecord | null {
    this.ensureLoaded();
    const record = this.records.get(id);
    return record ? { ...record } : null;
  }

  /**
   * Return `ids` ordered best-reputation first. Stable for equal scores so it is
   * safe to use purely as a tiebreaker on top of an existing ordering.
   */
  static rank(ids: string[]): string[] {
    this.ensureLoaded();
    return [...ids]
      .map((id, index) => ({ id, index, score: this.scoreFor(id) }))
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .map((entry) => entry.id);
  }

  /** Whether `id` is a poor, stale endpoint safe to evict. */
  static shouldPrune(id: string): boolean {
    this.ensureLoaded();
    const record = this.records.get(id);
    if (!record) return false;
    return record.score < PRUNE_FLOOR && Date.now() - record.lastSeen > PRUNE_TTL_MS;
  }

  /** Full reputation table (copy), best score first — for UI display. */
  static snapshot(): Array<ReputationRecord & { id: string }> {
    this.ensureLoaded();
    return Array.from(this.records.entries())
      .map(([id, record]) => ({ id, ...record }))
      .sort((a, b) => b.score - a.score);
  }

  /** Clear all reputation state (settings/testing). */
  static reset(): void {
    this.records.clear();
    this.loaded = true;
    this.persist();
  }

  private static update(id: string, success: boolean): void {
    if (!id) return;
    this.ensureLoaded();
    const existing = this.records.get(id);
    const prior = existing?.score ?? INITIAL_SCORE;
    const target = success ? 1 : 0;
    const score = Math.min(1, Math.max(0, prior * (1 - ALPHA) + target * ALPHA));
    this.records.set(id, {
      score,
      lastSeen: Date.now(),
      successes: (existing?.successes ?? 0) + (success ? 1 : 0),
      failures: (existing?.failures ?? 0) + (success ? 0 : 1),
    });
    this.enforceCap();
    this.persist();
  }

  private static enforceCap(): void {
    if (this.records.size <= MAX_RECORDS) return;
    // Drop the lowest-scoring records first.
    const ordered = Array.from(this.records.entries()).sort((a, b) => a[1].score - b[1].score);
    for (const [id] of ordered.slice(0, this.records.size - MAX_RECORDS)) {
      this.records.delete(id);
    }
  }

  private static ensureLoaded(): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (!parsed || typeof parsed !== 'object') return;
      for (const [id, value] of Object.entries(parsed)) {
        const record = this.validateRecord(value);
        if (record) this.records.set(id, record);
      }
    } catch {
      // Corrupt or unavailable storage — start from an empty table.
    }
  }

  private static validateRecord(value: unknown): ReputationRecord | null {
    if (!value || typeof value !== 'object') return null;
    const obj = value as Record<string, unknown>;
    const score = obj.score;
    const lastSeen = obj.lastSeen;
    if (typeof score !== 'number' || !Number.isFinite(score)) return null;
    if (typeof lastSeen !== 'number' || !Number.isFinite(lastSeen)) return null;
    return {
      score: Math.min(1, Math.max(0, score)),
      lastSeen,
      successes: typeof obj.successes === 'number' ? obj.successes : 0,
      failures: typeof obj.failures === 'number' ? obj.failures : 0,
    };
  }

  private static persist(): void {
    try {
      const obj: Record<string, ReputationRecord> = {};
      for (const [id, record] of this.records.entries()) obj[id] = record;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
    } catch {
      // Storage full or unavailable — keep in-memory state.
    }
  }
}

export default PeerReputationService;
