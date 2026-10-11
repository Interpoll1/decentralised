// coturn REST-API ("use-auth-secret") credentials for 1:1 calls.
// username = "<unix-expiry>:<subject>", credential = base64(HMAC-SHA1(secret, username)).
// The shared secret lives only in TURN_SECRET on the relay and in coturn's config.
import crypto from 'crypto';
import { schnorr } from '@noble/curves/secp256k1.js';
import { hexToBytes } from '@noble/hashes/utils.js';

const TURN_REQ_SKEW_MS = 60_000;

export function makeTurnCredentials(secret, subject, nowMs, ttlSec) {
  const username = `${Math.floor(nowMs / 1000) + ttlSec}:${subject}`;
  const credential = crypto.createHmac('sha1', secret).update(username).digest('base64');
  return { username, credential, ttl: ttlSec };
}

/** Stable, non-reversible subject for a user id or IP (never sent to coturn in the clear). */
export function turnSubject(id) {
  return crypto.createHash('sha256').update(String(id)).digest('hex').slice(0, 32);
}

/** Message a device key signs to request TURN credentials (must match the client). */
export function turnRequestMessage(pubkey, ts) {
  return `interpoll-turn:${pubkey}:${ts}`;
}

/**
 * Verify a device-key-signed TURN request. Signature is Schnorr over
 * sha256(turnRequestMessage) — same scheme as CryptoService.sign on the client.
 */
export function verifyTurnRequest(pubkey, ts, sig, nowMs) {
  if (typeof pubkey !== 'string' || !/^[0-9a-f]{64}$/i.test(pubkey)) return false;
  if (typeof sig !== 'string' || !/^[0-9a-f]{128}$/i.test(sig)) return false;
  const t = Number(ts);
  if (!Number.isFinite(t) || Math.abs(nowMs - t) > TURN_REQ_SKEW_MS) return false;
  try {
    const hash = crypto.createHash('sha256').update(turnRequestMessage(pubkey, String(ts))).digest();
    return schnorr.verify(hexToBytes(sig), hash, hexToBytes(pubkey));
  } catch {
    return false;
  }
}
