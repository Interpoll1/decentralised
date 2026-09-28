// Offline synthetic evaluation. No database, app import, secret or network call.
import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { performance } from 'node:perf_hooks';
import { ImpactWorker } from '../coordination-impact/host.mjs';
import { ImpactWorkerV2 } from './host.mjs';
import { POLICY, POLICY_DIGEST, digest } from './core.mjs';
import { parseExecutionArgs } from './options.mjs';
import { publicKey } from '../coordination-impact/fixtures.mjs';
import { generate, PROFILES, SEEDS, FRESH_PROFILES, CHALLENGE_SEEDS, FRESH_SEEDS } from './fixtures.mjs';
import { runPilot } from '../coordination-pilot/runner.mjs';
import { runPilotV2 } from '../coordination-pilot/runner-v2.mjs';

const { args, deadlineMs } = parseExecutionArgs(process.argv.slice(2));
const [mode, directory, ...extra] = args;
if (!['saved', 'regression', 'challenge', 'fresh', 'all'].includes(mode) || !directory || extra.length)
  throw Error('Usage: node tools/coordination-impact-v2/evaluate.mjs saved|regression|challenge|fresh|all EMPTY_OUTPUT_DIR [--deadline-ms 10000]');
const execution = { v1DeadlineMs: 5000, v2DeadlineMs: deadlineMs, v2WorkersPerPass: 2, automaticRetries: 0 };
const root = resolve(directory);
if (existsSync(root) && readdirSync(root).length) throw Error('OUTPUT_NOT_EMPTY');
mkdirSync(join(root, 'inputs'), { recursive: true }); mkdirSync(join(root, 'results'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const save = (path, value) => writeFileSync(join(root, path), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const sourcePaths = ['core.mjs', 'policy.mjs', 'relation.mjs', 'host.mjs', 'worker.mjs', 'options.mjs', 'fixtures.mjs', 'evaluate.mjs',
  'cli.mjs', 'core.test.mjs', 'host.test.mjs', '../coordination-pilot/runner-v2.test.mjs', '../coordination-pilot/cli-v2.mjs',
  '../coordination-impact/core.mjs', '../coordination-impact/host.mjs', '../coordination-impact/worker.mjs',
  '../coordination-pilot/runner.mjs', '../coordination-pilot/runner-v2.mjs', '../coordination-pilot/export.mjs',
  '../coordination-impact/fixtures.mjs', '../../shared-validation/engagement.js', '../../package.json', '../../package-lock.json'];
const sourceHashes = Object.fromEntries(sourcePaths.map(p => [p, sha(readFileSync(new URL(p, import.meta.url)))]));
const startedAt = new Date().toISOString(), started = performance.now(), observer = publicKey(9999);
const rows = [], receiptDigests = new Map(); let failures = 0;
save('started.json', { mode, startedAt, node: process.version, platform: process.platform, execution, policy: POLICY, policyDigest: POLICY_DIGEST, sourceHashes });

function measurement(response, truth) {
  const result = response.result;
  if (!result.receipt) return { status: result.status, reason: result.reason ?? null,
    found: null, missed: null, additional: null, clusters: null, wallMs: response.wallMs,
    computeMs: response.metrics?.computeMs, heapAtEndBytes: response.metrics?.workerHeapBytes };
  const found = new Set(result.receipt.clusters.flatMap(c => c.actors)), planted = new Set(truth);
  return { status: result.status, reason: null,
    found: truth.filter(a => found.has(a)).length, missed: truth.filter(a => !found.has(a)).length,
    additional: [...found].filter(a => !planted.has(a)).length, clusters: result.receipt.clusters.length,
    actorCounts: result.receipt.clusters.map(c => c.actors.length),
    contextRequired: result.receipt.contextRequired ?? false,
    weakPatternCount: result.receipt.weakPatternCount ?? 0, broadContextCount: result.receipt.broadContexts?.length ?? 0,
    overlappingActors: result.receipt.overlappingActors ?? 0,
    wallMs: response.wallMs, computeMs: response.metrics?.computeMs, heapAtEndBytes: response.metrics?.workerHeapBytes };
}

async function evaluate(id, snapshot, truth, details = {}) {
  const raw = Buffer.from(JSON.stringify(snapshot));
  writeFileSync(join(root, 'inputs', `${id}.json`), raw, { flag: 'wx' });
  const old = await new ImpactWorker().run(raw, observer);
  const next = await new ImpactWorkerV2().run(raw, observer, { deadlineMs });
  const row = { id, events: snapshot.observations.length, actors: new Set(snapshot.observations.map(o => o.action.actor)).size,
    inputSha256: sha(raw), plantedCount: truth.length, ...details,
    v1: measurement(old, truth), v2: measurement(next, truth), v2Replay: null };
  if (details.expectedV1) {
    const flagged = new Set(old.result.receipt?.clusters.flatMap(c => c.actors) ?? []), planted = new Set(truth);
    const actual = { status: old.result.status, reason: old.result.reason ?? null, events: row.events,
      clusters: old.result.receipt?.clusters.length ?? 0, coordinatedFound: truth.filter(a => flagged.has(a)).length,
      otherFlagged: [...flagged].filter(a => !planted.has(a)).sort() };
    row.savedV1Matches = isDeepStrictEqual(actual, details.expectedV1);
    if (!row.savedV1Matches) failures++;
    row.savedV2ExactPlanted = next.result.status === 'REVIEW_CANDIDATES'
      && row.v2.found === truth.length && row.v2.additional === 0;
    if (!row.savedV2ExactPlanted) failures++;
  }
  if (next.result.receipt) {
    const check = await new ImpactWorkerV2().run(raw, observer, { deadlineMs, receipt: Buffer.from(JSON.stringify(next.result.receipt)) });
    row.v2Replay = { status: check.result.status, reason: check.result.reason ?? null, wallMs: check.wallMs };
    if (check.result.status !== 'VERIFIED_RELATIVE_TO_SNAPSHOT') failures++;
    const receiptHash = digest(next.result.receipt);
    receiptDigests.set(id, receiptHash); row.v2ReceiptDigest = receiptHash;
  } else if (details.source === 'generated') {
    // These declared profiles fit v2's graph scope. Refusal is measured, never
    // converted into zero false positives or a successful no-pattern result.
    row.unexpectedRefusal = true; failures++;
  }
  if (details.source === 'generated') {
    row.accountCheckPassed = row.v2.missed === 0 && row.v2.additional === 0;
    row.contextCheckPassed = (!details.expectedContext || row.v2.status === 'CONTEXT_REQUIRED')
      && (!details.expectedNoPattern || row.v2.status === 'NO_PATTERN');
    if (!row.accountCheckPassed || !row.contextCheckPassed) failures++;
  }
  save(`results/${id}.json`, { row, v1: old, v2: next }); rows.push(row);
  console.log(`${id}: ${row.events} reactions; v1=${row.v1.status}/${row.v1.reason ?? '-'} found=${row.v1.found} extra=${row.v1.additional}; v2=${row.v2.status}/${row.v2.reason ?? '-'} found=${row.v2.found} missed=${row.v2.missed} extra=${row.v2.additional}; ${Math.round(row.v2.wallMs)}ms replay=${row.v2Replay?.status ?? '-'}`);
}

let dbReplay = null;
const savedDir = new URL('../coordination-pilot/repro/inputs/', import.meta.url);
if (mode === 'saved' || mode === 'all') {
  for (const name of readdirSync(savedDir).filter(n => /^sweep-.*\.json$/.test(n)).sort()) {
    const bytes = readFileSync(new URL(name, savedDir)), saved = JSON.parse(bytes);
    await evaluate(name.slice(0, -5), saved.snapshot, saved.coordinated,
      { source: 'saved', savedFileSha256: sha(bytes), case: saved.case, expectedV1: saved.expected });
  }
  const bundleBytes = readFileSync(new URL('db-export-1000.bundle.json', savedDir));
  const bundle = JSON.parse(bundleBytes), pin = 'd560c5afa315de491d782d9aad0601832d2c2c2e1f27a87250387e0764ba6a13';
  const now = bundle.manifest.readAt + 1000;
  const old = await runPilot(bundle, pin, { now });
  const next = await runPilotV2(bundle, pin, { now, deadlineMs });
  dbReplay = { source: 'saved synthetic export; no database operation repeated', inputSha256: sha(bundleBytes),
    historicalReplay: true, pinnedNow: now, policyValidAtActualEvaluationTime: Date.now() >= bundle.policy.validFrom && Date.now() <= bundle.policy.validUntil,
    v1: { status: old.status, reason: old.reason ?? null, timing: old.timing },
    v2: { status: next.status, reason: next.reason ?? null, timing: next.timing,
      verification: next.verification, clusters: next.receipt?.clusters.map(c => ({ actors: c.actors.length, edges: c.edges.length })) ?? null },
    groundTruthAccountRecovery: 'not_scored: saved bundle has no external account labels' };
  if (old.reason !== 'CLUSTER_BUDGET' || next.status !== 'REVIEW_CANDIDATES'
    || next.verification?.status !== 'VERIFIED_RELATIVE_TO_SNAPSHOT') failures++;
  save('results/db-export-1000.json', { summary: dbReplay, v1: old, v2: next });
  console.log(`db-export-1000: v1=${old.status}/${old.reason}; v2=${next.status}/${next.reason ?? '-'} replay=${next.verification?.status ?? '-'} total=${Math.round(next.timing.totalMs)}ms`);
}

const datasets = [];
if (mode === 'regression' || mode === 'all') datasets.push({ name: 'regression', profiles: PROFILES, seeds: SEEDS });
if (mode === 'challenge' || mode === 'all') datasets.push({ name: 'challenge', profiles: FRESH_PROFILES, seeds: CHALLENGE_SEEDS });
if (mode === 'fresh' || mode === 'all') datasets.push({ name: 'fresh', profiles: FRESH_PROFILES, seeds: FRESH_SEEDS });
for (const dataset of datasets) for (const profile of dataset.profiles) for (const seed of dataset.seeds) {
  const id = `${dataset.name}-${profile.id}-${seed}`, seedId = `${profile.seedProfile ?? profile.id}|${seed}`;
  const built = generate({ ...profile, seed: seedId });
  await evaluate(id, built.snapshot, built.planted,
    { source: 'generated', dataset: dataset.name, profile: profile.id, seed: seedId,
      expectedContext: profile.expectedContext ?? false, expectedNoPattern: profile.expectedNoPattern ?? false,
      expectedLimitation: profile.expectedLimitation ?? null });
  if (profile.id === 'legitimate-campaign') {
    const twin = `${dataset.name}-uniform-320-${seed}`, prior = rows.find(r => r.id === twin), current = rows.at(-1);
    current.identicalEvidenceControl = prior.inputSha256 === current.inputSha256
      && receiptDigests.get(twin) === receiptDigests.get(id);
    if (!current.identicalEvidenceControl) failures++;
  }
}

const summary = { startedAt, finishedAt: new Date().toISOString(), mode, node: process.version, platform: process.platform,
  execution, policy: POLICY, policyDigest: POLICY_DIGEST, sourceHashes, cases: rows, dbReplay, failures,
  totalWallMs: performance.now() - started, processWideMaxRssKiB: process.resourceUsage().maxRSS,
  timingScope: 'cold disposable analysis workers; signature checks included; synthetic generation excluded; heap-at-completion is not peak memory; process RSS includes all work',
  failureMeaning: 'source replay, authentication, account-recovery or context-expectation check failures in this finite synthetic corpus; not a population error-rate estimate',
  scope: 'finite synthetic evaluation, not a real-user error-rate or production performance estimate',
  complete: true };
save('summary.json', summary);
console.log(`Completed ${rows.length} cases; validation failures=${failures}; summary=${join(root, 'summary.json')}`);
process.exitCode = failures ? 1 : 0;
