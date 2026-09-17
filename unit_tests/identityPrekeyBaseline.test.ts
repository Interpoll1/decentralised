import 'fake-indexeddb/auto';
import {beforeEach,it,expect,vi} from 'vitest';
vi.mock('../src/services/gunService',()=>({GunService:{getGun:vi.fn()},GUN_NAMESPACE:'test'}));
import ChatService from '../src/services/chatService';
import {StorageService} from '../src/services/storageService';
import {getOrCreateIdentityBundle,verifySpkSignature,generateOPKBatch,consumeOPK} from '../src/services/signalProtocol';
beforeEach(async()=>{const db=await StorageService.getDB();await db.clear('metadata');await db.clear('chat-messages');});
it('F01 active cached Bob lookup rejects Mallory valid self-signed legacy bundle',async()=>{
 const mallory=await getOrCreateIdentityBundle('mallory');
 const chat=new ChatService('wss://example.invalid','alice') as any;
 chat.theirBundles.set('bob',mallory.bundle);
 await expect(chat.getTheirBundle('bob')).rejects.toThrow();
});
it('missing SPK signature fails closed',async()=>{
 const b=await getOrCreateIdentityBundle('bob');
 await expect(verifySpkSignature({...b.bundle,spkSig:''})).rejects.toThrow();
});
it('malformed SPK signing key fails closed',async()=>{
 const b=await getOrCreateIdentityBundle('bob');
 await expect(verifySpkSignature({...b.bundle,ikSignPub:btoa('invalid')})).rejects.toThrow();
});
it('F07 baseline: 64 concurrent requests for the same OPK have one winner',async()=>{
 const pool=await generateOPKBatch(1,'bob');
 const values=await Promise.all(Array.from({length:64},()=>consumeOPK('bob',pool[0].id)));
 expect(values.filter(Boolean)).toHaveLength(1);
});
