import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonical, verifyReceipt, POLICY_DIGEST } from '../coordination-impact/core.mjs';
import { buildExport } from './export.mjs';
import { generateScenarios, syntheticInput } from './scenarios.mjs';
import { runPilot } from './runner.mjs';

const scenarios = generateScenarios();
const candidate = scenarios.find(scenario => scenario.name === 'coordinated');
const run = (scenario, options = {}) => runPilot(scenario.bundle,
  scenario.expectedPolicyDigest, { now: scenario.now, ...options });

test('controlled normal, coordinated and legitimate cases all replay against the frozen analyzer', async () => {
  const reports = [];
  for (const scenario of scenarios) {
    const before = JSON.stringify(scenario.bundle);
    const result = await run(scenario);
    reports.push(result);
    assert.equal(result.status, scenario.expectedStatus);
    assert.equal(result.verification.status, 'VERIFIED_RELATIVE_TO_SNAPSHOT');
    assert.equal(result.analysisPolicyDigest, POLICY_DIGEST);
    assert.equal(result.action, 'review-only');
    assert.equal(result.source.completeness, 'not-established');
    assert.equal(result.source.coverage, 'retained-committed-sample');
    assert.equal(result.receipt.humanOrBot, 'undetermined');
    assert.equal(verifyReceipt(scenario.bundle.snapshot, scenario.bundle.policy.observer,
      result.receipt).status, 'VERIFIED_RELATIVE_TO_SNAPSHOT');
    assert.equal(JSON.stringify(scenario.bundle), before);
    assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 2_097_152);
    for (const value of Object.values(result.timing)) assert.ok(Number.isFinite(value) && value >= 0);
    assert.ok(result.timing.analysisWallMs > 0);
    assert.ok(result.timing.verificationWallMs > 0);
  }
  assert.equal(reports[0].receipt.clusters.length, 0);
  assert.equal(canonical(reports[1].receipt), canonical(reports[2].receipt));
  assert.equal(canonical(scenarios[1].bundle), canonical(scenarios[2].bundle));
  const cluster = reports[1].receipt.clusters[0];
  assert.equal(cluster.actors.length, 5);
  assert.equal(cluster.edges.length, 10);
  assert.ok(cluster.edges.every(edge => edge.evidence.length === 3));
  const removed = candidate.bundle.snapshot.observations
    .filter(observation => observation.action.targetId === 'post-0')
    .map(observation => observation.action.id).sort();
  assert.deepEqual(cluster.impact.find(target => target.targetId === 'post-0'), {
    targetId: 'post-0', beforeScore: 5, afterScore: 0, beforeRank: 1, afterRank: 2,
    removedEventIds: removed,
  });
  const control = cluster.impact.find(target => target.targetId === 'post-3');
  assert.equal(control.beforeScore, 4);
  assert.equal(control.afterScore, 4);
  assert.equal(control.beforeRank, 4);
  assert.equal(control.afterRank, 1);
  assert.equal(control.removedEventIds.length, 0);
});

test('untrusted policy pin, changed export and expired authority cannot produce a receipt', async () => {
  const wrongPin = await runPilot(candidate.bundle, '00'.repeat(32), { now: candidate.now });
  assert.equal(wrongPin.status, 'CANNOT_ESTABLISH');
  assert.equal(wrongPin.receipt, undefined);
  assert.equal(wrongPin.verification, null);
  const altered = structuredClone(candidate);
  altered.bundle.snapshot.observations[0].receivedAt++;
  const changed = await run(altered);
  assert.equal(changed.status, 'CANNOT_ESTABLISH');
  assert.equal(changed.receipt, undefined);
  assert.equal(changed.timing.analysisWallMs, undefined);
  const expired = await run(candidate, { now: candidate.bundle.policy.validUntil + 1 });
  assert.equal(expired.status, 'CANNOT_ESTABLISH');
  assert.equal(expired.receipt, undefined);
});

test('dense valid evidence hitting frozen graph bounds remains cannot-establish, not no-pattern', async () => {
  const input = syntheticInput({ actors: 12 });
  const result = await runPilot(buildExport(input), input.expectedPolicyDigest, { now: input.now });
  assert.equal(result.status, 'CANNOT_ESTABLISH');
  assert.equal(result.reason, 'EDGE_BUDGET');
  assert.equal(result.receipt, undefined);
  assert.equal(result.verification, null);
});

test('one active pilot, explicit cancellation and deadline preserve recovery without queued jobs', async () => {
  const controller = new AbortController();
  const first = run(candidate, { signal: controller.signal });
  const busy = await run(candidate);
  assert.equal(busy.status, 'CANNOT_ESTABLISH');
  assert.equal(busy.reason, 'BUSY');
  controller.abort();
  const cancelled = await first;
  assert.equal(cancelled.reason, 'CANCELLED');
  assert.equal(cancelled.receipt, undefined);
  assert.equal((await run(candidate, { deadlineMs: 1 })).reason, 'DEADLINE');
  assert.equal((await run(candidate)).verification.status, 'VERIFIED_RELATIVE_TO_SNAPSHOT');
});

test('pre-cancelled or invalid worker options return bounded failures', async () => {
  const controller = new AbortController(); controller.abort();
  assert.equal((await run(candidate, { signal: controller.signal })).reason, 'CANCELLED');
  for (const deadlineMs of [0, 5001, 1.2, NaN])
    assert.equal((await run(candidate, { deadlineMs })).reason, 'RUN_OPTIONS');
  assert.equal((await run(candidate, { signal: {} })).reason, 'RUN_OPTIONS');
  const malformed = await runPilot(null, 'bad', { now: candidate.now });
  assert.equal(malformed.status, 'CANNOT_ESTABLISH');
  assert.equal(malformed.receipt, undefined);
  assert.match(malformed.reason, /^[A-Z][A-Z0-9_]{0,63}$/);
});

test('synthetic ledger actions are deterministic and scenario intent never enters snapshot fields', () => {
  assert.equal(canonical(syntheticInput().capture), canonical(syntheticInput().capture));
  assert.equal(canonical(syntheticInput().policy), canonical(syntheticInput().policy));
  assert.equal(canonical(generateScenarios()), canonical(scenarios));
  for (const scenario of scenarios) {
    assert.equal(Object.hasOwn(scenario.bundle.snapshot, 'scenario'), false);
    assert.equal(Object.hasOwn(scenario.bundle.snapshot, 'intent'), false);
    assert.equal(Object.hasOwn(scenario.bundle.snapshot, 'humanOrBot'), false);
    assert.equal(scenario.bundle.snapshot.observations.length, 19);
  }
});
