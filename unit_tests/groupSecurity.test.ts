import 'fake-indexeddb/auto';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
vi.mock('../src/services/gunService',()=>({GunService:{getGun:vi.fn(),onReconnect:()=>()=>{}},GUN_NAMESPACE:'test'}));
vi.mock('../src/utils/gunAsync',()=>({gunPut:vi.fn(async()=>({ok:true})),gunOnce:vi.fn(),gunReadChildren:vi.fn(async()=>[]),verifySoulOnRelay:vi.fn(async()=>false)}));
import {StorageService} from '../src/services/storageService';
import {KeyService} from '../src/services/keyService';
import {getOrCreateAuthenticatedIdentityBundle} from '../src/services/signalProtocol';
import {GroupSecurity,GROUP_LIMITS,authorshipBytes,epochBytes,epochHash,headerBytes,memberId,openSeal,proposalContext,sealTo,stateKey,type GroupEnvelope} from '../src/services/groupSecurity';
import {GroupRoomTransport} from '../src/services/groupRoomTransport';
import {ChatRoomService} from '../src/services/chatRoomService';
import {GunService} from '../src/services/gunService';
import {gunPut,gunOnce} from '../src/utils/gunAsync';

async function identity(n:number){const secret=n.toString(16).padStart(64,'0');return new GroupSecurity(await getOrCreateAuthenticatedIdentityBundle(KeyService.getPublicKey(secret),secret));}
async function setup(){
 const [a,b,c]=await Promise.all([identity(1),identity(2),identity(3)]);
 const created=await a.create('Room','Description');const room=created.roomId;
 await a.change(room,{add:b.binding});const epoch=await a.change(room,{add:c.binding});
 await b.adopt(epoch);await c.adopt(epoch);return {a,b,c,room,epoch};
}
async function accepted(a:GroupSecurity,room:string,text='message'){return a.authorize(room,await a.candidate(room,text,'Alice'));}
async function reopen(){const db=await StorageService.getDB();db.close();(StorageService as any).dbPromise=undefined;}
async function decryptRaw(key:string,e:GroupEnvelope){
 const bytes=(x:string)=>Uint8Array.from(atob(x),c=>c.charCodeAt(0));
 const k=await crypto.subtle.importKey('raw',bytes(key),'AES-GCM',false,['decrypt']);
 return crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(e.iv),additionalData:new TextEncoder().encode(headerBytes(e.header))},k,bytes(e.ciphertext));
}
beforeEach(async()=>{vi.restoreAllMocks();const db=await StorageService.getDB();for(const store of ['metadata','chat-messages','encryption-keys'])await db.clear(store);KeyService.clearCache();});
afterEach(()=>GroupRoomTransport.stopAll());

it('control: individual member sends, owner authorizes, recipient decrypts and exact duplicate is idempotent',async()=>{
 const {a,b,c,room}=await setup();const e=await a.authorize(room,await b.candidate(room,'Bob says hello','Bob'));
 expect((await c.receive(room,e)).row).toMatchObject({text:'Bob says hello',senderId:b.binding.accountId});
 const before=JSON.stringify(await c.state(room));expect((await c.receive(room,e)).status).toBe('duplicate');expect(JSON.stringify(await c.state(room))).toBe(before);
 expect((await StorageService.getAllChatMessages()).filter((r:any)=>r.senderId===b.binding.accountId)).toHaveLength(2); // owner + Carol, account-scoped rows
});
it.each(['version','roomId','membershipEpoch','keyEpoch','epochHash','messageId','senderAccount','senderDevice','sequence','timestamp'])('F11 binds header %s',async field=>{
 const {a,b,room}=await setup(),e=await accepted(a,room);const forged=structuredClone(e);
 (forged.header as any)[field]=typeof (forged.header as any)[field]==='number'?(forged.header as any)[field]+1:'changed';
 const before=JSON.stringify(await b.state(room));await expect(b.receive(room,forged)).rejects.toThrow();expect(JSON.stringify(await b.state(room))).toBe(before);
 expect((await b.receive(room,e)).status).toBe('accepted');
});
it.each(['iv','ciphertext','signature','publication','receipt'])('F11 binds/removal fails closed for %s',async field=>{
 const {a,b,room}=await setup(),e=await accepted(a,room);const forged=structuredClone(e);delete (forged as any)[field];
 await expect(b.receive(room,forged)).rejects.toThrow();expect((await b.receive(room,e)).status).toBe('accepted');
});
it('F11 rejects cross-room transplantation even with the same owner',async()=>{
 const {a,b,room}=await setup(),other=await a.create('Other','');const epoch=await a.change(other.roomId,{add:b.binding});await b.adopt(epoch);
 await expect(b.receive(other.roomId,await accepted(a,room))).rejects.toThrow();
});
it('F11 ciphertext/header recombination and unknown media metadata are rejected',async()=>{
 const {a,b,room}=await setup(),e1=await accepted(a,room,'one'),e2=await accepted(a,room,'two');
 await expect(b.receive(room,{...e1,iv:e2.iv,ciphertext:e2.ciphertext})).rejects.toThrow();
 await expect(b.receive(room,{...e1,media:'unbound'} as any)).rejects.toThrow();
});
it('F11 Bob possessing key cannot impersonate Alice with a valid Bob signature',async()=>{
 const {a,b,room}=await setup(),e=await b.candidate(room,'I am Alice','Alice');e.header.senderAccount=a.binding.accountId;e.header.senderDevice=a.binding.deviceId;
 e.signature=await b.signControl(authorshipBytes(e));const before=JSON.stringify(await a.state(room));
 await expect(a.authorize(room,e)).rejects.toThrow();expect(JSON.stringify(await a.state(room))).toBe(before);
});
it('F21 removal gives remaining members fresh key; retained old key fails after restart',async()=>{
 const {a,b,c,room,epoch}=await setup();const old=(await c.state(room))!.keys.at(-1)!.key;
 const next=await a.change(room,{remove:memberId(c.binding)});expect(next.membershipEpoch).toBe(epoch.membershipEpoch+1);expect(next.keyEpoch).toBe(next.membershipEpoch);
 expect(next.distributions.some(d=>d.member===memberId(c.binding))).toBe(false);await b.adopt(next);await c.adopt(next);
 const e=await accepted(a,room,'future');await expect(decryptRaw(old,e)).rejects.toThrow();expect((await b.receive(room,e)).row.text).toBe('future');
 await reopen();await expect(new GroupSecurity(c.identity).receive(room,e)).rejects.toThrow(/revoked/);
 expect((await c.state(room))!.keys.some(k=>k.epoch===next.keyEpoch)).toBe(false);
 await expect(c.adopt(epoch)).rejects.toThrow(/Stale/);
});
it('stale epoch/key distribution cannot roll back or be transplanted to new epoch',async()=>{
 const {a,b,c,room,epoch}=await setup();const next=await a.change(room,{remove:memberId(c.binding)});await b.adopt(next);const before=JSON.stringify(await b.state(room));
 await expect(b.adopt(epoch)).rejects.toThrow(/Stale/);
 await expect(b.adopt({...next,distributions:epoch.distributions})).rejects.toThrow();expect(JSON.stringify(await b.state(room))).toBe(before);
});
it('old same-epoch duplicate allowed; unknown old message and new ciphertext relabeled old rejected',async()=>{
 const {a,b,c,room,epoch}=await setup(),old=await accepted(a,room),late=await accepted(a,room,'unseen');await b.receive(room,old);
 const next=await a.change(room,{remove:memberId(c.binding)});await b.adopt(next);
 expect((await b.receive(room,old)).status).toBe('duplicate');await expect(b.receive(room,late)).rejects.toThrow(/Stale/);
 const fresh=await accepted(a,room);fresh.header.membershipEpoch=epoch.membershipEpoch;fresh.header.keyEpoch=epoch.keyEpoch;
 await expect(b.receive(room,fresh)).rejects.toThrow();
});
it('rejoin obtains only new keys, not keys from absence',async()=>{
 const {a,c,room}=await setup();const removed=await a.change(room,{remove:memberId(c.binding)});await c.adopt(removed);
 const missed=await accepted(a,room,'absence');const rejoin=await a.change(room,{add:c.binding});await c.adopt(rejoin);
 expect((await c.state(room))!.keys.map(k=>k.epoch)).not.toContain(removed.keyEpoch);
 await expect(c.receive(room,missed)).rejects.toThrow();expect((await c.receive(room,await accepted(a,room,'rejoined'))).row.text).toBe('rejoined');
});
it('concurrent membership changes retain both removals and advance keys twice',async()=>{
 const {a,b,c,room,epoch}=await setup();await Promise.all([a.change(room,{remove:memberId(b.binding)}),new GroupSecurity(a.identity).change(room,{remove:memberId(c.binding)})]);
 const state=(await a.state(room))!;expect(state.epoch.members.map(memberId)).toEqual([memberId(a.binding)]);expect(state.epoch.keyEpoch).toBe(epoch.keyEpoch+2);
});
it('concurrent removal and send linearize; no stale candidate is authorized after removal',async()=>{
 const {a,c,room,epoch}=await setup(),candidate=await a.candidate(room,'race','Alice');
 const results=await Promise.allSettled([a.change(room,{remove:memberId(c.binding)}),new GroupSecurity(a.identity).authorize(room,candidate)]);
 expect(results[0].status).toBe('fulfilled');
 if(results[1].status==='fulfilled')expect(results[1].value.header.keyEpoch).toBe(epoch.keyEpoch);
 await expect(a.authorize(room,candidate)).rejects.toThrow(/Stale/);expect((await accepted(a,room)).header.keyEpoch).toBe(epoch.keyEpoch+1);
});
it('missing current key fails closed and does not fall back to retained historical key',async()=>{
 const {a,b,c,room}=await setup();await b.adopt(await a.change(room,{remove:memberId(c.binding)}));const s=(await b.state(room))!;
 await StorageService.setMetadata(stateKey(b.binding.accountId,room),{...s,keys:s.keys.slice(0,-1)});
 await expect(b.candidate(room,'secret','Bob')).rejects.toThrow(/Missing/);
});
it('failed authenticated receive transaction leaves replay and plaintext unchanged then retry succeeds',async()=>{
 const {a,b,room}=await setup(),e=await accepted(a,room),before=JSON.stringify(await b.state(room));const original=StorageService.compareAndSwapMetadata.bind(StorageService);
 const spy=vi.spyOn(StorageService,'compareAndSwapMetadata').mockImplementation((entries,row)=>original(entries,row?{...row,text:(()=>{}) as any}:row));
 await expect(b.receive(room,e)).rejects.toThrow();expect(JSON.stringify(await b.state(room))).toBe(before);spy.mockRestore();expect((await b.receive(room,e)).status).toBe('accepted');
});
it('failed transition CAS exposes no half-updated membership or key',async()=>{
 const {a,c,room}=await setup(),before=JSON.stringify(await a.state(room));const spy=vi.spyOn(StorageService,'compareAndSwapMetadata').mockRejectedValue(new Error('disk'));
 await expect(a.change(room,{remove:memberId(c.binding)})).rejects.toThrow('disk');spy.mockRestore();expect(JSON.stringify(await a.state(room))).toBe(before);
});
it('concurrent publications use unique durable receipt positions and immutable retry',async()=>{
 const {a,b,room}=await setup();const candidates=await Promise.all(Array.from({length:20},(_,i)=>b.candidate(room,`m${i}`,'Bob')));
 const accepted=await Promise.all(candidates.map(e=>a.authorize(room,e)));expect(new Set(accepted.map(e=>e.publication)).size).toBe(20);
 expect(await a.authorize(room,candidates[0])).toEqual(accepted[0]);await reopen();expect(await new GroupSecurity(a.identity).authorize(room,candidates[0])).toEqual(accepted[0]);
});
it('persistent key retention is bounded and removed devices cannot derive retained peers wrapping key',async()=>{
 const {a,b,c,room}=await setup();let next=await a.change(room,{remove:memberId(c.binding)});
 await expect(openSeal(c.identity,next.distributions.find(d=>d.member===memberId(b.binding))!.seal,JSON.stringify(['interpoll/group/key',1,room,next.membershipEpoch,next.keyEpoch,memberId(b.binding),'wrong']))).rejects.toThrow();
 for(let i=0;i<8;i++){next=await a.change(room,i%2?{remove:memberId(c.binding)}:{add:c.binding});await b.adopt(next);}
 expect((await a.state(room))!.keys.length).toBe(GROUP_LIMITS.keys);await reopen();expect((await b.state(room))!.keys.length).toBe(GROUP_LIMITS.keys);
});
it('resource limits reject oversized messages and a full publication queue',async()=>{
 const {a,room}=await setup();await expect(a.candidate(room,'x'.repeat(GROUP_LIMITS.textBytes+1),'Alice')).rejects.toThrow();
 const candidate=await a.candidate(room,'valid','Alice'),state=(await a.state(room))!;
 await StorageService.setMetadata(stateKey(a.binding.accountId,room),{...state,outbox:Array(GROUP_LIMITS.outbox).fill(candidate)});
 await expect(a.authorize(room,candidate)).rejects.toThrow(/queue full/);
});
it('transport request hides a stale-key envelope from removed member and owner rejects it',async()=>{
 const {a,b,c,room}=await setup(),candidate=await b.candidate(room,'secret','Bob'),old=(await c.state(room))!.keys.at(-1)!.key;
 const id=crypto.randomUUID(),state=(await b.state(room))!;
 const request:any={version:1,id,room,epoch:epochHash(state.epoch),kind:'send',binding:b.binding,candidate,signature:''};
 request.signature=await b.signControl(JSON.stringify(['interpoll/group/request',1,id,room,request.epoch,'send',b.binding,candidate]));
 const sealed=await sealTo(a.binding,JSON.stringify(request),proposalContext(room,id));
 await a.change(room,{remove:memberId(c.binding)});
 await expect(GroupRoomTransport.process(a,room,id,{sealed:JSON.stringify(sealed)})).rejects.toThrow(/Stale/);
 await expect(openSeal(c.identity,sealed,proposalContext(room,id))).rejects.toThrow();await expect(decryptRaw(old,{...candidate,...sealed})).rejects.toThrow();
});
it('voluntary leave is signed, epoch-bound and cannot remove a rejoined device by replay',async()=>{
 const {a,b,room}=await setup(),id=crypto.randomUUID(),state=(await a.state(room))!;
 const request:any={version:1,id,room,epoch:epochHash(state.epoch),kind:'leave',binding:b.binding,candidate:null,signature:''};
 request.signature=await b.signControl(JSON.stringify(['interpoll/group/request',1,id,room,request.epoch,'leave',b.binding,null]));
 const sealed=await sealTo(a.binding,JSON.stringify(request),proposalContext(room,id));
 const response=await GroupRoomTransport.process(a,room,id,{sealed:JSON.stringify(sealed)});expect(response.epoch!.members.map(memberId)).not.toContain(memberId(b.binding));
 await a.change(room,{add:b.binding});await expect(GroupRoomTransport.process(a,room,id,{sealed:JSON.stringify(sealed)})).rejects.toThrow(/Stale/);
});
it('active ChatRoomService sends only versioned authenticated envelopes and rejects legacy/send spoofing',async()=>{
 const {a,room}=await setup();vi.spyOn(GroupSecurity,'local').mockResolvedValue(a);vi.spyOn(GroupRoomTransport,'startOwner').mockResolvedValue();vi.spyOn(GroupRoomTransport,'flush').mockResolvedValue();
 const msg=await ChatRoomService.sendMessage(room,'active path',a.binding.accountId,'Alice');expect(msg.text).toBe('active path');
 const state=(await a.state(room))!;expect(state.outbox).toHaveLength(1);expect(state.outbox[0].receipt).not.toBe('');
 await expect(ChatRoomService.sendMessage(room,'spoof','mallory','Alice')).rejects.toThrow(/mismatch/);
 await expect(ChatRoomService.sendMessage('old-room','old',a.binding.accountId,'Alice')).rejects.toThrow(/migration/);
});
it('owner flush retries exact immutable record after restart without exposing keys',async()=>{
 const {a,room}=await setup(),e=await accepted(a,room);const path:any={get(){return this;}};vi.mocked(GunService.getGun).mockReturnValue(path);
 vi.mocked(gunPut).mockClear();await GroupRoomTransport.flush(a,room);await reopen();await GroupRoomTransport.flush(new GroupSecurity(a.identity),room);
 const publications=vi.mocked(gunPut).mock.calls.map(c=>c[1] as any).filter(r=>r.envelope);expect(publications).toEqual([{envelope:JSON.stringify(e)},{envelope:JSON.stringify(e)}]);
 expect(JSON.stringify(publications)).not.toContain((await a.state(room))!.keys.at(-1)!.key);
});
it('relay cannot replace the pinned owner device or return stale epoch after restart',async()=>{
 const {a,b,c,room,epoch}=await setup();const next=await a.change(room,{remove:memberId(c.binding)});await b.adopt(next);await reopen();
 const path:any={get(){return this;}};vi.mocked(GunService.getGun).mockReturnValue(path);vi.mocked(gunOnce).mockResolvedValue({epoch:JSON.stringify(epoch)});
 await expect(GroupRoomTransport.refresh(b,room)).rejects.toThrow(/Stale/);
 await expect(b.adopt({...next,owner:c.binding})).rejects.toThrow();
});
it('pruning plaintext does not reopen authorizations or recipient replay positions after restart',async()=>{
 const {a,b,room}=await setup(),candidate=await b.candidate(room,'keep replay protection','Bob'),e=await a.authorize(room,candidate);
 await b.receive(room,e);const db=await StorageService.getDB();await db.clear('chat-messages');await reopen();
 await expect(a.authorize(room,candidate)).rejects.toThrow(/authorized/);await expect(b.receive(room,e)).rejects.toThrow(/Stale/);
});
it('receipt replay floor rejects evicted positions without allocating unbounded state',async()=>{
 const {a,b,room}=await setup(),e=await accepted(a,room);const s=(await b.state(room))!;
 await StorageService.setMetadata(stateKey(b.binding.accountId,room),{...s,highWater:e.publication+GROUP_LIMITS.replay,received:{}});
 await expect(b.receive(room,e)).rejects.toThrow(/Stale/);
});
it('AEAD failure with valid sender signature does not commit owner acceptance',async()=>{
 const {a,b,room}=await setup(),candidate=await b.candidate(room,'auth','Bob');candidate.ciphertext=btoa('invalid ciphertext with valid signature');candidate.signature=await b.signControl(authorshipBytes(candidate));
 const before=JSON.stringify(await a.state(room));await expect(a.authorize(room,candidate)).rejects.toThrow();expect(JSON.stringify(await a.state(room))).toBe(before);
});
it('member identity replacement requires explicit removal, and revoked owner cannot be discovered',async()=>{
 const {a,b,c,room}=await setup();await expect(a.change(room,{add:{...b.binding,ik:c.binding.ik}})).rejects.toThrow(/Already/);
 await expect(a.change(room,{remove:memberId(a.binding)})).rejects.toThrow(/close/);
 await expect(b.change(room,{remove:memberId(c.binding)})).rejects.toThrow(/Owner/);
});
it.each(['iv','ciphertext','signature','receipt'])('modified %s fails even with all required fields present',async field=>{
 const {a,b,room}=await setup(),e=await accepted(a,room),changed=structuredClone(e);
 const value=(changed as any)[field] as string,bytes=atob(value);(changed as any)[field]=btoa(String.fromCharCode(bytes.charCodeAt(0)^1)+bytes.slice(1));
 await expect(b.receive(room,changed)).rejects.toThrow();expect((await b.receive(room,e)).status).toBe('accepted');
});
it('a valid owner-signed conflicting equal epoch cannot replace the persisted pin',async()=>{
 const {a,b,room,epoch}=await setup();const conflicting={...epoch,name:'different authorized fork'};conflicting.signature=await a.signControl(epochBytes(conflicting));
 const before=JSON.stringify(await b.state(room));await expect(b.adopt(conflicting)).rejects.toThrow(/Conflicting/);expect(JSON.stringify(await b.state(room))).toBe(before);
});
it('signed distribution tampering fails commitment before state commit',async()=>{
 const {a,b,c,room}=await setup();const next=await a.change(room,{remove:memberId(c.binding)});
 next.keyCommitment='f'.repeat(64);next.signature=await a.signControl(epochBytes(next));const before=JSON.stringify(await b.state(room));
 await expect(b.adopt(next)).rejects.toThrow(/commitment/);expect(JSON.stringify(await b.state(room))).toBe(before);
});
it('fake Gun end-to-end peer send routes through sealed request, owner receipt, and atomic recipient mirror',async()=>{
 const {a,b,room}=await setup(),candidate=await b.candidate(room,'private proposed text','Bob');const graph=new Map<string,any>();
 const node=(path='')=>({path,get(key:string){return node(`${path}/${key}`);}});
 vi.mocked(GunService.getGun).mockReturnValue(node() as any);
 vi.mocked(gunPut).mockImplementation(async(n:any,data:any)=>{
   graph.set(n.path,data);
   if(n.path.includes('/requests/')){
     const id=n.path.split('/').at(-1);const response=await GroupRoomTransport.process(a,room,id,data);
     graph.set(`/chatrooms/${room}/responses/${id}`,{response:JSON.stringify(response)});
   }return {ok:true};
 });
 vi.mocked(gunOnce).mockImplementation(async(n:any)=>graph.get(n.path)??null);
 const result=await GroupRoomTransport.submit(b,room,'send',candidate);
 expect(result.envelope!.receipt).not.toBe('');expect((await b.receive(room,result.envelope!)).status).toBe('duplicate');
 const request=[...graph.entries()].find(([path])=>path.includes('/requests/'))![1];expect(Object.keys(request)).toEqual(['sealed']);
 expect(JSON.stringify(request)).not.toContain(candidate.ciphertext);expect(JSON.stringify(request)).not.toContain('private proposed text');
});
it('active room approval uses expected account/device and epoch membership; public invite grants no key',async()=>{
 const {a,b,c,room}=await setup();vi.spyOn(GroupSecurity,'local').mockResolvedValue(a);
 await expect(ChatRoomService.approveMember(room,c.binding.accountId,b.binding.deviceId,b.binding)).rejects.toThrow();
 const d=await identity(4);vi.spyOn(GroupSecurity,'local').mockResolvedValue(d);
 vi.spyOn(GroupRoomTransport,'refresh').mockImplementation(async(s,r)=>s.adopt((await a.state(r))!.epoch));
 await expect(ChatRoomService.joinRoom(room,'epoch-v1','invite')).rejects.toThrow(/approve/);
 expect((await d.state(room))!.keys).toHaveLength(0);
});
it('owner close rotates epoch and cannot be reopened; explicit device approval is required for new identity',async()=>{
 const {a,b,room,epoch}=await setup();const closed=await a.change(room,{close:true});expect(closed.keyEpoch).toBe(epoch.keyEpoch+1);expect(closed.members).toEqual([]);
 await b.adopt(closed);await expect(b.candidate(room,'closed','Bob')).rejects.toThrow(/revoked/);await expect(a.change(room,{add:b.binding})).rejects.toThrow(/closed/);
});
