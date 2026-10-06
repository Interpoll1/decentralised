import { verifyAction } from './engagement.js';
import { acceptAction } from './engagement-store.js';

function reply(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(value));
}

// Byte-bounded, handles aborted streams and responds once. No production I/O.
export function readActionBody(req, res, limit = 32768) {
  return new Promise(resolve => {
    let done = false, length = 0, chunks = [];
    const fail = status => {
      if (done) return;
      done = true; chunks = [];
      if (!res.headersSent && !res.destroyed) reply(res, status, { error: 'INVALID_BODY' });
      resolve(null);
    };
    req.on('data', chunk => {
      if (done) return;
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      length += bytes.length;
      if (length > limit) { fail(413); return; }
      chunks.push(bytes);
    });
    req.on('error', () => fail(400));
    req.on('aborted', () => fail(400));
    req.on('end', () => {
      if (done) return;
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!value || typeof value !== 'object' || Array.isArray(value)) { fail(400); return; }
        done = true; chunks = []; resolve(value);
      } catch { fail(400); }
    });
  });
}

export async function handleEngagement(req, res, { db, namespace, views = false, now = Date.now(), accept = acceptAction }) {
  const body = await readActionBody(req, res, views ? 32768 : 4096);
  if (body === null) return;
  const actions = views ? body?.actions : [body?.action];
  if (!Array.isArray(actions) || !actions.length || actions.length > (views ? 32 : 1)
    || actions.some(a => !verifyAction(a, { now, namespace }) || a.kind !== (views ? 'view' : 'reaction'))) {
    reply(res, 422, { error: 'AUTHENTICATED_ENGAGEMENT_V1_REQUIRED' }); return;
  }
  if (!db) { reply(res, 503, { error: 'STORAGE_UNAVAILABLE' }); return; }
  const results = [];
  for (const action of actions) {
    try {
      const result = await accept(db, action, namespace, now);
      results.push({ id: action.id, status: result.status });
    } catch (error) {
      // Earlier batch actions may have committed; exact retries are idempotent.
      reply(res, error.message === 'STALE_ACTION' ? 409 : 503, { error: error.message === 'STALE_ACTION' ? 'STALE_ACTION' : 'STORAGE_UNAVAILABLE', results });
      return;
    }
  }
  if (views) {
    // Advisory aggregate cache. Accepted-event authority is the SQL transaction.
    for (const id of new Set(actions.map(a => a.targetId))) {
      await db.execute(`UPDATE search_index SET view_count = (SELECT COUNT(*) FROM post_views WHERE content_id = ?),
        unique_viewers = (SELECT COUNT(DISTINCT viewer_pub) FROM post_views WHERE content_id = ?) WHERE id = ?`, [id, id, id]).catch(() => {});
    }
  }
  reply(res, 200, views ? { results } : results[0]);
}
