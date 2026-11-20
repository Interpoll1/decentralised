import { schnorr } from '@noble/curves/secp256k1.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { canonical, digest, snapshotDigest } from '../coordination-impact/core.mjs';
import { verifyAction } from '../../shared-validation/engagement.js';

export const DOMAIN = 'interpoll.coordination-pilot-export.v1';
export const REVIEW_DOMAIN = 'interpoll.coordination-pilot-target-review.v1';
export const LIMITS = Object.freeze({ targets: 20, events: 1000, payloadBytes: 2048,
  snapshotBytes: 1_048_576, bundleBytes: 2_097_152, policyBytes: 16_384,
  windowMs: 600_000, policyLifetimeMs: 86_400_000, clockSkewMs: 30_000 });
const check = (ok, code) => { if (!ok) throw new Error(code); };
const hex = (s, n) => typeof s === 'string' && new RegExp(`^[0-9a-f]{${n}}$`).test(s);
const id = s => typeof s === 'string' && /^[a-z0-9_.:-]{1,128}$/.test(s);
const integer = n => Number.isSafeInteger(n) && n >= 0;
const exact = (o, fields) => o && !Array.isArray(o) && typeof o === 'object'
  && Object.keys(o).length === fields.length && fields.every(k => Object.hasOwn(o, k));
const size = v => Buffer.byteLength(canonical(v), 'utf8');
const copy = v => JSON.parse(canonical(v));
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const rowFields = ['id', 'actor', 'kind', 'target_type', 'target_id', 'received_at', 'payload'];
const metadataFields = ['soul', 'dataHash', 'id', 'communityId', 'isPrivate', 'isEncrypted', 'deleted', 'isDeleted', 'encrypted'];
const manifestFields = ['version', 'policyDigest', 'snapshotHash', 'relayId', 'readAt', 'from', 'to', 'coverage', 'completeness', 'receiptTime', 'records'];

// Operator approval concerns target identity, linkage and public eligibility.
// Mutable bodies, counters, Gun clocks and the observed raw dataHash are excluded.
// Accept either the projection itself or a full metadata record; never include
// extra fields implicitly. SQL has already normalized missing flags to false.
export function reviewDigest(record) {
  check(record && typeof record === 'object' && !Array.isArray(record)
    && typeof record.soul === 'string'
    && /^v[1-9][0-9]{0,3}\/(posts|communities)\/[a-z0-9_.:-]{1,128}$/.test(record.soul)
    && id(record.id) && (record.communityId === null || id(record.communityId))
    && typeof record.encrypted === 'boolean', 'REVIEW_PROJECTION');
  const projection = { soul: record.soul, id: record.id, communityId: record.communityId };
  for (const field of ['isPrivate', 'isEncrypted', 'deleted', 'isDeleted']) {
    check(record[field] === false || record[field] === true || record[field] === null, 'REVIEW_PROJECTION');
    projection[field] = record[field] === true;
  }
  projection.encrypted = record.encrypted;
  return digest([REVIEW_DOMAIN, projection]);
}

export function validatePolicy(policy, expectedPolicyDigest, { now = Date.now() } = {}) {
  check(integer(now), 'CLOCK');
  check(exact(policy, ['version', 'scope', 'relayId', 'namespace', 'observer', 'validFrom', 'validUntil', 'targets']), 'POLICY_SHAPE');
  check(size(policy) <= LIMITS.policyBytes && hex(expectedPolicyDigest, 64)
    && digest(policy) === expectedPolicyDigest, 'POLICY_AUTHORITY');
  check(policy.version === 1 && policy.scope === 'operator-reviewed-public-posts'
    && id(policy.relayId) && /^v[1-9][0-9]{0,3}$/.test(policy.namespace)
    && hex(policy.observer, 64), 'POLICY_CONTEXT');
  check(integer(policy.validFrom) && integer(policy.validUntil)
    && policy.validUntil > policy.validFrom
    && policy.validUntil - policy.validFrom <= LIMITS.policyLifetimeMs
    && now >= policy.validFrom && now <= policy.validUntil, 'POLICY_EXPIRED');
  check(Array.isArray(policy.targets) && policy.targets.length > 0
    && policy.targets.length <= LIMITS.targets, 'TARGET_BUDGET');
  const seen = new Set();
  const communities = new Map();
  for (const t of policy.targets) {
    check(exact(t, ['id', 'communityId', 'postReviewHash', 'communityReviewHash']) && id(t.id)
      && id(t.communityId) && hex(t.postReviewHash, 64) && hex(t.communityReviewHash, 64)
      && !seen.has(t.id), 'TARGET_POLICY');
    check(!communities.has(t.communityId) || communities.get(t.communityId) === t.communityReviewHash, 'COMMUNITY_POLICY');
    seen.add(t.id); communities.set(t.communityId, t.communityReviewHash);
  }
  return policy;
}

function validateWindow(readAt, policy, now) {
  check(integer(readAt) && readAt >= LIMITS.windowMs
    && Math.abs(readAt - now) <= LIMITS.clockSkewMs, 'CAPTURE_CLOCK');
  check(readAt - LIMITS.windowMs >= policy.validFrom && readAt <= policy.validUntil, 'WINDOW_OUTSIDE_POLICY');
}

function validateMetadata(records, policy) {
  check(Array.isArray(records) && records.length <= 2 * LIMITS.targets, 'METADATA_BUDGET');
  const expected = new Map();
  for (const t of policy.targets) {
    expected.set(`${policy.namespace}/posts/${t.id}`, { id: t.id, communityId: t.communityId, reviewHash: t.postReviewHash });
    expected.set(`${policy.namespace}/communities/${t.communityId}`, { id: t.communityId, communityId: null, reviewHash: t.communityReviewHash });
  }
  check(records.length === expected.size, 'METADATA_MISSING');
  const seen = new Set();
  for (const r of records) {
    check(exact(r, metadataFields) && typeof r.soul === 'string' && hex(r.dataHash, 64)
      && !seen.has(r.soul), 'METADATA_SHAPE');
    const e = expected.get(r.soul);
    check(e && r.id === e.id && r.communityId === e.communityId, 'METADATA_CHANGED');
    for (const k of ['isPrivate', 'isEncrypted', 'deleted', 'isDeleted']) {
      check(r[k] === false || r[k] === null, 'TARGET_NOT_PUBLIC');
    }
    check(r.encrypted === false, 'TARGET_ENCRYPTED');
    check(reviewDigest(r) === e.reviewHash, 'METADATA_CHANGED');
    seen.add(r.soul);
  }
}

function receiptTime(value) {
  check((typeof value === 'number' && integer(value))
    || (typeof value === 'string' && /^(0|[1-9][0-9]{0,15})$/.test(value)), 'RECEIPT_TIME');
  const number = Number(value);
  check(integer(number), 'RECEIPT_TIME');
  return number;
}

function validateObservations(observations, policy, from, to) {
  check(Array.isArray(observations) && observations.length <= LIMITS.events, 'EVENT_BUDGET');
  const targets = new Set(policy.targets.map(t => t.id)), seen = new Set();
  for (const o of observations) {
    check(exact(o, ['action', 'receivedAt']) && integer(o.receivedAt)
      && o.receivedAt >= from && o.receivedAt <= to, 'OBSERVATION_WINDOW');
    const a = o.action;
    check(a?.kind === 'reaction' && targets.has(a.targetId)
      && verifyAction(a, { now: o.receivedAt, namespace: policy.namespace, targetType: 'post' }), 'ACTION_AUTHENTICATION');
    check(!seen.has(a.id), 'DUPLICATE_LEDGER_ID'); seen.add(a.id);
  }
}

export function buildExport({ capture, policy, expectedPolicyDigest, secretKey, now = Date.now() }) {
  validatePolicy(policy, expectedPolicyDigest, { now });
  check(exact(capture, ['readAt', 'rows', 'metadata']), 'CAPTURE_SHAPE');
  validateWindow(capture.readAt, policy, now);
  validateMetadata(capture.metadata, policy);
  check(Array.isArray(capture.rows) && capture.rows.length <= LIMITS.events, 'EVENT_BUDGET');
  const observations = capture.rows.map(row => {
    check(exact(row, rowFields) && typeof row.payload === 'string'
      && Buffer.byteLength(row.payload, 'utf8') <= LIMITS.payloadBytes, 'LEDGER_SHAPE');
    let action;
    try { action = JSON.parse(row.payload); } catch { throw new Error('LEDGER_PAYLOAD'); }
    check(action && row.id === action.id && row.actor === action.actor && row.kind === action.kind
      && row.target_type === action.targetType && row.target_id === action.targetId, 'LEDGER_CONTEXT');
    return { action, receivedAt: receiptTime(row.received_at) };
  });
  const from = capture.readAt - LIMITS.windowMs, to = capture.readAt;
  validateObservations(observations, policy, from, to);
  let key;
  try {
    key = typeof secretKey === 'string' && hex(secretKey, 64) ? hexToBytes(secretKey) : secretKey;
    check(key instanceof Uint8Array && key.length === 32
      && bytesToHex(schnorr.getPublicKey(key)) === policy.observer, 'OBSERVER_KEY');
  } catch { throw new Error('OBSERVER_KEY'); }
  const snapshot = { version: 1, namespace: policy.namespace, targetType: 'post', from, to,
    observer: policy.observer, targets: policy.targets.map(t => ({ id: t.id, visibility: 'public' })).sort((a,b) => compare(a.id,b.id)),
    observations: observations.sort((a,b) => compare(a.action.id,b.action.id)), signature: '' };
  snapshot.signature = bytesToHex(schnorr.sign(hexToBytes(snapshotDigest(snapshot)), key));
  check(size(snapshot) <= LIMITS.snapshotBytes, 'SNAPSHOT_BUDGET');
  const manifest = { version: 1, policyDigest: expectedPolicyDigest, snapshotHash: digest(snapshot),
    relayId: policy.relayId, readAt: capture.readAt, from, to, coverage: 'retained-committed-sample',
    completeness: 'not-established', receiptTime: 'relay-admission-clock-before-commit',
    records: copy(capture.metadata).sort((a,b) => compare(a.soul,b.soul)) };
  const signature = bytesToHex(schnorr.sign(hexToBytes(digest([DOMAIN, manifest])), key));
  const bundle = { version: 1, policy: copy(policy), manifest, snapshot, signature };
  check(size(bundle) <= LIMITS.bundleBytes, 'BUNDLE_BUDGET');
  return bundle;
}

export function verifyExport(bundle, expectedPolicyDigest, { now = Date.now() } = {}) {
  check(exact(bundle, ['version', 'policy', 'manifest', 'snapshot', 'signature']) && bundle.version === 1, 'BUNDLE_SHAPE');
  check(size(bundle) <= LIMITS.bundleBytes, 'BUNDLE_BUDGET');
  const policy = validatePolicy(bundle.policy, expectedPolicyDigest, { now });
  const m = bundle.manifest, s = bundle.snapshot;
  check(exact(m, manifestFields) && m.version === 1 && m.policyDigest === expectedPolicyDigest
    && m.relayId === policy.relayId && m.coverage === 'retained-committed-sample'
    && m.completeness === 'not-established' && m.receiptTime === 'relay-admission-clock-before-commit', 'MANIFEST_CONTEXT');
  // Replay may take place later within the short policy lifetime. Never accept a future export.
  check(integer(m.readAt) && m.readAt <= now + LIMITS.clockSkewMs
    && now - m.readAt <= LIMITS.policyLifetimeMs, 'CAPTURE_CLOCK');
  validateWindow(m.readAt, policy, m.readAt);
  check(m.from === m.readAt - LIMITS.windowMs && m.to === m.readAt, 'MANIFEST_WINDOW');
  validateMetadata(m.records, policy);
  check(exact(s, ['version','namespace','targetType','from','to','observer','targets','observations','signature'])
    && s.version === 1 && s.namespace === policy.namespace && s.targetType === 'post'
    && s.from === m.from && s.to === m.to && s.observer === policy.observer, 'SNAPSHOT_CONTEXT');
  check(Array.isArray(s.targets) && s.targets.length === policy.targets.length
    && canonical([...s.targets].sort((a,b) => compare(String(a.id),String(b.id))))
    === canonical(policy.targets.map(t => ({ id:t.id,visibility:'public' })).sort((a,b) => compare(a.id,b.id))), 'SNAPSHOT_TARGETS');
  check(size(s) <= LIMITS.snapshotBytes && m.snapshotHash === digest(s), 'SNAPSHOT_HASH');
  try {
    check(hex(s.signature,128) && schnorr.verify(hexToBytes(s.signature),hexToBytes(snapshotDigest(s)),hexToBytes(policy.observer)), 'SNAPSHOT_SIGNATURE');
    check(hex(bundle.signature,128) && schnorr.verify(hexToBytes(bundle.signature),hexToBytes(digest([DOMAIN,m])),hexToBytes(policy.observer)), 'EXPORT_SIGNATURE');
  } catch { throw new Error('EXPORT_SIGNATURE'); }
  validateObservations(s.observations, policy, s.from, s.to);
  return { policy:copy(policy), snapshot:copy(s) };
}
