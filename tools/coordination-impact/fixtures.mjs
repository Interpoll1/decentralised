// Synthetic local fixtures only. No account storage, credentials or network.
import { schnorr } from '@noble/curves/secp256k1.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { signAction } from '../../shared-validation/engagement.js';
import { snapshotDigest } from './core.mjs';

const testKey = n => n.toString(16).padStart(64,'0');
export const publicKey = n => bytesToHex(schnorr.getPublicKey(hexToBytes(testKey(n))));
export const TIME = 1_800_000_000_000;
export function observation(actorNumber,targetId,value='up',offset=0,sequence=0) {
  const action=signAction({namespace:'v5',actor:publicKey(actorNumber),kind:'reaction',targetType:'post',targetId,
    value,createdAt:TIME+offset,nonce:(actorNumber*100000+sequence+1).toString(16).padStart(32,'0')},testKey(actorNumber));
  return {action,receivedAt:TIME+offset};
}
export function attest(s) {
  return {...s,signature:bytesToHex(schnorr.sign(hexToBytes(snapshotDigest(s)),hexToBytes(testKey(9999)),new Uint8Array(32)))};
}
export function snapshot(observations, ids) {
  return attest({version:1,namespace:'v5',targetType:'post',from:TIME-300000,to:TIME+300000,
    observer:publicKey(9999),targets:ids.map(id=>({id,visibility:'public'})),observations,signature:''});
}
export function demo() {
  const observations=[];
  for(let target=0;target<3;target++) for(let actor=1;actor<=5;actor++) observations.push(observation(actor,`post-${target}`,'up',actor*100,target));
  for(let actor=6;actor<=9;actor++) observations.push(observation(actor,'post-3','up'));
  return snapshot(observations,['post-0','post-1','post-2','post-3']);
}
export function workload(count) {
  const observations=[],ids=[];
  for(let i=0;i<count;i++) {
    const t=Math.floor(i/10),target=`post-${t}`;
    if(i%10===0) ids.push(target);
    observations.push(observation(i+1,target,'up',i%10));
  }
  return snapshot(observations,ids);
}
