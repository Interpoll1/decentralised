// File-only opt-in v2 pilot. Export still uses the unchanged v1 exporter.
import { runPilotV2 } from './runner-v2.mjs';
import { readBounded, saveArtifact } from './io.mjs';
import { parseExecutionArgs } from '../coordination-impact-v2/options.mjs';

try {
  const { args, deadlineMs } = parseExecutionArgs(process.argv.slice(2));
  if (args.length !== 3) throw Error('USAGE');
  const [bundlePath, policyDigest, outDirectory] = args;
  const bundle = JSON.parse((await readBounded(bundlePath, 2_097_152)).toString('utf8'));
  const report = await runPilotV2(bundle, policyDigest, { deadlineMs });
  const path = await saveArtifact(outDirectory, 'report', report);
  console.log(JSON.stringify({ version: 2, status: report.status, reason: report.reason, execution: report.execution, path }));
  if (report.status === 'CANNOT_ESTABLISH') process.exitCode = 1;
} catch (e) {
  const reason = /^[A-Z_]{2,64}$/.test(e?.message ?? '') ? e.message : 'PILOT_FAILED';
  console.error(JSON.stringify({ status: 'CANNOT_ESTABLISH', reason }));
  if (reason === 'USAGE') console.error('node tools/coordination-pilot/cli-v2.mjs BUNDLE POLICY_SHA256 OUT_DIR [--deadline-ms 10000]');
  process.exitCode = 1;
}
