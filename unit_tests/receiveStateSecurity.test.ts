import 'fake-indexeddb/auto';
import {beforeEach,expect,it,vi} from 'vitest';
vi.mock('../src/services/gunService',()=>({GunService:{getGun:vi.fn()},GUN_NAMESPACE:'test'}));
vi.mock('../src/utils/gunAsync',()=>({gunPut:vi.fn(),gunOnce:vi.fn(),gunReadChildren:vi.fn(),toGunRecord:(x:unknown)=>x}));
import {StorageService} from '../src/services/storageService';
import {SignalSession} from '../src/services/signalProtocol';
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
