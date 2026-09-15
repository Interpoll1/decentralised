import 'fake-indexeddb/auto';
import {beforeEach,expect,it,vi} from 'vitest';
vi.mock('../src/services/gunService',()=>({GunService:{getGun:vi.fn()},GUN_NAMESPACE:'test'}));
vi.mock('../src/utils/gunAsync',()=>({gunPut:vi.fn(),gunOnce:vi.fn(),gunReadChildren:vi.fn(),toGunRecord:(x:unknown)=>x}));
import {StorageService} from '../src/services/storageService';
import {SignalSession,MAX_SKIP,MAX_TOTAL_SKIPPED,MAX_SKIPPED_GENERATIONS} from '../src/services/signalProtocol';
import {pendingEntries,inboxKey,enqueuePending,receiveCommitChanges,MAX_PENDING,MAX_PENDING_BYTES,PENDING_TTL_MS} from '../src/services/dmReceiveState';
import ChatService from '../src/services/chatService';
import {ALICE,BOB,getOrCreateIdentityBundle} from './dmIdentityFixture';
beforeEach(async()=>{const db=await StorageService.getDB();await db.clear('metadata');await db.clear('chat-messages');});
async function peers(){const a=await getOrCreateIdentityBundle(ALICE),b=await getOrCreateIdentityBundle(BOB);return {a,b,s:new SignalSession(ALICE,BOB),r:new SignalSession(BOB,ALICE)};}
async function delayed(){const p=await peers();const first=await p.s.encrypt('A0',p.a,p.b.bundle);await p.r.decrypt(first,p.b,p.a.bundle.ik,BOB);const late=await p.s.encrypt('A1',p.a,p.b.bundle);const reply=await p.r.encrypt('B0',p.b,p.a.bundle);await p.s.decrypt(reply,p.a,p.b.bundle.ik,ALICE);const next=await p.s.encrypt('A2',p.a,p.b.bundle);await p.r.decrypt(next,p.b,p.a.bundle.ik,BOB);return {...p,late};}
function chat(b:any,a:any){const c:any=new ChatService('wss://example.invalid',BOB);c.myBundle=b;c.theirBundles.set(ALICE,a.bundle);c.processAccepted=vi.fn().mockResolvedValue(undefined);c.ensureOPKPool=vi.fn().mockResolvedValue(undefined);return c;}
const raw=(e:any,id:string)=>({...e,id,senderId:ALICE,recipientId:BOB,timestamp:1});
it('F08 delayed previous-chain A1 remains decryptable after A2 advances DH',async()=>{const {a,b,r,late}=await delayed();expect(await r.decrypt(late,b,a.bundle.ik,BOB)).toBe('A1');});
it('F09 message before bootstrap is durably retried after bootstrap arrives without transport redelivery',async()=>{
 const {a,b,s}=await peers();const first=await s.encrypt('first',a,b.bundle),second=await s.encrypt('second',a,b.bundle);const c=chat(b,a),room=[ALICE,BOB].sort().join(':');
 expect(await c.mergeRemote(raw(second,'second'),room)).toBeNull();await c.mergeRemote(raw(first,'first'),room);
 await vi.waitFor(async()=>expect((await StorageService.getChatMessage('second'))?.text).toBe('second'));
});

const room=[ALICE,BOB].sort().join(':');
async function snapshot(){const db=await StorageService.getDB();return JSON.stringify([await db.getAllKeys('metadata'),await db.getAll('metadata'),await db.getAll('chat-messages')]);}
async function cryptoSnapshot(){const db=await StorageService.getDB();const keys=await db.getAllKeys('metadata');const values=await db.getAll('metadata');return JSON.stringify(keys.map((k,i)=>[k,values[i]]).filter(([k])=>!String(k).startsWith('dm-receive-pending-v1:')));}
async function reopen(){(await StorageService.getDB()).close();(StorageService as any).dbPromise=undefined;}
it('same-chain M2 M0 M1 ordering succeeds exactly once after established bootstrap',async()=>{
 const {a,b,s,r}=await peers();await r.decrypt(await s.encrypt('bootstrap',a,b.bundle),b,a.bundle.ik,BOB);
 const envs=[];for(let i=0;i<3;i++)envs.push(await s.encrypt('M'+i,a,b.bundle));
 for(const i of [2,0,1])expect(await r.decrypt(envs[i],b,a.bundle.ik,BOB)).toBe('M'+i);
 const before=await snapshot();for(const e of envs)await expect(r.decrypt(e,b,a.bundle.ik,BOB)).rejects.toThrow();expect(await snapshot()).toBe(before);
});
it('forged previous-chain skipped-key use cannot consume it before legitimate retry',async()=>{
 const {a,b,r,late}=await delayed();const before=await snapshot();await expect(r.decrypt({...late,ct:btoa('bad')},b,a.bundle.ik,BOB)).rejects.toThrow();expect(await snapshot()).toBe(before);
 expect(await r.decrypt(late,b,a.bundle.ik,BOB)).toBe('A1');
});
it('retained previous-chain keys survive DB reopen',async()=>{
 const {a,b,late}=await delayed();await reopen();expect(await new SignalSession(BOB,ALICE).decrypt(late,b,a.bundle.ik,BOB)).toBe('A1');
});
it.each([0,1,MAX_SKIP,MAX_SKIP+1])('gap boundary %i obeys exact allocation bound',async gap=>{
 const {a,b,s,r}=await peers();await r.decrypt(await s.encrypt('bootstrap',a,b.bundle),b,a.bundle.ik,BOB);
 let target:any;for(let i=0;i<=gap;i++)target=await s.encrypt('gap-'+i,a,b.bundle);
 const before=await snapshot();
 if(gap>MAX_SKIP){await expect(r.decrypt(target,b,a.bundle.ik,BOB)).rejects.toMatchObject({status:'rejected-stale'});expect(await snapshot()).toBe(before);}
 else{expect(await r.decrypt(target,b,a.bundle.ik,BOB)).toBe('gap-'+gap);const state=await StorageService.getMetadata(`signal-session:${BOB}:${ALICE}`);expect(Object.keys(state.skipped)).toHaveLength(gap);}
},30000);
it('total skipped-key limit evicts oldest deterministically without reopening an evicted position',async()=>{
 const {a,b,s,r}=await peers();await r.decrypt(await s.encrypt('bootstrap',a,b.bundle),b,a.bundle.ik,BOB);
 const skipped=[];for(let i=0;i<MAX_TOTAL_SKIPPED+1;i++)skipped.push(await s.encrypt('old'+i,a,b.bundle));
 await r.decrypt(skipped[MAX_TOTAL_SKIPPED],b,a.bundle.ik,BOB);
 const reply=await r.encrypt('reply',b,a.bundle);await s.decrypt(reply,a,b.bundle.ik,ALICE);
 const delayedNew=await s.encrypt('new0',a,b.bundle),next=await s.encrypt('new1',a,b.bundle);await r.decrypt(next,b,a.bundle.ik,BOB);
 const state=await StorageService.getMetadata(`signal-session:${BOB}:${ALICE}`);expect(Object.keys(state.skipped)).toHaveLength(MAX_TOTAL_SKIPPED);
 const before=await snapshot();await expect(r.decrypt(skipped[0],b,a.bundle.ik,BOB)).rejects.toMatchObject({status:'rejected-stale'});expect(await snapshot()).toBe(before);
 expect(await r.decrypt(skipped[1],b,a.bundle.ik,BOB)).toBe('old1');expect(await r.decrypt(delayedNew,b,a.bundle.ik,BOB)).toBe('new0');
},30000);
it('four-transition retention expires deterministically only after the declared window',async()=>{
 const {a,b,s,r,late}=await delayed();
 for(let i=1;i<=MAX_SKIPPED_GENERATIONS;i++){await s.decrypt(await r.encrypt('reply'+i,b,a.bundle),a,b.bundle.ik,ALICE);await r.decrypt(await s.encrypt('step'+i,a,b.bundle),b,a.bundle.ik,BOB);}
 const before=await snapshot();await expect(r.decrypt(late,b,a.bundle.ik,BOB)).rejects.toMatchObject({status:'rejected-stale'});expect(await snapshot()).toBe(before);
});
it('bundle unavailable remains durable retryable and succeeds under the same ID after restart',async()=>{
 const {a,b,s}=await peers();const env=await s.encrypt('waiting',a,b.bundle);const c=chat(b,a);c.theirBundles.clear();c.fetchTheirBundle=vi.fn().mockResolvedValue(null);
 expect(await c.receiveRemote(raw(env,'waiting'),room)).toMatchObject({status:'retryable',persisted:true});expect(await pendingEntries(BOB)).toHaveLength(1);await reopen();
 const restored=chat(b,a);await restored.retryPendingReceives();expect((await StorageService.getChatMessage('waiting'))?.text).toBe('waiting');expect(await pendingEntries(BOB)).toHaveLength(0);
});
it('exact duplicates across instances and changed outer metadata commit one row and one ratchet position',async()=>{
 const {a,b,s}=await peers();const e=await s.encrypt('once',a,b.bundle),c=chat(b,a),other=chat(b,a);const input=raw(e,'id');
 const results=await Promise.all([c.receiveRemote(input,room),other.receiveRemote(input,room)]);expect(results.map(x=>x.status).sort()).toEqual(['accepted','duplicate']);
 const before=await cryptoSnapshot();expect(await c.receiveRemote({...input,id:'alias',timestamp:999},room)).toMatchObject({status:'duplicate'});
 expect(await StorageService.getChatMessage('alias')).toBeUndefined();expect(await cryptoSnapshot()).toBe(before);await reopen();
 expect(await chat(b,a).receiveRemote(input,room)).toMatchObject({status:'duplicate'});
});
it('same outer ID different authenticated bytes never inherits acceptance',async()=>{
 const {a,b,s}=await peers();const c=chat(b,a),first=await s.encrypt('first',a,b.bundle);await c.receiveRemote(raw(first,'id'),room);const second=await s.encrypt('second',a,b.bundle);const before=await cryptoSnapshot();
 expect(await c.receiveRemote(raw(second,'id'),room)).toMatchObject({status:'rejected-auth'});expect(await cryptoSnapshot()).toBe(before);
 expect(await c.receiveRemote(raw(second,'second'),room)).toMatchObject({status:'accepted'});
});
it('failed durable acceptance leaves crypto unchanged and durable pending permits retry',async()=>{
 const {a,b,s}=await peers();const c=chat(b,a),e=await s.encrypt('db retry',a,b.bundle),before=await cryptoSnapshot();
 const original=StorageService.compareAndSwapMetadata.bind(StorageService);const spy=vi.spyOn(StorageService,'compareAndSwapMetadata').mockImplementation(async(entries,row)=>{if(row)return original(entries,{...row,text:(()=>{}) as any});return original(entries,row);});
 expect(await c.receiveRemote(raw(e,'db'),room)).toMatchObject({status:'retryable',persisted:true});expect(await cryptoSnapshot()).toBe(before);expect(await StorageService.getChatMessage('db')).toBeUndefined();spy.mockRestore();
 await c.retryPendingReceives();expect((await StorageService.getChatMessage('db'))?.text).toBe('db retry');expect(await pendingEntries(BOB)).toHaveLength(0);
});
it('forged skipped ciphertext is terminal without blocking corrected bytes using same ID',async()=>{
 const {a,b,s}=await peers(),c=chat(b,a);await c.receiveRemote(raw(await s.encrypt('bootstrap',a,b.bundle),'boot'),room);
 const late=await s.encrypt('late',a,b.bundle),next=await s.encrypt('next',a,b.bundle);await c.receiveRemote(raw(next,'next'),room);const before=await cryptoSnapshot();
 expect(await c.receiveRemote(raw({...late,ct:btoa(atob(late.ct).slice(0,-1)+String.fromCharCode(atob(late.ct).charCodeAt(atob(late.ct).length-1)^1))},'late'),room)).toMatchObject({status:'rejected-auth'});expect(await cryptoSnapshot()).toBe(before);
 expect(await c.receiveRemote(raw(late,'late'),room)).toMatchObject({status:'accepted'});
});
it('pending coalesces exact bytes and enforces count byte and lifetime bounds across reopen',async()=>{
 const {a,b,s}=await peers();const e=await s.encrypt('bounded',a,b.bundle),c=chat(b,a);c.myBundle=null;
 const entry=raw(e,'one');await c.receiveRemote(entry,room);await c.receiveRemote({...entry,id:'alias'},room);expect(await pendingEntries(BOB)).toHaveLength(1);
 const now=Date.now();for(let i=0;i<MAX_PENDING+5;i++)await enqueuePending(BOB,{fingerprint:String(i).padStart(3,'0'),raw:{payload:'x'.repeat(50000)},roomId:room,observedAt:now+i});
 const entries=await pendingEntries(BOB);expect(entries.length).toBeLessThanOrEqual(MAX_PENDING);expect(new TextEncoder().encode(JSON.stringify(entries)).length).toBeLessThanOrEqual(MAX_PENDING_BYTES);
 await reopen();expect(await pendingEntries(BOB)).toEqual(entries);
 const clock=vi.spyOn(Date,'now').mockReturnValue(now+PENDING_TTL_MS+100);expect(await pendingEntries(BOB)).toEqual([]);clock.mockRestore();
});
it('memory admission is bounded and excess observations stay retryable without growing promise queues',async()=>{
 const {a,b,s}=await peers(),c=chat(b,a);const e=await s.encrypt('bounded',a,b.bundle);c.receiving=MAX_PENDING;
 expect(await c.receiveRemote(raw(e,'cap'),room)).toMatchObject({status:'retryable',persisted:false});expect(await StorageService.getMetadata(inboxKey(BOB))).toBeUndefined();
});

it('last retained transition boundary still decrypts and consumes the delayed key',async()=>{
 const {a,b,s,r,late}=await delayed();for(let i=1;i<MAX_SKIPPED_GENERATIONS;i++){await s.decrypt(await r.encrypt('r'+i,b,a.bundle),a,b.bundle.ik,ALICE);await r.decrypt(await s.encrypt('s'+i,a,b.bundle),b,a.bundle.ik,BOB);}
 expect(await r.decrypt(late,b,a.bundle.ik,BOB)).toBe('A1');
});
it('count eviction and exact-candidate coalescing do not refresh pending lifetime',async()=>{
 const {a,b,s}=await peers(),c=chat(b,a);c.myBundle=null;const e=await s.encrypt('pending',a,b.bundle);await c.receiveRemote(raw(e,'first'),room);const first=(await pendingEntries(BOB))[0];
 await c.receiveRemote(raw(e,'alias'),room);expect((await pendingEntries(BOB))[0].observedAt).toBe(first.observedAt);
 await StorageService.setMetadata(inboxKey(BOB),[]);const now=Date.now();for(let i=0;i<MAX_PENDING+1;i++)await enqueuePending(BOB,{fingerprint:String(i).padStart(3,'0'),raw:{id:String(i)},roomId:room,observedAt:now});
 const entries=await pendingEntries(BOB);expect(entries).toHaveLength(MAX_PENDING);expect(entries[0].fingerprint).toBe('001');expect(entries.at(-1)?.fingerprint).toBe('064');
});
it('stale F06 epoch rejection wins over an accepted exact-ciphertext dedup entry',async()=>{
 const {a,b,s,r}=await peers(),c=chat(b,a);const first=await s.encrypt('first',a,b.bundle);await c.receiveRemote(raw(first,'first'),room);
 await s.decrypt(await r.encrypt('confirm',b,a.bundle),a,b.bundle.ik,ALICE);const epoch=await StorageService.getMetadata(`dm-session-epoch-v1:${ALICE}:${BOB}`);
 const reset=await s.resetSession('new',a,b.bundle.selectedOPK?{...b.bundle,opks:[],selectedOPK:null,opk:undefined,opkId:undefined}:b.bundle,epoch.current,'reset');await c.receiveRemote(raw(reset,'reset'),room);
 const before=await cryptoSnapshot();expect(await c.receiveRemote(raw(first,'alias'),room)).toMatchObject({status:'rejected-stale'});expect(await cryptoSnapshot()).toBe(before);
});
it('Gun observation before bootstrap retries once and duplicate delivery emits no second message',async()=>{
 const {a,b,s}=await peers(),c=chat(b,a);c.onMessage=vi.fn();const first=await s.encrypt('first',a,b.bundle),second=await s.encrypt('second',a,b.bundle);
 c.handleRoomRecord(room,raw(second,'second'));await vi.waitFor(async()=>expect(await pendingEntries(BOB)).toHaveLength(1));
 c.handleRoomRecord(room,raw(first,'first'));await vi.waitFor(()=>expect(c.onMessage).toHaveBeenCalledTimes(2));
 c.handleRoomRecord(room,raw(second,'second'));await vi.waitFor(()=>expect(c.receiving).toBe(0));expect(c.onMessage).toHaveBeenCalledTimes(2);
});

it('manual same-ID prerequisite retry control remains valid without automatic draining',async()=>{
 const {a,b,s}=await peers(),c=chat(b,a);c.retryingReceive=true;const first=await s.encrypt('first',a,b.bundle),second=await s.encrypt('second',a,b.bundle);
 expect(await c.mergeRemote(raw(second,'second'),room)).toBeNull();await c.mergeRemote(raw(first,'first'),room);expect((await c.mergeRemote(raw(second,'second'),room))?.text).toBe('second');
});

it('acceptance racing ledger and row reads still classifies exact bytes as duplicate',async()=>{
 const {a,b,s}=await peers(),c=chat(b,a),e=await s.encrypt('once',a,b.bundle);await c.receiveRemote(raw(e,'once'),room);
 const db=await StorageService.getDB();const key=(await db.getAllKeys('metadata')).find(k=>String(k).startsWith('dm-receive-accepted-v1:')) as string;
 const stored=await StorageService.getMetadata(key),original=StorageService.getMetadata.bind(StorageService);let first=true;
 const spy=vi.spyOn(StorageService,'getMetadata').mockImplementation(async k=>{if(k===key&&first){first=false;return undefined;}return original(k);});
 try{await expect(receiveCommitChanges({key,fingerprint:stored.fingerprint,rowId:'once',local:BOB})).rejects.toMatchObject({status:'duplicate'});}finally{spy.mockRestore();}
});
