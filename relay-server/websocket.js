// websocket.js — WebSocket connection, message handling, and ping loop
import crypto from 'crypto';
import {
  wss, clients, rooms, activeChatSessions,
  rateLimiter, botDetector, spamScorer, powChallenge, replayProtector,
  ALLOWED_BROADCAST_TYPES,
  sanitizeId, sanitizeLogString,
  validateWsMessage, verifyContentHash, verifySignature, verifyHashcashPoW, POW_EXEMPT,
  ErrorCodes, makeError,
} from './config.js';
import { db } from './db.js';
import { getSecureSession, resolveWsIdentityTier } from './auth.js';
import { messageCache, cacheMessage } from './persistence.js';
import { indexContent, writeCategrisationResult } from './search.js';
import { getChatRoomId, storeChatMessage, markMessagesAsRead, markMessagesDelivered, getPendingMessagesForUser } from './chat.js';
import { queueForCategorisation, markAlreadyCategorised } from './auto-categorise.js';
import { NAMESPACE } from '../shared-validation/namespace.js';

// ─── Ping / keepalive ─────────────────────────────────────────────────────────
const PING_INTERVAL = 20_000;
const pingTimer = setInterval(() => {
  wss.clients.forEach(ws => {
    if (ws.isAlive === false) { ws.terminate(); return; }
    ws.isAlive = false;
    ws.ping();
  });
}, PING_INTERVAL);

wss.on('close', () => clearInterval(pingTimer));

// ─── Broadcast helpers ────────────────────────────────────────────────────────
export function broadcast(msg) {
  clients.forEach(({ ws }) => { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); });
}

export function broadcastToOthers(excludeId, msg) {
  clients.forEach(({ ws, peerId }) => { if (peerId !== excludeId && ws.readyState === 1) ws.send(JSON.stringify(msg)); });
}

export function broadcastToRoom(roomId, excludeId, msg) {
  const peers = rooms.get(roomId);
  if (!peers) return;
  peers.forEach(id => {
    if (id === excludeId) return;
    const client = clients.get(id);
    if (client?.ws.readyState === 1) client.ws.send(JSON.stringify(msg));
  });
}

// ─── Connection handler ───────────────────────────────────────────────────────
import { ALLOWED_ORIGINS } from './config.js';

wss.on('connection', (ws, req) => {
  const wsOrigin = String(req.headers.origin || '');
  if (!wsOrigin || !ALLOWED_ORIGINS.includes(wsOrigin)) {
    ws.close(1008, 'origin not allowed');
    return;
  }

  let peerId = null;
  let userId = null;
  let sessionUserCache = null;
  let identityTier = 'unverified';
  const peerIp = req.headers['x-real-ip'] || req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || 'unknown';

  // Wire filter mode negotiated via upgrade header (off | log | enforce)
  const rawWireMode = req.headers['x-wire-filter-mode'] || 'log';
  ws._wireFilterMode = ['off', 'log', 'enforce'].includes(rawWireMode) ? rawWireMode : 'log';

  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', async (message) => {
    try {
      const validation = validateWsMessage(message);
      if (!validation.valid) {
        // Log validation failures so we can diagnose chat-read rejections
if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'error', code: 'INVALID_MESSAGE', reason: validation.reason }));
        return;
      }
      const data = validation.data;

      // Skip rate limiting for heartbeats
      if (data.type !== 'ping' && data.type !== 'pong') {
        if (data.type === 'request-pow') {
          const sessionUser = sessionUserCache || await getSecureSession(req);
          if (sessionUser) sessionUserCache = sessionUser;
          identityTier = resolveWsIdentityTier(sessionUser, data.identityUsername);
        }

        const wsLimitOverride = identityTier === 'trusted-issuer'
          ? undefined
          : Math.max(10, Math.floor(rateLimiter.wsLimit / 2));

        const wsCheck = rateLimiter.checkWs(peerId || peerIp, wsLimitOverride);
        if (!wsCheck.allowed) {
          if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'error', code: 'RATE_LIMITED', retryAfter: wsCheck.retryAfter }));
          return;
        }

        const msgHash = crypto.createHash('sha256').update(message.toString().slice(0, 1000)).digest('hex');
        botDetector.recordMessage(peerId || peerIp, msgHash);
        const botAction = botDetector.getAction(peerId || peerIp);
        if (botAction.action === 'ban') {
          console.log(`🤖 Banning peer ${sanitizeLogString(peerId || peerIp)} (bot score: ${botAction.score})`);
          if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'error', code: 'BANNED', reason: 'Automated behavior detected' }));
          ws.close();
          return;
        }
      }

      const effectivePayload = data.type === 'broadcast' && data.data && typeof data.data === 'object' ? data.data : data;
      const effectiveType    = typeof effectivePayload.type === 'string' ? effectivePayload.type : data.type;
      const actionType       = effectivePayload.actionType || data.actionType || data.data?.actionType;

      if (data.type === 'broadcast' && !ALLOWED_BROADCAST_TYPES.has(effectiveType)) {
        if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'error', code: 'INVALID_BROADCAST_TYPE', reason: `Unsupported broadcast type: ${String(effectiveType || 'unknown')}` }));
        return;
      }

      // PoW verification
      const powPayload = (effectivePayload && typeof effectivePayload.pow === 'object') ? effectivePayload : data;
      if (powChallenge.requiresPow(effectiveType, actionType)) {
        if (!powPayload.pow || !powPayload.pow.challengeId || powPayload.pow.nonce == null) {
          if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'pow-required', reason: 'Proof-of-work required for this action' }));
          return;
        }
        const powResult = powChallenge.verify(powPayload.pow.challengeId, powPayload.pow.nonce);
        if (!powResult.valid) {
          if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'pow-required', reason: powResult.reason }));
          return;
        }
      }

      // Spam scoring
      if (data.type === 'broadcast' || data.type === 'new-poll' || data.type === 'new-block' || data.type === 'new-post') {
        const payload = data.data || data.post || data;
        const textContent = [payload.title, payload.content, payload.description, payload.question].filter(Boolean).join(' ');
        if (textContent) {
          const scoreResult = spamScorer.score(textContent);
          if (spamScorer.shouldFlag(scoreResult)) {
            console.log(`🚩 Flagged content from ${sanitizeLogString(peerId || peerIp)}: ${scoreResult.matchCount} matches [wire:${ws._wireFilterMode}]`);
            if (ws._wireFilterMode === 'enforce') {
              if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'error', code: 'CONTENT_REJECTED', reason: 'Content flagged by wire filter' }));
              return;
            }
            // log or off — mark as flagged but allow through
            if (data.data) data.data._flagged = true;
            else data._flagged = true;
          }
        }
      }

      // Mandatory integrity pipeline
      const integrityPayload = data.type === 'broadcast' ? effectivePayload : data;
      // Chat control messages never carry integrity fields — exempt them explicitly
      // regardless of POW_EXEMPT config so they aren't rejected at the hash check.
      const CHAT_EXEMPT = new Set(['chat-read', 'chat-typing', 'chat-start', 'register-presence', 'ping', 'rtc-signal']);
      const needsIntegrity   = data.type === 'broadcast' ? true : (!POW_EXEMPT.has(effectiveType) && !CHAT_EXEMPT.has(effectiveType));

      if (needsIntegrity) {
        if (!integrityPayload._hash || typeof integrityPayload._hash !== 'string') {
          if (ws.readyState === 1) ws.send(JSON.stringify(makeError(ErrorCodes.HASH_MISMATCH, 'missing required _hash field')));
          return;
        }
        if (!verifyContentHash(integrityPayload)) {
          if (ws.readyState === 1) ws.send(JSON.stringify(makeError(ErrorCodes.HASH_MISMATCH, 'content hash does not match payload')));
          return;
        }
        if (!integrityPayload._sig || typeof integrityPayload._sig !== 'string' || !integrityPayload._pub || typeof integrityPayload._pub !== 'string') {
          if (ws.readyState === 1) ws.send(JSON.stringify(makeError(ErrorCodes.SIGNATURE_INVALID, 'missing required _sig and _pub fields')));
          return;
        }
        if (!verifySignature(integrityPayload)) {
          if (ws.readyState === 1) ws.send(JSON.stringify(makeError(ErrorCodes.SIGNATURE_INVALID, 'Schnorr signature verification failed')));
          return;
        }
        if (!integrityPayload._pow || typeof integrityPayload._pow !== 'string') {
          if (ws.readyState === 1) ws.send(JSON.stringify(makeError(ErrorCodes.POW_INSUFFICIENT, 'missing required _pow field')));
          return;
        }
        const integrityType = data.type === 'broadcast' ? 'broadcast' : effectiveType;
        if (!verifyHashcashPoW({ ...integrityPayload, type: integrityType })) {
          if (ws.readyState === 1) ws.send(JSON.stringify(makeError(ErrorCodes.POW_INSUFFICIENT, 'proof-of-work does not meet difficulty requirement')));
          return;
        }
        if (!integrityPayload._ts || typeof integrityPayload._ts !== 'number' || !integrityPayload._nonce || typeof integrityPayload._nonce !== 'string') {
          if (ws.readyState === 1) ws.send(JSON.stringify(makeError(ErrorCodes.REPLAY_DETECTED, 'missing required _ts and _nonce fields')));
          return;
        }
        const replayResult = replayProtector.check({ ...integrityPayload, type: integrityType });
        if (!replayResult.fresh) {
          if (ws.readyState === 1) ws.send(JSON.stringify(makeError(ErrorCodes.REPLAY_DETECTED, replayResult.reason)));
          return;
        }
      }

      switch (data.type) {
        case 'register': {
          const sessionUser = await getSecureSession(req);
          const sessionSub  = sanitizeId(String(sessionUser?.sub || ''), 128);
          const rawPeerId   = sanitizeId(String(data.peerId  || ''), 128);
          const rawUserId   = sanitizeId(String(data.userId  || ''), 200);
          if (!rawPeerId) {
            if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'error', code: 'BAD_REQUEST', reason: 'peerId required for anonymous registration' }));
            break;
          }
          if (sessionSub) {
            sessionUserCache = sessionUser;
            // Use the client-supplied userId for chat routing (Schnorr publicKey / anon id)
            // so peer lookups in chat-message, chat-read, etc. match what chatService uses.
            // Fall back to sessionSub only if the client didn't send a userId.
            userId = rawUserId || sessionSub;
          } else {
            userId = rawUserId || ('anon:' + rawPeerId);
          }
          peerId = data.peerId;
          if (clients.has(peerId)) {
            // A stale entry exists — the client reconnected before the server's close
            // event fired (or network split). Update it to the new socket rather than
            // rejecting with PEER_ID_TAKEN, which would block the pending-message flush.
            const stale = clients.get(peerId);
            try { if (stale.ws.readyState === 1) stale.ws.close(); } catch {}
            clients.delete(peerId);
          }
          clients.set(peerId, { ws, userId, peerId });
          botDetector.onRegister(peerId);
          // Send registered ack so client knows it's safe to send chat-read frames
          if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'registered', peerId, userId }));
          broadcast({ type: 'peer-list', peers: Array.from(clients.keys()) });
          for (const msg of messageCache) { try { ws.send(JSON.stringify(msg)); } catch {} }
          // Flush any messages stored while this user was offline.
          // Each row's encrypted_content is the full Signal wire envelope JSON
          // (v, eph, dh, n, pn, ct, timestamp) stored at send time so we can
          // replay the complete frame without any missing Signal fields.
          if (userId) {
            const pending = await getPendingMessagesForUser(userId);
            const deliveredIds = [];
            for (const row of pending) {
              if (ws.readyState !== 1) break;
              try {
                // encrypted_content is either:
                // - NEW format: JSON string  {v, eph, dh, n, pn, ct, timestamp}  (stored after offline-delivery fix)
                // - OLD format: raw base64 ct string (before the fix — only ct, no Signal header fields)
                // Old-format rows can't be decrypted without eph/dh/n/pn; skip gracefully.
                const raw = row.encrypted_content;
                if (!raw || !raw.trimStart().startsWith('{')) {
                  // Old row — Signal fields missing, cannot replay. TTL job cleans it up.
                  continue;
                }
                const envelope = JSON.parse(raw);
                ws.send(JSON.stringify({
                  type:      'chat-message',
                  from:      row.sender_id,
                  messageId: row.id,
                  v:         envelope.v,
                  auth:      envelope.auth,
                  epoch:     envelope.epoch,
                  eph:       envelope.eph,
                  opkId:     envelope.opkId,   // required for OPK consumption on replay
                  dh:        envelope.dh,
                  n:         envelope.n,
                  pn:        envelope.pn,
                  ct:        envelope.ct,
                  timestamp: envelope.timestamp || row.timestamp,
                }));
                // Track which rows we sent. Mark delivered below so reconnects
                // before chat-read arrives don't replay them again.
                deliveredIds.push(row.id);
              } catch (e) {
                console.warn('[ws] Failed to replay pending message', row.id, e.message);
              }
            }
            // Mark as delivered immediately — before client acks with chat-read.
            // chat-read still DELETEs the rows; delivered_at just guards re-replay.
            if (deliveredIds.length) void markMessagesDelivered(deliveredIds);
          }
          break;
        }

        case 'join-room': {
          if (!peerId || !userId) {
            if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'error', code: 'AUTH_REQUIRED', reason: 'register required before joining rooms' }));
            break;
          }
          const roomId = data.roomId || 'default';
          if (!rooms.has(roomId)) rooms.set(roomId, new Set());
          rooms.get(roomId).add(peerId);
          break;
        }

        case 'chat-start': {
          if (!peerId || !userId) {
            if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'error', code: 'AUTH_REQUIRED', reason: 'register required before chat actions' }));
            break;
          }
          const recipientId = data.recipientId;
          const roomId = getChatRoomId(userId, recipientId);
          activeChatSessions.set(roomId, { users: [userId, recipientId], createdAt: Date.now() });
          const recipientClient = Array.from(clients.values()).find(c => c.userId === recipientId);
          if (recipientClient?.ws.readyState === 1) recipientClient.ws.send(JSON.stringify({ type: 'chat-invite', from: userId, roomId }));
          break;
        }

        case 'chat-message': {
          if (!peerId || !userId) {
            if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'error', code: 'AUTH_REQUIRED', reason: 'register required before chat actions' }));
            break;
          }
          const { recipientId, messageId, timestamp } = data;
          const roomId = getChatRoomId(userId, recipientId);
          // Store the complete Signal wire envelope as JSON so we can replay it
          // verbatim when the recipient reconnects. Storing only ct (as before)
          // loses eph/dh/n/pn which are required for Signal decryption — making
          // offline delivery impossible. The full envelope is well within the 128KB limit.
          const wireEnvelope = JSON.stringify({
            v: data.v, auth: data.auth, epoch: data.epoch, eph: data.eph,
            opkId: data.opkId,   // OPK pool id — must survive offline storage for replay
            dh: data.dh, n: data.n, pn: data.pn, ct: data.ct,
            timestamp: timestamp || Date.now(),
          });
          await storeChatMessage(roomId, userId, recipientId, wireEnvelope, messageId);

          // Attempt live delivery to recipient if their WS is open.
          // We do NOT set delivered_at here — only the offline replay path sets it.
          // Reason: if the recipient's decrypt fails (stale session, OPK mismatch, etc.)
          // the message must remain replayable on their next reconnect.
          // With delivered_at set, getPendingMessagesForUser skips it and it's permanently lost.
          const recipientClient = Array.from(clients.values()).find(c => c.userId === recipientId);
          const liveDelivered = recipientClient?.ws.readyState === 1;
          if (liveDelivered) {
            recipientClient.ws.send(JSON.stringify({
              type: 'chat-message', from: userId,
              messageId,
              v: data.v, auth: data.auth, epoch: data.epoch, eph: data.eph,
              opkId: data.opkId,
              dh: data.dh, n: data.n, pn: data.pn, ct: data.ct,
              timestamp: timestamp || Date.now(),
            }));
          }

          // Always ack the sender — the message is persisted and will be delivered
          // (live now, or via offline replay when recipient reconnects).
          ws.send(JSON.stringify({ type: 'chat-delivered', messageId, recipientId }));
          break;
        }

        case 'chat-resend-request': {
          // Client decrypt failed; session was cleared. Re-deliver so fresh X3DH can run.
          // Only re-deliver to the original recipient (the requestor) from the original sender.
          if (!userId) break;
          const resendId   = typeof data.messageId === 'string' ? data.messageId.slice(0, 128) : null;
          const resendFrom = typeof data.from      === 'string' ? data.from.slice(0, 200)      : null;
          if (!resendId || !resendFrom) break;
          try {
            const { queryMySQL: qSQL } = await import('./db.js');
            const rows = await qSQL(
              `SELECT encrypted_content, sender_id, recipient_id, timestamp
               FROM chat_messages
               WHERE id = ? AND recipient_id = ? AND sender_id = ?
               LIMIT 1`,
              [resendId, userId, resendFrom]
            );
            if (rows && rows.length > 0) {
              const row = rows[0];
              const raw = row.encrypted_content;
              if (raw && raw.trimStart().startsWith('{')) {
                const env = JSON.parse(raw);
                ws.send(JSON.stringify({
                  type:      'chat-message',
                  from:      row.sender_id,
                  messageId: resendId,
                  v:         env.v,
                  auth:      env.auth,
                  epoch:     env.epoch,
                  eph:       env.eph,
                  opkId:     env.opkId,
                  dh:        env.dh,
                  n:         env.n,
                  pn:        env.pn,
                  ct:        env.ct,
                  timestamp: env.timestamp || row.timestamp,
                }));
              }
            }
          } catch (e) {
            console.warn('[ws] chat-resend-request error:', e.message);
          }
          break;
        }

        case 'chat-typing': {
          if (!peerId || !userId) {
            if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'error', code: 'AUTH_REQUIRED', reason: 'register required before chat actions' }));
            break;
          }
          const { recipientId, isTyping } = data;
          const recipientClient = Array.from(clients.values()).find(c => c.userId === recipientId);
          if (recipientClient?.ws.readyState === 1) recipientClient.ws.send(JSON.stringify({ type: 'chat-typing', from: userId, isTyping }));
          break;
        }

        case 'chat-read': {
if (!peerId || !userId) {
if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'error', code: 'AUTH_REQUIRED', reason: 'register required before chat actions' }));
            break;
          }
          const { recipientId } = data;
          // Forward `at` so sender can mark exact messages as read, not just "now"
          // Prefer the client's timestamp; fall back to Number.MAX_SAFE_INTEGER (not
          // Date.now()) so all the sender's messages are marked read if the client
          // omits `at`, rather than only those with timestamp ≤ server-time.
          const readAt = (Number(data.at) > 0) ? Number(data.at) : Number.MAX_SAFE_INTEGER;
          const roomId = getChatRoomId(userId, recipientId);
          await markMessagesAsRead(roomId, userId);
          // Find sender's live WS and push receipt immediately
          const senderClient = Array.from(clients.values()).find(c => c.userId === recipientId);
          if (senderClient?.ws.readyState === 1) {
            senderClient.ws.send(JSON.stringify({ type: 'chat-read-receipt', from: userId, at: readAt }));
          }
          // Also push back to receiver confirming the read (so their IDB gets updated)
          if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'chat-read-ack', ok: true }));
          break;
        }

        case 'rtc-signal': {
          if (!userId) { if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'error', code: 'AUTH_REQUIRED' })); break; }
          const rtcTo = data.to ? sanitizeId(String(data.to), 200) : null;
          if (!rtcTo) break;
          const rtcRecipient = Array.from(clients.values()).find(c => c.userId === rtcTo);
          if (rtcRecipient?.ws.readyState === 1) rtcRecipient.ws.send(JSON.stringify({ type: 'rtc-signal', from: userId, payload: data.payload }));
          break;
        }

        case 'broadcast':
          if (!peerId) {
            if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'error', code: 'AUTH_REQUIRED', reason: 'register required before broadcast' }));
            break;
          }
          broadcastToOthers(peerId, data.data);
          cacheMessage(data.data);
          break;

        case 'direct': {
          if (!peerId) {
            if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'error', code: 'AUTH_REQUIRED', reason: 'register required before direct messaging' }));
            break;
          }
          const targetWs = clients.get(data.targetPeer)?.ws;
          if (targetWs?.readyState === 1) targetWs.send(JSON.stringify(data.data));
          break;
        }

        case 'new-poll':
        case 'new-block':
        case 'request-sync':
        case 'sync-response':
          if (!peerId) {
            if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'error', code: 'AUTH_REQUIRED', reason: 'register required before relay actions' }));
            break;
          }
          broadcastToOthers(peerId, data);
          cacheMessage(data);
          if (data.type === 'new-poll' && data.poll) {
            await indexContent('poll', data.poll.id, data.poll);
            setImmediate(() => {
              if (data.poll.category) { markAlreadyCategorised(data.poll.id); return; }
              queueForCategorisation(data.poll.id, 'poll', data.poll, (r) => writeCategrisationResult(data.poll.id, r));
            });
          }
          if (data.type === 'new-block' && data.actionType === 'vote') {
            // ── Trust tier enforcement ──────────────────────────────────────
            if (db) {
              try {
                const pollId  = sanitizeId(String(data.pollId || ''), 128);
                const escaped = pollId.replace(/[%_\\]/g, '\\$&');
                const pRows   = await (await import('./db.js')).queryMySQL(
                  `SELECT data FROM gun_nodes WHERE soul LIKE ? ESCAPE ? OR soul LIKE ? ESCAPE ? LIMIT 3`,
                  [`${NAMESPACE}/%/polls/${escaped}`, '\\']
                );
                const pollData = pRows?.map(r => { try { return JSON.parse(r.data); } catch { return null; } }).find(d => d?.id === pollId);
                const requiredTier = pollData?.voteTrustPolicy?.requiredTier || 'anonymous';

                if (requiredTier === 'pow' && !data.powNonce) {
                  if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'error', code: 'TRUST_TIER_REQUIRED', reason: 'PoW nonce required for this poll' }));
                  break;
                }
                if (requiredTier === 'relay' && !data.relayAttestation) {
                  if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'error', code: 'TRUST_TIER_REQUIRED', reason: 'Relay attestation required for this poll' }));
                  break;
                }
                if (requiredTier === 'issuer' && !data.issuerCert) {
                  if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'error', code: 'TRUST_TIER_REQUIRED', reason: 'Issuer certificate required for this poll' }));
                  break;
                }
              } catch (err) {
                console.warn('[trust-tier] lookup failed:', err.message);
                // fail open — don't block votes on DB error
              }

              db.execute(
                `INSERT IGNORE INTO chain_blocks (block_index, poll_id, device_id, action_type, vote_hash, pubkey, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [data.index ?? null, data.pollId ?? null, data.deviceId ?? null, data.actionType ?? null, data.voteHash ?? null, data.pubkey ?? null, data.timestamp ?? Date.now()]
              ).catch(err => console.warn('[chain-persist] Failed:', err.message));
            }
          }
          break;

        case 'new-post':
          if (!peerId) {
            if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'error', code: 'AUTH_REQUIRED', reason: 'register required before relay actions' }));
            break;
          }
          broadcastToOthers(peerId, data);
          cacheMessage(data);
          if (data.post) {
            await indexContent('post', data.post.id, data.post);
            setImmediate(() => {
              if (data.post.category) { markAlreadyCategorised(data.post.id); return; }
              queueForCategorisation(data.post.id, 'post', data.post, (r) => writeCategrisationResult(data.post.id, r));
            });
          }
          break;

        case 'chatroom-message':
          if (!peerId || !userId) {
            if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'error', code: 'AUTH_REQUIRED', reason: 'register required before room chat' }));
            break;
          }
          if (!data.roomId || !rooms.has(data.roomId) || !rooms.get(data.roomId).has(peerId)) {
            if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'error', code: 'ROOM_ACCESS_DENIED', reason: 'join room before sending room chat' }));
            break;
          }
          broadcastToRoom(data.roomId, peerId, { type: 'chatroom-message', roomId: data.roomId, data: data.data });
          break;

        case 'register-presence': {
          const presenceUserId = sanitizeId(String(data.userId || ''), 200);
          if (presenceUserId && peerId) {
            userId = presenceUserId;
            const existing = clients.get(peerId);
            if (existing) existing.userId = presenceUserId;
          }
          break;
        }

        case 'ping':
          if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'pong' }));
          break;

        case 'request-pow': {
          const deviceId = data.deviceId || peerId;
          const action   = data.action || 'default';
          const botScore = botDetector.getScore(peerId || peerIp);
          const sessionUser = sessionUserCache || await getSecureSession(req);
          if (sessionUser) sessionUserCache = sessionUser;
          const resolvedTier = resolveWsIdentityTier(sessionUser, data.identityUsername);
          identityTier = resolvedTier;
          const challenge = powChallenge.createChallenge(deviceId, action, { botScore, spamPenalty: 0, identityTier: resolvedTier });
          if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'pow-challenge', ...challenge }));
          break;
        }
      }
    } catch (err) { console.error('WS error:', err.message); }
  });

  ws.on('close', () => {
    if (peerId) {
      clients.delete(peerId);
      rooms.forEach((peers, roomId) => { peers.delete(peerId); if (peers.size === 0) rooms.delete(roomId); });
      broadcast({ type: 'peer-left', peerId });
      activeChatSessions.forEach((session, roomId) => { if (session.users.includes(userId)) activeChatSessions.delete(roomId); });
    }
  });

  ws.on('error', err => console.error('WebSocket error:', err.message));
  ws.send(JSON.stringify({
    type:           'welcome',
    message:        'Connected to P2P relay',
    timestamp:      Date.now(),
    wireFilterMode: ws._wireFilterMode,
  }));
});

export { pingTimer };