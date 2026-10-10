import { GunService } from './gunService';
import { gunOnce, gunPut, verifySoulOnRelay } from '../utils/gunAsync';
import { GUN_NAMESPACE } from './gunService';
import { GroupSecurity, GROUP_LIMITS, epochHash, joinContext, memberId, openSeal, proposalContext, sealTo, type Epoch, type GroupEnvelope, type GroupSignal } from './groupSecurity';
import { verifyBinding, type DeviceBinding } from './dmIdentity';
import { CryptoService } from './cryptoService';
import { StorageService } from './storageService';

type Request = { version:1; id:string; room:string; epoch:string; kind:'send'|'leave'; binding:DeviceBinding; candidate:GroupEnvelope|null; signature:string };
const requestBytes=(r:Request)=>JSON.stringify(['interpoll/group/request',1,r.id,r.room,r.epoch,r.kind,r.binding,r.candidate]);
export type JoinRequest = { version:1; room:string; id:string; binding:DeviceBinding; name:string; ts:number; password?:string };
const passKey=(account:string,room:string)=>`group-pass-v1:${account}:${room}`;
const MAX_PASSWORD_ATTEMPTS=5;
/** Room-wide budget: device ids are free to mint, so a per-id cap alone does not stop guessing. */
const ROOM_CHECKS_PER_WINDOW=10, ROOM_CHECK_WINDOW_MS=10*60_000;
const b64=(x:ArrayBuffer|Uint8Array)=>{let s='';for(const b of new Uint8Array(x))s+=String.fromCharCode(b);return btoa(s);};
async function pbkdf2(password:string,salt:string){
  const material=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
  const salted=Uint8Array.from(atob(salt),c=>c.charCodeAt(0));
  return b64(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:salted,iterations:210000},material,256));
}
const declinedKey=(account:string,room:string)=>`group-declined-v1:${account}:${room}`;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Gun supplies bytes only. The pinned owner device supplies group authority. */
export class GroupRoomTransport {
  private static listeners=new Map<string,()=>void>();
  private static passwordFailures=new Map<string,number>();
  private static roomChecks=new Map<string,number[]>();
  private static takeRoomCheck(room:string){
    const now=Date.now(),recent=(this.roomChecks.get(room)??[]).filter(t=>now-t<ROOM_CHECK_WINDOW_MS);
    if(recent.length>=ROOM_CHECKS_PER_WINDOW){this.roomChecks.set(room,recent);return false;}
    recent.push(now);this.roomChecks.set(room,recent);return true;
  }
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
    const epoch=JSON.parse(raw.epoch) as Epoch;
    if(epoch.roomId!==room)throw new Error('Requested group identity mismatch');
    return security.adopt(epoch);
  }
  /** Publishes this device's queue; the owner also republishes the epoch. */
  static async flush(security:GroupSecurity,room:string){
    const state=await security.state(room);if(!state)return;
    if(memberId(state.epoch.owner)===memberId(security.binding))await this.publishEpoch(state.epoch);
    for(const e of state.outbox){
      const ack=await gunPut(this.node(room).get('messages').get(e.header.messageId),{envelope:JSON.stringify(e)});
      if(!ack.ok)continue;
      // null = the relay has no inspection endpoint; a peer ack is then the best evidence available.
      const held=await verifySoulOnRelay(`${GUN_NAMESPACE}/chatrooms/${room}/messages/${e.header.messageId}`,6000);
      if(held!==false)await security.published(room,e);
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
      try{joins?.off?.();}catch{/* replaced graph */}
      joins=this.node(room).get('joins').map().on((raw:any,id:string)=>{
        if(!stopped && raw)void this.autoAdmit(security,room,id,raw).catch(()=>{});
      });
      void this.flush(security,room).catch(()=>{});
    };
    let joins:any;
    attach();const reconnect=GunService.onReconnect(attach);
    const timer=setInterval(()=>{void this.flush(security,room).catch(()=>{});},60000);
    this.listeners.set(key,()=>{stopped=true;chain?.off?.();joins?.off?.();reconnect();clearInterval(timer);});
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

  /** Non-member asks the owner device for admission. Sealed to the owner: the relay sees only an opaque blob. */
  static async requestJoin(security:GroupSecurity,room:string,name:string,password?:string):Promise<'member'|'requested'>{
    const state=await this.refresh(security,room);
    if(state.epoch.members.some(b=>memberId(b)===memberId(security.binding)))return 'member';
    if(!state.epoch.members.length)throw new Error('This group has been closed');
    const id=CryptoService.hash(memberId(security.binding));
    const request:JoinRequest={version:1,room,id,binding:security.binding,name:name.slice(0,256),ts:Date.now(),...(password?{password:password.slice(0,256)}:{})};
    const sealed=await sealTo(state.epoch.owner,JSON.stringify(request),joinContext(room,id));
    const ack=await gunPut(this.node(room).get('joins').get(id),{sealed:JSON.stringify(sealed)});
    if(!ack.ok)throw new Error('Join request not accepted by transport');
    return 'requested';
  }
  private static async openJoin(security:GroupSecurity,room:string,id:string,raw:any):Promise<JoinRequest|null>{
    try{
      if(!/^[0-9a-f]{64}$/.test(id) || typeof raw?.sealed!=='string' || raw.sealed.length>16384)return null;
      const request=JSON.parse(await openSeal(security.identity,JSON.parse(raw.sealed),joinContext(room,id))) as JoinRequest;
      if(request.version!==1 || request.room!==room || request.id!==id || typeof request.name!=='string' || request.name.length>256 || !Number.isSafeInteger(request.ts))return null;
      if(request.password!==undefined && (typeof request.password!=='string' || request.password.length>256))return null;
      await verifyBinding(request.binding,request.binding.accountId,request.binding.deviceId);
      // The request id commits to the binding, so a relay cannot swap identities under an id.
      if(CryptoService.hash(memberId(request.binding))!==id)return null;
      return request;
    }catch{return null;}
  }
  /** Owner only: live pending admission requests, minus members and declined ones. */
  static watchJoins(security:GroupSecurity,room:string,onChange:(pending:JoinRequest[])=>void):()=>void{
    const pending=new Map<string,JoinRequest>();let active=true,chain:any;
    const emit=async()=>{
      const state=await security.state(room),declined:Record<string,number>=(await StorageService.getMetadata(declinedKey(security.binding.accountId,room)))??{};
      if(!active || !state)return;
      const members=new Set(state.epoch.members.map(memberId));
      onChange([...pending.values()].filter(r=>!members.has(memberId(r.binding)) && !((declined[r.id]??0)>=r.ts)).sort((a,b)=>a.ts-b.ts));
    };
    const attach=()=>{
      chain?.off?.();
      chain=this.node(room).get('joins').map().on((raw:any,id:string)=>{
        if(!active)return;
        void this.openJoin(security,room,id,raw).then(r=>{if(r && active){pending.set(r.id,r);void emit();}});
      });
    };
    attach();const reconnect=GunService.onReconnect(attach);
    return ()=>{active=false;chain?.off?.();reconnect();};
  }
  static async declineJoin(security:GroupSecurity,room:string,request:JoinRequest){
    const key=declinedKey(security.binding.accountId,room),declined=(await StorageService.getMetadata(key))??{};
    await StorageService.setMetadata(key,{...declined,[request.id]:request.ts});
  }
  static async sendSignal(security:GroupSecurity,room:string,body:{name:string;typing:number;read:number;relays?:string[]}){
    const sealed=await security.sealSignal(room,body);
    await gunPut(this.node(room).get('signals').get(CryptoService.hash(memberId(security.binding))),{s:sealed},4000);
  }
  static watchSignals(security:GroupSecurity,room:string,onSignal:(signal:GroupSignal)=>void):()=>void{
    let active=true,chain:any;
    const attach=()=>{
      chain?.off?.();
      chain=this.node(room).get('signals').map().on((raw:any)=>{
        if(!active || typeof raw?.s!=='string')return;
        void security.openSignal(room,raw.s).then(sig=>{if(sig && active)onSignal(sig);});
      });
    };
    attach();const reconnect=GunService.onReconnect(attach);
    return ()=>{active=false;chain?.off?.();reconnect();};
  }

  // ── Password rooms: the owner device admits any joiner whose sealed request carries the password. ──
  static async setPassword(security:GroupSecurity,room:string,password:string){
    const salt=b64(crypto.getRandomValues(new Uint8Array(16)));
    await StorageService.setMetadata(passKey(security.binding.accountId,room),{salt,hash:await pbkdf2(password,salt)});
    // Public hint only, so joiners know to show a password field. The secret never leaves the owner.
    const ack=await gunPut(this.node(room),{access:'password'});
    if(!ack.ok)throw new Error('Room access mode not published');
  }
  static async accessMode(room:string):Promise<'password'|'approval'>{
    // `once` may report "absent" before the relay answers; subscribe and wait for the value instead.
    return new Promise(resolve=>{
      const field=this.node(room).get('access');let done=false;
      const finish=(mode:'password'|'approval')=>{if(done)return;done=true;clearTimeout(timer);try{field.off();}catch{/* detached */}resolve(mode);};
      const timer=setTimeout(()=>finish('approval'),10000);
      field.on((value:any)=>{if(value==='password')finish('password');});
    });
  }
  static async checkPassword(security:GroupSecurity,room:string,password:string):Promise<boolean>{
    const record=await StorageService.getMetadata(passKey(security.binding.accountId,room)) as {salt:string;hash:string}|undefined;
    if(!record)return false;
    const hash=await pbkdf2(password,record.salt);
    // Constant-time compare of equal-length base64 strings.
    let diff=hash.length^record.hash.length;
    for(let i=0;i<Math.min(hash.length,record.hash.length);i++)diff|=hash.charCodeAt(i)^record.hash.charCodeAt(i);
    return diff===0;
  }
  private static async autoAdmit(security:GroupSecurity,room:string,id:string,raw:any){
    const request=await this.openJoin(security,room,id,raw);
    if(!request?.password)return;
    const state=await security.state(room);
    if(!state || memberId(state.epoch.owner)!==memberId(security.binding) || !state.epoch.members.length)return;
    if(state.epoch.members.some(b=>memberId(b)===memberId(request.binding)))return;
    const failures=this.passwordFailures.get(id)??0;
    if(failures>=MAX_PASSWORD_ATTEMPTS)return;
    // Over budget: leave it pending for manual approval rather than burning CPU on guesses.
    if(!this.takeRoomCheck(room))return;
    if(!await this.checkPassword(security,room,request.password)){this.passwordFailures.set(id,failures+1);return;}
    const epoch=await security.change(room,{add:request.binding});
    await this.publishEpoch(epoch);
  }
}
