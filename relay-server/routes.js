import { displayedReaction } from '../shared-validation/engagement-tally.js';
import { handleEngagement } from '../shared-validation/engagement-http.js';
// routes.js — All HTTP route handlers
import {
  server, PORT, DOMAIN, FRONTEND_ORIGIN, clients, oauthStates, sessions, activeChatSessions,
  rateLimiter, botDetector,
  sanitizeId, parseBodyWithLimit, setCorsHeaders, setSecurityHeaders, isOriginAllowed,
  sendError, requireSecret, validateSearchQuery, validateHttpRequest, ErrorCodes, makeError,
} from './config.js';
import { db, queryMySQL } from './db.js';
import {
  getHttpRateLimitContext, getSecureSession, setSecureSession, generateSecureToken,
  setOauthStateCookie, clearOauthStateCookie, appendSetCookie, getCookie,
  postForm, getJson,
} from './auth.js';
import { generateSitemap } from './ssr.js';
import { verifyAuthenticatedBundle, isRollback } from './bundle-auth.js';
import { messageCache } from './persistence.js';
import { searchContent, indexContent, writeCategrisationResult } from './search.js';
import { getChatRoomId, getChatHistory, markMessagesAsRead } from './chat.js';
import {
  validateSealedRequest, validateSealedVoteRequest, resolveRequireLoginPolicy,
  resolveVoteKeysForRequest, fetchPollPolicyOwnerRecord, handleVoteCommit,
} from './votes.js';
import {
  voteRegistry, pollPolicyRegistry, normalizePollPolicyRecord,
  reserveVoteSlot, RECEIPT_LOG_FILE, savePollPolicyRegistrySync, MAX_VOTE_REGISTRY,
  saveVoteRegistrySync,
} from './persistence.js';
import { queueForCategorisation } from './auto-categorise.js';
import { NAMESPACE, resolveNamespace, namespaceOfSoul, belongsToNamespace } from '../shared-validation/namespace.js';
import fs from 'fs';


// ─── Time-lock helper ──────────────────────────────────────────────────────────
function shouldLockResults(poll, chainLength = 0) {
  if (!poll.resultsLockedUntil) return false;
  if (poll.timeLockMode === 'block' && poll.timeLockBlock) {
    return chainLength < poll.timeLockBlock;
  }
  return Date.now() < poll.resultsLockedUntil;
}

// ─── Poll serialiser helpers ───────────────────────────────────────────────────
function serializePoll(d, options, nsPrefix, now, chainLength = 0) {
  const locked = shouldLockResults(d, chainLength);
  const safeOptions = locked
    ? options.map(o => ({ id: o.id, text: o.text, votes: null, voters: [] }))
    : options;
  return {
    id: d.id, communityId: d.communityId,
    authorId: d.authorId || '', authorName: d.authorName || 'Anonymous',
    question: d.question, description: d.description || '',
    options: safeOptions,
    createdAt: d.createdAt || 0, expiresAt: d.expiresAt || 0,
    allowMultipleChoices: !!d.allowMultipleChoices,
    showResultsBeforeVoting: !!d.showResultsBeforeVoting,
    requireLogin: !!d.requireLogin, isPrivate: false,
    totalVotes: locked ? null : options.reduce((s, o) => s + o.votes, 0),
    isExpired: now > (d.expiresAt || 0),
    isEncrypted: d.isEncrypted || false,
    category: d.category || null,
    tags: Array.isArray(d.tags) ? d.tags : (typeof d.tags === 'string' ? d.tags.split(',').map(t => t.trim()).filter(Boolean) : []),
    nsfw: d.nsfw || 'none',
    controversial: !!d.controversial,
    evergreen: d.evergreen !== false,
    locale: d.locale || 'global',
    nostrEventId: d.nostrEventId || null,
    voteTrustPolicy: d.voteTrustPolicy || { requiredTier: 'anonymous' },
    resultsLockedUntil: d.resultsLockedUntil || null,
    timeLockMode: d.timeLockMode || null,
    timeLockBlock: d.timeLockBlock || null,
    locked,
    // Tagged from the soul the row actually came from, never from what the
    // caller asked for — otherwise requesting v5 would relabel v3 rows as v5.
    dataVersion: nsPrefix,
  };
}

function serializePost(d, nsPrefix) {
  const rawTags = d.tags;
  const tags = Array.isArray(rawTags)
    ? rawTags
    : (typeof rawTags === 'string' ? rawTags.split(',').map(t => t.trim()).filter(Boolean) : []);
  return {
    id: d.id, communityId: d.communityId,
    authorId: d.authorId || '', authorName: d.authorName || 'Anonymous',
    authorShowRealName: d.authorShowRealName || false,
    title: d.title, content: d.content || '',
    imageIPFS: d.imageIPFS || '', imageThumbnail: d.imageThumbnail || '', imageCids: d.imageCids || '',
    createdAt: d.createdAt || 0,
    upvotes: d.upvotes || 0, downvotes: d.downvotes || 0, score: d.score || 0,
    commentCount: d.commentCount || 0,
    isEncrypted: d.isEncrypted || false,
    category: d.category || null,
    tags,
    sentiment: d.sentiment || null,
    nsfw: d.nsfw || 'none',
    controversial: !!d.controversial,
    evergreen: d.evergreen !== false,
    locale: d.locale || 'global',
    videoCID: d.videoCID || null, videoThumbnailCID: d.videoThumbnailCID || null,
    videoDuration: d.videoDuration || null, videoSize: d.videoSize || null,
    videoMimeType: d.videoMimeType || null,
    nostrEventId: d.nostrEventId || null,
    dataVersion: nsPrefix,
  };
}

server.on('request', async (req, res) => {
  setSecurityHeaders(res);
  setCorsHeaders(req, res);

  res.setHeader('X-Relay-Transport', req.headers.host?.endsWith('.onion') ? 'tor' : 'clearnet');
  if (req.method === 'OPTIONS') {
    // CORS preflight — setCorsHeaders above already set Access-Control-Allow-Origin.
    // Explicitly allow Authorization so chat-media uploads work cross-origin.
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Cache-Control');
    res.setHeader('Access-Control-Max-Age', '86400'); // cache preflight 24h
    res.statusCode = 204;
    res.end();
    return;
  }
  if (!req.url) { res.writeHead(400); res.end('Bad request'); return; }

  if ((req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE') && !isOriginAllowed(req)) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Origin not allowed' }));
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const clientIp = req.headers['x-real-ip'] || req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
  const httpRateLimit = getHttpRateLimitContext(req, url, clientIp);
  const httpCheck = rateLimiter.checkHttp(httpRateLimit.bucketId, httpRateLimit.limit);
  if (!httpCheck.allowed) {
    res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': String(Math.ceil(httpCheck.retryAfter / 1000)) });
    res.end(JSON.stringify({ error: 'Too many requests', retryAfter: httpCheck.retryAfter }));
    return;
  }

  // ── GET /install.sh and /vps.sh — serve shell scripts for curl-install ──────
  if (req.method === 'GET' && (url.pathname === '/install.sh' || url.pathname === '/vps.sh')) {
    const name = url.pathname.slice(1); // 'install.sh' or 'vps.sh'
    const file = new URL(`../../${name}`, import.meta.url).pathname;
    res.setHeader('Content-Type', 'text/plain');
    try {
      fs.createReadStream(file).pipe(res);
    } catch (e) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
    }
    return;
  }

  // ── GET /api/relay-info — peer discovery advertisement ──────────────────────
  if (req.method === 'GET' && url.pathname === '/api/relay-info') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' });
    res.end(JSON.stringify({
      version:   1,
      websocket: `wss://${DOMAIN.replace(/^https?:\/\//, '')}`,
      gun:       `${DOMAIN}/gun`,
      api:       `${DOMAIN}/api`,
      name:      process.env.RELAY_LABEL || DOMAIN,
      pubkey:    process.env.RELAY_PUBKEY || '',
      features:  ['gun', 'p2p-chat', 'polls', 'posts'],
      timestamp: Date.now(),
    }));
    return;
  }

  // ── Search API ────────────────────────────────────────────────────────────
  if (req.method === 'GET' && url.pathname === '/api/search') {
    const query = url.searchParams.get('q');
    if (!query || query.length < 2) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Query must be at least 2 characters' })); return; }
    const sanitizedQuery = validateSearchQuery(query, 200);
    if (!sanitizedQuery) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(makeError(ErrorCodes.SCHEMA_INVALID, 'Invalid search query'))); return; }
    const filters = { type: url.searchParams.get('type'), community: url.searchParams.get('community'), limit: url.searchParams.get('limit'), offset: url.searchParams.get('offset') };
    const results = await searchContent(sanitizedQuery, filters);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(results)); return;
  }

  // ── Index content ──────────────────────────────────────────────────────────
  if (req.method === 'POST' && url.pathname === '/api/index') {
    if (!requireSecret(req, res, 'API_INDEX_SECRET')) return;
    parseBodyWithLimit(req, res, 51200).then(async (body) => {
      if (!body) return;
      try {
        const idxValidation = validateHttpRequest('index', body);
        if (!idxValidation.valid) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(makeError(ErrorCodes.SCHEMA_INVALID, idxValidation.errors))); return; }
        const { type, id, data } = body;
        if (!type || !id || !data) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Missing required fields' })); return; }
        if (!['post', 'poll'].includes(type)) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Invalid type' })); return; }
        await indexContent(type, id, data);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        setImmediate(() => { queueForCategorisation(id, type, data, (r) => writeCategrisationResult(id, r)); });
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

  // ── Signal bundle — GET ────────────────────────────────────────────────────
  if (req.method === 'GET' && url.pathname.startsWith('/api/signal-bundle/')) {
    const targetUserId = sanitizeId(url.pathname.slice('/api/signal-bundle/'.length), 200);
    if (!targetUserId) { res.writeHead(400); res.end('Invalid userId'); return; }
    try {
      if (!db) { res.writeHead(503); res.end('DB unavailable'); return; }
      const [rows] = await db.execute('SELECT ik, ik_sign_pub, spk, spk_sig, bundle_json FROM signal_bundles WHERE user_id = ?', [targetUserId]);
      if (!rows || rows.length === 0) { res.writeHead(404); res.end('Not found'); return; }

      // Authenticated bundles are signed end to end (binding, SPK and OPK list), so the
      // relay must hand them back byte-for-byte — mixing in a pool OPK would break verification.
      if (rows[0].bundle_json) {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(rows[0].bundle_json);
        return;
      }

      // Hand out one OPK from the pool only if the recipient has an active WS session.
      // If they are offline, do NOT serve an OPK — the receiver's local OPK pool may
      // be out of sync (e.g. fresh install wiped IDB but relay still has old public OPKs).
      // Without an OPK both sides do a 3-part X3DH which still gives full forward secrecy
      // for the session. Serving a stale OPK causes a 4-vs-3-part masterKey mismatch
      // → AES-GCM decrypt fails permanently until the session is manually cleared.
      let opk = null; let opkId = null;
      const recipientOnline = Array.from(clients.values()).some(c => c.userId === targetUserId);
      if (recipientOnline) {
        try {
          const conn = await db.getConnection();
          try {
            await conn.beginTransaction();
            const [opkRows] = await conn.execute(
              `SELECT id, pub FROM opk_pool WHERE user_id = ? AND consumed = 0 ORDER BY created_at ASC LIMIT 1`,
              [targetUserId]
            );
            if (opkRows.length > 0) {
              opk   = opkRows[0].pub;
              opkId = opkRows[0].id;
              await conn.execute(`UPDATE opk_pool SET consumed = 1, consumed_at = ? WHERE id = ?`, [Date.now(), opkId]);
            }
            await conn.commit();
          } finally { conn.release(); }
        } catch (e) { console.warn('[routes] OPK pool fetch error:', e.message); }
      }

      // Bundle is fresh per-request (OPK changes each time) — don't cache
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({
        ik:       rows[0].ik,
        ikSignPub: rows[0].ik_sign_pub,
        spk:      rows[0].spk,
        spkSig:   rows[0].spk_sig,
        ...(opk   ? { opk, opkId } : {}),
      }));
    } catch (e) { sendError(res, 500, 'Error fetching signal bundle', e, '/api/signal-bundle'); }
    return;
  }

  // ── Signal bundle — POST ───────────────────────────────────────────────────
  // The bundle must be published by the owning user only.  We accept two forms
  // of identity proof in priority order:
  //   1. An authenticated session cookie (OAuth users): userId must match session.sub
  //   2. The client-supplied userId that matches the registered WS peerId (anon users):
  //      the relay already validated their peerId during 'register'; we look up the
  //      live client record here and require the supplied userId to match it exactly.
  // Without this check, any peer could POST {userId:"victim", spk:"attacker-spk"} and
  // silently MitM every subsequent conversation the victim initiates.
  if (req.method === 'POST' && url.pathname === '/api/signal-bundle') {
    // Authenticated bundles carry a signed device binding plus the signed OPK list (~6.5 KB).
    parseBodyWithLimit(req, res, 65536).then(async (data) => {
      if (!data) return;
      try {
        const claimedUserId = sanitizeId(data.userId, 200);
        const ik        = typeof data.ik        === 'string' ? data.ik.slice(0, 500)        : null;
        const ikSignPub = typeof data.ikSignPub === 'string' ? data.ikSignPub.slice(0, 500) : null;
        const spk       = typeof data.spk       === 'string' ? data.spk.slice(0, 500)       : null;
        const opk       = typeof data.opk       === 'string' ? data.opk.slice(0, 500)       : null;
        const spkSig    = typeof data.spkSig    === 'string' ? data.spkSig.slice(0, 200)    : null;
        // Authenticated bundles may legitimately carry no selected OPK.
        const authenticated = data.version === 1 && data.binding && typeof data.binding === 'object';
        if (!claimedUserId || !ik || !spk || (!opk && !authenticated)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing required fields (userId, ik, spk, opk)' }));
          return;
        }
        if (!spkSig) {
          // Reject bundles without an SPK signature — clients running the updated
          // signalProtocol.ts always include one.  Old clients will re-publish after
          // their next key rotation; existing sessions are unaffected.
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Bundle must include spkSig (SPK must be signed by IK)' }));
          return;
        }

        // --- Ownership check ---
        // Authenticated bundles prove ownership themselves: the account key (= userId)
        // signs the device binding, which signs the SPK and every OPK. Being "online
        // with that userId" is NOT proof — WS register takes any client-supplied userId.
        const session = await getSecureSession(req);
        const sessionUserId = session ? sanitizeId(String(session.sub || ''), 200) : null;
        if (authenticated) {
          try { await verifyAuthenticatedBundle(data, claimedUserId); }
          catch (e) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Bundle signature check failed: ' + e.message }));
            return;
          }
        } else if (!sessionUserId || sessionUserId !== claimedUserId) {
          // Legacy unsigned bundles are only accepted from the matching OAuth session.
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Unsigned bundles require a matching authenticated session' }));
          return;
        }

        if (!db) { res.writeHead(503); res.end('DB unavailable'); return; }

        // If the identity key (ik) has changed, the user reinstalled or rotated keys.
        // All OPKs in the relay pool were generated with the OLD private keys — the
        // new client can never consume them. Delete them so the sender doesn't get
        // handed an OPK the receiver can't use, which would cause an X3DH masterKey
        // mismatch (sender derives 4-part key, receiver derives 3-part key → decrypt fails).
        try {
          const [existing] = await db.execute(
            `SELECT ik FROM signal_bundles WHERE user_id = ?`, [claimedUserId]
          );
          if (existing.length > 0 && existing[0].ik !== ik) {
            await db.execute(`DELETE FROM opk_pool WHERE user_id = ?`, [claimedUserId]);
            console.log(`[routes] IK rotated for ${claimedUserId.slice(0,8)} — cleared OPK pool`);
          }
        } catch (e) { console.warn('[routes] OPK pool clear check failed:', e.message); }

        if (authenticated) {
          const [prevRows] = await db.execute('SELECT bundle_json FROM signal_bundles WHERE user_id = ?', [claimedUserId]);
          if (isRollback(prevRows[0]?.bundle_json, data)) {
            res.writeHead(409, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Older bundle generation than the one on file' }));
            return;
          }
        }
        let bundleJson = null;
        if (authenticated) { const { userId: _u, ...bundle } = data; bundleJson = JSON.stringify(bundle); }
        await db.execute(
          `INSERT INTO signal_bundles (user_id, ik, ik_sign_pub, spk, opk, spk_sig, bundle_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE ik=VALUES(ik), ik_sign_pub=VALUES(ik_sign_pub), spk=VALUES(spk), opk=VALUES(opk), spk_sig=VALUES(spk_sig), bundle_json=VALUES(bundle_json), updated_at=VALUES(updated_at)`,
          [claimedUserId, ik, ikSignPub, spk, opk || '', spkSig, bundleJson, Date.now()]
        );
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) { sendError(res, 500, 'Error saving signal bundle', e, '/api/signal-bundle'); }
    }); return;
  }

  // ── OPK pool — POST (client replenishes one-time pre-keys) ─────────────────────────────
  // Body: { userId, opks: [{ id, pub }] }
  // Private keys never leave the device; only public halves are stored here.
  // The relay hands out one OPK per session via GET /api/signal-bundle.
  if (req.method === 'POST' && url.pathname === '/api/opk-pool') {
    parseBodyWithLimit(req, res, 32768).then(async (data) => {
      if (!data) return;
      try {
        const claimedUserId = sanitizeId(data.userId, 200);
        const opks = Array.isArray(data.opks) ? data.opks : [];
        if (!claimedUserId || opks.length === 0) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing userId or opks' })); return;
        }
        const session = await getSecureSession(req);
        const sessionUserId = session ? sanitizeId(String(session.sub || ''), 200) : null;
        if (sessionUserId) {
          if (sessionUserId !== claimedUserId) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'userId does not match session' })); return;
          }
        } else {
          // No proof of ownership available for anonymous callers (the web client
          // ships signed OPKs inside its bundle and never calls this endpoint).
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Authenticated session required' })); return;
        }
        if (!db) { res.writeHead(503); res.end('DB unavailable'); return; }
        for (const entry of opks.slice(0, 50)) {
          const id  = typeof entry.id  === 'string' ? entry.id.slice(0, 64)   : null;
          const pub = typeof entry.pub === 'string' ? entry.pub.slice(0, 500) : null;
          if (!id || !pub) continue;
          await db.execute(
            `INSERT IGNORE INTO opk_pool (id, user_id, pub, consumed, created_at) VALUES (?, ?, ?, 0, ?)`,
            [id, claimedUserId, pub, Date.now()]
          ).catch(() => {});
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) { sendError(res, 500, 'Error saving OPK pool', e, '/api/opk-pool'); }
    }); return;
  }

  // ── Sitemap ────────────────────────────────────────────────────────────────
  if (req.method === 'GET' && url.pathname === '/sitemap.xml') {
    res.setHeader('Content-Type', 'application/xml');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.end(await generateSitemap()); return;
  }

  // ── Robots ─────────────────────────────────────────────────────────────────
  if (req.method === 'GET' && url.pathname === '/robots.txt') {
    res.setHeader('Content-Type', 'text/plain');
    res.end(`User-agent: *\nAllow: /\nDisallow: /auth/\nDisallow: /api/\nSitemap: ${DOMAIN}/sitemap.xml\n`); return;
  }

  // ── Health (both /health and /api/health) ────────────────────────────────
  if (req.method === 'GET' && (url.pathname === '/health' || url.pathname === '/api/health')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok:        true,
      status:    'ok',
      timestamp: Date.now(),
      uptime:    process.uptime(),
      clients:   clients.size,
      activeChatRooms: activeChatSessions.size,
      cachedMessages:  messageCache.length,
      mysql:     db ? 'connected' : 'unavailable',
    }));
    return;
  }

  // ── Google OAuth ───────────────────────────────────────────────────────────
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
    const cookieNonce = getCookie(req, 'interpoll_oauth_state');
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
    const tenant   = process.env.MS_TENANT || 'common';
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
    const cookieNonce = getCookie(req, 'interpoll_oauth_state');
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
            const user = { provider: 'microsoft', sub: profile.sub, email: profile.email || profile.preferred_username, name: profile.name || profile.preferred_username || profile.email };
            await setSecureSession(res, req, user);
            res.writeHead(302, { Location: `${FRONTEND_ORIGIN}/auth/callback` }); res.end();
          });
      }).catch(err => { console.error('Microsoft OAuth error:', err); res.writeHead(500); res.end('Microsoft OAuth failed'); });
    return;
  }

  // ── Session ────────────────────────────────────────────────────────────────
  if (req.method === 'GET' && url.pathname === '/api/me') {
    const user = await getSecureSession(req);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ user: user || null })); return;
  }

  if (req.method === 'POST' && url.pathname === '/auth/logout') {
    const cookie = req.headers['cookie'] || '';
    const sid = cookie.split(';').find(c => c.trim().startsWith('sessionId='))?.split('=')[1];
    if (sid) { sessions.delete(sid); if (db) await db.execute(`DELETE FROM sessions WHERE session_id = ?`, [sid]); }
    res.setHeader('Set-Cookie', ['sessionId=; HttpOnly; Path=/; SameSite=None; Secure; Max-Age=0', 'jwt=; Path=/; SameSite=None; Secure; Max-Age=0']);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true })); return;
  }

  // ── Poll policy ────────────────────────────────────────────────────────────
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
        if (!pollId) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, reason: 'missing or invalid pollId' })); return; }
        if (typeof data.requireLogin !== 'boolean') { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, reason: 'requireLogin must be a boolean' })); return; }
        const ownerPubkey = sanitizeId(String(data._pub || ''), 130);
        if (!ownerPubkey) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, reason: 'missing signer public key' })); return; }
        const user = await getSecureSession(req);
        const ownerProvider = sanitizeId(String(user?.provider || ''), 32);
        const ownerSub = sanitizeId(String(user?.sub || ''), 128);
        if (data.requireLogin && !ownerSub) { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, reason: 'authentication required to register login-gated poll policy' })); return; }
        const existing = normalizePollPolicyRecord(pollPolicyRegistry.get(pollId));
        const needsOwnerBootstrap = !existing || !existing.ownerPubkey;
        let ownerRecord = null;
        if (needsOwnerBootstrap) {
          ownerRecord = await fetchPollPolicyOwnerRecord(pollId);
          if (!ownerRecord) { res.writeHead(409, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, reason: 'poll owner proof unavailable' })); return; }
          if (ownerRecord.authorPubkey !== ownerPubkey) { res.writeHead(403, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, reason: 'poll policy owner mismatch' })); return; }
        }
        if (existing && existing.requireLogin !== data.requireLogin) { res.writeHead(409, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, reason: 'poll vote policy mismatch' })); return; }
        if (existing && existing.ownerPubkey && existing.ownerPubkey !== ownerPubkey) { res.writeHead(403, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, reason: 'poll policy owner mismatch' })); return; }
        if (existing && existing.ownerSub && !ownerSub) { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, reason: 'authentication required for poll policy owner' })); return; }
        if (existing && existing.ownerSub && ownerSub && existing.ownerSub !== ownerSub) { res.writeHead(403, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, reason: 'poll policy owner mismatch' })); return; }
        pollPolicyRegistry.set(pollId, {
          requireLogin: data.requireLogin,
          ownerPubkey: existing?.ownerPubkey || ownerRecord?.authorPubkey || ownerPubkey,
          ownerProvider: existing?.ownerProvider || ownerProvider,
          ownerSub: existing?.ownerSub || ownerSub,
        });
        savePollPolicyRegistrySync();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, pollId, requireLogin: data.requireLogin }));
      } catch (err) { sendError(res, 500, 'Poll policy registration failed', err, '/api/poll-policy'); }
    }); return;
  }

  // ── Vote authorization ─────────────────────────────────────────────────────
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
        const pollId   = sanitizeId(String(data.pollId || ''), 128);
        const deviceId = sanitizeId(String(data.deviceId || ''), 128);
        if (!pollId || !deviceId) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ allowed: false, reason: 'missing or invalid pollId or deviceId' })); return; }
        const voterPubkey  = String(data._pub || '');
        const requireLogin = resolveRequireLoginPolicy(pollId);
        if (requireLogin == null) { res.writeHead(409, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ allowed: false, reason: 'poll vote policy unavailable' })); return; }
        const keyResult = await resolveVoteKeysForRequest(req, pollId, deviceId, voterPubkey, requireLogin);
        if (!keyResult.ok) { res.writeHead(keyResult.status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ allowed: false, reason: keyResult.reason })); return; }
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
        res.end(JSON.stringify({ allowed, reservationToken: allowed ? reservation.reservationToken : undefined, reason: allowed ? undefined : reservation.reason }));
      } catch (err) {
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
        if (!sealedValidation.ok) { res.writeHead(sealedValidation.status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, reason: sealedValidation.payload.error?.message || 'invalid receipt request' })); return; }
        if (!['vote', 'comment'].includes(String(data.type || '')) || !data.payload || typeof data.payload !== 'object' || Array.isArray(data.payload)) {
          res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, reason: 'invalid receipt payload' })); return;
        }
        if (data.type === 'vote') {
          const pollId   = sanitizeId(String(data.payload.pollId || ''), 128);
          const deviceId = sanitizeId(String(data.payload.deviceId || ''), 128);
          const voteHash = sanitizeId(String(data.payload.voteHash || ''), 160);
          if (!pollId || !deviceId || !voteHash) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, reason: 'invalid vote receipt payload' })); return; }
          const requireLogin = resolveRequireLoginPolicy(pollId);
          if (requireLogin == null) { res.writeHead(409, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, reason: 'poll vote policy unavailable' })); return; }
          const voterPubkey = String(data._pub || '');
          const keyResult = await resolveVoteKeysForRequest(req, pollId, deviceId, voterPubkey, requireLogin);
          if (!keyResult.ok) { res.writeHead(keyResult.status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, reason: keyResult.reason })); return; }
          if (!voteRegistry.has(keyResult.identityKey) && (!keyResult.legacyKey || !voteRegistry.has(keyResult.legacyKey))) {
            res.writeHead(409, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, reason: 'vote receipt does not match committed vote state' })); return;
          }
        } else {
          const commentId = sanitizeId(String(data.payload.commentId || ''), 128);
          const postId    = sanitizeId(String(data.payload.postId || ''), 128);
          if (!commentId || !postId) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, reason: 'invalid comment receipt payload' })); return; }
        }
        fs.appendFile(RECEIPT_LOG_FILE, JSON.stringify({ type: 'receipt', payload: data, timestamp: Date.now() }) + '\n', () => {});
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch { sendError(res, 500, 'Receipt processing failed', null, '/api/receipts'); }
    }); return;
  }

  if (req.method === 'POST' && url.pathname === '/api/vote-record') { handleVoteCommit(req, res, '/api/vote-record', 'vote-record'); return; }
  if (req.method === 'POST' && url.pathname === '/api/vote-confirm') { handleVoteCommit(req, res, '/api/vote-confirm', 'vote-confirm'); return; }

  // ── GET /api/communities ───────────────────────────────────────────────────
  if (req.method === 'GET' && url.pathname === '/api/communities') {
    if (!db) { res.writeHead(503, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ communities: [] })); return; }
    // This route previously unioned v3, v2 and un-prefixed community souls and
    // returned them with no dataVersion field at all. The client had no version
    // guard on this path either, so it re-imported legacy communities into the
    // current namespace on every page load — long after the v4 bump.
    const nsPrefix = resolveNamespace(url.searchParams.get('dataVersion'));
    if (nsPrefix === null) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'unknown dataVersion' })); return;
    }
    try {
      const rows = await queryMySQL(`SELECT soul, data FROM gun_nodes WHERE soul REGEXP '^${nsPrefix}/communities/c-[^/]+$' ORDER BY JSON_EXTRACT(data, '$.createdAt') DESC LIMIT 200`, []);
      const communities = [];
      const seen = new Set();
      const communityIds = [];
      for (const row of rows || []) {
        try {
          const d = JSON.parse(row.data);
          if (!d?.id || !d?.displayName || seen.has(d.id)) continue;
          const rowNs = namespaceOfSoul(row.soul);
          if (rowNs !== nsPrefix) continue;
          if (!belongsToNamespace(d, nsPrefix)) continue;
          seen.add(d.id);
          if (d.darkMode) continue; // suppress dark communities from public listings
          communityIds.push(d.id);
          communities.push({ id: d.id, name: d.name || d.id, displayName: d.displayName, description: d.description || '', creatorId: d.creatorId || '', isPrivate: d.isPrivate || false, category: d.category || null, memberCount: d.memberCount || 0, postCount: d.postCount || 0, createdAt: d.createdAt || 0, rules: Array.isArray(d.rules) ? d.rules : [], relay: DOMAIN, dataVersion: rowNs });
        } catch {}
      }
      if (communityIds.length > 0) {
        try {
          const placeholders = communityIds.map(() => '?').join(',');
          const [countRows] = await db.execute(`SELECT community, COUNT(*) as total FROM search_index WHERE community IN (${placeholders}) GROUP BY community`, communityIds);
          const countMap = new Map((countRows || []).map(r => [r.community, r.total]));
          for (const c of communities) { const real = countMap.get(c.id); if (real !== undefined) c.postCount = real; }
        } catch (err) { console.warn('[api/communities] count query failed:', err.message); }
      }
      communities.sort((a, b) => b.postCount - a.postCount);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=30, stale-while-revalidate=60' });
      res.end(JSON.stringify({ communities })); return;
    } catch { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ communities: [] })); return; }
  }

  // ── GET /api/trending-categories ──────────────────────────────────────────
  if (req.method === 'GET' && url.pathname === '/api/trending-categories') {
    if (!db) { res.writeHead(503, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ categories: [] })); return; }
    try {
      const [rows] = await db.execute(`SELECT category, COUNT(*) as total FROM search_index WHERE category IS NOT NULL AND category != '' GROUP BY category ORDER BY total DESC LIMIT 20`);
      const categories = (rows || []).map(r => ({ id: r.category, label: r.category.charAt(0).toUpperCase() + r.category.slice(1).replace(/-/g, ' '), posts: r.total >= 1000 ? `${(r.total / 1000).toFixed(1)}k` : String(r.total), count: r.total }));
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60, stale-while-revalidate=120' });
      res.end(JSON.stringify({ categories })); return;
    } catch { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ categories: [] })); return; }
  }

  // ── POST /api/upload-video ─────────────────────────────────────────────────
  if (req.method === 'POST' && url.pathname === '/api/upload-video') {
    const FILEBASE_ACCESS_KEY = process.env.FILEBASE_ACCESS_KEY;
    const FILEBASE_SECRET_KEY = process.env.FILEBASE_SECRET_KEY;
    const FILEBASE_BUCKET     = process.env.FILEBASE_BUCKET;
    if (!FILEBASE_ACCESS_KEY || !FILEBASE_SECRET_KEY || !FILEBASE_BUCKET) {
      res.writeHead(503, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: 'Video upload not configured' })); return;
    }
    const MAX_BYTES = 30 * 1024 * 1024;
    const contentType = req.headers['content-type'] || '';
    const boundaryMatch = contentType.match(/boundary=("?)([^";\s]+)\1/);
    if (!boundaryMatch) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: 'Missing multipart boundary' })); return; }
    const boundary = boundaryMatch[2];
    let totalBytes = 0, chunks = [], tooBig = false;
    await new Promise((resolve) => {
      req.on('data', (chunk) => { totalBytes += chunk.length; if (totalBytes > MAX_BYTES) { tooBig = true; req.destroy(); resolve(); return; } chunks.push(chunk); });
      req.on('end', resolve); req.on('error', resolve);
    });
    if (tooBig) { res.writeHead(413, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: 'File exceeds 30 MB limit' })); return; }
    const body = Buffer.concat(chunks);
    const CRLF = Buffer.from('\r\n'), DASHES = Buffer.from('--'), boundaryBuf = Buffer.from(boundary);
    const delimBuf = Buffer.concat([DASHES, boundaryBuf]);
    let fileBuffer = null, fileName = 'upload', fileMime = 'application/octet-stream', uploadType = 'video';
    let pos = 0;
    while (pos < body.length) {
      const delimIdx = body.indexOf(delimBuf, pos);
      if (delimIdx === -1) break;
      pos = delimIdx + delimBuf.length;
      if (body[pos] === 0x2D && body[pos + 1] === 0x2D) break;
      if (body[pos] === 0x0D) pos += 2;
      const headerEnd = body.indexOf(Buffer.from('\r\n\r\n'), pos);
      if (headerEnd === -1) break;
      const headerStr = body.slice(pos, headerEnd).toString('utf8');
      pos = headerEnd + 4;
      const nextDelim = body.indexOf(delimBuf, pos);
      const partEnd = nextDelim === -1 ? body.length : nextDelim - 2;
      const partBody = body.slice(pos, partEnd);
      pos = nextDelim === -1 ? body.length : nextDelim;
      const dispMatch = headerStr.match(/Content-Disposition:[^\r\n]*name="([^"]+)"/i);
      const partName = dispMatch ? dispMatch[1] : '';
      const fnMatch  = headerStr.match(/filename="([^"]+)"/i);
      const ctMatch  = headerStr.match(/Content-Type:\s*([^\r\n]+)/i);
      if (partName === 'type') { uploadType = partBody.toString('utf8').trim(); }
      else if (partName === 'file' || fnMatch) {
        fileBuffer = partBody;
        if (fnMatch) fileName = fnMatch[1].replace(/[^a-zA-Z0-9._\-]/g, '_');
        if (ctMatch) fileMime = ctMatch[1].trim();
      }
    }
    if (!fileBuffer || fileBuffer.length === 0) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: 'No file found in request' })); return; }
    const ALLOWED_MIME = new Set(['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime', 'image/jpeg', 'image/png', 'image/webp', 'image/gif']);
    if (!ALLOWED_MIME.has(fileMime)) { res.writeHead(415, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: `Unsupported MIME type: ${fileMime}` })); return; }
    const prefix = uploadType === 'thumbnail' ? 'thumbnails' : 'videos';
    const slug   = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const objectKey = `${prefix}/${slug}/${fileName}`;
    const crypto = await import('crypto');
    const host = 's3.filebase.com', region = 'us-east-1', service = 's3';
    const now = new Date();
    const amzDate  = now.toISOString().replace(/[:\-]|\.\d{3}/g, '').slice(0, 15) + 'Z';
    const dateStamp = amzDate.slice(0, 8);
    const contentHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
    const canonicalHeaders = `content-length:${fileBuffer.length}\ncontent-type:${fileMime}\nhost:${host}\nx-amz-content-sha256:${contentHash}\nx-amz-date:${amzDate}\n`;
    const signedHeaders = 'content-length;content-type;host;x-amz-content-sha256;x-amz-date';
    const canonicalRequest = `PUT\n/${FILEBASE_BUCKET}/${objectKey}\n\n${canonicalHeaders}\n${signedHeaders}\n${contentHash}`;
    const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
    const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n` + crypto.createHash('sha256').update(canonicalRequest).digest('hex');
    const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();
    const signingKey = hmac(hmac(hmac(hmac(`AWS4${FILEBASE_SECRET_KEY}`, dateStamp), region), service), 'aws4_request');
    const signature  = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');
    const authHeader = `AWS4-HMAC-SHA256 Credential=${FILEBASE_ACCESS_KEY}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    try {
      const fetchFn = typeof fetch !== 'undefined' ? fetch : (await import('undici')).fetch;
      const s3Res = await fetchFn(`https://${host}/${FILEBASE_BUCKET}/${objectKey}`, { method: 'PUT', headers: { 'Content-Type': fileMime, 'Content-Length': String(fileBuffer.length), 'x-amz-date': amzDate, 'x-amz-content-sha256': contentHash, 'Authorization': authHeader }, body: fileBuffer, duplex: 'half' });
      if (!s3Res.ok) { const errText = await s3Res.text().catch(() => ''); console.error('[upload-video] Filebase PUT failed', s3Res.status, errText); res.writeHead(502, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: `Filebase error ${s3Res.status}` })); return; }
      const cid = s3Res.headers.get('x-amz-meta-cid') || null;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, cid, size: fileBuffer.length, mimeType: fileMime, objectKey }));
    } catch (err) { console.error('[upload-video] fetch error:', err); res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: 'Upload failed' })); }
    return;
  }

  // ── GET /api/posts ─────────────────────────────────────────────────────────
  if (req.method === 'GET' && url.pathname === '/api/posts') {
    if (!db) { res.writeHead(503, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ posts: [], hasMore: false })); return; }
    const limit = Math.max(1, Math.min(parseInt(url.searchParams.get('limit') || '20') || 20, 50));
    const before = parseInt(url.searchParams.get('before') || '0') || 0;
    const communityParam = url.searchParams.get('communityId') || '';
    // Strict: an unrecognised value is an error, not a silent fall back to v3.
    const nsPrefix = resolveNamespace(url.searchParams.get('dataVersion'));
    if (nsPrefix === null) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'unknown dataVersion' })); return;
    }
    const communityIds = communityParam ? communityParam.split(',').map(s => sanitizeId(s.trim(), 128)).filter(Boolean).slice(0, 20) : [];
    try {
      const cursorClause = before > 0 ? `AND JSON_EXTRACT(data, '$.createdAt') < ?` : '';
      const cursorParams = before > 0 ? [before] : [];
      let sql, params;
      if (communityIds.length > 0) {
        const likeClauses = communityIds.map(() => `soul LIKE ? ESCAPE '\\\\'`).join(' OR ');
        const likeParams = communityIds.map(id => `${nsPrefix}/communities/${id.replace(/[%_\\\\]/g, '\\\\$&')}/posts/post-%`);
        sql = `SELECT soul, data FROM gun_nodes WHERE (${likeClauses}) AND soul NOT REGEXP '/options|/comments|/inviteCodes' ${cursorClause} ORDER BY JSON_EXTRACT(data, '$.createdAt') DESC LIMIT ${limit + 1}`;
        params = [...likeParams, ...cursorParams];
      } else {
        sql = `SELECT soul, data FROM gun_nodes WHERE soul REGEXP '^${nsPrefix}/communities/[^/]+/posts/post-[^/]+$' ${cursorClause} ORDER BY JSON_EXTRACT(data, '$.createdAt') DESC LIMIT ${limit + 1}`;
        params = [...cursorParams];
      }
      const rows = await queryMySQL(sql, params);
      const posts = [];
      const seen = new Set();
      for (const row of (rows || []).slice(0, limit)) {
        try {
          const d = JSON.parse(row.data);
          if (!d?.id || !d?.title || !d?.communityId || seen.has(d.id)) continue;
          seen.add(d.id);
          posts.push(serializePost(d, nsPrefix));
        } catch {}
      }
      const hasMore = (rows || []).length > limit;
      // Enrich with view_count + unique_viewers from search_index
      if (posts.length > 0) {
        try {
          const ids = posts.map(p => p.id).filter(Boolean);
          const placeholders = ids.map(() => '?').join(',');
          const [viewRows] = await db.execute(
            `SELECT id, view_count, unique_viewers FROM search_index WHERE id IN (${placeholders})`,
            ids
          );
          const viewMap = new Map((viewRows || []).map(r => [r.id, r]));
          for (const p of posts) {
            p.viewCount     = viewMap.get(p.id)?.view_count     ?? 0;
            p.uniqueViewers = viewMap.get(p.id)?.unique_viewers ?? 0;
          }
        } catch(e) { /* non-fatal — views optional */ }
      }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=15, stale-while-revalidate=45' });
      res.end(JSON.stringify({ posts, hasMore })); return;
    } catch { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ posts: [], hasMore: false })); return; }
  }

  // ── GET /api/comment-counts ────────────────────────────────────────────────
  if (req.method === 'GET' && url.pathname === '/api/comment-counts') {
    if (!db) { res.writeHead(503, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ counts: {} })); return; }
    const idsParam = url.searchParams.get('ids') || '';
    const ids = idsParam.split(',').map(s => sanitizeId(s.trim(), 128)).filter(Boolean).slice(0, 50);
    if (ids.length === 0) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'ids required' })); return; }
    try {
      const likeClauses = ids.map(() => `soul LIKE ? ESCAPE '\\\\'`).join(' OR ');
      const likeParams = ids.map(id => `%/${id.replace(/[%_\\\\]/g, '\\\\$&')}/comments/%`);
      const rows = await queryMySQL(`SELECT soul FROM gun_nodes WHERE (${likeClauses})`, likeParams);
      const counts = Object.fromEntries(ids.map(id => [id, 0]));
      for (const row of rows || []) {
        const m = row.soul.match(/\/(post-[^/]+|poll-[^/]+)\/comments\//);
        if (m && counts[m[1]] !== undefined) counts[m[1]]++;
      }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=30, stale-while-revalidate=60' });
      res.end(JSON.stringify({ counts })); return;
    } catch { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ counts: {} })); return; }
  }

  // ── GET /api/feed ──────────────────────────────────────────────────────────
  if (req.method === 'GET' && url.pathname === '/api/feed') {
    if (!db) { res.writeHead(503, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ items: [], hasMore: false })); return; }
    const limit = Math.max(1, Math.min(parseInt(url.searchParams.get('limit') || '20') || 20, 50));
    const before = parseInt(url.searchParams.get('before') || '0') || 0;
    const communityParam = url.searchParams.get('communityIds') || '';
    const nsPrefix = resolveNamespace(url.searchParams.get('dataVersion'));
    if (nsPrefix === null) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'unknown dataVersion' })); return;
    }
    const communityIds = communityParam ? communityParam.split(',').map(s => sanitizeId(s.trim(), 128)).filter(Boolean).slice(0, 20) : [];
    const cursorClause = before > 0 ? `AND JSON_EXTRACT(data, '$.createdAt') < ?` : '';
    const cursorParams = before > 0 ? [before] : [];
    const innerLimit = limit + 1;
    try {
      let postSql, pollSql, postParams, pollParams;
      if (communityIds.length > 0) {
        const likeClauses = communityIds.map(() => `soul LIKE ? ESCAPE '\\\\'`).join(' OR ');
        const postLikeParams = communityIds.map(id => `${nsPrefix}/communities/${id.replace(/[%_\\\\]/g, '\\\\$&')}/posts/post-%`);
        const pollLikeParams = communityIds.map(id => `${nsPrefix}/communities/${id.replace(/[%_\\\\]/g, '\\\\$&')}/polls/poll-%`);
        postSql = `SELECT soul, data FROM gun_nodes WHERE (${likeClauses}) ${cursorClause} ORDER BY JSON_EXTRACT(data,'$.createdAt') DESC LIMIT ${innerLimit}`;
        pollSql = `SELECT soul, data FROM gun_nodes WHERE (${likeClauses}) AND soul NOT REGEXP '/options|/inviteCodes' ${cursorClause} ORDER BY JSON_EXTRACT(data,'$.createdAt') DESC LIMIT ${innerLimit}`;
        postParams = [...postLikeParams, ...cursorParams];
        pollParams = [...pollLikeParams, ...cursorParams];
      } else {
        postSql = `SELECT soul, data FROM gun_nodes WHERE soul REGEXP '^${nsPrefix}/communities/[^/]+/posts/post-[^/]+$' ${cursorClause} ORDER BY JSON_EXTRACT(data,'$.createdAt') DESC LIMIT ${innerLimit}`;
        pollSql = `SELECT soul, data FROM gun_nodes WHERE soul REGEXP '^${nsPrefix}/communities/[^/]+/polls/poll-[^/]+$' AND soul NOT REGEXP '/options|/inviteCodes' ${cursorClause} ORDER BY JSON_EXTRACT(data,'$.createdAt') DESC LIMIT ${innerLimit}`;
        postParams = [...cursorParams]; pollParams = [...cursorParams];
      }
      const [postRows, pollRows] = await Promise.all([queryMySQL(postSql, postParams), queryMySQL(pollSql, pollParams)]);
      const seenPollIds = [];
      for (const row of pollRows || []) { try { const d = JSON.parse(row.data); if (d?.id && d?.question && !d?.isPrivate) seenPollIds.push(d.id); } catch {} }
      const optionsByPoll = new Map();
      if (seenPollIds.length > 0) {
        const lc2 = seenPollIds.map(() => `soul LIKE ? ESCAPE '\\\\'`).join(' OR ');
        const lp2 = seenPollIds.map(id => `%/polls/${id.replace(/[%_\\\\]/g, '\\\\$&')}/options/%`);
        const optRows = await queryMySQL(`SELECT soul, data FROM gun_nodes WHERE (${lc2}) LIMIT ${seenPollIds.length * 30}`, lp2);
        for (const optRow of optRows || []) {
          try {
            const o = JSON.parse(optRow.data);
            if (!o?.id || !o?.text) continue;
            const m = optRow.soul.match(/\/polls\/(poll-[^/]+)\/options\//);
            if (!m) continue;
            if (!optionsByPoll.has(m[1])) optionsByPoll.set(m[1], []);
            const ex = optionsByPoll.get(m[1]);
            if (!ex.find(x => x.id === o.id)) ex.push({ id: o.id, text: o.text || '', votes: o.votes || 0, voters: [] });
          } catch {}
        }
      }
      const items = [];
      const seen = new Set();
      const now = Date.now();
      for (const row of postRows || []) {
        try {
          const d = JSON.parse(row.data);
          if (!d?.id || !d?.title || !d?.communityId || seen.has(d.id)) continue;
          seen.add(d.id);
          items.push({ type: 'post', createdAt: d.createdAt || 0, data: serializePost(d, nsPrefix) });
        } catch {}
      }
      for (const row of pollRows || []) {
        try {
          const d = JSON.parse(row.data);
          if (!d?.id || !d?.question || !d?.communityId || seen.has(d.id) || d.isPrivate) continue;
          seen.add(d.id);
          const options = optionsByPoll.get(d.id) || [];
          items.push({ type: 'poll', createdAt: d.createdAt || 0, data: serializePoll(d, options, nsPrefix, now) });
        } catch {}
      }
      items.sort((a, b) => b.createdAt - a.createdAt);
      const hasMore = items.length > limit;
      const pageItems = items.slice(0, limit);
      // Enrich with view_count + unique_viewers from search_index
      if (pageItems.length > 0) {
        try {
          const ids = pageItems.map(i => i.data?.id).filter(Boolean);
          const placeholders = ids.map(() => '?').join(',');
          const [viewRows] = await db.execute(
            `SELECT id, view_count, unique_viewers FROM search_index WHERE id IN (${placeholders})`,
            ids
          );
          const viewMap = new Map((viewRows || []).map(r => [r.id, r]));
          for (const item of pageItems) {
            if (item.data?.id) {
              item.data.viewCount     = viewMap.get(item.data.id)?.view_count     ?? 0;
              item.data.uniqueViewers = viewMap.get(item.data.id)?.unique_viewers ?? 0;
            }
          }
        } catch(e) { /* non-fatal */ }
      }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=10, stale-while-revalidate=30' });
      res.end(JSON.stringify({ items: pageItems, hasMore })); return;
    } catch { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ items: [], hasMore: false })); return; }
  }

  // ── POST /api/content-vote ─────────────────────────────────────────────────
  if (req.method === 'POST' && url.pathname === '/api/content-vote') {
    await handleEngagement(req, res, { db, namespace: NAMESPACE }); return;
  }

  // ── GET /api/vote-tally ────────────────────────────────────────────────────
  if (req.method === 'GET' && url.pathname === '/api/vote-tally') {
    if (!db) { res.writeHead(503, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ tallies: {} })); return; }
    const idsParam = url.searchParams.get('ids') || '';
    const ids = idsParam.split(',').map(s => sanitizeId(s.trim(), 128)).filter(Boolean).slice(0, 50);
    if (ids.length === 0) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'ids required' })); return; }
    try {
      const likeClauses = ids.map(() => `soul LIKE ? ESCAPE '\\\\'`).join(' OR ');
      const likeParams = ids.map(id => `${NAMESPACE}/postVotes/${id.replace(/[%_\\\\]/g, '\\\\$&')}/%`);
      const rows = await queryMySQL(`SELECT soul, data FROM gun_nodes WHERE (${likeClauses})`, likeParams);
      const postSouls = ids.map(id => `${NAMESPACE}/posts/${id}`);
      const postLikeClauses = ids.map(() => `soul = ?`).join(' OR ');
      const postRows = await queryMySQL(`SELECT soul, data FROM gun_nodes WHERE (${postLikeClauses})`, postSouls);
      const baselineMap = new Map();
      for (const row of postRows || []) {
        try {
          const d = JSON.parse(row.data);
          const id = row.soul.replace(`${NAMESPACE}/posts/`, '');
          if (d.voteBaselineAt) { baselineMap.set(id, { up: Number(d.voteBaselineUp) || 0, down: Number(d.voteBaselineDown) || 0 }); }
          else { baselineMap.set(id, { up: Number(d.upvotes) || 0, down: Number(d.downvotes) || 0 }); }
        } catch {}
      }
      const votesByPost = new Map(ids.map(id => [id, []]));
      for (const row of rows || []) {
        try {
          const parts = row.soul.split('/');
          const postId = parts[2];
          if (!postId || !votesByPost.has(postId)) continue;
          const vote = displayedReaction(row, NAMESPACE);
          if (vote) votesByPost.get(postId).push(vote);
        } catch {}
      }
      const tallies = {};
      for (const id of ids) {
        const baseline = baselineMap.get(id) ?? { up: 0, down: 0 };
        let up = baseline.up, down = baseline.down;
        for (const { vote, baselineType } of votesByPost.get(id) || []) {
          if (baselineType === 'up') up -= 1; else if (baselineType === 'down') down -= 1;
          if (vote === 'up') up += 1; else if (vote === 'down') down += 1;
        }
        tallies[id] = { upvotes: Math.max(0, up), downvotes: Math.max(0, down), score: Math.max(0, up) - Math.max(0, down) };
      }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
      res.end(JSON.stringify({ tallies, evidence: 'legacy-inclusive-unverified' })); return;
    } catch (err) { sendError(res, 500, 'Internal error', err, '/api/vote-tally'); return; }
  }

  // ── GET /api/post/:id ──────────────────────────────────────────────────────
  if (req.method === 'GET' && url.pathname.startsWith('/api/post/')) {
    const postId = url.pathname.split('/')[3];
    if (!postId || !db) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'not found' })); return; }
    try {
      const escaped = postId.replace(/[%_\\]/g, '\\$&');
      // Scoped to the active namespace. This used to union v3, v2 and
      // un-prefixed souls, so a permalink would happily serve a legacy post.
      const rows = await queryMySQL(`SELECT soul, data FROM gun_nodes WHERE soul LIKE ? ESCAPE ? OR soul = ? LIMIT 8`, [`${NAMESPACE}/communities/%/posts/${escaped}`, '\\', `${NAMESPACE}/posts/${postId}`]);
      for (const row of rows || []) {
        try {
          const d = JSON.parse(row.data);
          if (!d?.title) continue;
          const rowNs = namespaceOfSoul(row.soul);
          if (rowNs !== NAMESPACE || !belongsToNamespace(d, NAMESPACE)) continue;
          let upvotes = d.upvotes || 0, downvotes = d.downvotes || 0;
          try {
            const escaped2 = postId.replace(/[%_\\]/g, '\\$&');
            const voteRows = await queryMySQL(`SELECT data FROM gun_nodes WHERE soul LIKE ? ESCAPE '\\\\'`, [`${NAMESPACE}/postVotes/${escaped2}/%`]);
            if (voteRows && voteRows.length > 0) {
              const baseline = d.voteBaselineAt ? { up: Number(d.voteBaselineUp) || 0, down: Number(d.voteBaselineDown) || 0 } : { up: upvotes, down: downvotes };
              let up = baseline.up, down = baseline.down;
              for (const vr of voteRows) {
                try { const v = JSON.parse(vr.data); const bt = v?.baselineType; if (bt === 'up') up -= 1; else if (bt === 'down') down -= 1; if (v?.type === 'up') up += 1; else if (v?.type === 'down') down += 1; } catch {}
              }
              upvotes = Math.max(0, up); downvotes = Math.max(0, down);
            }
          } catch {}
          res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=10, stale-while-revalidate=30' });
          res.end(JSON.stringify({ ...d, id: d.id || postId, upvotes, downvotes, score: upvotes - downvotes, dataVersion: rowNs })); return;
        } catch {}
      }
      res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'not found' })); return;
    } catch (err) { sendError(res, 500, 'Internal error', err, '/api/post'); return; }
  }

  // ── GET /api/polls ─────────────────────────────────────────────────────────
  if (req.method === 'GET' && url.pathname === '/api/polls') {
    if (!db) { res.writeHead(503, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ polls: [], hasMore: false })); return; }
    const limit = Math.max(1, Math.min(parseInt(url.searchParams.get('limit') || '20') || 20, 50));
    const before = parseInt(url.searchParams.get('before') || '0') || 0;
    const communityParam = url.searchParams.get('communityId') || '';
    // Strict: an unrecognised value is an error, not a silent fall back to v3.
    const nsPrefix = resolveNamespace(url.searchParams.get('dataVersion'));
    if (nsPrefix === null) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'unknown dataVersion' })); return;
    }
    const communityIds = communityParam ? communityParam.split(',').map(s => sanitizeId(s.trim(), 128)).filter(Boolean).slice(0, 20) : [];
    try {
      const cursorClause = before > 0 ? `AND JSON_EXTRACT(data, '$.createdAt') < ?` : '';
      const cursorParams = before > 0 ? [before] : [];
      let sql, params;
      if (communityIds.length > 0) {
        const likeClauses = communityIds.map(() => `soul LIKE ? ESCAPE '\\\\'`).join(' OR ');
        const likeParams = communityIds.map(id => `${nsPrefix}/communities/${id.replace(/[%_\\\\]/g, '\\\\$&')}/polls/poll-%`);
        sql = `SELECT soul, data FROM gun_nodes WHERE (${likeClauses}) AND soul NOT REGEXP '/options|/inviteCodes|/comments' ${cursorClause} ORDER BY JSON_EXTRACT(data, '$.createdAt') DESC LIMIT ${limit + 1}`;
        params = [...likeParams, ...cursorParams];
      } else {
        sql = `SELECT soul, data FROM gun_nodes WHERE soul REGEXP '^${nsPrefix}/communities/[^/]+/polls/poll-[^/]+$' AND soul NOT REGEXP '/options|/inviteCodes' ${cursorClause} ORDER BY JSON_EXTRACT(data, '$.createdAt') DESC LIMIT ${limit + 1}`;
        params = [...cursorParams];
      }
      const pollRows = await queryMySQL(sql, params);
      const pollDataList = [];
      const seen = new Set();
      for (const row of (pollRows || []).slice(0, limit)) {
        try { const d = JSON.parse(row.data); if (!d?.id || !d?.question || !d?.communityId || seen.has(d.id) || d.isPrivate) continue; seen.add(d.id); pollDataList.push(d); } catch {}
      }
      const optionsByPoll = new Map();
      if (pollDataList.length > 0) {
        const lc = pollDataList.map(() => `soul LIKE ? ESCAPE '\\\\'`).join(' OR ');
        const lp = pollDataList.map(d => `%/polls/${d.id.replace(/[%_\\\\]/g, '\\\\$&')}/options/%`);
        const optRows = await queryMySQL(`SELECT soul, data FROM gun_nodes WHERE (${lc}) LIMIT ${pollDataList.length * 30}`, lp);
        for (const optRow of optRows || []) {
          try {
            const o = JSON.parse(optRow.data);
            if (!o?.id || !o?.text) continue;
            const m = optRow.soul.match(/\/polls\/(poll-[^/]+)\/options\//);
            if (!m) continue;
            if (!optionsByPoll.has(m[1])) optionsByPoll.set(m[1], []);
            const ex = optionsByPoll.get(m[1]);
            if (!ex.find(x => x.id === o.id)) ex.push({ id: o.id, text: o.text || '', votes: o.votes || 0, voters: [] });
          } catch {}
        }
      }
      const now = Date.now();
      const polls = pollDataList.map(d => {
        const options = optionsByPoll.get(d.id) || [];
        return serializePoll(d, options, nsPrefix, now);
      });
      // Enrich with view counts from search_index
      if (polls.length > 0) {
        try {
          const ids = polls.map(p => p.id).filter(Boolean);
          const placeholders = ids.map(() => '?').join(',');
          const [viewRows] = await db.execute(
            `SELECT id, view_count, unique_viewers FROM search_index WHERE id IN (${placeholders})`,
            ids
          );
          const viewMap = new Map((viewRows || []).map(r => [r.id, r]));
          for (const p of polls) {
            p.viewCount     = viewMap.get(p.id)?.view_count     ?? 0;
            p.uniqueViewers = viewMap.get(p.id)?.unique_viewers ?? 0;
          }
        } catch { /* non-fatal */ }
      }
      const hasMore = (pollRows || []).length > limit;
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=15, stale-while-revalidate=45' });
      res.end(JSON.stringify({ polls, hasMore })); return;
    } catch { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ polls: [], hasMore: false })); return; }
  }

  // ── GET /api/poll/:id ──────────────────────────────────────────────────────
  if (req.method === 'GET' && url.pathname.startsWith('/api/poll/')) {
    const pollId = url.pathname.split('/')[3];
    if (!pollId || !db) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'not found' })); return; }
    try {
      const escaped = pollId.replace(/[%_\\]/g, '\\$&');
      const rows = await queryMySQL(`SELECT soul, data FROM gun_nodes WHERE (soul LIKE ? ESCAPE ? OR soul = ?) AND soul NOT REGEXP '/options' LIMIT 5`, [`${NAMESPACE}/%/polls/${escaped}`, '\\', `${NAMESPACE}/polls/${pollId}`]);
      for (const row of rows || []) {
        try {
          const d = JSON.parse(row.data);
          if (!d?.question) continue;
          const optRows = await queryMySQL(`SELECT data FROM gun_nodes WHERE soul LIKE ? ESCAPE ? LIMIT 20`, [`%/polls/${escaped}/options/%`, '\\']);
          const options = [];
          for (const optRow of optRows || []) {
            try { const o = JSON.parse(optRow.data); if (o?.id && !options.find(x => x.id === o.id)) options.push({ id: o.id, text: o.text || '', votes: o.votes || 0, voters: [] }); } catch {}
          }
          const serialized = serializePoll(d, options, NAMESPACE, Date.now());
          // Enrich with view counts from search_index
          try {
            const [vr] = await db.execute(
              `SELECT view_count, unique_viewers FROM search_index WHERE id = ?`, [d.id || pollId]
            );
            if (vr?.[0]) {
              serialized.viewCount     = vr[0].view_count     ?? 0;
              serialized.uniqueViewers = vr[0].unique_viewers ?? 0;
            }
          } catch { /* non-fatal */ }
          res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=30, stale-while-revalidate=60' });
          res.end(JSON.stringify({ ...serialized, id: d.id || pollId })); return;
        } catch {}
      }
      res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'not found' })); return;
    } catch (err) { sendError(res, 500, 'Internal error', err, '/api/poll'); return; }
  }

  // ── GET /api/polls/:id/results — time-lock aware results ─────────────────────
  if (req.method === 'GET' && url.pathname.match(/^\/api\/polls\/[^/]+\/results$/)) {
    const pollId = sanitizeId(url.pathname.split('/')[3], 128);
    if (!pollId || !db) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'not found' })); return; }
    try {
      const escaped = pollId.replace(/[%_\\]/g, '\\$&');
      const rows = await queryMySQL(
        `SELECT soul, data FROM gun_nodes WHERE (soul LIKE ? ESCAPE ? OR soul = ?) AND soul NOT REGEXP '/options' LIMIT 5`,
        [`${NAMESPACE}/%/polls/${escaped}`, '\\', `${NAMESPACE}/polls/${pollId}`]
      );
      for (const row of rows || []) {
        try {
          const d = JSON.parse(row.data);
          if (!d?.question) continue;
          if (shouldLockResults(d)) {
            res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
            res.end(JSON.stringify({
              locked: true,
              resultsLockedUntil: d.resultsLockedUntil,
              timeLockMode: d.timeLockMode || null,
              timeLockBlock: d.timeLockBlock || null,
            }));
            return;
          }
          const optRows = await queryMySQL(
            `SELECT data FROM gun_nodes WHERE soul LIKE ? ESCAPE ? LIMIT 20`,
            [`%/polls/${escaped}/options/%`, '\\']
          );
          const options = [];
          for (const optRow of optRows || []) {
            try { const o = JSON.parse(optRow.data); if (o?.id && !options.find(x => x.id === o.id)) options.push({ id: o.id, text: o.text || '', votes: o.votes || 0 }); } catch {}
          }
          res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=30, stale-while-revalidate=60' });
          res.end(JSON.stringify({ locked: false, options, totalVotes: options.reduce((s, o) => s + o.votes, 0) }));
          return;
        } catch {}
      }
      res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'not found' }));
    } catch (err) { sendError(res, 500, 'Internal error', err, '/api/polls/:id/results'); }
    return;
  }

  // ── GET /api/tags/trending ─────────────────────────────────────────────────
  // Counts tag frequency by fetching raw tag strings from MySQL and splitting
  // in JS — avoids JSON_TABLE (MySQL 8.0+ only) and fragile CONCAT hacks.
  if (req.method === 'GET' && url.pathname === '/api/tags/trending') {
    if (!db) { res.writeHead(503, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ tags: [] })); return; }
    try {
      const limit     = Math.min(parseInt(url.searchParams.get('limit') || '10') || 10, 50);
      const windowVal = url.searchParams.get('window') === '24h' ? 1 : 7;
      const rows = await queryMySQL(
        `SELECT tags FROM search_index
         WHERE tags IS NOT NULL AND tags != ''
           AND created_at > UNIX_TIMESTAMP(NOW() - INTERVAL ? DAY) * 1000
         LIMIT 2000`,
        [windowVal]
      );
      // Count tag frequency in JS — simple, no SQL version dependency
      const freq = new Map();
      for (const row of rows || []) {
        for (const raw of row.tags.split(',')) {
          const tag = raw.trim().toLowerCase();
          if (tag) freq.set(tag, (freq.get(tag) || 0) + 1);
        }
      }
      const tags = [...freq.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map(([tag, count]) => ({ tag, count }));
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300, stale-while-revalidate=600' });
      res.end(JSON.stringify({ tags, window: windowVal === 1 ? '24h' : '7d' }));
    } catch (err) { sendError(res, 500, 'Trending tags error', err, '/api/tags/trending'); }
    return;
  }

  // ── GET /api/trends/external ───────────────────────────────────────────────
  // Combines NewsData.io (article volume = what's being written about) with
  // SerpApi Google Trends (search interest = what people are looking for).
  // Topics appearing in BOTH sources get a score boost — that's the real signal.
  // Cached in-process for 1 hour so we burn minimal API credits.
  // Budget: NewsData 200/day, SerpApi 250/month — one fetch per hour is ~24/day
  // and ~720/month, so we stay well within both limits at 1-hour cache.
  //
  // Env vars required: NEWSDATA_API_KEY, SERPAPI_KEY (optional — skipped if absent)
  if (req.method === 'GET' && url.pathname === '/api/trends/external') {
    const NEWSDATA_KEY = process.env.NEWSDATA_API_KEY;
    const SERPAPI_KEY  = process.env.SERPAPI_KEY;

    if (!NEWSDATA_KEY && !SERPAPI_KEY) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'No external trend API keys configured' }));
      return;
    }

    // ── In-process cache — 1 hour ─────────────────────────────────────────
    if (!global._externalTrendsCache) global._externalTrendsCache = { ts: 0, data: null };
    const CACHE_TTL = 60 * 60 * 1000;
    if (Date.now() - global._externalTrendsCache.ts < CACHE_TTL && global._externalTrendsCache.data) {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' });
      res.end(JSON.stringify(global._externalTrendsCache.data));
      return;
    }

    // Category map — NewsData categories → your app categories
    const NEWSDATA_CAT_MAP = {
      politics: 'politics', technology: 'technology', science: 'science',
      health: 'health', sports: 'sports', entertainment: 'movies-tv',
      business: 'finance', environment: 'environment', education: 'education',
      food: 'other', tourism: 'other', world: 'news', top: 'news',
    };

    try {
      // ── Fetch NewsData.io top headlines ─────────────────────────────────
      // One credit per request. Returns up to 10 articles with keywords.
      const newsdataTopics = new Map(); // keyword → { newsScore, serpScore, category }

      if (NEWSDATA_KEY) {
        const ndRes = await fetch(
          `https://newsdata.io/api/1/news?apikey=${NEWSDATA_KEY}&language=en&size=10`,
          { signal: AbortSignal.timeout(8000) }
        ).catch(() => null);

        if (ndRes?.ok) {
          const ndData = await ndRes.json().catch(() => null);
          for (const article of (ndData?.results || [])) {
            // Use article keywords if available, fall back to title words
            const keywords = article.keywords?.length
              ? article.keywords.slice(0, 5)
              : (article.title || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').split(' ').filter(w => w.length > 3).slice(0, 4);

            const category = NEWSDATA_CAT_MAP[article.category?.[0]] || 'news';

            for (const kw of keywords) {
              const tag = kw.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
              if (!tag || tag.length < 3) continue;
              const existing = newsdataTopics.get(tag) || { newsScore: 0, serpScore: 0, category };
              existing.newsScore += 1;
              newsdataTopics.set(tag, existing);
            }
          }
        }
      }

      // ── Fetch SerpApi Google Trends — Trending Now ───────────────────────
      // One search credit per request. Returns current trending searches.
      if (SERPAPI_KEY) {
        const serpRes = await fetch(
          `https://serpapi.com/search.json?engine=google_trends_trending_now&geo=US&api_key=${SERPAPI_KEY}`,
          { signal: AbortSignal.timeout(8000) }
        ).catch(() => null);

        if (serpRes?.ok) {
          const serpData = await serpRes.json().catch(() => null);
          for (const trend of (serpData?.trending_searches || []).slice(0, 20)) {
            const query = trend.query || trend.title?.query || '';
            if (!query) continue;
            const tag = query.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
            if (!tag || tag.length < 3) continue;
            const existing = newsdataTopics.get(tag) || { newsScore: 0, serpScore: 0, category: 'news' };
            // Traffic value normalised to 0-3 range (serpApi returns "200,000+" style strings)
            const trafficRaw = parseInt((trend.formattedTraffic || trend.traffic || '').replace(/[^0-9]/g, '')) || 0;
            existing.serpScore += trafficRaw > 500000 ? 3 : trafficRaw > 100000 ? 2 : 1;
            newsdataTopics.set(tag, existing);
          }
        }
      }

      // ── Merge and score ──────────────────────────────────────────────────
      // Topics in both sources score highest. Pure news = moderate. Pure search = lower.
      // This means viral one-day news spikes without search interest get filtered.
      const merged = [...newsdataTopics.entries()].map(([tag, s]) => ({
        tag,
        category:  s.category,
        score:     (s.newsScore * 1.0) + (s.serpScore * 1.5) + (s.newsScore > 0 && s.serpScore > 0 ? 2.0 : 0),
        sources:   [s.newsScore > 0 ? 'news' : null, s.serpScore > 0 ? 'search' : null].filter(Boolean),
      }))
      .filter(t => t.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 15);

      const result = { trends: merged, cachedAt: Date.now(), sources: { newsdata: !!NEWSDATA_KEY, serpapi: !!SERPAPI_KEY } };
      global._externalTrendsCache = { ts: Date.now(), data: result };

      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' });
      res.end(JSON.stringify(result));
    } catch (err) { sendError(res, 500, 'External trends failed', err, '/api/trends/external'); }
    return;
  }


  // ── GET /api/feed/personalised ─────────────────────────────────────────────
  if (req.method === 'GET' && url.pathname === '/api/feed/personalised') {
    if (!db) { res.writeHead(503, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ posts: [] })); return; }
    try {
      const limit      = Math.min(parseInt(url.searchParams.get('limit') || '20') || 20, 50);
      const before     = parseInt(url.searchParams.get('before') || '0') || 0;
      const nsfwFilter = url.searchParams.get('nsfwFilter') || 'none';
      const locale     = url.searchParams.get('locale') || '';
      const viewerPub  = (req.headers.authorization || '').replace('Bearer ', '').trim() || '';

      // Explicit overrides from client (optional — client can still pass these)
      const rawCats = url.searchParams.get('categories') || '';
      const rawTags = url.searchParams.get('tags') || '';
      let categories = rawCats.split(',').map(s => s.trim()).filter(Boolean).slice(0, 10);
      let tags       = rawTags.split(',').map(s => s.trim().toLowerCase().replace(/[^a-z0-9-]/g, '')).filter(Boolean).slice(0, 20);

      // ── View-history affinity ──────────────────────────────────────────────
      // If we have the viewer's pub key and they haven't passed explicit prefs,
      // derive category + tag affinity from their last 50 viewed posts.
      // This is the YouTube-style signal: what they actually read drives the feed.
      if (viewerPub && viewerPub.length >= 20 && !categories.length && !tags.length) {
        const [viewedRows] = await db.execute(
          `SELECT si.category, si.tags
           FROM post_views pv
           JOIN search_index si ON si.id = pv.content_id
           WHERE pv.viewer_pub = ?
             AND si.category IS NOT NULL AND si.category != ''
           ORDER BY pv.viewed_at DESC
           LIMIT 50`,
          [viewerPub]
        ).catch(() => [[]]);

        if (viewedRows.length > 0) {
          // Count category frequency — top 3 drive the feed
          const catFreq = {};
          const tagFreq = {};
          for (const row of viewedRows) {
            if (row.category) catFreq[row.category] = (catFreq[row.category] || 0) + 1;
            if (row.tags) {
              for (const t of row.tags.split(',').map(t => t.trim()).filter(Boolean)) {
                tagFreq[t] = (tagFreq[t] || 0) + 1;
              }
            }
          }
          categories = Object.entries(catFreq).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c]) => c);
          tags       = Object.entries(tagFreq).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([t]) => t);
        }
      }

      // ── Exclude already-seen posts ─────────────────────────────────────────
      // Don't show posts the user already viewed — same as YouTube "not interested"
      let seenIds = [];
      if (viewerPub && viewerPub.length >= 20) {
        const [seenRows] = await db.execute(
          `SELECT content_id FROM post_views WHERE viewer_pub = ? ORDER BY viewed_at DESC LIMIT 200`,
          [viewerPub]
        ).catch(() => [[]]);
        seenIds = seenRows.map(r => r.content_id);
      }

      const conditions = [];
      const params     = [];

      if (before > 0) { conditions.push('created_at < ?'); params.push(before); }

      if (nsfwFilter === 'none') {
        conditions.push(`(nsfw = 'none' OR nsfw IS NULL)`);
      } else {
        conditions.push(`nsfw IN ('none', ?)`);
        params.push(nsfwFilter);
      }

      if (locale === 'regional') { conditions.push(`locale = 'regional'`); }
      else if (locale === 'global') { conditions.push(`locale = 'global'`); }

      // Exclude seen posts
      if (seenIds.length > 0) {
        conditions.push(`id NOT IN (${seenIds.map(() => '?').join(',')})`);
        params.push(...seenIds);
      }

      // Category + tag affinity
      const affinityConditions = [];
      if (categories.length) {
        affinityConditions.push(`category IN (${categories.map(() => '?').join(',')})`);
        params.push(...categories);
      }
      if (tags.length) {
        const tagConditions = tags.map(() => `FIND_IN_SET(?, REPLACE(tags, ' ', ''))`);
        affinityConditions.push(`(${tagConditions.join(' OR ')})`);
        params.push(...tags);
      }
      if (affinityConditions.length) conditions.push(`(${affinityConditions.join(' OR ')})`);

      const windowAll = url.searchParams.get('window') === 'all';
      if (!windowAll && !url.searchParams.get('before')) {
        const windowDays = parseInt(url.searchParams.get('window') || '30', 10);
        conditions.push('created_at > ?');
        params.push(Date.now() - windowDays * 24 * 60 * 60 * 1000);
      }

      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      params.push(limit);

      const [rows] = await db.execute(
        `SELECT id, type, title, content, author, community,
                category, tags, sentiment, nsfw,
                controversial, evergreen, locale, created_at,
                view_count, unique_viewers
         FROM search_index
         ${where}
         ORDER BY
           created_at DESC,
           controversial DESC,
           evergreen DESC
         LIMIT ?`,
        params
      );

      const posts = (rows || []).map(r => ({
        ...r,
        tags:          r.tags ? r.tags.split(',').map(t => t.trim()).filter(Boolean) : [],
        controversial: !!r.controversial,
        evergreen:     !!r.evergreen,
      }));

      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'private, max-age=30' });
      res.end(JSON.stringify({
        posts,
        hasMore:    posts.length === limit,
        derivedFrom: { categories, tags }, // debug: let client see what drove the feed
      }));
    } catch (err) { sendError(res, 500, 'Personalised feed error', err, '/api/feed/personalised'); }
    return;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ── ADMIN / MOD API ────────────────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════════
  if (url.pathname.startsWith('/admin/')) {
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    const validSecret = process.env.ADMIN_SECRET || process.env.API_INDEX_SECRET;
    if (!token || token !== validSecret) { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Unauthorized' })); return; }

    if (req.method === 'GET' && url.pathname === '/admin/mod/stats') {
      try {
        const [[queueRows], [blockRows]] = await Promise.all([db.execute(`SELECT status, COUNT(*) as c FROM mod_queue GROUP BY status`), db.execute(`SELECT COUNT(*) as total FROM blocklist`)]);
        const queue = { pending: 0, approved: 0, removed: 0 };
        for (const r of queueRows) queue[r.status] = r.c;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ queue, blocklist: { total: blockRows[0]?.total || 0 } }));
      } catch (err) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: err.message })); }
      return;
    }

    if (req.method === 'GET' && url.pathname === '/admin/mod/queue') {
      try {
        const status = url.searchParams.get('status') || 'pending';
        const type   = url.searchParams.get('type') || '';
        const limit  = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 200);
        const offset = parseInt(url.searchParams.get('offset') || '0', 10);
        const allowed = ['pending', 'approved', 'removed'];
        const safeStatus = allowed.includes(status) ? status : 'pending';
        let where = 'WHERE status = ?';
        const params = [safeStatus];
        if (type) { where += ' AND content_type = ?'; params.push(type); }
        const [[items], [[{ total }]]] = await Promise.all([
          db.execute(`SELECT * FROM mod_queue ${where} ORDER BY flagged_at DESC LIMIT ${limit} OFFSET ${offset}`, params),
          db.execute(`SELECT COUNT(*) as total FROM mod_queue ${where}`, params),
        ]);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ items, total }));
      } catch (err) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: err.message })); }
      return;
    }

    if (req.method === 'POST' && url.pathname === '/admin/mod/flag') {
      try {
        const body = await parseBodyWithLimit(req, 32768);
        const { itemId, soul, contentType, snippet, reason } = JSON.parse(body);
        if (!itemId || !soul) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'itemId and soul required' })); return; }
        await db.execute(`INSERT INTO mod_queue (id, soul, content_type, content_snippet, flagged_at, status, reason) VALUES (?, ?, ?, ?, ?, 'pending', ?) ON DUPLICATE KEY UPDATE flagged_at=VALUES(flagged_at), reason=VALUES(reason)`, [itemId, soul, contentType || 'post', (snippet || '').slice(0, 500), Date.now(), reason || null]);
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true }));
      } catch (err) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: err.message })); }
      return;
    }

    if (req.method === 'POST' && url.pathname === '/admin/mod/approve') {
      try {
        const body = await parseBodyWithLimit(req, 8192);
        const { itemId, reviewedBy } = JSON.parse(body);
        if (!itemId) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'itemId required' })); return; }
        await Promise.all([db.execute(`UPDATE mod_queue SET status='approved', reviewed_by=?, reviewed_at=? WHERE id=?`, [reviewedBy || 'admin', Date.now(), itemId]), db.execute(`UPDATE search_index SET mod_status='approved' WHERE id=?`, [itemId])]);
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true }));
      } catch (err) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: err.message })); }
      return;
    }

    if (req.method === 'POST' && url.pathname === '/admin/mod/remove') {
      try {
        const body = await parseBodyWithLimit(req, 8192);
        const { itemId, reason, reviewedBy } = JSON.parse(body);
        if (!itemId) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'itemId required' })); return; }
        await Promise.all([db.execute(`UPDATE mod_queue SET status='removed', reason=?, reviewed_by=?, reviewed_at=? WHERE id=?`, [reason || null, reviewedBy || 'admin', Date.now(), itemId]), db.execute(`UPDATE search_index SET mod_status='removed' WHERE id=?`, [itemId])]);
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true }));
      } catch (err) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: err.message })); }
      return;
    }

    if (req.method === 'POST' && url.pathname === '/admin/mod/edit-post') {
      try {
        const body = await parseBodyWithLimit(req, 32768);
        const { itemId, title, content, category, tags, nsfw } = JSON.parse(body);
        if (!itemId) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'itemId required' })); return; }
        const tagsStr = Array.isArray(tags) ? tags.join(',') : (tags || null);
        await db.execute(`UPDATE search_index SET title=?, content=?, category=?, tags=?, nsfw=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`, [title || null, content || null, category || null, tagsStr, nsfw ? 1 : 0, itemId]);
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true }));
      } catch (err) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: err.message })); }
      return;
    }

    if (req.method === 'GET' && url.pathname === '/admin/mod/categorise-list') {
      try {
        const tab      = url.searchParams.get('tab') || 'uncategorised';
        const category = url.searchParams.get('category') || '';
        const type     = url.searchParams.get('type') || '';
        const limit    = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 200);
        const offset   = parseInt(url.searchParams.get('offset') || '0', 10);
        const conditions = [], params = [];
        if (tab === 'uncategorised') conditions.push('category IS NULL');
        else if (tab === 'nsfw')     conditions.push('nsfw = 1');
        if (category) { conditions.push('category = ?'); params.push(category); }
        if (type)     { conditions.push('type = ?'); params.push(type); }
        const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
        const [[items], [[{ total }]]] = await Promise.all([
          db.execute(`SELECT id, type, title, content, author, community, category, tags, sentiment, nsfw, mod_status, created_at FROM search_index ${where} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`, params),
          db.execute(`SELECT COUNT(*) as total FROM search_index ${where}`, params),
        ]);
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ items, total }));
      } catch (err) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: err.message })); }
      return;
    }

    if (req.method === 'POST' && url.pathname === '/admin/mod/categorise') {
      try {
        const body = await parseBodyWithLimit(req, 16384);
        const { itemId, category, tags, nsfw } = JSON.parse(body);
        if (!itemId) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'itemId required' })); return; }
        const tagsStr = Array.isArray(tags) ? tags.join(',') : (tags || null);
        await db.execute(`UPDATE search_index SET category=?, tags=?, nsfw=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`, [category || null, tagsStr, nsfw ? 1 : 0, itemId]);
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true }));
      } catch (err) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: err.message })); }
      return;
    }

    if (req.method === 'GET' && url.pathname === '/admin/categorisation-stats') {
      try {
        const [[cats], [counts]] = await Promise.all([
          db.execute(`SELECT category, COUNT(*) as count FROM search_index WHERE category IS NOT NULL GROUP BY category ORDER BY count DESC`),
          db.execute(`SELECT SUM(category IS NULL) as uncategorised, SUM(nsfw=1) as nsfw FROM search_index`),
        ]);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ categories: cats, counts: { uncategorised: counts[0]?.uncategorised || 0, nsfw: counts[0]?.nsfw || 0 }, queue: { queued: 0 } }));
      } catch (err) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: err.message })); }
      return;
    }

    if (req.method === 'POST' && url.pathname === '/admin/mod/requeue-uncategorised') {
      try {
        const [[rows]] = await db.execute(`SELECT id FROM search_index WHERE category IS NULL LIMIT 500`);
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ queued: rows.length }));
      } catch (err) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: err.message })); }
      return;
    }

    if (req.method === 'GET' && url.pathname === '/admin/mod/videos') {
      try {
        const status = url.searchParams.get('status') || 'pending';
        const limit  = Math.min(parseInt(url.searchParams.get('limit') || '12', 10), 50);
        const offset = parseInt(url.searchParams.get('offset') || '0', 10);
        const allowed = ['pending', 'approved', 'removed', ''];
        const safeStatus = allowed.includes(status) ? status : 'pending';
        let where = 'WHERE video_cid IS NOT NULL';
        const params = [];
        if (safeStatus) { where += ' AND mod_status = ?'; params.push(safeStatus); }
        const [[items], [[{ total }]]] = await Promise.all([
          db.execute(`SELECT id, type, title, content, author, community, category, tags, nsfw, mod_status, video_cid, thumb_cid, mime_type, created_at FROM search_index ${where} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`, params),
          db.execute(`SELECT COUNT(*) as total FROM search_index ${where}`, params),
        ]);
        const [statusCounts] = await db.execute(`SELECT mod_status, COUNT(*) as c FROM search_index WHERE video_cid IS NOT NULL GROUP BY mod_status`);
        const counts = { pending: 0, approved: 0, removed: 0 };
        for (const r of statusCounts) counts[r.mod_status] = r.c;
        const mapped = items.map(r => ({ ...r, videoCid: r.video_cid, thumbnailCid: r.thumb_cid, mimeType: r.mime_type, modStatus: r.mod_status, creatorId: r.author }));
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ items: mapped, total, counts }));
      } catch (err) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: err.message })); }
      return;
    }

    if (req.method === 'GET' && url.pathname === '/admin/blocklist') {
      try {
        const limit  = Math.min(parseInt(url.searchParams.get('limit') || '100', 10), 500);
        const offset = parseInt(url.searchParams.get('offset') || '0', 10);
        const [[rows], [[{ total }]]] = await Promise.all([db.execute(`SELECT * FROM blocklist ORDER BY added_at DESC LIMIT ${limit} OFFSET ${offset}`, []), db.execute(`SELECT COUNT(*) as total FROM blocklist`)]);
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ items: rows, total }));
      } catch (err) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: err.message })); }
      return;
    }

    if (req.method === 'POST' && url.pathname === '/admin/blocklist') {
      try {
        const body = await parseBodyWithLimit(req, 8192);
        const { type, value, reason } = JSON.parse(body);
        if (!type || !value) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'type and value required' })); return; }
        await db.execute(`INSERT IGNORE INTO blocklist (type, value, reason, added_at) VALUES (?, ?, ?, ?)`, [type, value, reason || null, Date.now()]);
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true }));
      } catch (err) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: err.message })); }
      return;
    }

    if (req.method === 'DELETE' && url.pathname.startsWith('/admin/blocklist/')) {
      try {
        const id = parseInt(url.pathname.split('/')[3], 10);
        await db.execute(`DELETE FROM blocklist WHERE id = ?`, [id]);
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true }));
      } catch (err) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: err.message })); }
      return;
    }

    if (req.method === 'POST' && url.pathname === '/admin/ban') {
      try {
        const body = await parseBodyWithLimit(req, 8192);
        const { pubkey, reason } = JSON.parse(body);
        if (!pubkey) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'pubkey required' })); return; }
        await db.execute(`INSERT IGNORE INTO blocklist (type, value, reason, added_at) VALUES ('pubkey', ?, ?, ?)`, [pubkey, reason || null, Date.now()]);
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true }));
      } catch (err) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: err.message })); }
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Admin route not found' }));
    return;
  }

  // ── POST /api/chat-media — upload encrypted blob ───────────────────────────
  if (req.method === 'POST' && url.pathname === '/api/chat-media') {
    if (!db) { res.writeHead(503, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'DB unavailable' })); return; }
    const senderPub = (req.headers.authorization || '').replace('Bearer ', '').trim();
    if (!senderPub || senderPub.length < 20) { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Unauthorized' })); return; }

    const MAX_BYTES   = 100 * 1024 * 1024; // 100 MB — matches client cap
    const MEDIA_DIR   = process.env.CHAT_MEDIA_DIR || '/var/www/interpoll/chat-media-blobs';
    const TTL_MS      = 7 * 24 * 60 * 60 * 1000;
    const contentType = req.headers['content-type'] || '';
    const boundaryMatch = contentType.match(/boundary=("?)([^";\s]+)\1/);
    if (!boundaryMatch) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Missing multipart boundary' })); return; }

    const boundary = boundaryMatch[2];
    let totalBytes = 0; const chunks = []; let tooBig = false;
    await new Promise(resolve => {
      req.on('data', chunk => {
        totalBytes += chunk.length;
        if (totalBytes > MAX_BYTES) {
          tooBig = true;
          // Send 413 BEFORE destroying so client gets the response, not a hang
          if (!res.headersSent) { res.writeHead(413, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Exceeds 100 MB limit' })); }
          req.destroy(); resolve(null); return;
        }
        chunks.push(chunk);
      });
      req.on('end', resolve); req.on('error', resolve);
    });
    if (tooBig) return; // response already sent above

    const body = Buffer.concat(chunks);
    const delimBuf = Buffer.concat([Buffer.from('--'), Buffer.from(boundary)]);
    let fileBuffer = null, mimeType = 'application/octet-stream';
    let pos = 0;
    while (pos < body.length) {
      const delimIdx = body.indexOf(delimBuf, pos);
      if (delimIdx === -1) break;
      pos = delimIdx + delimBuf.length;
      if (body[pos] === 0x2D && body[pos + 1] === 0x2D) break;
      if (body[pos] === 0x0D) pos += 2;
      const headerEnd = body.indexOf(Buffer.from('\r\n\r\n'), pos);
      if (headerEnd === -1) break;
      const headerStr = body.slice(pos, headerEnd).toString('utf8');
      pos = headerEnd + 4;
      const nextDelim = body.indexOf(delimBuf, pos);
      const partEnd   = nextDelim === -1 ? body.length : nextDelim - 2;
      const partBody  = body.slice(pos, partEnd);
      pos = nextDelim === -1 ? body.length : nextDelim;
      const ctMatch = headerStr.match(/Content-Type:\s*([^\r\n]+)/i);
      if (ctMatch) { mimeType = ctMatch[1].trim(); fileBuffer = partBody; }
      else if (headerStr.includes('name="mimeType"')) { mimeType = partBody.toString('utf8').trim(); }
    }
    if (!fileBuffer || fileBuffer.length === 0) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'No blob found' })); return; }

    try {
      const { randomUUID } = await import('crypto');
      const { writeFile, mkdir } = await import('fs/promises');
      const { join } = await import('path');
      await mkdir(MEDIA_DIR, { recursive: true });
      const mediaId  = randomUUID();
      const blobPath = join(MEDIA_DIR, mediaId + '.bin');
      await writeFile(blobPath, fileBuffer); // async — don't block event loop
      const now       = Date.now();
      const expiresAt = now + TTL_MS;
      await db.execute(
        `INSERT INTO chat_media (id, sender_id, blob_path, mime_type, byte_size, uploaded_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [mediaId, senderPub, blobPath, mimeType, fileBuffer.length, now, expiresAt]
      );
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ mediaId, expiresAt }));
    } catch (err) { sendError(res, 500, 'Upload failed', err, '/api/chat-media POST'); }
    return;
  }

  // ── GET /api/chat-media/:id — stream media blob ──────────────────────────
  // No Authorization required on GET — the mediaId is the capability token.
  // Videos need no-auth GET so <video src> and <img src> work natively.
  if (req.method === 'GET' && url.pathname.startsWith('/api/chat-media/')) {
    if (!db) { res.writeHead(503, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'DB unavailable' })); return; }
    const mediaId = url.pathname.split('/').pop().replace(/[^a-zA-Z0-9-]/g, '');
    if (!mediaId) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Invalid media ID' })); return; }
    try {
      const [rows] = await db.execute(
        `SELECT blob_path, mime_type, byte_size, deleted, expires_at, sender_id FROM chat_media WHERE id = ?`, [mediaId]
      );
      const row = rows[0];
      if (!row || row.deleted || row.expires_at < Date.now()) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found or expired' }));
        return;
      }
      const { createReadStream, statSync } = await import('fs');
      const { stat } = await import('fs/promises');
      const fileSize = row.byte_size || (await stat(row.blob_path).then(s => s.size).catch(() => 0));
      const mimeType = row.mime_type || 'application/octet-stream';
      const isVideo  = mimeType.startsWith('video/');
      const isImage  = mimeType.startsWith('image/');

      // Range request support — required for video seeking and iOS playback
      const rangeHeader = req.headers['range'];
      if (rangeHeader && fileSize) {
        const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
        if (match) {
          const start = parseInt(match[1], 10);
          const end   = match[2] ? parseInt(match[2], 10) : Math.min(start + 1024 * 1024 - 1, fileSize - 1);
          const chunkSize = end - start + 1;
          res.writeHead(206, {
            'Content-Type':   mimeType,
            'Content-Range':  `bytes ${start}-${end}/${fileSize}`,
            'Content-Length': String(chunkSize),
            'Accept-Ranges':  'bytes',
            'Cache-Control':  'private, max-age=3600',
          });
          createReadStream(row.blob_path, { start, end }).pipe(res);
          return;
        }
      }

      // Full file response
      const headers = {
        'Content-Type':   mimeType,
        'Content-Length': String(fileSize),
        'Accept-Ranges':  'bytes',
        'Cache-Control':  'private, max-age=3600',
      };
      // For non-media files, add download disposition
      if (!isVideo && !isImage) {
        headers['Content-Disposition'] = `attachment; filename="${mediaId}"`;
      }
      res.writeHead(200, headers);
      createReadStream(row.blob_path).pipe(res);

      // Mark downloaded only for non-sender fetches (sender previews shouldn't delete the blob)
      const senderPub = (req.headers.authorization || '').replace('Bearer ', '').trim();
      if (senderPub && senderPub !== row.sender_id) {
        await db.execute(`UPDATE chat_media SET downloaded = 1 WHERE id = ?`, [mediaId]).catch(() => {});
      }
    } catch (err) { sendError(res, 500, 'Fetch failed', err, '/api/chat-media GET'); }
    return;
  }

  // ── DELETE /api/chat-media/:id — early deletion by recipient ──────────────
  if (req.method === 'DELETE' && url.pathname.startsWith('/api/chat-media/')) {
    if (!db) { res.writeHead(503, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'DB unavailable' })); return; }
    const senderPub = (req.headers.authorization || '').replace('Bearer ', '').trim();
    if (!senderPub || senderPub.length < 20) { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Unauthorized' })); return; }
    const mediaId = url.pathname.split('/').pop().replace(/[^a-zA-Z0-9\-]/g, '');
    try {
      // Only the recipient (not the original sender) can trigger early delete
      const [rows] = await db.execute(
        `SELECT blob_path FROM chat_media WHERE id = ? AND sender_id != ? AND deleted = 0`, [mediaId, senderPub]
      );
      if (rows[0]) {
        await db.execute(`UPDATE chat_media SET deleted = 1 WHERE id = ?`, [mediaId]);
        const { unlink } = await import('fs');
        unlink(rows[0].blob_path, () => {});
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) { sendError(res, 500, 'Delete failed', err, '/api/chat-media DELETE'); }
    return;
  }

  // ── GET /api/view-counts — batch view count lookup ────────────────────────
  if (req.method === 'GET' && url.pathname === '/api/view-counts') {
    if (!db) { res.writeHead(503, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'DB unavailable' })); return; }
    const idsParam = url.searchParams.get('ids') || '';
    const ids = idsParam.split(',').map(s => s.trim()).filter(Boolean).slice(0, 100);
    if (ids.length === 0) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'ids required' })); return; }
    try {
      const placeholders = ids.map(() => '?').join(',');
      const [rows] = await db.execute(
        `SELECT id, view_count, unique_viewers FROM search_index WHERE id IN (${placeholders})`,
        ids
      );
      const counts = {};
      for (const id of ids) counts[id] = { viewCount: 0, uniqueViewers: 0 };
      for (const r of rows || []) {
        counts[r.id] = { viewCount: r.view_count ?? 0, uniqueViewers: r.unique_viewers ?? 0 };
      }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=30, stale-while-revalidate=60' });
      res.end(JSON.stringify({ counts }));
    } catch (err) { sendError(res, 500, 'View counts failed', err, '/api/view-counts'); }
    return;
  }

  // ── POST /api/views — batch view ingestion ─────────────────────────────────
  if (req.method === 'POST' && url.pathname === '/api/views') {
    await handleEngagement(req, res, { db, namespace: NAMESPACE, views: true }); return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
});