import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RateLimiter } from '../rate-limiter.js';

describe('RateLimiter', () => {
  let limiter;

  beforeEach(() => {
    vi.useFakeTimers();
    limiter = new RateLimiter({ httpLimit: 5, wsLimit: 10, windowMs: 60_000 });
  });

  afterEach(() => {
    limiter.destroy();
    vi.useRealTimers();
  });

  describe('checkHttp', () => {
    it('allows requests under the limit', () => {
      for (let i = 0; i < 5; i++) {
        const result = limiter.checkHttp('192.168.1.1');
        expect(result.allowed).toBe(true);
      }
    });

    it('blocks requests over the limit', () => {
      for (let i = 0; i < 5; i++) {
        limiter.checkHttp('192.168.1.1');
      }
      const result = limiter.checkHttp('192.168.1.1');
      expect(result.allowed).toBe(false);
      expect(result.retryAfter).toBeGreaterThan(0);
    });

    it('tracks violations', () => {
      for (let i = 0; i < 5; i++) limiter.checkHttp('1.1.1.1');
      limiter.checkHttp('1.1.1.1'); // triggers violation
      expect(limiter.getViolations('1.1.1.1')).toBe(1);
    });
  });

  describe('checkWs', () => {
    it('allows messages under the limit', () => {
      for (let i = 0; i < 10; i++) {
        expect(limiter.checkWs('peer-1').allowed).toBe(true);
      }
    });

    it('blocks messages over the limit', () => {
      for (let i = 0; i < 10; i++) limiter.checkWs('peer-1');
      expect(limiter.checkWs('peer-1').allowed).toBe(false);
    });
  });

  describe('cooldown escalation', () => {
    it('escalates penalties with repeated violations', () => {
      // First violation
      for (let i = 0; i < 6; i++) limiter.checkHttp('bad-ip');
      const first = limiter.checkHttp('bad-ip');
      expect(first.allowed).toBe(false);
      expect(first.retryAfter).toBe(2); // PENALTY_SCHEDULE[0]

      // Wait for cooldown, trigger second violation
      vi.advanceTimersByTime(3000);
      for (let i = 0; i < 6; i++) limiter.checkHttp('bad-ip');
      const second = limiter.checkHttp('bad-ip');
      expect(second.retryAfter).toBe(8); // PENALTY_SCHEDULE[1]
    });
  });

  describe('sliding window reset', () => {
    it('resets after window expires', () => {
      for (let i = 0; i < 5; i++) limiter.checkHttp('1.1.1.1');
      vi.advanceTimersByTime(61_000); // past window
      const result = limiter.checkHttp('1.1.1.1');
      expect(result.allowed).toBe(true);
    });
  });

  describe('violation decay', () => {
    it('decays violations over time', () => {
      // Trigger a violation
      for (let i = 0; i < 6; i++) limiter.checkHttp('1.1.1.1');
      expect(limiter.getViolations('1.1.1.1')).toBe(1);

      // Wait for decay (5 minutes per step)
      vi.advanceTimersByTime(5 * 60_000 + 1);
      expect(limiter.getViolations('1.1.1.1')).toBe(0);
    });
  });

  describe('getRateLimitMultiplier', () => {
    it('returns 1 for no violations', () => {
      expect(limiter.getRateLimitMultiplier('clean')).toBe(1);
    });

    it('returns escalating multipliers', () => {
      // Trigger multiple violations
      for (let v = 0; v < 3; v++) {
        for (let i = 0; i < 6; i++) limiter.checkHttp('bad');
        vi.advanceTimersByTime(3000); // wait for cooldown
      }
      expect(limiter.getRateLimitMultiplier('bad')).toBeGreaterThan(1);
    });
  });

  describe('cleanup', () => {
    it('removes stale entries', () => {
      limiter.checkHttp('old-ip');
      vi.advanceTimersByTime(700_000); // well past stale threshold
      limiter.cleanup();
      expect(limiter.getViolations('old-ip')).toBe(0);
    });
  });

  describe('isolation', () => {
    it('different IPs have independent limits', () => {
      for (let i = 0; i < 5; i++) limiter.checkHttp('ip-a');
      expect(limiter.checkHttp('ip-a').allowed).toBe(false);
      expect(limiter.checkHttp('ip-b').allowed).toBe(true);
    });
  });
});
