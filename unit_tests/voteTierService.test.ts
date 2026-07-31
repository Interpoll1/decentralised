/**
 * voteTierService — resolves a vote's Sybil-resistance tier from real evidence.
 * Uses real crypto throughout (real self-PoW, real Schnorr issuer certs and
 * relay attestations); only the issuer *list* is stubbed via spyOn so no Gun is
 * needed. Proves: valid evidence lifts the tier; forged/mismatched evidence does
 * not (falls back to `anonymous`), so Sybil keypairs can't fake a higher tier.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { schnorr } from '@noble/curves/secp256k1.js';
import { bytesToHex } from '@noble/hashes/utils';

import { VoteTierService, meetsTier } from '@/services/voteTierService';
import { TrustService } from '@/services/trustService';
import { CryptoService } from '@/services/cryptoService';
import { computeVotePow } from '@/utils/votePow';
import config from '@/config';
import type { NostrEvent } from '@/types/nostr';

function keypair() {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  const priv = bytesToHex(b);
  const pub = bytesToHex(schnorr.getPublicKey(b));
  return { priv, pub };
}

function baseEvent(pubkey: string, pollId: string, tags: string[][] = []): NostrEvent {
  return {
    id: 'id', pubkey, created_at: 1_000_000, kind: 101,
    tags: [['poll_id', pollId], ['option', 'A'], ...tags],
    content: JSON.stringify({ choice: 'A', deviceId: 'd' }), sig: 'x',
  } as NostrEvent;
}

/** Build a real, verifiable issuer certificate for `userPubkey`. */
function issuerCert(issuerPriv: string, issuerDomain: string, userPubkey: string, expiresAt = Date.now() + 1e7) {
  const cert = { issuerDomain, username: 'alice', userPubkey, issuedAt: Date.now(), expiresAt };
  const payload = JSON.stringify(cert); // certPayload uses this exact field order
  const signature = CryptoService.sign(payload, issuerPriv);
  return { ...cert, signature };
}

beforeEach(() => {
  config.setRelayAttestationPubkey('');
});
afterEach(() => {
  vi.restoreAllMocks();
  config.setRelayAttestationPubkey('');
});

describe('VoteTierService.tierOf', () => {
  it('valid self-PoW → pow tier', async () => {
    const { pub } = keypair();
    const nonce = await computeVotePow(pub, 'poll1', 1_000_000, 18);
    const ev = baseEvent(pub, 'poll1', [['pow', String(nonce)]]);
    expect(await VoteTierService.tierOf(ev)).toBe('pow');
  });

  it('bogus PoW nonce → anonymous', async () => {
    const { pub } = keypair();
    const ev = baseEvent(pub, 'poll1', [['pow', '1']]); // almost certainly not a solution
    expect(await VoteTierService.tierOf(ev)).toBe('anonymous');
  });

  it('valid issuer cert bound to the voter → issuer tier', async () => {
    const issuer = keypair();
    const voter = keypair();
    vi.spyOn(TrustService, 'getIssuers').mockResolvedValue(
      [{ domain: 'endless.sbs', endpoint: '', publicKey: issuer.pub }] as any,
    );
    const cert = issuerCert(issuer.priv, 'endless.sbs', voter.pub);
    const ev = baseEvent(voter.pub, 'poll1', [['trust_cert', JSON.stringify(cert)]]);
    expect(await VoteTierService.tierOf(ev)).toBe('issuer');
  });

  it('issuer cert for a DIFFERENT pubkey → anonymous (cannot be replayed by a Sybil)', async () => {
    const issuer = keypair();
    const victim = keypair();
    const attacker = keypair();
    vi.spyOn(TrustService, 'getIssuers').mockResolvedValue(
      [{ domain: 'endless.sbs', endpoint: '', publicKey: issuer.pub }] as any,
    );
    const cert = issuerCert(issuer.priv, 'endless.sbs', victim.pub); // binds victim, not attacker
    const ev = baseEvent(attacker.pub, 'poll1', [['trust_cert', JSON.stringify(cert)]]);
    expect(await VoteTierService.tierOf(ev)).toBe('anonymous');
  });

  it('cert from an unknown issuer → anonymous', async () => {
    const issuer = keypair();
    const voter = keypair();
    vi.spyOn(TrustService, 'getIssuers').mockResolvedValue([] as any); // no trusted issuers
    const cert = issuerCert(issuer.priv, 'evil.example', voter.pub);
    const ev = baseEvent(voter.pub, 'poll1', [['trust_cert', JSON.stringify(cert)]]);
    expect(await VoteTierService.tierOf(ev)).toBe('anonymous');
  });

  it('valid relay attestation against the configured relay key → relay tier', async () => {
    const relay = keypair();
    const voter = keypair();
    config.setRelayAttestationPubkey(relay.pub);
    const payload = JSON.stringify({ voterPubkey: voter.pub, pollId: 'poll1', iat: Date.now() });
    const sig = CryptoService.sign(payload, relay.priv);
    const ev = baseEvent(voter.pub, 'poll1', [['relay_att', payload, sig]]);
    expect(await VoteTierService.tierOf(ev)).toBe('relay');
  });

  it('relay attestation with no configured relay key → anonymous', async () => {
    const relay = keypair();
    const voter = keypair();
    // config left empty
    const payload = JSON.stringify({ voterPubkey: voter.pub, pollId: 'poll1', iat: Date.now() });
    const sig = CryptoService.sign(payload, relay.priv);
    const ev = baseEvent(voter.pub, 'poll1', [['relay_att', payload, sig]]);
    expect(await VoteTierService.tierOf(ev)).toBe('anonymous');
  });

  it('no evidence → anonymous', async () => {
    const { pub } = keypair();
    expect(await VoteTierService.tierOf(baseEvent(pub, 'poll1'))).toBe('anonymous');
  });
});

describe('meetsTier', () => {
  it('ranks tiers correctly against a required tier', () => {
    expect(meetsTier('anonymous', 'open')).toBe(true);
    expect(meetsTier('anonymous', 'pow')).toBe(false);
    expect(meetsTier('pow', 'pow')).toBe(true);
    expect(meetsTier('issuer', 'relay')).toBe(true);
    expect(meetsTier('relay', 'issuer')).toBe(false);
  });
});
