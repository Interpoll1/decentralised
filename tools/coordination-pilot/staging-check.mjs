// Disposable real-MySQL check of the pilot exporter. Synthetic data only.
// DESTRUCTIVE to the target server: drops/creates database `pilotstage` and user
// `pilot_ro`. Run ONLY against a throwaway container, never a relay database:
//   docker run -d --rm --name pilot-mysql-check -e MYSQL_ROOT_PASSWORD=PW \
//     -p 127.0.0.1:33306:3306 mysql:8.0
//   node tools/coordination-pilot/staging-check.mjs 33306 PW WORKDIR
// The gun_nodes schema (soul PK + JSON text `data`) is assumed; confirm it against
// the real relay schema before treating a pass as staging evidence.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { randomBytes, createHash } from 'node:crypto';
import mysql from 'mysql2/promise';
import { schnorr } from '@noble/curves/secp256k1.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { signAction } from '../../shared-validation/engagement.js';
import { digest } from '../coordination-impact/core.mjs';
import { reviewDigest } from './export.mjs';

const [port, rootPw, work] = [Number(process.argv[2]), process.argv[3], process.argv[4]];
const DB = 'pilotstage', NS = 'v5';
const roPw = randomBytes(12).toString('hex');
const results = [];
const record = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

const root = await mysql.createConnection({ host: '127.0.0.1', port, user: 'root', password: rootPw, multipleStatements: true });
const [[{ v }]] = await root.query('SELECT VERSION() AS v');
console.log('MySQL', v);
await root.query(`DROP DATABASE IF EXISTS ${DB}; CREATE DATABASE ${DB}; USE ${DB};
CREATE TABLE engagement_actions_v1 (
  id CHAR(64) PRIMARY KEY, actor CHAR(64) NOT NULL, kind VARCHAR(16) NOT NULL,
  target_type VARCHAR(16) NOT NULL, target_id VARCHAR(128) NOT NULL,
  received_at BIGINT NOT NULL, payload TEXT NOT NULL,
  INDEX engagement_received_at (received_at)) ENGINE=InnoDB;
CREATE TABLE gun_nodes (soul VARCHAR(512) PRIMARY KEY, data LONGTEXT NOT NULL) ENGINE=InnoDB;
DROP USER IF EXISTS 'pilot_ro'@'%';
CREATE USER 'pilot_ro'@'%' IDENTIFIED BY '${roPw}';
GRANT SELECT ON ${DB}.engagement_actions_v1 TO 'pilot_ro'@'%';
GRANT SELECT ON ${DB}.gun_nodes TO 'pilot_ro'@'%';`);

// --- Seed synthetic graph records -------------------------------------------------
const community = 'pilot-community';
const posts = ['post-0', 'post-1', 'post-2', 'post-3'];
const node = (soul, obj) => ({ soul, data: JSON.stringify(obj) });
const nodes = [
  node(`${NS}/communities/${community}`, { id: community, name: 'Synthetic', isPrivate: false, memberCount: 3 }),
  ...posts.map(id => node(`${NS}/posts/${id}`, { id, communityId: community, title: 'synthetic body ' + id, upvotes: 0, isDeleted: false })),
];
for (const n of nodes) await root.query('INSERT INTO gun_nodes VALUES (?, ?)', [n.soul, n.data]);

const pinFor = soul => {
  const obj = JSON.parse(nodes.find(n => n.soul === soul).data);
  return reviewDigest({ soul, id: obj.id, communityId: obj.communityId ?? null, isPrivate: obj.isPrivate ?? false,
    isEncrypted: false, deleted: false, isDeleted: obj.isDeleted ?? false, encrypted: false,
    dataHash: createHash('sha256').update(nodes.find(n => n.soul === soul).data).digest('hex') });
};

// --- Seed signed reactions: 5 actors same direction on 3 posts within 60 s, plus 4 independent ---
const actors = Array.from({ length: 9 }, () => bytesToHex(schnorr.utils.randomSecretKey()));
const now = Date.now();
const actionRows = [];
const addAction = (actorIdx, targetId, receivedAt, value = 'up') => {
  const a = signAction({ namespace: NS, actor: bytesToHex(schnorr.getPublicKey(hexToBytes(actors[actorIdx]))), kind: 'reaction',
    targetType: 'post', targetId, value, createdAt: receivedAt - 50, nonce: randomBytes(16).toString('hex') }, actors[actorIdx]);
  actionRows.push([a.id, a.actor, a.kind, a.targetType, a.targetId, receivedAt, JSON.stringify(a)]);
};
for (let t = 0; t < 3; t++) for (let a = 0; a < 5; a++) addAction(a, posts[t], now - 240_000 + t * 1000 + a * 100);
for (let a = 5; a < 9; a++) addAction(a, 'post-3', now - 200_000 + a * 9000);
addAction(0, 'post-0', now - 30 * 60_000); // outside the 10-minute window: must be excluded
for (const r of actionRows) await root.query('INSERT INTO engagement_actions_v1 VALUES (?,?,?,?,?,?,?)', r);
const inWindow = actionRows.length - 1;

// --- Operator files (fresh key, not a fixture) --------------------------------------
mkdirSync(work, { recursive: true, mode: 0o700 });
const observerSecret = bytesToHex(schnorr.utils.randomSecretKey());
writeFileSync(`${work}/observer.key`, observerSecret, { mode: 0o600 });
const policy = (over = {}) => ({
  version: 1, scope: 'operator-reviewed-public-posts', relayId: 'local-staging-relay', namespace: NS,
  observer: bytesToHex(schnorr.getPublicKey(hexToBytes(observerSecret))),
  validFrom: now - 20 * 60_000, validUntil: now + 60 * 60_000,
  targets: posts.map(id => ({ id, communityId: community, postReviewHash: pinFor(`${NS}/posts/${id}`),
    communityReviewHash: pinFor(`${NS}/communities/${community}`) })), ...over,
});
const writePolicy = (p, name = 'policy.json') => { writeFileSync(`${work}/${name}`, JSON.stringify(p)); return digest(p); };
const cfg = (over = {}) => { const c = { host: '127.0.0.1', port, user: 'pilot_ro', password: roPw, database: DB, ...over };
  writeFileSync(`${work}/db.json`, JSON.stringify(c), { mode: 0o600 }); };

const cli = (...args) => {
  const t0 = process.hrtime.bigint();
  let out = '', code = 0;
  try { out = execFileSync(process.execPath, [new URL('./cli.mjs', import.meta.url).pathname, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { out = (e.stdout || '') + (e.stderr || ''); code = e.status; return { out, code, ms: Number(process.hrtime.bigint() - t0) / 1e6 }; }
  return { out, code, ms: Number(process.hrtime.bigint() - t0) / 1e6 };
};
const json = s => s.split('\n').filter(l => l.startsWith('{')).map(l => JSON.parse(l));
const outDir = name => { const d = `${work}/out-${name}`; rmSync(d, { recursive: true, force: true }); mkdirSync(d, { mode: 0o700 }); return d; };
const exportRun = (name, pol = policy(), dg) => {
  const d = writePolicy(pol); const o = outDir(name);
  const r = cli('export', `${work}/policy.json`, dg ?? d, `${work}/db.json`, `${work}/observer.key`, o);
  return { ...r, parsed: json(r.out), files: readdirSync(o).filter(f => !f.startsWith('.')), dir: o, digest: dg ?? d };
};

// 1. Privilege enforcement for the read-only account
{
  const ro = await mysql.createConnection({ host: '127.0.0.1', port, user: 'pilot_ro', password: roPw, database: DB });
  const [grants] = await ro.query('SHOW GRANTS');
  const attempts = {
    INSERT: "INSERT INTO gun_nodes VALUES ('x','{}')", UPDATE: "UPDATE gun_nodes SET data='{}'",
    DELETE: 'DELETE FROM engagement_actions_v1', CREATE: 'CREATE TABLE t (x int)', DROP: 'DROP TABLE gun_nodes',
    'SELECT other table': 'SELECT * FROM mysql.user',
  };
  const allowed = [];
  for (const [k, sql] of Object.entries(attempts)) { try { await ro.query(sql); allowed.push(k); } catch { /* denied as expected */ } }
  record('read-only account cannot write, alter or read other tables', allowed.length === 0,
    allowed.length ? 'ALLOWED: ' + allowed.join(',') : `${grants.length} grant rows, all SELECT`);
  await ro.end();
}

// 2. Happy path: export + run + replay against real server
cfg();
const happy = exportRun('happy');
const exp = happy.parsed.find(x => x.status);
record('export succeeds on real MySQL', exp?.status === 'EXPORTED_REVIEW_SAMPLE', `${exp?.observations} observations, ${happy.ms.toFixed(0)} ms`);
record('10-minute window: old row excluded', exp?.observations === inWindow, `expected ${inWindow}`);
const runOut = cli('run', `${happy.dir}/${happy.files[0]}`, happy.digest, happy.dir);
const runStatus = json(runOut.out)[0]?.status;
record('analysis flags the synchronized group', runStatus === 'REVIEW_CANDIDATES', `${runStatus}, ${runOut.ms.toFixed(0)} ms`);
const reportFile = readdirSync(happy.dir).find(f => f.includes('report'));
const report = JSON.parse(readFileSync(`${happy.dir}/${reportFile}`, 'utf8'));
record('independent replay verified', JSON.stringify(report).includes('VERIFIED_RELATIVE_TO_SNAPSHOT'));

// 3. No open transactions / locks left behind by the exporter
{
  const [trx] = await root.query("SELECT COUNT(*) AS n FROM information_schema.innodb_trx");
  record('no transaction left open after export', Number(trx[0].n) === 0);
}

// 4. Uncommitted concurrent write is excluded (consistent snapshot)
{
  const writer = await mysql.createConnection({ host: '127.0.0.1', port, user: 'root', password: rootPw, database: DB });
  await writer.beginTransaction();
  const before = actionRows.length; addAction(6, 'post-3', Date.now() - 5000);
  await writer.query('INSERT INTO engagement_actions_v1 VALUES (?,?,?,?,?,?,?)', actionRows[before]);
  const r = exportRun('uncommitted');
  const n = r.parsed.find(x => x.status)?.observations;
  record('uncommitted concurrent write excluded', n === inWindow, `got ${n}`);
  await writer.commit(); await writer.end();
  const r2 = exportRun('committed');
  record('same write included once committed', r2.parsed.find(x => x.status)?.observations === inWindow + 1);
}

// 5. Counter-only change keeps approval valid; privacy flip rejects
await root.query(`UPDATE ${DB}.gun_nodes SET data = JSON_SET(data, '$.upvotes', 42) WHERE soul = ?`, [`${NS}/posts/post-0`]);
{
  const r = exportRun('counter');
  record('counter-only change: approval still valid', r.parsed.find(x => x.status)?.status === 'EXPORTED_REVIEW_SAMPLE', r.out.trim().split('\n').pop());
}
await root.query(`UPDATE ${DB}.gun_nodes SET data = JSON_SET(data, '$.isPrivate', true) WHERE soul = ?`, [`${NS}/posts/post-1`]);
{
  const r = exportRun('private');
  record('post turned private: whole export refused, no artifact', r.code !== 0 && r.files.length === 0, json(r.out).map(x => x.reason).join(','));
}
await root.query(`UPDATE ${DB}.gun_nodes SET data = JSON_REMOVE(data, '$.isPrivate') WHERE soul = ?`, [`${NS}/posts/post-1`]);
await root.query(`UPDATE ${DB}.gun_nodes SET data = JSON_SET(data, '$.communityId', 'other') WHERE soul = ?`, [`${NS}/posts/post-2`]);
{
  const r = exportRun('relinked');
  record('post moved to another community: refused', r.code !== 0 && r.files.length === 0, json(r.out).map(x => x.reason).join(','));
}
await root.query(`UPDATE ${DB}.gun_nodes SET data = JSON_SET(data, '$.communityId', ?) WHERE soul = ?`, [community, `${NS}/posts/post-2`]);

// 6. Policy controls
{
  const r = exportRun('wrongdigest', policy(), 'ab'.repeat(32));
  record('wrong approved digest: refused', r.code !== 0 && r.files.length === 0, json(r.out).map(x => x.reason).join(','));
  const r2 = exportRun('expired', policy({ validFrom: now - 3 * 3600_000, validUntil: now - 3600_000 }));
  record('expired policy: refused', r2.code !== 0 && r2.files.length === 0, json(r2.out).map(x => x.reason).join(','));
  const r3 = exportRun('earlystart', policy({ validFrom: now - 60_000 }));
  record('policy starting inside window (backdating guard): refused', r3.code !== 0 && r3.files.length === 0, json(r3.out).map(x => x.reason).join(','));
}

// 7. Connection config controls
{
  cfg({ host: 'localhost' });
  const r = exportRun('localhost');
  record("host 'localhost' rejected", r.code !== 0 && r.out.includes('DB_LOCAL_ONLY'));
  cfg({ password: 'wrong' });
  const r2 = exportRun('badpw');
  record('bad password: generic error, no secret echoed', r2.code !== 0 && r2.out.includes('DB_CONNECT') && !r2.out.includes('pilot_ro'), json(r2.out).map(x => x.reason).join(','));
  cfg();
}

// 8. Missing privilege mid-capture → rollback, no partial artifact
await root.query(`REVOKE SELECT ON ${DB}.gun_nodes FROM 'pilot_ro'@'%'`);
{
  const r = exportRun('revoked');
  const [trx] = await root.query('SELECT COUNT(*) AS n FROM information_schema.innodb_trx');
  record('query failure mid-capture: no artifact, no open trx', r.code !== 0 && r.files.length === 0 && Number(trx[0].n) === 0, json(r.out).map(x => x.reason).join(','));
}
await root.query(`GRANT SELECT ON ${DB}.gun_nodes TO 'pilot_ro'@'%'`);

// 9. Overflow: >1000 in-window rows
{
  const conn = root; const t = Date.now() - 60_000; const batch = [];
  for (let i = 0; i < 1001; i++) batch.push([randomBytes(32).toString('hex'), randomBytes(32).toString('hex'), 'reaction', 'post', 'post-3', t + i, '{}']);
  await conn.query(`INSERT INTO ${DB}.engagement_actions_v1 VALUES ?`, [batch]);
  const r = exportRun('overflow');
  record('>1000 rows: whole export refused', r.code !== 0 && r.files.length === 0, json(r.out).map(x => x.reason).join(','));
}

await root.end();
const failed = results.filter(r => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exitCode = failed ? 1 : 0;
