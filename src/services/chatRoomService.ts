/** Authenticated epoch rooms. Legacy shared-key rooms are read-only archives. */
import { GunService } from './gunService';
import { KeyVaultService } from './keyVaultService';
import { InviteLinkService } from './inviteLinkService';
import { StorageService } from './storageService';
import { gunReadChildren } from '../utils/gunAsync';
import { compareMessages } from '../utils/messageOrder';
import { GroupSecurity, GROUP_LIMITS, isEpochRoom, memberId, type Epoch } from './groupSecurity';
import { GroupRoomTransport } from './groupRoomTransport';
import { verifyBinding, type DeviceBinding } from './dmIdentity';
import type { StoredChatMessage, SyncStatus } from '../types/social';

export interface ChatRoom {
  id:string; name:string; description:string; creatorId:string; isEncrypted:boolean;
  encryptionHint:string; createdAt:number; memberCount:number;
  securityMode?:'LEGACY_SHARED_KEY'|'EPOCH_GROUP_V1';
}
export interface DisplayMessage {
  id:string; roomId:string; text:string; senderId:string; senderName:string; timestamp:number;
  seq?:number; status?:SyncStatus; error?:string;
}
function toDisplay(row:StoredChatMessage):DisplayMessage {
  return {id:row.id,roomId:row.roomId,text:row.text,senderId:row.senderId,senderName:row.senderName||'Anonymous',timestamp:row.timestamp,seq:row.seq,status:row.outgoing?row.syncStatus:undefined,error:row.error};
}
function roomDisplay(e:Epoch,info:{name:string;description:string}):ChatRoom {
  return {id:e.roomId,name:info.name,description:info.description,creatorId:e.owner.accountId,isEncrypted:true,
    encryptionHint:'Account/device membership; creator must be online',createdAt:e.createdAt,memberCount:e.members.length,securityMode:'EPOCH_GROUP_V1'};
}
let outboxLoopStarted=false;
let flushInFlight=false;

export class ChatRoomService {
  private static requireEpoch(room:string){if(!isEpochRoom(room))throw new Error('LEGACY_SHARED_KEY: explicit migration to a new authenticated room required');}
  private static async marker(epoch:Epoch,name:string){
    // Discovery/UI marker only, never an encryption key. No legacy key is reused.
    await KeyVaultService.storeKey({id:epoch.roomId,type:'chatroom',key:'epoch-v1',method:'invite',label:name,joinedAt:Date.now()});
  }
  static async createRoom(name:string,description:string,creatorId:string,password?:string):Promise<{room:ChatRoom;inviteLink:string}>{
    if(password)throw new Error('Epoch rooms require explicit device approval; password membership is legacy');
    const security=await GroupSecurity.local();
    if(creatorId!==security.binding.accountId)throw new Error('Room creator account mismatch');
    const epoch=await security.create(name,description);
    await this.marker(epoch,name);
    await GroupRoomTransport.startOwner(security,epoch.roomId);
    await GroupRoomTransport.publishEpoch(epoch);
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
  static async sendMessage(roomId:string,text:string,senderId:string,senderName:string):Promise<DisplayMessage>{
    this.requireEpoch(roomId);const security=await GroupSecurity.local();
    if(senderId!==security.binding.accountId)throw new Error('Group sender account mismatch');
    await GroupRoomTransport.refresh(security,roomId);await GroupRoomTransport.startOwner(security,roomId);
    const candidate=await security.candidate(roomId,text.trim(),senderName);
    const response=await GroupRoomTransport.submit(security,roomId,'send',candidate);
    if(!response.envelope)throw new Error('Publication receipt missing');
    const accepted=await security.receive(roomId,response.envelope);this.startOutboxLoop();return toDisplay(accepted.row);
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
}
