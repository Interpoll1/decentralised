/**
 * Content proof-of-work stamps for new posts, comments and polls.
 *
 * Every new content record carries `powNonce`, bound to (kind, id, createdAt,
 * authorId) — see shared-validation/contentPow.js. The relay firewall rejects
 * new content souls without a valid stamp, so a script writing straight to
 * Gun has to pay per item, and a flood costs real CPU.
 *
 * Solving runs in a Web Worker so the UI stays responsive; it falls back to
 * chunked main-thread solving where workers are unavailable.
 */
import {
  CONTENT_POW_MIN_BITS,
  contentPowSeed,
  contentPowWork,
  sha256Words,
  verifyContentPow,
} from '../../shared-validation/contentPow.js';

export type ContentKind = 'post' | 'comment' | 'poll';

export interface ContentStampInput {
  kind: ContentKind;
  id: string;
  createdAt: number;
  authorId?: string;
}

const MAIN_THREAD_BATCH = 20_000;

// sha256Words is serialised into the worker. It is a named function whose
// body references its own name, so it stays valid after minification.
function workerSource(): string {
  return `
const sha256Words = ${sha256Words.toString()};
self.onmessage = (e) => {
  const { seed, bits } = e.data;
  for (let nonce = 0; nonce < 4294967296; nonce++) {
    if (Math.clz32(sha256Words(seed + ':' + nonce)[0]) >= bits) {
      self.postMessage({ ok: true, nonce });
      return;
    }
  }
  self.postMessage({ ok: false });
};`;
}

function solveInWorker(seed: string, bits: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([workerSource()], { type: 'application/javascript' }));
    let worker: Worker;
    try {
      worker = new Worker(url);
    } catch (err) {
      URL.revokeObjectURL(url);
      reject(err);
      return;
    }
    const done = () => { worker.terminate(); URL.revokeObjectURL(url); };
    worker.onmessage = (e: MessageEvent<{ ok: boolean; nonce?: number }>) => {
      done();
      if (e.data.ok && typeof e.data.nonce === 'number') resolve(e.data.nonce);
      else reject(new Error('CONTENT_POW_EXHAUSTED'));
    };
    worker.onerror = (e) => { done(); reject(new Error(e.message || 'worker failed')); };
    worker.postMessage({ seed, bits });
  });
}

async function solveOnMainThread(seed: string, bits: number): Promise<number> {
  for (let nonce = 0; ; ) {
    const end = nonce + MAIN_THREAD_BATCH;
    for (; nonce < end; nonce++) {
      if (contentPowWork(seed, nonce) >= bits) return nonce;
    }
    await new Promise(r => setTimeout(r, 0)); // yield to the UI
  }
}

export class ContentPowService {
  /** Compute a nonce for a new record. `bits` may exceed the relay minimum. */
  static async stamp(input: ContentStampInput, bits = CONTENT_POW_MIN_BITS): Promise<number> {
    const seed = contentPowSeed(input);
    const target = Math.max(bits, CONTENT_POW_MIN_BITS);
    if (typeof Worker !== 'undefined' && typeof Blob !== 'undefined') {
      try { return await solveInWorker(seed, target); } catch { /* fall back */ }
    }
    return solveOnMainThread(seed, target);
  }

  static verify(input: ContentStampInput & { powNonce: unknown }): boolean {
    return verifyContentPow(input);
  }
}
