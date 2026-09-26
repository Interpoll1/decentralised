// Content proof-of-work — per-item cost for creating posts, comments and polls.
//
// Every new content record carries `powNonce`. The work is bound to the
// record's identity (kind, id, createdAt, authorId), so each new post needs
// fresh work and a stamp cannot be reused on another record. The relay
// firewall rejects new content souls without a valid stamp, and clients can
// verify it on read.
//
// Plain JS with no imports: shared verbatim by the browser, the solver Web
// Worker (sha256Words is serialised with toString) and the Node relay.

export const CONTENT_POW_VERSION = 'interpoll.content-pow.v1';
/** Minimum leading zero bits a relay accepts (~1M hashes, <1s on a laptop). */
export const CONTENT_POW_MIN_BITS = 20;
/** A fresh stamp's createdAt must be within this window of the relay clock. */
// Long enough for offline-authored content to republish; short enough that
// stamps cannot be stockpiled for days ahead of a flood.
export const CONTENT_POW_MAX_AGE_MS = 6 * 60 * 60 * 1000;
export const CONTENT_POW_FUTURE_SKEW_MS = 2 * 60 * 1000;

/**
 * SHA-256 of an ASCII/Latin-1 string as eight int32 words. Self-contained so
 * the solver worker can embed it via toString(); tables are cached on the
 * function object (a named function expression keeps that reference valid
 * after minification and serialisation).
 */
export function sha256Words(str) {
  let c = sha256Words.c;
  if (!c) {
    c = sha256Words.c = {
      K: new Int32Array([
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
      ]),
      w: new Int32Array(64),
      out: new Int32Array(8),
    };
  }
  const K = c.K, w = c.w, out = c.out;
  const n = str.length;
  const blocks = ((n + 8) >> 6) + 1;
  let h0 = 0x6a09e667, h1 = 0xbb67ae85 | 0, h2 = 0x3c6ef372, h3 = 0xa54ff53a | 0;
  let h4 = 0x510e527f, h5 = 0x9b05688c | 0, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  for (let b = 0; b < blocks; b++) {
    for (let t = 0; t < 16; t++) {
      let v = 0;
      for (let k = 0; k < 4; k++) {
        const i = b * 64 + t * 4 + k;
        const byte = i < n ? str.charCodeAt(i) & 0xff : i === n ? 0x80 : 0;
        v = (v << 8) | byte;
      }
      w[t] = v;
    }
    if (b === blocks - 1) w[15] = n * 8;
    for (let t = 16; t < 64; t++) {
      const x = w[t - 15], y = w[t - 2];
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0;
    }
    let a = h0, bb = h1, cc = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let t = 0; t < 64; t++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const t1 = (h + S1 + ((e & f) ^ (~e & g)) + K[t] + w[t]) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const t2 = (S0 + ((a & bb) ^ (a & cc) ^ (bb & cc))) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = cc; cc = bb; bb = a; a = (t1 + t2) | 0;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + bb) | 0; h2 = (h2 + cc) | 0; h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
  }
  out[0] = h0; out[1] = h1; out[2] = h2; out[3] = h3; out[4] = h4; out[5] = h5; out[6] = h6; out[7] = h7;
  return out;
}

/** SHA-256 of an ASCII/Latin-1 string, hex output. */
export function sha256Hex(str) {
  let hex = '';
  for (const v of sha256Words(str)) hex += (v >>> 0).toString(16).padStart(8, '0');
  return hex;
}

/**
 * Short per-record seed. The work is done over `seed:nonce`, which fits in one
 * SHA-256 block, so solving and verifying are equally cheap per attempt.
 */
export function contentPowSeed({ kind, id, createdAt, authorId }) {
  // Non-ASCII ids/authors are escaped so sha256Hex's Latin-1 input is exact.
  const input = [CONTENT_POW_VERSION, kind, id, String(createdAt), authorId || ''].join('|');
  return sha256Hex(encodeURIComponent(input)).slice(0, 32);
}

/** Leading zero bits of sha256(`seed:nonce`) (0-32; minimum difficulty is well below 32). */
export function contentPowWork(seed, nonce) {
  return Math.clz32(sha256Words(`${seed}:${nonce}`)[0]);
}

/**
 * Verify a record's stamp.
 * @param {{kind:'post'|'comment'|'poll', id:string, createdAt:number, authorId?:string, powNonce:unknown}} rec
 * @param {{now?:number, fresh?:boolean, minBits?:number}} [opts]
 */
export function verifyContentPow(rec, opts = {}) {
  const { now = Date.now(), fresh = false, minBits = CONTENT_POW_MIN_BITS } = opts;
  if (!rec || typeof rec.id !== 'string' || !rec.id) return false;
  const createdAt = Number(rec.createdAt);
  const nonce = Number(rec.powNonce);
  if (!Number.isSafeInteger(createdAt) || !Number.isSafeInteger(nonce) || nonce < 0) return false;
  if (fresh && (createdAt < now - CONTENT_POW_MAX_AGE_MS || createdAt > now + CONTENT_POW_FUTURE_SKEW_MS)) return false;
  const seed = contentPowSeed({ kind: rec.kind, id: rec.id, createdAt, authorId: rec.authorId });
  return contentPowWork(seed, nonce) >= minBits;
}

/** Synchronous solver (tests, relay tooling). Browsers use the Web Worker path. */
export function solveContentPow(stampInput, bits = CONTENT_POW_MIN_BITS, maxAttempts = 2 ** 32) {
  const seed = contentPowSeed(stampInput);
  for (let nonce = 0; nonce < maxAttempts; nonce++) {
    if (contentPowWork(seed, nonce) >= bits) return nonce;
  }
  throw new Error('CONTENT_POW_EXHAUSTED');
}
