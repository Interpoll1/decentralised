import 'fake-indexeddb/auto';
import {beforeEach,it,expect} from 'vitest';
import {ALICE,BOB,MEDIA_ALICE as MALLORY,getOrCreateIdentityBundle} from './dmIdentityFixture';
import {StorageService} from '../src/services/storageService';
import {KeyService} from '../src/services/keyService';
import {CryptoService} from '../src/services/cryptoService';
import {SignalSession,generateOPKBatch,consumeOPK} from '../src/services/signalProtocol';
import {verifyAuthenticatedBundle,continuityChange,bindingBytes,spkBytes,authorizeLocalBundle} from '../src/services/dmIdentity';
beforeEach(async()=>{const db=await StorageService.getDB();await db.clear('metadata');await db.clear('chat-messages');});
async function peers(){const a=await getOrCreateIdentityBundle(ALICE),b=await getOrCreateIdentityBundle(BOB);return {a,b,sender:new SignalSession(ALICE,BOB),receiver:new SignalSession(BOB,ALICE)};}
async function snapshot(){const db=await StorageService.getDB();return JSON.stringify([await db.getAllKeys('metadata'),await db.getAll('metadata'),await db.getAll('chat-messages')]);}
it('valid first account binding and repeated binding verify under the requested account/device',async()=>{
 const {a,b,sender}=await peers();
 expect((await verifyAuthenticatedBundle(b.bundle,BOB,b.bundle.binding.deviceId)).ik).toBe(b.bundle.ik);
 await sender.encrypt('first',a,b.bundle);
 expect((await StorageService.getMetadata(`dm-trust-v1:${ALICE}:${BOB}`)).state).toBe('FIRST_SEEN_VALIDATED');
 await sender.encrypt('second',a,b.bundle);
 expect((await StorageService.getMetadata(`dm-trust-v1:${ALICE}:${BOB}`)).state).toBe('TRUSTED');
});
it('request Bob rejects cryptographically valid Mallory binding and wrong account signer',async()=>{
 const m=await getOrCreateIdentityBundle(MALLORY);
 await expect(verifyAuthenticatedBundle(m.bundle,BOB)).rejects.toThrow();
 const fake=structuredClone(m.bundle);fake.binding.accountId=BOB;
 fake.binding.signature=CryptoService.sign(bindingBytes(fake.binding),'03'.padStart(64,'0'));
 await expect(verifyAuthenticatedBundle(fake,BOB)).rejects.toThrow();
});
it('rejects wrong device, missing/malformed binding, missing/malformed SPK signature and signer key',async()=>{
 const {b}=await peers();
 await expect(verifyAuthenticatedBundle(b.bundle,BOB,crypto.randomUUID())).rejects.toThrow();
 for(const change of [{binding:undefined},{binding:{}},{spkAuthorization:''},{spkAuthorization:btoa('bad')},{ikSignPub:btoa('bad')},{version:2}])
   await expect(verifyAuthenticatedBundle({...b.bundle,...change} as any,BOB)).rejects.toThrow();
});
it('same account/device cannot silently replace IK even with account-authorized self-consistent signatures',async()=>{
 const {a,b,sender}=await peers();await sender.encrypt('pin',a,b.bundle);
 const m=await getOrCreateIdentityBundle(MALLORY), replacement=structuredClone(m.bundle);
 replacement.binding={...replacement.binding,accountId:BOB,deviceId:b.bundle.binding.deviceId,generation:2};
 replacement.binding.signature=CryptoService.sign(bindingBytes(replacement.binding),'02'.padStart(64,'0'));
 replacement.opks=[];replacement.selectedOPK=null;delete replacement.opk;delete replacement.opkId;
 const sig=await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},m.ikSign.priv,new TextEncoder().encode(spkBytes(replacement)));
 replacement.spkAuthorization=btoa(String.fromCharCode(...new Uint8Array(sig)));
 const verified=await verifyAuthenticatedBundle(replacement,BOB);
 const before=await snapshot();await expect(continuityChange(ALICE,verified)).rejects.toMatchObject({state:'IDENTITY_CHANGED'});
 expect(await snapshot()).toBe(before);
});
it('revoked/unknown devices and superseded binding/SPK replay are rejected without replacing pins',async()=>{
 const {a,b,sender}=await peers();await sender.encrypt('pin',a,b.bundle);
 const key=`dm-trust-v1:${ALICE}:${BOB}`,pin=await StorageService.getMetadata(key);
 await StorageService.setMetadata(key,{...pin,binding:{...pin.binding,generation:2}});
 await expect(continuityChange(ALICE,b.bundle)).rejects.toMatchObject({state:'IDENTITY_CHANGED'});
 await StorageService.setMetadata(key,{...pin,spkGeneration:2});
 await expect(continuityChange(ALICE,b.bundle)).rejects.toMatchObject({state:'STALE_PREKEY'});
 await StorageService.setMetadata(key,{...pin,state:'REVOKED'});
 await expect(continuityChange(ALICE,b.bundle)).rejects.toMatchObject({state:'REVOKED'});
 await StorageService.setMetadata(key,{...pin,binding:{...pin.binding,deviceId:crypto.randomUUID()}});
 await expect(continuityChange(ALICE,b.bundle)).rejects.toMatchObject({state:'UNKNOWN_DEVICE'});
});
it('64 distinct consumers consume exactly 64 IDs, restart and replenishment cannot resurrect them',async()=>{
 const pool=await generateOPKBatch(64,'pool');
 const taken=await Promise.all(pool.map(p=>consumeOPK('pool',p.id)));
 expect(new Set(taken.map(p=>p!.id)).size).toBe(64);
 expect(await consumeOPK('pool',pool[0].id)).toBeNull();
 (await StorageService.getDB()).close();(StorageService as any).dbPromise=undefined;
 expect(await consumeOPK('pool',pool[0].id)).toBeNull();
 const fresh=await generateOPKBatch(20,'pool');
 expect(fresh.some(p=>pool.some(old=>old.id===p.id))).toBe(false);
 expect(Object.keys(await StorageService.getMetadata('dm-consumed-opks-v1:pool'))).toHaveLength(64);
});
it('forged/valid bootstrap race consumes exactly the selected OPK only for the winner',async()=>{
 const {a,b,sender,receiver}=await peers();const env=await sender.encrypt('valid',a,b.bundle);
 const before=await snapshot();
 await expect(receiver.decrypt({...env,ct:btoa('forged')},b,a.bundle.ik,BOB)).rejects.toThrow();expect(await snapshot()).toBe(before);
 const results=await Promise.allSettled([receiver.decrypt({...env,ct:btoa('forged')},b,a.bundle.ik,BOB),receiver.decrypt(env,b,a.bundle.ik,BOB)]);
 expect(results.map(r=>r.status)).toEqual(['rejected','fulfilled']);
 expect(Object.keys(await StorageService.getMetadata(`dm-consumed-opks-v1:${BOB}`))).toEqual([env.opkId]);
 const remaining=await StorageService.getMetadata(`signal-opk-pool:${BOB}`);
 expect(remaining).toHaveLength(b.bundle.opks.length-1);expect(remaining.some((p:any)=>p.id===env.opkId)).toBe(false);
 await expect(receiver.decrypt(env,b,a.bundle.ik,BOB)).rejects.toThrow();
});
it('stale cached OPK cannot be reselected by sender or consumed by a second remote sender',async()=>{
 const {a,b,sender,receiver}=await peers();const first=await sender.encrypt('first',a,b.bundle);await receiver.decrypt(first,b,a.bundle.ik,BOB);
 await expect(sender.clearSession()).rejects.toMatchObject({state:'RESET_PENDING'});
 const reply=await receiver.encrypt('confirm',b,a.bundle);await sender.decrypt(reply,a,b.bundle.ik,ALICE);
 const epoch=await StorageService.getMetadata(`dm-session-epoch-v1:${ALICE}:${BOB}`);
 await expect(sender.resetSession('stale',a,b.bundle,epoch.current,'stale-reset')).rejects.toMatchObject({state:'STALE_PREKEY'});
 const m=await getOrCreateIdentityBundle(MALLORY);const stale=await new SignalSession(MALLORY,BOB).encrypt('stale',m,b.bundle);
 await expect(new SignalSession(BOB,MALLORY).decrypt(stale,b,m.bundle.ik,BOB)).rejects.toThrow();
});
it('explicit no-OPK transcript works and OPK/header stripping or substitution fails without state drift',async()=>{
 const {a,b,sender,receiver}=await peers();
 const none={...b.bundle,opks:[],selectedOPK:null,opk:undefined,opkId:undefined};
 const env=await sender.encrypt('no opk',a,none);expect(env.opkId).toBeUndefined();expect(env.v).toBe(5);
 const before=await snapshot();
 await expect(receiver.decrypt({...env,opkId:crypto.randomUUID()},b,a.bundle.ik,BOB)).rejects.toThrow();expect(await snapshot()).toBe(before);
 expect(await receiver.decrypt(env,b,a.bundle.ik,BOB)).toBe('no opk');
});
it('local publication rejects wrong account private key and does not invent account authority',async()=>{
 const {b}=await peers();const before=await snapshot();
 await expect(authorizeLocalBundle(BOB,b.bundle,b.ikSign.priv,[],'01'.padStart(64,'0'))).rejects.toThrow();
 expect(await snapshot()).toBe(before);expect(KeyService.getPublicKey('01'.padStart(64,'0'))).toBe(ALICE);
});

it('stripping selected OPK or mutating authenticated header rejects without durable changes',async()=>{
 const {a,b,sender,receiver}=await peers();const env=await sender.encrypt('protected',a,b.bundle),before=await snapshot();
 for(const change of [{opkId:undefined},{pn:env.pn+1},{auth:undefined}]) {
   await expect(receiver.decrypt({...env,...change},b,a.bundle.ik,BOB)).rejects.toThrow();expect(await snapshot()).toBe(before);
 }
 expect(await receiver.decrypt(env,b,a.bundle.ik,BOB)).toBe('protected');
});
it('legacy session is preserved and never marked authenticated during local migration',async()=>{
 const {a,b,sender}=await peers();const key=`signal-session:${ALICE}:${BOB}`;
 const legacy={legacy:true};await StorageService.setMetadata(key,legacy);const before=await snapshot();
 await expect(sender.encrypt('upgrade',a,b.bundle)).rejects.toMatchObject({state:'LEGACY_UNAUTHENTICATED'});
 expect(await snapshot()).toBe(before);
 expect(await StorageService.getMetadata(`dm-trust-v1:${ALICE}:${BOB}`)).toBeUndefined();
});
it('concurrent local initialization keeps one authorized device and IK across reopen',async()=>{
 const identities=await Promise.all(Array.from({length:8},()=>getOrCreateIdentityBundle(ALICE)));
 expect(new Set(identities.map(i=>i.bundle.binding.deviceId)).size).toBe(1);
 expect(new Set(identities.map(i=>i.bundle.ik)).size).toBe(1);
 (await StorageService.getDB()).close();(StorageService as any).dbPromise=undefined;
 expect((await getOrCreateIdentityBundle(ALICE)).bundle.binding).toEqual(identities[0].bundle.binding);
});

it('authenticated mode retains 64-way atomic sending and exactly-once receive after account binding',async()=>{
 const {a,b,sender,receiver}=await peers();
 await receiver.decrypt(await sender.encrypt('init',a,b.bundle),b,a.bundle.ik,BOB);
 await sender.decrypt(await receiver.encrypt('reply',b,a.bundle),a,b.bundle.ik,ALICE);
 const texts=Array.from({length:64},(_,i)=>`authenticated-${i}`);
 const envelopes=await Promise.all(texts.map(text=>new SignalSession(ALICE,BOB).encrypt(text,a,b.bundle)));
 expect(new Set(envelopes.map(e=>`${e.dh}:${e.n}`)).size).toBe(64);
 const decoded=[];
 for(const env of envelopes.sort((x,y)=>x.n-y.n)) {
   decoded.push(await receiver.decrypt(env,b,a.bundle.ik,BOB));
   await expect(receiver.decrypt(env,b,a.bundle.ik,BOB)).rejects.toThrow();
 }
 expect(decoded.sort()).toEqual(texts.sort());
});
