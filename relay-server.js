// relay-server.js
// Simple WebSocket relay for cross-device/cross-browser P2P sync
// Install: npm install ws
// Run: node relay-server.js

import { WebSocketServer } from 'ws';
import http from 'http';
import https from 'https';
import fs from 'fs';
import crypto from 'crypto';
import path from 'path';
import { URL, fileURLToPath } from 'url';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { schnorr } from '@noble/curves/secp256k1.js';
import { RateLimiter } from './rate-limiter.js';
import { BotDetector } from './bot-detector.js';
import { SpamScorer } from './spam-scorer.js';
import { PowChallenge } from './pow-challenge.js';
import {
  sanitizeId, sanitizeLogString, sanitizeString,
  parseBodyWithLimit, setCorsHeaders, setSecurityHeaders, isOriginAllowed,
  sendError, ALLOWED_ORIGINS,
} from './security-utils.js';
import { validateWsMessage } from './ws-validators.js';

const PORT = 8080;
const server = http.createServer();
const WS_MAX_PAYLOAD = 262144; // 256KB
const wss = new WebSocketServer({ server, maxPayload: WS_MAX_PAYLOAD });

const clients = new Map(); // peerId -> WebSocket
const rooms = new Map();   // roomId -> Set of peerIds

// Anti-spam modules
const rateLimiter = new RateLimiter();
const botDetector = new BotDetector();
const spamScorer = new SpamScorer();
const powChallenge = new PowChallenge();

const voteRegistry = new Set();
const pendingVoteReservations = new Map();
const PENDING_VOTE_TTL_MS = 60_000;
const CURRENT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(CURRENT_DIR, 'relay-server', 'data');
const VOTE_REGISTRY_FILE = path.join(DATA_DIR, 'vote-registry.json');
const VOTE_REGISTRY_BACKUP_FILE = path.join(DATA_DIR, 'vote-registry.backup.json');
const VOTE_REGISTRY_TMP_FILE = path.join(DATA_DIR, 'vote-registry.tmp.json');
const COMMUNITY_SECURITY_FILE = path.join(DATA_DIR, 'community-security.json');
const COMMUNITY_SECURITY_BACKUP_FILE = path.join(DATA_DIR, 'community-security.backup.json');
const COMMUNITY_SECURITY_TMP_FILE = path.join(DATA_DIR, 'community-security.tmp.json');
const MAX_COMMUNITY_SECURITY_COMMUNITIES = 5000;
const MAX_REQUESTS_PER_COMMUNITY = 200;
const MAX_KEYRING_ENTRIES_PER_COMMUNITY = 1000;
const REQUEST_TTL_MS = 14 * 24 * 60 * 60 * 1000;
let voteRegistryOperational = true;
let communitySecurityOperational = true;
let communitySecurityState = { communities: Object.create(null) };

try {
  fs.mkdirSync(DATA_DIR, { recursive: true });
} catch (error) {
  console.error('Failed to initialize vote registry data directory:', error.message);
  voteRegistryOperational = false;
  communitySecurityOperational = false;
}

function loadCommunitySecurityStateFromFile(filePath) {
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('community security data is not an object');
  }
  const communities = raw.communities;
  if (!communities || typeof communities !== 'object' || Array.isArray(communities)) {
    throw new Error('community security communities field is invalid');
  }
  const safeCommunities = Object.create(null);
  for (const [communityId, bucket] of Object.entries(communities)) {
    if (isUnsafeMapKey(communityId)) continue;
    safeCommunities[communityId] = normalizeCommunityBucket(bucket);
  }
  communitySecurityState = { communities: safeCommunities };
}

function loadVoteRegistryFromFile(filePath) {
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!Array.isArray(raw)) {
    throw new Error('vote registry is not an array');
  }
  voteRegistry.clear();
  for (const key of raw) {
    if (typeof key === 'string' && key.length > 0) voteRegistry.add(key);
  }
}

try {
  if (fs.existsSync(VOTE_REGISTRY_FILE)) {
    loadVoteRegistryFromFile(VOTE_REGISTRY_FILE);
    console.log(`Loaded ${voteRegistry.size} vote records from disk`);
  } else if (fs.existsSync(VOTE_REGISTRY_BACKUP_FILE)) {
    loadVoteRegistryFromFile(VOTE_REGISTRY_BACKUP_FILE);
    console.log(`Recovered ${voteRegistry.size} vote records from backup`);
  }
} catch (error) {
  console.error('Failed to load primary vote registry, trying backup:', error.message);
  try {
    if (fs.existsSync(VOTE_REGISTRY_BACKUP_FILE)) {
      loadVoteRegistryFromFile(VOTE_REGISTRY_BACKUP_FILE);
      console.log(`Recovered ${voteRegistry.size} vote records from backup`);
    } else {
      voteRegistryOperational = false;
    }
  } catch (backupError) {
    console.error('Failed to load backup vote registry:', backupError.message);
    voteRegistryOperational = false;
  }
}

try {
  if (fs.existsSync(COMMUNITY_SECURITY_FILE)) {
    loadCommunitySecurityStateFromFile(COMMUNITY_SECURITY_FILE);
    console.log(`Loaded ${Object.keys(communitySecurityState.communities).length} community security records from disk`);
  } else if (fs.existsSync(COMMUNITY_SECURITY_BACKUP_FILE)) {
    loadCommunitySecurityStateFromFile(COMMUNITY_SECURITY_BACKUP_FILE);
    console.log(`Recovered ${Object.keys(communitySecurityState.communities).length} community security records from backup`);
  }
} catch (error) {
  console.error('Failed to load primary community security data, trying backup:', error.message);
  try {
    if (fs.existsSync(COMMUNITY_SECURITY_BACKUP_FILE)) {
      loadCommunitySecurityStateFromFile(COMMUNITY_SECURITY_BACKUP_FILE);
      console.log(`Recovered ${Object.keys(communitySecurityState.communities).length} community security records from backup`);
    } else {
      communitySecurityOperational = false;
    }
  } catch (backupError) {
    console.error('Failed to load backup community security data:', backupError.message);
    communitySecurityOperational = false;
  }
}

function saveVoteRegistry() {
  const payload = JSON.stringify([...voteRegistry]);
  fs.writeFileSync(VOTE_REGISTRY_TMP_FILE, payload);
  fs.renameSync(VOTE_REGISTRY_TMP_FILE, VOTE_REGISTRY_FILE);
  fs.writeFileSync(VOTE_REGISTRY_BACKUP_FILE, payload);
  voteRegistryOperational = true;
}

function saveCommunitySecurityState() {
  const payload = JSON.stringify(communitySecurityState);
  fs.writeFileSync(COMMUNITY_SECURITY_TMP_FILE, payload);
  fs.renameSync(COMMUNITY_SECURITY_TMP_FILE, COMMUNITY_SECURITY_FILE);
  fs.writeFileSync(COMMUNITY_SECURITY_BACKUP_FILE, payload);
  communitySecurityOperational = true;
}

function createSafeMap() {
  return Object.create(null);
}

function isUnsafeMapKey(value) {
  return value === '__proto__' || value === 'prototype' || value === 'constructor';
}

function parseCommunityId(raw) {
  const value = sanitizeId(String(raw || ''), 128);
  if (!value || isUnsafeMapKey(value)) return null;
  return value;
}

function parseDevicePublicKey(raw) {
  const value = sanitizeString(String(raw || ''), 2048).trim();
  if (isUnsafeMapKey(value)) return null;
  return value.length > 0 ? value : null;
}

function parseDeviceEncryptionPublicKey(raw) {
  const value = sanitizeString(String(raw || ''), 4096).trim();
  return value.length > 0 ? value : null;
}

function parseSignature(raw) {
  const value = sanitizeString(String(raw || ''), 4096).trim();
  return value.length > 0 ? value : null;
}

function parseEncryptedCommunityKey(raw) {
  const value = sanitizeString(String(raw || ''), 12288).trim();
  return value.length > 0 ? value : null;
}

function parseMethod(raw) {
  return raw === 'invite' || raw === 'password' ? raw : null;
}

function parseTimestamp(raw) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return Date.now();
  return Math.floor(value);
}

function parseKeyVersion(raw) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 1) return 1;
  return Math.floor(value);
}

function parseExistingKeyVersion(raw) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 1) return 0;
  return Math.floor(value);
}

function hashString(input) {
  return bytesToHex(sha256(new TextEncoder().encode(input)));
}

function verifySchnorrSignature(data, signatureHex, publicKeyHex) {
  try {
    const messageHash = hashString(data);
    return schnorr.verify(hexToBytes(signatureHex), hexToBytes(messageHash), hexToBytes(publicKeyHex));
  } catch {
    return false;
  }
}

function verifyFrontendCryptoServiceSignature(data, signatureHex, publicKeyHex) {
  return verifySchnorrSignature(hashString(data), signatureHex, publicKeyHex);
}

function computeSessionOwnerKey(user) {
  if (!user || typeof user !== 'object') return null;
  const provider = sanitizeString(String(user.provider || ''), 64);
  const subject = sanitizeString(String(user.sub || ''), 256);
  if (!provider || !subject) return null;
  return hashString(`${provider}:${subject}`);
}

function normalizeCommunityBucket(rawBucket) {
  const bucket = {
    requests: createSafeMap(),
    keyRing: createSafeMap(),
    rotations: [],
    revokedDevices: createSafeMap(),
    currentKeyVersion: 1,
    ownerSessionKey: null,
    updatedAt: Date.now(),
  };
  if (!rawBucket || typeof rawBucket !== 'object' || Array.isArray(rawBucket)) return bucket;
  const requests = rawBucket.requests;
  if (requests && typeof requests === 'object' && !Array.isArray(requests)) {
    for (const [devicePublicKey, request] of Object.entries(requests)) {
      if (isUnsafeMapKey(devicePublicKey) || !request || typeof request !== 'object') continue;
      bucket.requests[devicePublicKey] = request;
    }
  }
  const keyRing = rawBucket.keyRing;
  if (keyRing && typeof keyRing === 'object' && !Array.isArray(keyRing)) {
    for (const [devicePublicKey, entry] of Object.entries(keyRing)) {
      if (isUnsafeMapKey(devicePublicKey) || !entry || typeof entry !== 'object') continue;
      bucket.keyRing[devicePublicKey] = entry;
    }
  }
  if (Array.isArray(rawBucket.rotations)) {
    bucket.rotations = rawBucket.rotations.slice(-200);
  }
  if (rawBucket.revokedDevices && typeof rawBucket.revokedDevices === 'object' && !Array.isArray(rawBucket.revokedDevices)) {
    for (const [devicePublicKey, version] of Object.entries(rawBucket.revokedDevices)) {
      if (isUnsafeMapKey(devicePublicKey)) continue;
      bucket.revokedDevices[devicePublicKey] = parseKeyVersion(version);
    }
  }
  bucket.currentKeyVersion = parseKeyVersion(rawBucket.currentKeyVersion);
  bucket.ownerSessionKey = typeof rawBucket.ownerSessionKey === 'string' ? rawBucket.ownerSessionKey : null;
  bucket.updatedAt = parseTimestamp(rawBucket.updatedAt);
  pruneStaleCommunityRequests(bucket);
  return bucket;
}

function pruneStaleCommunityRequests(bucket, now = Date.now()) {
  for (const [devicePublicKey, request] of Object.entries(bucket.requests)) {
    if (!request || typeof request !== 'object') {
      delete bucket.requests[devicePublicKey];
      continue;
    }
    const requestedAt = Number(request.requestedAt);
    if (!Number.isFinite(requestedAt) || (now - requestedAt) > REQUEST_TTL_MS) {
      delete bucket.requests[devicePublicKey];
    }
  }
}

function getCommunitySecurityBucket(communityId) {
  const existingIds = Object.keys(communitySecurityState.communities);
  if (!communitySecurityState.communities[communityId] && existingIds.length >= MAX_COMMUNITY_SECURITY_COMMUNITIES) {
    return null;
  }
  const existing = communitySecurityState.communities[communityId];
  if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
    if (!existing.requests || typeof existing.requests !== 'object' || Array.isArray(existing.requests)) {
      existing.requests = createSafeMap();
    }
    if (!existing.keyRing || typeof existing.keyRing !== 'object' || Array.isArray(existing.keyRing)) {
      existing.keyRing = createSafeMap();
    }
    if (!Array.isArray(existing.rotations)) existing.rotations = [];
    if (!existing.revokedDevices || typeof existing.revokedDevices !== 'object' || Array.isArray(existing.revokedDevices)) {
      existing.revokedDevices = createSafeMap();
    }
    existing.currentKeyVersion = parseKeyVersion(existing.currentKeyVersion);
    pruneStaleCommunityRequests(existing);
    return existing;
  }
  const created = {
    requests: createSafeMap(),
    keyRing: createSafeMap(),
    rotations: [],
    revokedDevices: createSafeMap(),
    currentKeyVersion: 1,
    ownerSessionKey: null,
    updatedAt: Date.now(),
  };
  communitySecurityState.communities[communityId] = created;
  return created;
}

function getCommunitySecurityBucketForRead(communityId) {
  const existing = communitySecurityState.communities[communityId];
  if (!existing || typeof existing !== 'object' || Array.isArray(existing)) return null;
  if (!existing.requests || typeof existing.requests !== 'object' || Array.isArray(existing.requests)) {
    existing.requests = createSafeMap();
  }
  if (!existing.keyRing || typeof existing.keyRing !== 'object' || Array.isArray(existing.keyRing)) {
    existing.keyRing = createSafeMap();
  }
  if (!Array.isArray(existing.rotations)) existing.rotations = [];
  if (!existing.revokedDevices || typeof existing.revokedDevices !== 'object' || Array.isArray(existing.revokedDevices)) {
    existing.revokedDevices = createSafeMap();
  }
  existing.currentKeyVersion = parseKeyVersion(existing.currentKeyVersion);
  pruneStaleCommunityRequests(existing);
  return existing;
}

function requireDeviceReadAuthorization(url, communityId, bucket, resource) {
  const requesterDevicePublicKey = parseDevicePublicKey(url.searchParams.get('requesterDevicePublicKey'));
  const signature = parseSignature(url.searchParams.get('signature'));
  const timestamp = parseTimestamp(url.searchParams.get('timestamp'));
  if (!requesterDevicePublicKey || !signature) {
    return { ok: false, reason: 'missing requester device authorization' };
  }
  const trustedEntry = bucket.keyRing[requesterDevicePublicKey];
  if (!trustedEntry) {
    return { ok: false, reason: 'requester device is not approved for this community' };
  }
  const authPayload = JSON.stringify({
    communityId,
    requesterDevicePublicKey,
    resource,
    timestamp,
  });
  if (!verifyFrontendCryptoServiceSignature(authPayload, signature, requesterDevicePublicKey)) {
    return { ok: false, reason: 'invalid requester signature' };
  }
  if (Math.abs(Date.now() - timestamp) > 5 * 60 * 1000) {
    return { ok: false, reason: 'request timestamp out of range' };
  }
  return { ok: true };
}

function cleanupPendingVoteReservations(now = Date.now()) {
  for (const [key, reservation] of pendingVoteReservations) {
    if (reservation.expiresAt <= now) pendingVoteReservations.delete(key);
  }
}

setInterval(() => cleanupPendingVoteReservations(), 30_000);

function hasPendingVoteReservation(key, now = Date.now()) {
  const reservation = pendingVoteReservations.get(key);
  if (!reservation) return false;
  if (reservation.expiresAt <= now) {
    pendingVoteReservations.delete(key);
    return false;
  }
  return true;
}

function buildReservationOwner(req) {
  const ip = req.socket.remoteAddress || 'unknown';
  const userAgent = String(req.headers['user-agent'] || '');
  return crypto.createHash('sha256').update(`${ip}|${userAgent}`).digest('hex');
}

const RESERVATION_SECRET = process.env.VOTE_RESERVATION_SECRET || generateRandomId(32);

function signReservationToken(key, ownerId, reservationId, expiresAt) {
  return crypto
    .createHmac('sha256', RESERVATION_SECRET)
    .update(`${key}:${ownerId}:${reservationId}:${expiresAt}`)
    .digest('base64url');
}

function issueReservationToken(key, ownerId, reservationId, expiresAt) {
  const signature = signReservationToken(key, ownerId, reservationId, expiresAt);
  return `${reservationId}.${expiresAt}.${signature}`;
}

function parseReservationToken(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [reservationId, expiresAtRaw, signature] = parts;
  const expiresAt = Number.parseInt(expiresAtRaw, 10);
  if (!reservationId || !Number.isFinite(expiresAt) || !signature) return null;
  return { reservationId, expiresAt, signature };
}

function isValidReservationToken(token, key, ownerId, now = Date.now()) {
  const parsed = parseReservationToken(token);
  if (!parsed) return { valid: false, reason: 'invalid reservation token', parsed: null };
  if (parsed.expiresAt <= now) return { valid: false, reason: 'vote authorization expired', parsed };
  const expectedSignature = signReservationToken(key, ownerId, parsed.reservationId, parsed.expiresAt);
  if (expectedSignature.length !== parsed.signature.length) {
    return { valid: false, reason: 'invalid reservation token', parsed };
  }
  const expectedBuffer = Buffer.from(expectedSignature);
  const signatureBuffer = Buffer.from(parsed.signature);
  if (!crypto.timingSafeEqual(expectedBuffer, signatureBuffer)) {
    return { valid: false, reason: 'invalid reservation token', parsed };
  }
  return { valid: true, reason: null, parsed };
}

function reserveVoteSlot(key, ownerId, now = Date.now()) {
  if (!voteRegistryOperational) {
    return { ok: false, reason: 'vote registry unavailable' };
  }
  cleanupPendingVoteReservations(now);
  if (voteRegistry.has(key) || hasPendingVoteReservation(key, now)) {
    return { ok: false, reason: 'already voted or vote pending' };
  }
  const expiresAt = now + PENDING_VOTE_TTL_MS;
  const reservationId = generateRandomId(12);
  pendingVoteReservations.set(key, { expiresAt, reservationId, ownerId });
  return { ok: true, reservationToken: issueReservationToken(key, ownerId, reservationId, expiresAt) };
}

function commitVoteSlot(key, ownerId, reservationToken, now = Date.now()) {
  if (!voteRegistryOperational) {
    return { ok: false, reason: 'vote registry unavailable' };
  }
  cleanupPendingVoteReservations(now);
  const tokenValidation = isValidReservationToken(reservationToken, key, ownerId, now);
  if (!tokenValidation.valid) {
    return { ok: false, reason: tokenValidation.reason };
  }
  const pending = pendingVoteReservations.get(key);
  if (!pending || pending.expiresAt <= now) {
    pendingVoteReservations.delete(key);
    return { ok: false, reason: 'vote not authorized or authorization expired' };
  }
  if (pending.ownerId !== ownerId || pending.reservationId !== tokenValidation.parsed.reservationId) {
    return { ok: false, reason: 'vote not authorized for this session' };
  }
  if (voteRegistry.has(key)) {
    pendingVoteReservations.delete(key);
    return { ok: true, alreadyRecorded: true };
  }
  pendingVoteReservations.delete(key);
  voteRegistry.add(key);
  try {
    saveVoteRegistry();
  } catch (error) {
    voteRegistry.delete(key);
    voteRegistryOperational = false;
    return { ok: false, reason: 'vote registry persistence failed' };
  }
  return { ok: true, alreadyRecorded: false };
}

// Simple append-only log for receipts and audit events
const RECEIPT_LOG_FILE = new URL('./storage.txt', import.meta.url).pathname;

// ─── Message cache for seeding new clients ──────────────────────────────────
// Stores recent broadcast messages so new clients don't see an empty site
// while waiting for GUN to sync.
const MESSAGE_CACHE_FILE = new URL('./message-cache.json', import.meta.url).pathname;

const MAX_CACHED_MESSAGES = 500;
let messageCache = [];
try {
  if (fs.existsSync(MESSAGE_CACHE_FILE)) {
    const raw = JSON.parse(fs.readFileSync(MESSAGE_CACHE_FILE, 'utf8'));
    // Filter out any previously flagged spam so it isn't replayed on restart
    messageCache = raw.filter(m => !m._flagged && !m.data?._flagged);
    console.log(`Loaded ${messageCache.length} cached messages from disk`);
  }
} catch { messageCache = []; }

function cacheMessage(msg) {
  if (!msg || !msg.type) return;
  // Don't cache spam-flagged content — it would be replayed to every new client
  if (msg._flagged || msg.data?._flagged) return;
  // Only cache content-bearing messages
  const cacheable = ['new-poll', 'new-block', 'sync-response', 'new-event'];
  const type = msg.type || msg.data?.type;
  if (!cacheable.includes(type)) return;
  messageCache.push({ ...msg, _cachedAt: Date.now() });
  // Cap size
  while (messageCache.length > MAX_CACHED_MESSAGES) messageCache.shift();
}

function saveMessageCache() {
  try {
    fs.writeFileSync(MESSAGE_CACHE_FILE, JSON.stringify(messageCache));
  } catch (err) {
    console.error('Failed to save message cache:', err.message);
  }
}

// Persist cache every 30 seconds
setInterval(saveMessageCache, 30000);

// Minimal in-memory OAuth state & session stores
const OAUTH_STATE_TTL_MS = 10 * 60_000; // 10 minutes
const oauthStates = new Map(); // state -> { provider, createdAt }
const SESSION_TTL_MS = 24 * 60 * 60_000; // 24 hours
const sessions = new Map(); // sessionId -> { user, expiresAt }

// Cleanup expired OAuth states every 2 minutes
setInterval(() => {
  const now = Date.now();
  for (const [state, entry] of oauthStates) {
    if (now - entry.createdAt > OAUTH_STATE_TTL_MS) oauthStates.delete(state);
  }
}, 2 * 60_000);

setInterval(() => {
  const now = Date.now();
  for (const [sessionId, entry] of sessions) {
    if (entry.expiresAt <= now) sessions.delete(sessionId);
  }
}, 5 * 60_000);

const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:5173';
const OAUTH_STATE_COOKIE = 'interpoll_oauth_state';
const isProduction = process.env.NODE_ENV === 'production';

if (isProduction) {
  if (!process.env.SERVER_ORIGIN) {
    throw new Error('SERVER_ORIGIN must be set in production');
  }
  const parsedOrigin = new URL(process.env.SERVER_ORIGIN);
  if (parsedOrigin.protocol !== 'https:') {
    throw new Error('SERVER_ORIGIN must use https in production');
  }
}

console.log('Google OAuth config:', {
  clientIdConfigured: !!process.env.GOOGLE_CLIENT_ID,
  clientIdPreview: process.env.GOOGLE_CLIENT_ID ? String(process.env.GOOGLE_CLIENT_ID).slice(0, 12) + '...' : null,
  clientSecretConfigured: !!process.env.GOOGLE_CLIENT_SECRET,
});

function generateRandomId(bytes = 16) {
  return crypto.randomBytes(bytes).toString('hex');
}

function getServerOrigin() {
  const raw = process.env.SERVER_ORIGIN || `http://localhost:${PORT}`;
  return raw.endsWith('/') ? raw.slice(0, -1) : raw;
}

function appendSetCookie(res, cookie) {
  const existing = res.getHeader('Set-Cookie');
  if (!existing) {
    res.setHeader('Set-Cookie', [cookie]);
    return;
  }
  if (Array.isArray(existing)) {
    res.setHeader('Set-Cookie', [...existing, cookie]);
    return;
  }
  res.setHeader('Set-Cookie', [existing, cookie]);
}

function getCookie(req, name) {
  const cookieHeader = req.headers['cookie'];
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(';').map((c) => c.trim());
  const part = parts.find((p) => p.startsWith(`${name}=`));
  return part ? part.slice(name.length + 1) : null;
}

function setOauthStateCookie(res, nonce) {
  const securePart = isProduction ? ' Secure;' : '';
  appendSetCookie(res, `${OAUTH_STATE_COOKIE}=${nonce}; HttpOnly; Path=/; SameSite=Lax; Max-Age=600;${securePart}`);
}

function clearOauthStateCookie(res) {
  const securePart = isProduction ? ' Secure;' : '';
  appendSetCookie(res, `${OAUTH_STATE_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0;${securePart}`);
}

function setSessionCookie(res, user) {
  const sessionId = generateRandomId(16);
  sessions.set(sessionId, { user, expiresAt: Date.now() + SESSION_TTL_MS });
  const securePart = isProduction ? ' Secure;' : '';
  const cookie = `sessionId=${sessionId}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)};${securePart}`;
  appendSetCookie(res, cookie);
}

function getSessionFromRequest(req) {
  const cookieHeader = req.headers['cookie'];
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(';').map((c) => c.trim());
  const sessionPart = parts.find((p) => p.startsWith('sessionId='));
  if (!sessionPart) return null;
  const sessionId = sessionPart.split('=')[1];
  if (!sessionId) return null;
  const entry = sessions.get(sessionId);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    sessions.delete(sessionId);
    return null;
  }
  return entry.user;
}

function postForm(urlString, data) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const body = new URLSearchParams(data).toString();

    const options = {
      method: 'POST',
      hostname: url.hostname,
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let chunks = '';
      res.on('data', (d) => {
        chunks += d.toString();
      });
      res.on('end', () => {
        try {
          const json = JSON.parse(chunks || '{}');
          resolve(json);
        } catch (error) {
          reject(error);
        }
      });
    });

    req.on('error', (err) => reject(err));
    req.write(body);
    req.end();
  });
}

function getJson(urlString, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);

    const options = {
      method: 'GET',
      hostname: url.hostname,
      path: url.pathname + url.search,
      headers,
    };

    const req = https.request(options, (res) => {
      let chunks = '';
      res.on('data', (d) => {
        chunks += d.toString();
      });
      res.on('end', () => {
        try {
          const json = JSON.parse(chunks || '{}');
          resolve(json);
        } catch (error) {
          reject(error);
        }
      });
    });

    req.on('error', (err) => reject(err));
    req.end();
  });
}

server.on('request', (req, res) => {
  // ─── Security headers ───────────────────────────────────────────────────
  setSecurityHeaders(res);
  setCorsHeaders(req, res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // ─── CORS origin check for mutating requests ───────────────────────────
  if ((req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE') && !isOriginAllowed(req)) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Origin not allowed' }));
    return;
  }

  // ─── HTTP rate limiting ─────────────────────────────────────────────────
  const clientIp = req.socket.remoteAddress || 'unknown';
  const httpCheck = rateLimiter.checkHttp(clientIp);
  if (!httpCheck.allowed) {
    res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': String(Math.ceil(httpCheck.retryAfter / 1000)) });
    res.end(JSON.stringify({ error: 'Too many requests', retryAfter: httpCheck.retryAfter }));
    return;
  }

  if (!req.url) {
    res.writeHead(400);
    res.end('Bad request');
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  // ─────────────────────────────────────────────────────────────
  // OAuth: Google
  // ─────────────────────────────────────────────────────────────
  if (req.method === 'GET' && url.pathname === '/auth/google/start') {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const redirectUri = `${getServerOrigin()}/auth/google/callback`;

    if (!clientId) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Google OAuth not configured');
      return;
    }

    const state = generateRandomId(16);
    const stateNonce = generateRandomId(16);
    oauthStates.set(state, { provider: 'google', createdAt: Date.now(), nonce: stateNonce });
    setOauthStateCookie(res, stateNonce);

    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', 'openid profile email');
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('access_type', 'offline');

    res.writeHead(302, { Location: authUrl.toString() });
    res.end();
    return;
  }

  if (req.method === 'GET' && url.pathname === '/auth/google/callback') {
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');

    const oauthState = state ? oauthStates.get(state) : null;
    const cookieNonce = getCookie(req, OAUTH_STATE_COOKIE);
    if (!code || !state || !oauthState || oauthState.provider !== 'google' || !cookieNonce || oauthState.nonce !== cookieNonce) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Invalid OAuth state');
      return;
    }

    oauthStates.delete(state);
    clearOauthStateCookie(res);

    const tokenEndpoint = 'https://oauth2.googleapis.com/token';
    const redirectUri = `${getServerOrigin()}/auth/google/callback`;

    postForm(tokenEndpoint, {
      code,
      client_id: process.env.GOOGLE_CLIENT_ID || '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    })
      .then((tokenResponse) => {
        const accessToken = tokenResponse.access_token;
        if (!accessToken) {
          throw new Error('No access_token from Google');
        }

        return getJson('https://openidconnect.googleapis.com/v1/userinfo', {
          Authorization: `Bearer ${accessToken}`,
        }).then((profile) => {
          console.log('Google userinfo response:', profile);

          if (!profile || !profile.sub) {
            throw new Error('No userinfo from Google');
          }

          const user = {
            provider: 'google',
            sub: profile.sub,
            email: profile.email,
            name: profile.name || profile.email,
            picture: profile.picture || null,
          };

          setSessionCookie(res, user);
          res.writeHead(302, { Location: `${FRONTEND_ORIGIN}/auth/callback` });
          res.end();
        });
      })
      .catch((error) => {
        console.error('Google OAuth error:', error);
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Google OAuth failed');
      });
    return;
  }

  // ─────────────────────────────────────────────────────────────
  // OAuth: Microsoft
  // ─────────────────────────────────────────────────────────────
  if (req.method === 'GET' && url.pathname === '/auth/microsoft/start') {
    const clientId = process.env.MS_CLIENT_ID;
    const tenant = process.env.MS_TENANT || 'common';
    const scopes = process.env.MS_SCOPES || 'openid profile email';
    const redirectUri = `${getServerOrigin()}/auth/microsoft/callback`;

    if (!clientId) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Microsoft OAuth not configured');
      return;
    }

    const state = generateRandomId(16);
    const stateNonce = generateRandomId(16);
    oauthStates.set(state, { provider: 'microsoft', createdAt: Date.now(), nonce: stateNonce });
    setOauthStateCookie(res, stateNonce);

    const authUrl = new URL(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`);
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('response_mode', 'query');
    authUrl.searchParams.set('scope', scopes);
    authUrl.searchParams.set('state', state);

    res.writeHead(302, { Location: authUrl.toString() });
    res.end();
    return;
  }

  if (req.method === 'GET' && url.pathname === '/auth/microsoft/callback') {
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');

    const oauthState = state ? oauthStates.get(state) : null;
    const cookieNonce = getCookie(req, OAUTH_STATE_COOKIE);
    if (!code || !state || !oauthState || oauthState.provider !== 'microsoft' || !cookieNonce || oauthState.nonce !== cookieNonce) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Invalid OAuth state');
      return;
    }

    oauthStates.delete(state);
    clearOauthStateCookie(res);

    const tenant = process.env.MS_TENANT || 'common';
    const tokenEndpoint = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;
    const redirectUri = `${getServerOrigin()}/auth/microsoft/callback`;

    postForm(tokenEndpoint, {
      client_id: process.env.MS_CLIENT_ID || '',
      client_secret: process.env.MS_CLIENT_SECRET || '',
      scope: process.env.MS_SCOPES || 'openid profile email',
      code,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    })
      .then((tokenResponse) => {
        const accessToken = tokenResponse.access_token;
        if (!accessToken) {
          throw new Error('No access_token from Microsoft');
        }

        return getJson('https://graph.microsoft.com/oidc/userinfo', {
          Authorization: `Bearer ${accessToken}`,
        }).then((profile) => {
          if (!profile || !profile.sub) {
            throw new Error('No userinfo from Microsoft');
          }

          const user = {
            provider: 'microsoft',
            sub: profile.sub,
            email: profile.email || profile.preferred_username,
            name: profile.name || profile.preferred_username || profile.email,
          };

          setSessionCookie(res, user);
          res.writeHead(302, { Location: `${FRONTEND_ORIGIN}/auth/callback` });
          res.end();
        });
      })
      .catch((error) => {
        console.error('Microsoft OAuth error:', error);
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Microsoft OAuth failed');
      });
    return;
  }

  // Current authenticated user
  if (req.method === 'GET' && url.pathname === '/api/me') {
    const user = getSessionFromRequest(req) || null;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ user }));
    return;
  }

  // Logout: clear the session cookie and remove from store
  if (req.method === 'POST' && url.pathname === '/auth/logout') {
    const cookieHeader = req.headers['cookie'];
    if (cookieHeader) {
      const parts = cookieHeader.split(';').map((c) => c.trim());
      const sessionPart = parts.find((p) => p.startsWith('sessionId='));
      if (sessionPart) {
        const sessionId = sessionPart.split('=')[1];
        if (sessionId) sessions.delete(sessionId);
      }
    }
    // Expire the cookie
    const securePart = isProduction ? ' Secure;' : '';
    appendSetCookie(res, `sessionId=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0;${securePart}`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/community-device/requests') {
    if (!communitySecurityOperational) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'community security registry unavailable' }));
      return;
    }
    const communityId = parseCommunityId(url.searchParams.get('communityId'));
    if (!communityId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'invalid communityId' }));
      return;
    }
    const bucket = getCommunitySecurityBucketForRead(communityId);
    if (!bucket) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'community security record not found' }));
      return;
    }
    const authz = requireDeviceReadAuthorization(url, communityId, bucket, 'requests');
    if (!authz.ok) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: authz.reason }));
      return;
    }
    const requests = Object.values(bucket.requests)
      .sort((a, b) => Number(a.requestedAt) - Number(b.requestedAt))
      .map((request) => ({
        communityId,
        devicePublicKey: request.devicePublicKey,
        userId: request.userId,
        deviceEncryptionPublicKey: request.deviceEncryptionPublicKey,
        requestedAt: Number(request.requestedAt) || 0,
        method: request.method,
        signature: request.signature,
      }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ requests }));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/community-device/request') {
    parseBodyWithLimit(req, res, 16384).then((data) => {
      if (!data) return;
      try {
        if (!communitySecurityOperational) {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'community security registry unavailable' }));
          return;
        }
        const communityId = parseCommunityId(data.communityId);
        const userId = sanitizeId(String(data.userId || ''), 128);
        const method = parseMethod(data.method);
        const devicePublicKey = parseDevicePublicKey(data.devicePublicKey);
        const deviceEncryptionPublicKey = parseDeviceEncryptionPublicKey(data.deviceEncryptionPublicKey);
        const signature = parseSignature(data.signature);
        const requestedAt = parseTimestamp(data.requestedAt);
        if (!communityId || !userId || !method || !devicePublicKey || !deviceEncryptionPublicKey || !signature) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'invalid community device request payload' }));
          return;
        }
        const requestPayload = JSON.stringify({
          deviceEncryptionPublicKey,
          devicePublicKey,
          method,
          requestedAt,
          userId,
        });
        if (!verifyFrontendCryptoServiceSignature(requestPayload, signature, devicePublicKey)) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'invalid device request signature' }));
          return;
        }
        let bucket = getCommunitySecurityBucketForRead(communityId);
        if (!bucket) {
          const bootstrapUser = getSessionFromRequest(req);
          const ownerSessionKey = computeSessionOwnerKey(bootstrapUser);
          if (!bootstrapUser || !ownerSessionKey) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'authenticated session required to initialize community security state' }));
            return;
          }
          bucket = getCommunitySecurityBucket(communityId);
          if (!bucket) {
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'community security registry capacity reached' }));
            return;
          }
          bucket.ownerSessionKey = ownerSessionKey;
        }
        if (!bucket.requests[devicePublicKey] && Object.keys(bucket.requests).length >= MAX_REQUESTS_PER_COMMUNITY) {
          res.writeHead(429, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'too many pending requests for this community' }));
          return;
        }
        bucket.requests[devicePublicKey] = {
          communityId,
          userId,
          method,
          devicePublicKey,
          deviceEncryptionPublicKey,
          signature,
          requestedAt,
        };
        bucket.updatedAt = Date.now();
        try {
          saveCommunitySecurityState();
        } catch (error) {
          communitySecurityOperational = false;
          sendError(res, 500, 'community security persistence failed', error, '/api/community-device/request');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (error) {
        sendError(res, 500, 'community device request failed', error, '/api/community-device/request');
      }
    });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/community-device/keyring') {
    if (!communitySecurityOperational) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'community security registry unavailable' }));
      return;
    }
    const communityId = parseCommunityId(url.searchParams.get('communityId'));
    if (!communityId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'invalid communityId' }));
      return;
    }
    const bucket = getCommunitySecurityBucketForRead(communityId);
    if (!bucket) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'community security record not found' }));
      return;
    }
    const authz = requireDeviceReadAuthorization(url, communityId, bucket, 'keyring');
    if (!authz.ok) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: authz.reason }));
      return;
    }
    const entries = Object.values(bucket.keyRing)
      .sort((a, b) => Number(b.updatedAt) - Number(a.updatedAt))
      .map((entry) => ({
        communityId,
        devicePublicKey: entry.devicePublicKey,
        deviceEncryptionPublicKey: entry.deviceEncryptionPublicKey,
        approvedBy: entry.approvedBy,
        keyVersion: Number(entry.keyVersion) || 1,
        updatedAt: Number(entry.updatedAt) || 0,
      }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ entries }));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/community-device/approval') {
    parseBodyWithLimit(req, res, 32768).then((data) => {
      if (!data) return;
      try {
        if (!communitySecurityOperational) {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'community security registry unavailable' }));
          return;
        }
        const communityId = parseCommunityId(data.communityId);
        const devicePublicKey = parseDevicePublicKey(data.devicePublicKey);
        const deviceEncryptionPublicKey = parseDeviceEncryptionPublicKey(data.deviceEncryptionPublicKey);
        const encryptedCommunityKey = parseEncryptedCommunityKey(data.encryptedCommunityKey);
        const approvedBy = parseDevicePublicKey(data.approvedBy);
        const signature = parseSignature(data.signature);
        const keyVersion = parseKeyVersion(data.keyVersion);
        const updatedAt = parseTimestamp(data.updatedAt);
        if (!communityId || !devicePublicKey || !deviceEncryptionPublicKey || !encryptedCommunityKey || !approvedBy || !signature) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'invalid community approval payload' }));
          return;
        }
        const bucket = getCommunitySecurityBucketForRead(communityId);
        if (!bucket) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'community security record not found' }));
          return;
        }
        const approverInRing = Boolean(bucket.keyRing[approvedBy]);
        const isBootstrapEnvelope = Object.keys(bucket.keyRing).length === 0 && approvedBy === devicePublicKey;
        if (isBootstrapEnvelope && !getSessionFromRequest(req)) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'authenticated session required for bootstrap approval' }));
          return;
        }
        if (isBootstrapEnvelope) {
          const bootstrapUser = getSessionFromRequest(req);
          const ownerSessionKey = computeSessionOwnerKey(bootstrapUser);
          if (!ownerSessionKey || !bucket.ownerSessionKey || ownerSessionKey !== bucket.ownerSessionKey) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'bootstrap approval is restricted to the community owner session' }));
            return;
          }
        }
        if (!approverInRing && !isBootstrapEnvelope) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'approver is not authorized for this community' }));
          return;
        }
        const envelopePayload = JSON.stringify({
          approvedBy,
          communityId,
          deviceEncryptionPublicKey,
          devicePublicKey,
          encryptedCommunityKey,
          keyVersion,
          updatedAt,
        });
        if (!verifyFrontendCryptoServiceSignature(envelopePayload, signature, approvedBy)) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'invalid approval signature' }));
          return;
        }
        if (keyVersion < bucket.currentKeyVersion) {
          res.writeHead(409, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'stale key version for this community' }));
          return;
        }
        const revokedAtVersion = parseExistingKeyVersion(bucket.revokedDevices[devicePublicKey]);
        if (revokedAtVersion > 0 && keyVersion <= revokedAtVersion) {
          res.writeHead(409, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'device was revoked for this key version' }));
          return;
        }
        if (!bucket.keyRing[devicePublicKey] && Object.keys(bucket.keyRing).length >= MAX_KEYRING_ENTRIES_PER_COMMUNITY) {
          res.writeHead(429, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'community key ring capacity reached' }));
          return;
        }
        const existingEntry = bucket.keyRing[devicePublicKey];
        if (existingEntry && Number(existingEntry.keyVersion) > keyVersion) {
          res.writeHead(409, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'stale key version for device approval' }));
          return;
        }
        bucket.keyRing[devicePublicKey] = {
          communityId,
          devicePublicKey,
          deviceEncryptionPublicKey,
          encryptedCommunityKey,
          approvedBy,
          signature,
          keyVersion,
          updatedAt,
        };
        if (keyVersion > bucket.currentKeyVersion) {
          bucket.currentKeyVersion = keyVersion;
        }
        delete bucket.requests[devicePublicKey];
        bucket.updatedAt = Date.now();
        try {
          saveCommunitySecurityState();
        } catch (error) {
          communitySecurityOperational = false;
          sendError(res, 500, 'community security persistence failed', error, '/api/community-device/approval');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (error) {
        sendError(res, 500, 'community approval failed', error, '/api/community-device/approval');
      }
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/community-device/remove') {
    parseBodyWithLimit(req, res, 16384).then((data) => {
      if (!data) return;
      try {
        if (!communitySecurityOperational) {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'community security registry unavailable' }));
          return;
        }
        const communityId = parseCommunityId(data.communityId);
        const removedDevicePublicKey = parseDevicePublicKey(data.removedDevicePublicKey);
        const rotatedBy = parseDevicePublicKey(data.rotatedBy);
        const signature = parseSignature(data.signature);
        const keyVersion = parseKeyVersion(data.keyVersion);
        const rotatedAt = parseTimestamp(data.rotatedAt);
        if (!communityId || !removedDevicePublicKey || !rotatedBy || !signature) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'invalid community remove payload' }));
          return;
        }
        const bucket = getCommunitySecurityBucketForRead(communityId);
        if (!bucket) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'community security record not found' }));
          return;
        }
        if (!bucket.keyRing[rotatedBy]) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'rotating device is not authorized for this community' }));
          return;
        }
        const removePayload = JSON.stringify({
          communityId,
          removedDevicePublicKey,
          rotatedBy,
          keyVersion,
          rotatedAt,
        });
        if (!verifyFrontendCryptoServiceSignature(removePayload, signature, rotatedBy)) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'invalid rotation signature' }));
          return;
        }
        if (keyVersion <= bucket.currentKeyVersion) {
          res.writeHead(409, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'rotation key version must be newer than current' }));
          return;
        }
        const existed = Boolean(bucket.keyRing[removedDevicePublicKey] || bucket.requests[removedDevicePublicKey]);
        delete bucket.keyRing[removedDevicePublicKey];
        delete bucket.requests[removedDevicePublicKey];
        bucket.revokedDevices[removedDevicePublicKey] = keyVersion;
        bucket.currentKeyVersion = keyVersion;
        bucket.rotations.push({
          communityId,
          removedDevicePublicKey,
          rotatedBy,
          keyVersion,
          rotatedAt,
        });
        if (bucket.rotations.length > 200) {
          bucket.rotations = bucket.rotations.slice(-200);
        }
        bucket.updatedAt = Date.now();
        try {
          saveCommunitySecurityState();
        } catch (error) {
          communitySecurityOperational = false;
          sendError(res, 500, 'community security persistence failed', error, '/api/community-device/remove');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, removed: existed }));
      } catch (error) {
        sendError(res, 500, 'community remove failed', error, '/api/community-device/remove');
      }
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/vote-authorize') {
    parseBodyWithLimit(req, res, 4096).then((data) => {
      if (!data) return; // parseBodyWithLimit already sent error response
      try {
        const pollId = sanitizeId(String(data.pollId || ''), 128);
        const deviceId = sanitizeId(String(data.deviceId || ''), 128);

        if (!pollId || !deviceId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ allowed: false, reason: 'missing or invalid pollId or deviceId' }));
          return;
        }

        const key = `${pollId}:${deviceId}`;
        const ownerId = buildReservationOwner(req);
        const reservation = reserveVoteSlot(key, ownerId);
        const allowed = reservation.ok;

        // Log the authorization attempt
        const logEntry = {
          type: 'vote-authorize',
          pollId,
          deviceId,
          allowed,
          timestamp: Date.now(),
        };
        fs.appendFile(RECEIPT_LOG_FILE, JSON.stringify(logEntry) + '\n', () => {});

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          allowed,
          reservationToken: allowed ? reservation.reservationToken : undefined,
          reason: allowed ? undefined : reservation.reason,
        }));
      } catch (error) {
        // SECURITY FIX: Return allowed: false on error (was: true)
        console.error('Error in /api/vote-authorize:', error.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ allowed: false, reason: 'internal error' }));
      }
    });
    return;
  }

  if (req.method === 'POST' && (url.pathname === '/api/vote-confirm' || url.pathname === '/api/vote-record')) {
    parseBodyWithLimit(req, res, 4096).then((data) => {
      if (!data) return;
      try {
        const pollId = sanitizeId(String(data.pollId || ''), 128);
        const deviceId = sanitizeId(String(data.deviceId || ''), 128);
        const reservationToken = String(data.reservationToken || '').trim();

        if (!pollId || !deviceId || !reservationToken) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, reason: 'missing or invalid pollId, deviceId, or reservationToken' }));
          return;
        }

        const key = `${pollId}:${deviceId}`;
        const ownerId = buildReservationOwner(req);
        const commitResult = commitVoteSlot(key, ownerId, reservationToken);
        if (!commitResult.ok) {
          res.writeHead(409, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, reason: commitResult.reason }));
          return;
        }

        const logEntry = {
          type: url.pathname === '/api/vote-confirm' ? 'vote-confirm' : 'vote-record',
          pollId,
          deviceId,
          timestamp: Date.now(),
        };
        fs.appendFile(RECEIPT_LOG_FILE, JSON.stringify(logEntry) + '\n', () => {});

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, alreadyRecorded: commitResult.alreadyRecorded }));
      } catch (error) {
        console.error(`Error in ${url.pathname}:`, error.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, reason: 'internal error' }));
      }
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/receipts') {
    parseBodyWithLimit(req, res, 16384).then((data) => {
      if (!data) return;
      try {
        const logEntry = {
          type: 'receipt',
          payload: data,
          timestamp: Date.now(),
        };
        fs.appendFile(RECEIPT_LOG_FILE, JSON.stringify(logEntry) + '\n', (err) => {
          if (err) {
            console.error('Failed to write receipt log:', err.message);
          }
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (error) {
        sendError(res, 500, 'Receipt processing failed', error, '/api/receipts');
      }
    });
    return;
  }

  // Fallback 404 for unknown routes
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
});

wss.on('connection', (ws, req) => {
  let peerId = null;
  const peerIp = req.socket.remoteAddress || 'unknown';
  
  console.log('🔌 New connection from', sanitizeLogString(peerIp));

  ws.on('message', (message) => {
    try {
      // ─── Message validation ───────────────────────────────────────
      const validation = validateWsMessage(message);
      if (!validation.valid) {
        if (ws.readyState === 1) {
          ws.send(JSON.stringify({ type: 'error', code: 'INVALID_MESSAGE', reason: validation.reason }));
        }
        return;
      }
      const data = validation.data;

      // Skip rate limiting for heartbeat messages
      if (data.type !== 'ping' && data.type !== 'pong') {
        // ─── WebSocket rate limiting ────────────────────────────────
        const wsCheck = rateLimiter.checkWs(peerId || peerIp);
        if (!wsCheck.allowed) {
          if (ws.readyState === 1) {
            ws.send(JSON.stringify({ type: 'error', code: 'RATE_LIMITED', retryAfter: wsCheck.retryAfter }));
          }
          return;
        }

        // ─── Bot detection ──────────────────────────────────────────
        const msgHash = crypto.createHash('sha256').update(message.toString().slice(0, 1000)).digest('hex');
        botDetector.recordMessage(peerId || peerIp, msgHash);
        const botAction = botDetector.getAction(peerId || peerIp);
        if (botAction.action === 'ban') {
          console.log(`🤖 Banning peer ${peerId || peerIp} (bot score: ${botAction.score})`);
          if (ws.readyState === 1) {
            ws.send(JSON.stringify({ type: 'error', code: 'BANNED', reason: 'Automated behavior detected' }));
          }
          ws.close();
          return;
        }
      }

      // ─── PoW verification for content messages ──────────────────
      const actionType = data.actionType || data.data?.actionType;
      if (powChallenge.requiresPow(data.type, actionType)) {
        if (!data.pow || !data.pow.challengeId || data.pow.nonce == null) {
          if (ws.readyState === 1) {
            ws.send(JSON.stringify({ type: 'pow-required', reason: 'Proof-of-work required for this action' }));
          }
          return;
        }
        const powResult = powChallenge.verify(data.pow.challengeId, data.pow.nonce);
        if (!powResult.valid) {
          if (ws.readyState === 1) {
            ws.send(JSON.stringify({ type: 'pow-required', reason: powResult.reason }));
          }
          return;
        }
      }

      // ─── Spam scoring for content messages ──────────────────────
      if (data.type === 'broadcast' || data.type === 'new-poll' || data.type === 'new-block') {
        const payload = data.data || data;
        const textContent = [payload.title, payload.content, payload.description, payload.question]
          .filter(Boolean)
          .join(' ');
        if (textContent) {
          const scoreResult = spamScorer.score(textContent);
          if (spamScorer.shouldFlag(scoreResult)) {
            console.log(`🚩 Flagged content from ${peerId || peerIp}: ${scoreResult.matchCount} matches [${scoreResult.matches.join(', ')}]`);
            if (data.data) {
              data.data._flagged = true;
            } else {
              data._flagged = true;
            }
          }
          if (spamScorer.shouldDelay(scoreResult)) {
            // Delay broadcast by 3 seconds for heavily flagged content
            const delayedData = JSON.parse(JSON.stringify(data));
            setTimeout(() => {
              switch (delayedData.type) {
                case 'broadcast':
                  broadcastToOthers(peerId, delayedData.data);
                  cacheMessage(delayedData.data);
                  break;
                case 'new-poll':
                case 'new-block':
                  broadcastToOthers(peerId, delayedData);
                  cacheMessage(delayedData);
                  break;
              }
            }, 3000);
            return; // Don't process in the switch below
          }
        }
      }
      
      switch (data.type) {
        case 'ping':
          // Respond to client heartbeat
          if (ws.readyState === 1) {
            ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
          }
          break;

        case 'register':
          peerId = data.peerId; // Already sanitized by ws-validators
          if (clients.has(peerId)) {
            // Reject duplicate peerId registration
            if (ws.readyState === 1) {
              ws.send(JSON.stringify({ type: 'error', code: 'PEER_ID_TAKEN', reason: 'Peer ID already registered' }));
            }
            peerId = null;
            break;
          }
          clients.set(peerId, ws);
          botDetector.onRegister(peerId);
          console.log(`✅ Peer registered: ${sanitizeLogString(peerId)} (Total: ${clients.size})`);

          // Send list of active peers
          broadcast({
            type: 'peer-list',
            peers: Array.from(clients.keys())
          });

          // Replay cached messages so new client has content immediately
          if (messageCache.length > 0) {
            console.log(`📦 Replaying ${messageCache.length} cached messages to ${peerId}`);
            for (const msg of messageCache) {
              try {
                ws.send(JSON.stringify(msg));
              } catch {}
            }
          }
          break;
          
        case 'join-room':
          const roomId = data.roomId || 'default';
          if (!rooms.has(roomId)) {
            rooms.set(roomId, new Set());
          }
          rooms.get(roomId).add(peerId);
          console.log(`🚪 ${sanitizeLogString(peerId)} joined room: ${sanitizeLogString(roomId)}`);
          break;
          
        case 'broadcast':
          // Relay to all other peers
          console.log(`📡 Broadcasting ${sanitizeLogString(data.data?.type || 'message')} from ${sanitizeLogString(peerId)}`);
          broadcastToOthers(peerId, data.data);
          // Cache content messages for seeding new clients
          cacheMessage(data.data);
          break;
          
        case 'direct':
          // Send to specific peer
          const targetWs = clients.get(data.targetPeer);
          if (targetWs && targetWs.readyState === 1) { // 1 = OPEN
            targetWs.send(JSON.stringify(data.data));
          }
          break;
          
        // Encrypted chat room message — relay opaque blob to all other peers
        case 'chatroom-message':
          if (!peerId) break;
          broadcastToOthers(peerId, {
            type: 'chatroom-message',
            roomId: data.roomId,
            data: data.data,
          });
          break;

        // Handle direct P2P messages (not wrapped in 'broadcast')
        case 'new-poll':
        case 'new-block':
        case 'request-sync':
        case 'sync-response':
          console.log(`📡 Broadcasting ${sanitizeLogString(data.type)} from ${sanitizeLogString(peerId)}`);
          broadcastToOthers(peerId, data);
          // Cache content messages for seeding new clients
          cacheMessage(data);
          break;
          
        case 'request-pow': {
          const deviceId = data.deviceId || peerId;
          const action = data.action || 'default';
          const botScore = botDetector.getScore(peerId || peerIp);
          const challenge = powChallenge.createChallenge(deviceId, action, { botScore, spamPenalty: 0 });
          if (ws.readyState === 1) {
            ws.send(JSON.stringify({ type: 'pow-challenge', ...challenge }));
          }
          break;
        }

        default:
          console.log('Unknown message type:', sanitizeLogString(data.type));
      }
    } catch (error) {
      console.error('Error handling message:', error);
    }
  });

  ws.on('close', () => {
    if (peerId) {
      clients.delete(peerId);
      botDetector.onDisconnect(peerId);
      
      // Remove from all rooms
      rooms.forEach((peers, roomId) => {
        peers.delete(peerId);
        if (peers.size === 0) {
          rooms.delete(roomId);
        }
      });
      
      console.log(`❌ Peer disconnected: ${sanitizeLogString(peerId)} (Total: ${clients.size})`);
      
      // Notify others
      broadcast({
        type: 'peer-left',
        peerId: peerId
      });
    }
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error.message);
  });
  
  // Send welcome message
  ws.send(JSON.stringify({
    type: 'welcome',
    message: 'Connected to P2P relay',
    timestamp: Date.now()
  }));
});

function broadcast(message) {
  clients.forEach((ws) => {
    if (ws.readyState === 1) { // 1 = OPEN
      ws.send(JSON.stringify(message));
    }
  });
}

function broadcastToOthers(excludePeerId, message) {
  clients.forEach((ws, peerId) => {
    if (peerId !== excludePeerId && ws.readyState === 1) { // 1 = OPEN
      ws.send(JSON.stringify(message));
    }
  });
}

server.listen(PORT, () => {
  console.log('🚀 P2P Relay Server running on ws://localhost:' + PORT);
  console.log('📡 Waiting for connections...');
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Shutting down relay server...');
  saveMessageCache();
  rateLimiter.destroy();
  botDetector.destroy();
  powChallenge.destroy();
  wss.clients.forEach((ws) => {
    ws.close();
  });
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});
