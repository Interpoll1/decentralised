import { afterEach, expect, it, vi } from 'vitest';
import { resolveObjectURL } from 'node:buffer';
import { encryptAndUpload, fetchAndDecrypt } from '../src/services/chatMediaService';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function fixture() {
  let ciphertext: Blob;
  const entries = new Map<string, Response>();
  const cache = {
    match: vi.fn(async (key: string) => entries.get(key)?.clone()),
    put: vi.fn(async (key: string, value: Response) => { entries.set(key, value); }),
  };
  vi.stubGlobal('caches', { open: vi.fn(async () => cache) });
  const fetchMock = vi.fn(async (_url, options) => {
    if (options?.method === 'POST') {
      ciphertext = options.body.get('file');
      return new Response(JSON.stringify({ mediaId: 'same-id' }));
    }
    if (options.headers.Authorization !== 'Bearer alice') return new Response(null, { status: 403 });
    return new Response(ciphertext);
  });
  vi.stubGlobal('fetch', fetchMock);
  const meta = await encryptAndUpload(new File(['private bytes'], 'photo.png', { type: 'image/png' }), 'alice');
  return { meta, cache, fetchMock };
}

it('authenticates changed keys, IV and protected metadata even with warm ciphertext', async () => {
  const { meta, cache } = await fixture();
  const original = await fetchAndDecrypt(meta, 'alice');
  await vi.waitFor(() => expect(cache.put).toHaveBeenCalledOnce());
  const changes = [
    { mediaKey: btoa('x'.repeat(32)) }, { mediaIV: btoa('y'.repeat(12)) },
    { mediaName: 'evil.html' }, { mediaType: 'text/html' }, { mediaSize: meta.mediaSize + 1 },
    { context: 'different-message' }, { version: 2 },
  ];
  for (const change of changes) await expect(fetchAndDecrypt({ ...meta, ...change } as any, 'alice')).rejects.toThrow();
  expect(await resolveObjectURL(original)!.text()).toBe('private bytes');
  URL.revokeObjectURL(original);
});

it('partitions ciphertext by authorization context and never persists the token', async () => {
  const { meta, cache, fetchMock } = await fixture();
  const url = await fetchAndDecrypt(meta, 'alice');
  await vi.waitFor(() => expect(cache.put).toHaveBeenCalledOnce());
  await expect(fetchAndDecrypt(meta, 'bob')).rejects.toThrow('403');
  expect(fetchMock).toHaveBeenLastCalledWith(expect.any(String), { headers: { Authorization: 'Bearer bob' } });
  expect(cache.put.mock.calls[0][0]).not.toContain('alice');
  URL.revokeObjectURL(url);
});

it('each consumer owns its URL; revoking one does not break another or a later open', async () => {
  const { meta } = await fixture();
  const [first, second] = await Promise.all([fetchAndDecrypt(meta, 'alice'), fetchAndDecrypt(meta, 'alice')]);
  expect(first).not.toBe(second);
  URL.revokeObjectURL(first);
  expect(await resolveObjectURL(second)!.text()).toBe('private bytes');
  const third = await fetchAndDecrypt(meta, 'alice');
  expect(await resolveObjectURL(third)!.text()).toBe('private bytes');
  URL.revokeObjectURL(second); URL.revokeObjectURL(third);
});
