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

declare module '*shared-validation/contentPow.js' {
  export const CONTENT_POW_VERSION: string;
  /** Minimum leading zero bits a relay accepts for a new content record. */
  export const CONTENT_POW_MIN_BITS: number;
  export const CONTENT_POW_MAX_AGE_MS: number;
  export const CONTENT_POW_FUTURE_SKEW_MS: number;
  export function sha256Words(str: string): Int32Array;
  export function sha256Hex(str: string): string;
  export function contentPowSeed(input: { kind: string; id: string; createdAt: number; authorId?: string }): string;
  export function contentPowWork(seed: string, nonce: number): number;
  export function verifyContentPow(
    rec: { kind: string; id: string; createdAt: number | string; authorId?: string; powNonce: unknown },
    opts?: { now?: number; fresh?: boolean; minBits?: number },
  ): boolean;
  export function solveContentPow(
    input: { kind: string; id: string; createdAt: number; authorId?: string },
    bits?: number,
    maxAttempts?: number,
  ): number;
}
