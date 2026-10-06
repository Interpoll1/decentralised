import { displayedReaction } from '../shared-validation/engagement-tally.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as security from '../gun-relay/security-utils.js';
import { schnorr } from '@noble/curves/secp256k1.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { signAction, verifyAction, reactionSoul, actionForSoul, compareActions } from '../shared-validation/engagement.js';
import { acceptAction, acceptGunAction, pruneEngagementHistory } from '../shared-validation/engagement-store.js';
import { handleEngagement, readActionBody } from '../shared-validation/engagement-http.js';
import { installEngagementFirewall, isReactionIndexLink } from '../shared-validation/engagement-gun.js';

const key = '01'.padStart(64, '0'); // Synthetic test fixture, never an account.
const actor = bytesToHex(schnorr.getPublicKey(hexToBytes(key)));
const now = 1800000000000;
let nonce = 0;
function action(extra = {}) {
  return signAction({ namespace: 'v5', kind: 'reaction', actor, targetType: 'post', targetId: 'post-local',
    value: 'up', createdAt: now, nonce: (++nonce).toString(16).padStart(32, '0'), ...extra }, key);
}

// Deterministic transaction double, not a claim about a deployed MySQL engine.
// Serial lock models FOR UPDATE; snapshot rollback models InnoDB transactions.
function database(snapshot) {
  let state = snapshot || { nodes: new Map(), events: new Map(), views: new Map() };
  let tail = Promise.resolve();
  const db = {
    fail: '', state: () => structuredClone(state),
    async execute(sql, p) {
      if (sql.startsWith('SELECT data')) return [[...(state.nodes.has(p[0]) ? [{ data: state.nodes.get(p[0]) }] : [])]];
      if (sql.startsWith('DELETE FROM engagement')) { for (const [id, e] of state.events) if (e.at < p[0]) state.events.delete(id); return [{}]; }
      if (sql.startsWith('UPDATE search_index')) return [{}];
      throw new Error('Unexpected top-level SQL');
    },
    async getConnection() {
      let release, work;
      return {
        async beginTransaction() {
          const previous = tail; tail = new Promise(r => { release = r; });
          await previous; work = structuredClone(state);
        },
        async execute(sql, p) {
          if (db.fail && sql.startsWith(db.fail)) throw new Error('synthetic storage failure');
          if (sql.startsWith('INSERT IGNORE INTO gun_nodes')) { if (!work.nodes.has(p[0])) work.nodes.set(p[0], p[1]); return [{}]; }
          if (sql.startsWith('SELECT data')) return [[{ data: work.nodes.get(p[0]) }]];
          if (sql.startsWith('INSERT IGNORE INTO engagement')) {
            const exists = work.events.has(p[0]); if (!exists) work.events.set(p[0], { at: p[5], payload: p[6] });
            return [{ affectedRows: exists ? 0 : 1 }];
          }
          if (sql.startsWith('UPDATE gun_nodes')) { work.nodes.set(p[1], p[0]); return [{}]; }
          if (sql.startsWith('INSERT IGNORE INTO post_views')) {
            const id = JSON.stringify([p[0], p[2]]); const exists = work.views.has(id);
            if (!exists) work.views.set(id, p); return [{ affectedRows: exists ? 0 : 1 }];
          }
          throw new Error(`Unexpected SQL ${sql}`);
        },
        async commit() { if (db.fail === 'COMMIT') throw new Error('synthetic commit failure'); state = work; },
        async rollback() {}, release() { release?.(); },
      };
    },
  };
  return db;
}

test('correct signature, subject, namespace, and historical verification', () => {
  const a = action(); assert.equal(verifyAction(a, { now }), true);
  assert.equal(verifyAction(a, { now, actor: '00'.repeat(32) }), false);
  assert.equal(verifyAction(a, { now, namespace: 'v4' }), false);
  assert.equal(verifyAction(a, { now: now + 300001 }), false);
  assert.equal(verifyAction(a, { now: now - 30001 }), false);
  assert.equal(verifyAction(a, { now: now + 300000 }), true);
  assert.equal(verifyAction(a, { fresh: false }), true);
});
for (const field of ['version', 'namespace', 'kind', 'actor', 'targetType', 'targetId', 'value', 'createdAt', 'nonce', 'id', 'signature']) {
  test(`tampering ${field} fails closed`, () => {
    const a = action(); assert.equal(verifyAction({ ...a, [field]: typeof a[field] === 'number' ? a[field] + 1 : 'altered' }, { now }), false);
    const missing = { ...a }; delete missing[field]; assert.equal(verifyAction(missing, { now }), false);
  });
}
test('no extra fields, no unsigned or self-authorized alternate actor', () => {
  const a = action(); assert.equal(verifyAction({ ...a, verified: true }, { now }), false);
  assert.throws(() => action({ actor: '00'.repeat(32) }));
  assert.equal(actionForSoul(reactionSoul(a, 'v4'), JSON.stringify(a), 'v5', { now }), null);
  assert.equal(actionForSoul(reactionSoul(a, 'v5'), JSON.stringify(a), 'v5', { now }).id, a.id);
});
test('64 identical concurrent HTTP/Gun consumers: one committed observation', async () => {
  const db = database(), a = action();
  const r = await Promise.all(Array.from({ length: 64 }, (_, i) => (i % 2 ? acceptAction : acceptGunAction)(db, a, 'v5', now)));
  assert.equal(r.filter(x => x.status === 'accepted').length, 1);
  assert.equal(db.state().events.size, 1); assert.equal(db.state().nodes.size, 1);
});
test('competing actions converge to documented signed ordering; stale stays stale after reopen', async () => {
  const db = database(), old = action(), newer = action({ createdAt: now + 1, value: 'down' });
  await acceptAction(db, newer, 'v5', now);
  const reopened = database(db.state());
  await assert.rejects(acceptAction(reopened, old, 'v5', now), /STALE/);
  assert.deepEqual(reopened.state(), db.state());
  assert.ok(compareActions(newer, old) > 0);
});
for (const fail of ['UPDATE gun_nodes', 'INSERT IGNORE INTO engagement', 'COMMIT']) {
  test(`failure at ${fail}: no reaction or detector event committed; retry succeeds`, async () => {
    const db = database(), a = action(), before = db.state(); db.fail = fail;
    await assert.rejects(acceptAction(db, a, 'v5', now)); assert.deepEqual(db.state(), before);
    db.fail = ''; assert.equal((await acceptAction(db, a, 'v5', now)).status, 'accepted');
  });
}
test('failed signature leaves storage byte-equivalent', async () => {
  const db = database(), before = db.state(); await assert.rejects(acceptAction(db, { ...action(), signature: '00'.repeat(64) }, 'v5', now));
  assert.deepEqual(db.state(), before);
});
test('unsigned legacy Gun clock does not inherit authority', async () => {
  const a = action();
  const db = database({ nodes: new Map([[reactionSoul(a, 'v5'), JSON.stringify({ type: 'up', gunState: now + 99999999 })]]), events: new Map(), views: new Map() });
  assert.equal((await acceptAction(db, a, 'v5', now)).gunState, now);
});
test('view signatures cannot manufacture duplicate observations; server supplies observation time', async () => {
  const db = database(), a = action({ kind: 'view', value: 'view', createdAt: now - 20 });
  const b = action({ kind: 'view', value: 'view' });
  assert.equal((await acceptAction(db, a, 'v5', now)).status, 'accepted');
  assert.equal((await acceptAction(db, b, 'v5', now)).status, 'duplicate');
  assert.equal(db.state().events.size, 1); assert.equal([...db.state().views.values()][0][3], now);
});
test('history cleanup does not reopen stale writes; expired current cache is read-only', async () => {
  const db = database(), a = action(); await acceptAction(db, a, 'v5', now);
  await pruneEngagementHistory(db, now + 600001); assert.equal(db.state().events.size, 0);
  await assert.rejects(acceptAction(db, a, 'v5', now + 600001));
  assert.equal((await acceptGunAction(db, a, 'v5', now + 600001)).status, 'duplicate');
  assert.equal(db.state().events.size, 0);
  await assert.rejects(acceptGunAction(db, action(), 'v5', now + 600001), /STALE/);
});
async function http(body, views = false, db = database()) {
  const req = new EventEmitter(); req.headers = { authorization: 'Bearer arbitrary-client-text' };
  const res = { headersSent: false, status: 0, body: '', writeHead(n) { this.status = n; this.headersSent = true; }, end(s) { this.body = JSON.parse(s); } };
  const run = handleEngagement(req, res, { db, namespace: 'v5', now, views });
  req.emit('data', Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))); req.emit('end'); await run;
  return { res, db };
}
test('old unsigned content-vote is rejected with no write', async () => {
  const { res, db } = await http({ userId: 'somebody', postId: 'post-local', type: 'up' });
  assert.equal(res.status, 422); assert.equal(db.state().nodes.size, 0);
});
test('old arbitrary Bearer views rejected; accepted signed reaction responds with exact evidence', async () => {
  assert.equal((await http({ views: [{ id: 'post-local', type: 'post' }] }, true)).res.status, 422);
  const a = action(), { res } = await http({ action: a });
  assert.deepEqual(res.body, { id: a.id, status: 'accepted' });
});
test('views invalid JSON/oversize/multibyte bounds reject without callback throw', async () => {
  assert.equal((await http('{', true)).res.status, 400);
  assert.equal((await http('null', true)).res.status, 400);
  assert.equal((await http(JSON.stringify({ padding: 'x'.repeat(34000) }), true)).res.status, 413);
  assert.equal((await http(JSON.stringify({ padding: 'СЏ'.repeat(17000) }), true)).res.status, 413);
});
test('aborted parser resolves instead of hanging', async () => {
  const req = new EventEmitter(), res = { writeHead() {}, end() {} };
  const run = readActionBody(req, res); req.emit('aborted'); assert.equal(await run, null);
});
test('view batch rejects mixed invalid input before committing; retry uses same IDs', async () => {
  const a = action({ kind: 'view', value: 'view' });
  const bad = await http({ actions: [a, { ...a, signature: null }] }, true);
  assert.equal(bad.res.status, 422); assert.equal(bad.db.state().events.size, 0);
  const good = await http({ actions: [a] }, true);
  const retry = await http({ actions: [a] }, true, good.db);
  assert.deepEqual(retry.res.body.results, [{ id: a.id, status: 'duplicate' }]);
});
test('canonical directory links cannot redirect a reaction leaf', () => {
  assert.ok(isReactionIndexLink({ '#': 'v5/postVotes', '.': 'post-local', ':': { '#': 'v5/postVotes/post-local' } }, 'v5'));
  assert.equal(isReactionIndexLink({ '#': 'v5/postVotes', '.': 'post-local', ':': { '#': 'v5/postVotes/elsewhere' } }, 'v5'), false);
});
test('mixed-case target cannot alias a different signed context in case-insensitive MySQL', () => {
  assert.throws(() => action({ targetId: 'Post-local' }), /IDENTITY_MISMATCH|INVALID/);
});
test('equal client timestamps use a durable increasing relay Gun clock', async () => {
  const db = database(), pair = [action(), action()].sort(compareActions);
  const a = await acceptAction(db, pair[0], 'v5', now);
  const b = await acceptAction(db, pair[1], 'v5', now);
  assert.ok(b.gunState > a.gunState);
});

// Execute the actual request callback without importing its server startup.
const ts = createRequire(import.meta.url)('typescript');
const routeSource = readFileSync(new URL('../relay-server/routes.js', import.meta.url), 'utf8');
const tree = ts.createSourceFile('routes.js', routeSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const registration = tree.statements.find(n => ts.isExpressionStatement(n) && ts.isCallExpression(n.expression)
  && n.expression.expression.getText(tree) === 'server.on' && n.expression.arguments[0]?.text === 'request');
const callback = registration.expression.arguments[1].getText(tree).replaceAll('import.meta.url', '"file:///offline/routes.js"');
async function realRoute(path, body) {
  const db = database();
  const route = vm.runInNewContext(`(${callback})`, { ...security, URL, PORT: 1, NAMESPACE: 'v5', db,
    rateLimiter: { checkHttp: () => ({ allowed: true }) }, getHttpRateLimitContext: () => ({ bucketId: 'local', limit: 10 }),
    handleEngagement: (req, res, options) => handleEngagement(req, res, { ...options, now }),
  });
  const req = Object.assign(new EventEmitter(), { method: 'POST', url: path, headers: { host: 'offline.invalid' }, socket: {} });
  const res = { status: 0, body: '', setHeader() {}, writeHead(n) { this.status = n; }, end(s) { this.body = s; } };
  const run = route(req, res);
  req.emit('data', Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))); req.emit('end'); await run;
  return { res, db };
}
test('actual content-vote route: old unsigned payload rejected; signed payload committed', async () => {
  const bad = await realRoute('/api/content-vote', { userId: actor, postId: 'post-local', type: 'up' });
  assert.equal(bad.res.status, 422); assert.equal(bad.db.state().events.size, 0);
  const good = await realRoute('/api/content-vote', { action: action() });
  assert.equal(good.res.status, 200); assert.equal(good.db.state().events.size, 1);
});
test('actual views route: malformed and oversized body no longer throw; signed view accepted', async () => {
  assert.equal((await realRoute('/api/views', '{')).res.status, 400);
  assert.equal((await realRoute('/api/views', JSON.stringify({ padding: 'x'.repeat(34000) }))).res.status, 413);
  assert.equal((await realRoute('/api/views', { actions: [action({ kind: 'view', value: 'view' })] })).res.status, 200);
});
test('production wiring closes raw ACK and admin-write bypass, installs firewall before Gun constructor', () => {
  const s = readFileSync(new URL('../gun-relay/gun-relay-enhanced.js', import.meta.url), 'utf8');
  assert.ok(s.indexOf('installEngagementFirewall(Gun,') < s.indexOf('const gun = Gun('));
  assert.ok(s.includes('!Object.keys(m.put).some(protectedReactionSoul)'));
  assert.ok(s.includes("if (protectedReactionSoul(soul)) return res.status(422)"));
  assert.ok(s.includes("if (protectedReactionSoul(soul) && soul.split('/').length >= 4) return;"));
});
test('moving Gun admission earlier preserves its existing moderation veto before SQL', async () => {
  const s = readFileSync(new URL('../gun-relay/gun-relay-enhanced.js', import.meta.url), 'utf8');
  const sf = ts.createSourceFile('gun.js', s, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const source = sf.statements.find(n => n.name?.text === 'acceptReactionForGun').getText(sf);
  let writes = 0, blocked = true;
  const accept = vm.runInNewContext(`(${source})`, { reactionSoul, NAMESPACE: 'v5', dbConnected: true, db: {},
    moderation: { checkWrite: async () => blocked }, acceptGunAction: async () => { writes++; return { status: 'accepted' }; },
  });
  await assert.rejects(accept(action()), /BLOCKED/); assert.equal(writes, 0);
  blocked = false; await accept(action()); assert.equal(writes, 1);
});
test('real Gun core: unsigned graph never stored/forwarded; valid write; stale cache and false timestamps', async () => {
  const Gun = createRequire(import.meta.url)('gun/gun');
  const db = database();
  const liveNow = Date.now();
  installEngagementFirewall(Gun, { namespace: 'v5', accept: a => acceptGunAction(db, a, 'v5', liveNow) });
  const gun = Gun({ peers: [], localStorage: false, radisk: false }); const root = gun._.root;
  const forwarded = [];
  root.on('out', function(m) { if (m.put) forwarded.push(m); this.to.next(m); });
  const a = action({ createdAt: liveNow - 1 }); const soul = reactionSoul(a, 'v5');
  function send(id, fields) {
    root.on('in', { '#': id, put: { [soul]: { _: { '#': soul, '>': Object.fromEntries(Object.keys(fields).map(f => [f, liveNow + 86400000])) }, ...fields } } });
  }
  try {
    send('unsigned', { type: 'up' }); await new Promise(r => setTimeout(r, 30));
    assert.equal(root.graph[soul], undefined); assert.equal(forwarded.length, 0);
    send('valid', { envelope: JSON.stringify(a) }); await new Promise(r => setTimeout(r, 50));
    assert.equal(root.graph[soul]?.envelope, JSON.stringify(a));
    assert.equal(root.graph[soul]._['>'].envelope, liveNow);
    assert.equal(db.state().events.size, 1);
    const old = action({ createdAt: liveNow - 2 }); send('stale', { envelope: JSON.stringify(old) });
    await new Promise(r => setTimeout(r, 40)); assert.equal(root.graph[soul].envelope, JSON.stringify(a));
    const n = forwarded.length; send('bad-sibling', { envelope: JSON.stringify(a), type: 'down' });
    await new Promise(r => setTimeout(r, 30)); assert.equal(forwarded.length, n);
  } finally { clearTimeout(root.dup.to); gun.off(); }
});


test('display tally uses signed envelope, rejects sibling substitution and wrong persisted actor', () => {
  const a = action(); const row = { soul: reactionSoul(a, 'v5'), data: JSON.stringify({ envelope: JSON.stringify(a), type: 'down' }) };
  assert.equal(displayedReaction(row, 'v5').vote, 'up');
  assert.equal(displayedReaction({ ...row, soul: row.soul + '0' }, 'v5'), null);
  assert.equal(displayedReaction({ ...row, data: JSON.stringify({ envelope: '{}', type: 'up' }) }, 'v5'), null);
});
test('legacy display stays explicitly unverified and cannot authorize detector input', () => {
  const a = action(); const raw = { type: 'up' };
  const read = displayedReaction({ soul: reactionSoul(a, 'v5'), data: JSON.stringify(raw) }, 'v5');
  assert.equal(read.evidence, 'legacy-unverified'); assert.equal(verifyAction(raw), false);
});
test('actual vote-tally route counts envelope-only upgraded rows and labels aggregate compatibility', async () => {
  const a = action();
  const route = vm.runInNewContext(`(${callback})`, { ...security, URL, PORT: 1, NAMESPACE: 'v5', db: {},
    displayedReaction, queryMySQL: async sql => sql.includes('LIKE') ? [{ soul: reactionSoul(a, 'v5'), data: JSON.stringify({ envelope: JSON.stringify(a) }) }] : [],
    rateLimiter: { checkHttp: () => ({ allowed: true }) }, getHttpRateLimitContext: () => ({ bucketId: 'local', limit: 10 }),
  });
  const req = { method: 'GET', url: '/api/vote-tally?ids=post-local', headers: { host: 'offline.invalid' }, socket: {} };
  const res = { status: 0, body: '', setHeader() {}, writeHead(n) { this.status = n; }, end(s) { this.body = s; } };
  await route(req, res); assert.equal(res.status, 200);
  const result = JSON.parse(res.body);
  assert.equal(result.tallies['post-local'].upvotes, 1);
  assert.equal(result.evidence, 'legacy-inclusive-unverified');
});
