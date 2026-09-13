import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Fake Gun node that tracks live `.on()` listeners. A listener counts as detached
// only when its own event (`this` / 4th arg) or the returned chain calls off().
function makeTrackingGun() {
  const live = new Set<object>();
  let emitters: Array<(v: any) => void> = [];
  let current: any = undefined;
  const node = (soul: string): any => {
    const self: any = {
      get: (key: string) => node(`${soul}/${key}`),
      once: (cb: (v: any) => void) => { cb(current); return self; },
      on: (cb: (this: any, v: any, k?: string, m?: any, eve?: any) => void) => {
        const token = {};
        live.add(token);
        const eve = { off: () => { live.delete(token); } };
        emitters.push((v) => { if (live.has(token)) cb.call(eve, v, soul, {}, eve); });
        return { off: () => { live.delete(token); } };
      },
      map: () => node(soul),
      put: () => self,
    };
    return self;
  };
  return {
    gun: { get: (key: string) => node(key) },
    liveCount: () => live.size,
    emit: (v: any) => { current = v; emitters.forEach((e) => e(v)); },
    reset: () => { live.clear(); emitters = []; current = undefined; },
  };
}

const tracking = makeTrackingGun();
vi.mock('../src/services/gunService', () => ({
  GUN_NAMESPACE: 'v3',
  GunService: { getGun: () => tracking.gun, getRawGun: () => tracking.gun },
}));

const { PollService } = await import('../src/services/pollService');
const waitForNode = (PollService as any).waitForNode.bind(PollService);

describe('PollService.waitForNode listener lifecycle', () => {
  beforeEach(() => {
    tracking.reset();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('leaves no live Gun listener behind when the node never arrives', async () => {
    const node = tracking.gun.get('polls').get('poll-1');
    const promise = waitForNode(node, (v: any) => !!v?.id, 1500);
    await vi.advanceTimersByTimeAsync(2000);
    await expect(promise).resolves.toBeNull();
    expect(tracking.liveCount()).toBe(0);
  });

  it('does not accumulate listeners across repeated timed-out waits', async () => {
    const node = tracking.gun.get('polls').get('poll-1').get('options');
    for (let i = 0; i < 20; i++) {
      const p = waitForNode(node, (v: any) => !!v?.id, 1500);
      await vi.advanceTimersByTimeAsync(2000);
      await p;
    }
    expect(tracking.liveCount()).toBe(0);
  });

  it('still resolves with the value once the predicate is satisfied', async () => {
    const node = tracking.gun.get('polls').get('poll-2');
    const promise = waitForNode(node, (v: any) => !!v?.id, 1500);
    tracking.emit({ id: 'poll-2', question: 'q' });
    await vi.advanceTimersByTimeAsync(500);
    await expect(promise).resolves.toMatchObject({ id: 'poll-2' });
    expect(tracking.liveCount()).toBe(0);
  });
});
