import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('../src/services/gunService', () => ({ GunService: { getGun: vi.fn() }, GUN_NAMESPACE: 'test' }));
vi.mock('../src/utils/gunAsync', () => ({ gunPut: vi.fn(), gunOnce: vi.fn(), gunReadChildren: vi.fn(), toGunRecord: (x: unknown) => x }));
import ChatService from '../src/services/chatService';
import { StorageService } from '../src/services/storageService';
import { getOrCreateIdentityBundle, generateOPKBatch, SignalSession } from '../src/services/signalProtocol';
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
beforeEach(async () => { const db = await StorageService.getDB(); await db.clear('metadata'); await db.clear('chat-messages'); });
async function snapshot() {
  const db = await StorageService.getDB();
  return JSON.stringify([await db.getAllKeys('metadata'), await db.getAll('metadata'), await db.getAll('chat-messages')]);
}
it('forged bootstrap leaves all durable state and OPKs unchanged repeatedly', async () => {
  const a = await getOrCreateIdentityBundle('alice'), b = await getOrCreateIdentityBundle('bob');
  const sender = new SignalSession('alice','bob'), receiver = new SignalSession('bob','alice');
  // Bob has a legitimate outbound session, but has not received yet (nr=0).
  await receiver.encrypt('legitimate outbound', b, a.bundle);
  const pool = await generateOPKBatch(2, 'bob');
  const envelope = await sender.encrypt('legitimate incoming', a, { ...b.bundle, opk: pool[0].pubB64, opkId: pool[0].id });
  const before = await snapshot();
  for (let i=0; i<3; i++) {
    await expect(receiver.decrypt({...envelope, ct:btoa('forged')}, b, a.bundle.ik, 'bob')).rejects.toThrow();
    expect(await snapshot()).toBe(before);
  }
  expect(await receiver.decrypt(envelope, b, a.bundle.ik, 'bob')).toBe('legitimate incoming');
  expect((await StorageService.getMetadata('signal-opk-pool:bob')).some((x:any)=>x.id===pool[0].id)).toBe(false);
});
it('ChatService rejects unauthenticated inputs without tombstones or session deletion', async () => {
  const a = await getOrCreateIdentityBundle('alice'), b = await getOrCreateIdentityBundle('bob');
  const sender = new SignalSession('alice','bob'), receiver = new SignalSession('bob','alice');
  const first = await sender.encrypt('hello', a, b.bundle);
  await receiver.decrypt(first, b, a.bundle.ik, 'bob');
  const chat = new ChatService('wss://example.invalid','bob') as any;
  chat.myBundle = b; chat.theirBundles.set('alice', a.bundle);
  const before = await snapshot();
  for(let i=0;i<3;i++) {
    expect(await chat.mergeRemote({...first, ct:btoa('forged'), id:`bad-${i}`, senderId:'alice',recipientId:'bob'}, 'alice:bob')).toBeNull();
    expect(await snapshot()).toBe(before);
  }
  const next = await sender.encrypt('still works', a, b.bundle);
  expect((await chat.mergeRemote({...next,id:'next',senderId:'alice',recipientId:'bob'},'alice:bob')).text).toBe('still works');
});

it('failure writing accepted message atomically rolls back session and OPK consumption', async () => {
  const a=await getOrCreateIdentityBundle('alice'), b=await getOrCreateIdentityBundle('bob');
  const pool=await generateOPKBatch(1,'bob');
  const envelope=await new SignalSession('alice','bob').encrypt('authenticated',a,{...b.bundle,opk:pool[0].pubB64,opkId:pool[0].id});
  const receiver=new SignalSession('bob','alice');
  const before=await snapshot();
  await expect(receiver.decrypt(envelope,b,a.bundle.ik,'bob',text=>({id:'accepted',text,uncloneable:()=>{}} as any))).rejects.toThrow();
  expect(await snapshot()).toBe(before);
  await receiver.decrypt(envelope,b,a.bundle.ik,'bob',text=>({id:'accepted',text} as any));
  expect((await StorageService.getChatMessage('accepted'))?.text).toBe('authenticated');
  expect((await StorageService.getMetadata('signal-opk-pool:bob')).length).toBe(0);
});

it('forged input with a cold bundle cache cannot persist fetched discovery material', async()=>{
  const a=await getOrCreateIdentityBundle('alice'), b=await getOrCreateIdentityBundle('bob');
  const env=await new SignalSession('alice','bob').encrypt('valid',a,b.bundle);
  const chat=new ChatService('wss://example.invalid','bob') as any;chat.myBundle=b;
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify(a.bundle))));
  const before=await snapshot();
  await chat.mergeRemote({...env,ct:btoa('forged'),id:'cold-forgery',senderId:'alice',recipientId:'bob'},'alice:bob');
  expect(await snapshot()).toBe(before);
});

it('forgery reusing an accepted message ID cannot trigger receipt or crypto mutations',async()=>{
  const a=await getOrCreateIdentityBundle('alice'),b=await getOrCreateIdentityBundle('bob');
  const env=await new SignalSession('alice','bob').encrypt('accepted',a,b.bundle);
  const chat=new ChatService('wss://example.invalid','bob') as any;
  chat.myBundle=b;chat.theirBundles.set('alice',a.bundle);chat.ensureOPKPool=vi.fn();
  await chat.mergeRemote({...env,id:'accepted-id',senderId:'alice',recipientId:'bob'},'alice:bob');
  const before=await snapshot();
  expect(await chat.mergeRemote({...env,ct:btoa('forged'),id:'accepted-id',senderId:'alice',recipientId:'bob'},'alice:bob')).toBeNull();
  expect(await snapshot()).toBe(before);
});
