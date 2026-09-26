import { Worker } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';

// No unbounded queue or browser imports. Timeouts destroy the worker; no state
// or partial result from an interrupted analysis is accepted.
export class ImpactWorker {
  #active=false;
  async run(raw,observer,{signal,deadlineMs=5000,receipt}={}) {
    if(this.#active) return {result:{status:'CANNOT_ESTABLISH',reason:'BUSY'}};
    if(!(raw instanceof Uint8Array) || raw.byteLength>1_048_576) return {result:{status:'CANNOT_ESTABLISH',reason:'INPUT_BUDGET'}};
    if(typeof observer!=='string' || !/^[0-9a-f]{64}$/.test(observer)) return {result:{status:'CANNOT_ESTABLISH',reason:'OBSERVER_AUTHORITY'}};
    if(receipt!==undefined && (!(receipt instanceof Uint8Array) || receipt.byteLength>1_048_576)) return {result:{status:'CANNOT_ESTABLISH',reason:'RECEIPT_BUDGET'}};
    if(!Number.isInteger(deadlineMs) || deadlineMs<1 || deadlineMs>5000) throw new Error('Invalid deadline');
    if(signal?.aborted) return {result:{status:'CANNOT_ESTABLISH',reason:'CANCELLED'}};
    this.#active=true;
    const start=performance.now();
    let worker;
    try {
      worker=new Worker(new URL('./worker.mjs',import.meta.url),{resourceLimits:{maxOldGenerationSizeMb:64,maxYoungGenerationSizeMb:16,stackSizeMb:4}});
      return await new Promise(resolve=>{
        let done=false;
        const finish=async value=>{
          if(done) return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',cancel);
          await worker.terminate();resolve({...value,wallMs:performance.now()-start});
        };
        const cancel=()=>void finish({result:{status:'CANNOT_ESTABLISH',reason:'CANCELLED'}});
        const timer=setTimeout(()=>void finish({result:{status:'CANNOT_ESTABLISH',reason:'DEADLINE'}}),deadlineMs);
        signal?.addEventListener('abort',cancel,{once:true});
        worker.once('message',value=>void finish(value));
        worker.once('error',()=>void finish({result:{status:'CANNOT_ESTABLISH',reason:'WORKER_FAILURE'}}));
        worker.once('exit',()=>{if(!done) void finish({result:{status:'CANNOT_ESTABLISH',reason:'WORKER_EXIT'}});});
        worker.postMessage({raw,observer,receipt});
      });
    } finally {this.#active=false;}
  }
}
