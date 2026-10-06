import { verifyAction, readAction, reactionSoul, compareActions } from './engagement.js';

export async function initEngagementStore(db) {
  await db.execute(`CREATE TABLE IF NOT EXISTS engagement_actions_v1 (
    id CHAR(64) PRIMARY KEY, actor CHAR(64) NOT NULL, kind VARCHAR(16) NOT NULL,
    target_type VARCHAR(16) NOT NULL, target_id VARCHAR(128) NOT NULL,
    received_at BIGINT NOT NULL, payload TEXT NOT NULL,
    INDEX engagement_received_at (received_at)
  ) ENGINE=InnoDB`);
}

// One shared transaction boundary for HTTP and Gun, including separate processes
// sharing this database. No process-local mutex is treated as durable ownership.
export async function acceptAction(db, action, namespace, now = Date.now()) {
  if (!verifyAction(action, { now, namespace })) throw new Error('INVALID_OR_EXPIRED_ACTION');
  if (!db) throw new Error('STORAGE_UNAVAILABLE');
  const c = await db.getConnection();
  try {
    await c.beginTransaction();
    let soul, current, old;
    if (action.kind === 'reaction') {
      soul = reactionSoul(action, namespace);
      // Ensures a lockable row exists; rollback removes a newly inserted row.
      await c.execute('INSERT IGNORE INTO gun_nodes (soul, data) VALUES (?, ?)', [soul, '{}']);
      const [rows] = await c.execute('SELECT data FROM gun_nodes WHERE soul = ? FOR UPDATE', [soul]);
      if (!rows.length) throw new Error('REACTION_LOCK_FAILED');
      current = JSON.parse(rows[0].data);
      old = readAction(current.envelope, { namespace, fresh: false, actor: action.actor, targetType: action.targetType, targetId: action.targetId });
      if (old && compareActions(action, old) < 0) throw new Error('STALE_ACTION');
      if (old?.id === action.id) { await c.commit(); return { status: 'duplicate', action, gunState: current.gunState }; }
    }
    const [insert] = await c.execute(
      'INSERT IGNORE INTO engagement_actions_v1 (id, actor, kind, target_type, target_id, received_at, payload) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [action.id, action.actor, action.kind, action.targetType, action.targetId, now, JSON.stringify(action)],
    );
    if (!insert.affectedRows) { await c.commit(); return { status: 'duplicate', action }; }
    let gunState;
    if (action.kind === 'reaction') {
      // Persist a relay-assigned monotonic Gun clock. Equal signed timestamps
      // still have a SQL ordering, independent of Gun's lexical conflict rule.
      const previousClock = old && Number.isFinite(current.gunState) ? current.gunState : 0;
      gunState = Math.max(now, previousClock + 0.01);
      // Replace legacy material, never authenticate it by merging signatures.
      const record = { envelope: JSON.stringify(action), gunState, type: action.value, userId: action.actor, at: action.createdAt,
        [action.targetType === 'post' ? 'postId' : 'commentId']: action.targetId };
      await c.execute('UPDATE gun_nodes SET data = ?, updated_at = NOW() WHERE soul = ?', [JSON.stringify(record), soul]);
    } else {
      const [view] = await c.execute('INSERT IGNORE INTO post_views (content_id, content_type, viewer_pub, viewed_at) VALUES (?, ?, ?, ?)',
        [action.targetId, action.targetType, action.actor, now]);
      if (!view.affectedRows) {
        // A new signature cannot create another observation of the same view.
        await c.rollback(); return { status: 'duplicate', action };
      }
    }
    await c.commit();
    return { status: 'accepted', action, receivedAt: now, gunState };
  } catch (error) {
    await c.rollback(); throw error;
  } finally { c.release(); }
}

export async function pruneEngagementHistory(db, now = Date.now()) {
  if (!db) return;
  await db.execute('DELETE FROM engagement_actions_v1 WHERE received_at < ? LIMIT 5000', [now - 600_000]);
}

// Expired reads may repeat only the exact current record, without a new event.
// Peer-supplied @/faith/read flags never grant authority.
export async function acceptGunAction(db, action, namespace, now = Date.now()) {
  if (verifyAction(action, { namespace, now })) return acceptAction(db, action, namespace, now);
  if (!db || !verifyAction(action, { namespace, fresh: false }) || action.kind !== 'reaction') throw new Error('INVALID_ACTION');
  const [rows] = await db.execute('SELECT data FROM gun_nodes WHERE soul = ?', [reactionSoul(action, namespace)]);
  const current = rows[0] && JSON.parse(rows[0].data);
  const old = current && readAction(current.envelope, { namespace, fresh: false });
  if (old?.id !== action.id) throw new Error('STALE_ACTION');
  return { status: 'duplicate', action, gunState: current.gunState };
}
