import {StorageService} from './storageService';
import type {StoredChatMessage} from '../types/social';
import type {SignalEnvelope} from './signalProtocol';
import type {MetadataChange} from './dmIdentity';
export type ReceiveStatus='accepted'|'duplicate'|'retryable'|'rejected-auth'|'rejected-stale';
export interface ReceiveResult {status:ReceiveStatus;row?:StoredChatMessage;reason?:string;persisted?:boolean}
export class ReceiveFailure extends Error {constructor(public readonly status:Exclude<ReceiveStatus,'accepted'>,message:string){super(message);this.name='ReceiveFailure';}}
export const MAX_PENDING=64, MAX_PENDING_BYTES=2*1024*1024, MAX_ENVELOPE_BYTES=256*1024, PENDING_TTL_MS=24*60*60*1000;
export interface PendingEntry {fingerprint:string;raw:any;roomId:string;observedAt:number}
export const inboxKey=(local:string)=>`dm-receive-pending-v1:${local}`;
export const acceptanceKey=(local:string,peer:string,sid:string,dh:string,n:number)=>`dm-receive-accepted-v1:${local}:${peer}:${sid}:${dh}:${n}`;
const size=(x:unknown)=>new TextEncoder().encode(JSON.stringify(x)).length;
export function protocolEnvelope(raw:any):SignalEnvelope {
 if(raw?.v!==5||typeof raw.auth!=='string'||typeof raw.epoch!=='string'||typeof raw.dh!=='string'||typeof raw.ct!=='string'||
  !Number.isSafeInteger(raw.n)||raw.n<0||!Number.isSafeInteger(raw.pn)||raw.pn<0||
  (raw.eph!==undefined&&typeof raw.eph!=='string')||(raw.opkId!==undefined&&typeof raw.opkId!=='string'))throw new ReceiveFailure('rejected-auth','Malformed envelope');
 if(raw.auth.length+raw.epoch.length+raw.dh.length+raw.ct.length+(raw.eph?.length??0)>MAX_ENVELOPE_BYTES)throw new ReceiveFailure('rejected-auth','Envelope exceeds receive bound');
 for(const [value,length] of [[raw.dh,65],...(raw.eph!==undefined?[[raw.eph,65]]:[])] as [string,number][]){const b=atob(value);if(b.length!==length||btoa(b)!==value)throw new ReceiveFailure('rejected-auth','Invalid DH encoding');}
 const cipher=atob(raw.ct);if(cipher.length<28||btoa(cipher)!==raw.ct)throw new ReceiveFailure('rejected-auth','Invalid ciphertext encoding');
 const e:SignalEnvelope={v:5,auth:raw.auth,epoch:raw.epoch,dh:raw.dh,n:raw.n,pn:raw.pn,ct:raw.ct,...(raw.eph?{eph:raw.eph}:{}),...(raw.opkId?{opkId:raw.opkId}:{})};
 if(size(e)>MAX_ENVELOPE_BYTES)throw new ReceiveFailure('rejected-auth','Envelope exceeds receive bound');
 return e;
}
export async function receiveFingerprint(sender:string,recipient:string,e:SignalEnvelope):Promise<string>{
 const data=JSON.stringify(['interpoll/dm/receive',1,sender,recipient,e.v,e.auth,e.epoch,e.dh,e.n,e.pn,e.eph??null,e.opkId??null,e.ct]);
 return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(data))),b=>b.toString(16).padStart(2,'0')).join('');
}
function bounded(entries:PendingEntry[],now:number):PendingEntry[]{
 const active=entries.filter(e=>now-e.observedAt<PENDING_TTL_MS).sort((a,b)=>a.observedAt-b.observedAt||a.fingerprint.localeCompare(b.fingerprint));
 while(active.length>MAX_PENDING||size(active)>MAX_PENDING_BYTES)active.shift();return active;
}
export async function enqueuePending(local:string,entry:PendingEntry):Promise<boolean>{
 const key=inboxKey(local);
 for(let attempt=0;attempt<64;attempt++){
  const before=await StorageService.getMetadata(key);let items=bounded(before??[],Date.now());
  if(!items.some(e=>e.fingerprint===entry.fingerprint))items.push(entry);
  items=bounded(items,Date.now());
  if(await StorageService.compareAndSwapMetadata([{key,before,after:items}]))return items.some(e=>e.fingerprint===entry.fingerprint);
 }
 return false;
}
export async function pendingEntries(local:string):Promise<PendingEntry[]>{
 const key=inboxKey(local);
 for(;;){const before=await StorageService.getMetadata(key);const after=bounded(before??[],Date.now());
  if(JSON.stringify(before??[])===JSON.stringify(after))return after;
  if(await StorageService.compareAndSwapMetadata([{key,before,after}]))return after;}
}
export async function removePending(local:string,fingerprint:string):Promise<void>{
 const key=inboxKey(local);for(;;){const before=await StorageService.getMetadata(key);if(!before?.some((e:PendingEntry)=>e.fingerprint===fingerprint))return;
  if(await StorageService.compareAndSwapMetadata([{key,before,after:before.filter((e:PendingEntry)=>e.fingerprint!==fingerprint)}]))return;}
}
export interface ReceiveCommit {key:string;fingerprint:string;rowId:string;local:string}
export async function receiveCommitChanges(c:ReceiveCommit):Promise<MetadataChange[]>{
 const before=await StorageService.getMetadata(c.key);
 if(before)throw new ReceiveFailure(before.fingerprint===c.fingerprint?'duplicate':'rejected-auth','Authenticated position already accepted');
 if(await StorageService.getChatMessage(c.rowId)){
  // Acceptance may have committed after our first ledger read.
  const committed=await StorageService.getMetadata(c.key);
  throw new ReceiveFailure(committed?.fingerprint===c.fingerprint?'duplicate':'rejected-auth','Outer ID already stored');
 }
 const key=inboxKey(c.local),pending=await StorageService.getMetadata(key);
 return [{key:c.key,before,after:{fingerprint:c.fingerprint,rowId:c.rowId}},
  {key,before:pending,after:(pending??[]).filter((e:PendingEntry)=>e.fingerprint!==c.fingerprint)}];
}
