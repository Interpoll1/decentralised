import { ALICE, BOB, MEDIA_ALICE, MEDIA_BOB, getOrCreateIdentityBundle, selectedBundle } from './dmIdentityFixture';
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('../src/services/gunService', () => ({ GunService: { getGun: vi.fn() }, GUN_NAMESPACE: 'test' }));
vi.mock('../src/utils/gunAsync', () => ({ gunPut: vi.fn(), gunOnce: vi.fn(), gunReadChildren: vi.fn(), toGunRecord: (x: unknown) => x }));
import ChatService from '../src/services/chatService';
import { StorageService } from '../src/services/storageService';
import { generateOPKBatch, SignalSession } from '../src/services/signalProtocol';
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
beforeEach(async () => { const db = await StorageService.getDB(); await db.clear('metadata'); await db.clear('chat-messages'); });
async function snapshot() {
  const db = await StorageService.getDB();
  return JSON.stringify([await db.getAllKeys('metadata'), await db.getAll('metadata'), await db.getAll('chat-messages')]);
}
it('forged bootstrap leaves all durable state and OPKs unchanged repeatedly', async () => {
  const a = await getOrCreateIdentityBundle(ALICE), b = await getOrCreateIdentityBundle(BOB);
  const sender = new SignalSession(ALICE,BOB), receiver = new SignalSession(BOB,ALICE);
  // Bob has a legitimate outbound session, but has not received yet (nr=0).
  await receiver.encrypt('legitimate outbound', b, a.bundle);
  const pool = await generateOPKBatch(2, BOB);
  const envelope = await sender.encrypt('legitimate incoming', a, await selectedBundle(b,pool[0]));
  const before = await snapshot();
  for (let i=0; i<3; i++) {
    await expect(receiver.decrypt({...envelope, ct:btoa('forged')}, b, a.bundle.ik, BOB)).rejects.toThrow();
    expect(await snapshot()).toBe(before);
  }
  expect(await receiver.decrypt(envelope, b, a.bundle.ik, BOB)).toBe('legitimate incoming');
  expect((await StorageService.getMetadata(`signal-opk-pool:${BOB}`)).some((x:any)=>x.id===pool[0].id)).toBe(false);
});
it('ChatService rejects unauthenticated inputs without tombstones or session deletion', async () => {
  const a = await getOrCreateIdentityBundle(ALICE), b = await getOrCreateIdentityBundle(BOB);
  const sender = new SignalSession(ALICE,BOB), receiver = new SignalSession(BOB,ALICE);
  const first = await sender.encrypt('hello', a, b.bundle);
  await receiver.decrypt(first, b, a.bundle.ik, BOB);
  const chat = new ChatService('wss://example.invalid',BOB) as any;
  chat.myBundle = b; chat.theirBundles.set(ALICE, a.bundle);
  const before = await snapshot();
  for(let i=0;i<3;i++) {
    expect(await chat.mergeRemote({...first, ct:btoa('forged'), id:`bad-${i}`, senderId:ALICE,recipientId:BOB}, `${ALICE}:${BOB}`)).toBeNull();
    expect(await snapshot()).toBe(before);
  }
  const next = await sender.encrypt('still works', a, b.bundle);
  expect((await chat.mergeRemote({...next,id:'next',senderId:ALICE,recipientId:BOB},`${ALICE}:${BOB}`)).text).toBe('still works');
});

it('failure writing accepted message atomically rolls back session and OPK consumption', async () => {
  const a=await getOrCreateIdentityBundle(ALICE), b=await getOrCreateIdentityBundle(BOB);
  const pool=await generateOPKBatch(1,BOB);
  const envelope=await new SignalSession(ALICE,BOB).encrypt('authenticated',a,await selectedBundle(b,pool[0]));
  const receiver=new SignalSession(BOB,ALICE);
  const before=await snapshot();
  await expect(receiver.decrypt(envelope,b,a.bundle.ik,BOB,text=>({id:'accepted',text,uncloneable:()=>{}} as any))).rejects.toThrow();
  expect(await snapshot()).toBe(before);
  await receiver.decrypt(envelope,b,a.bundle.ik,BOB,text=>({id:'accepted',text} as any));
  expect((await StorageService.getChatMessage('accepted'))?.text).toBe('authenticated');
  expect((await StorageService.getMetadata(`signal-opk-pool:${BOB}`)).map((entry:any)=>entry.id)).toEqual(pool.filter(entry=>entry.id!==envelope.opkId).map(entry=>entry.id));
});

it('forged input with a cold bundle cache cannot persist fetched discovery material', async()=>{
  const a=await getOrCreateIdentityBundle(ALICE), b=await getOrCreateIdentityBundle(BOB);
  const env=await new SignalSession(ALICE,BOB).encrypt('valid',a,b.bundle);
  const chat=new ChatService('wss://example.invalid',BOB) as any;chat.myBundle=b;
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify(a.bundle))));
  const before=await snapshot();
  await chat.mergeRemote({...env,ct:btoa('forged'),id:'cold-forgery',senderId:ALICE,recipientId:BOB},`${ALICE}:${BOB}`);
  expect(await snapshot()).toBe(before);
});

it('forgery reusing an accepted message ID cannot trigger receipt or crypto mutations',async()=>{
  const a=await getOrCreateIdentityBundle(ALICE),b=await getOrCreateIdentityBundle(BOB);
  const env=await new SignalSession(ALICE,BOB).encrypt('accepted',a,b.bundle);
  const chat=new ChatService('wss://example.invalid',BOB) as any;
  chat.myBundle=b;chat.theirBundles.set(ALICE,a.bundle);chat.ensureOPKPool=vi.fn().mockResolvedValue(undefined);
  await chat.mergeRemote({...env,id:'accepted-id',senderId:ALICE,recipientId:BOB},`${ALICE}:${BOB}`);
  const before=await snapshot();
  expect(await chat.mergeRemote({...env,ct:btoa('forged'),id:'accepted-id',senderId:ALICE,recipientId:BOB},`${ALICE}:${BOB}`)).toBeNull();
  expect(await snapshot()).toBe(before);
});
