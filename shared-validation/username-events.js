// Relay-side validation and storage for signed username events (IPP-10).
//
// The relay is a WITNESS, not an authority: it checks every signature, remembers the recovery key
// registered for each username, and stamps the time it first saw each event. Clients still verify
// signatures themselves and replay the events; the relay's stamps replace the author's clock for
// claim priority and for time locks, which is what makes backdating useless.
import { schnorr } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { readActionBody } from './engagement-http.js';

export const NOTICE_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_TIMELOCK_MS = 14 * 24 * 60 * 60 * 1000;
export const MIN_TIMELOCK_MS = 3 * 24 * 60 * 60 * 1000;
export const MAX_TIMELOCK_MS = 90 * 24 * 60 * 60 * 1000;
export const FRESHNESS_MS = 15 * 60 * 1000;   // an event's declared time must be near the relay's clock
export const MAX_EVENTS_PER_NAME = 200;

const HEX64 = /^[0-9a-f]{64}$/;
const HEX128 = /^[0-9a-f]{128}$/;
const NAME = /^[a-z0-9_.-]{3,32}$/;

// ── Canonical form: must match src/utils/usernameEvents.ts byte for byte ─────

function stable(obj) {
  const keys = Object.keys(obj).filter(k => obj[k] !== undefined).sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${JSON.stringify(obj[k])}`).join(',')}}`;
}
export function signingPayload(ev) {
  const { sig, sigOld, sigNew, sigRecovery, ...rest } = ev;
  void sig; void sigOld; void sigNew; void sigRecovery;
  return stable(rest);
}
const hashHex = (s) => bytesToHex(sha256(new TextEncoder().encode(s)));
export const eventId = (ev) => hashHex(signingPayload(ev));

function verifySig(payload, sig, pub) {
  try {
    if (typeof sig !== 'string' || typeof pub !== 'string' || !HEX128.test(sig) || !HEX64.test(pub)) return false;
    return schnorr.verify(hexToBytes(sig), hexToBytes(hashHex(payload)), hexToBytes(pub));
  } catch { return false; }
}

// ── Structural validation ────────────────────────────────────────────────────

const isNum = (n) => typeof n === 'number' && Number.isFinite(n);

/** Returns an error code, or null when the event is well-formed and its signatures check out. */
export function checkEvent(ev) {
  if (!ev || typeof ev !== 'object' || Array.isArray(ev) || ev.v !== 1) return 'BAD_SHAPE';
  if (typeof ev.username !== 'string' || !NAME.test(ev.username)) return 'BAD_USERNAME';
  const payload = signingPayload(ev);
  switch (ev.type) {
    case 'claim':
      if (!HEX64.test(ev.pubkey || '') || !isNum(ev.claimedAt) || !['none', 'issuer'].includes(ev.level)) return 'BAD_SHAPE';
      return verifySig(payload, ev.sig, ev.pubkey) ? null : 'BAD_SIGNATURE';
    case 'designation':
      if (!HEX64.test(ev.pubkey || '') || !HEX64.test(ev.recoveryPubkey || '') || !isNum(ev.createdAt) || !isNum(ev.timelockMs)) return 'BAD_SHAPE';
      if (ev.timelockMs < MIN_TIMELOCK_MS || ev.timelockMs > MAX_TIMELOCK_MS) return 'BAD_TIMELOCK';
      return verifySig(payload, ev.sig, ev.pubkey) ? null : 'BAD_SIGNATURE';
    case 'rotation':
      if (!HEX64.test(ev.oldPubkey || '') || !HEX64.test(ev.newPubkey || '') || !isNum(ev.createdAt)) return 'BAD_SHAPE';
      return verifySig(payload, ev.sigNew, ev.newPubkey) ? null : 'BAD_SIGNATURE';
    case 'cancel':
      if (!HEX64.test(ev.pubkey || '') || !HEX64.test(ev.rotationId || '') || !isNum(ev.createdAt)) return 'BAD_SHAPE';
      return verifySig(payload, ev.sig, ev.pubkey) ? null : 'BAD_SIGNATURE';
    default:
      return 'BAD_TYPE';
  }
}

// ── State machine (pure) ─────────────────────────────────────────────────────
// state = { owner, claimedAt, level, recovery: { pubkey, timelockMs, designatedAt } | null,
//           pending: { rotationId, newPubkey, requestedAt, effectiveAt, kind } | null } | null

/** Apply a rotation whose waiting period is over. */
export function settle(state, now) {
  if (!state?.pending || state.pending.effectiveAt > now) return state;
  return { ...state, owner: state.pending.newPubkey, recovery: null, pending: null };
}

const fresh = (t, now) => Math.abs(t - now) <= FRESHNESS_MS;

/**
 * Decide whether `ev` is acceptable given the current state. `now` is the RELAY's clock and becomes the
 * witnessed time. Returns { ok: true, state } or { ok: false, status, error }.
 */
export function applyEvent(prior, ev, now) {
  const err = checkEvent(ev);
  if (err) return { ok: false, status: 422, error: err };
  const state = settle(prior, now);

  if (ev.type === 'claim') {
    if (!state) return { ok: true, state: { owner: ev.pubkey, claimedAt: now, level: ev.level, recovery: null, pending: null } };
    if (state.owner !== ev.pubkey) return { ok: false, status: 409, error: 'NAME_TAKEN' };
    return { ok: true, state: { ...state, level: ev.level === 'issuer' ? 'issuer' : state.level } }; // same holder re-claiming
  }
  if (!state) return { ok: false, status: 404, error: 'NAME_NOT_CLAIMED' };
  if (!fresh(ev.createdAt, now)) return { ok: false, status: 422, error: 'STALE_OR_FUTURE_EVENT' };

  if (ev.type === 'designation') {
    if (ev.pubkey !== state.owner) return { ok: false, status: 403, error: 'NOT_HOLDER' };
    if (state.recovery && ev.createdAt <= state.recovery.designatedAt) return { ok: false, status: 409, error: 'OLDER_DESIGNATION' };
    // Replacing the recovery key while a recovery is pending would let a compromised key dodge the lock.
    if (state.pending) return { ok: false, status: 409, error: 'ROTATION_PENDING' };
    return { ok: true, state: { ...state, recovery: { pubkey: ev.recoveryPubkey, timelockMs: ev.timelockMs, designatedAt: ev.createdAt } } };
  }

  if (ev.type === 'rotation') {
    if (state.pending) return { ok: false, status: 409, error: 'ROTATION_PENDING' };
    if (ev.oldPubkey !== state.owner || ev.newPubkey === state.owner) return { ok: false, status: 403, error: 'NOT_HOLDER' };
    const payload = signingPayload(ev);
    const rotationId = eventId(ev);
    if (verifySig(payload, ev.sigOld, ev.oldPubkey)) {
      return { ok: true, state: { ...state, pending: { rotationId, newPubkey: ev.newPubkey, requestedAt: now, effectiveAt: now + NOTICE_MS, kind: 'voluntary' } } };
    }
    if (state.recovery && verifySig(payload, ev.sigRecovery, state.recovery.pubkey)) {
      return { ok: true, state: { ...state, pending: { rotationId, newPubkey: ev.newPubkey, requestedAt: now, effectiveAt: now + state.recovery.timelockMs, kind: 'recovery' } } };
    }
    return { ok: false, status: 403, error: state.recovery ? 'RECOVERY_KEY_MISMATCH' : 'NO_RECOVERY_KEY' };
  }

  if (ev.type === 'cancel') {
    if (!state.pending || ev.pubkey !== state.owner || ev.rotationId !== state.pending.rotationId) return { ok: false, status: 403, error: 'NOTHING_TO_CANCEL' };
    return { ok: true, state: { ...state, pending: null } };
  }
  return { ok: false, status: 422, error: 'BAD_TYPE' };
}

// ── Storage ──────────────────────────────────────────────────────────────────

export async function initUsernameEventStore(db) {
  await db.execute(`CREATE TABLE IF NOT EXISTS username_events_v1 (
    event_id CHAR(64) PRIMARY KEY, username VARCHAR(32) NOT NULL, type VARCHAR(12) NOT NULL,
    json TEXT NOT NULL, first_seen BIGINT NOT NULL, INDEX username_events_name (username, first_seen)
  ) ENGINE=InnoDB`);
  await db.execute(`CREATE TABLE IF NOT EXISTS username_state_v1 (
    username VARCHAR(32) PRIMARY KEY, state_json TEXT NOT NULL, updated_at BIGINT NOT NULL
  ) ENGINE=InnoDB`);
}

let initialised = false;

/** Validate, apply and persist one event. Idempotent: a repeated event returns its original first-seen time. */
export async function acceptUsernameEvent(db, ev, now = Date.now()) {
  if (!db) return { ok: false, status: 503, error: 'STORAGE_UNAVAILABLE' };
  const early = checkEvent(ev);
  if (early) return { ok: false, status: 422, error: early };
  if (!initialised) { await initUsernameEventStore(db); initialised = true; }
  const id = eventId(ev);
  const c = await db.getConnection();
  try {
    await c.beginTransaction();
    // Ensures a lockable row exists; a rollback removes a newly inserted placeholder.
    await c.execute('INSERT IGNORE INTO username_state_v1 (username, state_json, updated_at) VALUES (?, ?, ?)', [ev.username, 'null', now]);
    const [rows] = await c.execute('SELECT state_json FROM username_state_v1 WHERE username = ? FOR UPDATE', [ev.username]);
    const [dup] = await c.execute('SELECT first_seen FROM username_events_v1 WHERE event_id = ?', [id]);
    if (dup.length) {
      await c.commit();
      return { ok: true, status: 200, id, firstSeen: Number(dup[0].first_seen), duplicate: true, state: settle(JSON.parse(rows[0].state_json), now) };
    }
    const [[{ n }]] = await c.execute('SELECT COUNT(*) AS n FROM username_events_v1 WHERE username = ?', [ev.username]);
    if (Number(n) >= MAX_EVENTS_PER_NAME) { await c.rollback(); return { ok: false, status: 429, error: 'TOO_MANY_EVENTS' }; }

    const result = applyEvent(JSON.parse(rows[0].state_json), ev, now);
    if (!result.ok) { await c.rollback(); return result; }
    await c.execute('INSERT INTO username_events_v1 (event_id, username, type, json, first_seen) VALUES (?, ?, ?, ?, ?)',
      [id, ev.username, ev.type, JSON.stringify(ev), now]);
    await c.execute('UPDATE username_state_v1 SET state_json = ?, updated_at = ? WHERE username = ?', [JSON.stringify(result.state), now, ev.username]);
    await c.commit();
    return { ok: true, status: 200, id, firstSeen: now, duplicate: false, state: result.state };
  } catch (error) {
    try { await c.rollback(); } catch { /* connection already gone */ }
    return { ok: false, status: 503, error: 'STORAGE_UNAVAILABLE', detail: error?.message };
  } finally { c.release(); }
}

export async function listUsernameEvents(db, username, now = Date.now()) {
  if (!db) return { ok: false, status: 503, error: 'STORAGE_UNAVAILABLE' };
  if (!NAME.test(username || '')) return { ok: false, status: 422, error: 'BAD_USERNAME' };
  if (!initialised) { await initUsernameEventStore(db); initialised = true; }
  const [events] = await db.execute('SELECT event_id, json, first_seen FROM username_events_v1 WHERE username = ? ORDER BY first_seen ASC LIMIT ' + Number(MAX_EVENTS_PER_NAME), [username]);
  const [rows] = await db.execute('SELECT state_json FROM username_state_v1 WHERE username = ?', [username]);
  const state = rows.length ? settle(JSON.parse(rows[0].state_json), now) : null;
  return {
    ok: true, status: 200,
    state: state && { owner: state.owner, level: state.level, hasRecovery: !!state.recovery, pending: state.pending },
    events: events.map(e => ({ id: e.event_id, firstSeen: Number(e.first_seen), event: JSON.parse(e.json) })),
  };
}

// ── HTTP ─────────────────────────────────────────────────────────────────────

function reply(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}

/**
 * POST /api/username-events            body: one signed event
 * GET  /api/username-events/:username  → { state, events: [{ id, firstSeen, event }] }
 */
export async function handleUsernameEvents(req, res, url, opts = {}) {
  try { await handleUsernameEventsInner(req, res, url, opts); }
  catch (error) {
    if (!res.headersSent && !res.destroyed) reply(res, 503, { error: 'STORAGE_UNAVAILABLE' });
    else if (!res.writableEnded) res.end();
    console.warn('[username-events]', error?.message);
  }
}

async function handleUsernameEventsInner(req, res, url, { db, now = Date.now() } = {}) {
  if (req.method === 'GET') {
    const name = decodeURIComponent(url.pathname.split('/').pop() || '').toLowerCase();
    const out = await listUsernameEvents(db, name, now);
    reply(res, out.status, out.ok ? { state: out.state, events: out.events } : { error: out.error });
    return;
  }
  if (req.method === 'POST') {
    const body = await readActionBody(req, res, 8192);
    if (body === null) return;
    const out = await acceptUsernameEvent(db, body, now);
    reply(res, out.status, out.ok
      ? { id: out.id, firstSeen: out.firstSeen, duplicate: out.duplicate }
      : { error: out.error });
    return;
  }
  reply(res, 405, { error: 'METHOD_NOT_ALLOWED' });
}
