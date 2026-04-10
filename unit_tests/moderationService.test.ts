import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock localStorage
const storage = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
  clear: () => storage.clear(),
});

vi.mock('vue', () => ({
  ref: (val: any) => ({ value: val }),
}));

import { ModerationService } from '../src/services/moderationService';

describe('ModerationService', () => {
  beforeEach(() => {
    storage.clear();
    // Force re-init of internal state
    (ModerationService as any).settings = null;
    (ModerationService as any).wordList = null;
    (ModerationService as any)._regex = null;
  });

  describe('getDefaultSettings', () => {
    it('returns expected defaults', () => {
      const s = ModerationService.getDefaultSettings();
      expect(s.wordFilterEnabled).toBe(false);
      expect(s.wordFilterAction).toBe('blur');
      expect(s.minUserKarma).toBe(-1000);
      expect(s.minContentScore).toBe(-5);
      expect(s.customBlockedWords).toEqual([]);
      expect(s.customAllowedWords).toEqual([]);
    });
  });

  describe('getDefaultWordList', () => {
    it('returns a non-empty list of word entries', () => {
      const list = ModerationService.getDefaultWordList();
      expect(list.length).toBeGreaterThan(100);
      expect(list[0]).toHaveProperty('word');
      expect(list[0]).toHaveProperty('category');
      expect(list[0]).toHaveProperty('severity');
      expect(list[0]).toHaveProperty('enabled');
    });

    it('returns clones', () => {
      const a = ModerationService.getDefaultWordList();
      const b = ModerationService.getDefaultWordList();
      a[0].word = 'modified';
      expect(b[0].word).not.toBe('modified');
    });
  });

  describe('saveSettings / getSettings', () => {
    it('persists and retrieves settings', () => {
      ModerationService.saveSettings({ wordFilterEnabled: true });
      const s = ModerationService.getSettings();
      expect(s.wordFilterEnabled).toBe(true);
    });

    it('merges with defaults', () => {
      ModerationService.saveSettings({ minContentScore: -10 });
      const s = ModerationService.getSettings();
      expect(s.minContentScore).toBe(-10);
      expect(s.wordFilterAction).toBe('blur'); // default preserved
    });
  });

  describe('checkContent', () => {
    it('returns unflagged when word filter is disabled', () => {
      const result = ModerationService.checkContent('fuck shit damn');
      expect(result.flagged).toBe(false);
    });

    it('flags content when word filter is enabled', () => {
      ModerationService.saveSettings({ wordFilterEnabled: true });
      const result = ModerationService.checkContent('what the fuck is this shit');
      expect(result.flagged).toBe(true);
      expect(result.matches.length).toBeGreaterThan(0);
    });

    it('returns correct severity levels', () => {
      ModerationService.saveSettings({ wordFilterEnabled: true });
      // "nigger" is a slur with high severity
      const result = ModerationService.checkContent('test nigger test');
      expect(result.severity).toBe('high');
    });

    it('returns low severity for profanity', () => {
      ModerationService.saveSettings({ wordFilterEnabled: true });
      const result = ModerationService.checkContent('damn this crap');
      if (result.flagged) {
        expect(result.severity).toBe('low');
      }
    });

    it('handles empty text', () => {
      ModerationService.saveSettings({ wordFilterEnabled: true });
      const result = ModerationService.checkContent('');
      expect(result.flagged).toBe(false);
    });

    it('respects disabled categories', () => {
      ModerationService.saveSettings({
        wordFilterEnabled: true,
        disabledCategories: ['profanity'],
      });
      const result = ModerationService.checkContent('fuck shit damn');
      expect(result.flagged).toBe(false);
    });

    it('respects custom allowed words', () => {
      ModerationService.saveSettings({
        wordFilterEnabled: true,
        customAllowedWords: ['fuck'],
      });
      const result = ModerationService.checkContent('fuck');
      expect(result.flagged).toBe(false);
    });

    it('detects custom blocked words', () => {
      ModerationService.saveSettings({
        wordFilterEnabled: true,
        customBlockedWords: ['badword'],
      });
      const result = ModerationService.checkContent('this is a badword');
      expect(result.flagged).toBe(true);
      expect(result.matches.some((m) => m.word === 'badword')).toBe(true);
    });
  });

  describe('shouldHideByScore', () => {
    it('hides content below minContentScore', () => {
      ModerationService.saveSettings({ minContentScore: -5 });
      expect(ModerationService.shouldHideByScore(-6)).toBe(true);
      expect(ModerationService.shouldHideByScore(-5)).toBe(false);
      expect(ModerationService.shouldHideByScore(0)).toBe(false);
    });
  });

  describe('shouldHideByKarma', () => {
    it('returns false for null karma', () => {
      expect(ModerationService.shouldHideByKarma(null)).toBe(false);
    });

    it('returns false when minUserKarma is -1000 (disabled)', () => {
      ModerationService.saveSettings({ minUserKarma: -1000 });
      expect(ModerationService.shouldHideByKarma(-2000)).toBe(false);
    });

    it('hides when karma below threshold', () => {
      ModerationService.saveSettings({ minUserKarma: 0 });
      expect(ModerationService.shouldHideByKarma(-1)).toBe(true);
      expect(ModerationService.shouldHideByKarma(0)).toBe(false);
    });
  });

  describe('getActiveWords', () => {
    it('excludes disabled categories', () => {
      ModerationService.saveSettings({ disabledCategories: ['slurs'] });
      const active = ModerationService.getActiveWords();
      expect(active.every((w) => w.category !== 'slurs')).toBe(true);
    });

    it('excludes custom allowed words', () => {
      ModerationService.saveSettings({ customAllowedWords: ['damn'] });
      const active = ModerationService.getActiveWords();
      expect(active.every((w) => w.word !== 'damn')).toBe(true);
    });
  });
});
