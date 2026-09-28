import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyzeSnapshot, verifyReceipt, analyzePartition, canonical, POLICY, POLICY_DIGEST } from './core.mjs';
import { analyzeSnapshot as analyzeV1 } from '../coordination-impact/core.mjs';
import { snapshot, observation, publicKey, demo, attest } from '../coordination-impact/fixtures.mjs';
import { generate } from './fixtures.mjs';

const observer = publicKey(9999), run = s => analyzeSnapshot(s, observer);
const fixture = demo(), clone = value => structuredClone(value);
const planted = r => new Set(r.receipt?.clusters.flatMap(c => c.actors) ?? []);
const saved = name => JSON.parse(readFileSync(new URL(`../coordination-pilot/repro/inputs/${name}.json`, import.meta.url)));
function withBackground(s, count = 12) {
  const changed = clone(s);
  changed.targets.push({ id: 'background', visibility: 'public' });
  for (let i = 0; i < count; i++) changed.observations.push(observation(1000 + i, 'background', 'up', 200000, i));
  return attest(changed);
}

test('five actors on three targets remain supported and receipt is explicitly v2', () => {
  const r = run(fixture);
  assert.equal(r.status, 'REVIEW_CANDIDATES');
  assert.equal(r.receipt.version, 2); assert.equal(r.receipt.policyDigest, POLICY_DIGEST);
  assert.equal(r.receipt.clusters.length, 1); assert.equal(r.receipt.clusters[0].actors.length, 5);
  assert.equal(r.receipt.clusters[0].edges.length, 10);
  assert.equal(r.receipt.humanOrBot, 'undetermined'); assert.equal(r.receipt.action, 'review-only');
  assert.equal(verifyReceipt(fixture, observer, r.receipt).status, 'VERIFIED_RELATIVE_TO_SNAPSHOT');
});

for (const name of ['sweep-30x3-trial2', 'sweep-40x3-trial1', 'sweep-56x5-trial1']) {
  test(`saved regression ${name}: exact planted group without background accounts`, () => {
    const s = saved(name), result = run(s.snapshot);
    assert.equal(result.status, 'REVIEW_CANDIDATES');
    assert.deepEqual([...planted(result)].sort(), [...s.coordinated].sort());
    assert.equal(result.receipt.clusters.length, 1);
    const old = analyzeV1(s.snapshot, observer);
    assert.ok([...planted(old)].some(a => !s.coordinated.includes(a)), 'negative control must exercise v1 issue');
  });
}

test('three-member groups are detected with five repeats; weaker evidence requests context', () => {
  const strong = generate({ seed: 'three-member-boundary', groupSizes: [3], sharedTargets: 5 });
  const weak = generate({ seed: 'three-member-boundary', groupSizes: [3], sharedTargets: 4 });
  assert.deepEqual([...planted(run(strong.snapshot))].sort(), strong.planted.sort());
  const r = run(weak.snapshot);
  assert.equal(r.status, 'CONTEXT_REQUIRED'); assert.equal(r.receipt.clusters.length, 0);
  assert.ok(r.receipt.weakPatternCount > 0);
});

test('a connecting path alone cannot turn sparse coincidences into a review group', () => {
  const all = [];
  for (let t = 0; t < 3; t++) for (let actor = 1; actor <= 7; actor++)
    all.push(observation(actor, `post-${t}`, 'up', (actor - 1) * 30000, t));
  const r = run(snapshot(all, ['post-0', 'post-1', 'post-2']));
  assert.equal(r.status, 'CONTEXT_REQUIRED'); assert.equal(r.receipt.clusters.length, 0);
});

test('fixed 60-second edge boundary remains exact', () => {
  const all = gap => Array.from({ length: 3 }, (_, t) => Array.from({ length: 5 }, (_, a) =>
    observation(a + 1, `post-${t}`, 'up', a === 4 ? gap : 0, t))).flat();
  assert.equal(run(withBackground(snapshot(all(60000), ['post-0', 'post-1', 'post-2']))).status, 'REVIEW_CANDIDATES');
  assert.equal(run(withBackground(snapshot(all(60001), ['post-0', 'post-1', 'post-2']))).status, 'CONTEXT_REQUIRED');
});

test('unrelated activity no longer hides a repeated group', () => {
  const s = generate({ seed: 'coverage-miss-test', background: 56, unrelated: 5 });
  assert.equal(analyzeV1(s.snapshot, observer).status, 'REVIEW_CANDIDATES');
  assert.deepEqual([...planted(run(s.snapshot))].sort(), s.planted.sort());
});

test('sample-wide organic burst requests context without naming a candidate group', () => {
  const s = generate({ seed: 'organic-control-test', groupSizes: [], background: 8, perBackground: 3, pattern: 'burst' });
  const r = run(s.snapshot); assert.equal(r.status, 'CONTEXT_REQUIRED');
  assert.equal(r.receipt.clusters.length, 0); assert.equal(r.receipt.broadContexts.length, 3);
  assert.equal(r.receipt.humanOrBot, 'undetermined');
  assert.equal(verifyReceipt(s.snapshot, observer, r.receipt).status, 'VERIFIED_RELATIVE_TO_SNAPSHOT');
});

test('extra shared activity in seven members cannot erase the eighth repeated participant', () => {
  const all = [], ids = Array.from({ length: 7 }, (_, i) => `post-${i}`);
  for (let t = 0; t < 7; t++) for (let actor = 1; actor <= (t < 5 ? 8 : 7); actor++)
    all.push(observation(actor, ids[t], 'up', t * 1000, t));
  const input = withBackground(snapshot(all, ids)), result = run(input);
  assert.equal(result.status, 'REVIEW_CANDIDATES');
  assert.deepEqual([...planted(result)].sort(), Array.from({ length: 8 }, (_, i) => publicKey(i + 1)).sort());
  assert.ok(result.receipt.clusters.some(c => c.actors.length === 8 && c.witnesses.length === 5));
  assert.ok(result.receipt.overlappingActors > 0);
  assert.equal(verifyReceipt(input, observer, result.receipt).status, 'VERIFIED_RELATIVE_TO_SNAPSHOT');
});

test('observer authority, snapshot signature and action authentication remain necessary', () => {
  assert.equal(analyzeSnapshot(fixture, publicKey(9998)).reason, 'OBSERVER_AUTHORITY');
  const badSnapshot = clone(fixture); badSnapshot.signature = '00'.repeat(64);
  assert.equal(run(badSnapshot).reason, 'SNAPSHOT_SIGNATURE');
  const badAction = clone(fixture); badAction.observations[0].action.signature = '00'.repeat(64);
  assert.equal(run(attest(badAction)).reason, 'ACTION_AUTHENTICATION');
  const stale = clone(fixture); stale.observations[0] = observation(1, 'post-0', 'up', -250000, 111);
  stale.observations[0].receivedAt = stale.from + 400000;
  assert.equal(run(attest(stale)).reason, 'ACTION_AUTHENTICATION');
  const wrongNamespace = clone(fixture); wrongNamespace.namespace = 'v6';
  assert.equal(run(attest(wrongNamespace)).reason, 'ACTION_AUTHENTICATION');
});

test('tampered support, witnesses, context, impact and v1 receipts are rejected', () => {
  const original = run(fixture).receipt;
  const changes = [r => r.clusters[0].support++, r => r.contextRequired = !r.contextRequired,
    r => r.clusters[0].witnesses[0].spanMs++,
    r => r.clusters[0].edges[0].evidence[0].gapMs++, r => r.clusters[0].actors.pop(),
    r => r.clusters[0].impact[0].afterScore++, r => r.policyDigest = '00'.repeat(32)];
  for (const change of changes) {
    const bad = clone(original); change(bad);
    assert.equal(verifyReceipt(fixture, observer, bad).status, 'RECEIPT_MISMATCH');
  }
  assert.equal(verifyReceipt(fixture, observer, analyzeV1(fixture, observer).receipt).status, 'RECEIPT_MISMATCH');
});

test('reordered input and exact duplicate observations preserve results', () => {
  const reordered = clone(fixture); reordered.observations.reverse(); reordered.targets.reverse();
  assert.equal(canonical(run(attest(reordered)).receipt), canonical(run(fixture).receipt));
  const duplicate = clone(fixture); duplicate.observations.push(clone(duplicate.observations[0]));
  const r = run(attest(duplicate)).receipt;
  assert.equal(r.uniqueObservations, fixture.observations.length);
  assert.equal(canonical(r.clusters), canonical(run(fixture).receipt.clusters));
  duplicate.observations.at(-1).receivedAt++;
  assert.equal(run(attest(duplicate)).reason, 'CONFLICTING_OBSERVATION');
});

test('latest clears suppress support and counterfactual removal never revives old reactions', () => {
  const changed = clone(fixture);
  for (let t = 0; t < 3; t++) changed.observations.push(observation(5, `post-${t}`, 'none', 10000, 99 + t));
  assert.equal(run(attest(changed)).receipt.clusters.length, 0);
  const withOld = clone(fixture);
  withOld.observations.push(observation(1, 'post-0', 'down', -10000, 100));
  const r = run(attest(withOld));
  const impact = r.receipt.clusters[0].impact.find(t => t.targetId === 'post-0');
  assert.equal(impact.beforeScore, 5); assert.equal(impact.afterScore, 0); assert.equal(impact.removedEventIds.length, 5);
});

test('opposite directions do not create qualifying edges', () => {
  const all = [];
  for (let t = 0; t < 3; t++) for (let actor = 1; actor <= 10; actor++)
    all.push(observation(actor, `post-${t}`, actor <= 5 ? 'up' : 'down', 0, t));
  const r = run(snapshot(all, ['post-0', 'post-1', 'post-2']));
  assert.equal(r.receipt.clusters.length, 2); assert.equal(r.receipt.baseline[0].score, 0);
  assert.ok(r.receipt.clusters.every(c => c.actors.length === 5));
});

test('input, global actor and dense edge caps refuse without partial receipts', () => {
  const tooMany = clone(fixture); tooMany.observations = Array(1001).fill(tooMany.observations[0]);
  assert.equal(run(tooMany).reason, 'EVENT_BUDGET');
  const actors = snapshot(Array.from({ length: 257 }, (_, i) => observation(i + 1, 'post-0')), ['post-0']);
  const ar = run(actors); assert.equal(ar.reason, 'ACTOR_BUDGET'); assert.equal(ar.receipt, undefined);
  const all = [];
  for (let t = 0; t < 3; t++) for (let actor = 1; actor <= 65; actor++) all.push(observation(actor, `post-${t}`, 'up', 0, t));
  const dense = run(withBackground(snapshot(all, ['post-0', 'post-1', 'post-2']), 65));
  assert.equal(dense.reason, 'EDGE_BUDGET'); assert.equal(dense.receipt, undefined);
  assert.equal(POLICY.maxEvents, 1000);
});

test('valid signed empty input has an explicit no-pattern receipt', () => {
  const r = run(snapshot([], ['post-0'])); assert.equal(r.status, 'NO_PATTERN');
  assert.equal(r.receipt.activeActors, 0); assert.equal(r.receipt.clusters.length, 0);
});

test('fresh public fixtures reproduce exact signed input bytes from the same seed', () => {
  const config = { seed: 'reproducibility-control', groupSizes: [5], sharedTargets: 3, background: 2, perBackground: 3 };
  assert.equal(JSON.stringify(generate(config)), JSON.stringify(generate(config)));
});

test('an isolated bridge no longer joins two dense groups', () => {
  const all = [], offsets = [0, 0, 0, 0, 50000, 70000, 120000, 120000, 120000, 120000];
  for (let t = 0; t < 3; t++) for (let a = 0; a < 10; a++)
    all.push(observation(a + 1, `post-${t}`, 'up', offsets[a], t));
  const r = run(snapshot(all, ['post-0', 'post-1', 'post-2']));
  assert.equal(r.receipt.clusters.length, 2);
  assert.ok(r.receipt.clusters.every(c => c.actors.length === 5 && c.edges.length === 10));
  assert.equal(r.receipt.humanOrBot, 'undetermined');
});

test('too many independent supported cohorts fail closed', () => {
  const groups = [], ids = [];
  for (let g = 0; g < 33; g++) for (let t = 0; t < 3; t++) {
    const id = `group-${g}-post-${t}`; ids.push(id);
    for (let a = 1; a <= 5; a++) groups.push(observation(g * 5 + a, id, 'up', 0, t));
  }
  const many = run(snapshot(groups, ids));
  assert.equal(many.reason, 'CLUSTER_BUDGET'); assert.equal(many.receipt, undefined);
});

test('a single verification partition is explicitly incomplete, never a trusted receipt', () => {
  const a = analyzePartition(fixture, observer, 0), b = analyzePartition(fixture, observer, 1);
  assert.equal(a.status, 'PARTITION_ONLY'); assert.equal(b.status, 'PARTITION_ONLY');
  assert.equal(a.receipt, undefined); assert.equal(b.receipt, undefined);
  assert.equal(a.draftDigest, b.draftDigest);
  assert.equal(a.checkedActions + b.checkedActions, fixture.observations.length);
  assert.equal(analyzePartition(fixture, observer, 2).reason, 'PARTITION');
});

test('different extra targets in every subgroup cannot hide their larger shared cohort', () => {
  const all = [], ids = ['post-0', 'post-1', 'post-2'];
  for (const id of ids) for (let actor = 1; actor <= 5; actor++) all.push(observation(actor, id, 'up', 0, ids.indexOf(id)));
  let sequence = 10;
  for (let a = 1; a <= 5; a++) for (let b = a + 1; b <= 5; b++) for (let c = b + 1; c <= 5; c++) {
    const id = `extra-${sequence}`; ids.push(id);
    for (const actor of [a, b, c]) all.push(observation(actor, id, 'up', 150000, sequence));
    sequence++;
  }
  const r = run(withBackground(snapshot(all, ids)));
  assert.equal(r.status, 'REVIEW_CANDIDATES'); assert.equal(r.receipt.clusters.length, 1);
  assert.equal(r.receipt.clusters[0].actors.length, 5); assert.equal(r.receipt.clusters[0].witnesses.length, 3);
});

test('a discarded overlap cannot suppress a separate supported cohort', () => {
  const all = [], ids = [];
  const groups = [{ members: [1, 6, 7], repeats: 5 }, { members: [1, 2, 3, 4, 5], repeats: 4 },
    { members: [3, 4, 5, 8, 9], repeats: 5 }];
  for (let g = 0; g < groups.length; g++) for (let t = 0; t < groups[g].repeats; t++) {
    const id = `overlap-${g}-${t}`; ids.push(id);
    for (const a of groups[g].members) all.push(observation(a, id, 'up', -200000 + g * 120000 + t * 1000, g * 10 + t));
  }
  const r = run(snapshot(all, ids));
  const independent = [1, 6, 7].map(publicKey).sort();
  assert.ok(r.receipt.clusters.some(c => canonical(c.actors) === canonical(independent)));
});
