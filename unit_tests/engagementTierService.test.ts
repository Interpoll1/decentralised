/**
 * engagementTierService — the vote tier ladder, generalised to likes and
 * comments. Real crypto throughout (real self-PoW, real Schnorr issuer certs
 * and relay attestations); only the issuer *list* is stubbed so no Gun is
 * needed. Proves: evidence lifts the tier per action kind, evidence bound to
 * another key/target does not, and the tier split counts distinct actors.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { schnorr } from '@noble/curves/secp256k1.js';
import { bytesToHex } from '@noble/hashes/utils';

import { EngagementTierService, type EngagementRecord } from '@/services/engagementTierService';
import { TrustService } from '@/services/trustService';
import { CryptoService } from '@/services/cryptoService';
import { computeEngagementPow, verifyEngagementPow } from '@/utils/engagementPow';
import { computeVotePow } from '@/utils/votePow';
import config from '@/config';
import type { NostrEvent } from '@/types/nostr';

function keypair() {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return { priv: bytesToHex(b), pub: bytesToHex(schnorr.getPublicKey(b)) };
}

function issuerCert(issuerPriv: string, issuerDomain: string, userPubkey: string) {
  const cert = {
    issuerDomain,
    username: 'alice',
    userPubkey,
    issuedAt: Date.now(),
    expiresAt: Date.now() + 1e7,
  };
  const signature = CryptoService.sign(JSON.stringify(cert), issuerPriv);
  return { ...cert, signature };
}

function record(over: Partial<EngagementRecord> = {}): EngagementRecord {
  return {
    kind: 'post-vote',
    pubkey: 'a'.repeat(64),
    targetId: 'post1',
    createdAt: 1_000_000,
    ...over,
  };
}

beforeEach(() => config.setRelayAttestationPubkey(''));
afterEach(() => {
  vi.restoreAllMocks();
  config.setRelayAttestationPubkey('');
});

describe('EngagementTierService.tierOf', () => {
  it('no evidence → anonymous', async () => {
    expect(await EngagementTierService.tierOf(record())).toBe('anonymous');
  });

  it('valid post-vote PoW → pow tier', async () => {
    const { pub } = keypair();
    const pow = await computeEngagementPow('post-vote', pub, 'post1', 1_000_000);
    expect(await EngagementTierService.tierOf(record({ pubkey: pub, evidence: { pow } }))).toBe('pow');
  });

  it('PoW solved for another target does not transfer', async () => {
    const { pub } = keypair();
    const pow = await computeEngagementPow('post-vote', pub, 'post1', 1_000_000);
    const moved = record({ pubkey: pub, targetId: 'post2', evidence: { pow } });
    expect(await EngagementTierService.tierOf(moved)).toBe('anonymous');
  });

  it('PoW solved for another kind does not transfer', async () => {
    const { pub } = keypair();
    const pow = await computeEngagementPow('post-vote', pub, 'x1', 1_000_000);
    const moved = record({ kind: 'comment', pubkey: pub, targetId: 'x1', evidence: { pow } });
    expect(await EngagementTierService.tierOf(moved)).toBe('anonymous');
  });

  it('relay attestation for this actor and target → relay tier', async () => {
    const relay = keypair();
    const actor = keypair();
    config.setRelayAttestationPubkey(relay.pub);
    const payload = JSON.stringify({ pubkey: actor.pub, targetId: 'post1' });
    const sig = CryptoService.sign(payload, relay.priv);
    const tier = await EngagementTierService.tierOf(
      record({ pubkey: actor.pub, evidence: { relayAttestation: { payload, sig } } }),
    );
    expect(tier).toBe('relay');
  });

  it('accepts the legacy vote-flow attestation payload shape', async () => {
    const relay = keypair();
    const actor = keypair();
    config.setRelayAttestationPubkey(relay.pub);
    const payload = JSON.stringify({ voterPubkey: actor.pub, pollId: 'poll1' });
    const sig = CryptoService.sign(payload, relay.priv);
    const tier = await EngagementTierService.tierOf(
      record({ kind: 'vote', pubkey: actor.pub, targetId: 'poll1', evidence: { relayAttestation: { payload, sig } } }),
    );
    expect(tier).toBe('relay');
  });

  it('attestation naming a different actor → anonymous', async () => {
    const relay = keypair();
    const actor = keypair();
    const other = keypair();
    config.setRelayAttestationPubkey(relay.pub);
    const payload = JSON.stringify({ pubkey: other.pub, targetId: 'post1' });
    const sig = CryptoService.sign(payload, relay.priv);
    const tier = await EngagementTierService.tierOf(
      record({ pubkey: actor.pub, evidence: { relayAttestation: { payload, sig } } }),
    );
    expect(tier).toBe('anonymous');
  });

  it('issuer certificate binding this actor → issuer tier', async () => {
    const issuer = keypair();
    const actor = keypair();
    vi.spyOn(TrustService, 'getIssuers').mockResolvedValue([
      { domain: 'trust.example', contact: 'a@trust.example', endpoint: 'https://trust.example/t', publicKey: issuer.pub, addedAt: 0 },
    ]);
    const cert = issuerCert(issuer.priv, 'trust.example', actor.pub);
    expect(await EngagementTierService.tierOf(record({ pubkey: actor.pub, evidence: { trustCert: cert } }))).toBe('issuer');
    // JSON-encoded certificates are accepted too (that's how tags carry them).
    expect(
      await EngagementTierService.tierOf(record({ pubkey: actor.pub, evidence: { trustCert: JSON.stringify(cert) } })),
    ).toBe('issuer');
  });

  it("another user's valid certificate does not lift this actor", async () => {
    const issuer = keypair();
    const actor = keypair();
    const other = keypair();
    vi.spyOn(TrustService, 'getIssuers').mockResolvedValue([
      { domain: 'trust.example', contact: 'a@trust.example', endpoint: 'https://trust.example/t', publicKey: issuer.pub, addedAt: 0 },
    ]);
    const cert = issuerCert(issuer.priv, 'trust.example', other.pub);
    expect(await EngagementTierService.tierOf(record({ pubkey: actor.pub, evidence: { trustCert: cert } }))).toBe('anonymous');
  });
});

describe('EngagementTierService.splitByTier', () => {
  it('counts distinct actors, crediting each with their strongest tier', async () => {
    const { pub } = keypair();
    const pow = await computeEngagementPow('post-vote', pub, 'post1', 1_000_000);
    const split = await EngagementTierService.splitByTier(
      [
        record({ pubkey: pub, evidence: { pow } }),
        record({ pubkey: pub }),                       // same actor, weaker evidence
        record({ pubkey: 'b'.repeat(64) }),
        record({ pubkey: 'c'.repeat(64) }),
      ],
      'pow',
    );
    expect(split.verified).toBe(1);
    expect(split.open).toBe(2);
    expect(split.byTier).toEqual({ anonymous: 2, pow: 1, relay: 0, issuer: 0 });
  });

  it('an open policy puts every valid actor in the verified track', async () => {
    const split = await EngagementTierService.splitByTier(
      [record({ pubkey: 'b'.repeat(64) }), record({ pubkey: 'c'.repeat(64) })],
      'open',
    );
    expect(split).toMatchObject({ verified: 2, open: 0 });
  });
});

describe('EngagementTierService.fromNostrEvent', () => {
  it('lifts tag-encoded evidence off a signed event', async () => {
    const { pub } = keypair();
    const nonce = await computeVotePow(pub, 'poll1', 1_000_000, 18);
    const event = {
      id: 'id', pubkey: pub, created_at: 1_000_000, kind: 101,
      tags: [['poll_id', 'poll1'], ['pow', String(nonce)]],
      content: '{}', sig: 'x',
    } as NostrEvent;
    const rec = EngagementTierService.fromNostrEvent(event, 'vote', 'poll_id');
    expect(rec).toMatchObject({ kind: 'vote', pubkey: pub, targetId: 'poll1', createdAt: 1_000_000 });
    expect(await EngagementTierService.tierOf(rec!)).toBe('pow');
  });

  it('returns null when the target tag is missing', () => {
    const event = { id: 'i', pubkey: 'p', created_at: 1, kind: 101, tags: [], content: '', sig: '' } as unknown as NostrEvent;
    expect(EngagementTierService.fromNostrEvent(event, 'vote', 'poll_id')).toBeNull();
  });
});

describe('engagement PoW compatibility', () => {
  it('vote PoW keeps the original pre-image, so published votes still verify', async () => {
    const { pub } = keypair();
    const nonce = await computeVotePow(pub, 'poll1', 1_000_000, 18);
    expect(verifyEngagementPow('vote', pub, 'poll1', 1_000_000, nonce)).toBe(true);
  });

  it('rejects non-integer and negative nonces', () => {
    expect(verifyEngagementPow('post-vote', 'a', 't', 1, -1)).toBe(false);
    expect(verifyEngagementPow('post-vote', 'a', 't', 1, 1.5)).toBe(false);
  });
});
