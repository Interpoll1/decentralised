import 'fake-indexeddb/auto';
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('../src/services/gunService', () => ({ GunService: { getGun: vi.fn() }, GUN_NAMESPACE: 'test' }));
import ChatService from '../src/services/chatService';
import { fetchAndDecrypt } from '../src/services/chatMediaService';
import { resolveObjectURL } from 'node:buffer';
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it.each([17, 400*1024-1, 400*1024+1, 3*1024*1024])('encrypts active upload of %i bytes with authenticated metadata', async size => {
  const bytes = new Uint8Array(size).fill(42);
  let uploaded: Blob | undefined, payload:any;
  let corrupt = false;
  vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
    if(options?.method === 'POST') {
      const form = options.body as FormData;
      expect([...form.keys()]).toEqual(['file', 'mimeType']);
      uploaded = form.get('file') as Blob;
      expect(uploaded.type).toBe('application/octet-stream');
      expect(form.get('mimeType')).toBe('application/octet-stream');
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
