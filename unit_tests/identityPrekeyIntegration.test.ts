import 'fake-indexeddb/auto';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
vi.mock('../src/services/gunService',()=>({GunService:{getGun:vi.fn()},GUN_NAMESPACE:'test'}));
vi.mock('../src/utils/gunAsync',()=>({gunPut:vi.fn(async()=>({ok:true})),gunOnce:vi.fn(),gunReadChildren:vi.fn(),toGunRecord:(x:any)=>x}));
import ChatService from '../src/services/chatService';
import {GunService} from '../src/services/gunService';
import {gunOnce,gunPut} from '../src/utils/gunAsync';
import {StorageService} from '../src/services/storageService';
import {KeyService} from '../src/services/keyService';
import {ALICE,BOB,MEDIA_ALICE as MALLORY,getOrCreateIdentityBundle} from './dmIdentityFixture';
beforeEach(async()=>{
 const db=await StorageService.getDB();await db.clear('metadata');await db.clear('chat-messages');KeyService.clearCache();
 const node:any={get:vi.fn(),put:vi.fn()};node.get.mockReturnValue(node);vi.mocked(GunService.getGun).mockReturnValue(node);
});
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
it('REST and Gun cannot substitute Mallory v1 bundle for requested Bob',async()=>{
 const m=await getOrCreateIdentityBundle(MALLORY),chat=new ChatService('wss://example.invalid',ALICE) as any;
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify(m.bundle))));vi.mocked(gunOnce).mockResolvedValue(JSON.stringify(m.bundle));
 const db=await StorageService.getDB(),before=JSON.stringify(await db.getAll('metadata'));
 expect(await chat.fetchTheirBundle(BOB)).toBeNull();
 expect(JSON.stringify(await db.getAll('metadata'))).toBe(before);
});
it('cache validation emits a typed identity-change state and preserves prior pin',async()=>{
 const a=await getOrCreateIdentityBundle(ALICE),b=await getOrCreateIdentityBundle(BOB);
 const chat=new ChatService('wss://example.invalid',ALICE) as any;chat.myBundle=a;chat.ensureOPKPool=vi.fn().mockResolvedValue(undefined);
 chat.theirBundles.set(BOB,b.bundle);await chat.encryptFor(BOB,'pin');
 const key=`dm-trust-v1:${ALICE}:${BOB}`,before=await StorageService.getMetadata(key);
 await StorageService.setMetadata(key,{...before,binding:{...before.binding,generation:2}});
 chat.onIdentityState=vi.fn();await expect(chat.getTheirBundle(BOB)).rejects.toMatchObject({state:'IDENTITY_CHANGED'});
 expect(chat.onIdentityState).toHaveBeenCalledWith({userId:BOB,state:'IDENTITY_CHANGED'});
 expect((await StorageService.getMetadata(key)).binding.generation).toBe(2);
});
it('init publishes account-authorized bundle without enumerating/deleting legacy sessions',async()=>{
 await KeyService.importPrivateKey('01'.padStart(64,'0'));
 const key=`signal-session:${ALICE}:${BOB}`;await StorageService.setMetadata(key,{legacy:'preserve'});
 const chat=new ChatService('wss://example.invalid',ALICE) as any;
 for(const name of ['startConnectionTracking','startOutboxLoop','startPresence','startVisibilityTracking','connect']) chat[name]=vi.fn();
 vi.mocked(gunOnce).mockResolvedValue(null);
 const bundle=JSON.parse(await chat.init());expect(bundle.version).toBe(1);expect(bundle.binding.accountId).toBe(ALICE);
 expect(await StorageService.getMetadata(key)).toEqual({legacy:'preserve'});
 expect(await StorageService.getMetadata(`signal-protocol-version:${ALICE}`)).toBeUndefined();
 expect(vi.mocked(gunPut).mock.calls.some(call=>JSON.stringify(call[1]).includes('spkAuthorization'))).toBe(true);
});
it('init refuses a profile/account ID not owned by the current KeyService signer',async()=>{
 await KeyService.importPrivateKey('01'.padStart(64,'0'));
 const chat=new ChatService('wss://example.invalid',BOB);
 const calls=vi.mocked(gunPut).mock.calls.length;
 await expect(chat.init()).rejects.toMatchObject({state:'UNKNOWN'});
 expect(vi.mocked(gunPut).mock.calls.length).toBe(calls);
 expect(await StorageService.getMetadata(`dm-local-identity-v1:${BOB}`)).toBeUndefined();
});
