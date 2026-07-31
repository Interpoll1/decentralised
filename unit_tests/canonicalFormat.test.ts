import { describe, it, expect } from 'vitest';
import { canonicalJSON, stableStringify, META_FIELDS } from '../shared-validation/canonical.js';
import { canonicalJSON as canonicalJSONFromIntegrity, computeHash } from '../shared-validation/integrity.js';

describe('shared-validation/canonical.js', () => {
  it('sorts object keys regardless of insertion order', () => {
    const a = canonicalJSON({ b: 1, a: 2, c: 3 });
    const b = canonicalJSON({ c: 3, a: 2, b: 1 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":2,"b":1,"c":3}');
  });

  it('recursively canonicalizes nested objects and arrays', () => {
    const out = canonicalJSON({ z: { y: 1, x: 2 }, list: [{ b: 1, a: 2 }, 3] });
    expect(out).toBe('{"list":[{"a":2,"b":1},3],"z":{"x":2,"y":1}}');
  });

  it('strips only the four derived envelope fields', () => {
    expect([...META_FIELDS].sort()).toEqual(['_hash', '_pow', '_pub', '_sig']);
    for (const field of META_FIELDS) {
      const out = canonicalJSON({ a: 1, [field]: 'should-be-stripped' });
      expect(out).toBe('{"a":1}');
    }
  });

  it('RETAINS _ts and _nonce so they are covered by the signature (F2)', () => {
    // These freshness fields must be inside the signed/hashed bytes; if they were
    // stripped, an attacker could mutate them on a captured message to defeat
    // replay protection while the signature still verified.
    const out = canonicalJSON({ a: 1, _ts: 123, _nonce: 'abc' });
    expect(out).toBe('{"_nonce":"abc","_ts":123,"a":1}');
  });

  it('omits undefined values the same way at any depth', () => {
    const out = canonicalJSON({ a: 1, b: undefined, c: { d: undefined, e: 2 } });
    expect(out).toBe('{"a":1,"c":{"e":2}}');
  });

  it('stableStringify treats null explicitly, distinct from undefined', () => {
    expect(stableStringify(null)).toBe('null');
    expect(stableStringify(undefined)).toBeUndefined();
  });
});

describe('shared-validation/integrity.js re-exports the same canonicalizer', () => {
  it('canonicalJSON from integrity.js matches canonical.js byte-for-byte', () => {
    const payload = { z: 1, a: { c: 2, b: 3 }, _hash: 'strip-me' };
    expect(canonicalJSONFromIntegrity(payload)).toBe(canonicalJSON(payload));
  });

  it('computeHash is deterministic and order-independent', () => {
    const h1 = computeHash({ a: 1, b: 2 });
    const h2 = computeHash({ b: 2, a: 1 });
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });
});
