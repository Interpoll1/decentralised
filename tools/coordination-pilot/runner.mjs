import { performance } from 'node:perf_hooks';
import { digest, POLICY, POLICY_DIGEST } from '../coordination-impact/core.mjs';
import { ImpactWorker } from '../coordination-impact/host.mjs';
import { verifyExport } from './export.mjs';

const MAX_REPORT_BYTES = 2_097_152;
let active = false;
const safeReason = (error, fallback) => {
  const value = error?.code ?? error?.message;
  return typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(value) ? value : fallback;
};

// Manual, file-oriented caller API. No queue, application imports, or actions
// against accounts, admission, ranking, storage, or transport. The deadline is
// per disposable worker; independent replay therefore has its own deadline.
export async function runPilot(bundle, expectedPolicyDigest, { now, signal, deadlineMs = 5000 } = {}) {
  const started = performance.now();
  const timing = {};
  const report = { version: 1, action: 'review-only', ranking: POLICY.ranking,
    analysisPolicyDigest: POLICY_DIGEST, verification: null };
  const finish = result => {
    const output = { ...report, ...result, timing: { ...timing, totalMs: performance.now() - started } };
    if (Buffer.byteLength(JSON.stringify(output)) <= MAX_REPORT_BYTES) return output;
    return { version: 1, status: 'CANNOT_ESTABLISH', reason: 'REPORT_BUDGET',
      action: 'review-only', verification: null, timing: { totalMs: performance.now() - started } };
  };
  if (active) return finish({ status: 'CANNOT_ESTABLISH', reason: 'BUSY' });
  if (!Number.isInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > 5000
      || (signal !== undefined && (typeof signal?.aborted !== 'boolean'
        || typeof signal?.addEventListener !== 'function' || typeof signal?.removeEventListener !== 'function')))
    return finish({ status: 'CANNOT_ESTABLISH', reason: 'RUN_OPTIONS' });
  if (signal?.aborted) return finish({ status: 'CANNOT_ESTABLISH', reason: 'CANCELLED' });

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
    const analysis = await new ImpactWorker().run(raw, observer, { signal, deadlineMs });
    timing.analysisWallMs = analysis.wallMs;
    timing.analysisComputeMs = analysis.metrics?.computeMs;
    timing.analysisWorkerHeapAtEndBytes = analysis.metrics?.workerHeapBytes;
    if (!analysis.result.receipt) return finish({ status: analysis.result.status,
      ...(analysis.result.reason ? { reason: analysis.result.reason } : {}) });

    // Never return a usable receipt until a separate fresh worker reproduces it
    // from the same external inputs. Replay failure is not a no-pattern result.
    const receiptBytes = Buffer.from(JSON.stringify(analysis.result.receipt));
    const replay = await new ImpactWorker().run(raw, observer, { signal, deadlineMs, receipt: receiptBytes });
    timing.verificationWallMs = replay.wallMs;
    timing.verificationComputeMs = replay.metrics?.computeMs;
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
