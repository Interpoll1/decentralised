import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CONTENT_POW_MIN_BITS } from '../shared-validation/contentPow.js';
import { HumanGateError, HumanGateService } from '../src/services/humanGateService';

const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); },
};

const inputs = (pointer: number, keys: number, edits: number) => ({ pointer, keys, edits });

describe('HumanGateService', () => {
  beforeEach(() => { store.clear(); vi.useRealTimers(); });

  it('allows the first posts and blocks a burst', () => {
    for (let i = 0; i < 3; i++) {
      expect(() => HumanGateService.assertRateLimit('post')).not.toThrow();
      HumanGateService.recordCreation('post');
    }
    expect(() => HumanGateService.assertRateLimit('post')).toThrow(HumanGateError);
    // Other actions have their own budget.
    expect(() => HumanGateService.assertRateLimit('comment')).not.toThrow();
  });

  it('escalates proof-of-work difficulty with recent activity, capped', () => {
    const base = HumanGateService.requiredBits('comment');
    expect(base).toBeGreaterThanOrEqual(CONTENT_POW_MIN_BITS);
    for (let i = 0; i < 6; i++) HumanGateService.recordCreation('comment');
    const busy = HumanGateService.requiredBits('comment');
    expect(busy).toBeGreaterThan(base);
    expect(busy).toBeLessThanOrEqual(CONTENT_POW_MIN_BITS + 4);
  });

  it('honeypot hits fail silently', () => {
    try {
      HumanGateService.assertHumanSubmit('post', { honeypot: 'http://spam', openedAt: 0, inputsAtOpen: inputs(0, 0, 0) });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(HumanGateError);
      expect((err as HumanGateError).silent).toBe(true);
    }
  });

  it('rejects instant submits and submits with no real input', () => {
    // Opened just now.
    expect(() => HumanGateService.assertHumanSubmit('post', {
      honeypot: '', openedAt: Date.now(), inputsAtOpen: inputs(0, 0, 0),
    })).toThrow(/quick/);
    // Old enough, but no trusted input events were ever recorded (script filled the form).
    expect(() => HumanGateService.assertHumanSubmit('post', {
      honeypot: '', openedAt: Date.now() - 60_000, inputsAtOpen: inputs(0, 0, 0),
    })).toThrow(/type your message/);
  });
});
