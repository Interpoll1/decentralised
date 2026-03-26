// relay-server.js
// Simple WebSocket relay for cross-device/cross-browser P2P sync
// Install: npm install ws
// Run: node relay-server.js

import { WebSocketServer } from 'ws';
import http from 'http';
import https from 'https';
import fs from 'fs';
import crypto from 'crypto';
import { URL } from 'url';
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

// In-memory registry for backend-side vote protection
// key = `${pollId}:${deviceId}`
const voteRegistry = new Set();

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
const sessions = new Map(); // sessionId -> user

// Cleanup expired OAuth states every 2 minutes
setInterval(() => {
  const now = Date.now();
  for (const [state, entry] of oauthStates) {
    if (now - entry.createdAt > OAUTH_STATE_TTL_MS) oauthStates.delete(state);
  }
}, 2 * 60_000);

const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:5173';

console.log('Google OAuth config:', {
  clientIdConfigured: !!process.env.GOOGLE_CLIENT_ID,
  clientIdPreview: process.env.GOOGLE_CLIENT_ID ? String(process.env.GOOGLE_CLIENT_ID).slice(0, 12) + '...' : null,
  clientSecretConfigured: !!process.env.GOOGLE_CLIENT_SECRET,
});

function generateRandomId(bytes = 16) {
  return crypto.randomBytes(bytes).toString('hex');
}

function setSessionCookie(res, user) {
  const sessionId = generateRandomId(16);
  sessions.set(sessionId, user);
  const isProduction = process.env.NODE_ENV === 'production';
  const securePart = isProduction ? ' Secure;' : '';
  const cookie = `sessionId=${sessionId}; HttpOnly; Path=/; SameSite=Lax;${securePart}`;
  res.setHeader('Set-Cookie', cookie);
}

function getSessionFromRequest(req) {
  const cookieHeader = req.headers['cookie'];
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(';').map((c) => c.trim());
  const sessionPart = parts.find((p) => p.startsWith('sessionId='));
  if (!sessionPart) return null;
  const sessionId = sessionPart.split('=')[1];
  if (!sessionId) return null;
  return sessions.get(sessionId) || null;
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

function decodeJwt(token) {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const payload = parts[1]
      .replace(/-/g, '+')
      .replace(/_/g, '/');
    const decoded = Buffer.from(payload, 'base64').toString('utf8');
    return JSON.parse(decoded);
  } catch (error) {
    console.error('Failed to decode JWT:', error);
    return null;
  }
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
    const redirectUri = `http://localhost:${PORT}/auth/google/callback`;

    if (!clientId) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Google OAuth not configured');
      return;
    }

    const state = generateRandomId(16);
    oauthStates.set(state, { provider: 'google', createdAt: Date.now() });

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

    if (!code || !state || oauthStates.get(state)?.provider !== 'google') {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Invalid OAuth state');
      return;
    }

    oauthStates.delete(state);

    const tokenEndpoint = 'https://oauth2.googleapis.com/token';
    const redirectUri = `http://localhost:${PORT}/auth/google/callback`;

    postForm(tokenEndpoint, {
      code,
      client_id: process.env.GOOGLE_CLIENT_ID || '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    })
      .then((tokenResponse) => {
        console.log('Google token response received (id_token present:', !!tokenResponse.id_token, ')');

        const idToken = tokenResponse.id_token;
        if (idToken) {
          const claims = decodeJwt(idToken);
          if (!claims) {
            throw new Error('Failed to decode id_token from Google');
          }

          const user = {
            provider: 'google',
            sub: claims.sub,
            email: claims.email,
            name: claims.name || claims.email,
            picture: claims.picture || null,
          };

          setSessionCookie(res, user);
          res.writeHead(302, { Location: `${FRONTEND_ORIGIN}/auth/callback` });
          res.end();
          return;
        }

        const accessToken = tokenResponse.access_token;
        if (!accessToken) {
          throw new Error('No id_token or access_token from Google');
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
    const redirectUri = `http://localhost:${PORT}/auth/microsoft/callback`;

    if (!clientId) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Microsoft OAuth not configured');
      return;
    }

    const state = generateRandomId(16);
    oauthStates.set(state, { provider: 'microsoft', createdAt: Date.now() });

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

    if (!code || !state || oauthStates.get(state)?.provider !== 'microsoft') {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Invalid OAuth state');
      return;
    }

    oauthStates.delete(state);

    const tenant = process.env.MS_TENANT || 'common';
    const tokenEndpoint = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;
    const redirectUri = `http://localhost:${PORT}/auth/microsoft/callback`;

    postForm(tokenEndpoint, {
      client_id: process.env.MS_CLIENT_ID || '',
      client_secret: process.env.MS_CLIENT_SECRET || '',
      scope: process.env.MS_SCOPES || 'openid profile email',
      code,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    })
      .then((tokenResponse) => {
        const idToken = tokenResponse.id_token;
        const claims = idToken ? decodeJwt(idToken) : null;
        if (!claims) {
          throw new Error('No id_token from Microsoft');
        }

        const user = {
          provider: 'microsoft',
          sub: claims.sub || claims.oid,
          email: claims.email || claims.preferred_username,
          name: claims.name || claims.preferred_username,
        };

        setSessionCookie(res, user);
        res.writeHead(302, { Location: `${FRONTEND_ORIGIN}/auth/callback` });
        res.end();
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
    res.setHeader('Set-Cookie', 'sessionId=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
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
        const alreadyVoted = voteRegistry.has(key);

        if (!alreadyVoted) {
          voteRegistry.add(key);
        }

        // Log the authorization attempt
        const logEntry = {
          type: 'vote-authorize',
          pollId,
          deviceId,
          allowed: !alreadyVoted,
          timestamp: Date.now(),
        };
        fs.appendFile(RECEIPT_LOG_FILE, JSON.stringify(logEntry) + '\n', () => {});

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ allowed: !alreadyVoted, reason: alreadyVoted ? 'already voted' : undefined }));
      } catch (error) {
        // SECURITY FIX: Return allowed: false on error (was: true)
        console.error('Error in /api/vote-authorize:', error.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ allowed: false, reason: 'internal error' }));
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