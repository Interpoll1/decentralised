// Public, deterministic SYNTHETIC TEST identities only. This module never loads
// an account, operator key, database, network resource, or real participant.
import { schnorr } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { actionBytes } from '../../shared-validation/engagement.js';
import { digest, snapshotDigest } from '../coordination-impact/core.mjs';
import { TIME } from '../coordination-impact/fixtures.mjs';
import { buildExport, DOMAIN, reviewDigest } from './export.mjs';

const syntheticKey = number => hexToBytes(number.toString(16).padStart(64, '0'));
const publicKey = number => bytesToHex(schnorr.getPublicKey(syntheticKey(number)));

function signedReaction(actorNumber, targetId, receivedAt, sequence) {
  const payload = { version: 1, namespace: 'v5', kind: 'reaction', actor: publicKey(actorNumber),
    targetType: 'post', targetId, value: 'up', createdAt: receivedAt,
    nonce: (actorNumber * 100000 + sequence + 1).toString(16).padStart(32, '0') };
  const id = bytesToHex(sha256(new TextEncoder().encode(actionBytes(payload))));
  return { ...payload, id, signature: bytesToHex(schnorr.sign(hexToBytes(id),
    syntheticKey(actorNumber), new Uint8Array(32))) };
}

function metadata(soul, record) {
  const raw = new TextEncoder().encode(JSON.stringify(record));
  return { soul, dataHash: bytesToHex(sha256(raw)), id: record.id,
    communityId: record.communityId ?? null, isPrivate: false, isEncrypted: false,
    deleted: false, isDeleted: false, encrypted: false };
}

// Exported solely for local tests of capture/worker boundaries. The key returned
// here is deliberately public test material, never a provisioned operator key.
export function syntheticInput({ synchronized = true, actors = 5 } = {}) {
  if (!Number.isInteger(actors) || actors < 1 || actors > 64) throw new Error('SYNTHETIC_ACTOR_BUDGET');
  const community = { id: 'pilot-community', isPrivate: false };
  const communityMetadata = metadata('v5/communities/pilot-community', community);
  const posts = Array.from({ length: 4 }, (_, i) => ({ id: `post-${i}`,
    communityId: community.id, isPrivate: false, isEncrypted: false }));
  const postMetadata = posts.map(post => metadata(`v5/posts/${post.id}`, post));
  const policy = { version: 1, scope: 'operator-reviewed-public-posts', relayId: 'synthetic-local-relay',
    namespace: 'v5', observer: publicKey(9999), validFrom: TIME - 600000, validUntil: TIME + 3600000,
    targets: posts.map((post, index) => ({ id: post.id, communityId: community.id,
      postReviewHash: reviewDigest(postMetadata[index]),
      communityReviewHash: reviewDigest(communityMetadata) })) };
  const rows = [];
  const append = (actor, target, receivedAt, sequence) => {
    const action = signedReaction(actor, target, receivedAt, sequence);
    rows.push({ id: action.id, actor: action.actor, kind: action.kind,
      target_type: action.targetType, target_id: action.targetId,
      received_at: receivedAt, payload: JSON.stringify(action) });
  };
  for (let target = 0; target < 3; target++) for (let actor = 1; actor <= actors; actor++) {
    const offset = synchronized ? -120000 + actor * 100 + target * 1000
      : -420000 + (actor - 1) * 70000 + target * 1000;
    append(actor, `post-${target}`, TIME + offset, target);
  }
  for (let actor = actors + 1; actor <= actors + 4; actor++)
    append(actor, 'post-3', TIME - 80000 + actor * 100, 3);
  return { capture: { readAt: TIME, rows, metadata: [...postMetadata, communityMetadata] }, policy,
    expectedPolicyDigest: digest(policy), secretKey: syntheticKey(9999), now: TIME };
}

function deterministicExport(input) {
  const bundle = buildExport(input);
  // Fixed auxiliary bytes are confined to public synthetic fixtures. Preserve
  // the normal exporter's validation and signed domains while making fixtures
  // byte-reproducible; real export signing remains unchanged.
  const sign = hash => bytesToHex(schnorr.sign(hexToBytes(hash), input.secretKey, new Uint8Array(32)));
  bundle.snapshot.signature = sign(snapshotDigest(bundle.snapshot));
  bundle.manifest.snapshotHash = digest(bundle.snapshot);
  bundle.signature = sign(digest([DOMAIN, bundle.manifest]));
  return bundle;
}

export function generateScenarios() {
  const normal = syntheticInput({ synchronized: false });
  const coordinated = syntheticInput();
  const normalBundle = deterministicExport(normal);
  const coordinatedBundle = deterministicExport(coordinated);
  return [
    { name: 'normal', expectedStatus: 'NO_PATTERN', bundle: normalBundle,
      expectedPolicyDigest: normal.expectedPolicyDigest, now: normal.now },
    { name: 'coordinated', expectedStatus: 'REVIEW_CANDIDATES', bundle: coordinatedBundle,
      expectedPolicyDigest: coordinated.expectedPolicyDigest, now: coordinated.now },
    // Intent is an external fixture label. Identical observable evidence cannot
    // distinguish a malicious operation from a legitimate volunteer campaign.
    { name: 'legitimate-campaign', expectedStatus: 'REVIEW_CANDIDATES',
      bundle: structuredClone(coordinatedBundle),
      expectedPolicyDigest: coordinated.expectedPolicyDigest, now: coordinated.now },
  ];
}
