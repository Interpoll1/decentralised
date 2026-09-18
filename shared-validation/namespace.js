// namespace.js — the relay's single authority on data namespaces.
//
// Context: the v4 client bump never reached the relay. Every route here was
// hardcoded to v3, and the dataVersion query parameter was parsed as
//   `param === 'v2' ? 'v2' : 'v3'`
// so every value the relay did not recognise — including 'v4' — silently
// resolved to v3. The client asked for v4 and was served v3, labelled v3.
// Worse, responses were tagged with the *requested* namespace rather than the
// one the row actually came from, so a lenient parser would have relabelled
// legacy rows as current. Both of those are fixed here.

/** Active namespace. Override with GUN_NAMESPACE to roll forward or back. */
export const NAMESPACE = process.env.GUN_NAMESPACE || 'v5';

/** Namespaces the relay still holds data for and will serve when asked explicitly. */
export const KNOWN_NAMESPACES = Object.freeze(['v2', 'v3', 'v4', 'v5']);

/**
 * Cutover instant for the v5 clean slate, mirroring src/utils/namespace.ts.
 * Post/poll/comment ids embed their creation time, so this rejects pre-cutover
 * records even if something hands us one wearing a v5 tag.
 */
export const NAMESPACE_EPOCH_MS = Date.parse('2026-09-18T00:00:00Z');

/**
 * Resolve the ?dataVersion= parameter.
 *
 * Returns null for a value that is not a known namespace, so callers can answer
 * 400 instead of silently substituting a default — the silent substitution is
 * what made `?dataVersion=v4` mean "give me v3" for two days.
 */
export function resolveNamespace(param) {
  if (param === null || param === undefined || param === '') return NAMESPACE;
  return KNOWN_NAMESPACES.includes(param) ? param : null;
}

/** The namespace a soul belongs to, derived from the soul itself. */
export function namespaceOfSoul(soul) {
  if (typeof soul !== 'string') return null;
  const prefix = soul.split('/', 1)[0];
  return KNOWN_NAMESPACES.includes(prefix) ? prefix : null;
}

/** Embedded creation timestamp of an id, or null. Mirrors the client helper. */
export function idTimestamp(id) {
  if (typeof id !== 'string') return null;
  const m = id.match(/[_-](\d{13})[_-]/);
  if (!m) return null;
  const t = Number(m[1]);
  return Number.isFinite(t) ? t : null;
}

/**
 * Whether a record may be written into, or served as part of, `ns`.
 *
 * Default-deny for the active namespace: a record must carry the matching
 * dataVersion tag and must not predate the cutover. Legacy namespaces keep the
 * old permissive behaviour so historical reads and the purge tooling still work.
 */
export function belongsToNamespace(record, ns = NAMESPACE) {
  if (!record || typeof record !== 'object') return false;
  if (ns !== NAMESPACE) return true;
  if (record.dataVersion !== ns) return false;
  const ts = idTimestamp(record.id);
  if (ts !== null && ts < NAMESPACE_EPOCH_MS) return false;
  return true;
}
