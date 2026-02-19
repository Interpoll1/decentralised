#!/usr/bin/env node
// peer.js
// Headless "fake client" that stays online forever.
// It behaves exactly like a browser client: connects to the WS relay and
// Gun relay, stores every block / event it sees, and when a new real
// client comes online and sends request-sync the peer answers with
// everything it has.  Gun data (polls, communities, posts, images) is
// replicated automatically through Gun's built-in sync + radisk
// persistence.
//
// Usage:
//   node peer.js
//   node peer.js --ws ws://myserver:8080 --gun http://myserver:8765/gun --api http://myserver:8080
//   node peer.js --data /mnt/storage/peer-data

import WebSocket from 'ws';
import Gun from 'gun';
import fs from 'fs';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';
console.log('WSS Initialized, this is @thegoodduck and @theendless11, built with love ❤️');
// ─── Config ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
function flag(name, fallback) {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
}

const WS_URL   = flag('--ws',   'wss://interpoll.onrender.com');
const GUN_URL  = flag('--gun',  'https://interpoll2.onrender.com/gun');
const API_URL  = flag('--api',  'https://interpoll.onrender.com');
const DATA_DIR = flag('--data', path.join(path.dirname(fileURLToPath(import.meta.url)), 'peer-data'));

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const BLOCKS_FILE  = path.join(DATA_DIR, 'blocks.json');
const EVENTS_FILE  = path.join(DATA_DIR, 'events.json');
const SERVERS_FILE = path.join(DATA_DIR, 'known-servers.json');

// ─── Persistence helpers ─────────────────────────────────────────────────────

function loadJSON(file, fallback) {
  try { if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  return fallback;
}
function saveJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

const blocks       = loadJSON(BLOCKS_FILE,  []);
const events       = loadJSON(EVENTS_FILE,  []);   // Nostr-style signed events
let   knownServers = loadJSON(SERVERS_FILE, []);

const MAX_BLOCKS = 10000;
const MAX_EVENTS = 5000;

// ─── Stats ───────────────────────────────────────────────────────────────────

const stats = {
  blocksStored:   blocks.length,
  eventsStored:   events.length,
  pollsSeen:      0,
  syncRequests:   0,
  messagesIn:     0,
  gunUpdates:     0,
  connected:      false,
  startedAt:      Date.now(),
};

// ─── Gun – data layer replication ────────────────────────────────────────────
// Gun only replicates paths that someone actively listens to.  We do a
// periodic one-shot sweep (`.once()`) instead of permanent `.on()` listeners
// so Gun can garbage-collect its in-memory graph between sweeps.  radisk
// keeps everything on disk so nothing is lost.

const gunServer = http.createServer();
gunServer.listen(0, '127.0.0.1', () => {
  log(`Gun bound to internal port ${gunServer.address().port}`);
});

const gun = Gun({
  peers: [GUN_URL],
  web: gunServer,
  radisk: true,
  localStorage: false,
  file: path.join(DATA_DIR, 'gun-data'),
  multicast: false,
});

// Periodic sweep: touch every collection with .once() so Gun replicates data
// to disk via radisk, then let go of the in-memory references.
function sweepGunData() {
  for (const coll of ['polls', 'communities', 'images', 'posts']) {
    gun.get(coll).map().once((data, key) => {
      if (!data || String(key).startsWith('_')) return;
      stats.gunUpdates++;
    });
  }

  // Fetch nested structures with .once() – no permanent listeners
  gun.get('polls').map().once((data, id) => {
    if (!data || !id || id.startsWith('_')) return;
    const node = gun.get('polls').get(id);
    node.get('options').map().once(() => {});
    node.get('inviteCodes').map().once(() => {});
    node.get('inviteCodesByCode').map().once(() => {});
  });

  gun.get('communities').map().once((data, id) => {
    if (!data || !id || id.startsWith('_')) return;
    const comm = gun.get('communities').get(id);
    comm.get('rules').once(() => {});
    comm.get('polls').map().once((pd, pid) => {
      if (!pd || !pid || pid.startsWith('_')) return;
      comm.get('polls').get(pid).get('options').map().once(() => {});
    });
  });

  gun.get('posts').map().once((data, id) => {
    if (!data || !id || id.startsWith('_')) return;
    gun.get('posts').get(id).get('comments').map().once(() => {});
  });
}

// Initial sweep + repeat every 2 minutes
sweepGunData();
setInterval(sweepGunData, 120_000);

// ─── WebSocket – relay connection (acts like a browser client) ───────────────

const peerId = 'peer-' + Math.random().toString(36).substring(2, 10);
let ws = null;
let reconnectAttempts = 0;

function connect() {
  if (ws) { try { ws.close(); } catch {} ws = null; }

  log(`Connecting to relay ${WS_URL} ...`);

  try {
    ws = new WebSocket(WS_URL);
  } catch (err) {
    log(`WebSocket creation failed: ${err.message}`);
    scheduleReconnect();
    return;
  }

  ws.on('open', () => {
    stats.connected = true;
    reconnectAttempts = 0;
    log('Connected to relay');

    // Same handshake a browser client does
    send({ type: 'register', peerId });
    send({ type: 'join-room', roomId: 'default' });

    // Tell other peers about our relay URLs and that we're a self-hosted peer
    broadcast('peer-addresses', {
      peerId,
      relayUrl: WS_URL,
      gunPeers: [GUN_URL],
      selfHosted: true,
      joinedAt: Date.now(),
    });

    // Always include our own address in the server list before sharing
    const ownServer = {
      websocket: WS_URL,
      gun: GUN_URL,
      api: API_URL,
      addedBy: peerId,
      firstSeen: Date.now(),
      selfHosted: true,
    };
    mergeServerList([ownServer], peerId);

    // Share known servers (now always includes ourselves)
    broadcast('server-list', { peerId, servers: knownServers });

    // Ask existing peers for their blocks (like a browser does on startup)
    setTimeout(() => broadcast('request-sync', { peerId }), 1000);
  });

  ws.on('message', (raw) => {
    try { handleMessage(JSON.parse(raw.toString())); } catch {}
  });

  ws.on('close', () => {
    stats.connected = false;
    log('Disconnected');
    scheduleReconnect();
  });

  ws.on('error', () => {});
}

function scheduleReconnect() {
  reconnectAttempts++;
  const delay = Math.min(3000 * reconnectAttempts, 30000);
  log(`Reconnecting in ${(delay / 1000).toFixed(0)}s ...`);
  setTimeout(connect, delay);
}

function send(obj) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

function broadcast(type, data) {
  send({ type: 'broadcast', data: { type, data, timestamp: Date.now() } });
}

// ─── Message handling ────────────────────────────────────────────────────────

function handleMessage(msg) {
  stats.messagesIn++;

  // Relay system messages
  if (msg.type === 'welcome') return;
  if (msg.type === 'peer-list') { log(`Peers online: ${(msg.peers || []).length}`); return; }
  if (msg.type === 'peer-left') return;

  const type = msg.type;
  const data = msg.data || msg;

  switch (type) {
    case 'new-block':    onNewBlock(data);    break;
    case 'new-poll':     onNewPoll(data);     break;
    case 'new-event':    onNewEvent(data);    break;
    case 'request-sync': onSyncRequest(data); break;
    case 'sync-response':onSyncResponse(data);break;
    case 'server-list':
      if (data?.servers && Array.isArray(data.servers))
        mergeServerList(data.servers, data.peerId || 'unknown');
      break;
    // peer-addresses, post-presence, etc. – not relevant for replication
  }
}

// ── Blocks ──

function onNewBlock(data) {
  if (!data) return;
  if (blocks.some(b => b.index === data.index && b.currentHash === data.currentHash)) return;
  blocks.push(data);
  blocks.sort((a, b) => a.index - b.index);
  // Cap in-memory size – keep newest blocks
  while (blocks.length > MAX_BLOCKS) blocks.shift();
  stats.blocksStored = blocks.length;
  saveJSON(BLOCKS_FILE, blocks);
  log(`Block #${data.index} stored (${(data.currentHash || '').slice(0, 12)}...)`);
}

// ── Polls (WS notification – Gun already replicates the data) ──

function onNewPoll(data) {
  stats.pollsSeen++;
  log(`Poll received: ${data?.question || data?.id || '?'}`);
}

// ── Nostr-signed events ──

function onNewEvent(data) {
  if (!data?.id) return;
  if (events.some(e => e.id === data.id)) return;
  events.push(data);
  // Cap in-memory size – keep newest events
  while (events.length > MAX_EVENTS) events.shift();
  stats.eventsStored = events.length;
  saveJSON(EVENTS_FILE, events);
  log(`Event stored (kind=${data.kind} id=${data.id.slice(0, 12)}...)`);
}

// ── Sync – same protocol the browser uses ──

function onSyncRequest(data) {
  stats.syncRequests++;
  log(`Sync request from ${data?.peerId || '?'} -> sending ${blocks.length} blocks`);

  // Respond with exactly the same shape the browser's chainStore sends:
  // { blocks: [...], peerId: '...' }
  broadcast('sync-response', {
    blocks,
    peerId,
  });
}

function onSyncResponse(data) {
  if (!data?.blocks || !Array.isArray(data.blocks)) return;
  let added = 0;
  for (const block of data.blocks) {
    if (blocks.some(b => b.index === block.index && b.currentHash === block.currentHash)) continue;
    blocks.push(block);
    added++;
  }
  if (added > 0) {
    blocks.sort((a, b) => a.index - b.index);
    stats.blocksStored = blocks.length;
    saveJSON(BLOCKS_FILE, blocks);
    log(`Sync: +${added} blocks (total ${blocks.length})`);
  }
}

// ── Server discovery ──

function mergeServerList(servers, from) {
  const known = new Set(knownServers.map(s => s.websocket));
  let added = 0;
  for (const s of servers) {
    if (s.websocket && !known.has(s.websocket)) {
      knownServers.push({ ...s, addedBy: s.addedBy || from, firstSeen: s.firstSeen || Date.now() });
      known.add(s.websocket);
      added++;
    }
  }
  if (added) {
    saveJSON(SERVERS_FILE, knownServers);
    log(`+${added} server(s) discovered (total ${knownServers.length})`);
  }
}

// ─── Logging ─────────────────────────────────────────────────────────────────

function log(msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${msg}`);
}

function formatUptime(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}h${m}m${s % 60}s`;
}

setInterval(() => {
  const mem = process.memoryUsage();
  const rss = (mem.rss / 1024 / 1024).toFixed(0);
  const heap = (mem.heapUsed / 1024 / 1024).toFixed(0);
  log(
    `ws=${stats.connected ? 'up' : 'down'} | ` +
    `blocks=${stats.blocksStored} events=${stats.eventsStored} polls=${stats.pollsSeen} | ` +
    `syncs=${stats.syncRequests} msgs=${stats.messagesIn} gun=${stats.gunUpdates} | ` +
    `mem=${rss}MB (heap ${heap}MB) | ` +
    `up ${formatUptime(Date.now() - stats.startedAt)}`
  );
}, 60_000);

// ─── Boot ────────────────────────────────────────────────────────────────────

log('Interpoll headless peer');
log(`  id       : ${peerId}`);
log(`  ws relay : ${WS_URL}`);
log(`  gun relay: ${GUN_URL}`);
log(`  api      : ${API_URL}`);
log(`  data     : ${DATA_DIR}`);
log(`  blocks   : ${blocks.length} on disk`);
log(`  events   : ${events.length} on disk`);
log('');

connect();

// ─── Stay alive forever ──────────────────────────────────────────────────────

process.on('SIGINT', () => {
  log('Shutting down ...');
  saveJSON(BLOCKS_FILE, blocks);
  saveJSON(EVENTS_FILE, events);
  saveJSON(SERVERS_FILE, knownServers);
  if (ws) ws.close();
  gunServer.close();
  process.exit(0);
});

process.on('uncaughtException', (err) => {
  log(`Uncaught: ${err.message}`);
});

process.on('unhandledRejection', (err) => {
  log(`Unhandled rejection: ${err}`);
});