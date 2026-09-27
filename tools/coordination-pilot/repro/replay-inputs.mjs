// Re-analyze the saved inputs without regenerating anything.
//   node tools/coordination-pilot/repro/replay-inputs.mjs
// - inputs/sweep-*.json: signed synthetic snapshots; compares against the recorded result.
// - inputs/db-export-1000.bundle.json: the signed export from the staging-schema MySQL run,
//   replayed through the real pilot runner with `now` pinned to its capture time (its policy
//   has since expired, and the CLI `run` uses the current clock).
import { readdirSync, readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { digest } from '../../coordination-impact/core.mjs';
import { runPilot } from '../runner.mjs';
import { summarize } from './sweep.mjs';

const dir = new URL('./inputs/', import.meta.url).pathname;
let mismatches = 0;
for (const f of readdirSync(dir).filter(f => f.startsWith('sweep-')).sort()) {
  const saved = JSON.parse(readFileSync(dir + f, 'utf8'));
  const got = summarize(saved.snapshot, saved.coordinated);
  const same = isDeepStrictEqual(got, saved.expected);
  if (!same) mismatches++;
  console.log(`${same ? 'same' : 'DIFF'}  ${f}: ${got.status}${got.reason ? '/' + got.reason : ''} events=${got.events} clusters=${got.clusters} coord=${got.coordinatedFound}/8 other=${got.otherFlagged.length}`);
}
const bundle = JSON.parse(readFileSync(dir + 'db-export-1000.bundle.json', 'utf8'));
const policy = JSON.parse(readFileSync(dir + 'db-export-policy.json', 'utf8'));
const report = await runPilot(bundle, digest(policy), { now: bundle.manifest.readAt + 1000 });
console.log(`db-export-1000: ${report.status}${report.reason ? '/' + report.reason : ''} observations=${bundle.snapshot.observations.length}`);
process.exitCode = mismatches ? 1 : 0;
