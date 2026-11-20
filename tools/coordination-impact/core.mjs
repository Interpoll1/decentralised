import { schnorr } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { verifyAction, compareActions } from '../../shared-validation/engagement.js';

export const POLICY = Object.freeze({
  version: 'coordination-impact-experiment-v1', ranking: 'window-net-reactions-v1',
  windowMs: 600_000, coincidenceMs: 60_000, minActors: 5, minSharedTargets: 3,
  maxInputBytes: 1_048_576, maxEvents: 1000, maxTargets: 100, maxActors: 64,
  maxComparisons: 50_000, maxPairs: 8192, maxEdges: 64, maxClusterActors: 32,
  maxClusters: 8, maxReceiptBytes: 1_048_576,
});
const fail = reason => { throw new Error(reason); };
const check = (condition, reason) => { if (!condition) fail(reason); };
const hex = (s, n) => typeof s === 'string' && new RegExp(`^[0-9a-f]{${n}}$`).test(s);
const id = s => typeof s === 'string' && /^[a-z0-9_.:-]{1,128}$/.test(s);
const integer = n => Number.isSafeInteger(n) && n >= 0;
const keys = (o, names) => o && typeof o === 'object' && !Array.isArray(o)
  && Object.keys(o).length === names.length && names.every(k => Object.hasOwn(o, k));
const cmp = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const key = (...args) => JSON.stringify(args);

export function canonical(value) {
  let nodes = 0;
  function visit(v, depth) {
    check(++nodes <= 50_000 && depth <= 12, 'ENCODING_BUDGET');
    if (v === null || typeof v === 'boolean') return v;
    if (typeof v === 'string') { check(v.length <= 8192, 'STRING_BUDGET'); return v; }
    if (typeof v === 'number') { check(Number.isSafeInteger(v), 'INVALID_NUMBER'); return v; }
    check(v && typeof v === 'object', 'INVALID_VALUE');
    if (Array.isArray(v)) return v.map(x => visit(x, depth + 1));
    return Object.fromEntries(Object.keys(v).sort().map(k => [k, visit(v[k], depth + 1)]));
  }
  return JSON.stringify(visit(value, 0));
}
export const digest = value => bytesToHex(sha256(new TextEncoder().encode(canonical(value))));
export const POLICY_DIGEST = digest(POLICY);

function snapshotPayload(s) {
  check(keys(s, ['version','namespace','targetType','from','to','observer','targets','observations','signature']), 'SNAPSHOT_SHAPE');
  check(s.version === 1 && typeof s.namespace === 'string' && /^v[1-9][0-9]{0,3}$/.test(s.namespace)
    && ['post','comment'].includes(s.targetType) && integer(s.from) && integer(s.to)
    && s.to - s.from === POLICY.windowMs && hex(s.observer,64), 'SNAPSHOT_CONTEXT');
  check(Array.isArray(s.targets) && s.targets.length > 0 && s.targets.length <= POLICY.maxTargets, 'TARGET_BUDGET');
  check(Array.isArray(s.observations) && s.observations.length <= POLICY.maxEvents, 'EVENT_BUDGET');
  const targets = new Set();
  for (const t of s.targets) {
    check(keys(t, ['id','visibility']) && id(t.id) && t.visibility === 'public' && !targets.has(t.id), 'TARGET_CONTEXT');
    targets.add(t.id);
  }
  for (const o of s.observations) {
    check(keys(o, ['action','receivedAt']) && integer(o.receivedAt) && o.receivedAt >= s.from && o.receivedAt <= s.to
      && o.action && typeof o.action === 'object' && hex(o.action.id,64), 'OBSERVATION_SHAPE');
  }
  return ['interpoll.coordination-snapshot.v1',s.version,s.namespace,s.targetType,s.from,s.to,s.observer,
    [...s.targets].sort((a,b)=>cmp(a.id,b.id)),
    [...s.observations].sort((a,b)=>cmp(a.action.id,b.action.id) || a.receivedAt-b.receivedAt)];
}

function rank(targets, latest, removed = new Set()) {
  const scores = new Map(targets.map(t => [t.id,0]));
  for (const {action:a} of latest) {
    if (!removed.has(a.actor)) scores.set(a.targetId,scores.get(a.targetId)+(a.value==='up'?1:a.value==='down'?-1:0));
  }
  return [...scores].map(([targetId,score])=>({targetId,score}))
    .sort((a,b)=>b.score-a.score || cmp(a.targetId,b.targetId)).map((r,i)=>({...r,rank:i+1}));
}

function calculate(s, expectedObserver) {
  check(hex(expectedObserver,64) && expectedObserver === s?.observer, 'OBSERVER_AUTHORITY');
  const payload = snapshotPayload(s);
  check(hex(s.signature,128) && schnorr.verify(hexToBytes(s.signature),hexToBytes(digest(payload)),hexToBytes(expectedObserver)), 'SNAPSHOT_SIGNATURE');
  const targets = new Set(s.targets.map(t=>t.id)), unique = new Map(), state = new Map();
  for (const o of s.observations) {
    const a=o.action;
    check(a.kind === 'reaction' && targets.has(a.targetId)
      && verifyAction(a,{now:o.receivedAt,namespace:s.namespace,targetType:s.targetType}), 'ACTION_AUTHENTICATION');
    const old=unique.get(a.id);
    if (old) { check(canonical(old) === canonical(o),'CONFLICTING_OBSERVATION'); continue; }
    unique.set(a.id,o);
    const cell=key(a.actor,a.targetId), previous=state.get(cell);
    if (!previous || compareActions(a,previous.action)>0) state.set(cell,o);
  }
  const latest=[...state.values()].sort((a,b)=>cmp(a.action.id,b.action.id));
  const groups=new Map(), pairs=new Map();
  for (const o of latest) {
    if (o.action.value==='none') continue;
    const k=key(o.action.targetId,o.action.value);
    if (!groups.has(k)) groups.set(k,[]);
    groups.get(k).push(o);
    check(groups.get(k).length<=POLICY.maxActors,'ACTOR_BUDGET');
  }
  let comparisons=0;
  for (const [,list] of [...groups].sort(([a],[b])=>cmp(a,b))) {
    if (list.length<POLICY.minActors) continue;
    list.sort((a,b)=>cmp(a.action.actor,b.action.actor));
    for(let i=0;i<list.length;i++) for(let j=i+1;j<list.length;j++) {
      check(++comparisons<=POLICY.maxComparisons,'COMPARISON_BUDGET');
      const a=list[i],b=list[j],gapMs=Math.abs(a.receivedAt-b.receivedAt);
      if(gapMs>POLICY.coincidenceMs) continue;
      const actors=[a.action.actor,b.action.actor], k=key(...actors);
      if(!pairs.has(k)) { check(pairs.size<POLICY.maxPairs,'PAIR_BUDGET'); pairs.set(k,{actors,evidence:[]}); }
      pairs.get(k).evidence.push({targetId:a.action.targetId,eventIds:[a.action.id,b.action.id],gapMs});
    }
  }
  const edges=[...pairs.values()].filter(p=>p.evidence.length>=POLICY.minSharedTargets)
    .sort((a,b)=>cmp(key(...a.actors),key(...b.actors)));
  check(edges.length<=POLICY.maxEdges,'EDGE_BUDGET');
  const adjacency=new Map();
  for(const {actors:[a,b]} of edges) {
    if(!adjacency.has(a)) adjacency.set(a,new Set());
    if(!adjacency.has(b)) adjacency.set(b,new Set());
    adjacency.get(a).add(b); adjacency.get(b).add(a);
  }
  const seen=new Set(),components=[];
  for(const actor of [...adjacency.keys()].sort()) {
    if(seen.has(actor)) continue;
    const stack=[actor],component=[]; seen.add(actor);
    while(stack.length) {
      const a=stack.pop();component.push(a);
      check(component.length<=POLICY.maxClusterActors,'CLUSTER_ACTOR_BUDGET');
      for(const b of adjacency.get(a)) if(!seen.has(b)) {seen.add(b);stack.push(b);}
    }
    components.push(component.sort()); check(components.length<=POLICY.maxClusters,'CLUSTER_BUDGET');
  }
  const baseline=rank(s.targets,latest);
  const clusters=components.map(actors=>{
    const removed=new Set(actors),after=new Map(rank(s.targets,latest,removed).map(r=>[r.targetId,r]));
    return {id:digest(['interpoll.review-cluster.v1',actors]),actors,
      edges:edges.filter(e=>removed.has(e.actors[0])),
      impact:baseline.map(b=>({targetId:b.targetId,beforeScore:b.score,afterScore:after.get(b.targetId).score,
        beforeRank:b.rank,afterRank:after.get(b.targetId).rank,
        removedEventIds:latest.filter(o=>o.action.targetId===b.targetId && removed.has(o.action.actor)).map(o=>o.action.id)}))};
  });
  return {version:1,policy:POLICY.version,policyDigest:POLICY_DIGEST,inputDigest:digest(payload),
    observer:s.observer,namespace:s.namespace,targetType:s.targetType,from:s.from,to:s.to,
    scope:'supplied-observer-attested-window',sourceTruth:'not-independently-established',humanOrBot:'undetermined',
    action:'review-only',ranking:POLICY.ranking,uniqueObservations:unique.size,latestReactions:latest.length,
    comparisons,baseline,clusters};
}

export function analyzeSnapshot(snapshot, expectedObserver) {
  try {
    // Pure API is also bounded; worker callers additionally cap bytes pre-parse.
    check(new TextEncoder().encode(canonical(snapshot)).byteLength<=POLICY.maxInputBytes,'INPUT_BUDGET');
    const receipt=calculate(snapshot,expectedObserver);
    check(new TextEncoder().encode(canonical(receipt)).byteLength<=POLICY.maxReceiptBytes,'RECEIPT_BUDGET');
    return {status:receipt.clusters.length?'REVIEW_CANDIDATES':'NO_PATTERN',receipt};
  } catch(e) {
    const reason=typeof e?.message==='string' && /^[A-Z_]+$/.test(e.message)?e.message:'INVALID_INPUT';
    return {status:'CANNOT_ESTABLISH',reason};
  }
}

export function verifyReceipt(snapshot, expectedObserver, receipt) {
  const result=analyzeSnapshot(snapshot,expectedObserver);
  if(!result.receipt) return result;
  try {
    return canonical(result.receipt)===canonical(receipt)
      ? {status:'VERIFIED_RELATIVE_TO_SNAPSHOT'} : {status:'RECEIPT_MISMATCH'};
  } catch {return {status:'RECEIPT_MISMATCH'};}
}

// Exported bytes/digest for a future independent observer exporter; no signing
// or private-key retrieval in the analysis implementation.
export function snapshotDigest(snapshot) {return digest(snapshotPayload(snapshot));}
