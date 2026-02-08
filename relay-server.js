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

const PORT = 8080;
const server = http.createServer();
const wss = new WebSocketServer({ server });

const clients = new Map(); // peerId -> WebSocket
const rooms = new Map();   // roomId -> Set of peerIds

// In-memory registry for backend-side vote protection
// key = `${pollId}:${deviceId}`
const voteRegistry = new Set();

// Simple append-only log for receipts and audit events
const RECEIPT_LOG_FILE = new URL('./storage.txt', import.meta.url).pathname;

// Minimal in-memory OAuth state & session stores
const oauthStates = new Map(); // state -> provider
const sessions = new Map(); // sessionId -> user

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
  const cookie = `sessionId=${sessionId}; HttpOnly; Path=/; SameSite=Lax`;
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
  // Basic CORS for the frontend dev server (supports credentials)
  const origin = req.headers.origin || FRONTEND_ORIGIN;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
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
    oauthStates.set(state, 'google');

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

    if (!code || !state || oauthStates.get(state) !== 'google') {
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
        console.log('Google token response:', tokenResponse);

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
    oauthStates.set(state, 'microsoft');

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

    if (!code || !state || oauthStates.get(state) !== 'microsoft') {
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
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        const data = JSON.parse(body || '{}');
        const pollId = String(data.pollId || '');
        const deviceId = String(data.deviceId || '');

        if (!pollId || !deviceId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ allowed: false, reason: 'missing pollId or deviceId' }));
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
        console.error('Error in /api/vote-authorize:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ allowed: true }));
      }
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/receipts') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        const data = JSON.parse(body || '{}');
        const logEntry = {
          type: 'receipt',
          payload: data,
          timestamp: Date.now(),
        };
        fs.appendFile(RECEIPT_LOG_FILE, JSON.stringify(logEntry) + '\n', (err) => {
          if (err) {
            console.error('Failed to write receipt log:', err);
          }
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (error) {
        console.error('Error in /api/receipts:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false }));
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
  
  console.log('🔌 New connection from', req.socket.remoteAddress);

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message.toString());
      
      switch (data.type) {
        case 'register':
          peerId = data.peerId;
          clients.set(peerId, ws);
          console.log(`✅ Peer registered: ${peerId} (Total: ${clients.size})`);
          
          // Send list of active peers
          broadcast({
            type: 'peer-list',
            peers: Array.from(clients.keys())
          });
          break;
          
        case 'join-room':
          const roomId = data.roomId || 'default';
          if (!rooms.has(roomId)) {
            rooms.set(roomId, new Set());
          }
          rooms.get(roomId).add(peerId);
          console.log(`🚪 ${peerId} joined room: ${roomId}`);
          break;
          
        case 'broadcast':
          // Relay to all other peers
          console.log(`📡 Broadcasting ${data.data?.type || 'message'} from ${peerId}`);
          broadcastToOthers(peerId, data.data);
          break;
          
        case 'direct':
          // Send to specific peer
          const targetWs = clients.get(data.targetPeer);
          if (targetWs && targetWs.readyState === 1) { // 1 = OPEN
            targetWs.send(JSON.stringify(data.data));
          }
          break;
          
        // Handle direct P2P messages (not wrapped in 'broadcast')
        case 'new-poll':
        case 'new-block':
        case 'request-sync':
        case 'sync-response':
          console.log(`📡 Broadcasting ${data.type} from ${peerId}`);
          broadcastToOthers(peerId, data);
          break;
          
        default:
          console.log('Unknown message type:', data.type);
      }
    } catch (error) {
      console.error('Error handling message:', error);
    }
  });

  ws.on('close', () => {
    if (peerId) {
      clients.delete(peerId);
      
      // Remove from all rooms
      rooms.forEach((peers, roomId) => {
        peers.delete(peerId);
        if (peers.size === 0) {
          rooms.delete(roomId);
        }
      });
      
      console.log(`❌ Peer disconnected: ${peerId} (Total: ${clients.size})`);
      
      // Notify others
      broadcast({
        type: 'peer-left',
        peerId: peerId
      });
    }
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
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
  wss.clients.forEach((ws) => {
    ws.close();
  });
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});