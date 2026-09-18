/**
 * Namespace policy — the single authority on which records may enter the
 * active data namespace.
 *
 * Deliberately free of any Gun import: this is pure policy, it must be
 * testable without a DOM, and every guard in the app should be able to reach it
 * without dragging the graph layer along. `gunService` re-exports these so
 * existing `from './gunService'` imports keep working.
 */

export const GUN_NAMESPACE = 'v5';

/**
 * Epoch cutover for the v5 clean slate: records created before this instant
 * cannot belong to v5, whatever they claim. Post/poll/comment ids embed their
 * creation time (`post-<epoch>-<rand>`, `comment_<epoch>_<rand>`), so this is a
 * closed-form rejection that also covers legacy records we have never seen —
 * including whatever is sitting in an un-updated browser's local Gun store.
 *
 * Communities (`c-cars`) and users (pubkey hashes) carry no timestamp in their
 * id, so they rely on the `dataVersion` tag alone.
 */
export const NAMESPACE_EPOCH_MS = Date.parse('2026-09-18T00:00:00Z');

/** Extract the embedded creation timestamp from an id, or null if it has none. */
export function idTimestamp(id: unknown): number | null {
  if (typeof id !== 'string') return null;
  const m = id.match(/[_-](\d{13})[_-]/);
  if (!m) return null;
  const t = Number(m[1]);
  return Number.isFinite(t) ? t : null;
}

/**
 * Whether a record may enter the active namespace.
 *
 * Default-deny: a record must *explicitly* declare the current namespace. Both
 * previous namespace bumps failed because the guards read `dataVersion` as
 * "reject only if it declares something else", and Gun nodes have never carried
 * the field at all — so every legacy record sailed through as untagged. From v5
 * on, `dataVersion` is written into the Gun node at creation, which makes an
 * absent tag a genuine signal that the record predates the cutover.
 */
export function belongsToNamespace(record: unknown): boolean {
  if (!record || typeof record !== 'object') return false;
  const r = record as Record<string, unknown>;
  if (r.dataVersion !== GUN_NAMESPACE) return false;
  const ts = idTimestamp(r.id);
  if (ts !== null && ts < NAMESPACE_EPOCH_MS) return false;
  return true;
}
