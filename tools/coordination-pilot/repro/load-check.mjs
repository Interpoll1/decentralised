// Export load check at pilot limits against the staging table definitions. Synthetic only.
// Seeds 20 posts + 3 communities (shapes from postService/communityService), 100k filler
// gun_nodes, 20k stale reactions and 1,000 in-window signed reactions (200 accounts x 5,
// incl. one 8-account synchronized group), then times export + run three times.
// Randomized: the exact DB-run input is saved as inputs/db-export-1000.bundle.json.
// DESTRUCTIVE to the target server; use only a throwaway container:
//   docker run -d --rm --name pilot-stage-clone -e MYSQL_ROOT_PASSWORD=PW -e MYSQL_DATABASE=interpoll \
//     -p 127.0.0.1:33307:3306 mysql:8.0.46
//   docker exec -i pilot-stage-clone sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" interpoll' \
//     < tools/coordination-pilot/repro/inputs/staging-schema.sql
//   node tools/coordination-pilot/repro/load-check.mjs 33307 PW WORKDIR   (Linux: needs /usr/bin/time)
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import mysql from 'mysql2/promise';
import { schnorr } from '@noble/curves/secp256k1.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { signAction } from '../../../shared-validation/engagement.js';
import { digest } from '../../coordination-impact/core.mjs';
import { reviewDigest } from '../export.mjs';

const [port, rootPw, work] = [Number(process.argv[2]), process.argv[3], process.argv[4]];
const DB = 'interpoll', NS = 'v5';
const roPw = randomBytes(12).toString('hex');
const root = await mysql.createConnection({ host: '127.0.0.1', port, user: 'root', password: rootPw, database: DB, multipleStatements: true });
await root.query(`CREATE USER 'pilot_ro'@'%' IDENTIFIED BY '${roPw}';
GRANT SELECT ON ${DB}.engagement_actions_v1 TO 'pilot_ro'@'%'; GRANT SELECT ON ${DB}.gun_nodes TO 'pilot_ro'@'%';`);

const now = Date.now();
const lorem = n => 'Synthetic volunteer post body. '.repeat(n);
// Realistic record shapes from communityService.createCommunity / postService.createPost.
const communities = ['c-pilot-news', 'c-pilot-local', 'c-pilot-sports'];
const comm = id => ({ id, name: id.slice(2), displayName: id, description: lorem(5), creatorId: randomBytes(32).toString('hex'),
  createdAt: now - 864e5, memberCount: 40, postCount: 7, category: null, nsfw: false, isPrivate: false, dataVersion: NS });
const posts = Array.from({ length: 20 }, (_, i) => `post-${now - 3600e3 + i}-${randomBytes(5).toString('hex').slice(0, 9)}`);
const post = (id, i) => ({ id, communityId: communities[i % 3], authorId: randomBytes(32).toString('hex'), authorName: 'Anonymous',
  authorShowRealName: false, title: `Volunteer post ${i}`, content: lorem(40 + i * 20), createdAt: now - 3600e3, upvotes: 0,
  downvotes: 0, score: 0, commentCount: 0, dataVersion: NS });
const rows = [...communities.map(c => [`${NS}/communities/${c}`, JSON.stringify(comm(c))]),
  ...posts.map((p, i) => [`${NS}/posts/${p}`, JSON.stringify(post(p, i))])];
// Background graph volume so index/lookup behaviour is not measured on an empty table.
const FILLER = 100_000;
for (let b = 0; b < FILLER; b += 5000) {
  const batch = Array.from({ length: 5000 }, (_, k) => [`${NS}/posts/filler-${b + k}`, JSON.stringify({ id: `filler-${b + k}`, content: lorem(10) })]);
  await root.query('INSERT INTO gun_nodes (soul, data) VALUES ?', [batch]);
}
await root.query('INSERT INTO gun_nodes (soul, data) VALUES ?', [rows]);

// 1,000 signed reactions in-window (the pilot maximum): 200 actors × 5 posts, one 8-actor synchronized group.
const actorKeys = Array.from({ length: 200 }, () => bytesToHex(schnorr.utils.randomSecretKey()));
const actions = [];
const add = (k, target, receivedAt, value = 'up') => {
  const a = signAction({ namespace: NS, actor: bytesToHex(schnorr.getPublicKey(hexToBytes(actorKeys[k]))), kind: 'reaction',
    targetType: 'post', targetId: target, value, createdAt: receivedAt - 80, nonce: randomBytes(16).toString('hex') }, actorKeys[k]);
  actions.push([a.id, a.actor, a.kind, a.targetType, a.targetId, receivedAt, JSON.stringify(a)]);
};
for (let k = 0; k < 200; k++) for (let j = 0; j < 5; j++) {
  const coordinated = k < 8;
  const target = coordinated ? posts[j] : posts[(k * 7 + j * 3) % 20];
  const t = coordinated ? now - 300_000 + j * 20_000 + k * 500 : now - 560_000 + Math.floor(Math.random() * 540_000);
  add(k, target, t, coordinated || Math.random() < 0.8 ? 'up' : 'down');
}
// Out-of-window ledger rows awaiting pruning (other posts), 20k.
const stale = Array.from({ length: 20_000 }, (_, i) => [randomBytes(32).toString('hex'), randomBytes(32).toString('hex'), 'reaction', 'post',
  `post-old-${i % 500}`, now - 900_000 - i * 10, '{}']);
await root.query('INSERT INTO engagement_actions_v1 VALUES ?', [stale]);
for (let b = 0; b < actions.length; b += 500) await root.query('INSERT INTO engagement_actions_v1 VALUES ?', [actions.slice(b, b + 500)]);
await root.query('ANALYZE TABLE gun_nodes, engagement_actions_v1');
console.log(`seeded: ${FILLER + rows.length} gun_nodes, ${actions.length} in-window + ${stale.length} stale reactions`);

// Operator files
mkdirSync(work, { recursive: true, mode: 0o700 });
const secret = bytesToHex(schnorr.utils.randomSecretKey());
writeFileSync(`${work}/observer.key`, secret, { mode: 0o600 });
const [meta] = await root.query(`SELECT soul, data FROM gun_nodes WHERE soul IN (?)`, [rows.map(r => r[0])]);
const pin = soul => { const o = JSON.parse(meta.find(m => m.soul === soul).data);
  return reviewDigest({ soul, id: o.id, communityId: o.communityId ?? null, isPrivate: o.isPrivate ?? false, isEncrypted: false,
    deleted: false, isDeleted: false, encrypted: false }); };
const policy = { version: 1, scope: 'operator-reviewed-public-posts', relayId: 'staging-clone', namespace: NS,
  observer: bytesToHex(schnorr.getPublicKey(hexToBytes(secret))), validFrom: now - 20 * 60e3, validUntil: now + 60 * 60e3,
  targets: posts.map((p, i) => ({ id: p, communityId: communities[i % 3], postReviewHash: pin(`${NS}/posts/${p}`),
    communityReviewHash: pin(`${NS}/communities/${communities[i % 3]}`) })) };
writeFileSync(`${work}/policy.json`, JSON.stringify(policy));
writeFileSync(`${work}/db.json`, JSON.stringify({ host: '127.0.0.1', port, user: 'pilot_ro', password: roPw, database: DB }), { mode: 0o600 });
const dg = digest(policy);

// EXPLAIN the ledger query as the exporter issues it.
const [plan] = await root.query(`EXPLAIN SELECT id FROM engagement_actions_v1 WHERE kind='reaction' AND target_type='post'
  AND received_at >= ? AND received_at <= ? AND target_id IN (?) ORDER BY received_at, id LIMIT 1001`, [now - 600e3, now, posts]);
console.log('ledger plan:', plan.map(p => `${p.type} key=${p.key} rows=${p.rows} extra=${p.Extra}`).join(' | '));
await root.query('TRUNCATE performance_schema.events_statements_summary_by_digest');

// /usr/bin/time -v reports peak RSS and CPU; a non-zero exit (CANNOT_ESTABLISH) still returns output.
const runTimed = (label, args) => {
  const t0 = performance.now();
  const r = spawnSync('/usr/bin/time', ['-v', process.execPath, new URL('../cli.mjs', import.meta.url).pathname, ...args], { encoding: 'utf8' });
  return { label, ms: performance.now() - t0, out: (r.stdout || '') + (r.stderr || '') };
};
const stat = out => ({ rssMB: +(Number(out.match(/Maximum resident set size \(kbytes\): (\d+)/)?.[1]) / 1024).toFixed(1),
  cpu: out.match(/Percent of CPU this job got: (\S+)/)?.[1], user: out.match(/User time \(seconds\): (\S+)/)?.[1] });
const results = [];
for (let i = 1; i <= 3; i++) {
  const out = `${work}/out-${i}`; rmSync(out, { recursive: true, force: true }); mkdirSync(out, { mode: 0o700 });
  let e; try { e = runTimed('export', ['export', `${work}/policy.json`, dg, `${work}/db.json`, `${work}/observer.key`, out]); }
  catch (x) { e = { ms: 0, out: (x.stdout || '') + (x.stderr || '') }; }
  const ej = e.out.split('\n').find(l => l.startsWith('{'));
  const bundle = readdirSync(out).find(f => f.endsWith('.bundle.json'));
  let r = { ms: 0, out: '' }, rj;
  if (bundle) {
    try { r = runTimed('run', ['run', `${out}/${bundle}`, dg, out]); } catch (x) { r = { ms: 0, out: (x.stdout || '') + (x.stderr || '') }; }
    rj = r.out.split('\n').find(l => l.startsWith('{'));
  }
  const reportFile = readdirSync(out).find(f => f.endsWith('.report.json'));
  const report = reportFile ? JSON.parse(readFileSync(`${out}/${reportFile}`, 'utf8')) : null;
  results.push({ i, export: ej, exportMs: Math.round(e.ms), exportProc: stat(e.out), run: rj, runMs: Math.round(r.ms), runProc: stat(r.out),
    bundleKB: bundle ? Math.round(readFileSync(`${out}/${bundle}`).length / 1024) : null,
    replay: report ? JSON.stringify(report).includes('VERIFIED_RELATIVE_TO_SNAPSHOT') : null,
    reportKeys: report ? Object.keys(report) : null, reason: report?.reason ?? report?.code ?? null });
}
console.log(JSON.stringify(results, null, 1));
const [stmts] = await root.query(`SELECT LEFT(DIGEST_TEXT, 70) q, COUNT_STAR n, ROUND(AVG_TIMER_WAIT/1e9,2) avg_ms, ROUND(MAX_TIMER_WAIT/1e9,2) max_ms, SUM_ROWS_EXAMINED ex, SUM_ROWS_SENT sent
  FROM performance_schema.events_statements_summary_by_digest WHERE SCHEMA_NAME='${DB}' AND DIGEST_TEXT LIKE 'SELECT%' ORDER BY SUM_TIMER_WAIT DESC LIMIT 5`);
console.table(stmts);
await root.end();
