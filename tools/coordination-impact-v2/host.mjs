import { Worker } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';
import { DEFAULT_DEADLINE_MS, validDeadlineMs } from './options.mjs';

const refused = reason => ({ result: { status: 'CANNOT_ESTABLISH', reason } });
export class ImpactWorkerV2 {
  #active = false;
  async run(raw, observer, { signal, deadlineMs = DEFAULT_DEADLINE_MS, receipt } = {}) {
    if (this.#active) return refused('BUSY');
    if (!(raw instanceof Uint8Array) || raw.byteLength > 1_048_576) return refused('INPUT_BUDGET');
    if (typeof observer !== 'string' || !/^[0-9a-f]{64}$/.test(observer)) return refused('OBSERVER_AUTHORITY');
    if (receipt !== undefined && (!(receipt instanceof Uint8Array) || receipt.byteLength > 1_048_576)) return refused('RECEIPT_BUDGET');
    if (!validDeadlineMs(deadlineMs)) throw Error('Invalid deadline');
    if (signal !== undefined && (typeof signal.aborted !== 'boolean' || typeof signal.addEventListener !== 'function'
      || typeof signal.removeEventListener !== 'function')) throw Error('Invalid abort signal');
    if (signal?.aborted) return refused('CANCELLED');
    // One immutable copy per job; neither caller mutation nor a worker message
    // can substitute input between the two required verification partitions.
    const input = new Uint8Array(raw), claimed = receipt === undefined ? undefined : new Uint8Array(receipt);
    this.#active = true;
    const start = performance.now(), workers = [], responses = [];
    const execution = { deadlineMs, workers: 2, maxOldGenerationSizeMbPerWorker: 64, maxOldGenerationSizeMbTotal: 128 };
    let timer, cancel;
    try {
      return await new Promise(resolve => {
        let done = false;
        const finish = async value => {
          if (done) return; done = true; clearTimeout(timer); signal?.removeEventListener('abort', cancel);
          await Promise.allSettled(workers.map(w => w.terminate()));
          resolve({ ...value, execution, wallMs: performance.now() - start });
        };
        cancel = () => void finish(refused('CANCELLED'));
        timer = setTimeout(() => void finish(refused('DEADLINE')), deadlineMs);
        signal?.addEventListener('abort', cancel, { once: true });
        const accept = (index, response) => {
          if (done || responses[index]) return;
          const f = response?.fragment;
          if (f?.status === 'CANNOT_ESTABLISH') { void finish(refused(f.reason)); return; }
          if (f?.status !== 'PARTITION_ONLY' || f.partition !== index || f.partitions !== 2
            || !Number.isInteger(f.observationCount) || f.observationCount < 0 || f.observationCount > 1000
            || !f.draftReceipt || typeof f.draftDigest !== 'string' || !/^[0-9a-f]{64}$/.test(f.draftDigest)
            || !Number.isFinite(response.metrics?.computeMs) || !Number.isFinite(response.metrics?.workerHeapBytes)
            || f.checkedActions !== Math.floor((f.observationCount + 1 - index) / 2)) {
            void finish(refused('PARTITION_PROTOCOL')); return;
          }
          responses[index] = response;
          if (!responses[0] || !responses[1]) return;
          const a = responses[0].fragment, b = responses[1].fragment;
          if (a.observationCount !== b.observationCount || a.checkedActions + b.checkedActions !== a.observationCount
            || a.draftDigest !== b.draftDigest || a.matchesReceipt !== b.matchesReceipt
            || JSON.stringify(a.draftReceipt) !== JSON.stringify(b.draftReceipt)) {
            void finish(refused('PARTITION_MISMATCH')); return;
          }
          const metrics = { computeMs: Math.max(...responses.map(r => r.metrics.computeMs)),
            workerComputeSumMs: responses.reduce((sum, r) => sum + r.metrics.computeMs, 0),
            workerHeapBytes: responses.reduce((sum, r) => sum + r.metrics.workerHeapBytes, 0),
            checkedActions: a.checkedActions + b.checkedActions };
          const result = claimed !== undefined
            ? { status: a.matchesReceipt ? 'VERIFIED_RELATIVE_TO_SNAPSHOT' : 'RECEIPT_MISMATCH' }
            : { status: a.draftReceipt.clusters.length ? 'REVIEW_CANDIDATES'
              : a.draftReceipt.contextRequired ? 'CONTEXT_REQUIRED' : 'NO_PATTERN', receipt: a.draftReceipt };
          void finish({ result, metrics });
        };
        try {
          for (let index = 0; index < 2; index++) {
            const worker = new Worker(new URL('./worker.mjs', import.meta.url),
              { resourceLimits: { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 } });
            workers.push(worker);
            worker.once('message', value => accept(index, value));
            worker.once('error', () => void finish(refused('WORKER_FAILURE')));
            worker.once('exit', () => { if (!done && !responses[index]) void finish(refused('WORKER_EXIT')); });
            worker.postMessage({ raw: input, observer, receipt: claimed, partition: index });
          }
        } catch { void finish(refused('WORKER_FAILURE')); }
      });
    } finally { this.#active = false; }
  }
}
