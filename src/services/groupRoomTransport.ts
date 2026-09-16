import { GunService } from './gunService';
import { gunOnce, gunPut, verifySoulOnRelay } from '../utils/gunAsync';
import { GUN_NAMESPACE } from './gunService';
import { GroupSecurity, GROUP_LIMITS, epochHash, memberId, openSeal, proposalContext, sealTo, type Epoch, type GroupEnvelope } from './groupSecurity';
import type { DeviceBinding } from './dmIdentity';

type Request = { version:1; id:string; room:string; epoch:string; kind:'send'|'leave'; binding:DeviceBinding; candidate:GroupEnvelope|null; signature:string };
const requestBytes=(r:Request)=>JSON.stringify(['interpoll/group/request',1,r.id,r.room,r.epoch,r.kind,r.binding,r.candidate]);
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Gun supplies bytes only. The pinned owner device supplies group authority. */
export class GroupRoomTransport {
  private static listeners=new Map<string,()=>void>();
  private static active=0;
  private static requests=0;
  static node(room:string){return GunService.getGun().get('chatrooms').get(room);}
  static async publishEpoch(epoch:Epoch){
    const ack=await gunPut(this.node(epoch.roomId),{epoch:JSON.stringify(epoch)});
    if(!ack.ok)throw new Error('Group epoch publication pending');
  }
  static async refresh(security:GroupSecurity,room:string){
    const own=await security.state(room);
    // The authority reads its durable state, never a relay replacement.
    if(own && memberId(own.epoch.owner)===memberId(security.binding))return own;
    const raw=await gunOnce<any>(this.node(room),6000);
    if(typeof raw?.epoch!=='string' || raw.epoch.length>GROUP_LIMITS.recordBytes)throw new Error('Authenticated group epoch unavailable');
    return security.adopt(JSON.parse(raw.epoch));
  }
  static async flush(security:GroupSecurity,room:string){
    const state=await security.state(room);if(!state || memberId(state.epoch.owner)!==memberId(security.binding))return;
    await this.publishEpoch(state.epoch);
    for(const e of state.outbox){
      const ack=await gunPut(this.node(room).get('messages').get(e.header.messageId),{envelope:JSON.stringify(e)});
      if(ack.ok && await verifySoulOnRelay(`${GUN_NAMESPACE}/chatrooms/${room}/messages/${e.header.messageId}`,6000)===true)await security.published(room,e);
    }
  }
  static async process(security:GroupSecurity,room:string,id:string,raw:any){
    if(!uuid.test(id) || typeof raw?.sealed!=='string' || raw.sealed.length>GROUP_LIMITS.recordBytes)throw new Error('Malformed group request');
    const request=JSON.parse(await openSeal(security.identity,JSON.parse(raw.sealed),proposalContext(room,id))) as Request;
    if(request.version!==1 || request.id!==id || request.room!==room || !['send','leave'].includes(request.kind))throw new Error('Invalid group request context');
    await security.verifyControl(request.binding,requestBytes(request),request.signature);
    const state=await security.state(room);
    if(!state || memberId(state.epoch.owner)!==memberId(security.binding) || request.epoch!==epochHash(state.epoch))throw new Error('Stale group request');
    const sender=state.epoch.members.find(b=>memberId(b)===memberId(request.binding));
    if(!sender || JSON.stringify(sender)!==JSON.stringify(request.binding))throw new Error('Unauthorized group requester');
    if(request.kind==='leave'){
      if(request.candidate!==null)throw new Error('Invalid leave');
      // Epoch precondition is rechecked inside the transition CAS.
      const epoch=await security.change(room,{remove:memberId(request.binding)},request.epoch);
      return {epoch};
    }
    const candidate=request.candidate;
    if(!candidate || candidate.header.senderAccount!==sender.accountId || candidate.header.senderDevice!==sender.deviceId)throw new Error('Group sender mismatch');
    return {envelope:await security.authorize(room,candidate)};
  }
  static async startOwner(security:GroupSecurity,room:string){
    const state=await security.state(room);if(!state || memberId(state.epoch.owner)!==memberId(security.binding))return;
    const key=`${memberId(security.binding)}:${room}`;if(this.listeners.has(key))return;
    if(this.listeners.size>=100)throw new Error('Group listener limit');
    let chain:any;let stopped=false;
    const attach=()=>{
      try{chain?.off?.();}catch{/* replaced graph */}
      chain=this.node(room).get('requests').map().on((raw:any,id:string)=>{
        if(stopped || this.active>=GROUP_LIMITS.requests || !raw)return;
        this.active++;
        void this.process(security,room,id,raw).then(async response=>{
          if(response.epoch)await this.publishEpoch(response.epoch);
          await gunPut(this.node(room).get('responses').get(id),{response:JSON.stringify(response)});
          await this.flush(security,room);
        }).catch(()=>{/* Unauthenticated/stale requests create no durable state. */}).finally(()=>{this.active--;});
      });
      void this.flush(security,room).catch(()=>{});
    };
    attach();const reconnect=GunService.onReconnect(attach);
    const timer=setInterval(()=>{void this.flush(security,room).catch(()=>{});},60000);
    this.listeners.set(key,()=>{stopped=true;chain?.off?.();reconnect();clearInterval(timer);});
  }
  static stopAll(){for(const stop of this.listeners.values())stop();this.listeners.clear();}
  static async submit(security:GroupSecurity,room:string,kind:'send'|'leave',candidate:GroupEnvelope|null){
    if(this.requests>=GROUP_LIMITS.requests)throw new Error('Group request limit');
    this.requests++;
    try{
      const state=await security.state(room);if(!state)throw new Error('Group epoch missing');
      if(memberId(state.epoch.owner)===memberId(security.binding)){
        if(kind==='leave'){const epoch=await security.change(room,{close:true});await this.publishEpoch(epoch);return {epoch};}
        const envelope=await security.authorize(room,candidate!);void this.flush(security,room).catch(()=>{});return {envelope};
      }
      const id=crypto.randomUUID();
      const request:Request={version:1,id,room,epoch:epochHash(state.epoch),kind,binding:security.binding,candidate,signature:''};
      request.signature=await security.signControl(requestBytes(request));
      const sealed=await sealTo(state.epoch.owner,JSON.stringify(request),proposalContext(room,id));
      // Never send the inner old-key ciphertext to public message storage.
      const ack=await gunPut(this.node(room).get('requests').get(id),{sealed:JSON.stringify(sealed)});
      if(!ack.ok)throw new Error('Group request not accepted by transport');
      for(let attempt=0;attempt<4;attempt++){
        const raw=await gunOnce<any>(this.node(room).get('responses').get(id),3000);
        if(typeof raw?.response==='string' && raw.response.length<=GROUP_LIMITS.recordBytes){
          const response=JSON.parse(raw.response);
          if(kind==='leave' && response.epoch){
            if(response.epoch.roomId!==room || response.epoch.membershipEpoch<=state.epoch.membershipEpoch || response.epoch.members.some((b:DeviceBinding)=>memberId(b)===memberId(security.binding)))throw new Error('Leave not revoked');
            await security.adopt(response.epoch);return response as {epoch:Epoch};
          }
          if(kind==='send' && response.envelope){
            if(JSON.stringify(response.envelope.header)!==JSON.stringify(candidate!.header) || response.envelope.ciphertext!==candidate!.ciphertext || response.envelope.signature!==candidate!.signature)throw new Error('Group response substituted');
            await security.receive(room,response.envelope);return response as {envelope:GroupEnvelope};
          }
        }
        await new Promise(resolve=>setTimeout(resolve,500));
      }
      throw new Error('Owner device unavailable or request stale; refresh and retry');
    }finally{this.requests--;}
  }
}
