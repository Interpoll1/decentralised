import { describe, it, expect } from 'vitest';
import {
  GUN_NAMESPACE,
  NAMESPACE_EPOCH_MS,
  belongsToNamespace,
  idTimestamp,
} from '../src/utils/namespace';

/**
 * Regression suite for the v3→v4→v5 namespace leaks.
 *
 * Both previous bumps failed the same way: the guards asked "does this record
 * claim a *different* namespace?", and legacy Gun nodes carry no `dataVersion`
 * at all, so every one of them answered "no" and was admitted. These tests pin
 * the inverted rule — a record must positively prove it belongs.
 */

const realPost = {
  id: `post-${NAMESPACE_EPOCH_MS + 60_000}-abc123def`,
  title: 'A genuine v5 post',
  communityId: 'c-test',
  dataVersion: GUN_NAMESPACE,
};

describe('belongsToNamespace', () => {
  it('admits a record tagged for the current namespace', () => {
    expect(belongsToNamespace(realPost)).toBe(true);
  });

  it('rejects an untagged record — the exact shape that leaked v3 into v4', () => {
    const { dataVersion, ...untagged } = realPost;
    void dataVersion;
    expect(belongsToNamespace(untagged)).toBe(false);
  });

  it('rejects records claiming a previous namespace', () => {
    for (const v of ['v1', 'v2', 'v3', 'v4']) {
      expect(belongsToNamespace({ ...realPost, dataVersion: v })).toBe(false);
    }
  });

  it('rejects non-objects and nullish values outright', () => {
    for (const v of [null, undefined, 'v5', 42, []]) {
      expect(belongsToNamespace(v)).toBe(false);
    }
  });

  it('rejects a pre-cutover record even when it claims the current namespace', () => {
    // The timestamp cutoff is what covers records we have never seen — a stale
    // client re-tagging its local v3 corpus as v5 still cannot get it in.
    const forged = {
      ...realPost,
      id: 'post-1776554087585-aliqksh6v', // a real leaked v4/posts id
      dataVersion: GUN_NAMESPACE,
    };
    expect(belongsToNamespace(forged)).toBe(false);
  });

  it('admits a tagged record whose id carries no timestamp (communities, users)', () => {
    expect(belongsToNamespace({ id: 'c-cars', dataVersion: GUN_NAMESPACE })).toBe(true);
    const pubkey = 'a87e01bfa01ef6a3b5334bef42cac5c71771065dec9c7eb5aa842bc75aed4ae6';
    expect(belongsToNamespace({ id: pubkey, dataVersion: GUN_NAMESPACE })).toBe(true);
  });
});

describe('idTimestamp', () => {
  it('reads the epoch out of post and comment id formats', () => {
    expect(idTimestamp('post-1776554087585-aliqksh6v')).toBe(1776554087585);
    expect(idTimestamp('comment_1777605715547_oo38no1sj')).toBe(1777605715547);
  });

  it('returns null for ids with no embedded timestamp', () => {
    for (const id of ['c-askinterpoll', 'general', 'test-123', '0', '']) {
      expect(idTimestamp(id)).toBeNull();
    }
  });

  it('returns null for non-string input', () => {
    expect(idTimestamp(undefined)).toBeNull();
    expect(idTimestamp(12345)).toBeNull();
  });
});

describe('namespace constants', () => {
  it('runs v5', () => {
    expect(GUN_NAMESPACE).toBe('v5');
  });

  it('puts the cutover after every leaked record we found on the relay', () => {
    // Newest leaked id observed in v4/posts during the investigation.
    expect(NAMESPACE_EPOCH_MS).toBeGreaterThan(1789436118546);
  });
});
