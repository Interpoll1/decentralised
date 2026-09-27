/**
 * relay-bridge-server.js — WebSocket tunnel bridge for browser-tab relays
 *
 * Server-side counterpart to src/services/browserRelayService.ts. A browser
 * tab cannot accept inbound connections, so this bridge gives it a public
 * URL and multiplexes every Gun peer that connects to that URL over the tab's
 * single WebSocket.
 *
 *   Tab   ──wss──▶ /tunnel                 register → gets a tunnel id
 *   Peer  ──wss──▶ /tunnel/<id>/gun        ⇄ bridge ⇄ tab (Gun mesh peer)
 *
 * Wire protocol on the tab socket (JSON text frames):
 *   tab → bridge  {type:'register', app:'interpoll'}
 *   bridge → tab  {type:'registered', url, tunnelId}
 *   bridge → tab  {type:'open', c} | {type:'msg', c, d} | {type:'close', c}
 *   bridge → tab  {type:'peers', n}
 *   tab → bridge  {type:'msg', c, d} | {type:'close', c} | {type:'ping'}
 *
 * No DNS wildcard or wildcard cert is needed: tunnels are path-based and ride
 * on the main site's certificate (nginx `location /tunnel` → 127.0.0.1:9000).
 * Payloads are never logged.
 */

import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import crypto from 'crypto';

const BRIDGE_PORT = parseInt(process.env.BRIDGE_PORT || '9000', 10);
const PUBLIC_BASE = (process.env.TUNNEL_PUBLIC_BASE || 'wss://interpoll.endless.sbs/tunnel').replace(/\/+$/, '');
const MAX_CLIENTS_PER_TAB = 50;
const MAX_TABS_PER_IP = 3;
const MAX_PAYLOAD = 1024 * 1024;
const REGISTER_TIMEOUT_MS = 10_000;

/** tunnelId → { tab, clients: Map<cid, ws>, ip } */
const tunnels = new Map();
let nextCid = 1;

const clientIp = (req) =>
  (req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '')
    .toString().split(',')[0].trim();

const send = (ws, obj) => {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
};

const server = http.createServer((_req, res) => {
  let peers = 0;
  for (const t of tunnels.values()) peers += t.clients.size;
  res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify({ status: 'ok', tunnels: tunnels.size, peers }));
});

const wss = new WebSocketServer({ server, maxPayload: MAX_PAYLOAD });

wss.on('connection', (ws, req) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('error', () => {});

  const path = (req.url || '/').split('?')[0].replace(/\/+$/, '');
  const m = path.match(/^\/tunnel\/([a-f0-9]{16})(?:\/gun)?$/);
  if (m) return attachClient(ws, m[1]);
  if (path === '/tunnel' || path === '') return attachTab(ws, clientIp(req));
  ws.close(4404, 'Unknown path');
});

function attachTab(ws, ip) {
  let tunnelId = null;
  const regTimer = setTimeout(() => { if (!tunnelId) ws.close(4000, 'Register timeout'); }, REGISTER_TIMEOUT_MS);

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (!tunnelId) {
      if (msg.type !== 'register' || msg.app !== 'interpoll') return ws.close(4000, 'Expected register');
      let perIp = 0;
      for (const t of tunnels.values()) if (t.ip === ip) perIp++;
      if (perIp >= MAX_TABS_PER_IP) return ws.close(4429, 'Too many tunnels from this address');

      clearTimeout(regTimer);
      tunnelId = crypto.randomBytes(8).toString('hex');
      tunnels.set(tunnelId, { tab: ws, clients: new Map(), ip });
      send(ws, { type: 'registered', url: `${PUBLIC_BASE}/${tunnelId}/gun`, tunnelId });
      console.log(`[bridge] tab registered tunnel=${tunnelId}`);
      return;
    }

    const tunnel = tunnels.get(tunnelId);
    if (!tunnel) return;
    if (msg.type === 'ping') return send(ws, { type: 'pong' });
    const client = tunnel.clients.get(msg.c);
    if (!client) return;
    if (msg.type === 'msg' && typeof msg.d === 'string') {
      if (client.readyState === WebSocket.OPEN) client.send(msg.d);
    } else if (msg.type === 'close') {
      client.close(1000, 'Closed by relay');
    }
  });

  ws.on('close', () => {
    clearTimeout(regTimer);
    if (!tunnelId) return;
    const tunnel = tunnels.get(tunnelId);
    tunnels.delete(tunnelId);
    if (!tunnel) return;
    for (const c of tunnel.clients.values()) { try { c.close(1001, 'Relay tab closed'); } catch { /* gone */ } }
    console.log(`[bridge] tab closed tunnel=${tunnelId}`);
  });
}

function attachClient(ws, tunnelId) {
  const tunnel = tunnels.get(tunnelId);
  if (!tunnel) return ws.close(4404, 'Tunnel not found');
  if (tunnel.clients.size >= MAX_CLIENTS_PER_TAB) return ws.close(4429, 'Tunnel at capacity');

  const c = nextCid++;
  tunnel.clients.set(c, ws);
  send(tunnel.tab, { type: 'open', c });
  send(tunnel.tab, { type: 'peers', n: tunnel.clients.size });

  ws.on('message', (data, isBinary) => {
    if (isBinary) return; // Gun speaks JSON text frames
    send(tunnel.tab, { type: 'msg', c, d: data.toString() });
  });
  ws.on('close', () => {
    if (!tunnel.clients.delete(c)) return;
    send(tunnel.tab, { type: 'close', c });
    send(tunnel.tab, { type: 'peers', n: tunnel.clients.size });
  });
}

// Drop half-open sockets (tabs that vanished without a close frame).
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch { /* gone */ }
  }
}, 30_000);

server.listen(BRIDGE_PORT, '127.0.0.1', () => {
  console.log(`[bridge] listening on 127.0.0.1:${BRIDGE_PORT}, public base ${PUBLIC_BASE}`);
});

process.on('SIGTERM', () => {
  for (const ws of wss.clients) { try { ws.close(1001, 'Bridge restarting'); } catch { /* gone */ } }
  server.close(() => process.exit(0));
});
