// PUBLIC SYNTHETIC KEYS. Never use this generator with accounts or real data.
import { createHash } from 'node:crypto';
import { schnorr } from '@noble/curves/secp256k1.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { actionBytes } from '../../shared-validation/engagement.js';
import { snapshot, TIME } from '../coordination-impact/fixtures.mjs';

const sha = s => createHash('sha256').update(s).digest();
function random(seed) {
  let a = sha(seed).readUInt32LE(0);
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = (t + Math.imul(t ^ t >>> 7, 61 | t)) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

export function generate({ seed, groupSizes = [8], sharedTargets = 5, unrelated = 0,
  background = 56, perBackground = 5, pattern = 'uniform', jitterMs = 0, actorStepMs = 500, burstActors = background } = {}) {
  if (typeof seed !== 'string' || !['uniform', 'popular', 'burst'].includes(pattern)
    || ![sharedTargets, unrelated, background, perBackground, jitterMs, actorStepMs, burstActors, ...groupSizes].every(Number.isSafeInteger)
    || Math.min(sharedTargets, unrelated, background, perBackground, jitterMs, actorStepMs, burstActors, ...groupSizes) < 0
    || burstActors > background
    || sharedTargets * groupSizes.length + unrelated > 20 || perBackground > 20)
    throw Error('INVALID_SYNTHETIC_CONFIG');
  const tag = `interpoll-v2-heldout|${seed}`, rand = random(tag);
  const groupCount = groupSizes.reduce((a, b) => a + b, 0), count = groupCount + background;
  if (count > 300 || groupCount * (sharedTargets + unrelated) + background * perBackground > 1000)
    throw Error('SYNTHETIC_BUDGET');
  const keys = Array.from({ length: count }, (_, i) => sha(`${tag}|public-fixture-key|${i}`));
  const actors = keys.map(k => bytesToHex(schnorr.getPublicKey(k)));
  const ids = Array.from({ length: 20 }, (_, i) => `post-${i}`), observations = [];
  function add(actorIndex, targetIndex, offset, sequence) {
    const a = { version: 1, namespace: 'v5', actor: actors[actorIndex], kind: 'reaction', targetType: 'post',
      targetId: ids[targetIndex], value: 'up', createdAt: TIME + offset,
      nonce: sha(`${tag}|nonce|${actorIndex}|${sequence}`).toString('hex').slice(0, 32) };
    const id = sha(actionBytes(a));
    // Fixed auxiliary bytes make public fixture signatures reproducible, not secrets.
    const action = { ...a, id: id.toString('hex'), signature: bytesToHex(schnorr.sign(id, keys[actorIndex], new Uint8Array(32))) };
    observations.push({ action, receivedAt: TIME + offset });
  }
  const plantedGroups = []; let index = 0;
  for (let group = 0; group < groupSizes.length; group++) {
    plantedGroups.push(actors.slice(index, index + groupSizes[group]));
    for (let member = 0; member < groupSizes[group]; member++, index++) {
      for (let j = 0; j < sharedTargets; j++) add(index, group * sharedTargets + j,
        -250000 + j * 20000 + member * actorStepMs + Math.floor(rand() * (jitterMs + 1)), j);
      const extra = new Set();
      while (extra.size < unrelated) {
        const p = Math.floor(rand() * 20);
        if (p < group * sharedTargets || p >= (group + 1) * sharedTargets) extra.add(p);
      }
      let seq = sharedTargets;
      for (const p of extra) add(index, p, 150000 + Math.floor(rand() * 100000), seq++);
    }
  }
  for (; index < count; index++) {
    const burst = pattern === 'burst' && index < groupCount + burstActors;
    const picked = new Set();
    if (burst) for (let j = 0; j < perBackground; j++) picked.add(j);
    else while (picked.size < perBackground) picked.add(Math.floor(rand() * (pattern === 'popular' && rand() < 0.8 ? 5 : 20)));
    let seq = 0;
    for (const p of picked) add(index, p, burst
      ? -230000 + p * 20000 + Math.floor(rand() * 15000)
      : -290000 + Math.floor(rand() * 580000), seq++);
  }
  return { snapshot: snapshot(observations, ids), planted: plantedGroups.flat(), plantedGroups };
}

// Original regression profiles: all were exposed during development, not held out.
export const PROFILES = Object.freeze([
  { id: 'uniform-70', background: 10, perBackground: 3 },
  { id: 'uniform-320', background: 56, perBackground: 5 },
  { id: 'uniform-1000', background: 192, perBackground: 5 },
  { id: 'background-only-960', groupSizes: [], background: 192, perBackground: 5 },
  { id: 'three-target-five-members', groupSizes: [5], sharedTargets: 3, background: 40 },
  { id: 'one-unrelated-per-member', unrelated: 1 },
  { id: 'two-unrelated-per-member', unrelated: 2 },
  { id: 'three-member-group', groupSizes: [3] },
  { id: 'jitter-30-seconds', jitterMs: 30000 },
  { id: 'staggered-15-seconds', actorStepMs: 15000 },
  { id: 'two-separate-groups', groupSizes: [8, 8] },
  { id: 'popular-background', groupSizes: [], background: 64, pattern: 'popular' },
  { id: 'organic-burst', groupSizes: [], background: 32, perBackground: 3, pattern: 'burst',
    expectedContext: true },
  { id: 'legitimate-campaign', seedProfile: 'uniform-320', background: 56, perBackground: 5,
    expectedLimitation: 'identical evidence to uniform-320; intent is not identifiable' },
]);
export const SEEDS = Object.freeze([101, 202, 303]);

// Declared before the revised policy's unseen-seed run. These are finite
// synthetic controls, not a statistical calibration or a real-user sample.
// These challenge seeds exposed a suppression miss and are now regressions.
export const CHALLENGE_SEEDS = Object.freeze([711, 1223, 1733]);
export const FRESH_SEEDS = Object.freeze([2221, 3253, 4721]);
export const FRESH_PROFILES = Object.freeze([
  ...PROFILES,
  { id: 'small-three-unrelated', groupSizes: [3], unrelated: 5 },
  { id: 'mixed-small-groups', groupSizes: [3, 4], unrelated: 2 },
  { id: 'heavy-unrelated-eight', unrelated: 10 },
  { id: 'background-only-1000', groupSizes: [], background: 200, perBackground: 5 },
  { id: 'burst-with-background', groupSizes: [], background: 40, perBackground: 3,
    pattern: 'burst', burstActors: 32, expectedContext: true },
  { id: 'one-off-burst', groupSizes: [], background: 32, perBackground: 1, pattern: 'burst', expectedNoPattern: true },
]);
