import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GunService } from '@/services/gunService';

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
