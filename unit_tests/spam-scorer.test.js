import { describe, it, expect, beforeEach } from 'vitest';
import { SpamScorer, SPAM_THRESHOLDS } from '../spam-scorer.js';

describe('SpamScorer', () => {
  let scorer;

  beforeEach(() => {
    scorer = new SpamScorer();
  });

  describe('score', () => {
    it('returns zero for clean text', () => {
      const result = scorer.score('Hello, this is a normal post about cooking.');
      expect(result.matchCount).toBe(0);
      expect(result.matches).toEqual([]);
    });

    it('returns zero for null/undefined', () => {
      expect(scorer.score(null).matchCount).toBe(0);
      expect(scorer.score(undefined).matchCount).toBe(0);
    });

    it('returns zero for non-string input', () => {
      expect(scorer.score(42).matchCount).toBe(0);
    });

    it('returns zero for empty string', () => {
      expect(scorer.score('').matchCount).toBe(0);
    });

    it('detects profanity in English', () => {
      const result = scorer.score('what the fuck is this shit damn crap ass bitch');
      expect(result.matchCount).toBeGreaterThanOrEqual(2);
      expect(result.languagesHit).toContain('en');
    });

    it('detects profanity in French', () => {
      const result = scorer.score('merde putain bordel connard');
      expect(result.matchCount).toBeGreaterThanOrEqual(3);
    });

    it('detects leetspeak variations', () => {
      // ph substitution and number substitution
      const result = scorer.score('phuck sh1t a55');
      expect(result.matchCount).toBeGreaterThanOrEqual(1);
    });

    it('caps input length at 5000 chars', () => {
      const longText = 'fuck '.repeat(2000); // way over 5000
      const result = scorer.score(longText);
      // Should not crash, just truncate
      expect(result.matchCount).toBeGreaterThanOrEqual(1);
    });

    it('tracks language hits', () => {
      const result = scorer.score('fuck shit ass damn crap');
      expect(result.languagesHit).toContain('en');
    });
  });

  describe('getPowPenalty', () => {
    it('returns 0 for low match count', () => {
      expect(scorer.getPowPenalty({ matchCount: 0 })).toBe(0);
      expect(scorer.getPowPenalty({ matchCount: 2 })).toBe(0);
    });

    it('returns 2 for FLAG threshold (3-5)', () => {
      expect(scorer.getPowPenalty({ matchCount: 3 })).toBe(2);
      expect(scorer.getPowPenalty({ matchCount: 5 })).toBe(2);
    });

    it('returns 4 for HEAVY_FLAG threshold (6+)', () => {
      expect(scorer.getPowPenalty({ matchCount: 6 })).toBe(4);
      expect(scorer.getPowPenalty({ matchCount: 100 })).toBe(4);
    });
  });

  describe('shouldFlag', () => {
    it('returns false below threshold', () => {
      expect(scorer.shouldFlag({ matchCount: 2 })).toBe(false);
    });

    it('returns true at threshold', () => {
      expect(scorer.shouldFlag({ matchCount: 3 })).toBe(true);
    });
  });

  describe('shouldDelay', () => {
    it('returns false below threshold', () => {
      expect(scorer.shouldDelay({ matchCount: 5 })).toBe(false);
    });

    it('returns true at threshold', () => {
      expect(scorer.shouldDelay({ matchCount: 6 })).toBe(true);
    });
  });

  describe('getStats', () => {
    it('returns dictionary statistics', () => {
      const stats = scorer.getStats();
      expect(stats.languageCount).toBeGreaterThan(0);
      expect(stats.totalWords).toBeGreaterThan(0);
    });
  });

  describe('SPAM_THRESHOLDS', () => {
    it('has expected values', () => {
      expect(SPAM_THRESHOLDS.NONE).toBe(2);
      expect(SPAM_THRESHOLDS.FLAG).toBe(3);
      expect(SPAM_THRESHOLDS.HEAVY_FLAG).toBe(6);
    });
  });
});
