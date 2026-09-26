import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { schnorr } from '@noble/curves/secp256k1.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { verifyAction } from '../shared-validation/engagement.js';

const mocks = vi.hoisted(() => ({ metadata: vi.fn(), gunPut: vi.fn(), fetch: vi.fn(), chain: { get: vi.fn() } }));
vi.mock('../src/services/storageService', () => ({ StorageService: { getMetadata: mocks.metadata } }));
vi.mock('../src/services/gunService', () => ({ GunService: { getGun: () => mocks.chain } }));
vi.mock('../src/utils/gunAsync', () => ({ gunPut: mocks.gunPut }));
vi.mock('../src/config', () => ({ default: { relay: { api: 'https://offline.invalid', websocket: 'wss://offline.invalid' } } }));
vi.mock('../src/services/relayFeedService', () => ({ fetchViewCounts: async () => ({}) }));

const privateKey = '01'.padStart(64, '0'); // Synthetic fixture.
const actor = bytesToHex(schnorr.getPublicKey(hexToBytes(privateKey)));
const fixture = { privateKey, publicKey: actor };
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks();
  mocks.metadata.mockResolvedValue(fixture);
  mocks.chain.get.mockReturnValue(mocks.chain); mocks.gunPut.mockResolvedValue({ ok: true });
  vi.stubGlobal('fetch', mocks.fetch);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
const service = () => import('../src/services/publicEngagementService');

describe('public engagement client contract', () => {
  it('uses existing account and unique signed nonces', async () => {
    const { createPublicAction } = await service();
    const [a, b] = await Promise.all([createPublicAction(actor, 'reaction', 'post', 'post-1', 'up'), createPublicAction(actor, 'reaction', 'post', 'post-1', 'up')]);
    expect(verifyAction(a)).toBe(true); expect(a.id).not.toBe(b.id); expect(Object.isFrozen(a)).toBe(true);
  });
  it.each([null, { privateKey, publicKey: 'wrong' }])('missing/mismatched account fails without generating identity: %j', async stored => {
    mocks.metadata.mockResolvedValue(stored);
    await expect((await service()).createPublicAction(actor, 'reaction', 'post', 'post-1', 'up')).rejects.toThrow('ACTION_IDENTITY_UNAVAILABLE');
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it('transports and retries reuse the identical envelope; exact server result required', async () => {
    const { createPublicAction, publishReaction } = await service();
    const a = await createPublicAction(actor, 'reaction', 'post', 'post-1', 'up');
    mocks.fetch.mockRejectedValueOnce(new Error('lost response')).mockResolvedValueOnce({ ok: true, json: async () => ({ id: a.id, status: 'duplicate' }) });
    await publishReaction(a);
    expect(mocks.fetch.mock.calls[0][1].body).toBe(mocks.fetch.mock.calls[1][1].body);
    expect(mocks.gunPut.mock.calls[0][1]).toEqual({ envelope: JSON.stringify(a) });
  });
  it.each([{ status: 'accepted', id: 'different' }, { ok: true }, { status: 'pending' }])('local Gun ACK + missing server evidence fails: %j', async result => {
    const { createPublicAction, publishReaction } = await service();
    const a = await createPublicAction(actor, 'reaction', 'post', 'post-1', 'up');
    mocks.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => result });
    await expect(publishReaction(a)).rejects.toThrow('ENGAGEMENT_REJECTED');
  });
  it('signed read binds actor/target; invalid envelope never falls back to raw type', async () => {
    const { createPublicAction, readReaction } = await service();
    const a = await createPublicAction(actor, 'reaction', 'post', 'post-1', 'up');
    const raw = { envelope: JSON.stringify(a), type: 'down' };
    expect(readReaction(raw, actor, 'post', 'post-1')).toBe('up');
    expect(readReaction(raw, actor, 'post', 'post-2')).toBe(null);
    expect(readReaction(raw, 'wrong', 'post', 'post-1')).toBe(null);
    expect(readReaction({ envelope: '{}', type: 'up' }, actor, 'post', 'post-1')).toBe(null);
    expect(readReaction({ type: 'up' }, actor, 'post', 'post-1')).toBe('up'); // display-only legacy
  });
  it.each(['postVoteService.ts', 'commentService.ts', 'pollService.ts'])('active reaction writer %s uses shared signing/publishing and contains no old HTTP body', file => {
    const source = readFileSync(new URL(`../src/services/${file}`, import.meta.url), 'utf8');
    expect(source).toContain('await createPublicAction(');
    expect(source).toContain('enqueueReaction(action)');
    expect(source).not.toContain('/api/content-vote');
  });
});

async function views() {
  vi.useFakeTimers();
  vi.stubGlobal('window', {});
  const beacon = vi.fn(() => true); vi.stubGlobal('navigator', { sendBeacon: beacon });
  const api = await import('../src/services/viewTrackingService');
  api.initViewTracking(() => actor);
  const debug = (window as any).__viewTracking;
  return { api, debug, beacon };
}

describe('view retries and acceptance', () => {
  it('failed request keeps same signature, accepted exact response marks viewed', async () => {
    const { api, debug } = await views(); api.trackDetailView('post-1', 'post');
    mocks.fetch.mockRejectedValueOnce(new Error('offline'));
    await debug.forceFlush(); expect(api.getViewedIds().has('post-1')).toBe(false);
    const first = mocks.fetch.mock.calls[0][1].body;
    mocks.fetch.mockImplementationOnce(async (_url, init) => ({ ok: true, json: async () => ({ results: JSON.parse(init.body).actions.map((a: any) => ({ id: a.id, status: 'accepted' })) }) }));
    await debug.forceFlush();
    expect(mocks.fetch.mock.calls[1][1].body).toBe(first);
    expect(verifyAction(JSON.parse(first).actions[0])).toBe(true);
    expect(api.getViewedIds().has('post-1')).toBe(true);
  });
  it('beacon is signed and queueing is not acceptance', async () => {
    const { api, debug, beacon } = await views(); api.trackDetailView('post-1', 'post');
    mocks.fetch.mockRejectedValue(new Error('offline')); await debug.forceFlush();
    api.flushViewsSync(); const body = JSON.parse(await beacon.mock.calls[0][1].text());
    expect(verifyAction(body.actions[0])).toBe(true);
    expect(api.getViewedIds().size).toBe(0); expect(debug.pending()).toEqual(['post-1']);
  });
  it('HTTP 200 without exact action receipt does not mark sent', async () => {
    const { api, debug } = await views(); api.trackDetailView('post-1', 'post');
    mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    await debug.forceFlush(); expect(api.getViewedIds().size).toBe(0); expect(debug.pending()).toEqual(['post-1']);
  });
  it('duplicate transport flush cannot create another event', async () => {
    const { api, debug } = await views(); api.trackDetailView('post-1', 'post');
    mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ results: [] }) });
    await Promise.all([debug.forceFlush(), debug.forceFlush()]); expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
  it('pending state is bounded and expired actions are discarded, never re-signed', async () => {
    const { api, debug } = await views();
    for (let i = 0; i < 300; i++) api.trackDetailView(`post-${i}`, 'post');
    expect(debug.pending()).toHaveLength(256);
    vi.setSystemTime(Date.now() + 300001); await debug.forceFlush();
    expect(debug.pending()).toHaveLength(0); expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it('account switch drops pending observations from the old account', async () => {
    const { api, debug } = await views(); api.trackDetailView('post-1', 'post');
    api.initViewTracking(() => 'different'); await debug.forceFlush();
    expect(debug.pending()).toHaveLength(0); expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
