import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('../src/services/gunService', () => ({ GunService: { getGun: vi.fn() }, GUN_NAMESPACE: 'test' }));
vi.mock('../src/utils/gunAsync', () => ({ gunPut: vi.fn(), gunOnce: vi.fn(), gunReadChildren: vi.fn(), toGunRecord: (x: unknown) => x }));
import ChatService from '../src/services/chatService';
import { StorageService } from '../src/services/storageService';
import { SignalSession, getOrCreateIdentityBundle } from '../src/services/signalProtocol';
import { GunService } from '../src/services/gunService';
import { gunPut } from '../src/utils/gunAsync';
afterEach(() => {vi.unstubAllGlobals();vi.restoreAllMocks();});
beforeEach(async () => { const db=await StorageService.getDB();await db.clear('metadata');await db.clear('chat-messages'); });
async function fixture() {
  const a=await getOrCreateIdentityBundle('alice'), b=await getOrCreateIdentityBundle('bob');
  const node:any={get:vi.fn(),put:vi.fn()};node.get.mockReturnValue(node);
  vi.mocked(GunService.getGun).mockReturnValue(node);
  vi.mocked(gunPut).mockResolvedValue({ok:false,err:'unavailable'});
  vi.stubGlobal('WebSocket',{OPEN:1});
  const make=()=> {const s=new ChatService('wss://example.invalid','alice') as any;s.myBundle=a;s.theirBundles.set('bob',b.bundle);s.ensureOPKPool=vi.fn();s.ready=true;return s;};
  const row={id:'logical',roomId:'alice:bob',senderId:'alice',recipientId:'bob',text:'secret',kind:'dm' as const,outgoing:true,timestamp:Date.now(),seq:1,syncStatus:'pending' as const,syncAttempts:0};
  await StorageService.saveChatMessage(row);
  return {a,b,row,make};
}
it('websocket absent and Gun failure stay pending across restart and stale retries',async()=>{
  const {row,make}=await fixture();
  expect((await make().deliver(row)).syncStatus).toBe('pending');
  const before=await StorageService.getChatMessage(row.id);
  const state=JSON.stringify(await StorageService.getMetadata('signal-session:alice:bob'));
  (await StorageService.getDB()).close();(StorageService as any).dbPromise=undefined;
  await make().deliver(row);
  expect((await StorageService.getChatMessage(row.id))?.encryptedEnvelope).toBe(before?.encryptedEnvelope);
  expect(JSON.stringify(await StorageService.getMetadata('signal-session:alice:bob'))).toBe(state);
});
it('Gun local acknowledgement alone is not durable publication or recipient delivery',async()=>{
  const {row,make}=await fixture();vi.mocked(gunPut).mockResolvedValue({ok:true});
  expect((await make().deliver(row)).syncStatus).toBe('pending');
});
it('websocket timeout and late unauthenticated relay ACK never imply delivery',async()=>{
  const {row,make}=await fixture();const chat=make();chat.ws={readyState:1,send:vi.fn()};
  expect((await chat.deliver(row)).syncStatus).toBe('pending');
  chat.onDelivered=vi.fn();
  await chat.handleWsMessage({type:'chat-delivered',messageId:row.id,recipientId:'bob'});
  expect(chat.onDelivered).not.toHaveBeenCalled();
  expect((await StorageService.getChatMessage(row.id))?.syncStatus).toBe('pending');
});
it('send overlapping flush across instances retains one envelope per logical message',async()=>{
  const {row,make,a,b}=await fixture();const x=make(),y=make();
  const sent=await Promise.all([x.sendMessage('bob','new message'),y.flushOutbox(),x.deliver(row)]);
  await vi.waitFor(async()=>expect((await StorageService.getChatMessage((sent[0] as any).id))?.encryptedEnvelope).toBeTruthy());
  const rows=(await StorageService.getAllChatMessages()).filter(r=>r.outgoing);
  const envelopes=rows.map(r=>JSON.parse(r.encryptedEnvelope!));
  expect(new Set(envelopes.map(e=>`${e.dh}:${e.n}`)).size).toBe(2);
  const receiver=new SignalSession('bob','alice');
  for(const e of envelopes.sort((a,b)=>a.n-b.n)) await receiver.decrypt(e,b,a.bundle.ik,'bob');
});
async function digest(id:string,env:any) {
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([
    'interpoll-dm-delivery-1',id,'alice','bob',env.v,env.eph??'',env.opkId??'',env.dh,env.n,env.pn,env.ct])));
  return Buffer.from(bytes).toString('hex');
}
it('authenticated exact-envelope peer receipt confirms; duplicate and late receipts are idempotent',async()=>{
  const {row,make,a,b}=await fixture();const chat=make();await chat.deliver(row);
  expect((await StorageService.getChatMessage(row.id))?.syncStatus).toBe('pending');
  const stored=(await StorageService.getChatMessage(row.id))!;const envelope=JSON.parse(stored.encryptedEnvelope!);
  const peer=new SignalSession('bob','alice');await peer.decrypt(envelope,b,a.bundle.ik,'bob');
  const payload='\u0000DM-DELIVERED-1:'+JSON.stringify({id:row.id,digest:await digest(row.id,envelope)});
  const ack=await peer.encrypt(payload,b,a.bundle);
  const raw={...ack,id:'receipt-1',senderId:'bob',recipientId:'alice'};
  await chat.mergeRemote(raw,'alice:bob');
  expect((await StorageService.getChatMessage(row.id))?.syncStatus).toBe('confirmed');
  const state=JSON.stringify(await StorageService.getMetadata('signal-session:alice:bob'));
  await make().mergeRemote(raw,'alice:bob');
  expect(JSON.stringify(await StorageService.getMetadata('signal-session:alice:bob'))).toBe(state);
  expect((await StorageService.getChatMessage(row.id))?.encryptedEnvelope).toBe(stored.encryptedEnvelope);
});

it('encrypted receipt with substituted envelope digest does not confirm',async()=>{
  const {row,make,a,b}=await fixture();const chat=make();await chat.deliver(row);
  const outgoing=(await StorageService.getChatMessage(row.id))!;
  const peer=new SignalSession('bob','alice');await peer.decrypt(JSON.parse(outgoing.encryptedEnvelope!),b,a.bundle.ik,'bob');
  const ack=await peer.encrypt('\u0000DM-DELIVERED-1:'+JSON.stringify({id:row.id,digest:'0'.repeat(64)}),b,a.bundle);
  await chat.mergeRemote({...ack,id:'wrong-receipt',senderId:'bob',recipientId:'alice'},'alice:bob');
  expect((await StorageService.getChatMessage(row.id))?.syncStatus).toBe('pending');
});
it('32 concurrent ChatService sends and an outbox flush consume unique positions',async()=>{
  const {make,a,b}=await fixture();
  const sender=new SignalSession('alice','bob'), receiver=new SignalSession('bob','alice');
  await receiver.decrypt(await sender.encrypt('init',a,b.bundle),b,a.bundle.ik,'bob');
  await sender.decrypt(await receiver.encrypt('reply',b,a.bundle),a,b.bundle.ik,'alice');
  const services=[make(),make(),make()];
  const values=Array.from({length:32},(_,i)=>`concurrent-${i}`);
  await Promise.all([...values.map((text,i)=>services[i%3].sendMessage('bob',text)),services[1].flushOutbox()]);
  await vi.waitFor(async()=>{
    const rows=await StorageService.getAllChatMessages();
    expect(rows.filter(r=>r.outgoing&&r.encryptedEnvelope&&r.syncAttempts>0).length).toBe(33);
  },{timeout:10000});
  const rows=(await StorageService.getAllChatMessages()).filter(r=>r.outgoing);
  const envelopes=rows.map(r=>JSON.parse(r.encryptedEnvelope!));
  expect(new Set(envelopes.map(e=>`${e.dh}:${e.n}`)).size).toBe(33);
  const decrypted=[];
  for(const env of envelopes.sort((a,b)=>a.n-b.n)) decrypted.push(await receiver.decrypt(env,b,a.bundle.ik,'bob'));
  expect(decrypted.sort()).toEqual([...values,'secret'].sort());
});
