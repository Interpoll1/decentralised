import { describe, expect, it } from 'vitest';
import { createHeaderScrollTracker } from '../src/utils/headerScrollTracker';

describe('home header scroll direction', () => {
  it('keeps the header visible near the top, then hides on a downward scroll', () => {
    const update = createHeaderScrollTracker();
    expect([0, 8, 20, 40, 50, 51].map(update)).toEqual([false, false, false, false, false, true]);
  });

  it('ignores alternating fractional motion while the header is hidden', () => {
    const update = createHeaderScrollTracker();
    expect(update(140)).toBe(true);
    expect([139.8, 140.1, 139.5, 140, 139.9].map(update)).toEqual([true, true, true, true, true]);
  });

  it('shows after a deliberate upward reversal, then ignores downward jitter', () => {
    const update = createHeaderScrollTracker();
    update(200);
    expect(update(189)).toBe(true);
    expect(update(188)).toBe(false);
    expect([188.3, 187.9, 188.2].map(update)).toEqual([false, false, false]);
    expect(update(201)).toBe(true);
  });

  it('accumulates slow movement rather than requiring one large event', () => {
    const update = createHeaderScrollTracker();
    update(200);
    for (let top = 199; top > 188; top--) expect(update(top)).toBe(true);
    expect(update(188)).toBe(false);
    for (let top = 189; top < 200; top++) expect(update(top)).toBe(false);
    expect(update(200)).toBe(true);
  });

  it('shows at the top and handles negative overscroll without a phantom reversal', () => {
    const update = createHeaderScrollTracker();
    update(100);
    expect(update(8)).toBe(false);
    expect(update(-20)).toBe(false);
    expect(update(0)).toBe(false);
    expect(update(49)).toBe(false);
  });

  it('ignores repeated and invalid positions without corrupting direction state', () => {
    const update = createHeaderScrollTracker();
    update(120);
    expect([120, Number.NaN, Number.POSITIVE_INFINITY].map(update)).toEqual([true, true, true]);
    expect(update(108)).toBe(false);
  });
});
