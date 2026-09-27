import { createConnection } from './connect.mjs';
import { readCapture } from './mysql-source.mjs';
import { buildExport, validatePolicy } from './export.mjs';
import { runPilot } from './runner.mjs';
import { readBounded, saveArtifact } from './io.mjs';

const [command, ...args] = process.argv.slice(2);
const jsonFile = async (path, max) => JSON.parse((await readBounded(path, max)).toString('utf8'));
try {
  if (command === 'export' && args.length === 5) {
    const [policyPath, expectedPolicyDigest, configPath, keyPath, out] = args;
    const policy = validatePolicy(await jsonFile(policyPath,16_384), expectedPolicyDigest);
    // Load only explicit operator-provisioned files; never the relay app's module/pool.
    const config = await jsonFile(configPath,4096);
    const rawKey = await readBounded(keyPath,128);
    let connection;
    try {
      const secretKey = rawKey.toString('utf8').trim();
      connection = await createConnection(config);
      const capture = await readCapture(connection,policy);
      const bundle = buildExport({capture,policy,expectedPolicyDigest,secretKey});
      const path = await saveArtifact(out,'bundle',bundle);
      console.log(JSON.stringify({status:'EXPORTED_REVIEW_SAMPLE',path,observations:bundle.snapshot.observations.length,completeness:'not-established'}));
    } finally { rawKey.fill(0); if(connection) await connection.end(); }
  } else if (command === 'run' && args.length === 3) {
    const [bundlePath, expectedPolicyDigest, out] = args;
    const bundle = await jsonFile(bundlePath,2_097_152);
    const report = await runPilot(bundle,expectedPolicyDigest);
    const path = await saveArtifact(out,'report',report);
    console.log(JSON.stringify({status:report.status,path}));
    if(report.status === 'CANNOT_ESTABLISH') process.exitCode = 1;
  } else if (command === 'scenarios' && args.length === 1) {
    const { generateScenarios } = await import('./scenarios.mjs');
    for (const scenario of generateScenarios()) {
      const report = await runPilot(scenario.bundle,scenario.expectedPolicyDigest,{now:scenario.now});
      const path = await saveArtifact(args[0],'report',{synthetic:true,scenario:scenario.name,expectedStatus:scenario.expectedStatus,report});
      const passed = report.status === scenario.expectedStatus;
      console.log(JSON.stringify({scenario:scenario.name,status:report.status,passed,path}));
      if(!passed) process.exitCode = 1;
    }
  } else {
    throw new Error('USAGE');
  }
} catch (e) {
  // Database errors can include hosts, usernames, queries or credentials. Never echo them.
  const code = /^[A-Z_]{2,64}$/.test(e?.message ?? '') ? e.message : 'PILOT_FAILED';
  console.error(JSON.stringify({status:'CANNOT_ESTABLISH',reason:code}));
  if(code === 'USAGE') console.error('export POLICY POLICY_SHA256 DB_CONFIG KEY_FILE OUT_DIR | run BUNDLE POLICY_SHA256 OUT_DIR | scenarios OUT_DIR');
  process.exitCode = 1;
}
