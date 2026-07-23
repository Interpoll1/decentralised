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
import { validateSearchQuery, validateSoulPath } from '../shared-validation/index.js';
import { ErrorCodes, makeError } from '../shared-validation/errors.js';
import fs from 'fs';

const PORT = process.env.PORT || 8765;
const NODE_ENV = process.env.NODE_ENV || 'development';
const RELAY_SERVER_URL = process.env.RELAY_SERVER_URL || 'http://localhost:3001';
const DATA_DIR = process.env.GUN_DATA_DIR || new URL('./data', import.meta.url).pathname;
const GUN_FILE = `${DATA_DIR}/radata`;

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const app = express();

// ─── MySQL ────────────────────────────────────────────────────────────────────
let db = null;
let dbConnected = false;

// MySQL TLS config. Secure by default (verify the server certificate). Provide a
// CA bundle via MYSQL_SSL_CA for private/self-signed CAs, or explicitly opt out
// of verification for local dev only with MYSQL_SSL_INSECURE=true. Never silently
// disable verification, which would allow an on-path attacker to MITM the DB.
function buildMysqlSsl() {
  if (process.env.MYSQL_SSL_CA) {
    return { ca: fs.readFileSync(process.env.MYSQL_SSL_CA), rejectUnauthorized: true };
  }
  if (process.env.MYSQL_SSL_INSECURE === 'true') {
    console.warn('⚠️  MySQL TLS verification DISABLED (MYSQL_SSL_INSECURE=true) — dev only, do not use in production');
    return { rejectUnauthorized: false };
  }
  return { rejectUnauthorized: true };
}

async function initMySQL() {
  try {
    if (!process.env.MYSQL_HOST) {
      console.warn('⚠️  MYSQL_HOST not set, running in memory-only mode');
      return false;
    }
    db = await mysql.createPool({
      host: process.env.MYSQL_HOST,
      user: process.env.MYSQL_USER,
      password: process.env.MYSQL_PASSWORD,
      database: process.env.MYSQL_DATABASE,
      port: process.env.MYSQL_PORT ? parseInt(process.env.MYSQL_PORT) : 3306,
      waitForConnections: true,
      connectionLimit: 10,
      ssl: buildMysqlSsl(),
    });
    await db.execute(`
      CREATE TABLE IF NOT EXISTS gun_nodes (
        soul VARCHAR(500) PRIMARY KEY,
        data LONGTEXT NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    dbConnected = true;
    console.log('✅ MySQL connected');
    return true;
  } catch (err) {
    console.error('❌ MySQL connection failed:', err.message);
    dbConnected = false;
    return false;
  }
}

await initMySQL();

// ─── Search Indexing ──────────────────────────────────────────────────────────
async function indexToRelayServer(type, id, data) {
  if (!process.env.API_INDEX_SECRET) {
    console.warn('⚠️  API_INDEX_SECRET not set — search indexing disabled');
    return;
  }
  try {
    const response = await fetch(`${RELAY_SERVER_URL}/api/index`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.API_INDEX_SECRET || ''}`,
      },
      body: JSON.stringify({ type, id, data }),
    });
    if (!response.ok) {
      console.warn(`⚠️  Search indexing failed for ${type}:${id} — ${response.status}`);
    }
  } catch (err) {
    console.error('❌ Search indexing error:', err.message);
  }
}

async function maybeIndexNode(soul, fullData) {
  const isPost = /\/posts\/post-[^/]+$/.test(soul);
  const isPoll = /\/polls\/poll-[^/]+$/.test(soul);

  if (isPost && fullData.title) {
    await indexToRelayServer('post', fullData.id || soul.split('/').pop(), {
      title:         fullData.title,
      content:       fullData.content || '',
      authorName:    fullData.authorName || 'Anonymous',
      communitySlug: fullData.communityId || '',
      createdAt:     fullData.createdAt || Date.now(),
    });
  } else if (isPoll && fullData.question) {
    await indexToRelayServer('poll', fullData.id || soul.split('/').pop(), {
      question:      fullData.question,
      description:   fullData.description || '',
      authorName:    fullData.authorName || 'Anonymous',
      communitySlug: fullData.communityId || '',
      createdAt:     fullData.createdAt || Date.now(),
    });
  }
}

// ─── Value sanitiser ──────────────────────────────────────────────────────────
// Gun's storage layer rejects JS arrays ("Invalid data: Array").
// The voters field was previously stored as an array; it is now stored as
// { uid: true } objects.  This guard is a safety net: if an array somehow
// reaches this layer (e.g. from legacy data or a client that hasn't been
// updated yet) we convert it rather than letting it propagate.

function sanitiseValue(value) {
  if (Array.isArray(value)) {
    // Convert array to indexed object — Gun-safe, information preserved
    const obj = {};
    value.forEach((v, i) => { obj[i] = v; });
    console.warn('[sanitise] Array converted to object for Gun storage');
    return obj;
  }
  return value;
}

// ─── In-memory node accumulator ───────────────────────────────────────────────
const nodeBuffer = new Map();
const flushTimers = new Map();

async function flushNode(soul) {
  if (!dbConnected || !nodeBuffer.has(soul)) return;
  const data = nodeBuffer.get(soul);
  nodeBuffer.delete(soul);
  flushTimers.delete(soul);
  try {
    await db.execute(
      `INSERT INTO gun_nodes (soul, data) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE 
         data = JSON_MERGE_PATCH(data, VALUES(data)),
         updated_at = NOW()`,
      [soul, JSON.stringify(data)]
    );

    const isPost = /\/posts\/post-[^/]+$/.test(soul);
    const isPoll = /\/polls\/poll-[^/]+$/.test(soul);

    if (isPost || isPoll) {
      try {
        const [rows] = await db.execute('SELECT data FROM gun_nodes WHERE soul = ?', [soul]);
        if (rows.length > 0) {
          const fullData = JSON.parse(rows[0].data);
          await maybeIndexNode(soul, fullData);
        }
      } catch (err) {
        console.error('❌ Auto-index fetch error:', err.message);
      }
    }
  } catch (err) {
    console.error('❌ MySQL flush error:', err.message);
  }
}

function bufferField(soul, field, value) {
  if (!nodeBuffer.has(soul)) nodeBuffer.set(soul, {});
  // Sanitise before buffering — never let an array reach MySQL JSON_MERGE_PATCH
  nodeBuffer.get(soul)[field] = sanitiseValue(value);
  if (flushTimers.has(soul)) clearTimeout(flushTimers.get(soul));
  flushTimers.set(soul, setTimeout(() => flushNode(soul), 200));
}

// ─── Automatic Backfill ───────────────────────────────────────────────────────
async function backfillSearchIndex() {
  if (!dbConnected) return;
  console.log('🔄 Starting search index backfill...');

  try {
    const [rows] = await db.execute(`
      SELECT soul, data FROM gun_nodes
      WHERE soul REGEXP '/posts/post-[^/]+$'
         OR soul REGEXP '/polls/poll-[^/]+$'
    `);

    if (rows.length === 0) {
      console.log('ℹ️  No posts/polls found to backfill');
      return;
    }

    console.log(`📦 Found ${rows.length} nodes to backfill into search index`);

    let indexed = 0;
    let skipped = 0;

    for (const row of rows) {
      try {
        const fullData = JSON.parse(row.data);
        const isPost = /\/posts\/post-[^/]+$/.test(row.soul);
        const isPoll = /\/polls\/poll-[^/]+$/.test(row.soul);

        if (isPost && !fullData.title) { skipped++; continue; }
        if (isPoll && !fullData.question) { skipped++; continue; }

        await maybeIndexNode(row.soul, fullData);
        indexed++;
        await new Promise(r => setTimeout(r, 50));
      } catch (err) {
        console.error(`❌ Backfill error for ${row.soul}:`, err.message);
      }
    }

    console.log(`✅ Backfill complete — indexed: ${indexed}, skipped: ${skipped}`);
  } catch (err) {
    console.error('❌ Backfill failed:', err.message);
  }
}

// ─── Gun Storage Adapter ──────────────────────────────────────────────────────
function wireMySQL(gun) {
  if (!dbConnected) return;

  gun.on('put', function (msg) {
    this.to.next(msg);
    const put = msg?.put;
    if (!put) return;
    const soul = put['#'];
    const field = put['.'];
    const value = put[':'];
    if (!soul || field === undefined || value === undefined) return;
    if (soul.startsWith('~') || soul === 'undefined') return;

    // Drop array values at the wire level — they should never arrive here
    // after the client fix, but this is a hard backstop.
    if (Array.isArray(value)) {
      console.warn(`[gun-relay] Blocked array write at ${soul}.${field} — client needs updating`);
      return;
    }

    bufferField(soul, field, value);
  });

  gun.on('get', async function (msg) {
    this.to.next(msg);
    const soul = msg?.get?.['#'];
    if (!soul || !dbConnected) return;
    let conn;
    try {
      conn = await db.getConnection();
      const [rows] = await conn.execute('SELECT data FROM gun_nodes WHERE soul = ?', [soul]);
      if (rows.length === 0) return;
      const node = JSON.parse(rows[0].data);
      gun._.root.on('in', { '@': msg['#'], put: { [soul]: node } });
    } catch (err) {
      console.error('❌ MySQL get error:', err.message);
    } finally {
      if (conn) conn.release();
    }
  });

  console.log('✅ MySQL Gun storage adapter wired with search indexing');
}

// ─── CORS & Security ──────────────────────────────────────────────────────────
// Fully open CORS: any origin, no credentials (public decentralized access)
app.use(cors({ origin: '*' }));

// Body size limit
app.use((req, res, next) => {
  if (req.method === 'POST' || req.method === 'PUT') {
    let size = 0;
    let destroyed = false;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 65536 && !destroyed) {
        destroyed = true;
        req.destroy();
        if (!res.headersSent) {
          res.status(413).json(makeError(ErrorCodes.PAYLOAD_TOO_LARGE, 'Request body exceeds 64KB'));
        }
      }
    });
  }
  next();
});

// Security headers on all responses
app.use((req, res, next) => {
  setSecurityHeaders(res);
  next();
});

// Rate limiting
const httpRateLimit = createRateLimitMiddleware(60, 60000);
app.use((req, res, next) => {
  if (httpRateLimit(req, res)) next();
});

app.use(express.json({ limit: '100kb' }));
app.use(Gun.serve);

const server = http.createServer(app);

// ─── Gun ──────────────────────────────────────────────────────────────────────
const gun = Gun({
  web: server,
  radisk: true,
  file: GUN_FILE,
  localStorage: false,
  multicast: false,
  peers: process.env.GUN_PEERS ? process.env.GUN_PEERS.split(',') : [],
});

wireMySQL(gun);

// ─── Direct MySQL REST API ────────────────────────────────────────────────────
app.get('/db/soul', async (req, res) => {
  const soul = req.query.soul;
  if (!soul || typeof soul !== 'string') {
    return res.status(400).json(makeError(ErrorCodes.SCHEMA_INVALID, 'soul query parameter required'));
  }
  if (!validateSoulPath(soul, 500)) {
    return res.status(400).json(makeError(ErrorCodes.SCHEMA_INVALID, 'soul path contains invalid characters'));
  }
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

// POST /db/write — write a soul directly to MySQL and inject into Gun graph
// SECURITY: Requires API_WRITE_SECRET
app.post('/db/write', async (req, res) => {
  if (!requireSecret(req, res, 'API_WRITE_SECRET')) return;

  const { soul, data } = req.body;
  if (!soul || data === undefined) return res.status(400).json({ error: 'missing soul or data' });
  if (!sanitizeSoul(soul)) return res.status(400).json({ error: 'invalid soul format' });
  if (!dbConnected) return res.status(503).json({ error: 'db not connected' });

  // Sanitise any arrays in the incoming data before storing
  const sanitised = sanitiseDataObject(data);

  try {
    const json = JSON.stringify(sanitised);
    await db.execute(
      `INSERT INTO gun_nodes (soul, data) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE
         data = JSON_MERGE_PATCH(data, VALUES(data)),
         updated_at = NOW()`,
      [soul, json]
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

// Recursively sanitise an object — convert any arrays to indexed objects
function sanitiseDataObject(data) {
  if (data === null || data === undefined) return data;
  if (Array.isArray(data)) {
    const obj = {};
    data.forEach((v, i) => { obj[i] = sanitiseDataObject(v); });
    return obj;
  }
  if (typeof data === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(data)) {
      out[k] = sanitiseDataObject(v);
    }
    return out;
  }
  return data;
}

app.get('/db/search', async (req, res) => {
  const prefix = req.query.prefix;
  if (!prefix || typeof prefix !== 'string') {
    return res.status(400).json(makeError(ErrorCodes.SCHEMA_INVALID, 'prefix query parameter required'));
  }
  if (!validateSoulPath(prefix, 500)) {
    return res.status(400).json(makeError(ErrorCodes.SCHEMA_INVALID, 'prefix contains invalid characters'));
  }
  if (!dbConnected) return res.status(503).json({ error: 'db not connected' });
  try {
    const escapedPrefix = prefix.replace(/[%_\\]/g, '\\$&');
    const safeLimit = Math.max(1, Math.min(parseInt(req.query.limit) || 100, 500));
    if (isNaN(parseInt(req.query.limit)) && req.query.limit !== undefined) {
      return res.status(400).json(makeError(ErrorCodes.SCHEMA_INVALID, 'limit must be a positive integer'));
    }
    const [rows] = await db.execute(
      `SELECT soul, data FROM gun_nodes WHERE soul LIKE ? ESCAPE '\\\\' LIMIT ${safeLimit}`,
      [`${escapedPrefix}%`]
    );
    const results = rows.map(r => {
      try { return { soul: r.soul, data: JSON.parse(r.data) }; }
      catch { return { soul: r.soul, data: {} }; }
    });
    const resultStr = JSON.stringify({ results });
    if (resultStr.length > 1048576) {
      return res.status(413).json(makeError(ErrorCodes.PAYLOAD_TOO_LARGE, 'Result set too large'));
    }
    res.json(JSON.parse(resultStr));
  } catch (err) {
    console.error('❌ /db/search error:', err.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

app.get('/db/find-post', async (req, res) => {
  const postId = req.query.postId;
  if (!postId) return res.status(400).json({ error: 'missing postId param' });
  if (typeof postId !== 'string' || postId.length > 200) return res.status(400).json({ error: 'invalid postId' });
  if (!dbConnected) return res.status(503).json({ error: 'db not connected' });
  try {
    const escapedId = postId.replace(/[%_\\]/g, '\\$&');
    const [rows] = await db.execute(
      `SELECT soul, data FROM gun_nodes 
       WHERE soul LIKE ? ESCAPE ? 
       OR soul = ?
       LIMIT 10`,
      [`%/posts/${escapedId}`, '\\', `posts/${postId}`]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'not found' });
    for (const row of rows) {
      try {
        const data = JSON.parse(row.data);
        if (data?.title) return res.json({ soul: row.soul, data });
      } catch { /* skip */ }
    }
    res.status(404).json({ error: 'not found' });
  } catch (err) {
    console.error('❌ /db/find-post error:', err.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

app.get('/db/find-poll', async (req, res) => {
  const pollId = req.query.pollId;
  if (!pollId) return res.status(400).json({ error: 'missing pollId param' });
  if (typeof pollId !== 'string' || pollId.length > 200) return res.status(400).json({ error: 'invalid pollId' });
  if (!dbConnected) return res.status(503).json({ error: 'db not connected' });
  try {
    const escapedId = pollId.replace(/[%_\\]/g, '\\$&');
    const [rows] = await db.execute(
      `SELECT soul, data FROM gun_nodes 
       WHERE soul LIKE ? ESCAPE ?
       OR soul = ?
       LIMIT 10`,
      [`%/polls/${escapedId}`, '\\', `polls/${pollId}`]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'not found' });
    for (const row of rows) {
      try {
        const data = JSON.parse(row.data);
        if (data?.question) return res.json({ soul: row.soul, data });
      } catch { /* skip */ }
    }
    res.status(404).json({ error: 'not found' });
  } catch (err) {
    console.error('❌ /db/find-poll error:', err.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ─── Reindex endpoint ─────────────────────────────────────────────────────────
// SECURITY: Requires ADMIN_SECRET
app.get('/admin/reindex', async (req, res) => {
  if (!requireSecret(req, res, 'ADMIN_SECRET')) return;
  res.json({ message: 'Backfill started, check server logs' });
  backfillSearchIndex();
});

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/health', async (req, res) => {
  let dbRows = 0;
  if (db && dbConnected) {
    try {
      const [rows] = await db.execute('SELECT COUNT(*) as count FROM gun_nodes');
      dbRows = rows[0].count;
    } catch { /* ignore */ }
  }
  const mem = process.memoryUsage();
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    peers: Object.keys(gun._.opt.peers || {}).length,
    database: { status: dbConnected ? 'connected' : 'disconnected', rows: dbRows },
    buffered: nodeBuffer.size,
    timestamp: Date.now(),
    memory: {
      heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
      heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
    },
  });
});

// ─── Info page ────────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  const proto = NODE_ENV === 'production' ? 'wss' : 'ws';
  const http_ = NODE_ENV === 'production' ? 'https' : 'http';
  const host = req.get('host') || `localhost:${PORT}`;
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
  console.log(`   DB: ${dbConnected ? '✅ MySQL' : '⚠️ Memory only'}`);
  console.log(`   Search: ✅ Auto-indexing to ${RELAY_SERVER_URL}`);
  console.log(`   Array guard: ✅ Blocks invalid array writes`);

  if (dbConnected) {
    setTimeout(backfillSearchIndex, 3000);
  }
});

// ─── Graceful shutdown ────────────────────────────────────────────────────────
process.on('SIGINT', async () => {
  console.log('\n👋 Flushing buffers...');
  await Promise.all([...nodeBuffer.keys()].map(flushNode));
  if (db) await db.end();
  server.close(() => { console.log('✅ Done'); process.exit(0); });
  setTimeout(() => process.exit(1), 10000);
});

process.on('uncaughtException', (err) => { console.error('❌', err); process.exit(1); });
process.on('unhandledRejection', (r) => { console.error('❌', r); process.exit(1); });

setInterval(async () => {
  if (db && dbConnected) {
    try { await db.execute('SELECT 1'); }
    catch (err) {
      console.error('❌ MySQL ping failed, reconnecting...', err.message);
      dbConnected = false;
      await initMySQL();
    }
  }
}, 30000);
