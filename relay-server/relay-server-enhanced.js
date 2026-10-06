import { pruneEngagementHistory } from '../shared-validation/engagement-store.js';
// index.js — Entry point: wires all modules together and starts the server
import { server, PORT, DOMAIN, clients, activeChatSessions, rateLimiter, botDetector, powChallenge, replayProtector, oauthStates, OAUTH_STATE_TTL_MS, PENDING_VOTE_CLEANUP_MS } from './config.js';
import { db, queryMySQL, initMySQL } from './db.js';
import {
  saveMessageCache, saveVoteRegistry, savePollPolicyRegistry,
  cleanupPendingVoteReservations, messageCache, saveVoteRegistrySync,
} from './persistence.js';
import { ssrCache, SSR_CACHE_TTL } from './ssr.js';
import { pingTimer } from './websocket.js';
import { deriveNostrEventId, currentEpoch, deriveSpaceSoul, EPOCH_MS } from './crypto-utils.js';
import { NAMESPACE } from '../shared-validation/namespace.js';
export { deriveNostrEventId, currentEpoch, deriveSpaceSoul }; // re-export for convenience

// Side-effect imports — register routes and WS handlers
import './routes.js';
import './websocket.js';

// ─── MySQL ────────────────────────────────────────────────────────────────────
await initMySQL();
setInterval(() => pruneEngagementHistory(db).catch(() => {}), 60_000).unref();

// ─── OAuth state expiry ────────────────────────────────────────────────────────
setInterval(() => {
  const now = Date.now();
  for (const [state, entry] of oauthStates) {
    if (now - entry.createdAt > OAUTH_STATE_TTL_MS) oauthStates.delete(state);
  }
}, 2 * 60_000);

// ─── Periodic saves ────────────────────────────────────────────────────────────
setInterval(saveMessageCache, 30_000);
setInterval(saveVoteRegistry, 60_000);
setInterval(savePollPolicyRegistry, 60_000);
setInterval(() => cleanupPendingVoteReservations(), PENDING_VOTE_CLEANUP_MS);

// ─── Session cleanup ──────────────────────────────────────────────────────────
setInterval(async () => {
  if (!db) return;
  try { await db.execute(`DELETE FROM sessions WHERE expires_at < ?`, [Date.now()]); }
  catch (err) { console.error('Session cleanup error:', err.message); }
}, 3_600_000);

// ─── SSR cache expiry ──────────────────────────────────────────────────────────
setInterval(() => {
  const cutoff = Date.now() - SSR_CACHE_TTL;
  for (const [key, val] of ssrCache) { if (val.ts < cutoff) ssrCache.delete(key); }
}, 7_200_000);

// ─── Dark community rendezvous epoch rotation ────────────────────────────────
// Republishes dark-community stub to the new rotating Gun soul every 6 h.
// Gun write is done inside gun-relay-enhanced.js — we just emit a WS internal
// event so that module can react.  Requires gun-relay-enhanced.js to listen for
// the custom 'epoch-rotate' event emitted on the server object.
setInterval(async () => {
  if (!db) return;
  try {
    const rows = await queryMySQL(
      `SELECT data FROM gun_nodes WHERE soul REGEXP '^${NAMESPACE}/communities/c-[^/]+$'`,
      []
    );
    const epoch = currentEpoch();
    const toRotate = [];
    for (const row of rows || []) {
      try {
        const d = JSON.parse(row.data);
        if (!d?.darkMode || !d?.rendezvousSeed) continue;
        toRotate.push({ id: d.id, displayName: d.displayName, createdAt: d.createdAt, rendezvousSeed: d.rendezvousSeed, soul: deriveSpaceSoul(d.rendezvousSeed, epoch) });
      } catch {}
    }
    if (toRotate.length > 0) {
      server.emit('epoch-rotate', toRotate);
      console.log(`[epoch-rotate] Rotated ${toRotate.length} dark communities for epoch ${epoch}`);
    }
  } catch (err) {
    console.error('[epoch-rotate] Error:', err.message);
  }
}, EPOCH_MS);

// ─── Chat media cleanup (hourly) ──────────────────────────────────────────────
// Deletes expired or already-downloaded blobs from disk and marks them deleted.
setInterval(async () => {
  if (!db) return;
  try {
    const { unlink } = await import('fs');
    const [rows] = await db.execute(
      `SELECT id, blob_path FROM chat_media
       WHERE (expires_at < ? OR downloaded = 1) AND deleted = 0`,
      [Date.now()]
    );
    for (const row of rows) {
      await db.execute(`UPDATE chat_media SET deleted = 1 WHERE id = ?`, [row.id]).catch(() => {});
      unlink(row.blob_path, () => {});
    }
    if (rows.length > 0) console.log(`[chat-media] Cleaned up ${rows.length} expired blobs`);
  } catch (err) { console.error('[chat-media] cleanup error:', err.message); }
}, 60 * 60 * 1000);

// ─── Chat message TTL cleanup (hourly) ────────────────────────────────────────
// Delivered messages are deleted by markMessagesAsRead in chat.js the moment
// they are collected. This job catches messages from recipients who have been
// offline for 30+ days and will never collect them.
setInterval(async () => {
  if (!db) return;
  try {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000; // 30 days
    const [result] = await db.execute(
      `DELETE FROM chat_messages WHERE timestamp < ?`,
      [cutoff]
    );
    if (result.affectedRows > 0)
      console.log(`[chat-messages] TTL: purged ${result.affectedRows} stale messages`);
  } catch (err) { console.error('[chat-messages] TTL cleanup error:', err.message); }
}, 60 * 60 * 1000);

// ─── Start ─────────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`🚀 Enhanced Relay on :${PORT}`);
  console.log(`   Domain : ${DOMAIN}`);
  console.log(`   MySQL  : ${db ? '✅' : '❌'}`);
  console.log(`   Features: P2P Chat ✅ | Search ✅ | Auth ✅ | Sitemap ✅ | Crypto ✅`);
  console.log(`   Cache  : ${messageCache.length} messages`);
});

// ─── Graceful shutdown ─────────────────────────────────────────────────────────
import { wss } from './config.js';

process.on('SIGINT', () => {
  saveMessageCache();
  clearInterval(pingTimer);
  rateLimiter.destroy();
  botDetector.destroy();
  powChallenge.destroy();
  replayProtector.destroy();
  saveVoteRegistrySync();
  wss.clients.forEach(ws => ws.close());
  server.close(() => process.exit(0));
});