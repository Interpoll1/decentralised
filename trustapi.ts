/**
 * Minimal Trust Issuer API for InterPoll.
 *
 * Endpoints:
 *   POST /challenge { username, pubkey }
 *   POST /claim     { challengeId, nonce, username, pubkey }
 *   POST /session/start   { providerId, providerPubkey, scopes?, authTs, authNonce, authSig, ttlMs? }
 *   GET  /session/me      (Bearer provider-session token)
 *   POST /session/revoke  { sessionId? } (Bearer provider-session token)
 *   GET  /session/actions?limit=50 (Bearer provider-session token)
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

type ProviderSession = {
  sessionId: string;
  providerId: string;
  providerPubkey: string;
  scopes: string[];
  issuedAt: number;
  expiresAt: number;
  revokedAt?: number;
};

type ProviderActionRecord = {
  actionId: string;
  providerId: string;
  sessionId: string | null;
  action: string;
  username: string;
  pubkey: string;
  issuedAt: number;
};

type PersistedState = {
  claims: Record<string, ClaimRecord>;
  usedAuthNonces?: Record<string, number>;
  providerSessions?: Record<string, ProviderSession>;
  providerActions?: ProviderActionRecord[];
  usedSessionAuthNonces?: Record<string, number>;
};

const PORT = Number(process.env.TRUST_PORT || 8787);
const ISSUER_DOMAIN = (process.env.TRUST_ISSUER_DOMAIN || 'endless.sbs').trim().toLowerCase();
const FRONTEND_ORIGIN = (process.env.TRUST_FRONTEND_ORIGIN || 'https://endless.sbs').trim();
const PRIVATE_KEY_HEX = (process.env.TRUST_PRIVATE_KEY_HEX || '').trim();
const DIFFICULTY = clampInt(process.env.TRUST_POW_DIFFICULTY, 22, 18, 30);
const CHALLENGE_TTL_MS = clampInt(process.env.TRUST_CHALLENGE_TTL_MS, 10 * 60_000, 30_000, 60 * 60_000);
const CERT_TTL_MS = clampInt(process.env.TRUST_CERT_TTL_MS, 180 * 24 * 60 * 60 * 1000, 24 * 60 * 60 * 1000, 3_650 * 24 * 60 * 60 * 1000);
const CLAIM_V2_AUTH_PAST_SKEW_MS = clampInt(process.env.TRUST_CLAIM_V2_AUTH_PAST_SKEW_MS, 120_000, 10_000, 10 * 60_000);
const CLAIM_V2_AUTH_FUTURE_SKEW_MS = clampInt(process.env.TRUST_CLAIM_V2_AUTH_FUTURE_SKEW_MS, 30_000, 1_000, 120_000);
const CLAIM_V2_AUTH_NONCE_TTL_MS = clampInt(process.env.TRUST_CLAIM_V2_AUTH_NONCE_TTL_MS, 10 * 60_000, 30_000, 24 * 60 * 60 * 1000);
const SESSION_TTL_MS = clampInt(process.env.TRUST_SESSION_TTL_MS, 24 * 60 * 60 * 1000, 5 * 60_000, 30 * 24 * 60 * 60 * 1000);
const SESSION_AUTH_PAST_SKEW_MS = clampInt(process.env.TRUST_SESSION_AUTH_PAST_SKEW_MS, 120_000, 10_000, 10 * 60_000);
const SESSION_AUTH_FUTURE_SKEW_MS = clampInt(process.env.TRUST_SESSION_AUTH_FUTURE_SKEW_MS, 30_000, 1_000, 120_000);
const SESSION_AUTH_NONCE_TTL_MS = clampInt(process.env.TRUST_SESSION_AUTH_NONCE_TTL_MS, 10 * 60_000, 30_000, 24 * 60 * 60 * 1000);
const PROVIDER_ACTION_LOG_LIMIT = clampInt(process.env.TRUST_PROVIDER_ACTION_LOG_LIMIT, 2_000, 100, 100_000);
const MAX_BODY_BYTES = clampInt(process.env.TRUST_MAX_BODY_BYTES, 32_000, 1_024, 256_000);
const STATE_FILE = resolve(process.env.TRUST_STATE_FILE || './data/trust-issuer-state.json');
const ALLOWED_ORIGIN_SET = new Set(
  [FRONTEND_ORIGIN, 'http://localhost:5173', 'http://127.0.0.1:5173'].filter(Boolean),
);
const SESSION_SCOPE_SET = new Set([
  'claim:create',
  'session:read:self',
  'session:revoke:self',
  'action:read:self',
]);

if (!PRIVATE_KEY_HEX) {
  throw new Error('Missing TRUST_PRIVATE_KEY_HEX env var');
}

const ISSUER_PUBLIC_KEY_HEX = bytesToHex(schnorr.getPublicKey(hexToBytes(PRIVATE_KEY_HEX)));
const challenges = new Map<string, ChallengeRecord>();
const claims = new Map<string, ClaimRecord>();
const usedAuthNonces = new Map<string, number>();
const providerSessions = new Map<string, ProviderSession>();
const providerActions: ProviderActionRecord[] = [];
const usedSessionAuthNonces = new Map<string, number>();

await loadState();
setInterval(cleanupChallenges, 15_000).unref();
setInterval(cleanupUsedAuthNonces, 30_000).unref();
setInterval(cleanupProviderSessions, 30_000).unref();
setInterval(cleanupUsedSessionAuthNonces, 30_000).unref();

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
        activeProviderSessions: Array.from(providerSessions.values()).filter((session) => !session.revokedAt && session.expiresAt > Date.now()).length,
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
      return handleClaimRequest(req, res, body, false);
    }

    if (req.method === 'POST' && url.pathname === '/claim-v2') {
      const body = await readJsonBody(req);
      return handleClaimRequest(req, res, body, true);
    }

    if (req.method === 'POST' && url.pathname === '/session/start') {
      const body = await readJsonBody(req);
      return handleSessionStartRequest(res, body);
    }

    if (req.method === 'GET' && url.pathname === '/session/me') {
      return handleSessionMeRequest(req, res);
    }

    if (req.method === 'POST' && url.pathname === '/session/revoke') {
      const body = await readJsonBody(req);
      return handleSessionRevokeRequest(req, res, body);
    }

    if (req.method === 'GET' && url.pathname === '/session/actions') {
      return handleSessionActionsRequest(req, res, url);
    }

    return sendJson(res, 404, { error: 'Not found' });
  } catch (err) {
    console.error('[trustapi] request error:', err);
    return sendJson(res, 500, { error: 'Internal server error' });
  }
});

server.listen(PORT, () => {
  console.log(`[trustapi] listening on :${PORT}`);
  console.log(`[trustapi] issuer domain: ${ISSUER_DOMAIN}`);
  console.log(`[trustapi] issuer pubkey: ${ISSUER_PUBLIC_KEY_HEX}`);
  console.log(`[trustapi] state file: ${STATE_FILE}`);
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

function cleanupProviderSessions(): void {
  const now = Date.now();
  for (const [sessionId, session] of providerSessions) {
    if (session.expiresAt <= now) providerSessions.delete(sessionId);
  }
}

function cleanupUsedSessionAuthNonces(): void {
  const now = Date.now();
  for (const [key, expiresAt] of usedSessionAuthNonces) {
    if (expiresAt <= now) usedSessionAuthNonces.delete(key);
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

function buildProviderSessionAuthPayload(input: {
  providerId: string;
  providerPubkey: string;
  requestedScopes: string[];
  authTs: number;
  authNonce: string;
}): string {
  const { providerId, providerPubkey, requestedScopes, authTs, authNonce } = input;
  return JSON.stringify({
    purpose: 'interpoll-provider-session-v1',
    issuerDomain: ISSUER_DOMAIN,
    providerId,
    providerPubkey,
    requestedScopes: [...requestedScopes].sort(),
    authTs,
    authNonce,
  });
}

function normalizeProviderId(input: unknown): string {
  return typeof input === 'string' ? input.trim() : '';
}

function isValidProviderId(providerId: string): boolean {
  return /^[A-Za-z0-9_.:@-]{3,128}$/.test(providerId);
}

function parseRequestedScopes(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return ['claim:create', 'session:read:self', 'session:revoke:self', 'action:read:self'];
  }
  const normalized = Array.from(new Set(
    input
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.trim())
      .filter((value) => value.length > 0),
  ));
  if (normalized.length === 0) {
    return ['claim:create', 'session:read:self', 'session:revoke:self', 'action:read:self'];
  }
  return normalized;
}

function encodeBase64Url(data: string): string {
  return Buffer.from(data, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function decodeBase64Url(data: string): string {
  const padded = data + '==='.slice((data.length + 3) % 4);
  const base64 = padded.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(base64, 'base64').toString('utf8');
}

function issueSessionToken(session: ProviderSession): string {
  const payload = JSON.stringify({
    v: 1,
    sessionId: session.sessionId,
    providerId: session.providerId,
    providerPubkey: session.providerPubkey,
    scopes: session.scopes,
    issuedAt: session.issuedAt,
    expiresAt: session.expiresAt,
  });
  const signature = signPayload(payload, PRIVATE_KEY_HEX);
  return `${encodeBase64Url(payload)}.${signature}`;
}

function parseSessionToken(token: string): ProviderSession | null {
  const [payloadPart, signaturePart] = token.split('.');
  if (!payloadPart || !signaturePart || !/^[0-9a-f]{128}$/.test(signaturePart)) return null;
  let payloadJson = '';
  try {
    payloadJson = decodeBase64Url(payloadPart);
  } catch {
    return null;
  }
  if (!verifySignedPayload(payloadJson, signaturePart, ISSUER_PUBLIC_KEY_HEX)) return null;
  let parsed: any;
  try {
    parsed = JSON.parse(payloadJson);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const sessionId = typeof parsed.sessionId === 'string' ? parsed.sessionId : '';
  const providerId = typeof parsed.providerId === 'string' ? parsed.providerId : '';
  const providerPubkey = typeof parsed.providerPubkey === 'string' ? parsed.providerPubkey : '';
  const issuedAt = Number(parsed.issuedAt);
  const expiresAt = Number(parsed.expiresAt);
  const scopes = Array.isArray(parsed.scopes) ? parsed.scopes.filter((scope: unknown): scope is string => typeof scope === 'string') : [];
  if (!sessionId || !isValidProviderId(providerId) || !isValidPubkey(providerPubkey)) return null;
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || expiresAt <= issuedAt) return null;
  if (Date.now() > expiresAt) return null;
  return {
    sessionId,
    providerId,
    providerPubkey,
    scopes,
    issuedAt,
    expiresAt,
  };
}

function readBearerToken(req: http.IncomingMessage): string {
  const authHeader = typeof req.headers.authorization === 'string' ? req.headers.authorization.trim() : '';
  const bearerPrefix = 'Bearer ';
  if (!authHeader.startsWith(bearerPrefix)) return '';
  return authHeader.slice(bearerPrefix.length).trim();
}

function authorizeProviderSession(req: http.IncomingMessage, requiredScopes: string[]): ProviderSession | null {
  const token = readBearerToken(req);
  if (!token) return null;
  const tokenSession = parseSessionToken(token);
  if (!tokenSession) return null;
  cleanupProviderSessions();
  const stored = providerSessions.get(tokenSession.sessionId);
  if (!stored || stored.revokedAt || stored.expiresAt <= Date.now()) return null;
  if (stored.providerId !== tokenSession.providerId || stored.providerPubkey !== tokenSession.providerPubkey) return null;
  for (const scope of requiredScopes) {
    if (!stored.scopes.includes(scope)) return null;
  }
  return stored;
}

function logProviderAction(session: ProviderSession | null, action: string, username: string, pubkey: string): void {
  const record: ProviderActionRecord = {
    actionId: randomUUID(),
    providerId: session?.providerId || 'legacy',
    sessionId: session?.sessionId || null,
    action,
    username,
    pubkey,
    issuedAt: Date.now(),
  };
  providerActions.push(record);
  if (providerActions.length > PROVIDER_ACTION_LOG_LIMIT) {
    providerActions.splice(0, providerActions.length - PROVIDER_ACTION_LOG_LIMIT);
  }
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

async function handleClaimRequest(req: http.IncomingMessage, res: http.ServerResponse, body: any, requireV2Auth: boolean): Promise<void> {
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
  const providerSession = requireV2Auth ? authorizeProviderSession(req, ['claim:create']) : null;
  if (requireV2Auth) {
    const bearer = readBearerToken(req);
    if (bearer && !providerSession) {
      sendJson(res, 403, { error: 'Invalid or unauthorized provider session' });
      return;
    }
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
  logProviderAction(providerSession, requireV2Auth ? 'claim-v2' : 'claim-v1', username, pubkey);

  sendJson(res, 200, {
    issuerDomain: ISSUER_DOMAIN,
    username,
    userPubkey: pubkey,
    issuedAt,
    expiresAt,
    signature,
  });
}

function handleSessionStartRequest(res: http.ServerResponse, body: any): void {
  const providerId = normalizeProviderId(body?.providerId);
  const providerPubkey = normalizeHex(body?.providerPubkey);
  const requestedScopes = parseRequestedScopes(body?.scopes);
  const authSig = typeof body?.authSig === 'string' ? body.authSig.trim().toLowerCase() : '';
  const authNonce = typeof body?.authNonce === 'string' ? body.authNonce.trim() : '';
  const authTs = Number(body?.authTs);
  const requestedTtlMs = clampInt(
    Number.isFinite(Number(body?.ttlMs)) ? String(Math.trunc(Number(body?.ttlMs))) : undefined,
    SESSION_TTL_MS,
    5 * 60_000,
    30 * 24 * 60 * 60 * 1000,
  );

  if (!isValidProviderId(providerId)) {
    sendJson(res, 400, { error: 'Invalid providerId' });
    return;
  }
  if (!isValidPubkey(providerPubkey)) {
    sendJson(res, 400, { error: 'Invalid providerPubkey' });
    return;
  }
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
  for (const scope of requestedScopes) {
    if (!SESSION_SCOPE_SET.has(scope)) {
      sendJson(res, 400, { error: `Unsupported scope: ${scope}` });
      return;
    }
  }

  const now = Date.now();
  if (authTs < now - SESSION_AUTH_PAST_SKEW_MS || authTs > now + SESSION_AUTH_FUTURE_SKEW_MS) {
    sendJson(res, 401, { error: 'Stale auth timestamp' });
    return;
  }

  cleanupUsedSessionAuthNonces();
  const authNonceKey = `${providerPubkey}:${authNonce}`;
  if (usedSessionAuthNonces.has(authNonceKey)) {
    sendJson(res, 409, { error: 'Auth nonce already used' });
    return;
  }
  const payload = buildProviderSessionAuthPayload({
    providerId,
    providerPubkey,
    requestedScopes,
    authTs,
    authNonce,
  });
  if (!verifySignedPayload(payload, authSig, providerPubkey)) {
    sendJson(res, 401, { error: 'Invalid auth signature' });
    return;
  }

  const issuedAt = now;
  const expiresAt = issuedAt + Math.min(requestedTtlMs, SESSION_TTL_MS);
  const session: ProviderSession = {
    sessionId: randomUUID(),
    providerId,
    providerPubkey,
    scopes: requestedScopes,
    issuedAt,
    expiresAt,
  };
  usedSessionAuthNonces.set(authNonceKey, now + SESSION_AUTH_NONCE_TTL_MS);
  providerSessions.set(session.sessionId, session);
  void saveState();

  sendJson(res, 200, {
    sessionId: session.sessionId,
    providerId: session.providerId,
    scopes: session.scopes,
    issuedAt: session.issuedAt,
    expiresAt: session.expiresAt,
    token: issueSessionToken(session),
  });
}

function handleSessionMeRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
  const session = authorizeProviderSession(req, ['session:read:self']);
  if (!session) {
    sendJson(res, 401, { error: 'Invalid or expired provider session' });
    return;
  }
  sendJson(res, 200, {
    sessionId: session.sessionId,
    providerId: session.providerId,
    scopes: session.scopes,
    issuedAt: session.issuedAt,
    expiresAt: session.expiresAt,
    revokedAt: session.revokedAt || null,
  });
}

async function handleSessionRevokeRequest(req: http.IncomingMessage, res: http.ServerResponse, body: any): Promise<void> {
  const session = authorizeProviderSession(req, ['session:revoke:self']);
  if (!session) {
    sendJson(res, 401, { error: 'Invalid or expired provider session' });
    return;
  }
  const requestedSessionId = typeof body?.sessionId === 'string' && body.sessionId.trim()
    ? body.sessionId.trim()
    : session.sessionId;
  const target = providerSessions.get(requestedSessionId);
  if (!target || target.providerId !== session.providerId) {
    sendJson(res, 404, { error: 'Session not found' });
    return;
  }
  if (target.revokedAt) {
    sendJson(res, 200, { ok: true, sessionId: target.sessionId, revokedAt: target.revokedAt });
    return;
  }
  target.revokedAt = Date.now();
  providerSessions.set(target.sessionId, target);
  await saveState();
  sendJson(res, 200, { ok: true, sessionId: target.sessionId, revokedAt: target.revokedAt });
}

function handleSessionActionsRequest(req: http.IncomingMessage, res: http.ServerResponse, url: URL): void {
  const session = authorizeProviderSession(req, ['action:read:self']);
  if (!session) {
    sendJson(res, 401, { error: 'Invalid or expired provider session' });
    return;
  }
  const rawLimit = Number(url.searchParams.get('limit') || 50);
  const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(500, Math.trunc(rawLimit))) : 50;
  const actions = providerActions
    .filter((record) => record.providerId === session.providerId)
    .slice(-limit)
    .reverse();
  sendJson(res, 200, {
    providerId: session.providerId,
    count: actions.length,
    actions,
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
    if (parsed.providerSessions && typeof parsed.providerSessions === 'object') {
      const now = Date.now();
      for (const [sessionId, session] of Object.entries(parsed.providerSessions)) {
        if (!session || typeof session !== 'object') continue;
        if (typeof session.sessionId !== 'string' || session.sessionId !== sessionId) continue;
        if (!isValidProviderId(session.providerId)) continue;
        if (!isValidPubkey(session.providerPubkey)) continue;
        if (!Array.isArray(session.scopes) || session.scopes.some((scope) => !SESSION_SCOPE_SET.has(scope))) continue;
        if (typeof session.issuedAt !== 'number' || typeof session.expiresAt !== 'number') continue;
        if (session.expiresAt <= now) continue;
        providerSessions.set(sessionId, session);
      }
    }
    if (Array.isArray(parsed.providerActions)) {
      for (const action of parsed.providerActions) {
        if (!action || typeof action !== 'object') continue;
        if (typeof action.actionId !== 'string' || typeof action.providerId !== 'string') continue;
        if (typeof action.action !== 'string' || typeof action.username !== 'string') continue;
        if (!isValidPubkey(action.pubkey) || typeof action.issuedAt !== 'number') continue;
        providerActions.push(action);
      }
      if (providerActions.length > PROVIDER_ACTION_LOG_LIMIT) {
        providerActions.splice(0, providerActions.length - PROVIDER_ACTION_LOG_LIMIT);
      }
    }
    if (parsed.usedSessionAuthNonces && typeof parsed.usedSessionAuthNonces === 'object') {
      const now = Date.now();
      for (const [key, expiresAt] of Object.entries(parsed.usedSessionAuthNonces)) {
        if (typeof key !== 'string' || typeof expiresAt !== 'number') continue;
        if (!Number.isFinite(expiresAt) || expiresAt <= now) continue;
        usedSessionAuthNonces.set(key, expiresAt);
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
    providerSessions: Object.fromEntries(providerSessions),
    providerActions,
    usedSessionAuthNonces: Object.fromEntries(usedSessionAuthNonces),
  };
  await writeFile(tmp, JSON.stringify(payload), 'utf8');
  await rename(tmp, STATE_FILE);
}
