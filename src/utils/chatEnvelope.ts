/**
 * Authorship proof for chat messages.
 *
 * Chat was the one user-facing surface that wrote to Gun without a signature.
 * Gun nodes are world-writable, and `mergeRemote` took `senderId` straight off
 * the record — so anyone who knew a victim's user id could seal a message to the
 * victim's published key, drop it into `v3/chats/{room}/{anyId}` with `senderId`
 * set to someone the victim trusts, and it rendered as a genuine message from
 * that person. Group rooms had the same hole from the inside: the HMAC auth tag
 * is computed with the *room* key, which every member holds, so any member could
 * forge any other member's messages.
 *
 * The fix rests on an identity fact this codebase already establishes elsewhere:
 * a user id **is** their x-only secp256k1 public key (`UserService.getCurrentUser`
 * keys every profile by `KeyService.getPublicKeyHex()`). So binding a signature
 * to a claimed sender needs no key lookup and no trusted directory — the claim
 * and the verifying key are the same string. `_pub !== senderId` is a forgery,
 * full stop, and there is no MITM position on that check.
 *
 * ## Why not `IntegrityService.verifySealedPayload`
 *
 * That verifier is built for live relay traffic: it rejects anything older than
 * five minutes and burns each `_nonce` on first sight. Both are correct there and
 * both are wrong here. A chat message is a durable record — it is re-read from
 * IndexedDB and re-verified every time history loads, months after it was
 * written. Freshness would reject all of it, and single-use nonces would reject
 * the second read of a message that verified fine on the first.
 *
 * So this module reuses the same primitives — `canonicalJSON`, the schnorr
 * signature, the hashcash solver — under durable semantics: signature and
 * proof-of-work are checked, freshness and replay are not. Replay is meaningless
 * for chat anyway, since a replayed message carries its original id and collapses
 * into the copy already stored.
 *
 * ## Why the signed payload is rebuilt rather than verified in place
 *
 * Records read back from Gun carry Gun's own `_` metadata (soul, vector clock),
 * and a hostile writer can append any field it likes. Canonicalising the raw
 * record would fold all of that into the hash and break verification — or, worse,
 * invite a signer/verifier disagreement about which fields count. `verifyEnvelope`
 * therefore reconstructs the signed object from an explicit field list and
 * ignores everything else on the record. What is not in the list is not signed,
 * and callers are expected to treat it as untrusted.
 */

import { CryptoService } from '../services/cryptoService';
import { hasLeadingZeroBits, solveHashcash, CHAT_POW_BASE } from '../services/integrityService';
import { canonicalJSON } from '../../shared-validation/canonical.js';

/** Fields appended by `sealEnvelope`, mirroring `IntegrityMeta`. */
export interface ChatEnvelopeMeta {
  _ts: number;
  _nonce: string;
  _sig: string;
  _pub: string;
  _hash: string;
  _pow: string;
}

export type EnvelopeFields = Record<string, string | number | undefined>;

/** The envelope metadata keys, so callers can strip or forward them wholesale. */
export const ENVELOPE_META_KEYS = ['_ts', '_nonce', '_sig', '_pub', '_hash', '_pow'] as const;

/**
 * Bind a signature to ciphertext without decrypting it.
 *
 * Every encrypted part is folded in, not just the body: wrapping only
 * `ciphertext` would leave the RSA-wrapped AES keys unsigned, and swapping
 * `keyForRecipient` is enough to make a message undecryptable — a silent
 * denial-of-service that would still verify.
 */
export function cipherDigest(...parts: Array<string | undefined>): string {
  return CryptoService.hash(parts.map((part) => part ?? '').join('|'));
}

/** Drop `undefined` values so signer and verifier canonicalise identical objects. */
function compact(fields: EnvelopeFields): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/**
 * Sign a chat envelope.
 *
 * `difficulty` is the sender's choice — see `CHAT_POW_COLD` for why it varies by
 * relationship and why the verifier does not try to reproduce it.
 */
export async function sealEnvelope(
  fields: EnvelopeFields,
  privateKeyHex: string,
  publicKeyHex: string,
  difficulty: number = CHAT_POW_BASE,
): Promise<ChatEnvelopeMeta> {
  // `_ts`/`_nonce` go in before signing: canonicalJSON deliberately keeps them,
  // so they are covered by both the hash and the signature.
  const signed = {
    ...compact(fields),
    _ts: Date.now(),
    _nonce: crypto.randomUUID(),
  };

  const canonical = canonicalJSON(signed);
  const hash = CryptoService.hash(canonical);

  return {
    _ts: signed._ts,
    _nonce: signed._nonce,
    _sig: CryptoService.sign(canonical, privateKeyHex),
    _pub: publicKeyHex,
    _hash: hash,
    _pow: await solveHashcash(hash, difficulty),
  };
}

export type EnvelopeVerdict =
  /** Signed by the claimed sender. */
  | { status: 'valid' }
  /** No envelope present — a v1/v2 record, or an unsigned write. */
  | { status: 'unsigned' }
  /** An envelope is present but does not hold up. */
  | { status: 'invalid'; reason: string };

/**
 * Verify an envelope against a claimed sender.
 *
 * `signedFields` must list exactly the field names the sender signed, in any
 * order; values are read off `raw`. `expectedSenderId` is the identity the
 * message claims, and is required to equal `_pub`.
 */
export function verifyEnvelope(
  raw: Record<string, unknown>,
  signedFields: readonly string[],
  expectedSenderId: string,
): EnvelopeVerdict {
  const sig = raw._sig;
  const pub = raw._pub;
  const hash = raw._hash;
  const pow = raw._pow;
  const ts = raw._ts;
  const nonce = raw._nonce;

  const missing =
    typeof sig !== 'string' || sig.length === 0 ||
    typeof pub !== 'string' || pub.length === 0 ||
    typeof hash !== 'string' ||
    typeof pow !== 'string' ||
    typeof ts !== 'number' ||
    typeof nonce !== 'string';

  if (missing) return { status: 'unsigned' };

  // The whole point. A signature that verifies against some *other* key proves
  // nothing about the sender this message claims to be from.
  if (pub !== expectedSenderId) {
    return { status: 'invalid', reason: 'signing key does not match claimed sender' };
  }

  // Rebuilt from the explicit field list — never from `raw`, which carries Gun
  // metadata and anything else a hostile writer appended.
  const fields: EnvelopeFields = {};
  for (const name of signedFields) {
    const value = raw[name];
    if (typeof value === 'string' || typeof value === 'number') fields[name] = value;
  }

  const canonical = canonicalJSON({ ...compact(fields), _ts: ts, _nonce: nonce });

  if (CryptoService.hash(canonical) !== hash) {
    return { status: 'invalid', reason: 'content does not match signed hash' };
  }

  if (!CryptoService.verify(canonical, sig, pub)) {
    return { status: 'invalid', reason: 'signature verification failed' };
  }

  // Base tier only: the sender may have paid more, never less.
  if (!hasLeadingZeroBits(CryptoService.hash(`${hash}:${pow}`), CHAT_POW_BASE)) {
    return { status: 'invalid', reason: 'insufficient proof of work' };
  }

  return { status: 'valid' };
}

/**
 * Field names signed on a direct message.
 *
 * `replyTo` is in here because an unsigned one is a way to put words in
 * someone's mouth: re-point a reply at a different message and the quoted
 * context changes while the bubble still verifies. Optional fields cost nothing
 * when absent — `compact` drops them on the way in, and `verifyEnvelope` only
 * reads the names actually present on the record.
 */
export const DM_SIGNED_FIELDS = [
  'id', 'senderId', 'recipientId', 'timestamp', 'seq', 'cipherHash', 'replyTo',
] as const;

/** Field names signed on a group-room message. */
export const ROOM_SIGNED_FIELDS = [
  'id', 'roomId', 'senderId', 'timestamp', 'seq', 'cipherHash',
] as const;
