import {StorageService} from './storageService';
import type {MetadataChange} from './dmIdentity';
export class DMEpochError extends Error {
 constructor(public readonly state:'STALE'|'RESET_PENDING'|'LEGACY_UNAUTHENTICATED',message:string){super(message);this.name='DMEpochError';}
}
export interface EpochInfo {id:string;generation:number;parent:string|null;initiator:string;certificate:string}
export interface EpochRecord {version:1;current:string;generation:number;settled:boolean;candidates:Record<string,EpochInfo>;accepted:Record<string,true>;branches:Record<string,any>}
export const epochKey=(local:string,peer:string)=>`dm-session-epoch-v1:${local}:${peer}`;
const utf8=(s:string)=>new TextEncoder().encode(s);
const fail=(s:string):never=>{throw new DMEpochError('STALE',s);};
export async function readEpoch(local:string,peer:string):Promise<EpochRecord|null>{return await StorageService.getMetadata(epochKey(local,peer))??null;}
async function digest(s:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',utf8(s))),b=>b.toString(16).padStart(2,'0')).join('');}
export async function createEpoch(local:string,auth:string,eph:string,dh:string,generation:number,parent:string|null):Promise<string>{
 const payload=['interpoll/dm/epoch',1,generation,parent,auth,eph,dh];
 const stored=await StorageService.getMetadata(`signal-ik-sign:${local}`);
 const key=await crypto.subtle.importKey('jwk',stored.priv,{name:'ECDSA',namedCurve:'P-256'},false,['sign']);
 const sig=await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},key,utf8(JSON.stringify(payload)));
 return JSON.stringify([...payload,btoa(String.fromCharCode(...new Uint8Array(sig)))]);
}
export async function verifyEpoch(certificate:string,auth:string):Promise<EpochInfo>{
 let p:any;try{p=JSON.parse(certificate);}catch{return fail('Malformed epoch');}
 if(!Array.isArray(p)||p.length!==8||p[0]!=='interpoll/dm/epoch'||p[1]!==1||JSON.stringify(p)!==certificate||p[4]!==auth||!Number.isSafeInteger(p[2])||p[2]<1||
  (p[2]===1?p[3]!==null:typeof p[3]!=='string'||!/^[0-9a-f]{64}$/.test(p[3]))||typeof p[5]!=='string'||typeof p[6]!=='string'||typeof p[7]!=='string')return fail('Invalid epoch certificate');
 const sender=JSON.parse(auth)[2];
 const sig=Uint8Array.from(atob(p[7]),c=>c.charCodeAt(0));
 if(sig.length!==64||btoa(String.fromCharCode(...sig))!==p[7])return fail('Malformed epoch signature');
 const pub=await crypto.subtle.importKey('raw',Uint8Array.from(atob(sender.ikSignPub),c=>c.charCodeAt(0)),{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
 const payload=JSON.stringify(p.slice(0,7));
 if(!await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},pub,sig,utf8(payload)))return fail('Unauthorized epoch');
 return {id:await digest(payload),generation:p[2],parent:p[3],initiator:sender.binding.accountId,certificate};
}
// Only called after account/device context verification. Returned state is tentative.
export function admitEpoch(before:EpochRecord|null,info:EpochInfo,session:any,incoming:boolean):EpochRecord{
 if(before?.accepted[info.id]&&incoming)return fail('Bootstrap replay');
 let next:EpochRecord;
 if(!before){
  if(session)throw new DMEpochError('LEGACY_UNAUTHENTICATED','Legacy session has no epoch authority');
  if(info.generation!==1||info.parent!==null)return fail('Unknown epoch parent');
  next={version:1,current:info.id,generation:1,settled:false,candidates:{},accepted:{},branches:{}};
 }else{
  next=structuredClone(before);
  if(before.candidates[info.id])return fail('Previously proposed bootstrap');
  const current=before.candidates[before.current];
  if(info.generation===before.generation+1&&info.parent===before.current){
   next.current=info.id;next.generation=info.generation;next.branches={};next.settled=false;
  }else if(info.generation===before.generation&&info.parent===current.parent){
   if(Object.values(before.candidates).some(c=>c.generation===info.generation&&c.parent===info.parent&&c.initiator===info.initiator))return fail('Conflicting same-initiator bootstrap');
   if(!session)throw new DMEpochError('RESET_PENDING','Missing current ratchet; sibling cannot restore authority');
   if(info.initiator<current.initiator){next.branches[before.current]=session;next.current=info.id;next.settled=false;}
  }else return fail('Stale or unrelated epoch transition');
 }
 next.candidates[info.id]=info;
 if(incoming)next.accepted[info.id]=true;
 return next;
}
export const epochChange=(local:string,peer:string,before:EpochRecord|null,after:EpochRecord):MetadataChange=>({key:epochKey(local,peer),before,after});
