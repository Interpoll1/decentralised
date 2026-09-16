import { CryptoService } from './cryptoService';
import { KeyService } from './keyService';
import { StorageService } from './storageService';
import { bindingBytes, verifyBinding, type DeviceBinding } from './dmIdentity';
import { getOrCreateAuthenticatedIdentityBundle } from './signalProtocol';
import type { StoredChatMessage } from '../types/social';

export const GROUP_LIMITS = { members: 64, keys: 8, outbox: 128, replay: 128, requests: 64, textBytes: 65536, recordBytes: 524288 } as const;
const utf8 = new TextEncoder();
const json = JSON.stringify;
const hash = CryptoService.hash;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const positive = (x: number) => Number.isSafeInteger(x) && x > 0;
const b64 = (x: ArrayBuffer | Uint8Array) => { let s = ''; for (const b of new Uint8Array(x)) s += String.fromCharCode(b); return btoa(s); };
function unb64(s: string): Uint8Array<ArrayBuffer> {
  if (typeof s !== 'string' || s.length > GROUP_LIMITS.recordBytes * 2) throw new Error('Invalid encoding');
  const bytes = Uint8Array.from(atob(s), c => c.charCodeAt(0));
  if (b64(bytes) !== s) throw new Error('Noncanonical encoding');
  return bytes;
}
function exact(x: object, keys: string[]) {
  if (!x || json(Object.keys(x).sort()) !== json(keys.sort())) throw new Error('Unsupported group fields');
}
function bounded(x: unknown) { if (utf8.encode(json(x)).length > GROUP_LIMITS.recordBytes) throw new Error('Group record too large'); }
function sameBinding(a: DeviceBinding, b: DeviceBinding) { return bindingBytes(a) === bindingBytes(b) && a.signature === b.signature; }
export const memberId = (b: DeviceBinding) => `${b.accountId}:${b.deviceId}`;
export type GroupIdentity = Awaited<ReturnType<typeof getOrCreateAuthenticatedIdentityBundle>>;
export interface Seal { ephemeral: string; iv: string; ciphertext: string }
export interface Epoch {
  version: 1; roomId: string; owner: DeviceBinding; membershipEpoch: number; keyEpoch: number;
  previous: string | null; members: DeviceBinding[]; metadata: {iv:string;ciphertext:string}; createdAt: number;
  keyCommitment: string; distributions: { member: string; seal: Seal }[]; signature: string;
}
export interface GroupHeader {
  version: 1; roomId: string; membershipEpoch: number; keyEpoch: number; epochHash: string;
  messageId: string; senderAccount: string; senderDevice: string; sequence: number; timestamp: number;
}
export interface GroupEnvelope {
  header: GroupHeader; iv: string; ciphertext: string; signature: string;
  publication: number; receipt: string;
}
export interface GroupState {
  mode: 'EPOCH_GROUP_V1'; epoch: Epoch; info:{name:string;description:string}; keys: { epoch: number; hash: string; key: string }[];
  counter: number; publication: number; received: Record<string, string>; highWater: number;
  outbox: GroupEnvelope[];
  senders: Record<string, { high: number; seen: Record<string, string> }>;
}
export const stateKey = (account: string, room: string) => `group-v1:${account}:${room}`;
export const headerBytes = (h: GroupHeader) => json(['interpoll/group/message',1,h.roomId,h.membershipEpoch,h.keyEpoch,h.epochHash,h.messageId,h.senderAccount,h.senderDevice,h.sequence,h.timestamp]);
export const authorshipBytes = (e: GroupEnvelope) => json(['interpoll/group/authorship',1,headerBytes(e.header),e.iv,e.ciphertext]);
const receiptBytes = (e: GroupEnvelope) => json(['interpoll/group/accepted',1,hash(authorshipBytes(e)),e.signature,e.publication]);
export const epochBytes = (e: Epoch) => json(['interpoll/group/epoch',1,e.roomId,bindingBytes(e.owner),e.owner.signature,e.membershipEpoch,e.keyEpoch,e.previous,
  e.members.map(b=>[bindingBytes(b),b.signature]),e.metadata.iv,e.metadata.ciphertext,e.createdAt,e.keyCommitment,
  e.distributions.map(d=>[d.member,d.seal.ephemeral,d.seal.iv,d.seal.ciphertext])]);
export const epochHash = (e: Epoch) => hash(epochBytes(e));
const metadataContext=(e:Epoch)=>json(['interpoll/group/metadata',1,e.roomId,e.membershipEpoch,e.keyEpoch]);
function roomInfo(value:string){
  const info=JSON.parse(value);exact(info,['name','description']);
  if(typeof info.name!=='string' || info.name.length>256 || typeof info.description!=='string' || info.description.length>4096)throw new Error('Invalid group metadata');return info as {name:string;description:string};
}
const distributionContext = (e: Epoch, b: DeviceBinding) => json(['interpoll/group/key',1,e.roomId,e.membershipEpoch,e.keyEpoch,memberId(b),hash(bindingBytes(b))]);
export const proposalContext = (room: string, request: string) => json(['interpoll/group/proposal',1,room,request]);

async function sign(identity: GroupIdentity, payload: string) {
  return b64(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},identity.ikSign.priv,utf8.encode(payload)));
}
async function verify(binding: DeviceBinding, payload: string, signature: string) {
  const bytes = unb64(signature);
  if (bytes.length !== 64) throw new Error('Missing group signature');
  const key = await crypto.subtle.importKey('raw',unb64(binding.ikSignPub),{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
  if (!await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},key,bytes,utf8.encode(payload))) throw new Error('Group signature rejected');
}
async function aes(key: string) { const raw=unb64(key); if(raw.length!==32)throw new Error('Invalid group key'); return crypto.subtle.importKey('raw',raw,'AES-GCM',false,['encrypt','decrypt']); }
async function encrypt(key: CryptoKey, text: string, context: string) {
  const iv=crypto.getRandomValues(new Uint8Array(12));
  return {iv:b64(iv),ciphertext:b64(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:utf8.encode(context)},key,utf8.encode(text)))};
}
async function decrypt(key: CryptoKey, value: {iv:string;ciphertext:string}, context: string) {
  const iv=unb64(value.iv); if(iv.length!==12)throw new Error('Invalid group IV');
  return new TextDecoder('utf-8',{fatal:true}).decode(await crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData:utf8.encode(context)},key,unb64(value.ciphertext)));
}
async function wrappingKey(priv: CryptoKey, pub: string, context: string) {
  const remote=await crypto.subtle.importKey('raw',unb64(pub),{name:'ECDH',namedCurve:'P-256'},false,[]);
  const bits=await crypto.subtle.deriveBits({name:'ECDH',public:remote},priv,256);
  const material=await crypto.subtle.importKey('raw',bits,'HKDF',false,['deriveKey']);
  return crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt:new Uint8Array(32),info:utf8.encode(context)},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
export async function sealTo(binding: DeviceBinding, text: string, context: string): Promise<Seal> {
  const ephemeral=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);
  return {ephemeral:b64(await crypto.subtle.exportKey('raw',ephemeral.publicKey)),...await encrypt(await wrappingKey(ephemeral.privateKey,binding.ik,context),text,context)};
}
export async function openSeal(identity: GroupIdentity, seal: Seal, context: string) {
  exact(seal,['ephemeral','iv','ciphertext']);
  return decrypt(await wrappingKey(identity.ik.priv,seal.ephemeral,context),seal,context);
}
function ownerFromRoom(room: string) {
  const parts=room.split(':');
  if(parts.length!==4 || parts[0]!=='g1' || !/^[0-9a-f]{64}$/.test(parts[1]) || !uuid.test(parts[2]) || !uuid.test(parts[3])) throw new Error('LEGACY_SHARED_KEY: new authenticated room migration required');
  return {account:parts[1],device:parts[2]};
}
export function isEpochRoom(room: string) { try {ownerFromRoom(room);return true;}catch{return false;} }
export async function verifyEpoch(e: Epoch, room: string) {
  bounded(e); exact(e,['version','roomId','owner','membershipEpoch','keyEpoch','previous','members','metadata','createdAt','keyCommitment','distributions','signature']);
  const owner=ownerFromRoom(room);
  if(e.version!==1 || e.roomId!==room || !positive(e.membershipEpoch) || e.keyEpoch!==e.membershipEpoch || !Array.isArray(e.members) || e.members.length>GROUP_LIMITS.members ||
    !positive(e.createdAt) || !/^[0-9a-f]{64}$/.test(e.keyCommitment) ||
    (e.membershipEpoch===1?e.previous!==null:!(/^[0-9a-f]{64}$/).test(e.previous??''))) throw new Error('Malformed epoch');
  exact(e.metadata,['iv','ciphertext']);
  await verifyBinding(e.owner,owner.account,owner.device);
  if(!Array.isArray(e.distributions) || e.distributions.length!==e.members.length) throw new Error('Incomplete distribution');
  let previous='';
  for(let i=0;i<e.members.length;i++) {
    const b=e.members[i],id=memberId(b);await verifyBinding(b,b.accountId,b.deviceId);
    if(id<=previous || e.distributions[i].member!==id)throw new Error('Duplicate/unordered member');previous=id;
    exact(e.distributions[i],['member','seal']);exact(e.distributions[i].seal,['ephemeral','iv','ciphertext']);
  }
  if(e.members.length && !e.members.some(b=>sameBinding(b,e.owner)))throw new Error('Owner missing');
  await verify(e.owner,epochBytes(e),e.signature);
}
async function verifyEnvelope(e: GroupEnvelope, epoch: Epoch, requireReceipt: boolean) {
  bounded(e);exact(e,['header','iv','ciphertext','signature','publication','receipt']);
  const h=e.header;exact(h,['version','roomId','membershipEpoch','keyEpoch','epochHash','messageId','senderAccount','senderDevice','sequence','timestamp']);
  if(h.version!==1 || h.roomId!==epoch.roomId || h.membershipEpoch!==epoch.membershipEpoch || h.keyEpoch!==epoch.keyEpoch || h.epochHash!==epochHash(epoch) ||
    !uuid.test(h.messageId) || !positive(h.sequence) || !positive(h.timestamp))throw new Error('Stale or malformed group context');
  const member=epoch.members.find(b=>b.accountId===h.senderAccount && b.deviceId===h.senderDevice);
  if(!member)throw new Error('Sender is not a current member');
  await verify(member,authorshipBytes(e),e.signature);
  if(requireReceipt){if(!positive(e.publication))throw new Error('Missing publication');await verify(epoch.owner,receiptBytes(e),e.receipt);}
  else if(e.publication!==0 || e.receipt!=='')throw new Error('Candidate already has receipt');
}
function content(text: string) {
  const c=JSON.parse(text);exact(c,['text','senderName']);
  if(typeof c.text!=='string' || !c.text.trim() || utf8.encode(c.text).length>GROUP_LIMITS.textBytes || typeof c.senderName!=='string' || c.senderName.length>256)throw new Error('Invalid group content');
  return c as {text:string;senderName:string};
}
const rowId = (room: string, message: string) => `group:${hash(room)}:${message}`;

/** One authority DB, many IDB contexts. All authority-changing paths share this CAS. */
export class GroupSecurity {
  constructor(readonly identity: GroupIdentity) {}
  static async local() { const account=await KeyService.getPublicKeyHex(); return new GroupSecurity(await getOrCreateAuthenticatedIdentityBundle(account)); }
  get binding() { return this.identity.bundle.binding; }
  async state(room: string): Promise<GroupState | undefined> { return StorageService.getMetadata(stateKey(this.binding.accountId,room)); }
  private async commit(room: string, before: GroupState | undefined, after: GroupState, row?: StoredChatMessage) {
    return StorageService.compareAndSwapMetadata([{key:stateKey(this.binding.accountId,room),before,after}],row);
  }
  private key(s: GroupState) {
    if(!s.epoch.members.some(b=>sameBinding(b,this.binding)))throw new Error('Group access revoked');
    const key=s.keys.find(k=>k.hash===epochHash(s.epoch));if(!key)throw new Error('Missing current group key');return key.key;
  }
  private owner(s: GroupState) { if(!sameBinding(s.epoch.owner,this.binding))throw new Error('Owner device required'); }
  private async makeEpoch(room: string, members: DeviceBinding[], name: string, description: string, previous?: Epoch) {
    const info=roomInfo(json({name,description}));
    const key=b64(crypto.getRandomValues(new Uint8Array(32)));
    const e:Epoch={version:1,roomId:room,owner:this.binding,membershipEpoch:(previous?.membershipEpoch??0)+1,keyEpoch:(previous?.keyEpoch??0)+1,
      previous:previous?epochHash(previous):null,members:[...members],metadata:{iv:'',ciphertext:''},createdAt:previous?.createdAt??Date.now(),keyCommitment:hash(key),distributions:[],signature:''};
    e.metadata=await encrypt(await aes(key),json(info),metadataContext(e));
    // ASCII ordering must not depend on locale.
    e.members.sort((a,b)=>memberId(a)<memberId(b)?-1:memberId(a)>memberId(b)?1:0);
    if(e.members.length>GROUP_LIMITS.members)throw new Error('Group member limit');
    for(const b of e.members){await verifyBinding(b,b.accountId,b.deviceId);e.distributions.push({member:memberId(b),seal:await sealTo(b,key,distributionContext(e,b))});}
    e.signature=await sign(this.identity,epochBytes(e));await verifyEpoch(e,room);return {epoch:e,key};
  }
  async create(name: string, description: string) {
    const room=`g1:${memberId(this.binding)}:${crypto.randomUUID()}`;
    const {epoch,key}=await this.makeEpoch(room,[this.binding],name,description);
    const state:GroupState={mode:'EPOCH_GROUP_V1',epoch,info:{name,description},keys:[{epoch:1,hash:epochHash(epoch),key}],counter:0,publication:0,received:{},highWater:0,outbox:[],senders:{}};
    if(!await this.commit(room,undefined,state))throw new Error('Room collision');return epoch;
  }
  async adopt(epoch: Epoch) {
    await verifyEpoch(epoch,epoch.roomId);
    for(let attempt=0;attempt<16;attempt++){
      const before=await this.state(epoch.roomId);
      if(before){
        if(!sameBinding(before.epoch.owner,epoch.owner))throw new Error('Owner identity changed');
        if(epoch.membershipEpoch<before.epoch.membershipEpoch)throw new Error('Stale group epoch');
        if(epoch.membershipEpoch===before.epoch.membershipEpoch){if(epochHash(epoch)!==epochHash(before.epoch))throw new Error('Conflicting group epoch');return before;}
        if(epoch.membershipEpoch===before.epoch.membershipEpoch+1 && epoch.previous!==epochHash(before.epoch))throw new Error('Epoch predecessor mismatch');
      }
      const member=epoch.members.find(b=>memberId(b)===memberId(this.binding));
      let newKey:GroupState['keys']=[];let info=before?.info??{name:'Authenticated room',description:''};
      if(member){
        if(!sameBinding(member,this.binding))throw new Error('Member identity changed');
        const d=epoch.distributions.find(d=>d.member===memberId(member))!;
        const key=await openSeal(this.identity,d.seal,distributionContext(epoch,member));await aes(key);
        if(hash(key)!==epoch.keyCommitment)throw new Error('Group key commitment mismatch');
        info=roomInfo(await decrypt(await aes(key),epoch.metadata,metadataContext(epoch)));
        newKey=[{epoch:epoch.keyEpoch,hash:epochHash(epoch),key}];
      }
      const after:GroupState={mode:'EPOCH_GROUP_V1',epoch,info,keys:[...(before?.keys??[]),...newKey].slice(-GROUP_LIMITS.keys),counter:before?.counter??0,publication:before?.publication??0,
        received:before?.received??{},highWater:before?.highWater??0,outbox:before?.outbox??[],senders:{}};
      if(await this.commit(epoch.roomId,before,after))return after;
    }throw new Error('Group state busy');
  }
  /** Operation rather than a replacement list prevents concurrent lost membership updates. */
  async change(room: string, operation: {add: DeviceBinding} | {remove: string} | {close: true}, expectedEpoch?: string) {
    for(let attempt=0;attempt<32;attempt++){
      const before=await this.state(room);if(!before)throw new Error('Unknown group');this.owner(before);
      if(expectedEpoch && epochHash(before.epoch)!==expectedEpoch)throw new Error('Stale group request');
      if(!before.epoch.members.length)throw new Error('Group closed');
      let members=before.epoch.members;
      if('add'in operation){
        if(members.some(b=>memberId(b)===memberId(operation.add)))throw new Error('Already enrolled; identity replacement requires removal');
        members=[...members,operation.add];
      } else if('remove'in operation){
        if(operation.remove===memberId(this.binding))throw new Error('Owner must close room');
        if(!members.some(b=>memberId(b)===operation.remove))throw new Error('Member absent');
        members=members.filter(b=>memberId(b)!==operation.remove);
      } else members=[];
      const {epoch,key}=await this.makeEpoch(room,members,before.info.name,before.info.description,before.epoch);
      const after={...before,epoch,senders:{},keys:[...before.keys,{epoch:epoch.keyEpoch,hash:epochHash(epoch),key}].slice(-GROUP_LIMITS.keys)};
      if(await this.commit(room,before,after))return epoch;
    }throw new Error('Group transition busy');
  }
  async candidate(room: string, text: string, senderName: string) {
    content(json({text,senderName}));
    for(let attempt=0;attempt<32;attempt++){
      const before=await this.state(room);if(!before)throw new Error('Group epoch unavailable');
      const header:GroupHeader={version:1,roomId:room,membershipEpoch:before.epoch.membershipEpoch,keyEpoch:before.epoch.keyEpoch,epochHash:epochHash(before.epoch),
        messageId:crypto.randomUUID(),senderAccount:this.binding.accountId,senderDevice:this.binding.deviceId,sequence:before.counter+1,timestamp:Date.now()};
      if(!positive(header.sequence))throw new Error('Sender sequence exhausted');
      const envelope:GroupEnvelope={header,...await encrypt(await aes(this.key(before)),json({text,senderName}),headerBytes(header)),signature:'',publication:0,receipt:''};
      envelope.signature=await sign(this.identity,authorshipBytes(envelope));
      if(await this.commit(room,before,{...before,counter:header.sequence}))return envelope;
    }throw new Error('Group send busy');
  }
  async authorize(room: string, candidate: GroupEnvelope) {
    for(let attempt=0;attempt<32;attempt++){
      const before=await this.state(room);if(!before)throw new Error('Group epoch unavailable');this.owner(before);
      await verifyEnvelope(candidate,before.epoch,false);
      const plain=content(await decrypt(await aes(this.key(before)),candidate,headerBytes(candidate.header)));
      const id=rowId(this.binding.accountId+room,candidate.header.messageId),existing=await StorageService.getChatMessage(id);
      if(existing){const old=JSON.parse(existing.encryptedEnvelope??'null');if(old && authorshipBytes(old)===authorshipBytes(candidate) && old.signature===candidate.signature)return old as GroupEnvelope;throw new Error('Group message identity conflict');}
      const sender=`${candidate.header.senderAccount}:${candidate.header.senderDevice}`;
      const window=before.senders[sender]??{high:0,seen:{}};
      if(candidate.header.sequence<=window.high-GROUP_LIMITS.replay || window.seen[String(candidate.header.sequence)])throw new Error('Already authorized or stale sender position');
      const high=Math.max(window.high,candidate.header.sequence);const seen:Record<string,string>={...window.seen,[candidate.header.sequence]:hash(authorshipBytes(candidate))};
      for(const n of Object.keys(seen))if(Number(n)<=high-GROUP_LIMITS.replay)delete seen[n];
      if(before.outbox.length>=GROUP_LIMITS.outbox)throw new Error('Group publication queue full');
      const envelope={...candidate,publication:before.publication+1};if(!positive(envelope.publication))throw new Error('Publication exhausted');
      envelope.receipt=await sign(this.identity,receiptBytes(envelope));
      const after={...before,publication:envelope.publication,senders:{...before.senders,[sender]:{high,seen}},outbox:[...before.outbox,envelope]};
      if(await this.commit(room,before,after,this.row(envelope,plain)))return envelope;
    }throw new Error('Group publication busy');
  }
  private row(e: GroupEnvelope, c: {text:string;senderName:string}): StoredChatMessage {
    return {id:rowId(this.binding.accountId+e.header.roomId,e.header.messageId),roomId:e.header.roomId,kind:'room',senderId:e.header.senderAccount,senderName:c.senderName,text:c.text,timestamp:e.header.timestamp,
      seq:e.publication,outgoing:e.header.senderAccount===this.binding.accountId,syncStatus:'pending',syncAttempts:0,encryptedEnvelope:json(e)};
  }
  async receive(room: string, envelope: GroupEnvelope): Promise<{status:'accepted'|'duplicate';row:StoredChatMessage}> {
    for(let attempt=0;attempt<32;attempt++){
      const before=await this.state(room);if(!before)throw new Error('Group epoch unavailable');
      bounded(envelope);
      const existing=await StorageService.getChatMessage(rowId(this.binding.accountId+room,envelope.header?.messageId));
      if(existing){if(existing.encryptedEnvelope===json(envelope))return {status:'duplicate',row:existing};throw new Error('Group message identity conflict');}
      await verifyEnvelope(envelope,before.epoch,true);
      if(envelope.publication<=before.highWater-GROUP_LIMITS.replay || before.received[String(envelope.publication)])throw new Error('Stale/reused group publication');
      const plain=content(await decrypt(await aes(this.key(before)),envelope,headerBytes(envelope.header)));
      const highWater=Math.max(before.highWater,envelope.publication);const received:Record<string,string>={...before.received,[envelope.publication]:hash(receiptBytes(envelope))};
      for(const n of Object.keys(received))if(Number(n)<=highWater-GROUP_LIMITS.replay)delete received[n];
      const row={...this.row(envelope,plain),syncStatus:'confirmed' as const};
      if(await this.commit(room,before,{...before,highWater,received},row))return {status:'accepted',row};
    }throw new Error('Group acceptance busy');
  }
  async published(room: string, envelope: GroupEnvelope) {
    for(let attempt=0;attempt<32;attempt++){
      const before=await this.state(room);if(!before)return;this.owner(before);
      const after={...before,outbox:before.outbox.filter(e=>json(e)!==json(envelope))};
      if(await this.commit(room,before,after)){
        const row=await StorageService.getChatMessage(rowId(this.binding.accountId+room,envelope.header.messageId));
        if(row && row.encryptedEnvelope===json(envelope))await StorageService.saveChatMessage({...row,syncStatus:'confirmed'});
        return;
      }
    }throw new Error('Group outbox busy');
  }
  async signControl(value: string) { return sign(this.identity,value); }
  async verifyControl(binding: DeviceBinding,value: string,signature: string) { await verifyBinding(binding,binding.accountId,binding.deviceId);return verify(binding,value,signature); }
}
