import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSnapshot, verifyReceipt, canonical, POLICY, POLICY_DIGEST } from './core.mjs';
import { demo, attest, snapshot, observation, publicKey, TIME } from './fixtures.mjs';
import { ImpactWorker } from './host.mjs';
import { readFileSync } from 'node:fs';

const fixture=demo(), observer=fixture.observer;
const copy=()=>structuredClone(fixture);
const run=s=>analyzeSnapshot(s,observer);
const bytes=s=>Buffer.from(JSON.stringify(s));

test('candidate receipt exposes exact relationships and reproducible counterfactual',()=>{
  const r=run(copy());assert.equal(r.status,'REVIEW_CANDIDATES');
  assert.equal(r.receipt.policyDigest,POLICY_DIGEST);assert.equal(r.receipt.clusters.length,1);
  const c=r.receipt.clusters[0];assert.equal(c.actors.length,5);assert.equal(c.edges.length,10);
  assert.equal(c.edges[0].evidence.length,3);
  const affected=c.impact.find(x=>x.targetId==='post-0');assert.equal(affected.beforeScore,5);assert.equal(affected.afterScore,0);
  assert.equal(affected.removedEventIds.length,5);
  const honest=c.impact.find(x=>x.targetId==='post-3');assert.equal(honest.beforeRank,4);assert.equal(honest.afterRank,1);
  assert.equal(r.receipt.humanOrBot,'undetermined');assert.equal(r.receipt.action,'review-only');
  assert.equal(verifyReceipt(fixture,observer,r.receipt).status,'VERIFIED_RELATIVE_TO_SNAPSHOT');
});
test('input permutation and repeat produce byte-identical receipt without mutating input',()=>{
  const s=copy(), before=JSON.stringify(s), r=run(s);
  assert.equal(JSON.stringify(s),before);
  s.observations.reverse();s.targets.reverse();
  assert.equal(canonical(run(s)),canonical(r));assert.equal(canonical(run(fixture)),canonical(r));
});
test('receipt self-hash is insufficient: changing result, inputs, policy or evidence fails replay',()=>{
  const r=run(fixture).receipt;
  for(const modify of [r=>r.baseline[0].score++,r=>r.clusters[0].actors.pop(),r=>r.clusters[0].edges[0].evidence[0].gapMs++,
    r=>r.policy='replacement',r=>r.inputDigest='00'.repeat(32),r=>r.action='ban']) {
    const c=structuredClone(r);modify(c);assert.equal(verifyReceipt(fixture,observer,c).status,'RECEIPT_MISMATCH');
  }
});
test('a snapshot does not authorize its own observer key',()=>{
  assert.equal(analyzeSnapshot(fixture,publicKey(88)).reason,'OBSERVER_AUTHORITY');
  assert.equal(analyzeSnapshot(fixture,undefined).reason,'OBSERVER_AUTHORITY');
});
for(const field of ['version','namespace','targetType','from','to','observer','targets','observations','signature']) {
  test(`unsigned snapshot tamper or missing ${field} rejects`,()=>{
    const s=copy();delete s[field];assert.equal(run(s).status,'CANNOT_ESTABLISH');
    const changed=copy();changed[field]=null;assert.equal(run(changed).status,'CANNOT_ESTABLISH');
  });
}
test('observer signature does not excuse invalid actor signature or changed action context',()=>{
  for(const field of ['signature','actor','targetId','namespace','value']) {
    const s=copy();s.observations[0].action[field]='bad';
    assert.equal(run(attest(s)).reason,'ACTION_AUTHENTICATION');
  }
});
test('public visibility and declared target membership required, no private data fallback',()=>{
  const s=copy();s.targets[0].visibility='private';assert.equal(run(s).reason,'TARGET_CONTEXT');
  const t=copy();t.targets.pop();assert.equal(run(attest(t)).reason,'ACTION_AUTHENTICATION');
  const u=copy();u.targets[0].title='private text';assert.equal(run(u).reason,'TARGET_CONTEXT');
});
test('freshness evaluated at receipt time, future receipt or stale action cannot be smuggled into snapshot',()=>{
  const s=copy();s.observations[0].receivedAt=s.to+1;assert.equal(run(s).reason,'OBSERVATION_SHAPE');
  const t=copy();t.observations[0]=observation(1,'post-0','up',-300000);t.observations[0].receivedAt=TIME+1;
  assert.equal(run(attest(t)).reason,'ACTION_AUTHENTICATION');
});
test('exact duplicate transport observation cannot increase impact',()=>{
  const s=copy();s.observations.push(structuredClone(s.observations[0]));const r=run(attest(s)).receipt;
  assert.equal(r.uniqueObservations,19);assert.deepEqual(r.baseline,run(fixture).receipt.baseline);
  assert.deepEqual(r.clusters,run(fixture).receipt.clusters);
});
test('same event ID with conflicting receipt time is not silently reconciled',()=>{
  const s=copy(),o=structuredClone(s.observations[0]);o.receivedAt++;s.observations.push(o);
  assert.equal(run(attest(s)).reason,'CONFLICTING_OBSERVATION');
});
test('latest clear suppresses earlier votes; repeated actor toggles do not inflate cluster size',()=>{
  const s=copy();s.observations.push(observation(1,'post-0','none',10000,5));
  const r=run(attest(s));assert.equal(r.status,'NO_PATTERN');assert.equal(r.receipt.baseline.find(x=>x.targetId==='post-0').score,4);
  const toggles=Array.from({length:15},(_,i)=>observation(1,`post-${i%3}`,i%2?'down':'up',i,i));
  assert.equal(run(snapshot(toggles,['post-0','post-1','post-2'])).status,'NO_PATTERN');
});
test('removing coordinated downvotes increases scores; counterfactual does not restore earlier actions',()=>{
  const observations=[];
  for(let t=0;t<3;t++) for(let a=1;a<=5;a++) {
    observations.push(observation(a,`post-${t}`,'up',0,t));
    observations.push(observation(a,`post-${t}`,'down',1000,t+10));
  }
  const r=run(snapshot(observations,['post-0','post-1','post-2']));
  assert.equal(r.status,'REVIEW_CANDIDATES');
  assert.equal(r.receipt.clusters[0].impact[0].beforeScore,-5);assert.equal(r.receipt.clusters[0].impact[0].afterScore,0);
});
test('one shared target or opposite directions cannot establish the repeated relation',()=>{
  const one=fixture.observations.filter(o=>o.action.targetId==='post-0');
  assert.equal(run(snapshot(one,['post-0'])).status,'NO_PATTERN');
  const two=fixture.observations.filter(o=>o.action.targetId==='post-0'||o.action.targetId==='post-1');
  assert.equal(run(snapshot(two,['post-0','post-1'])).status,'NO_PATTERN');
});
test('time-gap boundary 60 seconds qualifies, 60 seconds plus one does not',()=>{
  function input(gap){const a=[];for(let t=0;t<3;t++)for(let n=1;n<=5;n++)a.push(observation(n,`post-${t}`,'up',n===5?gap:0,t));return snapshot(a,['post-0','post-1','post-2']);}
  assert.equal(run(input(60000)).receipt.clusters[0].actors.length,5);
  assert.equal(run(input(60001)).receipt.clusters[0].actors.length,4);
});
test('valid signed empty window gives no pattern, not an assertion that users are human',()=>{
  const r=run(snapshot([],['post-0']));assert.equal(r.status,'NO_PATTERN');assert.equal(r.receipt.baseline[0].score,0);
  assert.equal(r.receipt.sourceTruth,'not-independently-established');
});
test('legitimate synchronized campaign has same evidence: no malicious-intent classification',()=>{
  const r=run(fixture);assert.equal(r.status,'REVIEW_CANDIDATES');assert.equal(r.receipt.humanOrBot,'undetermined');
  assert.equal(r.receipt.scope,'supplied-observer-attested-window');
});
test('raw view events and invented verified flag rejected even under observer signature',()=>{
  const s=copy();s.observations[0].action.verified=true;assert.equal(run(attest(s)).reason,'ACTION_AUTHENTICATION');
});
test('event/target budgets refuse whole analysis with no partial accusation',()=>{
  const s=copy();s.observations=Array(POLICY.maxEvents+1).fill(s.observations[0]);
  assert.equal(run(s).reason,'EVENT_BUDGET');assert.equal(run(s).receipt,undefined);
  const t=copy();t.targets=Array.from({length:101},(_,i)=>({id:`p-${i}`,visibility:'public'}));assert.equal(run(t).reason,'TARGET_BUDGET');
});
test('actor and edge budgets explicitly refuse instead of silently truncating',()=>{
  const a=Array.from({length:65},(_,i)=>observation(i+1,'post-0'));
  assert.equal(run(snapshot(a,['post-0'])).reason,'ACTOR_BUDGET');
  const e=[];for(let t=0;t<3;t++)for(let a=1;a<=12;a++)e.push(observation(a,`post-${t}`,'up',0,t));
  assert.equal(run(snapshot(e,['post-0','post-1','post-2'])).reason,'EDGE_BUDGET');
});
test('worker and direct recomputation agree; host only allows bounded buffers',async()=>{
  const host=new ImpactWorker();const r=await host.run(bytes(fixture),observer);
  assert.deepEqual(r.result,run(fixture));
  assert.equal((await host.run(new Uint8Array(POLICY.maxInputBytes+1),observer)).result.reason,'INPUT_BUDGET');
  assert.equal((await host.run(bytes(fixture),observer,{receipt:{}})).result.reason,'RECEIPT_BUDGET');
  assert.equal((await host.run(bytes(fixture),'bad')).result.reason,'OBSERVER_AUTHORITY');
});
test('worker rejects malformed input and re-verifies full receipts in isolation',async()=>{
  const host=new ImpactWorker();assert.equal((await host.run(Buffer.from('{'),observer)).result.status,'CANNOT_ESTABLISH');
  const receipt=run(fixture).receipt;
  assert.equal((await host.run(bytes(fixture),observer,{receipt:bytes(receipt)})).result.status,'VERIFIED_RELATIVE_TO_SNAPSHOT');
});
test('no queue growth: BUSY on concurrent request, explicit cancel/deadline then recovery',async()=>{
  const host=new ImpactWorker(),controller=new AbortController();
  const first=host.run(bytes(fixture),observer,{signal:controller.signal});
  assert.equal((await host.run(bytes(fixture),observer)).result.reason,'BUSY');
  controller.abort();assert.equal((await first).result.reason,'CANCELLED');
  assert.equal((await host.run(bytes(fixture),observer,{deadlineMs:1})).result.reason,'DEADLINE');
  assert.equal((await host.run(bytes(fixture),observer)).result.status,'REVIEW_CANDIDATES');
});
test('prototype is not imported by production ranking',()=>{
  const source=readFileSync(new URL('../../src/utils/feedRanking.ts',import.meta.url),'utf8');
  assert.equal(source.includes('coordination-impact'),false);
});
test('more than eight disjoint candidate components refuses the entire result',()=>{
  const observations=[],ids=[];
  for(let g=0;g<9;g++) for(let t=0;t<3;t++) {
    const target=`post-${g}-${t}`;ids.push(target);
    for(let n=0;n<5;n++) observations.push(observation(g*5+n+1,target,'up',n<2?0:(n-1)*70000,t));
  }
  assert.equal(run(snapshot(observations,ids)).reason,'CLUSTER_BUDGET');
});
test('opposite signed directions do not form a coordination edge with each other',()=>{
  const observations=[];
  for(let t=0;t<3;t++)for(let n=1;n<=10;n++) observations.push(observation(n,`post-${t}`,n<=5?'up':'down',0,t));
  const r=run(snapshot(observations,['post-0','post-1','post-2']));assert.equal(r.receipt.clusters.length,2);
  assert.equal(r.receipt.baseline[0].score,0);
  for(const c of r.receipt.clusters) assert.equal(c.actors.length,5);
});
