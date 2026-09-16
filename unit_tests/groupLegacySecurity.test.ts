import 'fake-indexeddb/auto';
import {beforeEach,expect,it,vi} from 'vitest';
const fake=vi.hoisted(()=>({key:null as any,record:null as any}));
vi.mock('../src/services/gunService',()=>({GunService:{getGun:()=>({get(){return this;}}),onReconnect:()=>()=>{}},GUN_NAMESPACE:'test'}));
vi.mock('../src/utils/gunAsync',()=>({gunPut:vi.fn(async(_n:any,r:any)=>{fake.record=r;return {ok:true};}),gunOnce:vi.fn(),gunReadChildren:vi.fn(async()=>[]),verifySoulOnRelay:vi.fn(async()=>true),toGunRecord:(x:any)=>x}));
vi.mock('../src/services/keyVaultService',()=>({KeyVaultService:{getKey:async()=>fake.key,removeKey:async()=>{fake.key=null;}}}));
vi.mock('../src/services/userService',()=>({UserService:{getCurrentUser:async()=>({id:'carol'})}}));
import {ChatRoomService} from '../src/services/chatRoomService';
import {EncryptionService} from '../src/services/encryptionService';
import {StorageService} from '../src/services/storageService';
beforeEach(async()=>{const db=await StorageService.getDB();await db.clear('metadata');await db.clear('chat-messages');fake.record=null;});
it('F11 rejects legacy ciphertext transplanted to a different room without authorship',async()=>{
 const key=await EncryptionService.generateKey();fake.key={key:await EncryptionService.exportKey(key)};
 const data={id:'transplant',roomId:'room-a',senderId:'alice',timestamp:1,seq:1,encryptedContent:await EncryptionService.encrypt(JSON.stringify({text:'secret',senderId:'alice'}),key)};
 expect(await (ChatRoomService as any).decodeMessage('room-b',data)).toBeNull();
});
it('F11 rejects a member claiming Alice with only shared-key authentication',async()=>{
 const key=await EncryptionService.generateKey();fake.key={key:await EncryptionService.exportKey(key)};
 const data={id:'impersonate',senderId:'alice',timestamp:1,seq:1,encryptedContent:await EncryptionService.encrypt(JSON.stringify({text:'from Bob',senderId:'alice'}),key),authTag:await EncryptionService.generateAuthTag(key,'impersonate','1','alice')};
 expect(await (ChatRoomService as any).decodeMessage('room-impersonate',data)).toBeNull();
});
it('F21 legacy leave must not claim completed future revocation by local key deletion',async()=>{
 const key=await EncryptionService.generateKey();fake.key={key:await EncryptionService.exportKey(key)};
 await expect(ChatRoomService.leaveRoom('legacy-room')).rejects.toThrow(/legacy|migration/i);
});
