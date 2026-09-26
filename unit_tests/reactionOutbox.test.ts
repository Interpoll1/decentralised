import 'fake-indexeddb/auto';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { schnorr } from '@noble/curves/secp256k1.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { signAction, ACTION_MAX_AGE_MS } from '../shared-validation/engagement.js';
import { GUN_NAMESPACE } from '../src/utils/namespace';

const m = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), once: vi.fn(), fetch: vi.fn() }));
vi.mock('../src/services/gunService', () => ({ GunService: { getGun: () => ({ get: m.get }) } }));
vi.mock('../src/utils/gunAsync', () => ({ gunPut: m.put, gunOnce: m.once, gunReadChildren: vi.fn() }));
vi.mock('../src/config', () => ({ default: { relay: { api: 'https://offline.invalid' } } }));
import { StorageService } from '../src/services/storageService';
import { ReactionOutbox, reactionOutbox } from '../src/services/reactionOutboxService';
import { ReactionPublishError, publishReaction } from '../src/services/publicEngagementService';
import { PostVoteService } from '../src/services/postVoteService';
const privateKey = '01'.padStart(64, '0'); // Synthetic fixture only.
const actor = bytesToHex(schnorr.getPublicKey(hexToBytes(privateKey)));
let nonce = 0;
function action(extra = {}) { return signAction({ namespace: GUN_NAMESPACE, kind: 'reaction', actor, targetType: 'post',
  targetId: 'post-queue', value: 'up', createdAt: Date.now(), nonce: (++nonce).toString(16).padStart(32, '0'), ...extra }, privateKey); }
beforeEach(async () => {
  const db = await StorageService.getDB(); await db.clear('metadata');
  await StorageService.setMetadata('nostr-keypair', { privateKey, publicKey: actor });
  vi.clearAllMocks(); vi.stubGlobal('fetch', m.fetch);
  m.get.mockImplementation(() => ({ get: m.get })); m.put.mockResolvedValue({ ok: true }); m.once.mockResolvedValue(null);
});
afterEach(() => { reactionOutbox.stop(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('enqueue commits locally without waiting for slow HTTP; acceptance needs exact receipt', async () => {
  let complete!: () => void;
  const send = vi.fn(() => new Promise<void>(r => { complete = r; }));
  const q = new ReactionOutbox(send, false), a = action();
  expect(await q.enqueue(a)).toEqual({ id: a.id, status: 'pending' });
  const flushing = q.flush(); await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
  expect((await q.entries(actor))[0].status).toBe('pending'); complete(); await flushing;
  expect((await q.entries(actor))[0].status).toBe('accepted');
});
it('failed HTTP stays pending and restart retries byte-identical payload', async () => {
  const a = action(); const q = new ReactionOutbox(publishReaction, false);
  m.fetch.mockRejectedValue(new Error('offline')); await q.enqueue(a); await q.flush();
  expect((await q.entries(actor))[0].status).toBe('pending');
  const db = await StorageService.getDB(); db.close(); (StorageService as any).dbPromise = undefined;
  const reopened = new ReactionOutbox(publishReaction, false);
  m.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: a.id, status: 'duplicate' }) });
  await reopened.flush();
  expect(new Set(m.fetch.mock.calls.map(c => c[1].body)).size).toBe(1);
  expect((await reopened.entries(actor))[0].status).toBe('accepted');
});
it('two instances enqueue concurrently without lost actions; duplicate enqueue coalesces', async () => {
  const one = new ReactionOutbox(vi.fn(), false), two = new ReactionOutbox(vi.fn(), false);
  const actions = Array.from({ length: 16 }, () => action());
  await Promise.all(actions.map((a, i) => (i % 2 ? one : two).enqueue(a)));
  await Promise.all([one.enqueue(actions[0]), two.enqueue(actions[0])]);
  expect((await one.entries(actor)).length).toBe(16);
});
it('failed local commit never publishes and can be retried with original action', async () => {
  const send = vi.fn(), q = new ReactionOutbox(send, false), a = action();
  const stub = vi.spyOn(StorageService, 'compareAndSwapMetadata').mockRejectedValueOnce(new Error('disk failure'));
  await expect(q.enqueue(a)).rejects.toThrow('disk failure'); expect(send).not.toHaveBeenCalled();
  expect(await q.entries(actor)).toEqual([]); stub.mockRestore(); await q.enqueue(a);
  expect((await q.entries(actor))[0].action.id).toBe(a.id);
});
it('terminal rejection never becomes accepted or retries; local Gun ACK is insufficient', async () => {
  m.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) });
  const q = new ReactionOutbox(publishReaction, false), a = action(); await q.enqueue(a); await q.flush(); await q.flush();
  expect((await q.entries(actor))[0].status).toBe('rejected'); expect(m.fetch).toHaveBeenCalledOnce();
});
it('429 is retryable; expired envelope never re-signs or publishes', async () => {
  m.fetch.mockResolvedValue({ ok: false, status: 429, json: async () => ({ error: 'busy' }) });
  const q = new ReactionOutbox(publishReaction, false), a = action(); await q.enqueue(a); await q.flush();
  expect((await q.entries(actor))[0].status).toBe('pending');
  vi.spyOn(Date, 'now').mockReturnValue(a.createdAt + ACTION_MAX_AGE_MS + 1); await q.flush();
  expect((await q.entries(actor))[0].status).toBe('expired'); expect(m.fetch).toHaveBeenCalledTimes(2);
});
it('old account queue does not transmit after identity changes', async () => {
  const send = vi.fn(), q = new ReactionOutbox(send, false); await q.enqueue(action());
  await StorageService.setMetadata('nostr-keypair', { publicKey: '02'.repeat(32) }); await q.flush();
  expect(send).not.toHaveBeenCalled(); expect((await q.entries(actor))[0].status).toBe('pending');
});
it('failed concurrent retry cannot erase exact acceptance from another instance', async () => {
  let fail!: (e: Error) => void;
  const sending = vi.fn(() => new Promise<void>((_, reject) => { fail = reject; }));
  const one = new ReactionOutbox(sending, false), two = new ReactionOutbox(async () => {}, false);
  await one.enqueue(action()); const slow = one.flush(); await vi.waitFor(() => expect(sending).toHaveBeenCalled());
  await two.flush(); fail(new ReactionPublishError(true)); await slow;
  expect((await one.entries(actor))[0].status).toBe('accepted');
});
it('128 pending limit rejects overflow without eviction; terminal slots can be reused', async () => {
  const q = new ReactionOutbox(async () => {}, false);
  for (let i = 0; i < 128; i++) await q.enqueue(action());
  await expect(q.enqueue(action())).rejects.toThrow('REACTION_QUEUE_FULL');
  await q.flush(); await q.enqueue(action()); expect((await q.entries(actor)).length).toBe(128);
});
it('post reaction returns local pending result even when all HTTP remains unresolved', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }); m.fetch.mockImplementation(() => new Promise(() => {}));
  // No timer advancement: a remote response cannot be required to return.
  const result = await PostVoteService.castVote('post-queue', actor, 'up');
  expect(result.delivery).toBe('pending'); expect(result.myVote).toBe('up');
  expect(m.fetch).not.toHaveBeenCalled(); expect((await reactionOutbox.entries(actor)).length).toBe(1);
});

it('HTML 404 is a terminal incompatible endpoint, not an endless transient retry', async () => {
  m.fetch.mockResolvedValue({ ok: false, status: 404, json: async () => { throw new Error('HTML'); } });
  const q = new ReactionOutbox(publishReaction, false); await q.enqueue(action()); await q.flush(); await q.flush();
  expect((await q.entries(actor))[0].status).toBe('rejected'); expect(m.fetch).toHaveBeenCalledOnce();
});
it('memory-only fallback cannot publish a supposedly durable reaction', async () => {
  const q = new ReactionOutbox(vi.fn(), false);
  StorageService.usingMemoryFallback = true;
  try { await expect(q.enqueue(action())).rejects.toThrow('Durable storage required'); }
  finally { StorageService.usingMemoryFallback = false; }
  expect(await q.entries(actor)).toEqual([]); expect(m.fetch).not.toHaveBeenCalled();
});
