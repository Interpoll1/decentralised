import test from 'node:test';
import assert from 'node:assert/strict';
import { readCapture } from './mysql-source.mjs';

const READ_AT = 1_800_000_000_000;
const policy = () => ({
  version: 1, scope: 'operator-reviewed-public-posts', namespace: 'v5',
  targets: [{ id: 'post-pilot', communityId: 'c-pilot', postReviewHash: 'c'.repeat(64), communityReviewHash: 'd'.repeat(64) }],
});
const row = (overrides = {}) => ({
  id: '1'.repeat(64), actor: '2'.repeat(64), kind: 'reaction', target_type: 'post', target_id: 'post-pilot',
  received_at: READ_AT, payload: '{}', ...overrides,
});
const node = (kind, overrides = {}) => ({
  soul: `v5/${kind}/${kind === 'posts' ? 'post-pilot' : 'c-pilot'}`,
  dataHash: (kind === 'posts' ? 'a' : 'b').repeat(64), documentType: 'OBJECT',
  id: kind === 'posts' ? 'post-pilot' : 'c-pilot', idType: 'STRING',
  communityId: kind === 'posts' ? 'c-pilot' : null, communityIdType: kind === 'posts' ? 'STRING' : null,
  isPrivate: null, isEncrypted: 'false', deleted: null, isDeleted: null, encrypted: 0, ...overrides,
});

function database(options = {}) {
  const calls = [];
  const connection = {
    calls,
    async query(config, values) {
      calls.push({ ...config, values });
      const sql = config.sql;
      if (options.fail && sql.includes(options.fail)) throw Object.assign(new Error('secret database details'), { code: options.failureCode ?? 'ER_TEST_SECRET' });
      if (sql === 'ROLLBACK' && options.rollbackFails) throw new Error('secret cleanup details');
      if (sql.includes('AS readAt')) return [options.clock ?? [{ readAt: READ_AT }], []];
      if (sql.includes('FROM engagement_actions_v1')) return [options.rows ?? [row()], []];
      if (sql.includes('FROM gun_nodes')) return [options.metadata ?? [node('communities'), node('posts')], []];
      return [{}, []];
    },
    end() { assert.fail('Caller-owned connection must not be closed'); },
    destroy() { assert.fail('Caller-owned connection must not be destroyed'); },
  };
  return connection;
}

test('one repeatable-read, consistent, read-only transaction uses DB time and rolls back', async () => {
  const db = database();
  const result = await readCapture(db, policy());
  assert.equal(result.readAt, READ_AT);
  assert.equal(result.rows.length, 1);
  assert.deepEqual(db.calls.slice(0, 2).map(x => x.sql), [
    'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ',
    'START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY',
  ]);
  assert.equal(db.calls.at(-1).sql, 'ROLLBACK');
  assert.equal(db.calls.length, 6);
  assert.ok(db.calls.every(x => x.timeout === 2000));
  assert.ok(db.calls.every(x => !/\b(COMMIT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i.test(x.sql)));
  assert.deepEqual(result.metadata[1], {
    soul: 'v5/posts/post-pilot', dataHash: 'a'.repeat(64), id: 'post-pilot', communityId: 'c-pilot',
    isPrivate: false, isEncrypted: false, deleted: false, isDeleted: false, encrypted: false,
  });
});

test('fixed inclusive ten-minute bounds and approved IDs are parameters, never SQL text', async () => {
  const db = database();
  await readCapture(db, policy());
  const ledger = db.calls.find(x => x.sql.includes('FROM engagement_actions_v1'));
  assert.deepEqual(ledger.values, [READ_AT - 600_000, READ_AT, 'post-pilot']);
  assert.match(ledger.sql, /received_at >= \? AND received_at <= \?/);
  assert.match(ledger.sql, /kind = 'reaction' AND target_type = 'post'/);
  assert.match(ledger.sql, /ORDER BY received_at, id LIMIT 1001/);
  assert.doesNotMatch(ledger.sql, /post-pilot|namespace\s*=/);
  const graph = db.calls.find(x => x.sql.includes('FROM gun_nodes'));
  assert.deepEqual(graph.values, ['v5/communities/c-pilot', 'v5/posts/post-pilot']);
  assert.doesNotMatch(graph.sql, /post-pilot|c-pilot/);
});

test('both boundaries are accepted and decimal BIGINT strings preserve exact values', async () => {
  const rows = [row({ received_at: String(READ_AT - 600_000) }), row({ id: '3'.repeat(64), received_at: String(READ_AT) })];
  const result = await readCapture(database({ rows, clock: [{ readAt: String(READ_AT) }] }), policy());
  assert.equal(result.readAt, READ_AT);
  assert.deepEqual(result.rows, rows);
});

test('payload and graph projections guard byte size, JSON validity and body transfer', async () => {
  const db = database();
  await readCapture(db, policy());
  const ledger = db.calls.find(x => x.sql.includes('FROM engagement_actions_v1')).sql;
  assert.match(ledger, /CASE WHEN OCTET_LENGTH\(payload\) <= 2048 THEN payload ELSE NULL END AS payload/);
  const graph = db.calls.find(x => x.sql.includes('FROM gun_nodes')).sql;
  assert.match(graph, /OCTET_LENGTH\(data\) <= 65536 THEN CASE WHEN JSON_VALID\(data\)/);
  assert.match(graph, /SHA2\(/);
  assert.match(graph, /MAX_EXECUTION_TIME\(2000\)/);
  assert.match(graph, /JSON_CONTAINS_PATH.*encryptedMeta.*encryptedContent.*encryptedData/s);
  assert.doesNotMatch(graph, /\bSELECT\s+\*|\bdata\s+AS\s+(?:body|data)\b/i);
});

test('1001 rows reject the whole capture without reading metadata', async () => {
  const db = database({ rows: Array(1001).fill(row()) });
  await assert.rejects(readCapture(db, policy()), { code: 'MYSQL_ROW_LIMIT' });
  assert.equal(db.calls.at(-1).sql, 'ROLLBACK');
  assert.ok(!db.calls.some(x => x.sql.includes('FROM gun_nodes')));
});

test('1000 distinct bounded rows are accepted', async () => {
  const rows = Array.from({ length: 1000 }, (_, i) => row({ id: i.toString(16).padStart(64, '0') }));
  assert.equal((await readCapture(database({ rows }), policy())).rows.length, 1000);
});

for (const payload of [null, 'a'.repeat(2049), 'é'.repeat(1025)]) {
  test(`oversized or withheld payload is rejected (${payload === null ? 'null' : Buffer.byteLength(payload)})`, async () => {
    const db = database({ rows: [row({ payload })] });
    await assert.rejects(readCapture(db, policy()), { code: 'MYSQL_PAYLOAD_LIMIT' });
    assert.equal(db.calls.at(-1).sql, 'ROLLBACK');
  });
}

for (const readAt of [null, -1, 599_999, 1.5, Number.MAX_SAFE_INTEGER + 1, '9007199254740993', '1e12', 'secret']) {
  test(`bad database clock fails closed (${String(readAt)})`, async () => {
    const db = database({ clock: [{ readAt }] });
    await assert.rejects(readCapture(db, policy()), { code: 'MYSQL_CLOCK_INVALID' });
    assert.equal(db.calls.at(-1).sql, 'ROLLBACK');
  });
}

test('outside-window, wrong type/target and duplicate ledger rows reject', async () => {
  for (const rows of [
    [row({ received_at: READ_AT - 600_001 })], [row({ received_at: READ_AT + 1 })],
    [row({ received_at: '9007199254740993' })], [row({ target_type: 'comment' })],
    [row({ kind: 'view' })], [row({ target_id: 'unapproved' })], [row(), row()],
  ]) await assert.rejects(readCapture(database({ rows }), policy()), /MYSQL_ROW_(TIME|CONTEXT)/);
});

test('explicit privacy/deletion/encrypted markers survive for exporter rejection', async () => {
  const metadata = [node('communities'), node('posts', {
    isPrivate: 'true', isEncrypted: true, deleted: 'true', isDeleted: true, encrypted: 1,
  })];
  const result = await readCapture(database({ metadata }), policy());
  for (const name of ['isPrivate', 'isEncrypted', 'deleted', 'isDeleted', 'encrypted']) assert.equal(result.metadata[1][name], true);
});

test('malformed metadata types, invalid/oversized JSON and unknown roots reject', async () => {
  for (const change of [
    { isPrivate: 'INVALID' }, { isEncrypted: 0 }, { deleted: {} }, { isDeleted: undefined },
    { encrypted: null }, { encrypted: '1' }, { documentType: null, dataHash: null },
    { documentType: 'ARRAY' }, { idType: 'INTEGER' }, { id: null },
    { communityIdType: 'OBJECT', communityId: null }, { communityIdType: 'STRING', communityId: null },
    { soul: 'v5/posts/unapproved' },
  ]) await assert.rejects(readCapture(database({ metadata: [node('communities'), node('posts', change)] }), policy()), { code: 'MYSQL_METADATA_SHAPE' });
});

test('metadata missing, duplicated or over 40 rows rejects', async () => {
  for (const [metadata, code] of [
    [[node('posts')], 'MYSQL_METADATA_MISSING'],
    [[node('posts'), node('posts')], 'MYSQL_METADATA_DUPLICATE'],
    [Array(41).fill(node('posts')), 'MYSQL_METADATA_LIMIT'],
  ]) await assert.rejects(readCapture(database({ metadata }), policy()), { code });
});

test('duplicate community is queried once for multiple approved posts', async () => {
  const p = policy();
  p.targets.push({ ...p.targets[0], id: 'post-two' });
  const db = database({ metadata: [node('communities'), node('posts'), node('posts', { soul: 'v5/posts/post-two', id: 'post-two' })] });
  await readCapture(db, p);
  assert.deepEqual(db.calls.find(x => x.sql.includes('FROM gun_nodes')).values, [
    'v5/communities/c-pilot', 'v5/posts/post-pilot', 'v5/posts/post-two',
  ]);
});

test('malformed policy fails before any SQL', async () => {
  for (const change of [
    p => { p.namespace = 'v5/other'; }, p => { p.targets[0].id = "post'); DELETE"; },
    p => { p.targets[0].communityId = '../private'; }, p => { p.targets[0].postReviewHash = 'invalid'; },
    p => { p.targets.push({ ...p.targets[0] }); }, p => { p.targets = []; },
    p => { p.targets = Array(21).fill(p.targets[0]); }, p => { p.scope = 'anything'; },
  ]) {
    const p = policy(); change(p); const db = database();
    await assert.rejects(readCapture(db, p), { code: 'MYSQL_POLICY_CONTEXT' });
    assert.equal(db.calls.length, 0);
  }
});

test('setup/query errors always attempt rollback and hide DB details', async () => {
  for (const at of ['SET TRANSACTION', 'START TRANSACTION', 'AS readAt', 'FROM engagement_actions_v1', 'FROM gun_nodes']) {
    const db = database({ fail: at });
    await assert.rejects(readCapture(db, policy()), { message: 'MYSQL_CAPTURE_FAILED', code: 'MYSQL_CAPTURE_FAILED' });
    assert.equal(db.calls.at(-1).sql, 'ROLLBACK');
  }
});

test('driver timeout attempts rollback; even a database error with a known code is sanitized', async () => {
  for (const [failureCode, code] of [
    ['PROTOCOL_SEQUENCE_TIMEOUT', 'MYSQL_CAPTURE_FAILED'],
    ['MYSQL_METADATA_SHAPE', 'MYSQL_METADATA_SHAPE'],
  ]) {
    const db = database({ fail: 'FROM gun_nodes', failureCode });
    await assert.rejects(readCapture(db, policy()), { message: code, code });
    assert.equal(db.calls.at(-1).sql, 'ROLLBACK');
  }
});

test('failed rollback never returns a successful capture or raw database message', async () => {
  const db = database({ rollbackFails: true });
  await assert.rejects(readCapture(db, policy()), { message: 'MYSQL_ROLLBACK_FAILED', code: 'MYSQL_ROLLBACK_FAILED' });
});
