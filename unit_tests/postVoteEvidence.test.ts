/**
 * Post-vote tier evidence — a like carries a signature over its own fields plus
 * whatever Sybil-resistance evidence the voter holds. The point of the
 * signature is that evidence copied off someone else's vote fails verification,
 * so a farm cannot lift one bought PoW onto a thousand nodes.
 */
import { describe, it, expect } from 'vitest';
import { schnorr } from '@noble/curves/secp256k1.js';
import { bytesToHex } from '@noble/hashes/utils';

import { postVotePayload, verifiedVoteRecord } from '@/services/postVoteService';
import { CryptoService } from '@/services/cryptoService';
import { EngagementTierService } from '@/services/engagementTierService';
import { computeEngagementPow } from '@/utils/engagementPow';

function keypair() {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return { priv: bytesToHex(b), pub: bytesToHex(schnorr.getPublicKey(b)) };
}

const AT = 1_700_000_000_000;

function signedNode(over: Record<string, unknown> = {}) {
  const { priv, pub } = keypair();
  const base = { type: 'up', userId: 'u1', postId: 'post1', at: AT, pubkey: pub, ...over };
  const sig = CryptoService.sign(
    postVotePayload(base.postId as string, base.userId as string, base.type as any, base.at as number, base.pubkey as string),
    priv,
  );
  return { node: { ...base, sig }, priv, pub };
}

describe('verifiedVoteRecord', () => {
  it('lifts a correctly signed vote into an engagement record', () => {
    const { node, pub } = signedNode();
    expect(verifiedVoteRecord('u1', node)).toMatchObject({
      kind: 'post-vote',
      pubkey: pub,
      targetId: 'post1',
      createdAt: Math.floor(AT / 1000),
    });
  });

  it('rejects an unsigned vote', () => {
    expect(verifiedVoteRecord('u1', { type: 'up', userId: 'u1', postId: 'post1', at: AT })).toBeNull();
  });

  it('rejects a vote whose fields were edited after signing', () => {
    const { node } = signedNode();
    expect(verifiedVoteRecord('u1', { ...node, type: 'down' })).toBeNull();
    expect(verifiedVoteRecord('u1', { ...node, postId: 'post2' })).toBeNull();
    expect(verifiedVoteRecord('u1', { ...node, at: AT + 1 })).toBeNull();
  });

  it('rejects a signature made by a different key', () => {
    const { node } = signedNode();
    const other = keypair();
    expect(verifiedVoteRecord('u1', { ...node, pubkey: other.pub })).toBeNull();
  });

  it('does not let PoW be copied onto another key or post', async () => {
    const { priv, pub } = keypair();
    const pow = await computeEngagementPow('post-vote', pub, 'post1', Math.floor(AT / 1000));
    const sign = (postId: string, userId: string, signer = priv, key = pub) =>
      CryptoService.sign(postVotePayload(postId, userId, 'up', AT, key), signer);

    const genuine = { type: 'up', userId: 'u1', postId: 'post1', at: AT, pubkey: pub, pow, sig: sign('post1', 'u1') };
    expect(await EngagementTierService.tierOf(verifiedVoteRecord('u1', genuine)!)).toBe('pow');

    // Same PoW replayed on a different post, correctly signed by the same key:
    // the signature is fine, the work is not.
    const moved = { ...genuine, postId: 'post2', sig: sign('post2', 'u1') };
    expect(await EngagementTierService.tierOf(verifiedVoteRecord('u1', moved)!)).toBe('anonymous');

    // Same PoW claimed by a second key: verification fails at the signature.
    const thief = keypair();
    expect(verifiedVoteRecord('u2', { ...genuine, userId: 'u2', pubkey: thief.pub })).toBeNull();
  });

  it('ignores malformed nodes rather than throwing', () => {
    expect(verifiedVoteRecord('u1', null)).toBeNull();
    expect(verifiedVoteRecord('u1', 'nonsense')).toBeNull();
    const { node } = signedNode();
    expect(verifiedVoteRecord('u1', { ...node, sig: 'zz' })).toBeNull();
  });
});
