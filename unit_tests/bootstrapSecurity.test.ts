import 'fake-indexeddb/auto';
import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('../src/services/gunService', () => ({ GunService: { getGun: vi.fn() }, GUN_NAMESPACE: 'test' }));
vi.mock('../src/utils/gunAsync', () => ({ gunPut: vi.fn(), gunOnce: vi.fn(), gunReadChildren: vi.fn(), toGunRecord: (x: unknown) => x }));
import ChatService from '../src/services/chatService';
import { StorageService } from '../src/services/storageService';
import { getOrCreateIdentityBundle, generateOPKBatch, SignalSession } from '../src/services/signalProtocol';
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
