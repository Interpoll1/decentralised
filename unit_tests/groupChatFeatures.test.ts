import 'fake-indexeddb/auto';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
vi.mock('../src/services/gunService',()=>({GunService:{getGun:vi.fn(),onReconnect:()=>()=>{}},GUN_NAMESPACE:'test'}));
vi.mock('../src/utils/gunAsync',()=>({gunPut:vi.fn(async()=>({ok:true})),gunOnce:vi.fn(),gunReadChildren:vi.fn(async()=>[]),verifySoulOnRelay:vi.fn(async()=>false)}));
import {StorageService} from '../src/services/storageService';
import {KeyService} from '../src/services/keyService';
import {getOrCreateAuthenticatedIdentityBundle} from '../src/services/signalProtocol';
import {GroupSecurity,authorshipBytes,checkExt,joinContext,memberId,openSeal,validRelay} from '../src/services/groupSecurity';
import {GroupRoomTransport} from '../src/services/groupRoomTransport';
import {GunService} from '../src/services/gunService';
import {gunPut,gunOnce} from '../src/utils/gunAsync';
import {CryptoService} from '../src/services/cryptoService';
import {foldTimeline} from '../src/utils/groupTimeline';
import {formatChatText} from '../src/utils/chatFormat';
import type {DisplayMessage} from '../src/services/chatRoomService';
import type {GroupExt} from '../src/types/social';

async function identity(n:number){const secret=n.toString(16).padStart(64,'0');return new GroupSecurity(await getOrCreateAuthenticatedIdentityBundle(KeyService.getPublicKey(secret),secret));}
async function setup(){
 const [a,b,c]=await Promise.all([identity(1),identity(2),identity(3)]);
 const room=(await a.create('Room','')).roomId;
 await a.change(room,{add:b.binding});const epoch=await a.change(room,{add:c.binding});
 await b.adopt(epoch);await c.adopt(epoch);return {a,b,c,room};
}
beforeEach(async()=>{vi.restoreAllMocks();const db=await StorageService.getDB();for(const store of ['metadata','chat-messages','encryption-keys'])await db.clear(store);KeyService.clearCache();});
afterEach(()=>GroupRoomTransport.stopAll());

const T='11111111-1111-4111-8111-111111111111';
describe('group extension protocol',()=>{
 it('extension survives sign → authorize → receive and is stored on the row',async()=>{
  const {a,b,c,room}=await setup();
  const ext:GroupExt={k:'msg',replyTo:T,mentions:[c.binding.accountId]};
  const e=await a.authorize(room,await b.candidate(room,'hi @Carol','Bob',ext));
  const {row}=await c.receive(room,e);
  expect(row.ext).toEqual(ext);expect(row.text).toBe('hi @Carol');
 });
 it('actions may carry empty text; plain messages may not',async()=>{
  const {a,b,room}=await setup();
  await expect(b.candidate(room,'','Bob',{k:'react',target:T,emoji:'👍'})).resolves.toBeTruthy();
  await expect(b.candidate(room,'','Bob',{k:'msg'})).rejects.toThrow();
  await expect(b.candidate(room,'','Bob',{k:'edit',target:T})).rejects.toThrow();
  await expect(a.candidate(room,'  ','Alice')).rejects.toThrow();
 });
 it.each([
  [{k:'nope'}],[{k:'react',target:'not-a-uuid',emoji:'x'}],[{k:'react',target:T,emoji:'x',extra:1}],
  [{k:'poll',question:'q',options:['one'],multi:false}],[{k:'vote',target:T,choices:[1,1]}],[{k:'vote',target:T,choices:[12]}],
  [{k:'msg',forwarded:false}],[{k:'msg',media:{version:1}}],[{k:'msg',mentions:['<script>']}],
 ])('rejects malformed extension %j',x=>{expect(()=>checkExt(x)).toThrow();});
 it('a tampered extension fails authentication at the receiver',async()=>{
  const {a,b,c,room}=await setup();
  const e=await a.authorize(room,await b.candidate(room,'x','Bob',{k:'msg'}));
  const forged={...e,ciphertext:e.ciphertext.slice(0,-4)+'AAA='};
  await expect(c.receive(room,forged)).rejects.toThrow();
 });
});

describe('owner-less direct sending',()=>{
 it('a member publishes without the owner and other members accept it',async()=>{
  const {b,c,room}=await setup();
  const row=await b.publishOwn(room,await b.candidate(room,'owner offline','Bob'));
  expect(row.syncStatus).toBe('pending');
  const e=(await b.state(room))!.outbox[0];expect(e).toMatchObject({publication:0,receipt:''});
  expect((await c.receive(room,e)).row).toMatchObject({text:'owner offline',senderId:b.binding.accountId});
  expect((await c.receive(room,e)).status).toBe('duplicate');
 });
 it('rejects impersonation, non-members, replays and removed members',async()=>{
  const {a,b,c,room}=await setup();
  // Bob signs a message claiming to be Carol.
  const forged=await b.candidate(room,'I am Carol','Carol');forged.header.senderAccount=c.binding.accountId;forged.header.senderDevice=c.binding.deviceId;
  forged.signature=await b.signControl(authorshipBytes(forged));
  await expect(a.receive(room,forged)).rejects.toThrow();
  await expect(b.publishOwn(room,forged)).rejects.toThrow();
  // A replayed sequence number with a new message id is refused.
  const first=await b.candidate(room,'one','Bob');await b.publishOwn(room,first);await c.receive(room,first);
  const replay=structuredClone(first);replay.header.messageId='22222222-2222-4222-8222-222222222222';replay.signature=await b.signControl(authorshipBytes(replay));
  await expect(c.receive(room,replay)).rejects.toThrow();
  // After removal, Carol's direct messages are rejected by members on the new epoch.
  const late=await c.candidate(room,'still here','Carol');
  const next=await a.change(room,{remove:memberId(c.binding)});await b.adopt(next);
  await expect(b.receive(room,late)).rejects.toThrow();
  // An outsider never holds a key to produce a candidate at all.
  const d=await identity(9);await expect(d.candidate(room,'hi','Dana')).rejects.toThrow();
 });
});

describe('signals',()=>{
 it('member signal round-trips and is attributed to the signer',async()=>{
  const {b,c,room}=await setup();
  const raw=await b.sealSignal(room,{name:'Bob',typing:5,read:7});
  expect(await c.openSignal(room,raw)).toMatchObject({account:b.binding.accountId,device:b.binding.deviceId,name:'Bob',typing:5,read:7});
 });
 it('removed member signals and garbage are ignored',async()=>{
  const {a,b,c,room}=await setup();
  const stale=await c.sealSignal(room,{name:'Carol',typing:1,read:1});
  const next=await a.change(room,{remove:memberId(c.binding)});await b.adopt(next);
  expect(await b.openSignal(room,stale)).toBeNull();
  expect(await b.openSignal(room,'{"e":"x"}')).toBeNull();
  expect(await b.openSignal(room,'not json')).toBeNull();
 });
});

describe('relay sharing',()=>{
 it('signals carry only https Gun relays',async()=>{
  const {b,c,room}=await setup();
  const raw=await b.sealSignal(room,{name:'Bob',typing:0,read:0,relays:['https://relay.example/gun','http://plain.example/gun','https://u:p@x.example/gun','javascript:alert(1)','https://x.example/notgun']});
  expect((await c.openSignal(room,raw))!.relays).toEqual(['https://relay.example/gun']);
  expect(validRelay('https://a.b/gun/')).toBe(true);
 });
});

describe('join requests',()=>{
 it('joiner seals a request only the owner can open, bound to the joiner identity',async()=>{
  const [a,d]=await Promise.all([identity(1),identity(4)]);
  const epoch=await a.create('Room','');const room=epoch.roomId;
  const node:any={get:()=>node};vi.mocked(GunService.getGun).mockReturnValue({get:()=>node} as any);
  vi.mocked(gunOnce).mockResolvedValue({epoch:JSON.stringify((await a.state(room))!.epoch)});
  expect(await GroupRoomTransport.requestJoin(d,room,'Dana')).toBe('requested');
  const put=vi.mocked(gunPut).mock.calls.at(-1)![1] as {sealed:string};
  const id=CryptoService.hash(memberId(d.binding));
  const req=JSON.parse(await openSeal(a.identity,JSON.parse(put.sealed),joinContext(room,id)));
  expect(req).toMatchObject({room,id,name:'Dana'});expect(req.binding).toEqual(d.binding);
  await expect(openSeal(d.identity,JSON.parse(put.sealed),joinContext(room,id))).rejects.toThrow();
 });
});

describe('password rooms',()=>{
 async function room(){
  const [a,d,e]=await Promise.all([identity(1),identity(4),identity(5)]);
  const epoch=await a.create('Room','');const roomId=epoch.roomId;
  const node:any={get:()=>node};vi.mocked(GunService.getGun).mockReturnValue({get:()=>node} as any);
  vi.mocked(gunOnce).mockResolvedValue({epoch:JSON.stringify((await a.state(roomId))!.epoch)});
  await GroupRoomTransport.setPassword(a,roomId,'hunter2');
  return {a,d,e,roomId};
 }
 const lastSealed=()=>vi.mocked(gunPut).mock.calls.at(-1)![1];
 it('owner auto-admits a joiner with the right password and ignores a wrong one',async()=>{
  const {a,d,e,roomId}=await room();
  await GroupRoomTransport.requestJoin(d,roomId,'Dana','hunter2');
  await (GroupRoomTransport as any).autoAdmit(a,roomId,CryptoService.hash(memberId(d.binding)),lastSealed());
  await GroupRoomTransport.requestJoin(e,roomId,'Eve','wrong');
  await (GroupRoomTransport as any).autoAdmit(a,roomId,CryptoService.hash(memberId(e.binding)),lastSealed());
  const members=(await a.state(roomId))!.epoch.members.map(memberId);
  expect(members).toContain(memberId(d.binding));expect(members).not.toContain(memberId(e.binding));
 });
 it('stops checking after repeated wrong guesses from one device',async()=>{
  const {a,e,roomId}=await room();const id=CryptoService.hash(memberId(e.binding));
  const spy=vi.spyOn(GroupRoomTransport,'checkPassword');
  for(let i=0;i<8;i++){await GroupRoomTransport.requestJoin(e,roomId,'Eve',`guess${i}`);await (GroupRoomTransport as any).autoAdmit(a,roomId,id,lastSealed());}
  expect(spy).toHaveBeenCalledTimes(5);
 });
 it('the public node only advertises the mode, never the password',async()=>{
  await room();
  const puts=vi.mocked(gunPut).mock.calls.map(c=>JSON.stringify(c[1]));
  expect(puts.some(p=>p.includes('"access":"password"'))).toBe(true);
  expect(puts.some(p=>p.includes('hunter2'))).toBe(false);
 });
});

describe('timeline fold',()=>{
 let n=0;
 const msg=(sender:string,text:string,ext?:GroupExt,id=`00000000-0000-4000-8000-${String(++n).padStart(12,'0')}`):DisplayMessage=>
  ({id:`group:h:${id}`,messageId:id,roomId:'r',text,senderId:sender,senderName:sender.toUpperCase(),timestamp:n*1000,seq:n,...(ext?{ext}:{})});
 it('applies reactions, author-only edits/deletes, pins, replies and votes',()=>{
  const m1=msg('alice','hello'),m2=msg('bob','yo',{k:'msg',replyTo:m1.messageId});
  const poll=msg('alice','',{k:'poll',question:'Lunch?',options:['pizza','sushi'],multi:false});
  const log=[m1,m2,poll,
   msg('bob','',{k:'react',target:m1.messageId,emoji:'👍'}),msg('carol','',{k:'react',target:m1.messageId,emoji:'👍'}),
   msg('carol','',{k:'react',target:m1.messageId,emoji:'❤️'}), // replaces carol's 👍
   msg('bob','hacked',{k:'edit',target:m1.messageId}),           // not the author: ignored
   msg('alice','hello all',{k:'edit',target:m1.messageId}),
   msg('bob','',{k:'delete',target:m1.messageId}),                // not the author: ignored
   msg('bob','',{k:'delete',target:m2.messageId}),
   msg('carol','',{k:'pin',target:m1.messageId}),
   msg('bob','',{k:'vote',target:poll.messageId,choices:[0,1]}),  // single-choice: first only
   msg('alice','',{k:'vote',target:poll.messageId,choices:[1]}),
   msg('alice','',{k:'vote',target:poll.messageId,choices:[0]}),  // changed vote
  ];
  const {items,pinned}=foldTimeline(log.reverse(),'alice');
  expect(items.map(i=>i.messageId)).toEqual([m1.messageId,m2.messageId,poll.messageId]);
  const [a,b,p]=items;
  expect(a.text).toBe('hello all');expect(a.edited).toBe(true);expect(a.deleted).toBe(false);expect(a.pinned).toBe(true);
  expect(a.reactions.map(r=>[r.emoji,r.users.length])).toEqual([['👍',1],['❤️',1]]);
  expect(b.deleted).toBe(true);expect(b.text).toBe('');
  expect(p.poll!.votes.map(v=>v.length)).toEqual([2,0]);expect(p.poll!.myChoices).toEqual([0]);expect(p.poll!.voters).toBe(2);
  expect(pinned.map(i=>i.messageId)).toEqual([m1.messageId]);
 });
 it('reply previews reflect edits and missing targets',()=>{
  const m1=msg('alice','orig'),r=msg('bob','re',{k:'msg',replyTo:m1.messageId}),lost=msg('bob','re2',{k:'msg',replyTo:T});
  const {items}=foldTimeline([m1,r,lost,msg('alice','new',{k:'edit',target:m1.messageId})],'bob');
  expect(items[1].reply).toMatchObject({text:'new',senderName:'ALICE',missing:false});
  expect(items[2].reply!.missing).toBe(true);
 });
});

describe('chat formatting',()=>{
 it('escapes markup before formatting',()=>{
  const out=formatChatText('<img src=x onerror=alert(1)> *bold* `<b>`');
  expect(out).not.toContain('<img');expect(out).toContain('&lt;img');
  expect(out).toContain('<strong>bold</strong>');expect(out).toContain('<code class="fmt-code">&lt;b&gt;</code>');
 });
 it('links only http(s) and cannot break out of the attribute',()=>{
  const out=formatChatText('see https://a.b/x?q="><script> and javascript:alert(1)');
  expect(out).not.toContain('<script');expect(out).not.toContain('href="javascript');
  expect(out).toMatch(/<a href="https:\/\/a\.b\/x\?q=&quot;&gt;/);
 });
 it('highlights only signed mentions at word start',()=>{
  const out=formatChatText('hey @Bob and mail@Bob, https://x.y/@Bob',['Bob']);
  expect(out.match(/fmt-mention/g)).toHaveLength(1);
 });
});
