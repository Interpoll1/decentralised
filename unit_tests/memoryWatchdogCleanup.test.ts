import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoryWatchdogService } from '@/services/memoryWatchdogService';

// The watchdog calls GunService.evictCache() on every cleanup; stub it out so
// these tests exercise only the callback registry.
vi.mock('@/services/gunService', () => ({
  GunService: {
    evictCache: vi.fn(),
    getGraphNodeCount: () => 0,
    reconnect: vi.fn(),
  },
}));

/** doCleanup is private; these tests drive it the way the check timer does. */
function runCleanup(level: 'light' | 'aggressive' | 'emergency') {
  (MemoryWatchdogService as any).doCleanup(level);
}

describe('MemoryWatchdogService cleanup callbacks', () => {
  beforeEach(() => {
    (MemoryWatchdogService as any).cleanupCallbacks = [];
    vi.stubGlobal('localStorage', {
      length: 0,
      key: () => null,
      removeItem: vi.fn(),
    });
  });

  afterEach(() => {
    (MemoryWatchdogService as any).cleanupCallbacks = [];
    vi.unstubAllGlobals();
  });

  it('invokes a registered callback with the pressure level', () => {
    const cb = vi.fn();
    MemoryWatchdogService.onCleanup(cb);

    runCleanup('light');
    expect(cb).toHaveBeenCalledWith('light');

    runCleanup('emergency');
    expect(cb).toHaveBeenCalledWith('emergency');
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it('stops invoking a callback after it unsubscribes', () => {
    const cb = vi.fn();
    const unsubscribe = MemoryWatchdogService.onCleanup(cb);

    runCleanup('light');
    unsubscribe();
    runCleanup('light');

    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('runs every callback even when one throws', () => {
    const first = vi.fn(() => { throw new Error('boom'); });
    const second = vi.fn();
    MemoryWatchdogService.onCleanup(first);
    MemoryWatchdogService.onCleanup(second);

    expect(() => runCleanup('aggressive')).not.toThrow();
    expect(second).toHaveBeenCalledWith('aggressive');
  });

  it('supports multiple independent subscribers', () => {
    const a = vi.fn();
    const b = vi.fn();
    MemoryWatchdogService.onCleanup(a);
    MemoryWatchdogService.onCleanup(b);

    runCleanup('light');

    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
  });
});
