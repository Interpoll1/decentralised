/**
 * relay-bridge-server.js — WebSocket tunnel bridge for browser relays
 *
 * This is the server-side counterpart to BrowserRelayService.ts.
 * Deploy this on your VPS alongside the main relay server.
 *
 * What it does:
 *   Gives browser tabs a public wss:// URL. When a tab calls
 *   BrowserRelayService.start(), it connects here and gets assigned a
 *   subdomain URL like wss://abc123.tunnel.interpoll.endless.sbs
 *   Other users' Gun clients connect to that URL, and this bridge
 *   forwards the traffic to the tab's WebSocket connection.
 *
 * Architecture:
 *   External peers → wss://abc123.tunnel.example.com → Bridge → Tab (browser relay)
 *
 * How to run:
 *   node relay-bridge-server.js
 *
 * Requires: ws npm package  (npm install ws)
 *
 * Nginx config for subdomain wildcard (add to your existing nginx setup):
 *   server {
 *     server_name *.tunnel.interpoll.endless.sbs;
 *     location / {
 *       proxy_pass http://127.0.0.1:9000;
 *       proxy_http_version 1.1;
 *       proxy_set_header Upgrade $http_upgrade;
 *       proxy_set_header Connection "upgrade";
 *       proxy_set_header Host $host;
 *       proxy_read_timeout 86400;
 *     }
 *   }
 *
 * DNS: Add a wildcard A record:  *.tunnel.interpoll.endless.sbs → your VPS IP
 *
 * Privacy note:
 *   The bridge sees the tab's IP address (unavoidable for WebSocket tunneling).
 *   External peers do NOT see the tab's IP — they only connect to the bridge URL.
 *   No content is logged. Only connection events are logged.
 */

import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import crypto from 'crypto';

const BRIDGE_PORT   = 9000;
const TUNNEL_DOMAIN = process.env.TUNNEL_DOMAIN || 'tunnel.interpoll.endless.sbs';
const MAX_CLIENTS_PER_TAB = 50;   // limit how many Gun peers can connect to one tab
const TAB_TIMEOUT_MS = 30 * 60_000; // drop idle tab connections after 30 min

// ── State ─────────────────────────────────────────────────────────────────────
// tunnelId → { tabSocket, clients: Set<WebSocket>, createdAt }
const tunnels = new Map();

function generateTunnelId() {
  return crypto.randomBytes(8).toString('hex'); // e.g. "a3f8c2d1e4b5a609"
}

// ── HTTP server (Nginx proxies all *.tunnel.* traffic here) ───────────────────
const server = http.createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ tunnels: tunnels.size, status: 'ok' }));
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  const host = req.headers.host || '';
  const subdomain = host.split('.')[0];

  // ── Registration: tab connecting to the bridge root ───────────────────────
  // A tab sends: { type: 'register', port: 8765, app: 'interpoll' }
  // The bridge responds: { type: 'registered', url: 'wss://abc123.tunnel.../gun' }
  if (subdomain === 'tunnel' || !tunnels.has(subdomain)) {
    let registered = false;

    ws.on('message', (raw) => {
      if (registered) return; // ignore further messages on registration socket

      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type !== 'register' || msg.app !== 'interpoll') {
          ws.close(4000, 'Expected register message');
          return;
        }

        const tunnelId = generateTunnelId();
        const publicUrl = `wss://${tunnelId}.${TUNNEL_DOMAIN}/gun`;

        const tunnel = {
          tabSocket: ws,
          clients: new Set(),
          createdAt: Date.now(),
        };
        tunnels.set(tunnelId, tunnel);
        registered = true;

        console.log(`[bridge] Tab registered tunnel=${tunnelId}`);
        ws.send(JSON.stringify({ type: 'registered', url: publicUrl, tunnelId }));

        // Clean up when tab disconnects
        ws.on('close', () => {
          console.log(`[bridge] Tab disconnected tunnel=${tunnelId} (served ${tunnel.clients.size} peers)`);
          // Close all forwarded client connections
          for (const client of tunnel.clients) {
            try { client.close(1001, 'Tab disconnected'); } catch { /* gone */ }
          }
          tunnels.delete(tunnelId);
        });

        // Idle timeout
        const idleTimer = setTimeout(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'timeout', reason: 'Idle for 30 minutes' }));
            ws.close(1001, 'Idle timeout');
          }
        }, TAB_TIMEOUT_MS);

        ws.on('close', () => clearTimeout(idleTimer));

        // Messages from tab → forward to whichever client they target
        // Gun uses binary frames; we pass them through opaquely
        ws.on('message', (data, isBinary) => {
          // Tab writes to all connected Gun clients (Gun broadcast)
          for (const client of tunnel.clients) {
            if (client.readyState === WebSocket.OPEN) {
              client.send(data, { binary: isBinary });
            }
          }
        });

      } catch {
        ws.close(4000, 'Invalid register message');
      }
    });

    return; // done setting up registration handler
  }

  // ── Client connection: Gun peer connecting to a tunnel subdomain ──────────
  const tunnel = tunnels.get(subdomain);
  if (!tunnel) {
    ws.close(4404, 'Tunnel not found');
    return;
  }

  if (tunnel.clients.size >= MAX_CLIENTS_PER_TAB) {
    ws.close(4429, 'Tunnel at capacity');
    return;
  }

  tunnel.clients.add(ws);
  console.log(`[bridge] Gun peer connected tunnel=${subdomain} total=${tunnel.clients.size}`);

  // Client → Tab
  ws.on('message', (data, isBinary) => {
    if (tunnel.tabSocket.readyState === WebSocket.OPEN) {
      tunnel.tabSocket.send(data, { binary: isBinary });
    }
  });

  ws.on('close', () => {
    tunnel.clients.delete(ws);
  });

  ws.on('error', () => {
    tunnel.clients.delete(ws);
  });
});

server.listen(BRIDGE_PORT, () => {
  console.log(`[bridge] Listening on :${BRIDGE_PORT}`);
  console.log(`[bridge] Tunnel domain: *.${TUNNEL_DOMAIN}`);
  console.log(`[bridge] Max clients/tab: ${MAX_CLIENTS_PER_TAB}`);
});

// ── Cleanup stale tunnels every 5 minutes ─────────────────────────────────────
setInterval(() => {
  const now = Date.now();
  for (const [id, tunnel] of tunnels) {
    if (tunnel.tabSocket.readyState !== WebSocket.OPEN) {
      for (const client of tunnel.clients) {
        try { client.close(); } catch { /* gone */ }
      }
      tunnels.delete(id);
      console.log(`[bridge] Cleaned up stale tunnel=${id}`);
    }
  }
}, 5 * 60_000);

process.on('SIGTERM', () => {
  console.log('[bridge] Shutting down...');
  for (const [, tunnel] of tunnels) {
    try { tunnel.tabSocket.close(); } catch { /* gone */ }
  }
  server.close(() => process.exit(0));
});
