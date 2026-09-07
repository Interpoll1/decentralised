import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// A Gun node whose put callback is never invoked — exactly what the browser sees
// when the relay socket is reconnecting/rate-limiting and no peer ack comes back
// (Gun runs with localStorage:false/radisk:false, so there is no local ack).
function makeSilentGun() {
  const puts: Array<{ soul: string; value: any }> = [];
  const node = (soul: string): any => ({
    put: (value: any, _cb?: (ack: any) => void) => { puts.push({ soul, value }); },
    get: (key: string) => node(`${soul}/${key}`),
    once: (cb: (v: any) => void) => cb(undefined),
    on: () => ({ off: () => {} }),
    map: () => node(soul),
  });
  return { puts, gun: { get: (key: string) => node(key) } };
}

vi.mock('../src/services/keyService', () => ({
  KeyService: { getKeyPair: async () => { throw new Error('no key in test'); } },
}));
vi.mock('../src/services/keyVaultService', () => ({
  KeyVaultService: { storeKey: async () => {}, getKey: async () => undefined },
}));

const { puts, gun } = makeSilentGun();
vi.mock('../src/services/gunService', () => ({
  GUN_NAMESPACE: 'v3',
  GunService: { getGun: () => gun, getRawGun: () => gun },
}));

const { CommunityService } = await import('../src/services/communityService');

describe('CommunityService.createCommunity durability', () => {
  beforeEach(() => {
    puts.length = 0;
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const data = {
    name: 'gtaclips', displayName: 'GTA Clips', description: 'Your go-to for GTA clips!',
    rules: ['Be respectful'], creatorId: 'current-user-id', category: 'gaming', nsfw: false,
  };

  it('resolves instead of hanging when no Gun ack ever arrives', async () => {
    // Relay unreachable → verification is inconclusive → no pointless re-puts.
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));

    const promise = CommunityService.createCommunity(data);
    await vi.advanceTimersByTimeAsync(60_000);
    const community = await promise;

    expect(community.id).toBe('c-gtaclips');
    expect(community.displayName).toBe('GTA Clips');
  });

  it('re-puts the metadata while the relay says it does not hold it', async () => {
    // Soul exists but carries only the polls/posts child links — the husk state
    // real communities ended up in when the metadata write was lost.
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ soul: 'v3/communities/c-gtaclips', data: { polls: { '#': 'x' }, posts: { '#': 'y' } } }),
    })));

    const promise = CommunityService.createCommunity(data);
    await vi.advanceTimersByTimeAsync(120_000);
    await promise;

    // Two chained attempts, then one soul-addressed attempt off the raw root —
    // the fallback for a namespace chain broken by graph eviction.
    const chained = puts.filter(p => p.soul === 'communities/c-gtaclips');
    const soulDirect = puts.filter(p => p.soul === 'v3/communities/c-gtaclips');
    expect(chained.length).toBe(2);
    expect(soulDirect.length).toBe(1);
    expect(chained[0].value.displayName).toBe('GTA Clips');
  });

  it('stops after one write once the relay confirms the metadata', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: { id: 'c-gtaclips', displayName: 'GTA Clips', createdAt: Date.now() } }),
    })));

    const promise = CommunityService.createCommunity(data);
    await vi.advanceTimersByTimeAsync(120_000);
    await promise;

    expect(puts.filter(p => p.soul === 'communities/c-gtaclips').length).toBe(1);
  });
});
