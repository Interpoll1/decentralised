import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { runPilotV2 } from './runner-v2.mjs';
import { buildExport } from './export.mjs';
import { generateScenarios, syntheticInput } from './scenarios.mjs';
import { POLICY_DIGEST, canonical } from '../coordination-impact-v2/core.mjs';

const scenarios = generateScenarios(), candidate = scenarios.find(s => s.name === 'coordinated');
const run = (s, options = {}) => runPilotV2(s.bundle, s.expectedPolicyDigest, { now: s.now, ...options });

test('v2 pilot authenticates v1 exports and emits separately versioned freshly replayed results', async () => {
  const reports = [];
  for (const s of scenarios) {
    const before = JSON.stringify(s.bundle), r = await run(s); reports.push(r);
    assert.equal(r.status, s.expectedStatus); assert.equal(r.version, 2);
    assert.equal(r.analysisPolicyDigest, POLICY_DIGEST); assert.equal(r.receipt.version, 2);
    assert.equal(r.verification.status, 'VERIFIED_RELATIVE_TO_SNAPSHOT');
    assert.equal(r.source.completeness, 'not-established'); assert.equal(r.action, 'review-only');
    assert.equal(JSON.stringify(s.bundle), before);
  }
  assert.equal(canonical(reports[1].receipt), canonical(reports[2].receipt));
});

test('v2 pilot rejects wrong pins, changed manifests and expired authority before analysis', async () => {
  const badPin = await runPilotV2(candidate.bundle, '00'.repeat(32), { now: candidate.now });
  assert.equal(badPin.status, 'CANNOT_ESTABLISH'); assert.equal(badPin.receipt, undefined);
  const changed = structuredClone(candidate); changed.bundle.manifest.readAt++;
  const bad = await run(changed); assert.equal(bad.status, 'CANNOT_ESTABLISH');
  assert.equal(bad.timing.analysisWallMs, undefined);
  const expired = await run(candidate, { now: candidate.bundle.policy.validUntil + 1 });
  assert.equal(expired.status, 'CANNOT_ESTABLISH'); assert.equal(expired.receipt, undefined);
});

test('v2 pilot has its own busy guard, cancellation/deadline and recovery', async () => {
  const controller = new AbortController(), first = run(candidate, { signal: controller.signal });
  assert.equal((await run(candidate)).reason, 'BUSY');
  controller.abort(); assert.equal((await first).reason, 'CANCELLED');
  assert.equal((await run(candidate, { deadlineMs: 1 })).reason, 'DEADLINE');
  assert.equal((await run(candidate)).status, 'REVIEW_CANDIDATES');
});

test('caller mutation during await cannot substitute the snapshot already authenticated', async () => {
  const changed = structuredClone(candidate), pending = run(changed);
  changed.bundle.snapshot.observations.length = 0;
  const r = await pending;
  assert.equal(r.status, 'REVIEW_CANDIDATES'); assert.ok(r.receipt.uniqueObservations > 0);
  assert.equal(r.verification.status, 'VERIFIED_RELATIVE_TO_SNAPSHOT');
});

test('v2 pilot records explicit extended worker budgets and refuses invalid run options', async () => {
  for (const deadlineMs of [0, 10001, '10000']) {
    const r = await run(candidate, { deadlineMs });
    assert.equal(r.reason, 'RUN_OPTIONS'); assert.equal(r.receipt, undefined);
    assert.equal(r.timing.exportVerificationMs, undefined);
  }
  const r = await run(candidate, { deadlineMs: 10000 });
  assert.equal(r.status, 'REVIEW_CANDIDATES');
  assert.equal(r.execution.deadlineMsPerPass, 10000);
  assert.equal(r.execution.workersPerPass, 2);
  assert.equal(r.verification.status, 'VERIFIED_RELATIVE_TO_SNAPSHOT');
});

test('broad response survives export and fresh replay as context-required without candidate accounts', async () => {
  const input = syntheticInput({ actors: 46 });
  const r = await runPilotV2(buildExport(input), input.expectedPolicyDigest, { now: input.now });
  assert.equal(r.status, 'CONTEXT_REQUIRED'); assert.equal(r.receipt.clusters.length, 0);
  assert.equal(r.receipt.broadContexts.length, 3);
  assert.equal(r.verification.status, 'VERIFIED_RELATIVE_TO_SNAPSHOT');
});

test('file CLI honors its process clock; expired fixture is not auto-renewed', async () => {
  const out = await mkdtemp(join(tmpdir(), 'interpoll-v2-cli-'));
  try {
    const bundle = fileURLToPath(new URL('./repro/inputs/db-export-1000.bundle.json', import.meta.url));
    const digest = 'd560c5afa315de491d782d9aad0601832d2c2c2e1f27a87250387e0764ba6a13';
    const cli = fileURLToPath(new URL('./cli-v2.mjs', import.meta.url));
    const fixture = JSON.parse(await readFile(bundle, 'utf8'));
    // Deterministic test clock, not an expiry assumption about the review date.
    const clockModule = 'data:text/javascript,' + encodeURIComponent(`Date.now = () => ${fixture.policy.validUntil + 1};`);
    const result = spawnSync(process.execPath, ['--import', clockModule, cli, bundle, digest, out], { encoding: 'utf8', timeout: 15000 });
    assert.equal(result.status, 1, result.stderr);
    const output = JSON.parse(result.stdout.trim());
    assert.equal(output.status, 'CANNOT_ESTABLISH'); assert.equal(output.reason, 'POLICY_EXPIRED');
    const report = JSON.parse(await readFile(join(out, (await readdir(out))[0]), 'utf8'));
    assert.equal(report.version, 2); assert.equal(report.receipt, undefined);
  } finally {
    if (dirname(resolve(out)) !== resolve(tmpdir()) || !basename(out).startsWith('interpoll-v2-cli-'))
      throw Error('Unexpected temporary cleanup target');
    await rm(out, { recursive: true, force: true });
  }
});
