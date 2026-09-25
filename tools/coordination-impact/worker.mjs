import { parentPort } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';
import { analyzeSnapshot, verifyReceipt, POLICY } from './core.mjs';

parentPort.once('message', ({raw,observer,receipt})=>{
  const start=performance.now();
  try {
    if(!(raw instanceof Uint8Array) || raw.byteLength>POLICY.maxInputBytes) throw new Error('INPUT_BUDGET');
    const snapshot=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
    const claimed=receipt===undefined?undefined:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(receipt));
    const result=claimed===undefined?analyzeSnapshot(snapshot,observer):verifyReceipt(snapshot,observer,claimed);
    parentPort.postMessage({result,metrics:{computeMs:performance.now()-start,workerHeapBytes:process.memoryUsage().heapUsed}});
  } catch {parentPort.postMessage({result:{status:'CANNOT_ESTABLISH',reason:'INVALID_INPUT'}});}
  parentPort.close();
});
