import 'fake-indexeddb/auto';
import {beforeEach,it,expect,vi} from 'vitest';
vi.mock('../src/services/gunService',()=>({GunService:{getGun:vi.fn()},GUN_NAMESPACE:'test'}));
vi.mock('../src/utils/gunAsync',()=>({gunPut:vi.fn(),gunOnce:vi.fn(),gunReadChildren:vi.fn(),toGunRecord:(x:unknown)=>x}));
import ChatService from '../src/services/chatService';
import {StorageService} from '../src/services/storageService';
import {SignalSession} from '../src/services/signalProtocol';
import {ALICE,BOB,getOrCreateIdentityBundle} from './dmIdentityFixture';
beforeEach(async()=>{const db=await StorageService.getDB();await db.clear('metadata');await db.clear('chat-messages');});
async function snapshot(){const db=await StorageService.getDB();return JSON.stringify([await db.getAllKeys('metadata'),await db.getAll('metadata'),await db.getAll('chat-messages')]);}
async function peers(){const a=await getOrCreateIdentityBundle(ALICE),b=await getOrCreateIdentityBundle(BOB);for(const x of [a,b]){x.bundle.opks=[];x.bundle.selectedOPK=null;delete x.bundle.opk;delete x.bundle.opkId;}return {a,b,s:new SignalSession(ALICE,BOB),r:new SignalSession(BOB,ALICE)};}
async function established(){const p=await peers();const first=await p.s.encrypt('first',p.a,p.b.bundle);await p.r.decrypt(first,p.b,p.a.bundle.ik,BOB);const reply=await p.r.encrypt('reply',p.b,p.a.bundle);await p.s.decrypt(reply,p.a,p.b.bundle.ik,ALICE);const next=await p.s.encrypt('advance',p.a,p.b.bundle);await p.r.decrypt(next,p.b,p.a.bundle.ik,BOB);return {...p,first};}
it('unauthenticated relay reset controls cannot erase an advanced session',async()=>{
 const {first,b,a,r}=await established();const service:any=new ChatService(BOB);const before=await snapshot();
 for(const type of ['chat-start','chat-invite']){await service.handleWsMessage({type,from:ALICE});expect(await snapshot()).toBe(before);}
 await expect(r.decrypt(first,b,a.bundle.ik,BOB)).rejects.toThrow();expect(await snapshot()).toBe(before);
});
it('historical bootstrap cannot become fresh authority after ratchet state loss',async()=>{
 const {first,b,a}=await established();await StorageService.setMetadata(`signal-session:${BOB}:${ALICE}`,null);const before=await snapshot();
 await expect(new SignalSession(BOB,ALICE).decrypt(first,b,a.bundle.ik,BOB)).rejects.toThrow();expect(await snapshot()).toBe(before);
});
