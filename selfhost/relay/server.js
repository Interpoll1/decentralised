#!/usr/bin/env node
/**
 * server.js — the whole self-host relay: one process, one port.
 *
 * It is simultaneously
 *   • a Gun relay          (`/gun`, the only durable store on this instance)
 *   • a WebSocket peer hub (`/`, peer list + broadcast fan-out)
 *   • the HTTP API         (`/api/*`, `/db/*`)
 *   • a static file server (the lite client, or the built Vue app)
 *
 * Gun and the peer hub both want the `upgrade` event, so neither is attached to
 * the listening server directly: Gun gets a detached http.Server it never
 * listens on, and upgrades are routed to one or the other by path.
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import Gun from 'gun';

import config from './env.js';
import * as graph from './graph.js';
import { Hub } from './hub.js';
import { handleApi } from './api.js';
import { RateLimiter } from '../../rate-limiter.js';
import { setSecurityHeaders } from '../../security-utils.js';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

const rateLimiter = new RateLimiter({
  httpLimit: config.httpRateLimit,
  wsLimit: config.wsRateLimit,
});
const hub = new Hub({ rateLimiter });

// ── Gun, on a detached server so we own the upgrade routing ──────────────────

const gunServer = http.createServer();
const gunOptions = { web: gunServer, axe: false, multicast: false };
if (config.ephemeral) {
  gunOptions.radisk = false;
  gunOptions.localStorage = false;
} else {
  fs.mkdirSync(config.dataDir, { recursive: true });
  gunOptions.file = path.join(config.dataDir, 'radata');
}
const gun = Gun(gunOptions);
graph.attach(gun);

// ── HTTP ─────────────────────────────────────────────────────────────────────

/**
 * A self-hosted instance is reached from whatever origin its operator uses —
 * localhost, a LAN IP, a tunnel hostname. Reflecting the request origin is the
 * only workable policy here, and the relay holds no cookies or credentials that
 * a hostile origin could ride on.
 */
/**
 * Vite's dev server, the one origin that legitimately needs cross-origin access
 * out of the box (`selfhost/run.sh` serves the app on 5173 and the API here).
 */
const DEV_ORIGINS = new Set([
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]);

/**
 * Is this Origin allowed to talk to the API cross-origin?
 *
 * There are no accounts here, so reaching the instance *is* the authorisation:
 * an ACAO header handed to the wrong page gives it everything. The bar is
 * therefore an exact origin match, not a hostname one — `http://box:9999` is a
 * different application from `http://box:8080` even though the host is shared,
 * and a page served from anywhere on the LAN is not this instance.
 *
 * Being strict costs nothing: the clients this relay serves are same-origin by
 * construction, so the only callers that need listing are a separate front-end
 * (ALLOWED_ORIGINS) and the dev server above.
 */
function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return true;  // not a browser cross-origin request
  if (config.allowedOrigins.includes(origin)) return true;
  if (DEV_ORIGINS.has(origin)) return true;

  // Same origin: compare host *and* port, which is what the Host header is.
  let originHost;
  try {
    const parsed = new URL(origin);
    originHost = parsed.host;  // host:port, port included only when non-default
  } catch {
    return false;
  }
  return Boolean(req.headers.host) && originHost === req.headers.host;
}

function setCors(req, res, allowed) {
  if (allowed && req.headers.origin) {
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
  } else if (!req.headers.origin) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Cache-Control, X-Requested-With');
  res.setHeader('Vary', 'Origin');
}

function clientIp(req) {
  return req.socket.remoteAddress || 'unknown';
}

function serveStatic(req, res, pathname) {
  const root = config.clientDir;
  const relative = decodeURIComponent(pathname).replace(/^\/+/, '');
  let filePath = path.resolve(root, relative);

  // Never serve outside the client directory.
  if (!filePath.startsWith(path.resolve(root))) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  let stat = null;
  try { stat = fs.statSync(filePath); } catch { /* falls through to SPA index */ }
  if (stat?.isDirectory()) {
    filePath = path.join(filePath, 'index.html');
    try { stat = fs.statSync(filePath); } catch { stat = null; }
  }

  if (!stat) {
    // SPA fallback: any unknown path renders the app shell, matching the dev
    // server's behaviour (spaRouteFallbackPlugin in vite.config.ts).
    const indexPath = path.join(root, 'index.html');
    if (!fs.existsSync(indexPath)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(
        config.edition === 'full'
          ? 'No client build found. Run `npm run build` first, or start with EDITION=lite.'
          : `No client found at ${root}.`,
      );
      return;
    }
    filePath = indexPath;
  }

  const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': type,
    'Cache-Control': filePath.endsWith('.html') ? 'no-cache' : 'public, max-age=3600',
  });
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  setSecurityHeaders(res);
  const allowed = originAllowed(req);
  setCors(req, res, allowed);
  // The CSP from setSecurityHeaders is written for an API host; the client we
  // serve needs its own inline styles and blob workers.
  //
  // fonts.googleapis.com / fonts.gstatic.com are not decoration here: the full
  // client's stylesheet opens with an `@import` of a Google Fonts sheet, and a
  // blocked @import makes the whole stylesheet fail to load — which takes the
  // route chunk waiting on it down with it and leaves a blank page.
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; " +
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; " +
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
      "font-src 'self' data: https://fonts.gstatic.com; " +
      "img-src 'self' data: blob: https:; " +
      "media-src 'self' data: blob:; " +
      "connect-src 'self' ws: wss: http: https:; " +
      "worker-src 'self' blob:",
  );

  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  if (url.pathname === '/gun' || url.pathname.startsWith('/gun/') || url.pathname === '/gun.js') {
    gunServer.emit('request', req, res);
    return;
  }

  // The rate limiter guards the API, not the static client. A single load of
  // the full Vue app pulls ~110 files at once, which trips any sane per-IP API
  // budget and hands the browser a 429 in place of a stylesheet.
  if (!allowed && req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'origin_not_allowed' }));
    return;
  }

  const isApiPath = url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/db/') ||
    url.pathname.startsWith('/auth/');

  if (isApiPath && !rateLimiter.checkHttp(clientIp(req)).allowed) {
    res.writeHead(429, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'rate_limited' }));
    return;
  }

  try {
    if (await handleApi(req, res, url, { hub, gun })) return;
  } catch (err) {
    console.error('[api]', url.pathname, err);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'internal_error' }));
    }
    return;
  }

  serveStatic(req, res, url.pathname);
});

server.on('upgrade', (req, socket, head) => {
  const pathname = new URL(req.url || '/', 'http://localhost').pathname;
  if (pathname === '/gun' || pathname.startsWith('/gun/')) {
    gunServer.emit('upgrade', req, socket, head);
    return;
  }
  hub.handleUpgrade(req, socket, head);
});

// ── Boot ─────────────────────────────────────────────────────────────────────

function lanAddress() {
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family === 'IPv4' && !entry.internal) return entry.address;
    }
  }
  return null;
}

server.listen(config.port, config.host, () => {
  const lan = lanAddress();
  const name = config.instanceName || 'this instance';
  console.log('');
  console.log(`  ${name} is running (${config.edition} client)`);
  console.log('');
  console.log(`    On this computer   http://localhost:${config.port}`);
  if (lan) console.log(`    On your network    http://${lan}:${config.port}`);
  console.log('');
  console.log(`    Content expires    ${config.ttlHours > 0 ? `after ${config.ttlHours}h` : 'never (TTL disabled)'}`);
  console.log(`    Storage            ${config.ephemeral ? 'memory only — nothing is written to disk' : config.dataDir}`);
  console.log('');
  console.log('  Press Ctrl+C to stop.');
  console.log('');
});

function shutdown() {
  console.log('\nStopping…');
  hub.shutdown();
  graph.shutdown();
  rateLimiter.destroy?.();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
