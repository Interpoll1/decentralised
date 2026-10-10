/** Authenticated epoch rooms. Legacy shared-key rooms are read-only archives. */
import { GunService } from './gunService';
import config, { PRIVATE_PEERS, PUBLIC_PEERS } from '../config';
import { KeyVaultService } from './keyVaultService';
import { InviteLinkService } from './inviteLinkService';
import { StorageService } from './storageService';
import { gunReadChildren } from '../utils/gunAsync';
import { compareMessages } from '../utils/messageOrder';
import { GroupSecurity, GROUP_LIMITS, isEpochRoom, memberId, type Epoch } from './groupSecurity';
import { GroupRoomTransport, type JoinRequest } from './groupRoomTransport';
import { verifyBinding, type DeviceBinding } from './dmIdentity';
import { encryptAndUpload, fetchAndDecrypt } from './chatMediaService';
import { validRelay, type GroupSignal } from './groupSecurity';
import type { GroupExt, GroupMedia, StoredChatMessage, SyncStatus } from '../types/social';
export type { JoinRequest } from './groupRoomTransport';
export type { GroupSignal } from './groupSecurity';

export interface ChatRoom {
  id:string; name:string; description:string; creatorId:string; isEncrypted:boolean;
  encryptionHint:string; createdAt:number; memberCount:number;
  securityMode?:'LEGACY_SHARED_KEY'|'EPOCH_GROUP_V1';
}
export interface DisplayMessage {
  id:string; roomId:string; text:string; senderId:string; senderName:string; timestamp:number;
  seq?:number; status?:SyncStatus; error?:string;
  /** Group header messageId: what replies, reactions and edits point at. */
  messageId:string; ext?:GroupExt;
}
export interface RoomMember { accountId:string; deviceId:string; isOwner:boolean; isSelf:boolean }
export interface RoomSummary { unread:number; mentions:number; last?:{text:string;senderName:string;timestamp:number} }
/** Only these rows appear as bubbles; everything else is an action on one. */
export const isVisibleRow=(ext?:GroupExt)=>!ext || ext.k==='msg' || ext.k==='poll';
function toDisplay(row:StoredChatMessage):DisplayMessage {
  return {id:row.id,roomId:row.roomId,text:row.text,senderId:row.senderId,senderName:row.senderName||'Anonymous',timestamp:row.timestamp,seq:row.seq,status:row.outgoing?row.syncStatus:undefined,error:row.error,
    messageId:row.id.split(':').pop()!,...(row.ext?{ext:row.ext}:{})};
}
const readKey=(room:string)=>`group-read-v1:${room}`;
const namesKey=(room:string)=>`group-names-v1:${room}`;
function roomDisplay(e:Epoch,info:{name:string;description:string}):ChatRoom {
  return {id:e.roomId,name:info.name,description:info.description,creatorId:e.owner.accountId,isEncrypted:true,
    encryptionHint:'Account/device membership; creator must be online',createdAt:e.createdAt,memberCount:e.members.length,securityMode:'EPOCH_GROUP_V1'};
}
let outboxLoopStarted=false;
const MAX_ADOPTED_RELAYS=4;
const adoptedRelays=new Set<string>();
let flushInFlight=false;

export class ChatRoomService {
  private static requireEpoch(room:string){if(!isEpochRoom(room))throw new Error('LEGACY_SHARED_KEY: explicit migration to a new authenticated room required');}
  private static async marker(epoch:Epoch,name:string){
    // Discovery/UI marker only, never an encryption key. No legacy key is reused.
    await KeyVaultService.storeKey({id:epoch.roomId,type:'chatroom',key:'epoch-v1',method:'invite',label:name,joinedAt:Date.now()});
  }
  static async createRoom(name:string,description:string,creatorId:string,password?:string):Promise<{room:ChatRoom;inviteLink:string}>{
    const security=await GroupSecurity.local();
    if(creatorId!==security.binding.accountId)throw new Error('Room creator account mismatch');
    const epoch=await security.create(name,description);
    await this.marker(epoch,name);
    await GroupRoomTransport.startOwner(security,epoch.roomId);
    await GroupRoomTransport.publishEpoch(epoch);
    if(password)await GroupRoomTransport.setPassword(security,epoch.roomId,password);
    return {room:roomDisplay(epoch,{name,description}),inviteLink:InviteLinkService.generateInviteLink(epoch.roomId,'chatroom','epoch-v1')};
  }
  static async joinRoom(roomId:string,keyOrPassword:string,method:'invite'|'password'):Promise<ChatRoom>{
    this.requireEpoch(roomId);
    if(method!=='invite' || keyOrPassword!=='epoch-v1')throw new Error('Authenticated room invite required');
    const security=await GroupSecurity.local(),state=await GroupRoomTransport.refresh(security,roomId);
    if(!state.epoch.members.some(b=>memberId(b)===memberId(security.binding)))throw new Error('Owner must explicitly approve this account/device before joining');
    await this.marker(state.epoch,state.info.name);await GroupRoomTransport.startOwner(security,roomId);return roomDisplay(state.epoch,state.info);
  }
  /** Explicit owner approval; discovery alone never invokes this method. */
  static async approveMember(roomId:string,expectedAccount:string,expectedDevice:string,binding:DeviceBinding){
    this.requireEpoch(roomId);await verifyBinding(binding,expectedAccount,expectedDevice);
    const security=await GroupSecurity.local(),epoch=await security.change(roomId,{add:binding});
    await GroupRoomTransport.publishEpoch(epoch);return roomDisplay(epoch,(await security.state(roomId))!.info);
  }
  static async removeMember(roomId:string,account:string,device:string){
    this.requireEpoch(roomId);const security=await GroupSecurity.local(),epoch=await security.change(roomId,{remove:`${account}:${device}`});
    await GroupRoomTransport.publishEpoch(epoch);return roomDisplay(epoch,(await security.state(roomId))!.info);
  }
  static async getMemberCount(roomId:string,_fallback=1){
    this.requireEpoch(roomId);const security=await GroupSecurity.local();return (await GroupRoomTransport.refresh(security,roomId)).epoch.members.length;
  }
  static async leaveRoom(roomId:string):Promise<void>{
    this.requireEpoch(roomId);const security=await GroupSecurity.local();await GroupRoomTransport.refresh(security,roomId);
    await GroupRoomTransport.submit(security,roomId,'leave',null);
    // Revocation must succeed before the local UI/key marker is removed.
    await KeyVaultService.removeKey(roomId);
    const rows=await StorageService.getChatMessagesByRoom(roomId);
    await Promise.all(rows.map(row=>StorageService.deleteChatMessage(row.id)));
    // Keep the epoch pin/replay high water so a stale invite cannot restore access.
  }
  static async sendMessage(roomId:string,text:string,senderId:string,senderName:string,ext?:GroupExt):Promise<DisplayMessage>{
    this.requireEpoch(roomId);const security=await GroupSecurity.local();
    if(senderId!==security.binding.accountId)throw new Error('Group sender account mismatch');
    await GroupRoomTransport.refresh(security,roomId);await GroupRoomTransport.startOwner(security,roomId);
    const candidate=await security.candidate(roomId,text.trim(),senderName,ext);
    // Signed by this device and published directly — no owner round-trip, so the
    // group keeps working while the creator is offline.
    const row=await security.publishOwn(roomId,candidate);
    void GroupRoomTransport.flush(security,roomId).catch(()=>{});
    this.startOutboxLoop();return toDisplay(row);
  }
  static async flushOutbox():Promise<void>{
    if(flushInFlight)return;flushInFlight=true;
    try{
      const security=await GroupSecurity.local();
      for(const key of await KeyVaultService.listKeysByType('chatroom')){
        if(isEpochRoom(key.id))await GroupRoomTransport.flush(security,key.id).catch(()=>{});
      }
    }finally{flushInFlight=false;}
  }
  static startOutboxLoop(){
    if(outboxLoopStarted || typeof window==='undefined')return;outboxLoopStarted=true;
    GunService.onReconnect(()=>{void this.flushOutbox().catch(()=>{});});
    window.addEventListener('online',()=>{void this.flushOutbox().catch(()=>{});});
    setInterval(()=>{void this.flushOutbox().catch(()=>{});},60000);
  }
  private static async decodeMessage(roomId:string,data:any):Promise<StoredChatMessage|null>{
    if(!isEpochRoom(roomId) || typeof data?.envelope!=='string' || data.envelope.length>GROUP_LIMITS.recordBytes)return null;
    try{
      const security=await GroupSecurity.local();await GroupRoomTransport.refresh(security,roomId);
      return (await security.receive(roomId,JSON.parse(data.envelope))).row;
    }catch{return null;}
  }
  static async getLocalHistory(roomId:string):Promise<DisplayMessage[]>{
    return (await StorageService.getChatMessagesByRoom(roomId)).filter(row=>row.kind==='room').sort(compareMessages).map(row=>{
      const display=toDisplay(row);
      return isEpochRoom(roomId)?display:{...display,senderId:'',senderName:`Legacy unverified: ${display.senderName}`};
    });
  }
  static async loadHistory(roomId:string):Promise<DisplayMessage[]>{
    if(!isEpochRoom(roomId))return this.getLocalHistory(roomId);
    const records=await gunReadChildren<any>(GroupRoomTransport.node(roomId).get('messages'),{minMs:600,maxMs:8000});
    for(const {value} of records)await this.decodeMessage(roomId,value);
    return this.getLocalHistory(roomId);
  }
  static subscribeToMessages(roomId:string,callback:(message:DisplayMessage)=>void):()=>void{
    if(!isEpochRoom(roomId))return ()=>{};
    let active=true,inflight=0,chain:any;
    const attach=()=>{
      if(!active)return;
      chain=GroupRoomTransport.node(roomId).get('messages').map().on((data:any)=>{
        if(!active || inflight>=GROUP_LIMITS.requests)return;inflight++;
        void this.decodeMessage(roomId,data).then(row=>{if(row && active)callback(toDisplay(row));}).finally(()=>{inflight--;});
      });
    };
    attach();const reconnect=GunService.onReconnect(()=>{chain?.off?.();attach();});
    return ()=>{active=false;chain?.off?.();reconnect();};
  }
  static async listJoinedRooms():Promise<ChatRoom[]>{
    const security=await GroupSecurity.local(),rooms:ChatRoom[]=[];
    for(const key of await KeyVaultService.listKeysByType('chatroom')){
      if(!isEpochRoom(key.id)){
        rooms.push({id:key.id,name:key.label||'Legacy room',description:'Read-only legacy shared-key archive; explicit new-room migration required',creatorId:'',isEncrypted:true,encryptionHint:'Legacy: authorship and revocation unverified',createdAt:key.joinedAt,memberCount:0,securityMode:'LEGACY_SHARED_KEY'});continue;
      }
      const state=await GroupRoomTransport.refresh(security,key.id).catch(()=>security.state(key.id));
      if(!state || !state.epoch.members.some(b=>memberId(b)===memberId(security.binding)))continue;
      rooms.push(roomDisplay(state.epoch,state.info));await GroupRoomTransport.startOwner(security,key.id);
    }
    return rooms.sort((a,b)=>b.createdAt-a.createdAt);
  }

  // ── Membership ─────────────────────────────────────────────────────────
  static async requestJoin(roomId:string,name:string,password?:string):Promise<'member'|'requested'>{
    this.requireEpoch(roomId);return GroupRoomTransport.requestJoin(await GroupSecurity.local(),roomId,name,password);
  }
  /** 'password' rooms admit automatically on the right password; others wait for the owner. */
  static async accessMode(roomId:string){this.requireEpoch(roomId);return GroupRoomTransport.accessMode(roomId);}
  static async watchJoinRequests(roomId:string,onChange:(pending:JoinRequest[])=>void):Promise<()=>void>{
    this.requireEpoch(roomId);const security=await GroupSecurity.local(),state=await security.state(roomId);
    if(!state || memberId(state.epoch.owner)!==memberId(security.binding))return ()=>{};
    return GroupRoomTransport.watchJoins(security,roomId,onChange);
  }
  static async approveJoin(roomId:string,request:JoinRequest){
    const room=await this.approveMember(roomId,request.binding.accountId,request.binding.deviceId,request.binding);
    if(request.name)await this.rememberNames(roomId,{[request.binding.accountId]:request.name});
    return room;
  }
  static async declineJoin(roomId:string,request:JoinRequest){await GroupRoomTransport.declineJoin(await GroupSecurity.local(),roomId,request);}
  static async listMembers(roomId:string):Promise<RoomMember[]>{
    this.requireEpoch(roomId);const security=await GroupSecurity.local(),state=await security.state(roomId);if(!state)return [];
    return state.epoch.members.map(b=>({accountId:b.accountId,deviceId:b.deviceId,isOwner:memberId(b)===memberId(state.epoch.owner),isSelf:memberId(b)===memberId(security.binding)}));
  }
  static onMembershipChange(cb:(roomId:string)=>void){return GroupRoomTransport.onEpochChange(cb);}
  static async isOwner(roomId:string){
    if(!isEpochRoom(roomId))return false;const security=await GroupSecurity.local(),state=await security.state(roomId);
    return !!state && memberId(state.epoch.owner)===memberId(security.binding);
  }
  /** Best-effort display names learned from join requests, messages and signals. */
  static async getNames(roomId:string):Promise<Record<string,string>>{return (await StorageService.getMetadata(namesKey(roomId)))??{};}
  static async rememberNames(roomId:string,names:Record<string,string>){
    const before=await this.getNames(roomId);
    if(Object.entries(names).every(([k,v])=>before[k]===v))return;
    await StorageService.setMetadata(namesKey(roomId),{...before,...names});
  }
  // ── Ephemeral signals (typing / presence / read) ───────────────────────
  static async sendSignal(roomId:string,body:{name:string;typing:number;read:number}){
    if(!isEpochRoom(roomId))return;
    await GroupRoomTransport.sendSignal(await GroupSecurity.local(),roomId,{...body,relays:GunService.peerUrls().filter(validRelay)});
  }
  /**
   * Connect to relays other members use, so members on different relays still
   * share at least one path. Only relays from this app's own directory are
   * eligible: an arbitrary member-supplied URL would let any member learn every
   * other member's IP address. Session-only and capped.
   */
  static adoptRelays(urls:string[]):string[]{
    const strip=(u:string)=>u.replace(/\/$/,'');
    const directory=new Set([...PRIVATE_PEERS,...PUBLIC_PEERS,...config.getGunPeers()].map(strip));
    const known=new Set(GunService.peerUrls().map(strip));
    const added:string[]=[];
    for(const url of urls.filter(validRelay)){
      const clean=strip(url);
      if(!directory.has(clean) || known.has(clean) || adoptedRelays.size>=MAX_ADOPTED_RELAYS)continue;
      adoptedRelays.add(clean);known.add(clean);GunService.addPeerDynamic(clean);added.push(clean);
    }
    return added;
  }
  static async watchSignals(roomId:string,onSignal:(signal:GroupSignal)=>void):Promise<()=>void>{
    if(!isEpochRoom(roomId))return ()=>{};return GroupRoomTransport.watchSignals(await GroupSecurity.local(),roomId,onSignal);
  }
  // ── Media ──────────────────────────────────────────────────────────────
  static async uploadMedia(file:File):Promise<GroupMedia>{
    const security=await GroupSecurity.local();return encryptAndUpload(file,security.binding.accountId);
  }
  static async openMedia(media:GroupMedia):Promise<string>{
    const security=await GroupSecurity.local();return fetchAndDecrypt(media,security.binding.accountId);
  }
  // ── Local read position ────────────────────────────────────────────────
  static async getReadMark(roomId:string):Promise<number>{return (await StorageService.getMetadata(readKey(roomId)))??0;}
  static async setReadMark(roomId:string,timestamp:number){
    if(timestamp>await this.getReadMark(roomId))await StorageService.setMetadata(readKey(roomId),timestamp);
  }
  static async summary(roomId:string,myAccount:string):Promise<RoomSummary>{
    const [rows,mark]=await Promise.all([StorageService.getChatMessagesByRoom(roomId),this.getReadMark(roomId)]);
    const visible=rows.filter(r=>r.kind==='room' && isVisibleRow(r.ext)).sort(compareMessages);
    const fresh=visible.filter(r=>!r.outgoing && r.senderId!==myAccount && r.timestamp>mark);
    const last=visible.at(-1);
    const preview=(r:StoredChatMessage)=>r.ext?.k==='poll'?`📊 ${r.ext.question}`:r.ext?.k==='msg' && r.ext.media?`📎 ${r.ext.media.mediaType.startsWith('image/')?'Photo':r.ext.media.mediaType.startsWith('audio/')?'Voice message':r.ext.media.mediaType.startsWith('video/')?'Video':r.ext.media.mediaName||'File'}`:r.text;
    return {unread:fresh.length,mentions:fresh.filter(r=>r.ext?.k==='msg' && r.ext.mentions?.includes(myAccount)).length,
      ...(last?{last:{text:preview(last),senderName:last.outgoing?'You':last.senderName||'Anonymous',timestamp:last.timestamp}}:{})};
  }
}
