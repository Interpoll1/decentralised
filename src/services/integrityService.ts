import { CryptoService } from '@/services/cryptoService';
import { KeyService } from '@/services/keyService';

const META_FIELDS = new Set(['_hash', '_sig', '_pub', '_pow', '_ts', '_nonce']);

const POW_DIFFICULTY: Record<string, number> = {
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

const SOLVER_BATCH_SIZE = 5_000;
const NONCE_CACHE_MAX = 5_000;

export interface IntegrityMeta {
  _hash: string;
  _sig: string;
  _pub: string;
  _pow: string;
  _ts: number;
  _nonce: string;
}

function stableStringify(val: unknown): string | undefined {
  if (val === undefined) return undefined;
  if (val === null) return 'null';
  if (typeof val !== 'object') return JSON.stringify(val);
  if (Array.isArray(val)) {
    return '[' + val.map((v) => stableStringify(v) ?? 'null').join(',') + ']';
  }
  const keys = Object.keys(val as Record<string, unknown>).sort();
  const pairs: string[] = [];
  for (const k of keys) {
    const sv = stableStringify((val as Record<string, unknown>)[k]);
    if (sv !== undefined) pairs.push(JSON.stringify(k) + ':' + sv);
  }
  return '{' + pairs.join(',') + '}';
}

function canonicalJSON(obj: Record<string, unknown>): string {
  const stripped: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (!META_FIELDS.has(k)) stripped[k] = v;
  }
  return stableStringify(stripped) ?? '{}';
}

function hasLeadingZeroBits(hashHex: string, bits: number): boolean {
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

async function solveHashcash(contentHash: string, difficulty: number): Promise<string> {
  let nonce = 0;
  for (;;) {
    for (let i = 0; i < SOLVER_BATCH_SIZE; i++) {
      const nonceStr = nonce.toString(16);
      const hash = CryptoService.hash(contentHash + ':' + nonceStr);
      if (hasLeadingZeroBits(hash, difficulty)) return nonceStr;
      nonce++;
    }
    // Yield to event loop to avoid UI freeze
    await new Promise<void>((r) => setTimeout(r, 0));
  }
}

export class IntegrityService {
  private static readonly seenNonces = new Map<string, number>();
  /**
   * Seal a message payload with integrity fields.
   * Pipeline: sign → hash → PoW → freshness
   */
  static async seal<T extends Record<string, unknown>>(
    payload: T,
    messageType?: string,
  ): Promise<T & IntegrityMeta> {
    const type = messageType || (payload.type as string) || '';

    if (POW_EXEMPT.has(type)) {
      const ts = Date.now();
      return {
        ...payload,
        _sig: '',
        _pub: '',
        _hash: '',
        _pow: '',
        _ts: ts,
        _nonce: crypto.randomUUID(),
      };
    }

    // 1. Sign — CryptoService.sign() internally hashes with SHA-256 then signs
    const canonical = canonicalJSON(payload as Record<string, unknown>);
    const privateKey = await KeyService.getPrivateKeyHex();
    const publicKey = await KeyService.getPublicKeyHex();
    const sig = CryptoService.sign(canonical, privateKey);

    // 2. Hash — SHA-256 of canonical JSON
    const hash = CryptoService.hash(canonical);

    // 3. PoW — find nonce where SHA-256(hash + ':' + nonce) has N leading zero bits
    const difficulty = POW_DIFFICULTY[type] || POW_DIFFICULTY.DEFAULT;
    const pow = await solveHashcash(hash, difficulty);

    // 4. Freshness
    const ts = Date.now();
    const nonce = crypto.randomUUID();

    return {
      ...payload,
      _sig: sig,
      _pub: publicKey,
      _hash: hash,
      _pow: pow,
      _ts: ts,
      _nonce: nonce,
    };
  }

  /** Check if a message type is exempt from integrity sealing */
  static isExempt(type: string): boolean {
    return POW_EXEMPT.has(type);
  }

  /**
   * Verify an incoming sealed payload.
   * Checks freshness, canonical hash integrity, Schnorr signature, and PoW.
   */
  static verifySealedPayload(
    payload: Record<string, unknown>,
    messageType?: string,
    maxAgeMs = 5 * 60_000,
  ): boolean {
    const type = messageType || String(payload.type || '');
    const ts = payload._ts;
    const nonce = payload._nonce;

    if (typeof ts !== 'number' || typeof nonce !== 'string' || nonce.length === 0) {
      return false;
    }

    const now = Date.now();
    const MAX_FUTURE_SKEW_MS = 30_000;
    if (ts > now + MAX_FUTURE_SKEW_MS) {
      return false;
    }

    if (now - ts > maxAgeMs) {
      return false;
    }

    if (this.isExempt(type)) {
      return this.acceptNonce(nonce, ts, maxAgeMs);
    }

    const sig = payload._sig;
    const pub = payload._pub;
    const hash = payload._hash;
    const pow = payload._pow;

    if (
      typeof sig !== 'string' ||
      typeof pub !== 'string' ||
      typeof hash !== 'string' ||
      typeof pow !== 'string'
    ) {
      return false;
    }

    const canonical = canonicalJSON(payload);
    const calculatedHash = CryptoService.hash(canonical);
    if (calculatedHash !== hash) {
      return false;
    }

    if (!CryptoService.verify(canonical, sig, pub)) {
      return false;
    }

    const difficulty = POW_DIFFICULTY[type] || POW_DIFFICULTY.DEFAULT;
    const powHash = CryptoService.hash(`${hash}:${pow}`);
    if (!hasLeadingZeroBits(powHash, difficulty)) {
      return false;
    }

    return this.acceptNonce(nonce, ts, maxAgeMs);
  }

  private static acceptNonce(nonce: string, ts: number, maxAgeMs: number): boolean {
    this.pruneNonceCache(ts - maxAgeMs);
    if (this.seenNonces.has(nonce)) {
      return false;
    }

    this.seenNonces.set(nonce, ts);
    if (this.seenNonces.size > NONCE_CACHE_MAX) {
      const oldestKey = this.seenNonces.keys().next().value;
      if (oldestKey) {
        this.seenNonces.delete(oldestKey);
      }
    }
    return true;
  }

  private static pruneNonceCache(minTimestamp: number): void {
    for (const [nonce, seenAt] of this.seenNonces) {
      if (seenAt < minTimestamp) {
        this.seenNonces.delete(nonce);
      }
    }
  }
}
