//backend/relay-server-enhanced.js
// Enhanced with: 1-to-1 P2P chat, Full-text search, Improved auth security, Bot SSR, Sitemap
// SECURITY: Rate limiting, bot detection, PoW, input validation, CORS whitelist

import { WebSocketServer } from 'ws';
import http from 'http';
import https from 'https';
import fs from 'fs';
import crypto from 'crypto';
import { URL } from 'url';
import mysql from 'mysql2/promise';
import { RateLimiter } from '../rate-limiter.js';
import { BotDetector } from '../bot-detector.js';
import { SpamScorer } from '../spam-scorer.js';
import { PowChallenge } from '../pow-challenge.js';
import {
  sanitizeId, sanitizeLogString, sanitizeString,
  parseBodyWithLimit, setCorsHeaders, setSecurityHeaders, isOriginAllowed,
  sendError, requireSecret, ALLOWED_ORIGINS,
} from '../gun-relay/security-utils.js';
import { validateWsMessage } from '../ws-validators.js';
import { validateMessage, validateHttpRequest, validateSearchQuery, KNOWN_WS_TYPES } from '../shared-validation/index.js';
import { verifyContentHash } from '../shared-validation/integrity.js';
import { verifySignature } from '../shared-validation/signatures.js';
import { verifyPoW as verifyHashcashPoW, POW_EXEMPT } from '../shared-validation/pow.js';
import { ReplayProtector } from '../shared-validation/replay.js';
import { ErrorCodes, makeError } from '../shared-validation/errors.js';

const PORT = process.env.PORT || 8080;
const DOMAIN = process.env.DOMAIN || 'https://endless.sbs';
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'https://endless.sbs';
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const OAUTH_STATE_COOKIE = 'interpoll_oauth_state';

const server = http.createServer();
const WS_MAX_PAYLOAD = 262144; // 256KB
const wss = new WebSocketServer({ server, maxPayload: WS_MAX_PAYLOAD });
const clients = new Map();
const rooms = new Map();
const oauthStates = new Map();
const sessions = new Map();
const activeChatSessions = new Map();

// Anti-spam modules
const rateLimiter = new RateLimiter();
const botDetector = new BotDetector();
const spamScorer = new SpamScorer();
const powChallenge = new PowChallenge();
const replayProtector = new ReplayProtector();
const PENDING_VOTE_TTL_MS = 60_000;
const PENDING_VOTE_CLEANUP_MS = 30_000;
const MAX_PENDING_VOTE_RESERVATIONS = 10_000;
const VOTE_RESERVATION_SECRET = process.env.VOTE_RESERVATION_SECRET || crypto.randomBytes(32).toString('hex');

// OAuth state expiry
const OAUTH_STATE_TTL_MS = 10 * 60_000;
setInterval(() => {
  const now = Date.now();
  for (const [state, entry] of oauthStates) {
    if (now - entry.createdAt > OAUTH_STATE_TTL_MS) oauthStates.delete(state);
  }
}, 2 * 60_000);

// ─── Persistence ──────────────────────────────────────────────────────────────
const DATA_DIR = new URL('./data', import.meta.url).pathname;
const RECEIPT_LOG_FILE = `${DATA_DIR}/storage.txt`;
const MESSAGE_CACHE_FILE = `${DATA_DIR}/message-cache.json`;

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const VOTE_REGISTRY_FILE = `${DATA_DIR}/vote-registry.json`;
const VOTE_REGISTRY_BACKUP_FILE = `${DATA_DIR}/vote-registry.backup.json`;
const VOTE_REGISTRY_TMP_FILE = `${DATA_DIR}/vote-registry.tmp.json`;
const PENDING_VOTE_RESERVATIONS_FILE = `${DATA_DIR}/pending-vote-reservations.json`;
const PENDING_VOTE_RESERVATIONS_BACKUP_FILE = `${DATA_DIR}/pending-vote-reservations.backup.json`;
const PENDING_VOTE_RESERVATIONS_TMP_FILE = `${DATA_DIR}/pending-vote-reservations.tmp.json`;
const POLL_POLICY_FILE = `${DATA_DIR}/poll-policy.json`;
const POLL_POLICY_BACKUP_FILE = `${DATA_DIR}/poll-policy.backup.json`;
const POLL_POLICY_TMP_FILE = `${DATA_DIR}/poll-policy.tmp.json`;
const MAX_VOTE_REGISTRY = 500_000;

let voteRegistry = new Set();
let voteRegistryOperational = true;
const pendingVoteReservations = new Map();
const pollPolicyRegistry = new Map();

const ALLOWED_BROADCAST_TYPES = new Set([
  'new-poll',
  'new-block',
  'new-event',
  'request-sync',
  'sync-response',
  'poll-updated',
  'server-list',
  'peer-addresses',
  'rtc-offer',
  'rtc-answer',
  'rtc-ice',
  'snapshot-offer',
  'snapshot-accept',
  'snapshot-chunk',
  'snapshot-complete',
  'snapshot-cancel',
]);
const TRUST_ISSUER_DOMAINS = new Set(['endles.sbs', 'endless.sbs']);

function loadVoteRegistryFromFile(filePath) {
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!Array.isArray(data)) {
    throw new Error('vote registry is not an array');
  }
  voteRegistry = new Set(data.filter((entry) => typeof entry === 'string' && entry.length > 0));
}

function normalizePendingVoteReservationRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
  const key = typeof record.key === 'string' ? record.key : '';
  const reservationId = typeof record.reservationId === 'string' ? record.reservationId : '';
  const deviceId = typeof record.deviceId === 'string' ? record.deviceId : '';
  const expiresAt = Number.parseInt(String(record.expiresAt || ''), 10);
  if (!key || !reservationId || !deviceId || !Number.isFinite(expiresAt)) return null;
  return { key, reservationId, deviceId, expiresAt };
}

function loadPendingVoteReservationsFromFile(filePath) {
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!Array.isArray(data)) {
    throw new Error('pending vote reservations is not an array');
  }
  pendingVoteReservations.clear();
  for (const entry of data) {
    const normalized = normalizePendingVoteReservationRecord(entry);
    if (normalized) {
      pendingVoteReservations.set(normalized.key, {
        reservationId: normalized.reservationId,
        deviceId: normalized.deviceId,
        expiresAt: normalized.expiresAt,
      });
    }
  }
  cleanupPendingVoteReservations();
}

function normalizePollPolicyRecord(record) {
  if (typeof record === 'boolean') {
    return {
      requireLogin: record,
      ownerPubkey: '',
      ownerProvider: '',
      ownerSub: '',
    };
  }
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return null;
  }
  if (typeof record.requireLogin !== 'boolean') return null;
  return {
    requireLogin: record.requireLogin,
    ownerPubkey: typeof record.ownerPubkey === 'string' ? record.ownerPubkey : '',
    ownerProvider: typeof record.ownerProvider === 'string' ? record.ownerProvider : '',
    ownerSub: typeof record.ownerSub === 'string' ? record.ownerSub : '',
  };
}

function loadPollPolicyFromFile(filePath) {
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('poll policy registry is not an object');
  }
  pollPolicyRegistry.clear();
  for (const [pollId, policyRecord] of Object.entries(data)) {
    const normalized = normalizePollPolicyRecord(policyRecord);
    if (typeof pollId === 'string' && pollId.length > 0 && normalized) {
      pollPolicyRegistry.set(pollId, normalized);
    }
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
} catch (err) {
  console.error('Failed to load primary vote registry, trying backup:', err.message);
  try {
    if (fs.existsSync(VOTE_REGISTRY_BACKUP_FILE)) {
      loadVoteRegistryFromFile(VOTE_REGISTRY_BACKUP_FILE);
      console.log(`Recovered ${voteRegistry.size} vote records from backup`);
    } else {
      voteRegistryOperational = false;
    }
  } catch (backupErr) {
    console.error('Failed to load backup vote registry:', backupErr.message);
    voteRegistryOperational = false;
  }
}

try {
  if (fs.existsSync(PENDING_VOTE_RESERVATIONS_FILE)) {
    loadPendingVoteReservationsFromFile(PENDING_VOTE_RESERVATIONS_FILE);
    console.log(`Loaded ${pendingVoteReservations.size} pending vote reservations from disk`);
  } else if (fs.existsSync(PENDING_VOTE_RESERVATIONS_BACKUP_FILE)) {
    loadPendingVoteReservationsFromFile(PENDING_VOTE_RESERVATIONS_BACKUP_FILE);
    console.log(`Recovered ${pendingVoteReservations.size} pending vote reservations from backup`);
  }
} catch (err) {
  console.error('Failed to load primary pending vote reservations, trying backup:', err.message);
  try {
    if (fs.existsSync(PENDING_VOTE_RESERVATIONS_BACKUP_FILE)) {
      loadPendingVoteReservationsFromFile(PENDING_VOTE_RESERVATIONS_BACKUP_FILE);
      console.log(`Recovered ${pendingVoteReservations.size} pending vote reservations from backup`);
    }
  } catch (backupErr) {
    console.error('Failed to load backup pending vote reservations:', backupErr.message);
  }
}

try {
  if (fs.existsSync(POLL_POLICY_FILE)) {
    loadPollPolicyFromFile(POLL_POLICY_FILE);
    console.log(`Loaded ${pollPolicyRegistry.size} poll policy entries from disk`);
  } else if (fs.existsSync(POLL_POLICY_BACKUP_FILE)) {
    loadPollPolicyFromFile(POLL_POLICY_BACKUP_FILE);
    console.log(`Recovered ${pollPolicyRegistry.size} poll policy entries from backup`);
  }
} catch (err) {
  console.error('Failed to load primary poll policy registry, trying backup:', err.message);
  try {
    if (fs.existsSync(POLL_POLICY_BACKUP_FILE)) {
      loadPollPolicyFromFile(POLL_POLICY_BACKUP_FILE);
      console.log(`Recovered ${pollPolicyRegistry.size} poll policy entries from backup`);
    }
  } catch (backupErr) {
    console.error('Failed to load backup poll policy registry:', backupErr.message);
  }
}

let _voteRegistrySaving = false;
function saveVoteRegistry() {
  if (_voteRegistrySaving) return;
  _voteRegistrySaving = true;
  const data = JSON.stringify([...voteRegistry]);
  fs.writeFile(VOTE_REGISTRY_TMP_FILE, data, (err) => {
    _voteRegistrySaving = false;
    if (err) {
      voteRegistryOperational = false;
      console.error('Failed to save vote registry:', err.message);
      return;
    }
    try {
      fs.renameSync(VOTE_REGISTRY_TMP_FILE, VOTE_REGISTRY_FILE);
      fs.writeFileSync(VOTE_REGISTRY_BACKUP_FILE, data);
      voteRegistryOperational = true;
    } catch (writeErr) {
      voteRegistryOperational = false;
      console.error('Failed to finalize vote registry save:', writeErr.message);
    }
  });
}
function saveVoteRegistrySync() {
  try {
    const data = JSON.stringify([...voteRegistry]);
    fs.writeFileSync(VOTE_REGISTRY_TMP_FILE, data);
    fs.renameSync(VOTE_REGISTRY_TMP_FILE, VOTE_REGISTRY_FILE);
    fs.writeFileSync(VOTE_REGISTRY_BACKUP_FILE, data);
    voteRegistryOperational = true;
  } catch (err) {
    voteRegistryOperational = false;
    console.error('Failed to save vote registry:', err.message);
    throw err;
  }
}

function savePendingVoteReservationsSync() {
  const data = JSON.stringify(
    [...pendingVoteReservations.entries()].map(([key, reservation]) => ({
      key,
      reservationId: reservation.reservationId,
      deviceId: reservation.deviceId,
      expiresAt: reservation.expiresAt,
    })),
  );
  fs.writeFileSync(PENDING_VOTE_RESERVATIONS_TMP_FILE, data);
  fs.renameSync(PENDING_VOTE_RESERVATIONS_TMP_FILE, PENDING_VOTE_RESERVATIONS_FILE);
  fs.writeFileSync(PENDING_VOTE_RESERVATIONS_BACKUP_FILE, data);
}

let _pollPolicySaving = false;
function savePollPolicyRegistry() {
  if (_pollPolicySaving) return;
  _pollPolicySaving = true;
  const data = JSON.stringify(Object.fromEntries(pollPolicyRegistry));
  fs.writeFile(POLL_POLICY_TMP_FILE, data, (err) => {
    _pollPolicySaving = false;
    if (err) {
      console.error('Failed to save poll policy registry:', err.message);
      return;
    }
    try {
      fs.renameSync(POLL_POLICY_TMP_FILE, POLL_POLICY_FILE);
      fs.writeFileSync(POLL_POLICY_BACKUP_FILE, data);
    } catch (writeErr) {
      console.error('Failed to finalize poll policy registry save:', writeErr.message);
    }
  });
}

function savePollPolicyRegistrySync() {
  try {
    const data = JSON.stringify(Object.fromEntries(pollPolicyRegistry));
    fs.writeFileSync(POLL_POLICY_TMP_FILE, data);
    fs.renameSync(POLL_POLICY_TMP_FILE, POLL_POLICY_FILE);
    fs.writeFileSync(POLL_POLICY_BACKUP_FILE, data);
  } catch (err) {
    console.error('Failed to save poll policy registry:', err.message);
    throw err;
  }
}

function cleanupPendingVoteReservations(now = Date.now()) {
  for (const [key, reservation] of pendingVoteReservations) {
    if (reservation.expiresAt <= now) pendingVoteReservations.delete(key);
  }
}

function hasPendingVoteReservation(key, now = Date.now()) {
  const reservation = pendingVoteReservations.get(key);
  if (!reservation) return false;
  if (reservation.expiresAt <= now) {
    pendingVoteReservations.delete(key);
    return false;
  }
  return true;
}

function signReservationToken(key, reservationId, expiresAt) {
  return crypto
    .createHmac('sha256', VOTE_RESERVATION_SECRET)
    .update(`${key}:${reservationId}:${expiresAt}`)
    .digest('base64url');
}

function issueReservationToken(key, reservationId, expiresAt) {
  const signature = signReservationToken(key, reservationId, expiresAt);
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

function isValidReservationToken(token, key, now = Date.now()) {
  const parsed = parseReservationToken(token);
  if (!parsed) return { valid: false, reason: 'invalid reservation token', parsed: null };
  if (parsed.expiresAt <= now) return { valid: false, reason: 'vote authorization expired', parsed };
  const expectedSignature = signReservationToken(key, parsed.reservationId, parsed.expiresAt);
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

function reserveVoteSlot(key, deviceId, now = Date.now()) {
  if (!voteRegistryOperational) {
    return { ok: false, reason: 'vote registry unavailable' };
  }
  cleanupPendingVoteReservations(now);
  if (voteRegistry.has(key) || hasPendingVoteReservation(key, now)) {
    return { ok: false, reason: 'already voted or vote pending' };
  }
  if (pendingVoteReservations.size >= MAX_PENDING_VOTE_RESERVATIONS) {
    return { ok: false, reason: 'vote authorization busy, please retry' };
  }
  const expiresAt = now + PENDING_VOTE_TTL_MS;
  const reservationId = crypto.randomBytes(12).toString('hex');
  pendingVoteReservations.set(key, { expiresAt, reservationId, deviceId });
  try {
    savePendingVoteReservationsSync();
    return { ok: true, reservationToken: issueReservationToken(key, reservationId, expiresAt) };
  } catch (err) {
    pendingVoteReservations.delete(key);
    console.error('Failed to persist pending vote reservation:', err.message);
    return { ok: false, reason: 'vote authorization unavailable' };
  }
}

function commitVoteSlot(key, reservationToken, deviceId, now = Date.now()) {
  if (!voteRegistryOperational) {
    return { ok: false, reason: 'vote registry unavailable' };
  }
  cleanupPendingVoteReservations(now);
  const tokenValidation = isValidReservationToken(reservationToken, key, now);
  if (!tokenValidation.valid) {
    return { ok: false, reason: tokenValidation.reason };
  }
  const pending = pendingVoteReservations.get(key);
  if (!pending || pending.expiresAt <= now) {
    pendingVoteReservations.delete(key);
    return { ok: false, reason: 'vote not authorized or authorization expired' };
  }
  if (pending.reservationId !== tokenValidation.parsed.reservationId) {
    return { ok: false, reason: 'vote not authorized for this reservation' };
  }
  if (pending.deviceId !== deviceId) {
    return { ok: false, reason: 'vote not authorized for this device' };
  }
  if (voteRegistry.has(key)) {
    pendingVoteReservations.delete(key);
    try {
      savePendingVoteReservationsSync();
    } catch (err) {
      console.error('Failed to persist pending vote reservation cleanup:', err.message);
    }
    return { ok: true, alreadyRecorded: true };
  }
  if (voteRegistry.size >= MAX_VOTE_REGISTRY) {
    return { ok: false, reason: 'vote registry full' };
  }
  voteRegistry.add(key);
  try {
    saveVoteRegistrySync();
  } catch (err) {
    voteRegistry.delete(key);
    return { ok: false, reason: 'vote registry persistence failed' };
  }
  pendingVoteReservations.delete(key);
  try {
    savePendingVoteReservationsSync();
  } catch (err) {
    console.error('Failed to persist pending vote reservation cleanup:', err.message);
  }
  return { ok: true, alreadyRecorded: false };
}

function validateSealedRequest(endpoint, data, schemaEndpoint = null) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, status: 400, payload: makeError(ErrorCodes.SCHEMA_INVALID, 'invalid request payload') };
  }
  if (schemaEndpoint) {
    const validation = validateHttpRequest(schemaEndpoint, data);
    if (!validation.valid) {
      return { ok: false, status: 400, payload: makeError(ErrorCodes.SCHEMA_INVALID, validation.errors) };
    }
  }
  if (!verifyContentHash(data)) {
    return { ok: false, status: 400, payload: makeError(ErrorCodes.HASH_INVALID, 'Content hash verification failed') };
  }
  if (!verifySignature(data)) {
    return { ok: false, status: 401, payload: makeError(ErrorCodes.SIGNATURE_INVALID, 'Signature verification failed') };
  }
  if (!verifyHashcashPoW({ ...data, type: endpoint })) {
    return { ok: false, status: 400, payload: makeError(ErrorCodes.POW_INVALID, 'Proof-of-work verification failed') };
  }
  const replay = replayProtector.check({ ...data, type: endpoint });
  if (!replay.fresh) {
    return { ok: false, status: 409, payload: makeError(ErrorCodes.REPLAY_DETECTED, replay.reason) };
  }
  return { ok: true };
}

function validateSealedVoteRequest(endpoint, data) {
  return validateSealedRequest(endpoint, data, endpoint);
}

function resolveRequireLoginPolicy(pollId) {
  if (!pollId) return null;
  if (!pollPolicyRegistry.has(pollId)) return null;
  const policyRecord = pollPolicyRegistry.get(pollId);
  const normalized = normalizePollPolicyRecord(policyRecord);
  return normalized ? normalized.requireLogin : null;
}

async function resolveVoteKeysForRequest(req, pollId, deviceId, voterPubkey, requireLogin) {
  if (requireLogin) {
    const user = await getSecureSession(req);
    const userSub = sanitizeId(String(user?.sub || ''), 128);
    if (!userSub) {
      return { ok: false, status: 401, reason: 'authentication required for this poll' };
    }
    const provider = sanitizeId(String(user?.provider || 'oauth'), 32) || 'oauth';
    return { ok: true, identityKey: `${pollId}:oauth:${provider}:${userSub}`, legacyKey: null };
  }

  const pub = String(voterPubkey || '').trim();
  const identityKey = pub ? `${pollId}:${pub}` : `${pollId}:${deviceId}`;
  const legacyKey = deviceId && identityKey !== `${pollId}:${deviceId}` ? `${pollId}:${deviceId}` : null;
  return { ok: true, identityKey, legacyKey };
}

function handleVoteCommit(req, res, routePath, validationEndpoint = 'vote-record') {
  parseBodyWithLimit(req, res, 4096).then(async (data) => {
    if (!data) return;
    try {
      const sealedValidation = validateSealedVoteRequest(validationEndpoint, data);
      if (!sealedValidation.ok) {
        res.writeHead(sealedValidation.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, reason: sealedValidation.payload.error?.message || 'invalid vote record request' }));
        return;
      }
      const pollId = sanitizeId(String(data.pollId || ''), 128);
      const deviceId = sanitizeId(String(data.deviceId || ''), 128);
      const reservationToken = String(data.reservationToken || '').trim();
      if (!pollId || !deviceId || !reservationToken) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, reason: 'missing or invalid pollId, deviceId, or reservationToken' }));
        return;
      }
      const voterPubkey = String(data._pub || '');
      const requireLogin = resolveRequireLoginPolicy(pollId);
      if (requireLogin == null) {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, reason: 'poll vote policy unavailable' }));
        return;
      }
      const keyResult = await resolveVoteKeysForRequest(req, pollId, deviceId, voterPubkey, requireLogin);
      if (!keyResult.ok) {
        res.writeHead(keyResult.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, reason: keyResult.reason }));
        return;
      }
      const { identityKey, legacyKey } = keyResult;
      if (voteRegistry.has(identityKey) || (legacyKey && voteRegistry.has(legacyKey))) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, alreadyRecorded: true }));
        return;
      }
      const commitResult = commitVoteSlot(identityKey, reservationToken, deviceId);
      if (!commitResult.ok) {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, reason: commitResult.reason }));
        return;
      }
      if (legacyKey && voteRegistry.size < MAX_VOTE_REGISTRY) {
        voteRegistry.add(legacyKey);
        saveVoteRegistrySync();
      }
      fs.appendFile(RECEIPT_LOG_FILE, JSON.stringify({ type: routePath.slice('/api/'.length), pollId, deviceId, timestamp: Date.now() }) + '\n', () => {});
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, alreadyRecorded: commitResult.alreadyRecorded }));
    } catch (err) {
      sendError(res, 500, 'Vote record failed', err, routePath);
    }
  });
}

const MAX_CACHED_MESSAGES = 500;
const CACHEABLE_MESSAGE_TYPES = new Set(['new-poll', 'new-event', 'new-post']);
let messageCache = [];
try {
  if (fs.existsSync(MESSAGE_CACHE_FILE)) {
    const raw = JSON.parse(fs.readFileSync(MESSAGE_CACHE_FILE, 'utf8'));
    messageCache = raw.filter((m) => {
      const messageType = typeof m?.type === 'string' ? m.type : '';
      return CACHEABLE_MESSAGE_TYPES.has(messageType) && !m._flagged && !m.data?._flagged;
    });
  }
} catch { messageCache = []; }

function cacheMessage(msg) {
  if (!msg?.type) return;
  if (msg._flagged || msg.data?._flagged) return;
  const messageType = typeof msg.type === 'string' ? msg.type : '';
  if (!CACHEABLE_MESSAGE_TYPES.has(messageType)) return;
  messageCache.push({ ...msg, _cachedAt: Date.now() });
  while (messageCache.length > MAX_CACHED_MESSAGES) messageCache.shift();
}

function saveMessageCache() {
  try { fs.writeFileSync(MESSAGE_CACHE_FILE, JSON.stringify(messageCache)); }
  catch (err) { console.error('Failed to save message cache:', err.message); }
}
setInterval(saveMessageCache, 30_000);
setInterval(saveVoteRegistry, 60_000);
setInterval(savePollPolicyRegistry, 60_000);
setInterval(() => cleanupPendingVoteReservations(), PENDING_VOTE_CLEANUP_MS);

// ─── MySQL ────────────────────────────────────────────────────────────────────
let db = null;

async function initMySQL() {
  if (!process.env.MYSQL_HOST) return;
  try {
    db = await mysql.createPool({
      host: process.env.MYSQL_HOST,
      user: process.env.MYSQL_USER,
      password: process.env.MYSQL_PASSWORD,
      database: process.env.MYSQL_DATABASE,
      port: process.env.MYSQL_PORT ? parseInt(process.env.MYSQL_PORT) : 3306,
      waitForConnections: true,
      connectionLimit: 5,
      enableKeepAlive: true,
      keepAliveInitialDelay: 10000,
      ssl: { rejectUnauthorized: false },
    });

    await db.execute(`
      CREATE TABLE IF NOT EXISTS search_index (
        id VARCHAR(100) PRIMARY KEY,
        type ENUM('post', 'poll') NOT NULL,
        title TEXT,
        content TEXT,
        author VARCHAR(200),
        community VARCHAR(100),
        created_at BIGINT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FULLTEXT idx_title_content (title, content),
        INDEX idx_author (author),
        INDEX idx_community (community),
        INDEX idx_created (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS chat_messages (
        id VARCHAR(100) PRIMARY KEY,
        room_id VARCHAR(200) NOT NULL,
        sender_id VARCHAR(100) NOT NULL,
        recipient_id VARCHAR(100) NOT NULL,
        encrypted_content TEXT NOT NULL,
        timestamp BIGINT NOT NULL,
        read_at BIGINT DEFAULT NULL,
        INDEX idx_room (room_id),
        INDEX idx_sender (sender_id),
        INDEX idx_recipient (recipient_id),
        INDEX idx_timestamp (timestamp)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS user_profiles (
        user_id VARCHAR(100) PRIMARY KEY,
        username VARCHAR(100) UNIQUE,
        display_name VARCHAR(200),
        avatar_url TEXT,
        public_key TEXT,
        last_seen BIGINT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_username (username)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS sessions (
        session_id VARCHAR(64) PRIMARY KEY,
        user_id VARCHAR(100) NOT NULL,
        ip_address VARCHAR(45),
        user_agent TEXT,
        created_at BIGINT NOT NULL,
        expires_at BIGINT NOT NULL,
        last_activity BIGINT NOT NULL,
        INDEX idx_user (user_id),
        INDEX idx_expires (expires_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    console.log('✅ MySQL connected with enhanced tables');
  } catch (err) {
    console.error('❌ MySQL failed:', err.message);
    db = null;
  }
}
await initMySQL();

async function queryMySQL(sql, params) {
  if (!db) return null;
  let conn;
  try {
    conn = await db.getConnection();
    const [rows] = await conn.query(sql, params);
    return rows;
  } catch (err) {
    console.error('❌ MySQL query error:', err.message, '| SQL:', sql.substring(0, 120), '| Params:', JSON.stringify(params));
    return null;
  } finally {
    if (conn) conn.release();
  }
}

function getHttpRateLimitContext(req, url, clientIp) {
  if (req.method !== 'GET') {
    return { bucketId: `${clientIp}:default-http`, limit: undefined };
  }
  const pathname = url.pathname;
  const isWarmupRead =
    pathname === '/api/communities' ||
    pathname === '/api/posts' ||
    pathname === '/api/polls' ||
    pathname.startsWith('/api/post/') ||
    pathname.startsWith('/api/poll/');
  return {
    bucketId: `${clientIp}:${isWarmupRead ? 'feed-read' : 'default-http'}`,
    limit: isWarmupRead ? 180 : undefined,
  };
}

function parseIdentityIssuer(identityUsername) {
  const clean = sanitizeString(identityUsername || '', 120).trim();
  const at = clean.lastIndexOf('@');
  if (at <= 0 || at >= clean.length - 1) return '';
  return clean.slice(at + 1).toLowerCase();
}

function getEmailIssuer(user) {
  const email = sanitizeString(user?.email || '', 200).trim().toLowerCase();
  const at = email.lastIndexOf('@');
  if (at <= 0 || at >= email.length - 1) return '';
  return email.slice(at + 1);
}

function resolveWsIdentityTier(sessionUser, identityUsername) {
  const claimedIssuer = parseIdentityIssuer(identityUsername);
  if (!claimedIssuer || !TRUST_ISSUER_DOMAINS.has(claimedIssuer)) return 'unverified';
  const emailIssuer = getEmailIssuer(sessionUser);
  if (!emailIssuer) return 'unverified';
  return emailIssuer === claimedIssuer ? 'trusted-issuer' : 'unverified';
}

// ─── Search ───────────────────────────────────────────────────────────────────
async function indexContent(type, id, data) {
  if (!db) return;
  try {
    const title = type === 'post' ? data.title : data.question;
    const content = type === 'post' ? data.content : data.description;
    await db.execute(
      `INSERT INTO search_index (id, type, title, content, author, community, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         title = VALUES(title), content = VALUES(content),
         author = VALUES(author), updated_at = NOW()`,
      [id, type, title, content || '', data.authorName || 'Anonymous', data.communitySlug || '', data.createdAt || Date.now()]
    );
  } catch (err) {
    console.error('❌ Indexing error:', err.message);
  }
}

async function searchContent(query, filters = {}) {
  if (!db) return { results: [], total: 0 };
  try {
    const limit  = Math.min(Math.max(1, parseInt(filters.limit  || '20') || 20), 100);
    const offset = Math.max(0, parseInt(filters.offset || '0') || 0);
    let sql, params, countSql, countParams;
    if (query.length >= 4) {
      const booleanQuery = query.trim().split(/\s+/).slice(0, 20).map(w => `+${w.replace(/[+\-><()~*"@]/g, '')}*`).join(' ');
      sql    = `SELECT id, type, title, content, author, community, created_at, MATCH(title, content) AGAINST(? IN BOOLEAN MODE) as relevance FROM search_index WHERE MATCH(title, content) AGAINST(? IN BOOLEAN MODE)`;
      params = [booleanQuery, booleanQuery];
      countSql    = `SELECT COUNT(*) as total FROM search_index WHERE MATCH(title, content) AGAINST(? IN BOOLEAN MODE)`;
      countParams = [booleanQuery];
    } else {
      const like = `%${query.replace(/[%_\\]/g, '\\$&')}%`;
      sql    = `SELECT id, type, title, content, author, community, created_at, 1 as relevance FROM search_index WHERE title LIKE ? OR content LIKE ? OR author LIKE ?`;
      params = [like, like, like];
      countSql    = `SELECT COUNT(*) as total FROM search_index WHERE title LIKE ? OR content LIKE ? OR author LIKE ?`;
      countParams = [like, like, like];
    }
    if (filters.type)      { sql += ' AND type = ?';      params.push(filters.type);      countSql += ' AND type = ?';      countParams.push(filters.type); }
    if (filters.community) { sql += ' AND community = ?'; params.push(filters.community); countSql += ' AND community = ?'; countParams.push(filters.community); }
    sql += ` ORDER BY relevance DESC, created_at DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);
    const results     = await queryMySQL(sql, params);
    const countResult = await queryMySQL(countSql, countParams);
    return { results: results || [], total: countResult?.[0]?.total || 0 };
  } catch (err) {
    console.error('❌ Search error:', err.message);
    return { results: [], total: 0 };
  }
}

// ─── Auth & Security ──────────────────────────────────────────────────────────
function generateSecureToken(bytes = 32) { return crypto.randomBytes(bytes).toString('base64url'); }

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
  const cookie = req.headers['cookie'] || '';
  const found = cookie.split(';').find((c) => c.trim().startsWith(`${name}=`));
  return found ? found.split('=')[1] : null;
}

function setOauthStateCookie(res, nonce) {
  appendSetCookie(res, `${OAUTH_STATE_COOKIE}=${nonce}; HttpOnly; Path=/; SameSite=Lax; Secure; Max-Age=600`);
}

function clearOauthStateCookie(res) {
  appendSetCookie(res, `${OAUTH_STATE_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Secure; Max-Age=0`);
}

function createJWT(payload, expiresIn = '7d') {
  const header  = { alg: 'HS256', typ: 'JWT' };
  const exp     = Date.now() + (expiresIn === '7d' ? 7 * 24 * 60 * 60 * 1000 : 60 * 60 * 1000);
  const claims  = { ...payload, exp, iat: Date.now() };
  const enc     = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const sig     = crypto.createHmac('sha256', JWT_SECRET).update(`${enc(header)}.${enc(claims)}`).digest('base64url');
  return `${enc(header)}.${enc(claims)}.${sig}`;
}

function verifyJWT(token) {
  try {
    if (typeof token !== 'string' || !token.trim()) return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, payload, signature] = parts;
    const headerJson = JSON.parse(Buffer.from(header, 'base64url').toString());
    if (!headerJson || typeof headerJson !== 'object' || Array.isArray(headerJson)) return null;
    if (headerJson.alg !== 'HS256' || headerJson.typ !== 'JWT') return null;
    const valid = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest('base64url');
    const validBuf = Buffer.from(valid, 'utf8');
    const sigBuf = Buffer.from(signature, 'utf8');
    if (validBuf.length !== sigBuf.length || !crypto.timingSafeEqual(validBuf, sigBuf)) return null;
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (!claims || typeof claims !== 'object' || Array.isArray(claims)) return null;
    if (typeof claims.sub !== 'string' || !claims.sub.trim()) return null;
    if (typeof claims.provider !== 'string' || !claims.provider.trim()) return null;
    if (typeof claims.exp !== 'number' || !Number.isFinite(claims.exp)) return null;
    if (claims.exp < Date.now()) return null;
    if (typeof claims.iat !== 'number' || !Number.isFinite(claims.iat)) return null;
    return claims;
  } catch { return null; }
}

async function setSecureSession(res, req, user) {
  const sessionId = generateSecureToken(32);
  const expiresAt = Date.now() + (7 * 24 * 60 * 60 * 1000);
  const sessionData = {
    user,
    ip: req.socket.remoteAddress,
    userAgent: req.headers['user-agent'],
    createdAt: Date.now(),
    expiresAt,
  };
  sessions.set(sessionId, sessionData);
  if (db) {
    await db.execute(
      `INSERT INTO sessions (session_id, user_id, ip_address, user_agent, created_at, expires_at, last_activity) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [sessionId, user.sub, sessionData.ip, sessionData.userAgent, Date.now(), expiresAt, Date.now()]
    );
  }
  const jwt = createJWT({
    sub: user.sub,
    email: user.email,
    provider: sanitizeId(String(user?.provider || 'oauth'), 32) || 'oauth',
  });
  appendSetCookie(res, `sessionId=${sessionId}; HttpOnly; Path=/; SameSite=None; Secure; Max-Age=604800`);
  appendSetCookie(res, `jwt=${jwt}; HttpOnly; Path=/; SameSite=None; Secure; Max-Age=604800`);
  return { sessionId, jwt };
}

async function getSecureSession(req) {
  const sid = getCookie(req, 'sessionId');
  const jwt = getCookie(req, 'jwt');
  if (!sid || !jwt) return null;
  const claims = verifyJWT(jwt);
  if (!claims) return null;
  const sessionData = sessions.get(sid);
  if (!sessionData) return null;
  if (sessionData.expiresAt <= Date.now()) {
    sessions.delete(sid);
    if (db) await db.execute(`DELETE FROM sessions WHERE session_id = ?`, [sid]);
    return null;
  }
  if (claims.sub !== sessionData.user?.sub) return null;
  if ((claims.provider || '') !== String(sessionData.user?.provider || '')) return null;
  if (claims.email && sessionData.user?.email && claims.email !== sessionData.user.email) return null;
  if (db) await db.execute(`UPDATE sessions SET last_activity = ? WHERE session_id = ?`, [Date.now(), sid]);
  return sessionData.user;
}

// ─── P2P Chat ─────────────────────────────────────────────────────────────────
function getChatRoomId(u1, u2) { return [u1, u2].sort().join(':'); }

async function storeChatMessage(roomId, senderId, recipientId, encryptedContent) {
  if (!db) return;
  try {
    const messageId = `msg-${Date.now()}-${generateSecureToken(8)}`;
    await db.execute(
      `INSERT INTO chat_messages (id, room_id, sender_id, recipient_id, encrypted_content, timestamp) VALUES (?, ?, ?, ?, ?, ?)`,
      [messageId, roomId, senderId, recipientId, encryptedContent, Date.now()]
    );
    return messageId;
  } catch (err) { console.error('❌ Chat storage error:', err.message); }
}

async function getChatHistory(roomId, limit = 50) {
  if (!db) return [];
  try {
    const messages = await queryMySQL(
      `SELECT id, sender_id, recipient_id, encrypted_content, timestamp, read_at FROM chat_messages WHERE room_id = ? ORDER BY timestamp DESC LIMIT ?`,
      [roomId, limit]
    );
    return (messages || []).reverse();
  } catch { return []; }
}

async function markMessagesAsRead(roomId, userId) {
  if (!db) return;
  try {
    await db.execute(
      `UPDATE chat_messages SET read_at = ? WHERE room_id = ? AND recipient_id = ? AND read_at IS NULL`,
      [Date.now(), roomId, userId]
    );
  } catch (err) { console.error('❌ Mark read error:', err.message); }
}

// ─── OAuth helpers ────────────────────────────────────────────────────────────
function postForm(urlString, data) {
  return new Promise((resolve, reject) => {
    const url  = new URL(urlString);
    const body = new URLSearchParams(data).toString();
    const req  = https.request({
      method: 'POST', hostname: url.hostname, path: url.pathname + url.search,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let chunks = '';
      res.on('data', d => chunks += d.toString());
      res.on('end', () => { try { resolve(JSON.parse(chunks || '{}')); } catch (e) { reject(e); } });
    });
    req.on('error', reject); req.write(body); req.end();
  });
}

function getJson(urlString, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const req = https.request({ method: 'GET', hostname: url.hostname, path: url.pathname + url.search, headers }, (res) => {
      let chunks = '';
      res.on('data', d => chunks += d.toString());
      res.on('end', () => { try { resolve(JSON.parse(chunks || '{}')); } catch (e) { reject(e); } });
    });
    req.on('error', reject); req.end();
  });
}

// ─── Bot Detection ────────────────────────────────────────────────────────────
const BOT_UA = /googlebot|bingbot|yandex|baiduspider|facebookexternalhit|twitterbot|linkedinbot|whatsapp|telegrambot|discordbot|slackbot|applebot|rogerbot|embedly|quora|pinterest|vkshare|w3c_validator/i;
function isBot(req) { return BOT_UA.test(req.headers['user-agent'] || ''); }

// ─── SSR Helpers ──────────────────────────────────────────────────────────────
const ssrCache = new Map();
const SSR_CACHE_MAX = 10000;

function ssrCacheSet(key, value) {
  if (ssrCache.size >= SSR_CACHE_MAX) {
    const oldest = ssrCache.keys().next().value;
    ssrCache.delete(oldest);
  }
  ssrCache.set(key, value);
}
const SSR_CACHE_TTL = 3_600_000;

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function buildHtmlShell(head, initData = '') {
  const ASSET_JS  = process.env.ASSET_JS  || '/assets2/index.js';
  const ASSET_CSS = process.env.ASSET_CSS || '/assets2/index.css';
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    ${head}
    <link rel="stylesheet" crossorigin href="${DOMAIN}${ASSET_CSS}">
  </head>
  <body>
    <div id="app"${initData}></div>
    <script type="module" crossorigin src="${DOMAIN}${ASSET_JS}"></script>
  </body>
</html>`;
}

function generatePostHTML(post) {
  const desc     = escapeHtml((post.content || '').replace(/\n/g, ' ').slice(0, 160));
  const title    = escapeHtml(post.title);
  const imageUrl = post.imageIPFS ? `https://ipfs.io/ipfs/${post.imageIPFS}` : `${DOMAIN}/og-default.png`;
  const postUrl  = `${DOMAIN}/community/${post.communityId || 'general'}/post/${post.id}`;
  return buildHtmlShell(`
    <title>${title} — Interpoll</title>
    <meta name="description" content="${desc}" />
    <meta name="robots" content="index, follow" />
    <link rel="canonical" href="${postUrl}" />
    <meta property="og:type" content="article" />
    <meta property="og:site_name" content="Interpoll" />
    <meta property="og:title" content="${title}" />
    <meta property="og:description" content="${desc}" />
    <meta property="og:image" content="${imageUrl}" />
    <meta property="og:url" content="${postUrl}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${title}" />
    <meta name="twitter:description" content="${desc}" />
    <meta name="twitter:image" content="${imageUrl}" />
    <meta property="article:author" content="${escapeHtml(post.authorName)}" />
    <meta property="article:published_time" content="${new Date(post.createdAt).toISOString()}" />`,
    ` data-initial-post-id="${escapeHtml(post.id)}"`
  );
}

function generatePollHTML(poll) {
  const desc     = escapeHtml((poll.description || `Vote now: ${poll.question}`).slice(0, 160));
  const question = escapeHtml(poll.question);
  const pollUrl  = `${DOMAIN}/community/${poll.communityId || 'general'}/poll/${poll.id}`;
  return buildHtmlShell(`
    <title>${question} — Interpoll</title>
    <meta name="description" content="${desc}" />
    <meta name="robots" content="index, follow" />
    <link rel="canonical" href="${pollUrl}" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="Interpoll" />
    <meta property="og:title" content="${question}" />
    <meta property="og:description" content="${desc}" />
    <meta property="og:url" content="${pollUrl}" />
    <meta name="twitter:card" content="summary" />
    <meta name="twitter:title" content="${question}" />
    <meta name="twitter:description" content="${desc}" />`,
    ` data-initial-poll-id="${escapeHtml(poll.id)}"`
  );
}

async function fetchPostFromDB(postId) {
  const escaped = postId.replace(/[%_\\]/g, '\\$&');
  const rows = await queryMySQL(
    `SELECT soul, data FROM gun_nodes WHERE soul LIKE ? ESCAPE ? OR soul LIKE ? ESCAPE ? OR soul = ? OR soul = ? LIMIT 10`,
    [`v2/%/posts/${escaped}`, '\\', `communities/%/posts/${escaped}`, '\\', `v2/posts/${postId}`, `posts/${postId}`]
  );
  if (!rows) return null;
  for (const row of rows) {
    try {
      const d = JSON.parse(row.data);
      if (d?.title) return { id: d.id || postId, communityId: d.communityId || '', authorName: d.authorName || 'Anonymous', title: d.title, content: d.content || '', imageIPFS: d.imageIPFS || '', createdAt: d.createdAt || Date.now() };
    } catch {}
  }
  return null;
}

async function fetchPollFromDB(pollId) {
  const escaped = pollId.replace(/[%_\\]/g, '\\$&');
  const rows = await queryMySQL(
    `SELECT soul, data FROM gun_nodes WHERE soul LIKE ? ESCAPE ? OR soul LIKE ? ESCAPE ? OR soul = ? OR soul = ? LIMIT 10`,
    [`v2/%/polls/${escaped}`, '\\', `communities/%/polls/${escaped}`, '\\', `v2/polls/${pollId}`, `polls/${pollId}`]
  );
  if (!rows) return null;
  for (const row of rows) {
    try {
      const d = JSON.parse(row.data);
      if (d?.question) return { id: d.id || pollId, communityId: d.communityId || '', authorName: d.authorName || 'Anonymous', question: d.question, description: d.description || '', totalVotes: d.totalVotes || 0, createdAt: d.createdAt || Date.now() };
    } catch {}
  }
  return null;
}

async function fetchPollPolicyOwnerRecord(pollId) {
  if (!db || !pollId) return null;
  const escaped = pollId.replace(/[%_\\]/g, '\\$&');
  const rows = await queryMySQL(
    `SELECT data FROM gun_nodes
     WHERE soul LIKE ? ESCAPE ? OR soul LIKE ? ESCAPE ? OR soul = ? OR soul = ?
     LIMIT 10`,
    [`v2/communities/%/polls/${escaped}`, '\\', `communities/%/polls/${escaped}`, '\\', `v2/polls/${pollId}`, `polls/${pollId}`]
  );
  for (const row of rows || []) {
    try {
      const d = JSON.parse(row.data);
      if (!d?.id || String(d.id) !== pollId) continue;
      const authorPubkey = sanitizeId(String(d.authorPubkey || ''), 130);
      const authorId = sanitizeId(String(d.authorId || ''), 128);
      if (authorPubkey) {
        return { authorPubkey, authorId };
      }
    } catch {}
  }
  return null;
}

// ─── Sitemap ──────────────────────────────────────────────────────────────────
async function generateSitemap() {
  try {
    const now = new Date().toISOString().split('T')[0];
    let xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${DOMAIN}/</loc><changefreq>hourly</changefreq><priority>1.0</priority></url>
  <url><loc>${DOMAIN}/search</loc><changefreq>daily</changefreq><priority>0.8</priority></url>\n`;

    const commRows = await queryMySQL(`SELECT data FROM gun_nodes WHERE soul REGEXP '^(v2/communities|communities)/c-[^/]+$' LIMIT 500`, []);
    for (const row of commRows || []) {
      try {
        const d = JSON.parse(row.data);
        if (!d?.id || !d?.displayName) continue;
        const lastmod = d.createdAt ? new Date(d.createdAt).toISOString().split('T')[0] : now;
        xml += `  <url><loc>${DOMAIN}/community/${d.id}</loc><lastmod>${lastmod}</lastmod><changefreq>daily</changefreq><priority>0.8</priority></url>\n`;
      } catch {}
    }

    const postRows = await queryMySQL(`SELECT data FROM gun_nodes WHERE soul REGEXP '^(v2/communities|communities)/[^/]+/posts/post-[^/]+$' ORDER BY JSON_EXTRACT(data, '$.createdAt') DESC LIMIT 2000`, []);
    const seenPosts = new Set();
    for (const row of postRows || []) {
      try {
        const d = JSON.parse(row.data);
        if (!d?.id || !d?.title || !d?.communityId || seenPosts.has(d.id)) continue;
        seenPosts.add(d.id);
        const lastmod = d.createdAt ? new Date(d.createdAt).toISOString().split('T')[0] : now;
        xml += `  <url><loc>${DOMAIN}/community/${d.communityId}/post/${d.id}</loc><lastmod>${lastmod}</lastmod><changefreq>weekly</changefreq><priority>0.7</priority></url>\n`;
      } catch {}
    }

    const pollRows = await queryMySQL(
      `SELECT data FROM gun_nodes
       WHERE (soul REGEXP '^(v2/communities|communities)/[^/]+/polls/poll-[^/]+$' OR soul REGEXP '^(v2/polls|polls)/poll-[^/]+$')
         AND soul NOT REGEXP '/options'
         AND soul NOT REGEXP '/inviteCodes'
       ORDER BY JSON_EXTRACT(data, '$.createdAt') DESC LIMIT 1000`, []
    );
    const seenPolls = new Set();
    for (const row of pollRows || []) {
      try {
        const d = JSON.parse(row.data);
        if (!d?.id || !d?.question || !d?.communityId || d?.isPrivate || seenPolls.has(d.id)) continue;
        seenPolls.add(d.id);
        const lastmod = d.createdAt ? new Date(d.createdAt).toISOString().split('T')[0] : now;
        xml += `  <url><loc>${DOMAIN}/community/${d.communityId}/poll/${d.id}</loc><lastmod>${lastmod}</lastmod><changefreq>weekly</changefreq><priority>0.7</priority></url>\n`;
      } catch {}
    }

    xml += `</urlset>`;
    return xml;
  } catch (err) {
    console.error('Sitemap error:', err.message);
    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>`;
  }
}

// ─── HTTP Routes ──────────────────────────────────────────────────────────────
server.on('request', async (req, res) => {
  // ─── Security headers & CORS ────────────────────────────────────────────
  setSecurityHeaders(res);
  setCorsHeaders(req, res);

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  if (!req.url) { res.writeHead(400); res.end('Bad request'); return; }

  // ─── CORS origin check for mutating requests ───────────────────────────
  if ((req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE') && !isOriginAllowed(req)) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Origin not allowed' }));
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  // ─── HTTP rate limiting ─────────────────────────────────────────────────
  const clientIp = req.socket.remoteAddress || 'unknown';
  const httpRateLimit = getHttpRateLimitContext(req, url, clientIp);
  const httpCheck = rateLimiter.checkHttp(httpRateLimit.bucketId, httpRateLimit.limit);
  if (!httpCheck.allowed) {
    res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': String(Math.ceil(httpCheck.retryAfter / 1000)) });
    res.end(JSON.stringify({ error: 'Too many requests', retryAfter: httpCheck.retryAfter }));
    return;
  }

  // ── SSR Routes (bots only) ────────────────────────────────────────────────
  if (req.method === 'GET' && url.pathname.startsWith('/post/')) {
    const postId = sanitizeId(url.pathname.split('/')[2], 128);
    if (!postId) { res.writeHead(404); res.end('Not found'); return; }
    if (!isBot(req)) { res.writeHead(302, { Location: `${DOMAIN}/post/${postId}` }); res.end(); return; }
    const cached = ssrCache.get(`post:${postId}`);
    if (cached && Date.now() - cached.ts < SSR_CACHE_TTL) { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.setHeader('Cache-Control', 'public, max-age=3600'); res.end(cached.html); return; }
    const post = await fetchPostFromDB(postId);
    if (!post) { res.writeHead(404); res.end('Post not found'); return; }
    const html = generatePostHTML(post);
    ssrCacheSet(`post:${postId}`, { html, ts: Date.now() });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400');
    res.end(html); return;
  }

  if (req.method === 'GET' && url.pathname.startsWith('/vote/')) {
    const pollId = sanitizeId(url.pathname.split('/')[2], 128);
    if (!pollId) { res.writeHead(404); res.end('Not found'); return; }
    if (!isBot(req)) { res.writeHead(302, { Location: `${DOMAIN}/vote/${pollId}` }); res.end(); return; }
    const cached = ssrCache.get(`poll:${pollId}`);
    if (cached && Date.now() - cached.ts < SSR_CACHE_TTL) { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.setHeader('Cache-Control', 'public, max-age=3600'); res.end(cached.html); return; }
    const poll = await fetchPollFromDB(pollId);
    if (!poll) { res.writeHead(404); res.end('Poll not found'); return; }
    const html = generatePollHTML(poll);
    ssrCacheSet(`poll:${pollId}`, { html, ts: Date.now() });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400');
    res.end(html); return;
  }

  if (req.method === 'GET' && url.pathname.startsWith('/community/')) {
    const parts = url.pathname.split('/');
    const communityId = sanitizeId(parts[2], 128);
    const subtype = parts[3];
    const itemId = sanitizeId(parts[4], 128);
    if (!communityId) { res.writeHead(404); res.end('Not found'); return; }
    if (!isBot(req)) { res.writeHead(302, { Location: `${DOMAIN}/community/${communityId}${subtype ? '/' + (sanitizeId(subtype, 20) || '') : ''}${itemId ? '/' + itemId : ''}` }); res.end(); return; }

    if (subtype === 'post' && itemId) {
      const cached = ssrCache.get(`post:${itemId}`);
      if (cached && Date.now() - cached.ts < SSR_CACHE_TTL) { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(cached.html); return; }
      const post = await fetchPostFromDB(itemId);
      if (!post) { res.writeHead(404); res.end('Post not found'); return; }
      const html = generatePostHTML(post);
      ssrCacheSet(`post:${itemId}`, { html, ts: Date.now() });
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400');
      res.end(html); return;
    }

    if ((subtype === 'poll' || subtype === 'vote') && itemId) {
      const cached = ssrCache.get(`poll:${itemId}`);
      if (cached && Date.now() - cached.ts < SSR_CACHE_TTL) { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(cached.html); return; }
      const poll = await fetchPollFromDB(itemId);
      if (!poll) { res.writeHead(404); res.end('Poll not found'); return; }
      const html = generatePollHTML(poll);
      ssrCacheSet(`poll:${itemId}`, { html, ts: Date.now() });
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400');
      res.end(html); return;
    }

    const commRows = await queryMySQL(`SELECT data FROM gun_nodes WHERE soul = ? OR soul = ? LIMIT 1`, [`v2/communities/${communityId}`, `communities/${communityId}`]);
    let commHtml = '';
    if (commRows?.length) {
      try {
        const d = JSON.parse(commRows[0].data);
        const name = escapeHtml(d.displayName || communityId);
        const desc = escapeHtml((d.description || '').slice(0, 160));
        const commUrl = `${DOMAIN}/community/${communityId}`;
        commHtml = buildHtmlShell(`<title>${name} — Interpoll</title><meta name="description" content="${desc}" /><meta name="robots" content="index, follow" /><link rel="canonical" href="${commUrl}" /><meta property="og:title" content="${name}" /><meta property="og:description" content="${desc}" /><meta property="og:url" content="${commUrl}" /><meta property="og:type" content="website" />`);
      } catch {}
    }
    if (!commHtml) commHtml = buildHtmlShell(`<title>Community — Interpoll</title>`);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=1800');
    res.end(commHtml); return;
  }

  // ── Search API ────────────────────────────────────────────────────────────
  if (req.method === 'GET' && url.pathname === '/api/search') {
    const query = url.searchParams.get('q');
    if (!query || query.length < 2) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Query must be at least 2 characters' })); return; }
    const sanitizedQuery = validateSearchQuery(query, 200);
    if (!sanitizedQuery) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(makeError(ErrorCodes.SCHEMA_INVALID, 'Invalid search query')));
      return;
    }
    const filters = { type: url.searchParams.get('type'), community: url.searchParams.get('community'), limit: url.searchParams.get('limit'), offset: url.searchParams.get('offset') };
    const results = await searchContent(sanitizedQuery, filters);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(results)); return;
  }

  // ── Index content (requires API_INDEX_SECRET) ──────────────────────────
  if (req.method === 'POST' && url.pathname === '/api/index') {
    if (!requireSecret(req, res, 'API_INDEX_SECRET')) return;
    parseBodyWithLimit(req, res, 51200).then(async (body) => {
      if (!body) return;
      try {
        const idxValidation = validateHttpRequest('index', body);
        if (!idxValidation.valid) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(makeError(ErrorCodes.SCHEMA_INVALID, idxValidation.errors)));
          return;
        }
        const { type, id, data } = body;
        if (!type || !id || !data) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Missing required fields' })); return; }
        if (!['post', 'poll'].includes(type)) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Invalid type' })); return; }
        await indexContent(type, id, data);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) { sendError(res, 500, 'Indexing failed', err, '/api/index'); }
    }); return;
  }

  // ── Chat History ──────────────────────────────────────────────────────────
  if (req.method === 'GET' && url.pathname === '/api/chat/history') {
    const user = await getSecureSession(req);
    if (!user) { res.writeHead(401); res.end('Unauthorized'); return; }
    const otherUserId = sanitizeId(url.searchParams.get('userId'), 128);
    if (!otherUserId) { res.writeHead(400); res.end('Invalid userId'); return; }
    const roomId = getChatRoomId(user.sub, otherUserId);
    const messages = await getChatHistory(roomId, 100);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ messages })); return;
  }

  // ── Mark messages as read ─────────────────────────────────────────────────
  if (req.method === 'POST' && url.pathname === '/api/chat/mark-read') {
    const user = await getSecureSession(req);
    if (!user) { res.writeHead(401); res.end('Unauthorized'); return; }
    parseBodyWithLimit(req, res, 4096).then(async (data) => {
      if (!data) return;
      try {
        const otherUserId = sanitizeId(data.otherUserId, 128);
        if (!otherUserId) { res.writeHead(400); res.end('Invalid userId'); return; }
        const roomId = getChatRoomId(user.sub, otherUserId);
        await markMessagesAsRead(roomId, user.sub);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch { sendError(res, 500, 'Error', null, '/api/chat/mark-read'); }
    }); return;
  }

  // ── Sitemap ───────────────────────────────────────────────────────────────
  if (req.method === 'GET' && url.pathname === '/sitemap.xml') {
    res.setHeader('Content-Type', 'application/xml');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.end(await generateSitemap()); return;
  }

  // ── Robots ────────────────────────────────────────────────────────────────
  if (req.method === 'GET' && url.pathname === '/robots.txt') {
    res.setHeader('Content-Type', 'text/plain');
    res.end(`User-agent: *\nAllow: /\nDisallow: /auth/\nDisallow: /api/\nSitemap: ${DOMAIN}/sitemap.xml\n`); return;
  }

  // ── Health ────────────────────────────────────────────────────────────────
  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', uptime: process.uptime(), clients: clients.size, activeChatRooms: activeChatSessions.size, cachedMessages: messageCache.length, mysql: !!db, ssrCacheSize: ssrCache.size })); return;
  }

  // ── Google OAuth ──────────────────────────────────────────────────────────
  if (req.method === 'GET' && url.pathname === '/auth/google/start') {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const redirectUri = `${process.env.SERVER_ORIGIN || `http://localhost:${PORT}`}/auth/google/callback`;
    if (!clientId) { res.writeHead(500); res.end('Google OAuth not configured'); return; }
    const state = generateSecureToken(16);
    const stateNonce = generateSecureToken(16);
    oauthStates.set(state, { provider: 'google', createdAt: Date.now(), nonce: stateNonce });
    setOauthStateCookie(res, stateNonce);
    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', 'openid profile email');
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('access_type', 'offline');
    res.writeHead(302, { Location: authUrl.toString() }); res.end(); return;
  }

  if (req.method === 'GET' && url.pathname === '/auth/google/callback') {
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const oauthState = state ? oauthStates.get(state) : null;
    const cookieNonce = getCookie(req, OAUTH_STATE_COOKIE);
    if (!code || !state || !oauthState || oauthState.provider !== 'google' || !cookieNonce || oauthState.nonce !== cookieNonce) {
      res.writeHead(400); res.end('Invalid OAuth state'); return;
    }
    oauthStates.delete(state);
    clearOauthStateCookie(res);
    const redirectUri = `${process.env.SERVER_ORIGIN || `http://localhost:${PORT}`}/auth/google/callback`;
    postForm('https://oauth2.googleapis.com/token', { code, client_id: process.env.GOOGLE_CLIENT_ID || '', client_secret: process.env.GOOGLE_CLIENT_SECRET || '', redirect_uri: redirectUri, grant_type: 'authorization_code' })
      .then(async (tokenResponse) => {
        if (!tokenResponse.access_token) throw new Error('No access_token from Google');
        return getJson('https://openidconnect.googleapis.com/v1/userinfo', { Authorization: `Bearer ${tokenResponse.access_token}` })
          .then(async (profile) => {
            if (!profile || !profile.sub) throw new Error('No userinfo from Google');
            const user = { provider: 'google', sub: profile.sub, email: profile.email, name: profile.name || profile.email, picture: profile.picture || null };
            await setSecureSession(res, req, user);
            res.writeHead(302, { Location: `${FRONTEND_ORIGIN}/auth/callback` }); res.end();
          });
      }).catch(err => { console.error('Google OAuth error:', err); res.writeHead(500); res.end('Google OAuth failed'); });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/auth/microsoft/start') {
    const clientId = process.env.MS_CLIENT_ID;
    const tenant = process.env.MS_TENANT || 'common';
    const redirectUri = `${process.env.SERVER_ORIGIN || `http://localhost:${PORT}`}/auth/microsoft/callback`;
    if (!clientId) { res.writeHead(500); res.end('Microsoft OAuth not configured'); return; }
    const state = generateSecureToken(16);
    const stateNonce = generateSecureToken(16);
    oauthStates.set(state, { provider: 'microsoft', createdAt: Date.now(), nonce: stateNonce });
    setOauthStateCookie(res, stateNonce);
    const authUrl = new URL(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`);
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('response_mode', 'query');
    authUrl.searchParams.set('scope', process.env.MS_SCOPES || 'openid profile email');
    authUrl.searchParams.set('state', state);
    res.writeHead(302, { Location: authUrl.toString() }); res.end(); return;
  }

  if (req.method === 'GET' && url.pathname === '/auth/microsoft/callback') {
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const oauthState = state ? oauthStates.get(state) : null;
    const cookieNonce = getCookie(req, OAUTH_STATE_COOKIE);
    if (!code || !state || !oauthState || oauthState.provider !== 'microsoft' || !cookieNonce || oauthState.nonce !== cookieNonce) {
      res.writeHead(400); res.end('Invalid OAuth state'); return;
    }
    oauthStates.delete(state);
    clearOauthStateCookie(res);
    const tenant = process.env.MS_TENANT || 'common';
    const redirectUri = `${process.env.SERVER_ORIGIN || `http://localhost:${PORT}`}/auth/microsoft/callback`;
    postForm(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, { client_id: process.env.MS_CLIENT_ID || '', client_secret: process.env.MS_CLIENT_SECRET || '', scope: process.env.MS_SCOPES || 'openid profile email', code, redirect_uri: redirectUri, grant_type: 'authorization_code' })
      .then(async (tokenResponse) => {
        if (!tokenResponse.access_token) throw new Error('No access_token from Microsoft');
        return getJson('https://graph.microsoft.com/oidc/userinfo', { Authorization: `Bearer ${tokenResponse.access_token}` })
          .then(async (profile) => {
            if (!profile || !profile.sub) throw new Error('No userinfo from Microsoft');
            const user = {
              provider: 'microsoft',
              sub: profile.sub,
              email: profile.email || profile.preferred_username,
              name: profile.name || profile.preferred_username || profile.email,
            };
            await setSecureSession(res, req, user);
            res.writeHead(302, { Location: `${FRONTEND_ORIGIN}/auth/callback` }); res.end();
          });
      }).catch(err => { console.error('Microsoft OAuth error:', err); res.writeHead(500); res.end('Microsoft OAuth failed'); });
    return;
  }

  // ── Session ───────────────────────────────────────────────────────────────
  if (req.method === 'GET' && url.pathname === '/api/me') {
    const user = await getSecureSession(req);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ user: user || null })); return;
  }

  if (req.method === 'POST' && url.pathname === '/auth/logout') {
    const cookie = req.headers['cookie'] || '';
    const sid = cookie.split(';').find(c => c.trim().startsWith('sessionId='))?.split('=')[1];
    if (sid) { sessions.delete(sid); if (db) await db.execute(`DELETE FROM sessions WHERE session_id = ?`, [sid]); }
    res.setHeader('Set-Cookie', ['sessionId=; HttpOnly; Path=/; SameSite=None; Secure; Max-Age=0', 'jwt=; HttpOnly; Path=/; SameSite=None; Secure; Max-Age=0']);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true })); return;
  }

  if (req.method === 'POST' && url.pathname === '/api/poll-policy') {
    parseBodyWithLimit(req, res, 4096).then(async (data) => {
      if (!data) return;
      try {
        const sealedValidation = validateSealedRequest('poll-policy', data);
        if (!sealedValidation.ok) {
          res.writeHead(sealedValidation.status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, reason: sealedValidation.payload.error?.message || 'invalid poll policy request' }));
          return;
        }
        const pollId = sanitizeId(String(data.pollId || ''), 128);
        if (!pollId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, reason: 'missing or invalid pollId' }));
          return;
        }
        if (typeof data.requireLogin !== 'boolean') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, reason: 'requireLogin must be a boolean' }));
          return;
        }
        const ownerPubkey = sanitizeId(String(data._pub || ''), 130);
        if (!ownerPubkey) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, reason: 'missing signer public key' }));
          return;
        }
        const user = await getSecureSession(req);
        const ownerProvider = sanitizeId(String(user?.provider || ''), 32);
        const ownerSub = sanitizeId(String(user?.sub || ''), 128);

        if (data.requireLogin && !ownerSub) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, reason: 'authentication required to register login-gated poll policy' }));
          return;
        }

        const existing = normalizePollPolicyRecord(pollPolicyRegistry.get(pollId));
        const needsOwnerBootstrap = !existing || !existing.ownerPubkey;
        let ownerRecord = null;
        if (needsOwnerBootstrap) {
          ownerRecord = await fetchPollPolicyOwnerRecord(pollId);
          if (!ownerRecord) {
            res.writeHead(409, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, reason: 'poll owner proof unavailable' }));
            return;
          }
          if (ownerRecord.authorPubkey !== ownerPubkey) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, reason: 'poll policy owner mismatch' }));
            return;
          }
        }
        if (existing && existing.requireLogin !== data.requireLogin) {
          res.writeHead(409, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, reason: 'poll vote policy mismatch' }));
          return;
        }
        if (existing && existing.ownerPubkey && existing.ownerPubkey !== ownerPubkey) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, reason: 'poll policy owner mismatch' }));
          return;
        }
        if (existing && existing.ownerSub && !ownerSub) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, reason: 'authentication required for poll policy owner' }));
          return;
        }
        if (existing && existing.ownerSub && ownerSub && existing.ownerSub !== ownerSub) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, reason: 'poll policy owner mismatch' }));
          return;
        }
        pollPolicyRegistry.set(pollId, {
          requireLogin: data.requireLogin,
          ownerPubkey: existing?.ownerPubkey || ownerRecord?.authorPubkey || ownerPubkey,
          ownerProvider: existing?.ownerProvider || ownerProvider,
          ownerSub: existing?.ownerSub || ownerSub,
        });
        savePollPolicyRegistrySync();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, pollId, requireLogin: data.requireLogin }));
      } catch (err) {
        sendError(res, 500, 'Poll policy registration failed', err, '/api/poll-policy');
      }
    }); return;
  }

  // ── Vote protection ───────────────────────────────────────────────────────
  if (req.method === 'POST' && url.pathname === '/api/vote-authorize') {
    parseBodyWithLimit(req, res, 4096).then(async (data) => {
      if (!data) return;
      try {
        const sealedValidation = validateSealedVoteRequest('vote-authorize', data);
        if (!sealedValidation.ok) {
          res.writeHead(sealedValidation.status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ allowed: false, reason: sealedValidation.payload.error?.message || 'invalid vote authorization request' }));
          return;
        }
        const pollId = sanitizeId(String(data.pollId || ''), 128);
        const deviceId = sanitizeId(String(data.deviceId || ''), 128);
        if (!pollId || !deviceId) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ allowed: false, reason: 'missing or invalid pollId or deviceId' })); return; }
        const voterPubkey = String(data._pub || '');
        const requireLogin = resolveRequireLoginPolicy(pollId);
        if (requireLogin == null) {
          res.writeHead(409, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ allowed: false, reason: 'poll vote policy unavailable' }));
          return;
        }
        const keyResult = await resolveVoteKeysForRequest(req, pollId, deviceId, voterPubkey, requireLogin);
        if (!keyResult.ok) {
          res.writeHead(keyResult.status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ allowed: false, reason: keyResult.reason }));
          return;
        }
        const { identityKey, legacyKey } = keyResult;
        if (voteRegistry.has(identityKey) || (legacyKey && voteRegistry.has(legacyKey))) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ allowed: false, reason: 'already voted or vote pending' }));
          return;
        }
        const reservation = reserveVoteSlot(identityKey, deviceId);
        const allowed = reservation.ok;
        fs.appendFile(RECEIPT_LOG_FILE, JSON.stringify({ type: 'vote-authorize', pollId, deviceId, allowed, timestamp: Date.now() }) + '\n', () => {});
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          allowed,
          reservationToken: allowed ? reservation.reservationToken : undefined,
          reason: allowed ? undefined : reservation.reason,
        }));
      } catch (err) {
        // SECURITY FIX: Return allowed: false on error (was: true)
        console.error('Error in /api/vote-authorize:', err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ allowed: false, reason: 'internal error' }));
      }
    }); return;
  }

  if (req.method === 'POST' && url.pathname === '/api/receipts') {
    parseBodyWithLimit(req, res, 16384).then(async (data) => {
      if (!data) return;
      try {
        const sealedValidation = validateSealedRequest('receipt', data);
        if (!sealedValidation.ok) {
          res.writeHead(sealedValidation.status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, reason: sealedValidation.payload.error?.message || 'invalid receipt request' }));
          return;
        }
        if (!['vote', 'comment'].includes(String(data.type || '')) || !data.payload || typeof data.payload !== 'object' || Array.isArray(data.payload)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, reason: 'invalid receipt payload' }));
          return;
        }
        if (data.type === 'vote') {
          const pollId = sanitizeId(String(data.payload.pollId || ''), 128);
          const deviceId = sanitizeId(String(data.payload.deviceId || ''), 128);
          const voteHash = sanitizeId(String(data.payload.voteHash || ''), 160);
          if (!pollId || !deviceId || !voteHash) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, reason: 'invalid vote receipt payload' }));
            return;
          }
          const requireLogin = resolveRequireLoginPolicy(pollId);
          if (requireLogin == null) {
            res.writeHead(409, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, reason: 'poll vote policy unavailable' }));
            return;
          }
          const voterPubkey = String(data._pub || '');
          const keyResult = await resolveVoteKeysForRequest(req, pollId, deviceId, voterPubkey, requireLogin);
          if (!keyResult.ok) {
            res.writeHead(keyResult.status, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, reason: keyResult.reason }));
            return;
          }
          if (!voteRegistry.has(keyResult.identityKey) && (!keyResult.legacyKey || !voteRegistry.has(keyResult.legacyKey))) {
            res.writeHead(409, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, reason: 'vote receipt does not match committed vote state' }));
            return;
          }
        } else {
          const commentId = sanitizeId(String(data.payload.commentId || ''), 128);
          const postId = sanitizeId(String(data.payload.postId || ''), 128);
          if (!commentId || !postId) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, reason: 'invalid comment receipt payload' }));
            return;
          }
        }
        fs.appendFile(RECEIPT_LOG_FILE, JSON.stringify({ type: 'receipt', payload: data, timestamp: Date.now() }) + '\n', () => {});
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch { sendError(res, 500, 'Receipt processing failed', null, '/api/receipts'); }
    }); return;
  }

  if (req.method === 'POST' && url.pathname === '/api/vote-record') {
    handleVoteCommit(req, res, '/api/vote-record', 'vote-record');
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/vote-confirm') {
    handleVoteCommit(req, res, '/api/vote-confirm', 'vote-confirm');
    return;
  }

  // ── GET /api/communities ──────────────────────────────────────────────────
  if (req.method === 'GET' && url.pathname === '/api/communities') {
    if (!db) { res.writeHead(503, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ communities: [] })); return; }
    try {
      const rows = await queryMySQL(`SELECT data FROM gun_nodes WHERE soul REGEXP '^(v2/communities|communities)/c-[^/]+$' ORDER BY JSON_EXTRACT(data, '$.createdAt') DESC LIMIT 200`, []);
      const communities = [];
      const seen = new Set();
      for (const row of rows || []) {
        try {
          const d = JSON.parse(row.data);
          if (!d?.id || !d?.displayName || seen.has(d.id)) continue;
          seen.add(d.id);
          communities.push({ id: d.id, name: d.name || d.id, displayName: d.displayName, description: d.description || '', creatorId: d.creatorId || '', memberCount: d.memberCount || 0, postCount: d.postCount || 0, createdAt: d.createdAt || 0, rules: Array.isArray(d.rules) ? d.rules : [] });
        } catch {}
      }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60, stale-while-revalidate=120' });
      res.end(JSON.stringify({ communities })); return;
    } catch (err) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ communities: [] })); return; }
  }

  // ── GET /api/posts?limit=N ────────────────────────────────────────────────
  if (req.method === 'GET' && url.pathname === '/api/posts') {
    if (!db) { res.writeHead(503, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ posts: [] })); return; }
    const limit = Math.max(1, Math.min(parseInt(url.searchParams.get('limit') || '15') || 15, 500));
    try {
      const rows = await queryMySQL(
        `SELECT data FROM gun_nodes WHERE soul REGEXP '^(v2/communities|communities)/[^/]+/posts/post-[^/]+$' ORDER BY JSON_EXTRACT(data, '$.createdAt') DESC LIMIT ${limit}`, []
      );
      const posts = [];
      const seen = new Set();
      for (const row of rows || []) {
        try {
          const d = JSON.parse(row.data);
          if (!d?.id || !d?.title || !d?.communityId || seen.has(d.id)) continue;
          seen.add(d.id);
          posts.push({ id: d.id, communityId: d.communityId, authorId: d.authorId || '', authorName: d.authorName || 'Anonymous', title: d.title, content: d.content || '', imageIPFS: d.imageIPFS || '', imageThumbnail: d.imageThumbnail || '', createdAt: d.createdAt || 0, upvotes: d.upvotes || 0, downvotes: d.downvotes || 0, score: d.score || 0, commentCount: d.commentCount || 0, isEncrypted: d.isEncrypted || false });
        } catch {}
      }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=30, stale-while-revalidate=60' });
      res.end(JSON.stringify({ posts })); return;
    } catch (err) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ posts: [] })); return; }
  }

  // ── GET /api/post/:id ─────────────────────────────────────────────────────
  if (req.method === 'GET' && url.pathname.startsWith('/api/post/')) {
    const postId = url.pathname.split('/')[3];
    if (!postId || !db) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'not found' })); return; }
    try {
      const escaped = postId.replace(/[%_\\]/g, '\\$&');
      const rows = await queryMySQL(`SELECT data FROM gun_nodes WHERE soul LIKE ? ESCAPE ? OR soul LIKE ? ESCAPE ? OR soul = ? OR soul = ? LIMIT 5`, [`v2/communities/%/posts/${escaped}`, '\\', `communities/%/posts/${escaped}`, '\\', `v2/posts/${postId}`, `posts/${postId}`]);
      for (const row of rows || []) {
        try {
          const d = JSON.parse(row.data);
          if (!d?.title) continue;
          res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60, stale-while-revalidate=120' });
          res.end(JSON.stringify({ ...d, id: d.id || postId })); return;
        } catch {}
      }
      res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'not found' })); return;
    } catch (err) { sendError(res, 500, 'Internal error', err, '/api/post'); return; }
  }

  // ── GET /api/polls?limit=N ────────────────────────────────────────────────
  if (req.method === 'GET' && url.pathname === '/api/polls') {
    if (!db) { res.writeHead(503, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ polls: [] })); return; }
    const limit = Math.max(1, Math.min(parseInt(url.searchParams.get('limit') || '15') || 15, 100));
    try {
      const pollRows = await queryMySQL(
        `SELECT soul, data FROM gun_nodes
         WHERE (soul REGEXP '^(v2/communities|communities)/[^/]+/polls/poll-[^/]+$' OR soul REGEXP '^(v2/polls|polls)/poll-[^/]+$')
           AND soul NOT REGEXP '/options'
           AND soul NOT REGEXP '/inviteCodes'
         ORDER BY JSON_EXTRACT(data, '$.createdAt') DESC LIMIT ${limit}`, []
      );
      const polls = [];
      const seen = new Set();
      for (const row of pollRows || []) {
        try {
          const d = JSON.parse(row.data);
          if (!d?.id || !d?.question || !d?.communityId || seen.has(d.id) || d.isPrivate) continue;
          seen.add(d.id);
          const escaped = d.id.replace(/[%_\\]/g, '\\$&');
          const optRows = await queryMySQL(`SELECT data FROM gun_nodes WHERE soul LIKE ? ESCAPE ? LIMIT 20`, [`%/polls/${escaped}/options/%`, '\\']);
          const options = [];
          for (const optRow of optRows || []) {
            try { const o = JSON.parse(optRow.data); if (o?.id && !options.find(x => x.id === o.id)) options.push({ id: o.id, text: o.text || '', votes: o.votes || 0, voters: [] }); } catch {}
          }
          polls.push({ id: d.id, communityId: d.communityId, authorId: d.authorId || '', authorName: d.authorName || 'Anonymous', question: d.question, description: d.description || '', options, createdAt: d.createdAt || 0, expiresAt: d.expiresAt || 0, allowMultipleChoices: !!d.allowMultipleChoices, showResultsBeforeVoting: !!d.showResultsBeforeVoting, requireLogin: !!d.requireLogin, isPrivate: false, totalVotes: options.reduce((s, o) => s + o.votes, 0), isExpired: Date.now() > (d.expiresAt || 0), isEncrypted: d.isEncrypted || false });
        } catch {}
      }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=30, stale-while-revalidate=60' });
      res.end(JSON.stringify({ polls })); return;
    } catch (err) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ polls: [] })); return; }
  }

  // ── GET /api/poll/:id ─────────────────────────────────────────────────────
  if (req.method === 'GET' && url.pathname.startsWith('/api/poll/')) {
    const pollId = url.pathname.split('/')[3];
    if (!pollId || !db) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'not found' })); return; }
    try {
      const escaped = pollId.replace(/[%_\\]/g, '\\$&');
      // Check both v2/communities/.../polls/ and v2/polls/ paths
      const rows = await queryMySQL(
        `SELECT data FROM gun_nodes WHERE (soul LIKE ? ESCAPE ? OR soul LIKE ? ESCAPE ? OR soul = ? OR soul = ?) AND soul NOT REGEXP '/options' LIMIT 5`,
        [`v2/%/polls/${escaped}`, '\\', `communities/%/polls/${escaped}`, '\\', `v2/polls/${pollId}`, `polls/${pollId}`]
      );
      for (const row of rows || []) {
        try {
          const d = JSON.parse(row.data);
          if (!d?.question) continue;
          // Fetch options from both paths
          const optRows = await queryMySQL(
            `SELECT data FROM gun_nodes WHERE soul LIKE ? ESCAPE ? LIMIT 20`,
            [`%/polls/${escaped}/options/%`, '\\']
          );
          const options = [];
          for (const optRow of optRows || []) {
            try { const o = JSON.parse(optRow.data); if (o?.id && !options.find(x => x.id === o.id)) options.push({ id: o.id, text: o.text || '', votes: o.votes || 0, voters: [] }); } catch {}
          }
          res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=30, stale-while-revalidate=60' });
          res.end(JSON.stringify({ ...d, id: d.id || pollId, options })); return;
        } catch {}
      }
      res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'not found' })); return;
    } catch (err) { sendError(res, 500, 'Internal error', err, '/api/poll'); return; }
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
});

// ─── WebSocket ────────────────────────────────────────────────────────────────
const PING_INTERVAL = 20_000;
const pingTimer = setInterval(() => {
  wss.clients.forEach(ws => {
    if (ws.isAlive === false) { ws.terminate(); return; }
    ws.isAlive = false;
    ws.ping();
  });
}, PING_INTERVAL);

wss.on('close', () => clearInterval(pingTimer));

wss.on('connection', (ws, req) => {
  const wsOrigin = String(req.headers.origin || '');
  if (!wsOrigin || !ALLOWED_ORIGINS.includes(wsOrigin)) {
    ws.close(1008, 'origin not allowed');
    return;
  }
  let peerId = null;
  let userId = null;
  let sessionUserCache = null;
  let identityTier = 'unverified';
  const peerIp = req.socket.remoteAddress || 'unknown';
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', async (message) => {
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
        if (data.type === 'request-pow') {
          const sessionUser = sessionUserCache || await getSecureSession(req);
          if (sessionUser) sessionUserCache = sessionUser;
          identityTier = resolveWsIdentityTier(sessionUser, data.identityUsername);
        }

        const wsLimitOverride = identityTier === 'trusted-issuer'
          ? undefined
          : Math.max(10, Math.floor(rateLimiter.wsLimit / 2));

        // ─── WebSocket rate limiting ──────────────────────────────────
        const wsCheck = rateLimiter.checkWs(peerId || peerIp, wsLimitOverride);
        if (!wsCheck.allowed) {
          if (ws.readyState === 1) {
            ws.send(JSON.stringify({ type: 'error', code: 'RATE_LIMITED', retryAfter: wsCheck.retryAfter }));
          }
          return;
        }

        // ─── Bot detection ────────────────────────────────────────────
        const msgHash = crypto.createHash('sha256').update(message.toString().slice(0, 1000)).digest('hex');
        botDetector.recordMessage(peerId || peerIp, msgHash);
        const botAction = botDetector.getAction(peerId || peerIp);
        if (botAction.action === 'ban') {
          console.log(`🤖 Banning peer ${sanitizeLogString(peerId || peerIp)} (bot score: ${botAction.score})`);
          if (ws.readyState === 1) {
            ws.send(JSON.stringify({ type: 'error', code: 'BANNED', reason: 'Automated behavior detected' }));
          }
          ws.close();
          return;
        }
      }

      const effectivePayload = data.type === 'broadcast' && data.data && typeof data.data === 'object' ? data.data : data;
      const effectiveType = typeof effectivePayload.type === 'string' ? effectivePayload.type : data.type;
      const actionType = effectivePayload.actionType || data.actionType || data.data?.actionType;

      if (data.type === 'broadcast' && !ALLOWED_BROADCAST_TYPES.has(effectiveType)) {
        if (ws.readyState === 1) {
          ws.send(JSON.stringify({ type: 'error', code: 'INVALID_BROADCAST_TYPE', reason: `Unsupported broadcast type: ${String(effectiveType || 'unknown')}` }));
        }
        return;
      }

      // ─── PoW verification for content messages ────────────────────
      const powPayload = (effectivePayload && typeof effectivePayload.pow === 'object') ? effectivePayload : data;
      if (powChallenge.requiresPow(effectiveType, actionType)) {
        if (!powPayload.pow || !powPayload.pow.challengeId || powPayload.pow.nonce == null) {
          if (ws.readyState === 1) {
            ws.send(JSON.stringify({ type: 'pow-required', reason: 'Proof-of-work required for this action' }));
          }
          return;
        }
        const powResult = powChallenge.verify(powPayload.pow.challengeId, powPayload.pow.nonce);
        if (!powResult.valid) {
          if (ws.readyState === 1) {
            ws.send(JSON.stringify({ type: 'pow-required', reason: powResult.reason }));
          }
          return;
        }
      }

      // ─── Spam scoring for content messages ────────────────────────
      if (data.type === 'broadcast' || data.type === 'new-poll' || data.type === 'new-block' || data.type === 'new-post') {
        const payload = data.data || data.post || data;
        const textContent = [payload.title, payload.content, payload.description, payload.question]
          .filter(Boolean).join(' ');
        if (textContent) {
          const scoreResult = spamScorer.score(textContent);
          if (spamScorer.shouldFlag(scoreResult)) {
            console.log(`🚩 Flagged content from ${sanitizeLogString(peerId || peerIp)}: ${scoreResult.matchCount} matches`);
            if (data.data) data.data._flagged = true;
            else data._flagged = true;
          }
        }
      }

      // ── Mandatory integrity pipeline (hashcash) ───────────────────
      const integrityPayload = data.type === 'broadcast' ? effectivePayload : data;
      const needsIntegrity = data.type === 'broadcast' ? true : !POW_EXEMPT.has(effectiveType);

      if (needsIntegrity) {
        // Stage 1: Content hash — REQUIRED
        if (!integrityPayload._hash || typeof integrityPayload._hash !== 'string') {
          if (ws.readyState === 1) ws.send(JSON.stringify(makeError(ErrorCodes.HASH_MISMATCH, 'missing required _hash field')));
          return;
        }
        if (!verifyContentHash(integrityPayload)) {
          if (ws.readyState === 1) ws.send(JSON.stringify(makeError(ErrorCodes.HASH_MISMATCH, 'content hash does not match payload')));
          return;
        }

        // Stage 2: Signature — REQUIRED
        if (!integrityPayload._sig || typeof integrityPayload._sig !== 'string' || !integrityPayload._pub || typeof integrityPayload._pub !== 'string') {
          if (ws.readyState === 1) ws.send(JSON.stringify(makeError(ErrorCodes.SIGNATURE_INVALID, 'missing required _sig and _pub fields')));
          return;
        }
        if (!verifySignature(integrityPayload)) {
          if (ws.readyState === 1) ws.send(JSON.stringify(makeError(ErrorCodes.SIGNATURE_INVALID, 'Schnorr signature verification failed')));
          return;
        }

        // Stage 3: Proof-of-work (hashcash) — REQUIRED
        if (!integrityPayload._pow || typeof integrityPayload._pow !== 'string') {
          if (ws.readyState === 1) ws.send(JSON.stringify(makeError(ErrorCodes.POW_INSUFFICIENT, 'missing required _pow field')));
          return;
        }
        const integrityType = data.type === 'broadcast' ? 'broadcast' : effectiveType;
        if (!verifyHashcashPoW({ ...integrityPayload, type: integrityType })) {
          if (ws.readyState === 1) ws.send(JSON.stringify(makeError(ErrorCodes.POW_INSUFFICIENT, 'proof-of-work does not meet difficulty requirement')));
          return;
        }

        // Stage 4: Replay protection — REQUIRED
        if (!integrityPayload._ts || typeof integrityPayload._ts !== 'number' || !integrityPayload._nonce || typeof integrityPayload._nonce !== 'string') {
          if (ws.readyState === 1) ws.send(JSON.stringify(makeError(ErrorCodes.REPLAY_DETECTED, 'missing required _ts and _nonce fields')));
          return;
        }
        const replayResult = replayProtector.check({ ...integrityPayload, type: integrityType });
        if (!replayResult.fresh) {
          if (ws.readyState === 1) ws.send(JSON.stringify(makeError(ErrorCodes.REPLAY_DETECTED, replayResult.reason)));
          return;
        }
      }

      switch (data.type) {
        case 'register':
          {
            const sessionUser = await getSecureSession(req);
            const sessionSub = sanitizeId(String(sessionUser?.sub || ''), 128);
            if (!sessionSub) {
              if (ws.readyState === 1) {
                ws.send(JSON.stringify({ type: 'error', code: 'AUTH_REQUIRED', reason: 'authenticated session required for websocket registration' }));
              }
              break;
            }
            sessionUserCache = sessionUser;
            userId = sessionSub;
          }
          peerId = data.peerId;
          if (clients.has(peerId)) {
            if (ws.readyState === 1) {
              ws.send(JSON.stringify({ type: 'error', code: 'PEER_ID_TAKEN', reason: 'Peer ID already registered' }));
            }
            peerId = null;
            break;
          }
          clients.set(peerId, { ws, userId, peerId });
          botDetector.onRegister(peerId);
          broadcast({ type: 'peer-list', peers: Array.from(clients.keys()) });
          for (const msg of messageCache) { try { ws.send(JSON.stringify(msg)); } catch {} }
          break;
        case 'join-room': {
          if (!peerId || !userId) {
            if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'error', code: 'AUTH_REQUIRED', reason: 'register required before joining rooms' }));
            break;
          }
          const roomId = data.roomId || 'default';
          if (!rooms.has(roomId)) rooms.set(roomId, new Set());
          rooms.get(roomId).add(peerId);
          break;
        }
        case 'chat-start': {
          if (!peerId || !userId) {
            if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'error', code: 'AUTH_REQUIRED', reason: 'register required before chat actions' }));
            break;
          }
          const recipientId = data.recipientId;
          const roomId = getChatRoomId(userId, recipientId);
          activeChatSessions.set(roomId, { users: [userId, recipientId], createdAt: Date.now() });
          const recipientClient = Array.from(clients.values()).find(c => c.userId === recipientId);
          if (recipientClient?.ws.readyState === 1) recipientClient.ws.send(JSON.stringify({ type: 'chat-invite', from: userId, roomId }));
          break;
        }
        case 'chat-message': {
          if (!peerId || !userId) {
            if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'error', code: 'AUTH_REQUIRED', reason: 'register required before chat actions' }));
            break;
          }
          const { recipientId, encryptedForRecipient, messageId, timestamp } = data;
          const roomId = getChatRoomId(userId, recipientId);
          const storedId = await storeChatMessage(roomId, userId, recipientId, encryptedForRecipient);
          const recipientClient = Array.from(clients.values()).find(c => c.userId === recipientId);
          if (recipientClient?.ws.readyState === 1) recipientClient.ws.send(JSON.stringify({ type: 'chat-message', from: userId, messageId: storedId || messageId, encryptedForRecipient, timestamp: timestamp || Date.now() }));
          ws.send(JSON.stringify({ type: 'chat-delivered', messageId: storedId || messageId, recipientId }));
          break;
        }
        case 'chat-typing': {
          if (!peerId || !userId) {
            if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'error', code: 'AUTH_REQUIRED', reason: 'register required before chat actions' }));
            break;
          }
          const { recipientId, isTyping } = data;
          const recipientClient = Array.from(clients.values()).find(c => c.userId === recipientId);
          if (recipientClient?.ws.readyState === 1) recipientClient.ws.send(JSON.stringify({ type: 'chat-typing', from: userId, isTyping }));
          break;
        }
        case 'chat-read': {
          if (!peerId || !userId) {
            if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'error', code: 'AUTH_REQUIRED', reason: 'register required before chat actions' }));
            break;
          }
          const { recipientId } = data;
          const roomId = getChatRoomId(userId, recipientId);
          await markMessagesAsRead(roomId, userId);
          const senderClient = Array.from(clients.values()).find(c => c.userId === recipientId);
          if (senderClient?.ws.readyState === 1) senderClient.ws.send(JSON.stringify({ type: 'chat-read-receipt', from: userId }));
          break;
        }
        case 'broadcast':
          if (!peerId) {
            if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'error', code: 'AUTH_REQUIRED', reason: 'register required before broadcast' }));
            break;
          }
          broadcastToOthers(peerId, data.data);
          cacheMessage(data.data);
          break;
        case 'direct': {
          if (!peerId) {
            if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'error', code: 'AUTH_REQUIRED', reason: 'register required before direct messaging' }));
            break;
          }
          const targetWs = clients.get(data.targetPeer)?.ws;
          if (targetWs?.readyState === 1) targetWs.send(JSON.stringify(data.data));
          break;
        }
        case 'new-poll':
        case 'new-block':
        case 'request-sync':
        case 'sync-response':
          if (!peerId) {
            if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'error', code: 'AUTH_REQUIRED', reason: 'register required before relay actions' }));
            break;
          }
          broadcastToOthers(peerId, data);
          cacheMessage(data);
          if (data.type === 'new-poll' && data.poll) await indexContent('poll', data.poll.id, data.poll);
          break;
        case 'new-post':
          if (!peerId) {
            if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'error', code: 'AUTH_REQUIRED', reason: 'register required before relay actions' }));
            break;
          }
          broadcastToOthers(peerId, data);
          cacheMessage(data);
          if (data.post) await indexContent('post', data.post.id, data.post);
          break;
        case 'chatroom-message':
          if (!peerId || !userId) {
            if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'error', code: 'AUTH_REQUIRED', reason: 'register required before room chat' }));
            break;
          }
          if (!data.roomId || !rooms.has(data.roomId) || !rooms.get(data.roomId).has(peerId)) {
            if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'error', code: 'ROOM_ACCESS_DENIED', reason: 'join room before sending room chat' }));
            break;
          }
          broadcastToRoom(data.roomId, peerId, {
            type: 'chatroom-message',
            roomId: data.roomId,
            data: data.data,
          });
          break;
        case 'ping':
          if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'pong' }));
          break;
        case 'request-pow': {
          const deviceId = data.deviceId || peerId;
          const action = data.action || 'default';
          const botScore = botDetector.getScore(peerId || peerIp);
          const sessionUser = sessionUserCache || await getSecureSession(req);
          if (sessionUser) sessionUserCache = sessionUser;
          const resolvedTier = resolveWsIdentityTier(sessionUser, data.identityUsername);
          identityTier = resolvedTier;
          const challenge = powChallenge.createChallenge(deviceId, action, {
            botScore,
            spamPenalty: 0,
            identityTier: resolvedTier,
          });
          if (ws.readyState === 1) {
            ws.send(JSON.stringify({ type: 'pow-challenge', ...challenge }));
          }
          break;
        }
      }
    } catch (err) { console.error('WS error:', err.message); }
  });

  ws.on('close', () => {
    if (peerId) {
      clients.delete(peerId);
      rooms.forEach((peers, roomId) => { peers.delete(peerId); if (peers.size === 0) rooms.delete(roomId); });
      broadcast({ type: 'peer-left', peerId });
      activeChatSessions.forEach((session, roomId) => { if (session.users.includes(userId)) activeChatSessions.delete(roomId); });
    }
  });

  ws.on('error', err => console.error('WebSocket error:', err.message));
  ws.send(JSON.stringify({ type: 'welcome', message: 'Connected to P2P relay', timestamp: Date.now() }));
});

function broadcast(msg) { clients.forEach(({ ws }) => { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); }); }
function broadcastToOthers(excludeId, msg) { clients.forEach(({ ws, peerId }) => { if (peerId !== excludeId && ws.readyState === 1) ws.send(JSON.stringify(msg)); }); }
function broadcastToRoom(roomId, excludeId, msg) {
  const peers = rooms.get(roomId);
  if (!peers) return;
  peers.forEach((id) => {
    if (id === excludeId) return;
    const client = clients.get(id);
    if (client?.ws.readyState === 1) client.ws.send(JSON.stringify(msg));
  });
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────
setInterval(async () => {
  if (!db) return;
  try { await db.execute(`DELETE FROM sessions WHERE expires_at < ?`, [Date.now()]); }
  catch (err) { console.error('Session cleanup error:', err.message); }
}, 3_600_000);

setInterval(() => {
  const cutoff = Date.now() - SSR_CACHE_TTL;
  for (const [key, val] of ssrCache) { if (val.ts < cutoff) ssrCache.delete(key); }
}, 7_200_000);

// ─── Start ────────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`🚀 Enhanced Relay on :${PORT}`);
  console.log(`   Domain : ${DOMAIN}`);
  console.log(`   MySQL  : ${db ? '✅' : '❌'}`);
  console.log(`   Features: P2P Chat ✅ | Search ✅ | Auth ✅ | SSR ✅ | Sitemap ✅`);
  console.log(`   Cache  : ${messageCache.length} messages`);
});

process.on('SIGINT', () => {
  saveMessageCache();
  clearInterval(pingTimer);
  rateLimiter.destroy();
  botDetector.destroy();
  powChallenge.destroy();
  replayProtector.destroy();
  saveVoteRegistrySync();
  wss.clients.forEach(ws => ws.close());
  server.close(() => process.exit(0));
});
