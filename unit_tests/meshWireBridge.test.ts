import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GunService } from '@/services/gunService';
import config from '@/config';

/**
 * Exercises GunService.attachWireBridge — the bridge that carries Gun's wire
 * protocol over the WebRTC mesh. A fake Gun root captures the registered
 * outbound interceptor and inbound injections so we can assert the dedup guard
 * without a real Gun instance or network.
 */
describe('GunService.attachWireBridge', () => {
  let outHandler: ((this: { to: { next: (m: unknown) => void } }, msg: unknown) => void) | null;
  let inbound: unknown[];

  beforeEach(() => {
    outHandler = null;
    inbound = [];
    const fakeGun = {
      _: {
        on(event: string, arg: unknown) {
          if (event === 'out' && typeof arg === 'function') {
            outHandler = arg as typeof outHandler;
          } else if (event === 'in') {
            inbound.push(arg);
          }
        },
      },
    };
    // Inject the fake root so attachWireBridge skips real initialization.
    (GunService as unknown as { gun: unknown }).gun = fakeGun;
  });

  it('forwards outbound messages and preserves default handling', () => {
    const sent: unknown[] = [];
    GunService.attachWireBridge((m) => sent.push(m));

    const ctx = { to: { next: vi.fn() } };
    const msg = { '#': 'a', put: { x: 1 } };
    outHandler!.call(ctx, msg);

    expect(ctx.to.next).toHaveBeenCalledWith(msg); // default chain not broken
    expect(sent).toContainEqual(msg);
  });

  it('injects received messages into Gun and suppresses immediate echo', () => {
    const sent: unknown[] = [];
    const bridge = GunService.attachWireBridge((m) => sent.push(m));
    const ctx = { to: { next: vi.fn() } };

    // A message just heard from the mesh…
    bridge.receive({ '#': 'b', put: { y: 2 } });
    expect(inbound).toContainEqual({ '#': 'b', put: { y: 2 } });

    // …must not be echoed straight back out to the mesh.
    outHandler!.call(ctx, { '#': 'b', put: { y: 2 } });
    expect(sent.filter((m) => (m as { '#': string })['#'] === 'b')).toHaveLength(0);

    // A different message still flows out normally.
    outHandler!.call(ctx, { '#': 'c', put: { z: 3 } });
    expect(sent.filter((m) => (m as { '#': string })['#'] === 'c')).toHaveLength(1);
  });

  it('drops oversized wire messages to respect datachannel backpressure', () => {
    const sent: unknown[] = [];
    GunService.attachWireBridge((m) => sent.push(m));
    const ctx = { to: { next: vi.fn() } };

    const huge = { '#': 'big', put: { blob: 'x'.repeat(300 * 1024) } };
    outHandler!.call(ctx, huge);

    expect(ctx.to.next).toHaveBeenCalledWith(huge); // local handling still happens
    expect(sent).toHaveLength(0); // but it is not shipped to peers
  });
});

describe('GunService namespace soul classification', () => {
  it('accepts in-namespace and system souls, rejects foreign ones', () => {
    expect(GunService.isInNamespaceSoul('v3')).toBe(true);
    expect(GunService.isInNamespaceSoul('v3/polls/abc')).toBe(true);
    expect(GunService.isInNamespaceSoul('v3/communities/c1/polls/p1')).toBe(true);
    expect(GunService.isInNamespaceSoul('~pubkeyhex')).toBe(true); // SEA user-space
    expect(GunService.isInNamespaceSoul('_')).toBe(true);          // Gun internal

    expect(GunService.isInNamespaceSoul('evil')).toBe(false);
    expect(GunService.isInNamespaceSoul('v2/polls/abc')).toBe(false); // wrong namespace
    expect(GunService.isInNamespaceSoul('')).toBe(false);
  });

  it('enumerates only the out-of-namespace souls of a put', () => {
    const msg = { '#': 'm', put: { 'v3/polls/p1': {}, 'evil/root': {}, '~ok': {} } };
    expect(GunService.outOfNamespaceSouls(msg)).toEqual(['evil/root']);
    expect(GunService.outOfNamespaceSouls({ '#': 'x' })).toEqual([]); // non-put
  });
});

describe('GunService.attachWireBridge namespace filtering', () => {
  let outHandler: unknown;
  let inbound: unknown[];
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    inbound = [];
    const fakeGun = {
      _: {
        on(event: string, arg: unknown) {
          if (event === 'out' && typeof arg === 'function') outHandler = arg;
          else if (event === 'in') inbound.push(arg);
        },
      },
    };
    (GunService as unknown as { gun: unknown }).gun = fakeGun;
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    config.setWireFilterMode('log'); // restore default
  });

  it('log mode: injects out-of-namespace put but warns', () => {
    config.setWireFilterMode('log');
    const bridge = GunService.attachWireBridge(() => {});

    bridge.receive({ '#': 'e1', put: { 'evil/root': { hacked: true } } });

    expect(inbound.some((m) => (m as any)['#'] === 'e1')).toBe(true); // still injected
    expect(warnSpy).toHaveBeenCalled();
  });

  it('enforce mode: drops out-of-namespace put, keeps in-namespace put', () => {
    config.setWireFilterMode('enforce');
    const bridge = GunService.attachWireBridge(() => {});

    bridge.receive({ '#': 'e2', put: { 'evil/root': { hacked: true } } });
    expect(inbound.some((m) => (m as any)['#'] === 'e2')).toBe(false); // dropped

    bridge.receive({ '#': 'ok1', put: { 'v3/polls/p1': { votes: 3 } } });
    expect(inbound.some((m) => (m as any)['#'] === 'ok1')).toBe(true); // legit passes
  });

  it('off mode: injects everything unconditionally', () => {
    config.setWireFilterMode('off');
    const bridge = GunService.attachWireBridge(() => {});

    bridge.receive({ '#': 'e3', put: { 'evil/root': { hacked: true } } });
    expect(inbound.some((m) => (m as any)['#'] === 'e3')).toBe(true);
  });
});
