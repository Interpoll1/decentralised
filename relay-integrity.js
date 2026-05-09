import crypto from 'crypto';
import { schnorr } from '@noble/curves/secp256k1.js';
import { hexToBytes } from '@noble/hashes/utils';

const META_FIELDS = new Set(['_hash', '_sig', '_pub', '_pow', '_ts', '_nonce']);
const MAX_FUTURE_SKEW_MS = 30_000;
const DEFAULT_MAX_AGE_MS = 5 * 60_000;
const NONCE_CACHE_MAX = 10_000;
const NONCE_CLEANUP_INTERVAL_MS = 60_000;

const POW_DIFFICULTY = {
  'new-poll': 16,
  'new-block': 16,
  'new-event': 16,
  'vote-authorize': 18,
  'vote-record': 18,
  'vote-confirm': 18,
  'poll-policy': 18,
  'broadcast': 12,
  'chat-message': 10,
  'chatroom-message': 10,
  'index': 14,
  DEFAULT: 12,
};

const POW_EXEMPT = new Set([
  'ping', 'pong', 'register', 'join-room',
  'chat-typing', 'chat-read', 'chat-delivered', 'chat-read-receipt',
  'rtc-offer', 'rtc-answer', 'rtc-ice',
  'snapshot-accept', 'snapshot-cancel',
]);

const seenNonces = new Map();

function stableStringify(val) {
  if (val === undefined) return undefined;
  if (val === null) return 'null';
  if (typeof val !== 'object') return JSON.stringify(val);
  if (Array.isArray(val)) {
    return '[' + val.map((v) => stableStringify(v) ?? 'null').join(',') + ']';
  }
  const keys = Object.keys(val).sort();
  const pairs = [];
  for (const k of keys) {
    const sv = stableStringify(val[k]);
    if (sv !== undefined) pairs.push(JSON.stringify(k) + ':' + sv);
  }
  return '{' + pairs.join(',') + '}';
}

function canonicalJSON(obj) {
  const stripped = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (!META_FIELDS.has(k)) stripped[k] = v;
  }
  return stableStringify(stripped) ?? '{}';
}

function hasLeadingZeroBits(hashHex, bits) {
  const fullBytes = Math.floor(bits / 8);
  const remainderBits = bits % 8;
  for (let i = 0; i < fullBytes; i++) {
    if (parseInt(hashHex.substring(i * 2, i * 2 + 2), 16) !== 0) return false;
  }
  if (remainderBits > 0) {
    const byte = parseInt(hashHex.substring(fullBytes * 2, fullBytes * 2 + 2), 16);
    const mask = (0xff >> remainderBits) ^ 0xff;
    if ((byte & mask) !== 0) return false;
  }
  return true;
}

function isHex(value, length) {
  if (typeof value !== 'string') return false;
  const re = new RegExp(`^[0-9a-fA-F]{${length}}$`);
  return re.test(value);
}

function acceptNonce(nonce, ts, maxAgeMs) {
  const minTimestamp = ts - maxAgeMs;
  for (const [seenNonce, seenAt] of seenNonces) {
    if (seenAt < minTimestamp) seenNonces.delete(seenNonce);
  }
  if (seenNonces.has(nonce)) {
    return false;
  }
  seenNonces.set(nonce, ts);
  if (seenNonces.size > NONCE_CACHE_MAX) {
    const oldestKey = seenNonces.keys().next().value;
    if (oldestKey) seenNonces.delete(oldestKey);
  }
  return true;
}

function verifySignature(canonical, signatureHex, pubkeyHex) {
  try {
    const messageHashHex = crypto.createHash('sha256').update(canonical).digest('hex');
    return schnorr.verify(
      hexToBytes(signatureHex),
      hexToBytes(messageHashHex),
      hexToBytes(pubkeyHex),
    );
  } catch {
    return false;
  }
}

export function verifyRelayRequestIntegrity(payload, messageType, maxAgeMs = DEFAULT_MAX_AGE_MS) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { valid: false, reason: 'payload must be an object' };
  }

  const ts = payload._ts;
  const nonce = payload._nonce;
  if (typeof ts !== 'number' || !Number.isFinite(ts)) {
    return { valid: false, reason: 'missing or invalid _ts' };
  }
  if (typeof nonce !== 'string' || nonce.length === 0 || nonce.length > 128) {
    return { valid: false, reason: 'missing or invalid _nonce' };
  }

  const now = Date.now();
  if (ts > now + MAX_FUTURE_SKEW_MS) {
    return { valid: false, reason: 'timestamp too far in future' };
  }
  if (now - ts > maxAgeMs) {
    return { valid: false, reason: 'payload expired' };
  }

  if (!acceptNonce(nonce, ts, maxAgeMs)) {
    return { valid: false, reason: 'duplicate nonce' };
  }

  if (POW_EXEMPT.has(messageType)) {
    return { valid: true, reason: null };
  }

  const hash = payload._hash;
  const signature = payload._sig;
  const pubkey = payload._pub;
  const pow = payload._pow;
  if (!isHex(hash, 64)) {
    return { valid: false, reason: 'missing or invalid _hash' };
  }
  if (!isHex(signature, 128)) {
    return { valid: false, reason: 'missing or invalid _sig' };
  }
  if (!isHex(pubkey, 64)) {
    return { valid: false, reason: 'missing or invalid _pub' };
  }
  if (typeof pow !== 'string' || pow.length === 0 || pow.length > 64) {
    return { valid: false, reason: 'missing or invalid _pow' };
  }

  const canonical = canonicalJSON(payload);
  const calculatedHash = crypto.createHash('sha256').update(canonical).digest('hex');
  if (calculatedHash !== hash) {
    return { valid: false, reason: 'content hash mismatch' };
  }

  if (!verifySignature(canonical, signature, pubkey)) {
    return { valid: false, reason: 'signature verification failed' };
  }

  const difficulty = POW_DIFFICULTY[messageType] ?? POW_DIFFICULTY.DEFAULT;
  const powHash = crypto.createHash('sha256').update(`${hash}:${pow}`).digest('hex');
  if (!hasLeadingZeroBits(powHash, difficulty)) {
    return { valid: false, reason: 'proof-of-work verification failed' };
  }

  return { valid: true, reason: null };
}

setInterval(() => {
  const cutoff = Date.now() - DEFAULT_MAX_AGE_MS;
  for (const [nonce, seenAt] of seenNonces) {
    if (seenAt < cutoff) seenNonces.delete(nonce);
  }
}, NONCE_CLEANUP_INTERVAL_MS);
