import { schnorr } from '@noble/curves/secp256k1.js';
import { hexToBytes } from '@noble/hashes/utils.js';
import { verifyAction, compareActions } from '../../shared-validation/engagement.js';
import { canonical, digest, snapshotDigest } from '../coordination-impact/core.mjs';
import { POLICY } from './policy.mjs';
import { repeatedCohorts } from './relation.mjs';
export { canonical, digest } from '../coordination-impact/core.mjs';
export { POLICY } from './policy.mjs';

export const POLICY_DIGEST = digest(POLICY);
const check = (ok, reason) => { if (!ok) throw Error(reason); };
const hex = (s, n) => typeof s === 'string' && new RegExp('^[0-9a-f]{' + n + '}$').test(s);
const cmp = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const key = (...parts) => JSON.stringify(parts);
const failure = e => ({ status: 'CANNOT_ESTABLISH', reason:
  typeof e?.message === 'string' && /^[A-Z_]+$/.test(e.message) ? e.message : 'INVALID_INPUT' });

function rank(targets, latest, removed = new Set()) {
  const scores = new Map(targets.map(t => [t.id, 0]));
  for (const { action: a } of latest) if (!removed.has(a.actor))
    scores.set(a.targetId, scores.get(a.targetId) + (a.value === 'up' ? 1 : a.value === 'down' ? -1 : 0));
  return [...scores].map(([targetId, score]) => ({ targetId, score }))
    .sort((a, b) => b.score - a.score || cmp(a.targetId, b.targetId))
    .map((r, i) => ({ ...r, rank: i + 1 }));
}

// A partitioned invocation is internal to the fixed two-worker protocol. It
// cannot return a completed analysis. Public synchronous APIs check ALL actions.
function calculate(s, expectedObserver, partition) {
  check(Buffer.byteLength(canonical(s)) <= POLICY.maxInputBytes, 'INPUT_BUDGET');
  check(hex(expectedObserver, 64) && expectedObserver === s?.observer, 'OBSERVER_AUTHORITY');
  const inputDigest = snapshotDigest(s);
  check(hex(s.signature, 128) && schnorr.verify(hexToBytes(s.signature),
    hexToBytes(inputDigest), hexToBytes(expectedObserver)), 'SNAPSHOT_SIGNATURE');
  const targets = new Set(s.targets.map(t => t.id)), unique = new Map(), state = new Map();
  let checkedActions = 0;
  for (let i = 0; i < s.observations.length; i++) {
    const o = s.observations[i], a = o.action;
    check(a.kind === 'reaction' && targets.has(a.targetId), 'ACTION_AUTHENTICATION');
    if (partition === undefined || i % 2 === partition) {
      check(verifyAction(a, { now: o.receivedAt, namespace: s.namespace, targetType: s.targetType }), 'ACTION_AUTHENTICATION');
      checkedActions++;
    }
    if (unique.has(a.id)) {
      check(canonical(unique.get(a.id)) === canonical(o), 'CONFLICTING_OBSERVATION');
      continue;
    }
    unique.set(a.id, o);
    const cell = key(a.actor, a.targetId), previous = state.get(cell);
    if (!previous || compareActions(a, previous.action) > 0) state.set(cell, o);
  }
  const latest = [...state.values()].sort((a, b) => cmp(a.action.id, b.action.id));
  const relation = repeatedCohorts(latest, s.targets, POLICY), baseline = rank(s.targets, latest);
  const clusters = relation.clusters.map(group => {
    const removed = new Set(group.actors), after = new Map(rank(s.targets, latest, removed).map(r => [r.targetId, r]));
    return { id: digest(['interpoll.review-cluster.v2', POLICY_DIGEST, group.actors, group.witnesses]), ...group,
      impact: baseline.map(b => ({ targetId: b.targetId, beforeScore: b.score, afterScore: after.get(b.targetId).score,
        beforeRank: b.rank, afterRank: after.get(b.targetId).rank,
        removedEventIds: latest.filter(o => o.action.targetId === b.targetId && removed.has(o.action.actor)).map(o => o.action.id) })) };
  });
  const receipt = { version: 2, policy: POLICY.version, policyDigest: POLICY_DIGEST, inputDigest,
    observer: s.observer, namespace: s.namespace, targetType: s.targetType, from: s.from, to: s.to,
    scope: 'supplied-observer-attested-window', sourceTruth: 'not-independently-established', humanOrBot: 'undetermined',
    action: 'review-only', ranking: POLICY.ranking, relation: POLICY.relation,
    uniqueObservations: unique.size, latestReactions: latest.length, ...relation, baseline, clusters };
  check(Buffer.byteLength(canonical(receipt)) <= POLICY.maxReceiptBytes, 'RECEIPT_BUDGET');
  return { receipt, checkedActions, observationCount: s.observations.length };
}

export function analyzeSnapshot(snapshot, expectedObserver) {
  try {
    const { receipt } = calculate(snapshot, expectedObserver);
    return { status: receipt.clusters.length ? 'REVIEW_CANDIDATES' : receipt.contextRequired ? 'CONTEXT_REQUIRED' : 'NO_PATTERN', receipt };
  } catch (e) { return failure(e); }
}

export function verifyReceipt(snapshot, expectedObserver, receipt) {
  const actual = analyzeSnapshot(snapshot, expectedObserver);
  if (!actual.receipt) return actual;
  try { return canonical(actual.receipt) === canonical(receipt)
    ? { status: 'VERIFIED_RELATIVE_TO_SNAPSHOT' } : { status: 'RECEIPT_MISMATCH' }; }
  catch { return { status: 'RECEIPT_MISMATCH' }; }
}

// Internal worker fragment, deliberately NOT REVIEW_CANDIDATES/VERIFIED.
// No skip-auth option exists on analyzeSnapshot, verifyReceipt or the host.
// A draft must never be used without both independently authenticated partitions.
export function analyzePartition(snapshot, expectedObserver, partition) {
  try {
    check(partition === 0 || partition === 1, 'PARTITION');
    const { receipt: draftReceipt, checkedActions, observationCount } = calculate(snapshot, expectedObserver, partition);
    return { status: 'PARTITION_ONLY', partition, partitions: 2, checkedActions, observationCount,
      draftDigest: digest(draftReceipt), draftReceipt };
  } catch (e) { return failure(e); }
}
