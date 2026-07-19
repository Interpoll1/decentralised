// Pure, isomorphic canonical JSON serialization — no Node builtins here so this
// file can be imported by both the browser frontend and Node-based relays.
// This is the single source of truth for "canonical JSON"; integrity.js (Node-only)
// wraps it with crypto.createHash for relay-side hashing.

const META_FIELDS = new Set(['_hash', '_sig', '_pub', '_pow', '_ts', '_nonce']);

export function stableStringify(val) {
  if (val === undefined) return undefined;
  if (val === null) return 'null';
  if (typeof val !== 'object') return JSON.stringify(val);
  if (Array.isArray(val)) {
    return '[' + val.map((v) => stableStringify(v) ?? 'null').join(',') + ']';
  }
  const keys = Object.keys(val).sort();
  const pairs = [];
  for (const k of keys) {
    const sv = stableStringify(val[k]);
    if (sv !== undefined) pairs.push(JSON.stringify(k) + ':' + sv);
  }
  return '{' + pairs.join(',') + '}';
}

export function canonicalJSON(obj) {
  const stripped = {};
  for (const [k, v] of Object.entries(obj)) {
    if (!META_FIELDS.has(k)) stripped[k] = v;
  }
  return stableStringify(stripped) ?? '{}';
}

export { META_FIELDS };
