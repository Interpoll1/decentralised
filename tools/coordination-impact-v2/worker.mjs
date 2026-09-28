import { parentPort } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';
import { analyzePartition, canonical, POLICY } from './core.mjs';

parentPort.once('message', ({ raw, observer, receipt, partition }) => {
  const start = performance.now();
  try {
    if (!(raw instanceof Uint8Array) || raw.byteLength > POLICY.maxInputBytes) throw Error('INPUT_BUDGET');
    const snapshot = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
    const fragment = analyzePartition(snapshot, observer, partition);
    if (fragment.status === 'PARTITION_ONLY' && receipt !== undefined) {
      try {
        const claimed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(receipt));
        fragment.matchesReceipt = canonical(fragment.draftReceipt) === canonical(claimed);
      } catch { fragment.matchesReceipt = false; }
    }
    parentPort.postMessage({ fragment, metrics: { computeMs: performance.now() - start, workerHeapBytes: process.memoryUsage().heapUsed } });
  } catch { parentPort.postMessage({ fragment: { status: 'CANNOT_ESTABLISH', reason: 'INVALID_INPUT' } }); }
  parentPort.close();
});
