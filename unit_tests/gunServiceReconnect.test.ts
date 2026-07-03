import { afterEach, describe, expect, it, vi } from 'vitest';
import { GunService } from '@/services/gunService';

// reconnect([]) builds a Gun instance with no peers → no network activity.
describe('GunService.onReconnect', () => {
  afterEach(() => {
    (GunService as any).reconnectListeners?.clear?.();
  });

  it('fires registered listeners after reconnect rebuilds the instance', () => {
    const cb = vi.fn();
    GunService.onReconnect(cb);
    GunService.reconnect([]);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('stops firing after unsubscribe', () => {
    const cb = vi.fn();
    const unsub = GunService.onReconnect(cb);
    GunService.reconnect([]);
    unsub();
    GunService.reconnect([]);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('one throwing listener does not stop the others', () => {
    const bad = vi.fn(() => { throw new Error('boom'); });
    const good = vi.fn();
    GunService.onReconnect(bad);
    GunService.onReconnect(good);
    expect(() => GunService.reconnect([])).not.toThrow();
    expect(good).toHaveBeenCalledTimes(1);
  });
});
