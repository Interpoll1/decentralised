// Synthetic local exporter attacks only. Keys below are public test constants.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { schnorr } from '@noble/curves/secp256k1.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { signAction } from '../../shared-validation/engagement.js';
import { canonical, digest, snapshotDigest, analyzeSnapshot } from '../coordination-impact/core.mjs';
import { demo, observation, publicKey, TIME } from '../coordination-impact/fixtures.mjs';
import { buildExport, verifyExport, reviewDigest } from './export.mjs';

const SECRET = (9999).toString(16).padStart(64, '0');
const NOW = TIME + 1000;
const clone = value => structuredClone(value);
const communityId = 'pilot-community';
const observedCommunityHash = 'ab'.repeat(32);
const observedHash = index => (index + 1).toString(16).padStart(64, '0');
const seed = demo();
const metadata = (soul, dataHash, id, parent = null) => ({
  soul, dataHash, id, communityId: parent, isPrivate: false, isEncrypted: false,
  deleted: false, isDeleted: false, encrypted: false,
});
const reviewPin = m => digest(['interpoll.coordination-pilot-target-review.v1', {
  soul: m.soul, id: m.id, communityId: m.communityId,
  isPrivate: m.isPrivate ?? false, isEncrypted: m.isEncrypted ?? false,
  deleted: m.deleted ?? false, isDeleted: m.isDeleted ?? false, encrypted: m.encrypted,
}]);
const rowFor = ({ action, receivedAt }) => ({
  id: action.id, actor: action.actor, kind: action.kind, target_type: action.targetType,
  target_id: action.targetId, received_at: receivedAt, payload: JSON.stringify(action),
});
const policyFor = count => ({
  version: 1, scope: 'operator-reviewed-public-posts', relayId: 'synthetic-relay-1',
  namespace: 'v5', observer: publicKey(9999), validFrom: NOW - 3600000, validUntil: NOW + 3600000,
  targets: Array.from({ length: count }, (_, i) => ({
    id: `post-${i}`, communityId,
    postReviewHash: reviewPin(metadata(`v5/posts/post-${i}`, observedHash(i), `post-${i}`, communityId)),
    communityReviewHash: reviewPin(metadata(`v5/communities/${communityId}`, observedCommunityHash, communityId)),
  })),
});
function input(count = 4) {
  const policy = policyFor(count);
  return {
    capture: { readAt: NOW, rows: count === 4 ? seed.observations.map(rowFor) : [], metadata: [
      ...policy.targets.map((target, index) => metadata(`v5/posts/${target.id}`, observedHash(index), target.id, communityId)),
      metadata(`v5/communities/${communityId}`, observedCommunityHash, communityId),
    ] },
    policy, expectedPolicyDigest: digest(policy), secretKey: SECRET, now: NOW,
  };
}
const repin = arg => { arg.expectedPolicyDigest = digest(arg.policy); return arg; };
const build = () => buildExport(input());
const verify = (bundle, now = NOW) => verifyExport(bundle, digest(policyFor(4)), { now });
function rejectBuild(change, { pin = false } = {}) {
  const arg = input();
  change(arg);
  if (pin) repin(arg);
  assert.throws(() => buildExport(arg));
}
function signedAction(changes = {}, actorNumber = 1) {
  const original = seed.observations[0].action;
  const { id, signature, ...payload } = original;
  return signAction({ ...payload, ...changes }, actorNumber.toString(16).padStart(64, '0'));
}
function replaceAction(arg, action, receivedAt = NOW) {
  arg.capture.rows = [rowFor({ action, receivedAt })];
}
function signDigest(value, key = SECRET) {
  return bytesToHex(schnorr.sign(hexToBytes(value), hexToBytes(key), new Uint8Array(32)));
}
function resign(bundle, { snapshot = true, snapshotKey = SECRET } = {}) {
  if (snapshot) bundle.snapshot.signature = signDigest(snapshotDigest(bundle.snapshot), snapshotKey);
  bundle.manifest.snapshotHash = digest(bundle.snapshot);
  bundle.signature = signDigest(digest(['interpoll.coordination-pilot-export.v1', bundle.manifest]));
  return bundle;
}

test('approved committed sample exports without mutating input and replays under the external pin', () => {
  const arg = input(), before = canonical(arg), bundle = buildExport(arg);
  assert.equal(canonical(arg), before);
  assert.equal(bundle.version, 1);
  assert.deepEqual(bundle.policy, arg.policy);
  assert.equal(bundle.manifest.policyDigest, arg.expectedPolicyDigest);
  assert.equal(bundle.manifest.snapshotHash, digest(bundle.snapshot));
  assert.equal(bundle.manifest.relayId, arg.policy.relayId);
  assert.equal(bundle.manifest.readAt, NOW);
  assert.equal(bundle.manifest.from, NOW - 600000);
  assert.equal(bundle.manifest.to, NOW);
  assert.equal(bundle.manifest.coverage, 'retained-committed-sample');
  assert.equal(bundle.manifest.completeness, 'not-established');
  assert.equal(bundle.manifest.receiptTime, 'relay-admission-clock-before-commit');
  assert.ok(schnorr.verify(hexToBytes(bundle.signature),
    hexToBytes(digest(['interpoll.coordination-pilot-export.v1', bundle.manifest])),
    hexToBytes(arg.policy.observer)));
  assert.equal(bundle.snapshot.observations.length, seed.observations.length);
  assert.deepEqual(bundle.snapshot.targets.map(x => x.id).sort(), arg.policy.targets.map(x => x.id).sort());
  assert.ok(bundle.snapshot.targets.every(x => x.visibility === 'public'));
  assert.deepEqual(verify(bundle), { policy: bundle.policy, snapshot: bundle.snapshot });
  // Positive control proves later re-sign attacks have valid independent signatures.
  const independentlySigned = resign(clone(bundle));
  assert.deepEqual(verify(independentlySigned), {
    policy: independentlySigned.policy, snapshot: independentlySigned.snapshot,
  });
  assert.equal(analyzeSnapshot(bundle.snapshot, arg.policy.observer).status, 'REVIEW_CANDIDATES');
});

test('empty approved window remains a signed sample, without a completeness or humanity claim', () => {
  const arg = input(); arg.capture.rows = [];
  const bundle = buildExport(arg), { snapshot } = verify(bundle);
  assert.equal(snapshot.observations.length, 0);
  const result = analyzeSnapshot(snapshot, arg.policy.observer);
  assert.equal(result.status, 'NO_PATTERN');
  assert.equal(result.receipt.humanOrBot, 'undetermined');
  assert.equal(bundle.manifest.completeness, 'not-established');
});

test('up, down and none transitions survive export as exact signed envelopes', () => {
  const arg = input();
  const events = ['up', 'down', 'none'].map((value, index) => observation(1, 'post-0', value, index * 100, 100 + index));
  arg.capture.rows = events.map(rowFor);
  const bundle = buildExport(arg);
  const actual = new Map(verify(bundle).snapshot.observations.map(o => [o.action.id, o]));
  for (const event of events) assert.deepEqual(actual.get(event.action.id), event);
});

test('both window endpoints are included, but one millisecond outside either endpoint rejects', () => {
  const arg = input();
  const events = [observation(1, 'post-0', 'up', -599000, 71), observation(2, 'post-0', 'down', 1000, 72)];
  arg.capture.rows = events.map(rowFor);
  assert.equal(buildExport(arg).snapshot.observations.length, 2);
  for (const offset of [-599001, 1001]) {
    const bad = input(); bad.capture.rows = [rowFor(observation(1, 'post-0', 'up', offset, 74))];
    assert.throws(() => buildExport(bad));
  }
});

test('freshness is evaluated at stored receipt time, not merely at readAt', () => {
  rejectBuild(arg => replaceAction(arg, signedAction({ createdAt: NOW - 300001 }), NOW));
  rejectBuild(arg => replaceAction(arg, signedAction({ createdAt: NOW + 30001 }), NOW));
});

for (const [field, bad] of [
  ['id', 'ef'.repeat(32)], ['actor', publicKey(88)], ['kind', 'view'],
  ['target_type', 'comment'], ['target_id', 'post-1'],
]) test(`ledger ${field} must equal its signed envelope`, () => {
  rejectBuild(arg => { arg.capture.rows[0][field] = bad; });
});

test('invalid actor signature is rejected even with matching row columns', () => {
  rejectBuild(arg => {
    const action = JSON.parse(arg.capture.rows[0].payload); action.signature = '00'.repeat(64);
    arg.capture.rows[0].payload = JSON.stringify(action);
  });
});

for (const [name, changes] of [
  ['unapproved post', { targetId: 'unapproved-post' }],
  ['other namespace', { namespace: 'v6' }],
  ['view action', { kind: 'view', value: 'view' }],
  ['comment reaction', { targetType: 'comment' }],
]) test(`valid actor signature cannot authorize ${name}`, () => {
  rejectBuild(arg => replaceAction(arg, signedAction(changes)));
});

test('duplicate ledger IDs, including exact duplicates, refuse the whole export', () => {
  for (const delta of [0, 1]) rejectBuild(arg => {
    const duplicate = clone(arg.capture.rows[0]); duplicate.received_at += delta;
    arg.capture.rows.push(duplicate);
  });
});

for (const target of ['post', 'community']) {
  const index = target === 'post' ? 0 : 4;
  for (const flag of ['isPrivate', 'isEncrypted', 'deleted', 'isDeleted', 'encrypted']) {
    test(`${target} explicit ${flag} state prevents export`, () => {
      rejectBuild(arg => { arg.capture.metadata[index][flag] = true; });
    });
  }
  test(`${target} missing, duplicated or malformed observed record prevents export`, () => {
    rejectBuild(arg => { arg.capture.metadata.splice(index, 1); });
    rejectBuild(arg => { arg.capture.metadata.push(clone(arg.capture.metadata[index])); });
    rejectBuild(arg => { arg.capture.metadata[index].dataHash = 'not-a-sha256'; });
  });
  test(`${target} metadata identity and namespace must match the approved root`, () => {
    rejectBuild(arg => { arg.capture.metadata[index].id = 'different-id'; });
    rejectBuild(arg => { arg.capture.metadata[index].soul = arg.capture.metadata[index].soul.replace('v5/', 'v6/'); });
  });
}

test('null privacy flags are acceptable only under an independently pinned policy', () => {
  const arg = input();
  for (const m of arg.capture.metadata) for (const key of ['isPrivate', 'isEncrypted', 'deleted', 'isDeleted']) m[key] = null;
  assert.equal(buildExport(arg).snapshot.observations.length, 19);
  arg.expectedPolicyDigest = undefined;
  assert.throws(() => buildExport(arg));
});

test('review pins bind reviewed identity/linkage/privacy, excluding mutable raw-data hashes', () => {
  const arg = input();
  for (const record of arg.capture.metadata) assert.equal(reviewDigest(record), reviewPin(record));
  for (const [index, record] of arg.capture.metadata.entries()) {
    const originalPin = reviewDigest(record);
    // A changed full DB digest can represent tally/member-counter updates. The
    // bounded projection intentionally contains no content or counter fields.
    record.dataHash = (400 + index).toString(16).padStart(64, '0');
    assert.equal(reviewDigest(record), originalPin);
  }
  const bundle = buildExport(arg);
  assert.deepEqual(verify(bundle).snapshot, bundle.snapshot);
  assert.deepEqual(bundle.manifest.records.map(r => r.dataHash).sort(),
    arg.capture.metadata.map(r => r.dataHash).sort());
  const record = clone(arg.capture.metadata[0]);
  for (const key of ['isPrivate', 'isEncrypted', 'deleted', 'isDeleted']) record[key] = null;
  assert.equal(reviewDigest(record), reviewPin(arg.capture.metadata[0]));
  for (const change of [
    r => { r.id = 'other-id'; }, r => { r.communityId = 'other-community'; },
    r => { r.soul = 'v6/posts/post-0'; }, r => { r.isPrivate = true; },
    r => { r.isEncrypted = true; }, r => { r.deleted = true; },
    r => { r.isDeleted = true; }, r => { r.encrypted = true; },
  ]) {
    const changed = clone(record); change(changed);
    assert.notEqual(reviewDigest(changed), reviewDigest(record));
  }
});

test('an independently approved but different review pin cannot authorize the current metadata', () => {
  rejectBuild(arg => { arg.policy.targets[0].postReviewHash = 'cd'.repeat(32); }, { pin: true });
  rejectBuild(arg => {
    for (const target of arg.policy.targets) target.communityReviewHash = 'cd'.repeat(32);
  }, { pin: true });
});

test('encrypted projection requires explicit boolean false; missing/string/numeric flags fail closed', () => {
  for (const bad of [null, undefined, 'false', 0, 1]) rejectBuild(arg => { arg.capture.metadata[0].encrypted = bad; });
  for (const bad of ['false', '0', 0, {}, []]) rejectBuild(arg => { arg.capture.metadata[0].isPrivate = bad; });
});

test('post-to-community linkage and community root must exactly match policy', () => {
  rejectBuild(arg => { arg.capture.metadata[0].communityId = 'other-community'; });
  rejectBuild(arg => { arg.capture.metadata[0].communityId = null; });
  rejectBuild(arg => { arg.capture.metadata[4].communityId = 'nested-community'; });
});

test('unrelated metadata and unprojected content are rejected, not carried into a bundle', () => {
  rejectBuild(arg => { arg.capture.metadata.push(metadata('v5/posts/private-unrelated', 'aa'.repeat(32), 'private-unrelated', communityId)); });
  rejectBuild(arg => { arg.capture.metadata[0].body = 'never export post bodies'; });
});

for (const field of ['version', 'scope', 'relayId', 'namespace', 'observer', 'validFrom', 'validUntil', 'targets']) {
  test(`policy cannot omit ${field}, even if its altered bytes are independently pinned`, () => {
    rejectBuild(arg => { delete arg.policy[field]; }, { pin: true });
  });
}

test('policy exact schema, identifiers, scope and validity limits are enforced after pin verification', () => {
  for (const change of [
    p => { p.extra = true; }, p => { p.version = 2; }, p => { p.scope = 'all-public-content'; },
    p => { p.relayId = ''; }, p => { p.namespace = 'other'; }, p => { p.observer = '00'; },
    p => { p.validFrom = NOW + 1; }, p => { p.validUntil = NOW - 1; },
    p => { p.validUntil = p.validFrom + 86400001; }, p => { p.validUntil = p.validFrom; },
    p => { p.targets[0].postReviewHash = 'not-a-digest'; }, p => { p.targets[0].extra = true; },
    p => { p.targets[0].id = '../private'; }, p => { p.targets[0].communityId = ''; },
    p => { p.targets.push(clone(p.targets[0])); },
  ]) rejectBuild(arg => change(arg.policy), { pin: true });
});

test('the complete inclusive sample window must fall within the approved policy interval', () => {
  rejectBuild(arg => { arg.policy.validFrom = NOW - 599999; }, { pin: true });
});

test('policy requires one through twenty approved targets, including valid empty samples', () => {
  assert.equal(buildExport(input(20)).snapshot.targets.length, 20);
  assert.throws(() => buildExport(input(21)));
  assert.throws(() => buildExport(input(0)));
});

test('no embedded policy or observer key can replace external authority', () => {
  for (const pin of [undefined, null, '', '00'.repeat(32), 'bad']) {
    rejectBuild(arg => { arg.expectedPolicyDigest = pin; });
    assert.throws(() => verifyExport(build(), pin, { now: NOW }));
  }
  rejectBuild(arg => { arg.secretKey = (88).toString(16).padStart(64, '0'); });
  const bundle = build();
  assert.throws(() => verify(bundle, input().policy.validUntil + 1));
});

test('unsafe BIGINTs and malformed receipt/read clocks cannot round into an accepted window', () => {
  for (const bad of [Number.MAX_SAFE_INTEGER + 1, '9007199254740993', -1, null, 1.5, NaN]) {
    rejectBuild(arg => { arg.capture.rows[0].received_at = bad; });
    rejectBuild(arg => { arg.capture.readAt = bad; });
  }
  for (const offset of [-30001, 30001]) rejectBuild(arg => {
    arg.capture.rows = []; // Isolate clock freshness from observation-window rejection.
    arg.capture.readAt = NOW + offset;
  });
});

test('malformed, oversized or non-string ledger payloads are rejected as a whole', () => {
  for (const bad of ['{', null, {}, [], 'null']) rejectBuild(arg => { arg.capture.rows[0].payload = bad; });
  const arg = input(), payload = arg.capture.rows[0].payload;
  arg.capture.rows[0].payload = payload.padEnd(2048, ' ');
  assert.equal(buildExport(arg).snapshot.observations.length, 19);
  arg.capture.rows[0].payload += ' ';
  assert.throws(() => buildExport(arg));
});

test('1000 valid unique actions are admitted; 1001 refuses instead of truncating the sample', () => {
  const arg = input();
  const rows = Array.from({ length: 1001 }, (_, i) => rowFor(observation(1, 'post-0', i % 2 ? 'none' : 'up', i, 1000 + i)));
  arg.capture.rows = rows.slice(0, 1000);
  assert.equal(buildExport(arg).snapshot.observations.length, 1000);
  arg.capture.rows = rows;
  assert.throws(() => buildExport(arg));
});

test('unsigned bundle, policy, manifest and snapshot modifications all reject', () => {
  const original = build();
  for (const change of [
    b => { b.version = 2; }, b => { b.signature = '00'.repeat(64); },
    b => { b.policy.relayId = 'other-relay'; }, b => { b.manifest.readAt++; },
    b => { b.manifest.records[0].dataHash = '00'.repeat(32); },
    b => { b.snapshot.observations.pop(); }, b => { b.snapshot.signature = '00'.repeat(64); },
  ]) {
    const bad = clone(original); change(bad); assert.throws(() => verify(bad));
  }
});

test('a valid observer signature does not authorize misleading coverage or a different relay', () => {
  for (const change of [
    m => { m.coverage = 'complete-ledger'; }, m => { m.completeness = 'established'; },
    m => { m.receiptTime = 'transaction-commit-time'; }, m => { m.relayId = 'other-relay'; },
    m => { m.policyDigest = '00'.repeat(32); }, m => { m.from++; },
  ]) {
    const bad = build(); change(bad.manifest); resign(bad, { snapshot: false });
    assert.throws(() => verify(bad));
  }
});

test('re-signed metadata still undergoes privacy, digest shape and community-link validation', () => {
  for (const change of [
    m => { m.isPrivate = true; }, m => { m.encrypted = true; }, m => { m.deleted = true; },
    m => { m.dataHash = 'not-a-sha256'; }, m => { m.id = 'wrong-id'; },
  ]) {
    const bad = build(); change(bad.manifest.records[0]); resign(bad, { snapshot: false });
    assert.throws(() => verify(bad));
  }
  const bad = build();
  bad.manifest.records.find(m => m.soul.includes('/posts/')).communityId = 'wrong-community';
  resign(bad, { snapshot: false }); assert.throws(() => verify(bad));
});

test('otherwise valid empty snapshots cannot bypass pinned post, target or namespace context', () => {
  for (const change of [
    s => { s.targetType = 'comment'; }, s => { s.namespace = 'v6'; },
    s => { s.targets.push({ id: 'unapproved-post', visibility: 'public' }); },
  ]) {
    const arg = input(); arg.capture.rows = [];
    const bad = buildExport(arg); change(bad.snapshot); resign(bad);
    assert.equal(analyzeSnapshot(bad.snapshot, publicKey(9999)).status, 'NO_PATTERN');
    assert.throws(() => verify(bad));
  }
});

test('valid outer observer signature cannot hide an invalid actor envelope or conflicting receipt', () => {
  for (const change of [
    s => { s.observations[0].action.signature = '00'.repeat(64); },
    s => { const o = clone(s.observations[0]); o.receivedAt++; s.observations.push(o); },
  ]) {
    const bad = build(); change(bad.snapshot); resign(bad); assert.throws(() => verify(bad));
  }
});

test('a self-signed replacement snapshot observer is not the policy authority', () => {
  const bad = build(); bad.snapshot.observer = publicKey(88);
  resign(bad, { snapshotKey: (88).toString(16).padStart(64, '0') });
  assert.equal(analyzeSnapshot(bad.snapshot, publicKey(88)).status, 'REVIEW_CANDIDATES');
  assert.throws(() => verify(bad));
});
