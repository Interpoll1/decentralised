/**
 * Minimal Trust Issuer API for InterPoll.
 *
 * Endpoints:
 *   POST /challenge { username, pubkey }
 *   POST /claim     { challengeId, nonce, username, pubkey }
 *   GET  /health
 *   GET  /public-key
 *
 * Run (Node 22+):
 *   TRUST_PRIVATE_KEY_HEX=... node --experimental-strip-types trustapi.ts
 *
 * Or with tsx:
 *   npx tsx trustapi.ts
 */

import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { schnorr } from '@noble/curves/secp256k1.js';

type ChallengeRecord = {
  challengeId: string;
  username: string;
  pubkey: string;
  prefix: string;
  difficulty: number;
  expiresAt: number;
  createdAt: number;
  used: boolean;
};

type ClaimRecord = {
  username: string;
  pubkey: string;
  issuedAt: number;
  expiresAt: number;
  signature: string;
};

type PersistedState = {
  claims: Record<string, ClaimRecord>;
  usedAuthNonces?: Record<string, number>;
};

const PORT = Number(process.env.TRUST_PORT || 8787);
const ISSUER_DOMAIN = (process.env.TRUST_ISSUER_DOMAIN || 'endless.sbs').trim().toLowerCase();
const FRONTEND_ORIGINS = parseAllowedOrigins(process.env.TRUST_FRONTEND_ORIGIN);
const PRIVATE_KEY_HEX = (process.env.TRUST_PRIVATE_KEY_HEX || '').trim();
const DIFFICULTY = clampInt(process.env.TRUST_POW_DIFFICULTY, 22, 18, 30);
const CHALLENGE_TTL_MS = clampInt(process.env.TRUST_CHALLENGE_TTL_MS, 10 * 60_000, 30_000, 60 * 60_000);
const CERT_TTL_MS = clampInt(process.env.TRUST_CERT_TTL_MS, 180 * 24 * 60 * 60 * 1000, 24 * 60 * 60 * 1000, 3_650 * 24 * 60 * 60 * 1000);
const CLAIM_V2_AUTH_PAST_SKEW_MS = clampInt(process.env.TRUST_CLAIM_V2_AUTH_PAST_SKEW_MS, 120_000, 10_000, 10 * 60_000);
const CLAIM_V2_AUTH_FUTURE_SKEW_MS = clampInt(process.env.TRUST_CLAIM_V2_AUTH_FUTURE_SKEW_MS, 30_000, 1_000, 120_000);
const CLAIM_V2_AUTH_NONCE_TTL_MS = clampInt(process.env.TRUST_CLAIM_V2_AUTH_NONCE_TTL_MS, 10 * 60_000, 30_000, 24 * 60 * 60 * 1000);
const MAX_BODY_BYTES = clampInt(process.env.TRUST_MAX_BODY_BYTES, 32_000, 1_024, 256_000);
const STATE_FILE = resolve(process.env.TRUST_STATE_FILE || './data/trust-issuer-state.json');
const ALLOWED_ORIGIN_SET = new Set([
  ...FRONTEND_ORIGINS,
  'https://endless.sbs',
  'https://interpoll.endless.sbs',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]);

if (!PRIVATE_KEY_HEX) {
  throw new Error('Missing TRUST_PRIVATE_KEY_HEX env var');
}

const ISSUER_PUBLIC_KEY_HEX = bytesToHex(schnorr.getPublicKey(hexToBytes(PRIVATE_KEY_HEX)));
const challenges = new Map<string, ChallengeRecord>();
const claims = new Map<string, ClaimRecord>();
const usedAuthNonces = new Map<string, number>();

const server = http.createServer(async (req, res) => {
  try {
    setCorsHeaders(req, res);

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    if (req.method === 'GET' && url.pathname === '/health') {
      return sendJson(res, 200, {
        ok: true,
        issuerDomain: ISSUER_DOMAIN,
        difficulty: DIFFICULTY,
        activeChallenges: challenges.size,
        issuedClaims: claims.size,
      });
    }

    if (req.method === 'GET' && url.pathname === '/public-key') {
      return sendJson(res, 200, {
        issuerDomain: ISSUER_DOMAIN,
        publicKey: ISSUER_PUBLIC_KEY_HEX,
        protocols: ['v1', 'v2'],
      });
    }

    if (req.method === 'POST' && url.pathname === '/challenge') {
      const body = await readJsonBody(req);
      return handleChallengeRequest(res, body);
    }

    if (req.method === 'POST' && url.pathname === '/challenge-v2') {
      const body = await readJsonBody(req);
      return handleChallengeRequest(res, body);
    }

    if (req.method === 'POST' && url.pathname === '/claim') {
      const body = await readJsonBody(req);
      return handleClaimRequest(res, body, false);
    }

    if (req.method === 'POST' && url.pathname === '/claim-v2') {
      const body = await readJsonBody(req);
      return handleClaimRequest(res, body, true);
    }

    return sendJson(res, 404, { error: 'Not found' });
  } catch (err) {
    console.error('[trustapi] request error:', err);
    return sendJson(res, 500, { error: 'Internal server error' });
  }
});

void start().catch((err) => {
  console.error('[trustapi] startup error:', err);
  process.exit(1);
});

function hash(data: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(data)));
}

function signPayload(payload: string, privateKeyHex: string): string {
  const digest = hexToBytes(hash(payload));
  const sig = schnorr.sign(digest, hexToBytes(privateKeyHex));
  return bytesToHex(sig);
}

function verifySignedPayload(payload: string, signatureHex: string, publicKeyHex: string): boolean {
  try {
    const digest = hexToBytes(hash(payload));
    return schnorr.verify(hexToBytes(signatureHex), digest, hexToBytes(publicKeyHex));
  } catch {
    return false;
  }
}

function countLeadingZeroBits(hexHash: string): number {
  let bits = 0;
  for (const ch of hexHash) {
    const nibble = parseInt(ch, 16);
    if (nibble === 0) {
      bits += 4;
      continue;
    }
    if (nibble < 2) bits += 3;
    else if (nibble < 4) bits += 2;
    else if (nibble < 8) bits += 1;
    break;
  }
  return bits;
}

function normalizeUsername(input: unknown): string {
  return typeof input === 'string' ? input.trim() : '';
}

function normalizeHex(input: unknown): string {
  return typeof input === 'string' ? input.trim().toLowerCase() : '';
}

function isValidUsername(username: string): boolean {
  return /^[a-zA-Z0-9_.-]{3,32}$/.test(username);
}

function isValidPubkey(pubkey: string): boolean {
  return /^[0-9a-f]{64}$/.test(pubkey);
}

function clampInt(input: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(input);
  if (!Number.isFinite(parsed)) return fallback;
  const int = Math.trunc(parsed);
  if (int < min) return min;
  if (int > max) return max;
  return int;
}

function parseAllowedOrigins(input: string | undefined): string[] {
  const configured = (input || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  return configured.length > 0 ? configured : ['https://endless.sbs', 'https://interpoll.endless.sbs'];
}

async function start(): Promise<void> {
  await loadState();
  setInterval(cleanupChallenges, 15_000).unref();
  setInterval(cleanupUsedAuthNonces, 30_000).unref();

  server.listen(PORT, () => {
    console.log(`[trustapi] listening on :${PORT}`);
    console.log(`[trustapi] issuer domain: ${ISSUER_DOMAIN}`);
    console.log(`[trustapi] issuer pubkey: ${ISSUER_PUBLIC_KEY_HEX}`);
    console.log(`[trustapi] state file: ${STATE_FILE}`);
    console.log(`[trustapi] allowed origins: ${Array.from(ALLOWED_ORIGIN_SET).join(', ')}`);
  });
}

function cleanupChallenges(): void {
  const now = Date.now();
  for (const [id, challenge] of challenges) {
    if (challenge.expiresAt <= now || challenge.used) challenges.delete(id);
  }
}

function cleanupUsedAuthNonces(): void {
  const now = Date.now();
  for (const [key, expiresAt] of usedAuthNonces) {
    if (expiresAt <= now) usedAuthNonces.delete(key);
  }
}

function buildClaimV2AuthPayload(input: {
  challengeId: string;
  username: string;
  pubkey: string;
  nonce: number;
  authTs: number;
  authNonce: string;
}): string {
  const { challengeId, username, pubkey, nonce, authTs, authNonce } = input;
  return JSON.stringify({
    purpose: 'interpoll-trust-claim-v2',
    issuerDomain: ISSUER_DOMAIN,
    challengeId,
    username,
    pubkey,
    nonce,
    authTs,
    authNonce,
  });
}

function handleChallengeRequest(res: http.ServerResponse, body: any): void {
  const username = normalizeUsername(body?.username);
  const pubkey = normalizeHex(body?.pubkey);

  if (!isValidUsername(username)) {
    sendJson(res, 400, { error: 'Invalid username format' });
    return;
  }
  if (!isValidPubkey(pubkey)) {
    sendJson(res, 400, { error: 'Invalid pubkey' });
    return;
  }

  const claim = claims.get(username);
  if (claim && claim.pubkey !== pubkey) {
    sendJson(res, 409, { error: 'Username already claimed by another pubkey' });
    return;
  }

  const challengeId = randomUUID();
  const createdAt = Date.now();
  const expiresAt = createdAt + CHALLENGE_TTL_MS;
  const prefix = `issuer:${ISSUER_DOMAIN}|username:${username}|pubkey:${pubkey}|challenge:${challengeId}|`;

  const challenge: ChallengeRecord = {
    challengeId,
    username,
    pubkey,
    prefix,
    difficulty: DIFFICULTY,
    expiresAt,
    createdAt,
    used: false,
  };

  challenges.set(challengeId, challenge);
  sendJson(res, 200, {
    challengeId,
    prefix,
    difficulty: DIFFICULTY,
    expiresAt,
  });
}

async function handleClaimRequest(res: http.ServerResponse, body: any, requireV2Auth: boolean): Promise<void> {
  const challengeId = typeof body?.challengeId === 'string' ? body.challengeId.trim() : '';
  const username = normalizeUsername(body?.username);
  const pubkey = normalizeHex(body?.pubkey);
  const nonce = body?.nonce;

  if (!challengeId) {
    sendJson(res, 400, { error: 'Missing challengeId' });
    return;
  }
  if (!isValidUsername(username)) {
    sendJson(res, 400, { error: 'Invalid username format' });
    return;
  }
  if (!isValidPubkey(pubkey)) {
    sendJson(res, 400, { error: 'Invalid pubkey' });
    return;
  }
  if (!Number.isSafeInteger(nonce) || nonce < 0) {
    sendJson(res, 400, { error: 'Invalid nonce' });
    return;
  }

  if (requireV2Auth) {
    const authSig = typeof body?.authSig === 'string' ? body.authSig.trim().toLowerCase() : '';
    const authNonce = typeof body?.authNonce === 'string' ? body.authNonce.trim() : '';
    const authTs = Number(body?.authTs);
    if (!/^[0-9a-f]{128}$/.test(authSig)) {
      sendJson(res, 400, { error: 'Invalid authSig' });
      return;
    }
    if (!/^[A-Za-z0-9_.:-]{8,128}$/.test(authNonce)) {
      sendJson(res, 400, { error: 'Invalid authNonce' });
      return;
    }
    if (!Number.isFinite(authTs)) {
      sendJson(res, 400, { error: 'Invalid authTs' });
      return;
    }
    const now = Date.now();
    if (authTs < now - CLAIM_V2_AUTH_PAST_SKEW_MS || authTs > now + CLAIM_V2_AUTH_FUTURE_SKEW_MS) {
      sendJson(res, 401, { error: 'Stale auth timestamp' });
      return;
    }
    cleanupUsedAuthNonces();
    const authNonceKey = `${pubkey}:${authNonce}`;
    if (usedAuthNonces.has(authNonceKey)) {
      sendJson(res, 409, { error: 'Auth nonce already used' });
      return;
    }
    const payload = buildClaimV2AuthPayload({ challengeId, username, pubkey, nonce, authTs, authNonce });
    if (!verifySignedPayload(payload, authSig, pubkey)) {
      sendJson(res, 401, { error: 'Invalid auth signature' });
      return;
    }
    usedAuthNonces.set(authNonceKey, now + CLAIM_V2_AUTH_NONCE_TTL_MS);
  }

  const challenge = challenges.get(challengeId);
  if (!challenge) {
    sendJson(res, 404, { error: 'Challenge not found' });
    return;
  }
  if (challenge.used) {
    sendJson(res, 409, { error: 'Challenge already used' });
    return;
  }
  if (Date.now() > challenge.expiresAt) {
    challenges.delete(challengeId);
    sendJson(res, 410, { error: 'Challenge expired' });
    return;
  }
  if (challenge.username !== username || challenge.pubkey !== pubkey) {
    sendJson(res, 400, { error: 'Challenge data mismatch' });
    return;
  }

  const powInput = `${challenge.prefix}${nonce}`;
  const powHashHex = hash(powInput);
  if (countLeadingZeroBits(powHashHex) < challenge.difficulty) {
    sendJson(res, 400, { error: 'Invalid PoW solution' });
    return;
  }

  const existing = claims.get(username);
  if (existing && existing.pubkey !== pubkey) {
    sendJson(res, 409, { error: 'Username already claimed by another pubkey' });
    return;
  }

  const issuedAt = Date.now();
  const expiresAt = issuedAt + CERT_TTL_MS;
  const certPayload = JSON.stringify({
    issuerDomain: ISSUER_DOMAIN,
    username,
    userPubkey: pubkey,
    issuedAt,
    expiresAt,
  });
  const signature = signPayload(certPayload, PRIVATE_KEY_HEX);

  challenge.used = true;
  challenges.delete(challengeId);

  claims.set(username, {
    username,
    pubkey,
    issuedAt,
    expiresAt,
    signature,
  });
  await saveState();

  sendJson(res, 200, {
    issuerDomain: ISSUER_DOMAIN,
    username,
    userPubkey: pubkey,
    issuedAt,
    expiresAt,
    signature,
  });
}

async function readJsonBody(req: http.IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += b.length;
    if (total > MAX_BODY_BYTES) {
      throw new Error('Payload too large');
    }
    chunks.push(b);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  return JSON.parse(raw);
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(json),
  });
  res.end(json);
}

function setCorsHeaders(req: http.IncomingMessage, res: http.ServerResponse): void {
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin : '';
  if (origin && ALLOWED_ORIGIN_SET.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  } else if (!origin) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
}

async function loadState(): Promise<void> {
  try {
    const raw = await readFile(STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw) as PersistedState;
    if (!parsed || typeof parsed !== 'object' || !parsed.claims || typeof parsed.claims !== 'object') {
      return;
    }
    for (const [username, claim] of Object.entries(parsed.claims)) {
      if (!isValidUsername(username)) continue;
      if (!claim || typeof claim !== 'object') continue;
      if (!isValidPubkey(claim.pubkey)) continue;
      if (typeof claim.issuedAt !== 'number' || typeof claim.expiresAt !== 'number') continue;
      if (typeof claim.signature !== 'string') continue;
      claims.set(username, claim);
    }
    if (parsed.usedAuthNonces && typeof parsed.usedAuthNonces === 'object') {
      const now = Date.now();
      for (const [key, expiresAt] of Object.entries(parsed.usedAuthNonces)) {
        if (typeof key !== 'string' || typeof expiresAt !== 'number') continue;
        if (!Number.isFinite(expiresAt) || expiresAt <= now) continue;
        usedAuthNonces.set(key, expiresAt);
      }
    }
  } catch {
    // No state file yet is normal.
  }
}

async function saveState(): Promise<void> {
  const dir = dirname(STATE_FILE);
  await mkdir(dir, { recursive: true });
  const tmp = `${STATE_FILE}.tmp`;
  const payload: PersistedState = {
    claims: Object.fromEntries(claims),
    usedAuthNonces: Object.fromEntries(usedAuthNonces),
  };
  await writeFile(tmp, JSON.stringify(payload), 'utf8');
  await rename(tmp, STATE_FILE);
}
