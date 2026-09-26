// Staging-only E2E. Copy into a patched backend tree and run from there, with both
// relays on 127.0.0.1:18080 / :18765 and a throwaway MySQL on :13306 (see README).
// Never point it at production: it writes test votes and views.
// Staging E2E: real HTTP + real Gun WS against locally running patched relays + real MySQL.
import { createRequire } from 'node:module';
import { schnorr } from '@noble/curves/secp256k1.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { signAction } from './shared-validation/engagement.js';
const require = createRequire(new URL('./gun-relay/', import.meta.url));
const Gun = require('gun');
const mysql = require('mysql2/promise');

const API = 'http://127.0.0.1:18080', GUN = 'http://127.0.0.1:18765/gun', NS = 'v5';
const db = await mysql.createConnection({ host: '127.0.0.1', port: 13306, user: 'root', password: 'stagepw', database: 'interpoll' });
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };
const key = () => bytesToHex(schnorr.utils.randomSecretKey());
const nonce = () => bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
const act = (priv, kind, targetType, targetId, value, createdAt = Date.now()) =>
  signAction({ namespace: NS, actor: bytesToHex(schnorr.getPublicKey(Buffer.from(priv, 'hex'))), kind, targetType, targetId, value, createdAt, nonce: nonce() }, priv);
const post = async (path, body, headers = {}) => {
  const r = await fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173', ...headers }, body: JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, body: j };
};
const row = async soul => (await db.query('SELECT data FROM gun_nodes WHERE soul = ?', [soul]))[0][0];
const ledger = async id => (await db.query('SELECT COUNT(*) n FROM engagement_actions_v1 WHERE id = ?', [id]))[0][0].n;
const run = Date.now().toString(36);
const P1 = `post-e2e-${run}-a`, P2 = `post-e2e-${run}-b`, P3 = `post-e2e-${run}-c`, C1 = `comment_e2e_${run}`;
const k1 = key(), k2 = key(), k3 = key();

// ── HTTP: relay-server ──
{
  const r = await post('/api/content-vote', { postId: P1, userId: 'a'.repeat(64), type: 'up', at: Date.now() });
  check('legacy unsigned content-vote rejected', r.status === 422, `${r.status} ${JSON.stringify(r.body)}`);
  check('legacy write left no row', !(await row(`${NS}/postVotes/${P1}/${'a'.repeat(64)}`)));
}
const up = act(k1, 'reaction', 'post', P1, 'up');
{
  const r = await post('/api/content-vote', { action: up });
  check('signed post reaction accepted with exact receipt', r.status === 200 && r.body?.id === up.id && r.body?.status === 'accepted', JSON.stringify(r.body));
  const d = JSON.parse((await row(`${NS}/postVotes/${P1}/${up.actor}`))?.data || '{}');
  check('gun_nodes row has envelope + legacy-compatible type', d.envelope === JSON.stringify(up) && d.type === 'up');
  check('one ledger row', (await ledger(up.id)) === 1);
  const r2 = await post('/api/content-vote', { action: up });
  check('exact retry → duplicate', r2.status === 200 && r2.body?.status === 'duplicate' && r2.body?.id === up.id, JSON.stringify(r2.body));
  check('still one ledger row after retry', (await ledger(up.id)) === 1);
}
{
  const t = await (await fetch(`${API}/api/vote-tally?ids=${P1}`)).json();
  check('vote-tally counts signed vote', t.tallies?.[P1]?.upvotes === 1 && t.evidence === 'legacy-inclusive-unverified', JSON.stringify(t));
}
const down = act(k1, 'reaction', 'post', P1, 'down', up.createdAt + 5);
{
  const r = await post('/api/content-vote', { action: down });
  check('newer reaction replaces older', r.body?.status === 'accepted');
  const t = await (await fetch(`${API}/api/vote-tally?ids=${P1}`)).json();
  check('tally reflects switch to down', t.tallies?.[P1]?.upvotes === 0 && t.tallies?.[P1]?.downvotes === 1, JSON.stringify(t.tallies?.[P1]));
  const stale = act(k1, 'reaction', 'post', P1, 'up', up.createdAt - 1000);
  const r2 = await post('/api/content-vote', { action: stale });
  check('stale older action rejected (409)', r2.status === 409, `${r2.status} ${JSON.stringify(r2.body)}`);
  const expired = act(k1, 'reaction', 'post', P1, 'up', Date.now() - 10 * 60_000);
  const r3 = await post('/api/content-vote', { action: expired });
  check('expired action rejected (422)', r3.status === 422, `${r3.status}`);
  const tampered = { ...act(k2, 'reaction', 'post', P1, 'up'), value: 'down' };
  const r4 = await post('/api/content-vote', { action: tampered });
  check('tampered action rejected (422)', r4.status === 422, `${r4.status}`);
}
{
  const c = act(k2, 'reaction', 'comment', C1, 'up');
  const r = await post('/api/content-vote', { action: c });
  check('comment reaction accepted', r.body?.status === 'accepted', JSON.stringify(r.body));
  check('comment reaction stored under commentVotes', !!(await row(`${NS}/commentVotes/${C1}/${c.actor}`)));
}
{
  const v1 = act(k1, 'view', 'post', P1, 'view'), v2 = act(k1, 'view', 'poll', `poll-e2e-${run}`, 'view');
  const r = await post('/api/views', { actions: [v1, v2] });
  const ok = r.status === 200 && r.body?.results?.length === 2 && r.body.results.every(x => x.status === 'accepted');
  check('signed view batch accepted per action', ok, JSON.stringify(r.body));
  const again = act(k1, 'view', 'post', P1, 'view');
  const r2 = await post('/api/views', { actions: [again] });
  check('second view same account/target → duplicate', r2.body?.results?.[0]?.status === 'duplicate', JSON.stringify(r2.body));
  const [[{ n }]] = await db.query('SELECT COUNT(*) n FROM post_views WHERE content_id = ?', [P1]);
  check('post_views has exactly one row for the target', n === 1, `n=${n}`);
  const r3 = await post('/api/views', { views: [{ id: P1, type: 'post', ts: Date.now() }] }, { Authorization: 'Bearer ' + 'b'.repeat(64) });
  check('legacy Bearer views rejected (422)', r3.status === 422, `${r3.status}`);
}

// ── Gun WS: gun-relay ──
const gun = Gun({ peers: [GUN], localStorage: false, radisk: false, file: false, axe: false, multicast: false });
const put = (chain, data, ms = 8000) => new Promise(res => { const t = setTimeout(() => res({ timeout: true }), ms); chain.put(data, ack => { clearTimeout(t); res(ack); }); });
await new Promise(r => setTimeout(r, 1500));
{
  const g = act(k3, 'reaction', 'post', P2, 'up');
  const ack = await put(gun.get(`${NS}/postVotes`).get(P2).get(g.actor), { envelope: JSON.stringify(g) });
  check('Gun: signed envelope put acked without error', !ack.err && !ack.timeout, JSON.stringify(ack).slice(0, 200));
  await new Promise(r => setTimeout(r, 800));
  const d = JSON.parse((await row(`${NS}/postVotes/${P2}/${g.actor}`))?.data || '{}');
  check('Gun: committed through shared SQL transaction', d.envelope === JSON.stringify(g) && (await ledger(g.id)) === 1);
  const r = await post('/api/content-vote', { action: g });
  check('Gun then HTTP same action → duplicate, one ledger row', r.body?.status === 'duplicate' && (await ledger(g.id)) === 1, JSON.stringify(r.body));
}
{
  const actor = bytesToHex(schnorr.getPublicKey(Buffer.from(k2, 'hex')));
  const ack = await put(gun.get(`${NS}/postVotes`).get(P3).get(actor), { type: 'up', userId: actor, postId: P3, at: Date.now() });
  check('Gun: unsigned legacy vote rejected', !!ack.err, JSON.stringify(ack).slice(0, 200));
  await new Promise(r => setTimeout(r, 500));
  check('Gun: unsigned vote not stored', !(await row(`${NS}/postVotes/${P3}/${actor}`)));
  const wrong = act(k1, 'reaction', 'post', P3, 'up');
  const ack2 = await put(gun.get(`${NS}/postVotes`).get(P3).get(actor), { envelope: JSON.stringify(wrong) });
  check('Gun: envelope under another actor’s soul rejected', !!ack2.err, JSON.stringify(ack2).slice(0, 200));
}
{
  const conc = act(k2, 'reaction', 'post', P2, 'down');
  const [h, g] = await Promise.all([post('/api/content-vote', { action: conc }), put(gun.get(`${NS}/postVotes`).get(P2).get(conc.actor), { envelope: JSON.stringify(conc) })]);
  await new Promise(r => setTimeout(r, 800));
  check('concurrent HTTP + Gun (two processes, one DB) → one ledger row', (await ledger(conc.id)) === 1 && ['accepted', 'duplicate'].includes(h.body?.status) && !g.err, `${JSON.stringify(h.body)} ${JSON.stringify(g).slice(0, 120)}`);
}
{
  const reader = Gun({ peers: [GUN], localStorage: false, radisk: false, file: false, axe: false, multicast: false });
  await new Promise(r => setTimeout(r, 1000));
  const soulActor = bytesToHex(schnorr.getPublicKey(Buffer.from(k3, 'hex')));
  const v = await new Promise(res => { const t = setTimeout(() => res(null), 6000); reader.get(`${NS}/postVotes`).get(P2).get(soulActor).once(d => { clearTimeout(t); res(d); }); });
  check('Gun: fresh client reads signed envelope back', typeof v?.envelope === 'string' && JSON.parse(v.envelope).targetId === P2, JSON.stringify(v).slice(0, 160));
}
{
  const id = `post-e2e-${run}-fw`;
  const ack = await put(gun.get(`${NS}/posts`).get(id), { id, title: 'x', content: 'y', createdAt: Date.now(), dataVersion: 'v5' });
  check('content firewall still rejects unstamped new post', /content-pow-required|rate-limited/.test(String(ack.err)), JSON.stringify(ack).slice(0, 200));
}
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await db.end();
process.exit(failed.length ? 1 : 0);
