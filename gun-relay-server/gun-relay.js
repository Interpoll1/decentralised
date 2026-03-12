// gun-relay.js
// Self-hosted Gun.js relay server with propagation throttle
// Run with: node gun-relay.js

import express from 'express';
import Gun from 'gun';
import http from 'http';
import cors from 'cors';
import crypto from 'crypto';
import { SpamScorer } from '../spam-scorer.js';

const PORT = process.env.PORT || 8765;
const app = express();

// Enable CORS for all origins
app.use(cors());

// Serve Gun.js
app.use(Gun.serve);

const server = http.createServer(app);

// Initialize Gun
const gun = Gun({
  web: server,
  radisk: true, // Persist data to disk
  localStorage: false,
  multicast: false
});

// ─── Propagation throttle ────────────────────────────────────────────────────

const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;
const MAX_PUT_SIZE = 512 * 1024;
const FLOOD_MULTIPLIER = 3;
const FLOOD_PAUSE_MS = 30_000;
const DEDUP_MAX_HASHES = 50;
const DEDUP_WINDOW_MS = 60_000;
const SPAM_DELAY_MS = 3_000;
const CLEANUP_INTERVAL_MS = 60_000;
const SPAM_TEXT_FIELDS = new Set(['title', 'content', 'description', 'question']);

const peerTracking = new Map();
const anonIds = new WeakMap();
const spamScorer = new SpamScorer();

function getPeerEntry(peerId) {
  let entry = peerTracking.get(peerId);
  if (!entry) {
    entry = { timestamps: [], hashes: [], pausedUntil: 0 };
    peerTracking.set(peerId, entry);
  }
  return entry;
}

function getOrCreateAnonId(msg) {
  // Prefer the mesh wire (stable per connection), then msg._ metadata
  const wire = msg.mesh?.via?.wire || msg.mesh?.via || msg._ || null;
  if (wire && typeof wire === 'object') {
    let id = anonIds.get(wire);
    if (!id) {
      id = 'anon-' + crypto.randomBytes(8).toString('hex');
      anonIds.set(wire, id);
    }
    return id;
  }
  // No stable reference — generate a per-message ID (rate limiting won't apply,
  // but this case is rare and still preferable to a shared bucket)
  return 'anon-' + crypto.randomBytes(8).toString('hex');
}

function getPeerId(msg) {
  return msg.mesh?.via?.url
    || msg.mesh?.via?.id
    || msg._?.via
    // Stable random ID per connection so unidentifiable peers keep separate rate-limit buckets
    || getOrCreateAnonId(msg);
}

function hashData(data) {
  return crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
}

function extractTextFields(putData) {
  const texts = [];
  for (const soul of Object.keys(putData)) {
    const node = putData[soul];
    if (!node || typeof node !== 'object') continue;
    for (const field of Object.keys(node)) {
      if (field === '_') continue;
      if (SPAM_TEXT_FIELDS.has(field) && typeof node[field] === 'string') {
        texts.push(node[field]);
      }
    }
  }
  return texts;
}

gun.on('in', function (msg) {
  const relay = this;

  if (!msg.put) {
    relay.to.next(msg);
    return;
  }

  const peerId = getPeerId(msg);
  const entry = getPeerEntry(peerId);
  const now = Date.now();

  // 1. Flood pause check
  if (now < entry.pausedUntil) {
    return;
  }

  // 2. Content size limit
  let putStr;
  try {
    putStr = JSON.stringify(msg.put);
  } catch {
    console.warn(`⚠️ GunDB unparseable put from peer ${peerId} — dropped`);
    return;
  }

  if (putStr.length > MAX_PUT_SIZE) {
    console.warn(`⚠️ GunDB oversized put from peer ${peerId}: ${putStr.length} bytes`);
    return;
  }

  // 3. Rate limiting (sliding window)
  const windowStart = now - RATE_WINDOW_MS;
  entry.timestamps = entry.timestamps.filter(t => t > windowStart);

  if (entry.timestamps.length >= RATE_LIMIT * FLOOD_MULTIPLIER) {
    entry.pausedUntil = now + FLOOD_PAUSE_MS;
    console.log(`🚫 GunDB flood: peer ${peerId} paused for 30s`);
    return;
  }

  if (entry.timestamps.length >= RATE_LIMIT) {
    return;
  }

  entry.timestamps.push(now);

  // 4. Deduplication (ring buffer of SHA-256 hashes)
  const dataHash = crypto.createHash('sha256').update(putStr).digest('hex');
  const dedupStart = now - DEDUP_WINDOW_MS;
  entry.hashes = entry.hashes.filter(h => h.time > dedupStart);

  if (entry.hashes.some(h => h.hash === dataHash)) {
    return;
  }

  entry.hashes.push({ hash: dataHash, time: now });
  if (entry.hashes.length > DEDUP_MAX_HASHES) {
    entry.hashes.shift();
  }

  // 5. Spam scoring on text fields
  const texts = extractTextFields(msg.put);
  if (texts.length > 0) {
    const combined = texts.join(' ');
    const result = spamScorer.score(combined);

    if (spamScorer.shouldFlag(result)) {
      console.log(`🏴 GunDB spam flagged: ${result.matchCount} matches in ${result.languagesHit.join(', ')}`);
      for (const soul of Object.keys(msg.put)) {
        const node = msg.put[soul];
        if (node && typeof node === 'object') {
          node._flagged = true;
          if (node._?.['>']) {
            node._['>']._flagged = now;
          }
        }
      }
    }

    if (spamScorer.shouldDelay(result)) {
      setTimeout(() => { relay.to.next(msg); }, SPAM_DELAY_MS);
      return;
    }
  }

  relay.to.next(msg);
});

// ─── Stale tracking cleanup ──────────────────────────────────────────────────

const throttleCleanupTimer = setInterval(() => {
  const now = Date.now();
  const staleThreshold = RATE_WINDOW_MS * 2;
  for (const [id, entry] of peerTracking) {
    const latestTs = entry.timestamps.length
      ? entry.timestamps[entry.timestamps.length - 1]
      : 0;
    const latestHash = entry.hashes.length
      ? entry.hashes[entry.hashes.length - 1].time
      : 0;
    const lastActivity = Math.max(latestTs, latestHash, entry.pausedUntil);
    if (now - lastActivity > staleThreshold) {
      peerTracking.delete(id);
    }
  }
}, CLEANUP_INTERVAL_MS);
if (throttleCleanupTimer.unref) throttleCleanupTimer.unref();

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    peers: Object.keys(gun._.opt.peers || {}).length,
    timestamp: Date.now()
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.send(`
    <html>
      <head>
        <title>Gun.js P2P Relay</title>
        <style>
          body {
            font-family: system-ui, -apple-system, sans-serif;
            max-width: 800px;
            margin: 50px auto;
            padding: 20px;
            background: #f5f5f5;
          }
          .card {
            background: white;
            padding: 30px;
            border-radius: 10px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
          }
          h1 { color: #333; margin: 0 0 20px; }
          .status { 
            display: inline-block;
            padding: 5px 15px;
            background: #4CAF50;
            color: white;
            border-radius: 20px;
            font-size: 14px;
            margin-bottom: 20px;
          }
          .info { 
            background: #e3f2fd;
            padding: 15px;
            border-radius: 5px;
            margin: 20px 0;
          }
          code {
            background: #263238;
            color: #aed581;
            padding: 2px 8px;
            border-radius: 3px;
            font-family: 'Courier New', monospace;
          }
          .endpoints {
            margin: 20px 0;
          }
          .endpoint {
            padding: 10px;
            background: #fafafa;
            margin: 10px 0;
            border-left: 3px solid #2196F3;
          }
        </style>
      </head>
      <body>
        <div class="card">
          <h1>🔫 Gun.js P2P Relay Server</h1>
          <span class="status">● ONLINE</span>
          
          <div class="info">
            <strong>📡 Server Info:</strong><br>
            Port: <code>${PORT}</code><br>
            Uptime: <code>${Math.floor(process.uptime())} seconds</code><br>
            Connected Peers: <code>${Object.keys(gun._.opt.peers || {}).length}</code>
          </div>

          <h3>Available Endpoints:</h3>
          <div class="endpoints">
            <div class="endpoint">
              <strong>WebSocket:</strong> <code>ws://localhost:${PORT}/gun</code><br>
              <small>Use this in your Gun.js client configuration</small>
            </div>
            <div class="endpoint">
              <strong>Health Check:</strong> <code>GET /health</code><br>
              <small>Returns server status and peer count</small>
            </div>
          </div>

          <div class="info">
            <strong>🚀 How to use in your app:</strong><br>
            <code>Gun(['http://localhost:${PORT}/gun'])</code>
          </div>

          <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; color: #666; font-size: 14px;">
            <strong>Gun.js</strong> - Decentralized, Offline-First, Realtime Graph Database<br>
            This relay helps peers discover each other but does not control data.
          </div>
        </div>
      </body>
    </html>
  `);
});

server.listen(PORT, () => {
  console.log('');
  console.log('╔════════════════════════════════════════════╗');
  console.log('║   🔫 Gun.js P2P Relay Server Running      ║');
  console.log('╚════════════════════════════════════════════╝');
  console.log('');
  console.log(`📡 WebSocket: ws://localhost:${PORT}/gun`);
  console.log(`🌐 HTTP:      http://localhost:${PORT}`);
  console.log(`💚 Health:    http://localhost:${PORT}/health`);
  console.log('');
  console.log('Press Ctrl+C to stop');
  console.log('');
});

// Graceful shutdown
function shutdown() {
  console.log('\n👋 Shutting down Gun relay server...');
  clearInterval(throttleCleanupTimer);
  clearInterval(peerLogTimer);
  peerTracking.clear();
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Log peer connections
const peerLogTimer = setInterval(() => {
  const peerCount = Object.keys(gun._.opt.peers || {}).length;
  if (peerCount > 0) {
    console.log(`📊 Connected peers: ${peerCount}`);
  }
}, 30000); // Every 30 seconds