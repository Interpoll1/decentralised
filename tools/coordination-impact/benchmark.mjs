import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { cpus } from 'node:os';
import { demo, workload } from './fixtures.mjs';
import { ImpactWorker } from './host.mjs';

const host=new ImpactWorker(), samples=[], idle=[];
// Fixture creation/signing is outside measurement, as a real exporter would be.
const workloads=[['demo',demo()],['100-events',workload(100)],['500-events',workload(500)],['1000-events',workload(1000)]];
for(let repeat=0;repeat<3;repeat++) {
  const delay=monitorEventLoopDelay({resolution:10});delay.enable();
  await new Promise(r=>setTimeout(r,1000));delay.disable();
  idle.push({repeat,hostEventLoopP99Ms:delay.percentile(99)/1e6});
}
for(const [name,s] of workloads) {
  const bytes=Buffer.from(JSON.stringify(s));
  for(let repeat=0;repeat<3;repeat++) {
    const delay=monitorEventLoopDelay({resolution:10});delay.enable();
    await new Promise(r=>setTimeout(r,30));
    const cpu=process.cpuUsage(),rss=process.memoryUsage().rss,start=performance.now();
    const result=await host.run(bytes,s.observer);
    const elapsedMs=performance.now()-start,used=process.cpuUsage(cpu);
    await new Promise(r=>setTimeout(r,20));delay.disable();
    samples.push({name,repeat,events:s.observations.length,inputBytes:bytes.length,status:result.result.status,
      reason:result.result.reason,wallMs:elapsedMs,computeMs:result.metrics?.computeMs,
      processCpuMs:(used.user+used.system)/1000,workerHeapBytes:result.metrics?.workerHeapBytes,
      processRssDeltaBytes:process.memoryUsage().rss-rss,hostEventLoopP99Ms:delay.percentile(99)/1e6,
      receiptBytes:result.result.receipt?Buffer.byteLength(JSON.stringify(result.result.receipt)):0});
  }
}
console.log(JSON.stringify({runtime:process.version,platform:process.platform,cpu:cpus()[0]?.model,
  scope:'synthetic Node worker; not browser/mobile/production feed latency',idle,samples},null,2));
