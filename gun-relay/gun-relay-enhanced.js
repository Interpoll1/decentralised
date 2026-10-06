import { initEngagementStore, acceptGunAction } from '../shared-validation/engagement-store.js';
import { protectedReactionSoul, reactionSoul } from '../shared-validation/engagement.js';
import { installEngagementFirewall } from '../shared-validation/engagement-gun.js';
// gun-relay-enhanced.js
// Gun.js relay with MySQL persistence + Search indexing integration
// SECURITY: Auth on write endpoints, CORS whitelist, input validation, rate limiting

import express from 'express';
import Gun from 'gun';
import http from 'http';
import cors from 'cors';
import mysql from 'mysql2/promise';
import {
  sanitizeSoul, sanitizeLogString,
  setSecurityHeaders, requireSecret, sendError,
  createRateLimitMiddleware, ALLOWED_ORIGINS,
} from './security-utils.js';
import { ModerationMiddleware } from './moderation-middleware.js';
import { registerCategoriseRoutes } from './mod-categorise-routes.js';
import { validateSearchQuery, validateSoulPath } from '../shared-validation/index.js';
import { ErrorCodes, makeError } from '../shared-validation/errors.js';
import { NAMESPACE, NAMESPACE_EPOCH_MS, idTimestamp } from '../shared-validation/namespace.js';
import { createContentFirewall, installContentFirewall } from '../content-firewall.js';
import fs from 'fs';

// deriveNostrEventId lives in the relay-server, not this package.
// Loaded lazily on first use so a wrong path never prevents startup.
let deriveNostrEventId = null;
async function getNostrDeriver() {
  if (deriveNostrEventId) return deriveNostrEventId;
  const candidates = [
    '../relay-server/relay-server-enhanced.js'
  ];
  for (const path of candidates) {
    try {
      const mod = await import(path);
      if (typeof mod.deriveNostrEventId === 'function') {
        deriveNostrEventId = mod.deriveNostrEventId;
        return deriveNostrEventId;
      }
    } catch { /* try next */ }
  }
  console.warn('[gun-relay] deriveNostrEventId not found — nostrEventId will be null');
  deriveNostrEventId = () => null; // no-op so callers never throw
  return deriveNostrEventId;
}

const PORT     = process.env.PORT || 8765;
const NODE_ENV = process.env.NODE_ENV || 'development';
const DATA_DIR = process.env.GUN_DATA_DIR || new URL('./data', import.meta.url).pathname;
const GUN_FILE = `${DATA_DIR}/radata`;

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const app = express();

// ─── AI Categorisation Queue ──────────────────────────────────────────────────
// Loaded after server starts so /internal/categorise-write is already registered.
let queueForCategorisation = null;

async function loadCategorisationQueue() {
  try {
    const mod = await import('../relay-server/auto-categorise.js');
    queueForCategorisation = mod.queueForCategorisation;
  } catch (err) {
    console.warn('[gun-relay] auto-categorise.js not available:', err.message);
  }
}

// Write category result back to Gun via /internal/categorise-write (keeps Gun
// write logic consolidated in mod-categorise-routes.js).
async function writeCategrisationResultLocal(id, result) {
  if (!result) return;
  try {
    if (db) {
      const tags = Array.isArray(result.tags) ? result.tags.join(',') : (result.tags || '');
      await db.execute(
        `UPDATE search_index
         SET category      = ?,
             tags          = ?,
             sentiment     = ?,
             nsfw          = ?,
             controversial = ?,
             evergreen     = ?,
             locale        = ?
         WHERE id = ?`,
        [
          result.category,
          tags,
          result.sentiment     ?? 'neutral',
          result.nsfw          ?? 'none',
          result.controversial ? 1 : 0,
          result.evergreen    !== false ? 1 : 0,
          result.locale        ?? 'global',
          id,
        ]
      ).catch(err => console.warn('[gun-relay] categorise MySQL write failed:', err.message));
    }
    await fetch(`http://127.0.0.1:${PORT}/internal/categorise-write`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...result }),
    });
  } catch (err) {
    console.warn('[gun-relay] categorise write-back failed:', err.message);
  }
}

// ─── MySQL ────────────────────────────────────────────────────────────────────
let db          = null;
let dbConnected = false;

// Secure by default — verify the server cert. Supply MYSQL_SSL_CA for private
// CAs, or set MYSQL_SSL_INSECURE=true for local dev only.
function buildMysqlSsl() {
  if (process.env.MYSQL_SSL_CA) {
    return { ca: fs.readFileSync(process.env.MYSQL_SSL_CA), rejectUnauthorized: true };
  }
  if (process.env.MYSQL_SSL_INSECURE === 'true') {
    console.warn('⚠️  MySQL TLS verification DISABLED (MYSQL_SSL_INSECURE=true) — dev only');
    return { rejectUnauthorized: false };
  }
  return { rejectUnauthorized: true };
}

async function initMySQL() {
  if (!process.env.MYSQL_HOST) {
    console.warn('⚠️  MYSQL_HOST not set — running in memory-only mode');
    return false;
  }
  try {
    db = await mysql.createPool({
      host:                  process.env.MYSQL_HOST,
      user:                  process.env.MYSQL_USER,
      password:              process.env.MYSQL_PASSWORD,
      database:              process.env.MYSQL_DATABASE,
      port:                  process.env.MYSQL_PORT ? parseInt(process.env.MYSQL_PORT) : 3306,
      waitForConnections:    true,
      connectionLimit:       10,
      enableKeepAlive:       true,
      keepAliveInitialDelay: 10000,
      ssl:                   buildMysqlSsl(),
    });

    await db.execute(`
      CREATE TABLE IF NOT EXISTS gun_nodes (
        soul       VARCHAR(500) PRIMARY KEY,
        data       LONGTEXT NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // Schema kept identical to relay-server-enhanced.js — whichever process
    // starts first creates the table; the other is a no-op.
    await db.execute(`
      CREATE TABLE IF NOT EXISTS search_index (
        id         VARCHAR(100) PRIMARY KEY,
        type       ENUM('post', 'poll') NOT NULL,
        title      TEXT,
        content    TEXT,
        author     VARCHAR(200),
        community  VARCHAR(100),
        created_at BIGINT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FULLTEXT idx_title_content (title, content),
        INDEX idx_author    (author),
        INDEX idx_community (community),
        INDEX idx_created   (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // ── Categorisation column migration ────────────────────────────────────────
    // Uses information_schema instead of IF NOT EXISTS — works on MySQL 5.7+.
    const dbName = process.env.MYSQL_DATABASE;

    async function addColumnIfMissing(column, definition) {
      const [rows] = await db.execute(
        `SELECT 1 FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'search_index' AND COLUMN_NAME = ?`,
        [dbName, column]
      );
      if (rows.length === 0) {
        await db.execute(`ALTER TABLE search_index ADD COLUMN ${column} ${definition}`);
        console.log(`[gun-relay] Migration: added column ${column}`);
      }
    }

    async function addIndexIfMissing(indexName, definition) {
      const [rows] = await db.execute(
        `SELECT 1 FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'search_index' AND INDEX_NAME = ?`,
        [dbName, indexName]
      );
      if (rows.length === 0) {
        await db.execute(`ALTER TABLE search_index ADD INDEX ${indexName} ${definition}`).catch(() => {});
      }
    }

    async function ensureColumnType(column, expectedType, newDefinition) {
      const [rows] = await db.execute(
        `SELECT DATA_TYPE, COLUMN_TYPE FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'search_index' AND COLUMN_NAME = ?`,
        [dbName, column]
      );
      if (rows.length === 0) return; // column doesn't exist yet — addColumnIfMissing handles it
      const currentType = (rows[0].COLUMN_TYPE || rows[0].DATA_TYPE || '').toLowerCase();
      if (!currentType.includes(expectedType.toLowerCase())) {
        // Convert existing values before changing type so MySQL doesn't reject them
        await db.execute(`UPDATE search_index SET ${column} = 'other-adult' WHERE ${column} = '1' OR ${column} = 1`).catch(() => {});
        await db.execute(`UPDATE search_index SET ${column} = 'none' WHERE ${column} = '0' OR ${column} = 0 OR ${column} IS NULL`).catch(() => {});
        await db.execute(`ALTER TABLE search_index MODIFY COLUMN ${column} ${newDefinition}`);
        console.log(`[gun-relay] Migration: converted ${column} from ${currentType} to ${expectedType}`);
      }
    }

    await addColumnIfMissing('category',      `VARCHAR(64)               DEFAULT NULL`);
    await addColumnIfMissing('tags',           `VARCHAR(500)              DEFAULT NULL`);
    await addColumnIfMissing('sentiment',      `VARCHAR(16)               DEFAULT NULL`);
    await addColumnIfMissing('nsfw',           `VARCHAR(16)               DEFAULT 'none'`);
    // Ensure nsfw is VARCHAR — older installs have it as TINYINT(1)
    await ensureColumnType  ('nsfw',           'varchar',                  `VARCHAR(16) DEFAULT 'none'`);
    await addColumnIfMissing('controversial',  `TINYINT(1)  NOT NULL      DEFAULT 0`);
    await addColumnIfMissing('evergreen',      `TINYINT(1)  NOT NULL      DEFAULT 1`);
    await addColumnIfMissing('locale',         `ENUM('global','regional') NOT NULL DEFAULT 'global'`);

    await addIndexIfMissing('idx_category',     '(category)');
    await addIndexIfMissing('idx_nsfw',         '(nsfw)');
    await addIndexIfMissing('idx_controversial','(controversial)');
    await addIndexIfMissing('idx_locale',       '(locale)');

    // One-time: migrate old boolean nsfw (0/1) to string enum
    await db.execute(`
      UPDATE search_index SET nsfw = 'other-adult' WHERE nsfw = '1'
    `).catch(() => {});
    await db.execute(`
      UPDATE search_index SET nsfw = 'none' WHERE nsfw = '0' OR nsfw IS NULL
    `).catch(() => {});

    await initEngagementStore(db);
    dbConnected = true;
    console.log('✅ MySQL connected');

    // Keep the pool alive — reconnect on failure.
    setInterval(async () => {
      try {
        await db.execute('SELECT 1');
      } catch (err) {
        console.warn('[gun-relay] MySQL keepalive failed, reconnecting:', err.message);
        dbConnected = false;
        try { await db.end().catch(() => {}); await initMySQL(); } catch (e) {
          console.error('[gun-relay] Reconnect failed:', e.message);
        }
      }
    }, 5 * 60 * 1000);

    return true;
  } catch (err) {
    console.error('❌ MySQL connection failed:', err.message);
    dbConnected = false;
    return false;
  }
}

await initMySQL();

const moderation = new ModerationMiddleware(db);
await moderation.init();

// ─── Search Indexing ──────────────────────────────────────────────────────────
// Writes directly to search_index from our own pool — no HTTP round-trip to
// relay-server and no dependency on API_INDEX_SECRET being set.
async function indexSearchRow(type, id, data) {
  if (!dbConnected) return false;
  try {
    await db.execute(
      `INSERT INTO search_index (id, type, title, content, author, community, created_at, imageIPFS)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         title = VALUES(title), content = VALUES(content),
         author = VALUES(author), imageIPFS = VALUES(imageIPFS), updated_at = NOW()`,
      [
        id,
        type,
        data.title    ?? data.question    ?? '',
        data.content  ?? data.description ?? '',
        data.authorName    || 'Anonymous',
        data.communitySlug || '',
        data.createdAt     || Date.now(),
        data.imageIPFS     || null,
      ]
    );
    return true;
  } catch (err) {
    console.error(`❌ Search indexing error for ${type}:${sanitizeLogString(id)} —`, err.message);
    return false;
  }
}

async function maybeIndexNode(soul, fullData) {
  const isPost = /\/posts\/post-[^/]+$/.test(soul);
  const isPoll = /\/polls\/poll-[^/]+$/.test(soul);

  if (isPost && fullData.title) {
    const id = fullData.id || soul.split('/').pop();
    const indexed = await indexSearchRow('post', id, {
      title:         fullData.title,
      content:       fullData.content     || '',
      authorName:    fullData.authorName  || 'Anonymous',
      communitySlug: fullData.communityId || '',
      createdAt:     fullData.createdAt   || Date.now(),
    });
    if (indexed && queueForCategorisation && !fullData.category) {
      setImmediate(() => queueForCategorisation(
        id, 'post',
        { title: fullData.title, content: fullData.content || '' },
        (result) => writeCategrisationResultLocal(id, result)
      ));
    }
    return indexed;
  }

  if (isPoll && fullData.question) {
    const id = fullData.id || soul.split('/').pop();
    const indexed = await indexSearchRow('poll', id, {
      question:      fullData.question,
      description:   fullData.description || '',
      authorName:    fullData.authorName  || 'Anonymous',
      communitySlug: fullData.communityId || '',
      createdAt:     fullData.createdAt   || Date.now(),
    });
    if (indexed && queueForCategorisation && !fullData.category) {
      setImmediate(() => queueForCategorisation(
        id, 'poll',
        { title: fullData.question, content: fullData.description || '' },
        (result) => writeCategrisationResultLocal(id, result)
      ));
    }
    return indexed;
  }

  return false;
}

// ─── Value sanitiser ──────────────────────────────────────────────────────────
// Gun rejects JS arrays ("Invalid data: Array"). Convert them to indexed objects
// as a safety net for legacy data or unpatched clients.
function sanitiseValue(value) {
  if (Array.isArray(value)) {
    const obj = {};
    value.forEach((v, i) => { obj[i] = v; });
    return obj;
  }
  return value;
}

// Recursively sanitise an object — convert any nested arrays to indexed objects.
function sanitiseDataObject(data) {
  if (data === null || data === undefined) return data;
  if (Array.isArray(data)) {
    const obj = {};
    data.forEach((v, i) => { obj[i] = sanitiseDataObject(v); });
    return obj;
  }
  if (typeof data === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(data)) out[k] = sanitiseDataObject(v);
    return out;
  }
  return data;
}

// ─── In-memory node accumulator ───────────────────────────────────────────────
const nodeBuffer  = new Map();
const flushTimers = new Map();

/**
 * Souls holding a full content record in the active namespace. Index nodes,
 * option nodes and vote nodes are deliberately excluded — they carry no
 * dataVersion of their own and are meaningless without a parent record that
 * already passed this gate.
 */
const CONTENT_SOUL_RE = new RegExp(
  `^${NAMESPACE}/(?:posts/post-[^/]+|polls/poll-[^/]+|comments/comment_[^/]+|communities/c-[^/]+|communities/[^/]+/(?:posts/post-[^/]+|polls/poll-[^/]+))$`
);

/**
 * Write-side namespace gate.
 *
 * This is the only guard in the system a stale browser cannot route around:
 * client-side checks only bind clients that actually updated, and the v3→v4
 * leak happened precisely because un-updated clients kept laundering legacy
 * records into the new namespace. Everything must pass through flushNode to
 * reach durable storage, so the boundary is enforced here.
 *
 * Partial updates (vote tallies, edits) carry no dataVersion, so a record that
 * already exists and was previously admitted is allowed through unchanged.
 */
async function admittedToNamespace(soul, data) {
  if (!CONTENT_SOUL_RE.test(soul)) return true;
  if (data && data.dataVersion === NAMESPACE) {
    const ts = idTimestamp(data.id);
    if (ts !== null && ts < NAMESPACE_EPOCH_MS) {
      console.warn(`[namespace] rejected pre-cutover record: ${soul}`);
      return false;
    }
    return true;
  }
  // No tag on this write — permit it only as an update to an already-admitted row.
  try {
    const [rows] = await db.execute('SELECT data FROM gun_nodes WHERE soul = ?', [soul]);
    if (rows.length > 0) {
      const existing = JSON.parse(rows[0].data);
      if (existing?.dataVersion === NAMESPACE) return true;
    }
  } catch { /* fall through to reject */ }
  console.warn(`[namespace] rejected untagged write to ${soul}`);
  return false;
}

async function flushNode(soul) {
  if (!dbConnected || !nodeBuffer.has(soul)) return;
  const data = nodeBuffer.get(soul);
  nodeBuffer.delete(soul);
  flushTimers.delete(soul);
  if (!(await admittedToNamespace(soul, data))) return;
  try {
    await db.execute(
      `INSERT INTO gun_nodes (soul, data) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE
         data = JSON_MERGE_PATCH(data, VALUES(data)),
         updated_at = NOW()`,
      [soul, JSON.stringify(data)]
    );

    if (/\/posts\/post-[^/]+$/.test(soul) || /\/polls\/poll-[^/]+$/.test(soul)) {
      try {
        const [rows] = await db.execute('SELECT data FROM gun_nodes WHERE soul = ?', [soul]);
        if (rows.length > 0) await maybeIndexNode(soul, JSON.parse(rows[0].data));
      } catch (err) {
        console.error('❌ Auto-index fetch error:', err.message);
      }
    }
  } catch (err) {
    const isConnErr = err.message?.includes('Pool is closed')
      || err.message?.includes('ECONNRESET')
      || err.message?.includes('PROTOCOL_CONNECTION_LOST');
    if (isConnErr) {
      dbConnected = false;
      nodeBuffer.set(soul, data);
      flushTimers.set(soul, setTimeout(() => flushNode(soul), 5000));
      initMySQL().catch(e => console.error('[gun-relay] Reconnect failed:', e.message));
    } else {
      console.error('❌ MySQL flush error:', err.message);
    }
  }
}

function bufferField(soul, field, value) {
  if (!nodeBuffer.has(soul)) nodeBuffer.set(soul, {});
  nodeBuffer.get(soul)[field] = sanitiseValue(value);
  if (flushTimers.has(soul)) clearTimeout(flushTimers.get(soul));
  flushTimers.set(soul, setTimeout(() => flushNode(soul), 200));
}

// ─── Automatic Backfill ───────────────────────────────────────────────────────
async function backfillSearchIndex() {
  if (!dbConnected) return;
  try {
    const [rows] = await db.execute(`
      SELECT soul, data FROM gun_nodes
      WHERE soul REGEXP '/posts/post-[^/]+$'
         OR soul REGEXP '/polls/poll-[^/]+$'
    `);

    if (rows.length === 0) return;

    let indexed = 0;
    let skipped = 0;

    for (const row of rows) {
      try {
        const fullData = JSON.parse(row.data);
        const isPost   = /\/posts\/post-[^/]+$/.test(row.soul);
        const isPoll   = /\/polls\/poll-[^/]+$/.test(row.soul);

        if ((isPost && !fullData.title) || (isPoll && !fullData.question)) {
          skipped++;
          continue;
        }

        if (await maybeIndexNode(row.soul, fullData)) indexed++;
        else skipped++;

        // Yield every 100 upserts to avoid starving the event loop.
        if (indexed % 100 === 0) await new Promise(r => setImmediate(r));
      } catch (err) {
        console.error(`❌ Backfill error for ${sanitizeLogString(row.soul)}:`, err.message);
        skipped++;
      }
    }

    console.log(`✅ Backfill complete — indexed: ${indexed}, skipped: ${skipped}`);
  } catch (err) {
    console.error('❌ Backfill failed:', err.message);
  }
}

// ─── Gun Storage Adapter ──────────────────────────────────────────────────────

// Souls that must never be persisted (ephemeral / P2P signalling).
// 'chats' is included so that null-puts emitted by markAsRead (which tombstone
// delivered messages in Gun) are silently dropped and never written to MySQL.
const EPHEMERAL_PREFIXES = [
  'chat-p2p', 'v3/chat-p2p',
  'chat-presence', 'v3/chat-presence',
  'chat-read', 'v3/chat-read',
  'chats', 'v3/chats',
];

function isEphemeral(soul) {
  return EPHEMERAL_PREFIXES.some(
    p => soul === p || soul.startsWith(p + '/') || soul.includes('/' + p + '/') || soul.endsWith('/' + p)
  );
}

// ─── Dark Communities ─────────────────────────────────────────────────────────
// Dark communities are written to their own Gun soul (so invite links resolve)
// but are excluded from the community index so they don't appear in listings.
// The community index soul should match whatever path your Gun clients use as
// the master community list. Adjust if your app uses a different path.
const COMMUNITY_INDEX_SOUL = process.env.COMMUNITY_INDEX_SOUL || 'v3/community-index';

// Returns true if the community identified by `slug` has darkMode: true in MySQL.
// Falls back to false on any error so we never accidentally hide a community.
async function isCommunityDark(slug) {
  if (!slug || !dbConnected) return false;
  // Communities are stored under both v2 and v3 prefixes depending on client
  // version — check both. The slug is used as the Gun key under communities/.
  const patterns = [
    `v3/communities/${slug}`,
    `v2/communities/${slug}`,
    `communities/${slug}`,
  ];
  try {
    const placeholders = patterns.map(() => '?').join(', ');
    const [rows] = await db.execute(
      `SELECT data FROM gun_nodes WHERE soul IN (${placeholders}) LIMIT 1`,
      patterns
    );
    if (rows.length === 0) return false;
    const data = JSON.parse(rows[0].data);
    return data?.darkMode === true;
  } catch {
    return false;
  }
}

function wireMySQL(gun) {
  // gun._.root.on('put') fires after HAM conflict resolution for every accepted
  // field write. This is the correct hook for persistence; gun._.root.on('in')
  // is intercepted by AXE before it reaches user listeners.
  gun._.root.on('put', function(msg) {
    this.to.next(msg);

    if (!dbConnected) return;
    const put = msg?.put;
    if (!put) return;

    const soul  = put['#'];
    const field = put['.'];
    const value = put[':'];
    // Signed leaf already committed by the shared transaction; never merge it again.
    if (protectedReactionSoul(soul) && soul.split('/').length >= 4) return;

    if (!soul || field === undefined || value === undefined || value === null) return;
    if (soul.startsWith('~') || soul === 'undefined') return;
    if (isEphemeral(soul)) return;
    if (field === '_' || field === '>') return; // Gun metadata

    if (Array.isArray(value)) return; // blocked — sanitised at /db/write layer

    // Dark community guard: if this write targets the community index, check
    // whether the community being listed has darkMode: true. If so, drop only
    // the index entry — the community soul itself is still written normally so
    // invite links continue to resolve.
    if (soul === COMMUNITY_INDEX_SOUL) {
      // `field` is the community slug / key being added to the index.
      isCommunityDark(field).then(dark => {
        if (dark) return; // silently drop — community stays unlisted
        moderation.checkWrite(soul, field, value).then(blocked => {
          if (!blocked) bufferField(soul, field, value);
        });
      });
      return;
    }

    moderation.checkWrite(soul, field, value).then(blocked => {
      if (!blocked) bufferField(soul, field, value);
    });
  });

  gun.on('get', async function(msg) {
    this.to.next(msg);
    const soul = msg?.get?.['#'];
    if (!soul || !dbConnected || isEphemeral(soul)) return;

    let conn;
    try {
      conn = await db.getConnection();
      const [rows] = await conn.execute('SELECT data FROM gun_nodes WHERE soul = ?', [soul]);
      if (rows.length === 0) return;
      const data = JSON.parse(rows[0].data);
      const node = protectedReactionSoul(soul) && soul.split('/').length === 4 ? { envelope: data.envelope } : data;
      gun._.root.on('in', { '@': msg['#'], put: { [soul]: node } });
    } catch (err) {
      const isConnErr = err.message?.includes('Pool is closed')
        || err.message?.includes('ECONNRESET')
        || err.message?.includes('PROTOCOL_CONNECTION_LOST');
      if (isConnErr) {
        dbConnected = false;
        initMySQL().catch(e => console.error('[gun-relay] Reconnect failed:', e.message));
      } else {
        console.error('❌ MySQL get error:', err.message);
      }
    } finally {
      if (conn) conn.release();
    }
  });

  console.log('✅ MySQL Gun storage adapter wired');
}

// ─── CORS & Security ──────────────────────────────────────────────────────────
app.use(cors({ origin: '*' }));

// Body size guard — reject oversized POST/PUT before parsing.
app.use((req, res, next) => {
  if (req.method !== 'POST' && req.method !== 'PUT') return next();
  let size      = 0;
  let destroyed = false;
  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > 524288 && !destroyed) {
      destroyed = true;
      req.destroy();
      if (!res.headersSent) res.status(413).json(makeError(ErrorCodes.PAYLOAD_TOO_LARGE, 'Request body exceeds 512KB'));
    }
  });
  next();
});

app.use((req, res, next) => { setSecurityHeaders(res); next(); });

const httpRateLimit = createRateLimitMiddleware(Number(process.env.RATE_LIMIT_HTTP) || 300, 60000);
app.use((req, res, next) => { if (httpRateLimit(req, res)) next(); });

app.use(express.json({ limit: '512kb' }));
app.use(Gun.serve);

const server = http.createServer(app);

// ─── Gun ──────────────────────────────────────────────────────────────────────
// ─── Content firewall ─────────────────────────────────────────────────────────
// New posts/comments/polls must carry a fresh proof-of-work stamp and respect a
// per-IP creation limit; see ../content-firewall.js. CONTENT_FIREWALL_MODE=log
// reports without rejecting.
const contentFirewall = createContentFirewall({
  mode: process.env.CONTENT_FIREWALL_MODE === 'log' ? 'log' : 'enforce',
  limits: {
    perMinute: Number(process.env.CONTENT_CREATE_PER_MIN) || 6,
    perHour:   Number(process.env.CONTENT_CREATE_PER_HOUR) || 60,
  },
  soulExists: async (soul) => {
    // Fail open while MySQL is down so edits to legacy content keep working.
    if (!dbConnected || !db) return true;
    const [rows] = await db.execute(
      "SELECT 1 FROM gun_nodes WHERE soul = ? AND JSON_EXTRACT(data, '$.createdAt') IS NOT NULL LIMIT 1",
      [soul],
    );
    return rows.length > 0;
  },
  log: (msg) => console.warn(sanitizeLogString(msg, 300)),
});

async function acceptReactionForGun(action) {
  const soul = reactionSoul(action, NAMESPACE);
  if (await moderation.checkWrite(soul, 'envelope', JSON.stringify(action))) throw new Error('BLOCKED_REACTION');
  return acceptGunAction(dbConnected ? db : null, action, NAMESPACE);
}
installEngagementFirewall(Gun, { namespace: NAMESPACE, accept: acceptReactionForGun });
const gun = Gun({
  web:          server,
  radisk:       true,
  file:         GUN_FILE,
  localStorage: false,
  multicast:    false,
  peers:        process.env.GUN_PEERS ? process.env.GUN_PEERS.split(',') : [],
});

// ─── WebSocket tracker ────────────────────────────────────────────────────────
// 1. Ack client puts immediately (before Gun/AXE processes the message).
// 2. Track peer sockets for ping-peer presence queries.
/** peerId (Gun userId) → Set of open WebSocket connections. */
const _peerSockets = new Map();

setImmediate(() => {
  const wss = gun._.opt?.ws?.web;
  if (!wss) {
    console.warn('[gun-relay] WARNING: could not find wss — socket tracker not installed');
    return;
  }

  wss.prependListener('connection', (ws, req) => {
    // Must wrap before any 'message' listener runs (ours and Gun's).
    installContentFirewall(ws, req, contentFirewall);
    let _registeredPeerId = null;

    ws.prependListener('message', (raw) => {
      try {
        const msgs = JSON.parse(typeof raw === 'string' ? raw : raw.toString());
        const list = Array.isArray(msgs) ? msgs : [msgs];

        for (const m of list) {
          if (!m) continue;

          // Ack puts immediately — guaranteed ref to originating socket here.
          if (m['#'] && m.put && !m['@'] && ws.readyState === 1
            && !Object.keys(m.put).some(protectedReactionSoul)) {
            try {
              ws.send(JSON.stringify({ '@': m['#'], ok: 1, '#': Math.random().toString(36).slice(2, 11) }));
            } catch { /* socket closed between check and send */ }
          }

          // Presence registration: { type: 'register-presence', userId: '...' }
          if (m.type === 'register-presence' && m.userId) {
            _registeredPeerId = m.userId;
            if (!_peerSockets.has(m.userId)) _peerSockets.set(m.userId, new Set());
            _peerSockets.get(m.userId).add(ws);
          }

          // Presence ping: { type: 'ping-peer', peerId: '...', id: '...' }
          if (m.type === 'ping-peer' && m.peerId && m.id) {
            const sockets = _peerSockets.get(m.peerId);
            const online  = !!(sockets && [...sockets].some(s => s.readyState === 1));
            try {
              ws.send(JSON.stringify({ type: 'pong-peer', id: m.id, online, peerId: m.peerId }));
            } catch { /* socket closed */ }
          }
        }
      } catch { /* malformed message — ignore */ }
    });

    ws.on('close', () => {
      if (_registeredPeerId) {
        const set = _peerSockets.get(_registeredPeerId);
        if (set) {
          set.delete(ws);
          if (set.size === 0) _peerSockets.delete(_registeredPeerId);
        }
      }
    });
  });
});

wireMySQL(gun);
moderation.setGun(gun);
moderation.registerRoutes(app, requireSecret);
registerCategoriseRoutes(app, requireSecret, db, gun);

// ─── Vote Receipt ─────────────────────────────────────────────────────────────
// POST /db/vote-receipt
// Called by relay-server after recording a vote block. Extends the receipt with
// trustTier + nostrEventId and stores it under v3/receipts/<mnemonic>.
// SECURITY: Requires API_WRITE_SECRET
app.post('/db/vote-receipt', async (req, res) => {
  if (!requireSecret(req, res, 'API_WRITE_SECRET')) return;
  const { mnemonic, vote, receipt: baseReceipt } = req.body || {};
  if (!mnemonic || !vote || !baseReceipt)
    return res.status(400).json({ error: 'mnemonic, vote and receipt are required' });

  try {
    const derive     = await getNostrDeriver();
    const nostrEventId = await derive(baseReceipt).catch(() => null);
    const receipt = {
      ...baseReceipt,
      trustTier:    vote.trustTier  ?? null,
      nostrEventId: nostrEventId   ?? null,
    };

    const soul = `v3/receipts/${mnemonic.replace(/\s+/g, '-')}`;
    gun.get('v3/receipts').get(mnemonic.replace(/\s+/g, '-')).put(receipt);

    if (dbConnected) {
      await db.execute(
        `INSERT INTO gun_nodes (soul, data) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE data = VALUES(data), updated_at = NOW()`,
        [soul, JSON.stringify(receipt)]
      ).catch(err => console.warn('[gun-relay] vote-receipt MySQL write failed:', err.message));
    }

    res.json({ ok: true, soul, nostrEventId });
  } catch (err) {
    console.error('❌ /db/vote-receipt error:', err.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ─── Poll Creation ────────────────────────────────────────────────────────────
// POST /db/create-poll
// Persists the extended poll fields (voteTrustPolicy, timeLock, nostrEventId)
// onto the poll object before writing it to Gun + MySQL.
// SECURITY: Requires API_WRITE_SECRET
app.post('/db/create-poll', async (req, res) => {
  if (!requireSecret(req, res, 'API_WRITE_SECRET')) return;
  const { soul, data } = req.body || {};
  if (!soul || !data)         return res.status(400).json({ error: 'soul and data required' });
  if (protectedReactionSoul(soul)) return res.status(422).json({ error: 'USE_SIGNED_ENGAGEMENT_API' });
  if (!sanitizeSoul(soul))    return res.status(400).json({ error: 'invalid soul format' });
  if (!dbConnected)           return res.status(503).json({ error: 'db not connected' });

  try {
    const derive       = await getNostrDeriver();
    const nostrEventId = await derive(data).catch(() => null);

    const pollData = sanitiseDataObject({
      ...data,
      voteTrustPolicy: data.voteTrustPolicy
        ? { requiredTier: data.voteTrustPolicy.requiredTier ?? null }
        : null,
      resultsLockedUntil: data.resultsLockedUntil ?? null,
      timeLockMode:       data.timeLockMode       ?? null,
      timeLockBlock:      data.timeLockBlock       ?? null,
      nostrEventId:       nostrEventId            ?? null,
    });

    await db.execute(
      `INSERT INTO gun_nodes (soul, data) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE data = JSON_MERGE_PATCH(data, VALUES(data)), updated_at = NOW()`,
      [soul, JSON.stringify(pollData)]
    );

    const parts = soul.split('/');
    let node = gun.get(parts[0]);
    for (let i = 1; i < parts.length; i++) node = node.get(parts[i]);
    node.put(pollData);

    if (pollData.question) await maybeIndexNode(soul, pollData);

    res.json({ ok: true, soul, nostrEventId });
  } catch (err) {
    console.error('❌ /db/create-poll error:', err.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ─── Post Creation ────────────────────────────────────────────────────────────
// POST /db/create-post
// Computes and persists nostrEventId on the post object.
// SECURITY: Requires API_WRITE_SECRET
app.post('/db/create-post', async (req, res) => {
  if (!requireSecret(req, res, 'API_WRITE_SECRET')) return;
  const { soul, data } = req.body || {};
  if (!soul || !data)         return res.status(400).json({ error: 'soul and data required' });
  if (protectedReactionSoul(soul)) return res.status(422).json({ error: 'USE_SIGNED_ENGAGEMENT_API' });
  if (!sanitizeSoul(soul))    return res.status(400).json({ error: 'invalid soul format' });
  if (!dbConnected)           return res.status(503).json({ error: 'db not connected' });

  try {
    const derive       = await getNostrDeriver();
    const nostrEventId = await derive(data).catch(() => null);
    const postData = sanitiseDataObject({ ...data, nostrEventId: nostrEventId ?? null });

    await db.execute(
      `INSERT INTO gun_nodes (soul, data) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE data = JSON_MERGE_PATCH(data, VALUES(data)), updated_at = NOW()`,
      [soul, JSON.stringify(postData)]
    );

    const parts = soul.split('/');
    let node = gun.get(parts[0]);
    for (let i = 1; i < parts.length; i++) node = node.get(parts[i]);
    node.put(postData);

    if (postData.title) await maybeIndexNode(soul, postData);

    res.json({ ok: true, soul, nostrEventId });
  } catch (err) {
    console.error('❌ /db/create-post error:', err.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ─── Dark Community Creation ──────────────────────────────────────────────────
// POST /db/create-community
// Persists darkMode, rendezvousSeed, rendezvousSoul on the community object.
// If darkMode: true, also writes to the interpoll-rendezvous soul so peers
// with the invite can find the community without it appearing in the index.
// SECURITY: Requires API_WRITE_SECRET
app.post('/db/create-community', async (req, res) => {
  if (!requireSecret(req, res, 'API_WRITE_SECRET')) return;
  const { soul, data } = req.body || {};
  if (!soul || !data)         return res.status(400).json({ error: 'soul and data required' });
  if (protectedReactionSoul(soul)) return res.status(422).json({ error: 'USE_SIGNED_ENGAGEMENT_API' });
  if (!sanitizeSoul(soul))    return res.status(400).json({ error: 'invalid soul format' });

  try {
    const communityData = sanitiseDataObject({
      ...data,
      darkMode:       Boolean(data.darkMode),
      rendezvousSeed: data.rendezvousSeed ?? null,
      rendezvousSoul: data.rendezvousSoul ?? null,
    });

    // Always write the community node itself so invite links resolve
    const parts = soul.split('/');
    let node = gun.get(parts[0]);
    for (let i = 1; i < parts.length; i++) node = node.get(parts[i]);
    node.put(communityData);

    if (dbConnected) {
      await db.execute(
        `INSERT INTO gun_nodes (soul, data) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE data = JSON_MERGE_PATCH(data, VALUES(data)), updated_at = NOW()`,
        [soul, JSON.stringify(communityData)]
      ).catch(err => console.warn('[gun-relay] create-community MySQL write failed:', err.message));
    }

    // Dark communities additionally publish a rendezvous record so invited
    // peers can discover the community without a public index entry.
    if (communityData.darkMode) {
      const rendezvousSoul = `interpoll-rendezvous:${soul}`;
      const rendezvousData = {
        soul,
        rendezvousSeed: communityData.rendezvousSeed,
        rendezvousSoul: communityData.rendezvousSoul,
        updatedAt:      Date.now(),
      };
      gun.get(rendezvousSoul).get('community').put(rendezvousData);

      if (dbConnected) {
        await db.execute(
          `INSERT INTO gun_nodes (soul, data) VALUES (?, ?)
           ON DUPLICATE KEY UPDATE data = VALUES(data), updated_at = NOW()`,
          [`${rendezvousSoul}/community`, JSON.stringify(rendezvousData)]
        ).catch(err => console.warn('[gun-relay] rendezvous MySQL write failed:', err.message));
      }
    }

    res.json({ ok: true, soul, darkMode: communityData.darkMode });
  } catch (err) {
    console.error('❌ /db/create-community error:', err.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ─── Epoch Rotation Listener ──────────────────────────────────────────────────
// Fired by the cron in index.js when dark community epochs rotate.
// Each community gets a fresh rendezvous record written to Gun so peers
// holding invite links can re-discover using the new epoch data.
// NOTE: the cron payload is { id, displayName, createdAt, rendezvousSeed, soul }
// — it does NOT carry rendezvousSoul, so we omit it here. Clients derive
// rendezvousSoul themselves from rendezvousSeed + epoch (same as at creation).
server.on('epoch-rotate', (communities) => {
  if (!Array.isArray(communities)) return;
  for (const c of communities) {
    if (!c?.soul) continue;
    try {
      const rendezvousData = {
        soul:           c.soul,
        rendezvousSeed: c.rendezvousSeed ?? null,
        epoch:          c.epoch          ?? null,
        updatedAt:      Date.now(),
      };
      gun.get(`interpoll-rendezvous:${c.soul}`).get('community').put(rendezvousData);

      if (dbConnected) {
        const rendezvousSoul = `interpoll-rendezvous:${c.soul}/community`;
        db.execute(
          `INSERT INTO gun_nodes (soul, data) VALUES (?, ?)
           ON DUPLICATE KEY UPDATE data = VALUES(data), updated_at = NOW()`,
          [rendezvousSoul, JSON.stringify(rendezvousData)]
        ).catch(err => console.warn('[gun-relay] epoch-rotate MySQL write failed:', err.message));
      }
    } catch (err) {
      console.warn('[gun-relay] epoch-rotate write failed for', c.soul, ':', err.message);
    }
  }
});

// ─── Direct MySQL REST API ────────────────────────────────────────────────────
app.get('/db/soul', async (req, res) => {
  const soul = req.query.soul;
  if (!soul || typeof soul !== 'string')
    return res.status(400).json(makeError(ErrorCodes.SCHEMA_INVALID, 'soul query parameter required'));
  if (!validateSoulPath(soul, 500))
    return res.status(400).json(makeError(ErrorCodes.SCHEMA_INVALID, 'soul path contains invalid characters'));
  if (!dbConnected) return res.status(503).json({ error: 'db not connected' });
  try {
    const [rows] = await db.execute('SELECT data FROM gun_nodes WHERE soul = ?', [soul]);
    if (rows.length === 0) return res.status(404).json({ error: 'not found' });
    res.json({ soul, data: JSON.parse(rows[0].data) });
  } catch (err) {
    console.error('❌ /db/soul error:', err.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

// POST /db/write — write a soul directly to MySQL and inject into Gun graph.
// SECURITY: Requires API_WRITE_SECRET
app.post('/db/write', async (req, res) => {
  if (!requireSecret(req, res, 'API_WRITE_SECRET')) return;

  const { soul, data } = req.body;
  if (!soul || data === undefined) return res.status(400).json({ error: 'missing soul or data' });
  if (protectedReactionSoul(soul)) return res.status(422).json({ error: 'USE_SIGNED_ENGAGEMENT_API' });
  if (!sanitizeSoul(soul))         return res.status(400).json({ error: 'invalid soul format' });
  if (!dbConnected)                return res.status(503).json({ error: 'db not connected' });

  const sanitised = sanitiseDataObject(data);
  try {
    // Dark community guard: if this write is targeting the community index,
    // check every key in the payload. Strip any entries whose community has
    // darkMode: true before writing. If all keys are dark, return early.
    if (soul === COMMUNITY_INDEX_SOUL) {
      const keys = Object.keys(sanitised);
      const darkChecks = await Promise.all(keys.map(k => isCommunityDark(k)));
      const filteredKeys = keys.filter((_, i) => !darkChecks[i]);
      if (filteredKeys.length === 0) {
        // Every entry in this write is for a dark community — nothing to index.
        return res.json({ ok: true, soul, skipped: 'all entries are dark communities' });
      }
      if (filteredKeys.length < keys.length) {
        // Partial: rebuild payload without the dark community keys.
        const allowedData = {};
        for (const k of filteredKeys) allowedData[k] = sanitised[k];
        // Replace all keys on sanitised in-place (referenced below for Gun put).
        for (const k of keys) delete sanitised[k];
        Object.assign(sanitised, allowedData);
      }
    }

    await db.execute(
      `INSERT INTO gun_nodes (soul, data) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE
         data = JSON_MERGE_PATCH(data, VALUES(data)),
         updated_at = NOW()`,
      [soul, JSON.stringify(sanitised)]
    );

    const parts = soul.replace(/^v2\//, '').split('/');
    let node = gun.get('v2');
    for (const part of parts) node = node.get(part);
    node.put(sanitised);

    const isPost = /\/posts\/post-[^/]+$/.test(soul);
    const isPoll = /\/polls\/poll-[^/]+$/.test(soul);
    if ((isPost && sanitised.title) || (isPoll && sanitised.question)) {
      await maybeIndexNode(soul, sanitised);
    }

    res.json({ ok: true, soul });
  } catch (err) {
    console.error('❌ /db/write error:', err.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

app.get('/db/search', async (req, res) => {
  const prefix = req.query.prefix;
  if (!prefix || typeof prefix !== 'string')
    return res.status(400).json(makeError(ErrorCodes.SCHEMA_INVALID, 'prefix query parameter required'));
  if (!validateSoulPath(prefix, 500))
    return res.status(400).json(makeError(ErrorCodes.SCHEMA_INVALID, 'prefix contains invalid characters'));
  if (!dbConnected) return res.status(503).json({ error: 'db not connected' });
  try {
    const escapedPrefix = prefix.replace(/[%_\\]/g, '\\$&');
    const limitParam    = req.query.limit;
    if (limitParam !== undefined && isNaN(parseInt(limitParam)))
      return res.status(400).json(makeError(ErrorCodes.SCHEMA_INVALID, 'limit must be a positive integer'));
    const safeLimit = Math.max(1, Math.min(parseInt(limitParam) || 100, 500));

    const [rows] = await db.execute(
      `SELECT soul, data FROM gun_nodes WHERE soul LIKE ? ESCAPE '\\\\' LIMIT ${safeLimit}`,
      [`${escapedPrefix}%`]
    );
    const results = rows.map(r => {
      try { return { soul: r.soul, data: JSON.parse(r.data) }; }
      catch { return { soul: r.soul, data: {} }; }
    });
    const resultStr = JSON.stringify({ results });
    if (resultStr.length > 1048576)
      return res.status(413).json(makeError(ErrorCodes.PAYLOAD_TOO_LARGE, 'Result set too large'));
    res.json(JSON.parse(resultStr));
  } catch (err) {
    console.error('❌ /db/search error:', err.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

// Shared helper — find a gun_node by soul pattern and validate it has a key field.
async function findNodeByPattern(likePattern, exactSoul, dataKey) {
  const [rows] = await db.execute(
    `SELECT soul, data FROM gun_nodes WHERE soul LIKE ? ESCAPE '\\\\' OR soul = ? LIMIT 10`,
    [likePattern, exactSoul]
  );
  if (rows.length === 0) return null;
  for (const row of rows) {
    try {
      const data = JSON.parse(row.data);
      if (data?.[dataKey]) return { soul: row.soul, data };
    } catch { /* skip */ }
  }
  return null;
}

app.get('/db/find-post', async (req, res) => {
  const postId = req.query.postId;
  if (!postId)                                            return res.status(400).json({ error: 'missing postId param' });
  if (typeof postId !== 'string' || postId.length > 200) return res.status(400).json({ error: 'invalid postId' });
  if (!dbConnected)                                       return res.status(503).json({ error: 'db not connected' });
  try {
    const esc    = postId.replace(/[%_\\]/g, '\\$&');
    const result = await findNodeByPattern(`%/posts/${esc}`, `posts/${postId}`, 'title');
    if (!result) return res.status(404).json({ error: 'not found' });
    res.json(result);
  } catch (err) {
    console.error('❌ /db/find-post error:', err.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

app.get('/db/find-poll', async (req, res) => {
  const pollId = req.query.pollId;
  if (!pollId)                                            return res.status(400).json({ error: 'missing pollId param' });
  if (typeof pollId !== 'string' || pollId.length > 200) return res.status(400).json({ error: 'invalid pollId' });
  if (!dbConnected)                                       return res.status(503).json({ error: 'db not connected' });
  try {
    const esc    = pollId.replace(/[%_\\]/g, '\\$&');
    const result = await findNodeByPattern(`%/polls/${esc}`, `polls/${pollId}`, 'question');
    if (!result) return res.status(404).json({ error: 'not found' });
    res.json(result);
  } catch (err) {
    console.error('❌ /db/find-poll error:', err.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ─── Admin endpoints ──────────────────────────────────────────────────────────
// SECURITY: Requires ADMIN_SECRET
app.get('/admin/reindex', (req, res) => {
  if (!requireSecret(req, res, 'ADMIN_SECRET')) return;
  res.json({ message: 'Backfill started' });
  backfillSearchIndex();
});

// ─── Debug & Health ───────────────────────────────────────────────────────────
app.get('/db/votes-debug', async (req, res) => {
  const postId = req.query.postId;
  if (!postId) return res.status(400).json({ error: 'postId required' });
  try {
    const escaped = postId.replace(/[%_\\]/g, '\\$&');
    const [rows] = await db.execute(
      `SELECT soul, data, updated_at FROM gun_nodes WHERE soul LIKE ? ESCAPE '\\\\'`,
      [`v3/postVotes/${escaped}/%`]
    );
    res.json({
      count: rows.length,
      rows:  rows.map(r => ({ soul: r.soul, data: JSON.parse(r.data), updated_at: r.updated_at })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/health', async (req, res) => {
  let dbRows = 0;
  if (db && dbConnected) {
    try {
      const [rows] = await db.execute('SELECT COUNT(*) as count FROM gun_nodes');
      dbRows = rows[0].count;
    } catch { /* non-fatal */ }
  }
  const mem = process.memoryUsage();
  res.json({
    status:    'ok',
    uptime:    process.uptime(),
    peers:     Object.keys(gun._.opt.peers || {}).length,
    database:  { status: dbConnected ? 'connected' : 'disconnected', rows: dbRows },
    buffered:  nodeBuffer.size,
    timestamp: Date.now(),
    memory: {
      heapUsed:  Math.round(mem.heapUsed  / 1024 / 1024),
      heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
    },
  });
});

// ─── Info page ────────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  const proto = NODE_ENV === 'production' ? 'wss'   : 'ws';
  const http_ = NODE_ENV === 'production' ? 'https' : 'http';
  const host  = req.get('host') || `localhost:${PORT}`;
  res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Gun Relay</title>
  <style>body{font-family:sans-serif;background:#667eea;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
  .card{background:#fff;border-radius:12px;padding:40px;max-width:500px;width:100%}
  h1{margin-bottom:8px}pre{background:#f5f5f5;padding:12px;border-radius:8px;font-size:13px}</style></head>
  <body><div class="card">
  <h1>🔫 Gun.js Relay (Enhanced)</h1>
  <p>Status: <strong style="color:green">ONLINE</strong> | DB: <strong>${dbConnected ? '✅ MySQL' : '⚠️ Memory'}</strong></p>
  <p>Features: <strong>Search Indexing ✅ | Auto Backfill ✅ | Array Guard ✅</strong></p>
  <pre>WebSocket  : ${proto}://${host}/gun\nHTTP       : ${http_}://${host}/gun\nHealth     : ${http_}://${host}/health\nReindex    : ${http_}://${host}/admin/reindex\nFind post  : ${http_}://${host}/db/find-post?postId=POST_ID\nFind poll  : ${http_}://${host}/db/find-poll?pollId=POLL_ID\nSoul       : ${http_}://${host}/db/soul?soul=SOUL\nDB Search  : ${http_}://${host}/db/search?prefix=PREFIX</pre>
  </div></body></html>`);
});

// ─── Start ────────────────────────────────────────────────────────────────────
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🔫 Enhanced Gun Relay on :${PORT}`);
  console.log(`   DB:     ${dbConnected ? '✅ MySQL' : '⚠️  Memory only'}`);
  console.log(`   Search: ${dbConnected ? '✅ Auto-indexing (direct)' : '❌ DISABLED (no MySQL)'}`);

  if (dbConnected) setTimeout(backfillSearchIndex, 3000);
  void loadCategorisationQueue();
});

// ─── Graceful shutdown ────────────────────────────────────────────────────────
process.on('SIGINT', async () => {
  console.log('\n👋 Flushing buffers...');
  await Promise.all([...nodeBuffer.keys()].map(flushNode));
  if (db) await db.end();
  server.close(() => { console.log('✅ Done'); process.exit(0); });
  setTimeout(() => process.exit(1), 10000);
});

process.on('uncaughtException',  (err) => { console.error('❌', err); process.exit(1); });
process.on('unhandledRejection', (r)   => { console.error('❌', r);   process.exit(1); });
