import 'fake-indexeddb/auto';
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('../src/services/gunService', () => ({ GunService: { getGun: vi.fn() }, GUN_NAMESPACE: 'test' }));
import ChatService from '../src/services/chatService';
import { fetchAndDecrypt } from '../src/services/chatMediaService';
import { resolveObjectURL } from 'node:buffer';
vi.mock('../src/utils/gunAsync', () => ({gunPut:vi.fn(async()=>({ok:false})),gunOnce:vi.fn(),gunReadChildren:vi.fn(),toGunRecord:(x:any)=>x}));
import { GunService } from '../src/services/gunService';
import { StorageService } from '../src/services/storageService';
import { SignalSession, getOrCreateIdentityBundle } from '../src/services/signalProtocol';
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it.each([17, 400*1024-1, 400*1024+1, 3*1024*1024])('encrypts active upload of %i bytes with authenticated metadata', async size => {
  const bytes = new Uint8Array(size).fill(42);
  let uploaded: Blob | undefined, payload:any, uploadFields: string[] = [], uploadMime: unknown;
  let corrupt = false;
  vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
    if(options?.method === 'POST') {
      const form = options.body as FormData;
      uploadFields = [...form.keys()];
      uploaded = form.get('file') as Blob;
      uploadMime = form.get('mimeType');
      return new Response(JSON.stringify({mediaId:'opaque-id'}));
    }
    const data = new Uint8Array(await uploaded!.arrayBuffer());
    if(corrupt) data[0] ^= 1;
    return new Response(data);
  }));
  const chat = new ChatService('wss://example.invalid','alice');
  vi.spyOn(chat,'sendMessage').mockImplementation(async (_, text) => { payload=JSON.parse(text);return {} as any; });
  await chat.sendFile('bob',new File([bytes],'private.txt',{type:'text/plain'}));
  expect(uploaded).toBeDefined();
  expect(Buffer.from(await uploaded!.arrayBuffer()).includes(Buffer.from(bytes))).toBe(false);
  expect(uploadFields).toEqual(['file', 'mimeType']);
  expect(uploaded!.type).toBe('application/octet-stream');
  expect(uploadMime).toBe('application/octet-stream');
  expect(payload._encryptedMedia).toBe(1);
  const url = await fetchAndDecrypt(payload.media, 'bob');
  expect(new Uint8Array(await resolveObjectURL(url)!.arrayBuffer())).toEqual(bytes);
  URL.revokeObjectURL(url);
  await expect(fetchAndDecrypt({...payload.media,mediaKey:btoa('x'.repeat(32))},'bob')).rejects.toThrow();
  await expect(fetchAndDecrypt({...payload.media,mediaName:'other.txt'},'bob')).rejects.toThrow();
  await expect(fetchAndDecrypt({...payload.media,mediaSize:size+1},'bob')).rejects.toThrow();
  corrupt=true;
  await expect(fetchAndDecrypt(payload.media,'bob')).rejects.toThrow();
});

it('active sendFile sends keys only through encrypted DM and history decrypts media after restart', async()=>{
  const db=await StorageService.getDB();await db.clear('metadata');await db.clear('chat-messages');
  const a=await getOrCreateIdentityBundle('media-alice'), b=await getOrCreateIdentityBundle('media-bob');
  const node:any={get:vi.fn(),put:vi.fn()};node.get.mockReturnValue(node);vi.mocked(GunService.getGun).mockReturnValue(node);
  vi.stubGlobal('WebSocket',{OPEN:1});
  const uploads:Blob[]=[];
  vi.stubGlobal('fetch',vi.fn(async(url,options)=>{
    if(options?.method==='POST') {
      const form=options.body as FormData;expect([...form.keys()]).toEqual(['file','mimeType']);
      uploads.push(form.get('file') as Blob);return new Response(JSON.stringify({mediaId:String(uploads.length-1)}));
    }
    return new Response(await uploads[Number(String(url).split('/').pop())].arrayBuffer());
  }));
  const chat=new ChatService('wss://example.invalid','media-alice') as any;
  chat.myBundle=a;chat.theirBundles.set('media-bob',b.bundle);chat.ensureOPKPool=vi.fn();
  const file=new File(['private media'],'private.txt',{type:'text/plain'});
  const first=await chat.sendFile('media-bob',file),second=await chat.sendFile('media-bob',file);
  await vi.waitFor(async()=>expect((await StorageService.getChatMessage(second.id))?.syncAttempts).toBe(1));
  const rows=await Promise.all([first.id,second.id].map(id=>StorageService.getChatMessage(id)));
  const descriptors=rows.map(row=>JSON.parse(row!.text).media);
  expect(descriptors[0].mediaKey).not.toBe(descriptors[1].mediaKey);
  expect(descriptors[0].mediaIV).not.toBe(descriptors[1].mediaIV);
  const receiver=new SignalSession('media-bob','media-alice');
  for(const row of rows) {
    expect(row!.encryptedEnvelope).not.toContain(JSON.parse(row!.text).media.mediaKey);
    expect(await receiver.decrypt(JSON.parse(row!.encryptedEnvelope!),b,a.bundle.ik,'media-bob')).toBe(row!.text);
  }
  db.close();(StorageService as any).dbPromise=undefined;
  const history=await chat.getLocalHistory('media-bob');
  for(const entry of history) {
    expect(await resolveObjectURL(entry.mediaUrl)!.text()).toBe('private media');URL.revokeObjectURL(entry.mediaUrl);
  }
  URL.revokeObjectURL(first.mediaUrl);URL.revokeObjectURL(second.mediaUrl);
});
