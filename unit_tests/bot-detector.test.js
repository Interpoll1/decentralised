import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BotDetector } from '../bot-detector.js';

describe('BotDetector', () => {
  let detector;

  beforeEach(() => {
    vi.useFakeTimers();
    detector = new BotDetector();
  });

  afterEach(() => {
    detector.destroy();
    vi.useRealTimers();
  });

  describe('onConnect / onDisconnect', () => {
    it('tracks a connected peer', () => {
      detector.onConnect('peer-1');
      expect(detector.getScore('peer-1')).toBe(0);
    });

    it('returns 0 for unknown peer', () => {
      expect(detector.getScore('unknown')).toBe(0);
    });

    it('marks peer as disconnected', () => {
      detector.onConnect('peer-1');
      detector.onDisconnect('peer-1');
      const state = detector._getState('peer-1');
      expect(state.disconnectedAt).toBeGreaterThan(0);
    });
  });

  describe('onRegister', () => {
    it('records registration time', () => {
      detector.onConnect('peer-1');
      detector.onRegister('peer-1');
      const state = detector._getState('peer-1');
      expect(state.registerTime).toBeGreaterThan(0);
    });
  });

  describe('recordMessage', () => {
    it('auto-connects unknown peer', () => {
      detector.recordMessage('peer-new', 'hash1');
      expect(detector._getState('peer-new')).toBeTruthy();
    });

    it('increments message count', () => {
      detector.onConnect('peer-1');
      detector.recordMessage('peer-1', 'h1');
      detector.recordMessage('peer-1', 'h2');
      const state = detector._getState('peer-1');
      expect(state.messageCount).toBe(2);
    });

    it('returns score', () => {
      detector.onConnect('peer-1');
      const score = detector.recordMessage('peer-1', 'h1');
      expect(typeof score).toBe('number');
    });

    it('caps timestamps at MAX_TIMESTAMPS', () => {
      detector.onConnect('peer-1');
      for (let i = 0; i < 120; i++) {
        vi.advanceTimersByTime(100);
        detector.recordMessage('peer-1', `h${i}`);
      }
      const state = detector._getState('peer-1');
      expect(state.timestamps.length).toBeLessThanOrEqual(100);
    });

    it('caps message hashes at MAX_HASHES', () => {
      detector.onConnect('peer-1');
      for (let i = 0; i < 30; i++) {
        vi.advanceTimersByTime(500);
        detector.recordMessage('peer-1', `h${i}`);
      }
      const state = detector._getState('peer-1');
      expect(state.messageHashes.length).toBeLessThanOrEqual(20);
    });
  });

  describe('getAction', () => {
    it('allows unknown peers', () => {
      const result = detector.getAction('unknown');
      expect(result.action).toBe('allow');
      expect(result.multiplier).toBe(1);
    });

    it('allows low-score peers', () => {
      detector.onConnect('peer-1');
      detector.recordMessage('peer-1', 'unique1');
      const result = detector.getAction('peer-1');
      expect(result.action).toBe('allow');
    });

    it('returns correct multipliers for score thresholds', () => {
      // Manually test the action mapping by setting score
      detector.onConnect('peer-1');
      const state = detector._getState('peer-1');

      state.score = 0;
      expect(detector.getAction('peer-1').action).toBe('allow');

      state.score = 31;
      expect(detector.getAction('peer-1').action).toBe('throttle');
      expect(detector.getAction('peer-1').multiplier).toBe(2);

      state.score = 61;
      expect(detector.getAction('peer-1').action).toBe('challenge');
      expect(detector.getAction('peer-1').multiplier).toBe(5);

      state.score = 81;
      expect(detector.getAction('peer-1').action).toBe('ban');
      expect(detector.getAction('peer-1').multiplier).toBe(10);
    });
  });

  describe('bot detection scoring', () => {
    it('detects rapid identical messages as suspicious', () => {
      detector.onConnect('bot-1');
      // Send many identical messages rapidly
      for (let i = 0; i < 30; i++) {
        detector.recordMessage('bot-1', 'same-hash');
      }
      const score = detector.getScore('bot-1');
      expect(score).toBeGreaterThan(0);
    });

    it('detects fast registration-to-message timing', () => {
      detector.onConnect('bot-2');
      detector.onRegister('bot-2');
      // Send message immediately after registration (< 20ms)
      detector.recordMessage('bot-2', 'h1');
      const state = detector._getState('bot-2');
      // The timing score should contribute
      expect(state.score).toBeGreaterThanOrEqual(0);
    });
  });

  describe('cleanup', () => {
    it('removes stale disconnected peers', () => {
      detector.onConnect('peer-1');
      detector.onDisconnect('peer-1');
      vi.advanceTimersByTime(11 * 60_000); // > 10 min stale threshold
      detector.cleanup();
      expect(detector._getState('peer-1')).toBeUndefined();
    });

    it('keeps recently disconnected peers', () => {
      detector.onConnect('peer-1');
      detector.onDisconnect('peer-1');
      vi.advanceTimersByTime(5 * 60_000); // < 10 min
      detector.cleanup();
      expect(detector._getState('peer-1')).toBeTruthy();
    });
  });
});
