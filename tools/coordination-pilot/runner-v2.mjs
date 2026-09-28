// Opt-in v2 analysis; v1 export authentication and default runner remain unchanged.
import { performance } from 'node:perf_hooks';
import { digest, POLICY, POLICY_DIGEST } from '../coordination-impact-v2/core.mjs';
import { ImpactWorkerV2 } from '../coordination-impact-v2/host.mjs';
import { DEFAULT_DEADLINE_MS, validDeadlineMs } from '../coordination-impact-v2/options.mjs';
import { verifyExport } from './export.mjs';

const MAX_REPORT_BYTES = 2_097_152;
let active = false;
const safeReason = (error, fallback) => {
  const value = error?.code ?? error?.message;
  return typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(value) ? value : fallback;
};

// Manual, file-oriented caller API. No queue, application imports, or actions
// against accounts, admission, ranking, storage, or transport. The deadline is
// shared by each two-worker pass; independent replay has its own deadline.
export async function runPilotV2(bundle, expectedPolicyDigest, { now, signal, deadlineMs = DEFAULT_DEADLINE_MS } = {}) {
  const started = performance.now();
  const timing = {};
  const report = { version: 2, action: 'review-only', ranking: POLICY.ranking,
    analysisPolicyDigest: POLICY_DIGEST, verification: null };
  const finish = result => {
    const output = { ...report, ...result, timing: { ...timing, totalMs: performance.now() - started } };
    if (Buffer.byteLength(JSON.stringify(output)) <= MAX_REPORT_BYTES) return output;
    return { version: 2, status: 'CANNOT_ESTABLISH', reason: 'REPORT_BUDGET',
      action: 'review-only', verification: null, timing: { totalMs: performance.now() - started } };
  };
  if (active) return finish({ status: 'CANNOT_ESTABLISH', reason: 'BUSY' });
  if (!validDeadlineMs(deadlineMs)
      || (signal !== undefined && (typeof signal?.aborted !== 'boolean'
        || typeof signal?.addEventListener !== 'function' || typeof signal?.removeEventListener !== 'function')))
    return finish({ status: 'CANNOT_ESTABLISH', reason: 'RUN_OPTIONS' });
  if (signal?.aborted) return finish({ status: 'CANNOT_ESTABLISH', reason: 'CANCELLED' });
  report.execution = { deadlineMsPerPass: deadlineMs, workersPerPass: 2,
    maxOldGenerationSizeMbPerWorker: 64, maxOldGenerationSizeMbTotal: 128 };

  active = true;
  try {
    let trusted;
    try { trusted = verifyExport(bundle, expectedPolicyDigest, { now }); }
    catch (error) { return finish({ status: 'CANNOT_ESTABLISH', reason: safeReason(error, 'EXPORT_VALIDATION') }); }
    timing.exportVerificationMs = performance.now() - started;

    // Serialize before yielding: caller mutations during worker execution cannot
    // replace the snapshot that was just verified or change report context.
    const { policy, snapshot } = trusted;
    const raw = Buffer.from(JSON.stringify(snapshot));
    report.policyDigest = expectedPolicyDigest;
    report.exportDigest = digest(bundle);
    report.source = { relayId: policy.relayId, namespace: policy.namespace, observer: policy.observer,
      targetType: snapshot.targetType, from: snapshot.from, to: snapshot.to,
      coverage: 'retained-committed-sample', completeness: 'not-established',
      sourceTruth: 'not-independently-established' };
    const observer = policy.observer;
    const analysis = await new ImpactWorkerV2().run(raw, observer, { signal, deadlineMs });
    timing.analysisWallMs = analysis.wallMs;
    timing.analysisComputeMs = analysis.metrics?.computeMs;
    timing.analysisWorkerComputeSumMs = analysis.metrics?.workerComputeSumMs;
    timing.analysisWorkerHeapAtEndBytes = analysis.metrics?.workerHeapBytes;
    if (!analysis.result.receipt) return finish({ status: analysis.result.status,
      ...(analysis.result.reason ? { reason: analysis.result.reason } : {}) });

    // Never return a usable receipt until a fresh worker pair reproduces it
    // from the same external inputs. Replay failure is not a no-pattern result.
    const receiptBytes = Buffer.from(JSON.stringify(analysis.result.receipt));
    const replay = await new ImpactWorkerV2().run(raw, observer, { signal, deadlineMs, receipt: receiptBytes });
    timing.verificationWallMs = replay.wallMs;
    timing.verificationComputeMs = replay.metrics?.computeMs;
    timing.verificationWorkerComputeSumMs = replay.metrics?.workerComputeSumMs;
    timing.verificationWorkerHeapAtEndBytes = replay.metrics?.workerHeapBytes;
    report.verification = replay.result;
    if (replay.result.status !== 'VERIFIED_RELATIVE_TO_SNAPSHOT')
      return finish({ status: 'CANNOT_ESTABLISH', reason: replay.result.reason
        ?? (replay.result.status === 'RECEIPT_MISMATCH' ? 'RECEIPT_MISMATCH' : 'REPLAY_FAILED') });
    return finish({ status: analysis.result.status, receipt: analysis.result.receipt });
  } catch (error) {
    return finish({ status: 'CANNOT_ESTABLISH', reason: safeReason(error, 'PILOT_FAILURE') });
  } finally { active = false; }
}
