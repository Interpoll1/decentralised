import 'fake-indexeddb/auto';
import {beforeEach,it,expect,vi} from 'vitest';
vi.mock('../src/services/gunService',()=>({GunService:{getGun:vi.fn()},GUN_NAMESPACE:'test'}));
vi.mock('../src/utils/gunAsync',()=>({gunPut:vi.fn(),gunOnce:vi.fn(),gunReadChildren:vi.fn(),toGunRecord:(x:unknown)=>x}));
import ChatService from '../src/services/chatService';
import {StorageService} from '../src/services/storageService';
import {SignalSession} from '../src/services/signalProtocol';
import {createEpoch,verifyEpoch} from '../src/services/dmSessionEpoch';
import {ALICE,BOB,getOrCreateIdentityBundle} from './dmIdentityFixture';
beforeEach(async()=>{const db=await StorageService.getDB();await db.clear('metadata');await db.clear('chat-messages');});
async function snapshot(){const db=await StorageService.getDB();return JSON.stringify([await db.getAllKeys('metadata'),await db.getAll('metadata'),await db.getAll('chat-messages')]);}
async function peers(){const a=await getOrCreateIdentityBundle(ALICE),b=await getOrCreateIdentityBundle(BOB);for(const x of [a,b]){x.bundle.opks=[];x.bundle.selectedOPK=null;delete x.bundle.opk;delete x.bundle.opkId;}return {a,b,s:new SignalSession(ALICE,BOB),r:new SignalSession(BOB,ALICE)};}
async function established(){const p=await peers();const first=await p.s.encrypt('first',p.a,p.b.bundle);await p.r.decrypt(first,p.b,p.a.bundle.ik,BOB);const reply=await p.r.encrypt('reply',p.b,p.a.bundle);await p.s.decrypt(reply,p.a,p.b.bundle.ik,ALICE);const next=await p.s.encrypt('advance',p.a,p.b.bundle);await p.r.decrypt(next,p.b,p.a.bundle.ik,BOB);return {...p,first};}
it('unauthenticated relay reset controls cannot erase an advanced session',async()=>{
 const {first,b,a,r}=await established();const service:any=new ChatService('wss://example.invalid',BOB);const before=await snapshot();
 for(const type of ['chat-start','chat-invite']){await service.handleWsMessage({type,from:ALICE});expect(await snapshot()).toBe(before);}
 await expect(r.decrypt(first,b,a.bundle.ik,BOB)).rejects.toThrow();expect(await snapshot()).toBe(before);
});
it('historical bootstrap cannot become fresh authority after ratchet state loss',async()=>{
 const {first,b,a}=await established();await StorageService.setMetadata(`signal-session:${BOB}:${ALICE}`,null);const before=await snapshot();
 await expect(new SignalSession(BOB,ALICE).decrypt(first,b,a.bundle.ik,BOB)).rejects.toThrow();expect(await snapshot()).toBe(before);
});

async function epoch(local=ALICE,peer=BOB){return StorageService.getMetadata(`dm-session-epoch-v1:${local}:${peer}`);}
async function reopen(){const db=await StorageService.getDB();db.close();(StorageService as any).dbPromise=null;}
it('historical bootstrap replay is rejected after ratchet advance and restart with exact durable preservation',async()=>{
 const {first,a,b,r}=await established();const before=await snapshot();await reopen();
 for(let i=0;i<3;i++){await expect(new SignalSession(BOB,ALICE).decrypt({...first},b,a.bundle.ik,BOB)).rejects.toThrow();expect(await snapshot()).toBe(before);}
});
it('signed newer reset advances exactly once and immutable retry survives new session object',async()=>{
 const {a,b,s,r}=await established();const old=await epoch();
 const reset=await s.resetSession('reset',a,b.bundle,old.current,'reset-1');
 expect(await r.decrypt(reset,b,a.bundle.ik,BOB)).toBe('reset');
 const current=await epoch(BOB,ALICE);expect(current.generation).toBe(2);expect(current.current).not.toBe(old.current);
 expect(await new SignalSession(ALICE,BOB).resetSession('reset',a,b.bundle,old.current,'reset-1')).toEqual(reset);
 const before=await snapshot();await expect(r.decrypt(reset,b,a.bundle.ik,BOB)).rejects.toThrow();expect(await snapshot()).toBe(before);
 const reply=await r.encrypt('after reset',b,a.bundle);expect(await s.decrypt(reply,a,b.bundle.ik,ALICE)).toBe('after reset');
});
it('stale signed reset generation and historical bootstrap cannot override later authority',async()=>{
 const {a,b,s,r,first}=await established();const reset=await s.resetSession('second',a,b.bundle,(await epoch()).current,'second');await r.decrypt(reset,b,a.bundle.ik,BOB);
 const reply=await r.encrypt('confirm second',b,a.bundle);await s.decrypt(reply,a,b.bundle.ik,ALICE);
 const third=await s.resetSession('third',a,b.bundle,(await epoch()).current,'third');await r.decrypt(third,b,a.bundle.ik,BOB);
 const before=await snapshot();for(const stale of [first,reset])await expect(r.decrypt(stale,b,a.bundle.ik,BOB)).rejects.toThrow();expect(await snapshot()).toBe(before);
});
it('concurrent old bootstrap and valid newer reset cannot rollback authority',async()=>{
 const {a,b,s,r,first}=await established();const reset=await s.resetSession('new',a,b.bundle,(await epoch()).current,'new');
 const results=await Promise.allSettled([r.decrypt(first,b,a.bundle.ik,BOB),r.decrypt(reset,b,a.bundle.ik,BOB)]);
 expect(results.map(x=>x.status)).toEqual(['rejected','fulfilled']);expect((await epoch(BOB,ALICE)).generation).toBe(2);
});
it('forged newer reset and current decrypt failure commit no epoch/session/OPK state and authorize no reset',async()=>{
 const {a,b,s,r,first}=await established();const reset=await s.resetSession('new',a,b.bundle,(await epoch()).current,'new');const before=await snapshot();
 for(const env of [{...reset,ct:btoa('bad')},{...first,ct:btoa('bad')},{...reset,epoch:reset.epoch!.replace('interpoll/dm/epoch','invalid')}]){await expect(r.decrypt(env,b,a.bundle.ik,BOB)).rejects.toThrow();expect(await snapshot()).toBe(before);}
 expect(await r.decrypt(reset,b,a.bundle.ik,BOB)).toBe('new');
});
it('simultaneous initial bootstraps converge and accept losing in-flight messages exactly once',async()=>{
 const {a,b,s,r}=await peers();const [ab,ba]=await Promise.all([s.encrypt('A0',a,b.bundle),r.encrypt('B0',b,a.bundle)]);
 const [ab1,ba1]=await Promise.all([s.encrypt('A1',a,b.bundle),r.encrypt('B1',b,a.bundle)]);
 expect(await r.decrypt(ab,b,a.bundle.ik,BOB)).toBe('A0');expect(await s.decrypt(ba,a,b.bundle.ik,ALICE)).toBe('B0');
 expect((await epoch()).current).toBe((await epoch(BOB,ALICE)).current);
 expect((await epoch()).candidates[(await epoch()).current].initiator).toBe([ALICE,BOB].sort()[0]);
 expect(await r.decrypt(ab1,b,a.bundle.ik,BOB)).toBe('A1');expect(await s.decrypt(ba1,a,b.bundle.ik,ALICE)).toBe('B1');
 await expect(s.decrypt(ba1,a,b.bundle.ik,ALICE)).rejects.toThrow();
 for(let i=0;i<3;i++){const out=await s.encrypt('next'+i,a,b.bundle);expect(await r.decrypt(out,b,a.bundle.ik,BOB)).toBe('next'+i);const reply=await r.encrypt('reply'+i,b,a.bundle);expect(await s.decrypt(reply,a,b.bundle.ik,ALICE)).toBe('reply'+i);}
});
it('simultaneous newer resets converge symmetrically without ping-pong',async()=>{
 const {a,b,s,r}=await established();const parent=(await epoch()).current;
 const [ab,ba]=await Promise.all([s.resetSession('AR',a,b.bundle,parent,'AR'),r.resetSession('BR',b,a.bundle,parent,'BR')]);
 await Promise.all([r.decrypt(ab,b,a.bundle.ik,BOB),s.decrypt(ba,a,b.bundle.ik,ALICE)]);
 expect((await epoch()).current).toBe((await epoch(BOB,ALICE)).current);expect((await epoch()).generation).toBe(2);
 const out=await s.encrypt('converged',a,b.bundle);expect(await r.decrypt(out,b,a.bundle.ik,BOB)).toBe('converged');
 const before=await snapshot();await expect(r.decrypt(ab,b,a.bundle.ik,BOB)).rejects.toThrow();expect(await snapshot()).toBe(before);
});
it('outer IDs timestamps and transport wrappers cannot turn cached bootstrap into new authority',async()=>{
 const {a,b,first}=await established();const chat:any=new ChatService('wss://example.invalid',BOB);chat.myBundle=b;chat.theirBundles.set(ALICE,a.bundle);chat.processAccepted=vi.fn().mockResolvedValue(undefined);chat.ensureOPKPool=vi.fn().mockResolvedValue(undefined);
 const room=chat.getRoomId(ALICE,BOB),before=await snapshot();
 for(const [id,timestamp] of [['original',1],['changed',999999],['changed-again',0]] as const){
  const raw={...first,id,senderId:ALICE,recipientId:BOB,timestamp};
  expect(await chat.mergeRemote(raw,room)).toBeNull();
  await chat.handleWsMessage({...first,type:'chat-message',messageId:id,from:ALICE,timestamp});
  expect(await snapshot()).toBe(before);
 }
 await chat.handleWsMessage({type:'chat-start',from:ALICE});await chat.handleWsMessage({type:'chat-invite',from:ALICE});
 expect(await chat.mergeRemote({...first,id:'second-stage',senderId:ALICE,recipientId:BOB},room)).toBeNull();expect(await snapshot()).toBe(before);
});
it('changed epoch parent/generation/ephemeral/initial DH and missing certificate fail closed',async()=>{
 const {a,b,s,r}=await peers();const env=await s.encrypt('first',a,b.bundle);const before=await snapshot();
 for(const index of [2,3,5,6]){const p=JSON.parse(env.epoch!);p[index]=index===2?2:'changed';await expect(r.decrypt({...env,epoch:JSON.stringify(p)},b,a.bundle.ik,BOB)).rejects.toThrow();expect(await snapshot()).toBe(before);}
 await expect(r.decrypt({...env,epoch:undefined},b,a.bundle.ik,BOB)).rejects.toThrow();expect(await snapshot()).toBe(before);
 expect(await r.decrypt(env,b,a.bundle.ik,BOB)).toBe('first');
});
it('legacy v4 state is preserved and cannot be implicitly promoted or reset',async()=>{
 const {a,b,s,r}=await peers();const env=await s.encrypt('first',a,b.bundle);const key=`signal-session:${BOB}:${ALICE}`;
 await StorageService.setMetadata(key,{auth:env.auth,nr:0,legacy:true});const before=await snapshot();
 await expect(r.decrypt(env,b,a.bundle.ik,BOB)).rejects.toThrow();expect(await snapshot()).toBe(before);
 await expect(r.encrypt('legacy',b,a.bundle)).rejects.toThrow();expect(await snapshot()).toBe(before);
});
it('more than fifty unanswered authenticated sends do not implicitly create a new epoch',async()=>{
 const {a,b,s}=await peers();const first=await s.encrypt('0',a,b.bundle);
 const out=await Promise.all(Array.from({length:64},(_,i)=>s.encrypt(String(i+1),a,b.bundle)));
 expect(out.every(e=>e.epoch===first.epoch&&!e.eph)).toBe(true);expect(new Set(out.map(e=>e.dh+':'+e.n)).size).toBe(64);expect((await epoch()).generation).toBe(1);
});

it('provisional sessions cannot initiate reset before authenticated current peer confirmation',async()=>{
 const {a,b,s,r}=await peers();const first=await s.encrypt('first',a,b.bundle);const before=await snapshot();
 await expect(s.resetSession('too early',a,b.bundle,(await epoch()).current,'early')).rejects.toMatchObject({state:'RESET_PENDING'});expect(await snapshot()).toBe(before);
 await r.decrypt(first,b,a.bundle.ik,BOB);const reply=await r.encrypt('confirm',b,a.bundle);await s.decrypt(reply,a,b.bundle.ik,ALICE);
 const reset=await s.resetSession('allowed',a,b.bundle,(await epoch()).current,'allowed');expect(await r.decrypt(reset,b,a.bundle.ik,BOB)).toBe('allowed');
});
it('concurrent duplicate newer reset has one authenticated acceptance and restart preserves rejection',async()=>{
 const {a,b,s,r}=await established();const reset=await s.resetSession('new',a,b.bundle,(await epoch()).current,'new');
 const results=await Promise.allSettled([r.decrypt(reset,b,a.bundle.ik,BOB),new SignalSession(BOB,ALICE).decrypt(reset,b,a.bundle.ik,BOB)]);
 expect(results.filter(x=>x.status==='fulfilled')).toHaveLength(1);const before=await snapshot();await reopen();
 await expect(new SignalSession(BOB,ALICE).decrypt(reset,b,a.bundle.ik,BOB)).rejects.toThrow();expect(await snapshot()).toBe(before);
});
it('simultaneous convergence works in reverse arrival order and retired branch never supplies reset authority',async()=>{
 const {a,b,s,r}=await peers();const [ab,ba]=await Promise.all([s.encrypt('A0',a,b.bundle),r.encrypt('B0',b,a.bundle)]);
 const ba1=await r.encrypt('in flight',b,a.bundle);await s.decrypt(ba,a,b.bundle.ik,ALICE);await r.decrypt(ab,b,a.bundle.ik,BOB);
 expect((await epoch()).current).toBe((await epoch(BOB,ALICE)).current);
 await s.decrypt(ba1,a,b.bundle.ik,ALICE);
 const losing=ALICE<BOB?await epoch():await epoch(BOB,ALICE);
 expect(losing.settled).toBe(false);
 const before=await snapshot();await expect(s.decrypt(ba,a,b.bundle.ik,ALICE)).rejects.toThrow();expect(await snapshot()).toBe(before);
});

it('valid device signature on an old generation cannot restore superseded authority',async()=>{
 const {a,b,s,r,first}=await established();const reset=await s.resetSession('new',a,b.bundle,(await epoch()).current,'new');await r.decrypt(reset,b,a.bundle.ik,BOB);
 const altered=await createEpoch(ALICE,first.auth!,first.eph!,reset.dh,1,null);
 expect((await verifyEpoch(altered,first.auth!)).generation).toBe(1);
 const before=await snapshot();await expect(r.decrypt({...first,dh:reset.dh,epoch:altered},b,a.bundle.ik,BOB)).rejects.toMatchObject({state:'STALE'});expect(await snapshot()).toBe(before);
});
it('randomized valid signature cannot change bootstrap ID or evade replay memory',async()=>{
 const {a,b,r,first}=await established();const replacement=await createEpoch(ALICE,first.auth!,first.eph!,first.dh,1,null);
 expect((await verifyEpoch(replacement,first.auth!)).id).toBe((await verifyEpoch(first.epoch!,first.auth!)).id);
 const before=await snapshot();await expect(r.decrypt({...first,epoch:replacement},b,a.bundle.ik,BOB)).rejects.toThrow();expect(await snapshot()).toBe(before);
});
it('receive-only simultaneous branch cannot regain authority after a newer reset',async()=>{
 const {a,b,s,r}=await peers();const [ab,ba]=await Promise.all([s.encrypt('A0',a,b.bundle),r.encrypt('B0',b,a.bundle)]);
 const delayed=await r.encrypt('delayed',b,a.bundle);await r.decrypt(ab,b,a.bundle.ik,BOB);await s.decrypt(ba,a,b.bundle.ik,ALICE);
 const confirm=await r.encrypt('confirm selected',b,a.bundle);await s.decrypt(confirm,a,b.bundle.ik,ALICE);
 const reset=await s.resetSession('new',a,b.bundle,(await epoch()).current,'new');await r.decrypt(reset,b,a.bundle.ik,BOB);
 const before=await snapshot();await expect(s.decrypt(delayed,a,b.bundle.ik,ALICE)).rejects.toThrow();expect(await snapshot()).toBe(before);
 expect((await epoch()).branches).toEqual({});
});
it('signed reset can restore missing ratchet only with retained matching parent authority',async()=>{
 const {a,b,s,r}=await established();const reset=await s.resetSession('restore',a,b.bundle,(await epoch()).current,'restore');
 await StorageService.setMetadata(`signal-session:${BOB}:${ALICE}`,null);await reopen();
 expect(await new SignalSession(BOB,ALICE).decrypt(reset,b,a.bundle.ik,BOB)).toBe('restore');expect((await epoch(BOB,ALICE)).generation).toBe(2);
});

it('legacy clear racing first authenticated send cannot erase newly committed epoch state',async()=>{
 const {a,b,s}=await peers();await Promise.allSettled([s.encrypt('first',a,b.bundle),...Array.from({length:20},()=>new SignalSession(ALICE,BOB).clearSession())]);
 const authority=await epoch();expect(authority).toBeTruthy();const state=await StorageService.getMetadata(`signal-session:${ALICE}:${BOB}`);expect(state.epoch).toBe(authority.candidates[authority.current].certificate);
});
it('retained epoch authority forbids legacy encryption after ratchet state loss',async()=>{
 const {a,b,s}=await established();await StorageService.setMetadata(`signal-session:${ALICE}:${BOB}`,null);const before=await snapshot();
 const legacy={...b.bundle,version:undefined};await expect(s.encrypt('downgrade',a,legacy as any)).rejects.toThrow();expect(await snapshot()).toBe(before);
});
