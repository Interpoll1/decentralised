import { schnorr } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { randomBytes } from 'crypto';
import { canonicalJSON } from './integrity.js';

export function verifySignature(message) {
  if (!message || typeof message !== 'object') return false;
  if (!message._pub || !message._sig) return false;
  if (typeof message._pub !== 'string' || typeof message._sig !== 'string') return false;

  try {
    if (!/^[0-9a-f]{64}$/i.test(message._pub)) return false;
    if (!/^[0-9a-f]{128}$/i.test(message._sig)) return false;

    const dataToVerify = canonicalJSON(message);
    const messageHash = bytesToHex(sha256(new TextEncoder().encode(dataToVerify)));
    return schnorr.verify(
      hexToBytes(message._sig),
      hexToBytes(messageHash),
      hexToBytes(message._pub)
    );
  } catch {
    return false;
  }
}

export function generateKeyPair() {
  const privateKeyBytes = randomBytes(32);
  const privateKey = bytesToHex(new Uint8Array(privateKeyBytes));
  const publicKey = bytesToHex(schnorr.getPublicKey(hexToBytes(privateKey)));

  return {
    publicKey,
    privateKey,
  };
}

export function signMessage(message, keyPair) {
  const dataToSign = canonicalJSON(message);
  const messageHash = bytesToHex(sha256(new TextEncoder().encode(dataToSign)));
  const sig = schnorr.sign(hexToBytes(messageHash), hexToBytes(keyPair.privateKey));
  return {
    ...message,
    _pub: keyPair.publicKey,
    _sig: bytesToHex(sig),
  };
}

/**
 * Sign an arbitrary string with Schnorr over sha256(data) — no canonicalJSON,
 * no envelope fields. Deliberately mirrors the frontend's
 * `CryptoService.sign(data, privateKey)` (src/services/cryptoService.ts) so a
 * signature produced here verifies with the frontend's `CryptoService.verify`
 * and vice versa. Used for the relay's vote-attestation tier (Sybil
 * resistance) — see voteTierService.ts on the client.
 */
export function signRawSchnorr(data, privateKeyHex) {
  const hash = bytesToHex(sha256(new TextEncoder().encode(data)));
  const sig = schnorr.sign(hexToBytes(hash), hexToBytes(privateKeyHex));
  return bytesToHex(sig);
}

/** Verify a signature produced by {@link signRawSchnorr} (or CryptoService.sign). */
export function verifyRawSchnorr(data, signatureHex, publicKeyHex) {
  try {
    const hash = bytesToHex(sha256(new TextEncoder().encode(data)));
    return schnorr.verify(hexToBytes(signatureHex), hexToBytes(hash), hexToBytes(publicKeyHex));
  } catch {
    return false;
  }
}

/** Derive the x-only Schnorr public key (hex) for a private key (hex). */
export function publicKeyFromPrivateKey(privateKeyHex) {
  return bytesToHex(schnorr.getPublicKey(hexToBytes(privateKeyHex)));
}
