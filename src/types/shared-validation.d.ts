// Ambient types for the gitignored `shared-validation/` package, which is
// plain JS (shared with Node relay code). Frontend imports it by relative path,
// e.g. `import { canonicalJSON } from '../../shared-validation/canonical.js'`.
// The wildcard matches that specifier at any nesting depth.

declare module '*shared-validation/canonical.js' {
  /** Deterministic JSON: recursively sorts object keys, strips integrity meta fields. */
  export function canonicalJSON(obj: Record<string, unknown>): string;
  /** Stable stringify primitive used by canonicalJSON (undefined for `undefined`). */
  export function stableStringify(val: unknown): string | undefined;
  /** Integrity envelope fields stripped before canonicalization. */
  export const META_FIELDS: Set<string>;
}
