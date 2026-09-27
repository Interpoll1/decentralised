// Deterministic volume sweep of the unchanged analyzer (no database). Synthetic only.
// 8 "coordinated" accounts react up on post-0..4, 20 s apart per post, 0.5 s apart per
// account. Background accounts each react up on N distinct random posts at uniform random
// times across the window. Keys and randomness derive from the seed, so every run of a
// given (case, trial) produces byte-identical signed snapshots.
//
//   node tools/coordination-pilot/repro/sweep.mjs                 print the table
//   node tools/coordination-pilot/repro/sweep.mjs --write DIR     also save each snapshot
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { schnorr } from '@noble/curves/secp256k1.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { signAction } from '../../../shared-validation/engagement.js';
import { analyzeSnapshot } from '../../coordination-impact/core.mjs';
import { attest, publicKey, TIME } from '../../coordination-impact/fixtures.mjs';

export const CASES = [[10, 3], [20, 3], [30, 3], [40, 3], [50, 3], [56, 3], [56, 5], [192, 5]];
export const TRIALS = 3;
const COORDINATED = 8;
const posts = Array.from({ length: 20 }, (_, i) => `post-${i}`);
const sha = s => createHash('sha256').update(s).digest();
const pub = k => bytesToHex(schnorr.getPublicKey(hexToBytes(k)));

function rng(seed) { // mulberry32 seeded from sha256(seed)
  let a = sha(seed).readUInt32LE(0);
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function buildSnapshot(independent, perActor, trial) {
  const tag = `coordination-pilot-repro|${independent}x${perActor}|trial${trial}`;
  const rand = rng(tag);
  const keys = Array.from({ length: independent + COORDINATED }, (_, k) => bytesToHex(sha(`${tag}|key${k}`)));
  const obs = [];
  const add = (k, target, t, n) => obs.push({ action: signAction({ namespace: 'v5', actor: pub(keys[k]), kind: 'reaction',
    targetType: 'post', targetId: target, value: 'up', createdAt: TIME + t,
    nonce: sha(`${tag}|nonce${k}|${n}`).toString('hex').slice(0, 32) }, keys[k]), receivedAt: TIME + t });
  for (let k = 0; k < COORDINATED; k++) for (let j = 0; j < 5; j++) add(k, posts[j], -280000 + j * 20000 + k * 500, j);
  for (let k = COORDINATED; k < keys.length; k++) {
    const picked = new Set(); while (picked.size < perActor) picked.add(posts[Math.floor(rand() * 20)]);
    let n = 0; for (const p of picked) add(k, p, -290000 + Math.floor(rand() * 580000), n++);
  }
  const snapshot = attest({ version: 1, namespace: 'v5', targetType: 'post', from: TIME - 300000, to: TIME + 300000,
    observer: publicKey(9999), targets: posts.map(id => ({ id, visibility: 'public' })),
    observations: obs.sort((a, b) => a.receivedAt - b.receivedAt || (a.action.id < b.action.id ? -1 : 1)), signature: '' });
  return { snapshot, coordinated: keys.slice(0, COORDINATED).map(pub) };
}

export function summarize(snapshot, coordinated) {
  const r = analyzeSnapshot(snapshot, publicKey(9999));
  const clusters = r.receipt?.clusters ?? [];
  const flagged = new Set(clusters.flatMap(c => c.actors ?? []));
  const coord = new Set(coordinated);
  return { status: r.status, reason: r.reason ?? null, events: snapshot.observations.length, clusters: clusters.length,
    coordinatedFound: coordinated.filter(k => flagged.has(k)).length,
    otherFlagged: [...flagged].filter(k => !coord.has(k)).sort() };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = process.argv[2] === '--write' ? process.argv[3] : null;
  if (out) mkdirSync(out, { recursive: true });
  console.log('background x reactions each (+8 coordinated x5), trials 0-2: status events clusters coordFound/8 otherFlagged');
  for (const [n, per] of CASES) {
    const cells = [];
    for (let t = 0; t < TRIALS; t++) {
      const { snapshot, coordinated } = buildSnapshot(n, per, t);
      const s = summarize(snapshot, coordinated);
      if (out) writeFileSync(`${out}/sweep-${n}x${per}-trial${t}.json`, JSON.stringify({ case: { background: n, perActor: per, trial: t },
        coordinated, expected: s, snapshot }));
      cells.push(`${s.status}${s.reason ? '/' + s.reason : ''} ev=${s.events} cl=${s.clusters} coord=${s.coordinatedFound} other=${s.otherFlagged.length}`);
    }
    console.log(`${n} x ${per} ->`, cells.join(' | '));
  }
}
