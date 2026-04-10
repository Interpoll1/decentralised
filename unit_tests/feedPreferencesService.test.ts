import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock localStorage
const storage = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
  clear: () => storage.clear(),
});

// Must mock vue ref
vi.mock('vue', () => ({
  ref: (val: any) => ({ value: val }),
  computed: (fn: any) => ({ value: fn() }),
}));

import {
  FeedPreferencesService,
  type FeedPreferences,
} from '../src/services/feedPreferencesService';

describe('FeedPreferencesService', () => {
  beforeEach(() => {
    storage.clear();
    // Reset internal cache by loading from empty storage
    FeedPreferencesService.resetPreferences();
  });

  describe('getDefaultPreferences', () => {
    it('returns expected defaults', () => {
      const defaults = FeedPreferencesService.getDefaultPreferences();
      expect(defaults.mode).toBe('latest');
      expect(defaults.showPosts).toBe(true);
      expect(defaults.showPolls).toBe(true);
      expect(defaults.includeKeywords).toEqual([]);
      expect(defaults.excludeKeywords).toEqual([]);
      expect(defaults.mutedCommunities).toEqual([]);
      expect(defaults.favoriteCommunities).toEqual([]);
      expect(defaults.rankingWeights.freshness).toBe(0.4);
    });

    it('returns a clone (not a reference)', () => {
      const a = FeedPreferencesService.getDefaultPreferences();
      const b = FeedPreferencesService.getDefaultPreferences();
      a.includeKeywords.push('test');
      expect(b.includeKeywords).toEqual([]);
    });
  });

  describe('setMode', () => {
    it('persists mode change', () => {
      FeedPreferencesService.setMode('for-you');
      expect(FeedPreferencesService.getPreferences().mode).toBe('for-you');
    });

    it('defaults invalid mode to latest', () => {
      FeedPreferencesService.setMode('invalid' as any);
      expect(FeedPreferencesService.getPreferences().mode).toBe('latest');
    });
  });

  describe('setContentTypeVisibility', () => {
    it('hides polls when showPolls=false', () => {
      FeedPreferencesService.setContentTypeVisibility(true, false);
      const prefs = FeedPreferencesService.getPreferences();
      expect(prefs.showPosts).toBe(true);
      expect(prefs.showPolls).toBe(false);
    });

    it('prevents both being false (falls back to showPosts)', () => {
      FeedPreferencesService.setContentTypeVisibility(false, false);
      const prefs = FeedPreferencesService.getPreferences();
      expect(prefs.showPosts).toBe(true);
    });
  });

  describe('keyword management', () => {
    it('adds include keyword (normalized)', () => {
      FeedPreferencesService.addIncludeKeyword('  Blockchain  ');
      expect(FeedPreferencesService.getPreferences().includeKeywords).toContain('blockchain');
    });

    it('removes include keyword', () => {
      FeedPreferencesService.addIncludeKeyword('test');
      FeedPreferencesService.removeIncludeKeyword('test');
      expect(FeedPreferencesService.getPreferences().includeKeywords).not.toContain('test');
    });

    it('does not duplicate keywords', () => {
      FeedPreferencesService.addIncludeKeyword('test');
      FeedPreferencesService.addIncludeKeyword('test');
      expect(
        FeedPreferencesService.getPreferences().includeKeywords.filter((k) => k === 'test'),
      ).toHaveLength(1);
    });

    it('adding include keyword removes from exclude', () => {
      FeedPreferencesService.addExcludeKeyword('conflict');
      FeedPreferencesService.addIncludeKeyword('conflict');
      const prefs = FeedPreferencesService.getPreferences();
      expect(prefs.includeKeywords).toContain('conflict');
      expect(prefs.excludeKeywords).not.toContain('conflict');
    });

    it('adding exclude keyword removes from include', () => {
      FeedPreferencesService.addIncludeKeyword('conflict');
      FeedPreferencesService.addExcludeKeyword('conflict');
      const prefs = FeedPreferencesService.getPreferences();
      expect(prefs.excludeKeywords).toContain('conflict');
      expect(prefs.includeKeywords).not.toContain('conflict');
    });

    it('ignores empty keyword', () => {
      const before = FeedPreferencesService.getPreferences();
      FeedPreferencesService.addIncludeKeyword('   ');
      const after = FeedPreferencesService.getPreferences();
      expect(after.includeKeywords).toEqual(before.includeKeywords);
    });
  });

  describe('community muting/favoriting', () => {
    it('toggles muted community on/off', () => {
      FeedPreferencesService.toggleMutedCommunity('comm-1');
      expect(FeedPreferencesService.getPreferences().mutedCommunities).toContain('comm-1');

      FeedPreferencesService.toggleMutedCommunity('comm-1');
      expect(FeedPreferencesService.getPreferences().mutedCommunities).not.toContain('comm-1');
    });

    it('muting removes from favorites', () => {
      FeedPreferencesService.toggleFavoriteCommunity('comm-1');
      FeedPreferencesService.toggleMutedCommunity('comm-1');
      const prefs = FeedPreferencesService.getPreferences();
      expect(prefs.mutedCommunities).toContain('comm-1');
      expect(prefs.favoriteCommunities).not.toContain('comm-1');
    });

    it('favoriting removes from muted', () => {
      FeedPreferencesService.toggleMutedCommunity('comm-1');
      FeedPreferencesService.toggleFavoriteCommunity('comm-1');
      const prefs = FeedPreferencesService.getPreferences();
      expect(prefs.favoriteCommunities).toContain('comm-1');
      expect(prefs.mutedCommunities).not.toContain('comm-1');
    });

    it('ignores empty community id', () => {
      const before = FeedPreferencesService.getPreferences();
      FeedPreferencesService.toggleMutedCommunity('   ');
      const after = FeedPreferencesService.getPreferences();
      expect(after.mutedCommunities).toEqual(before.mutedCommunities);
    });
  });

  describe('ranking weights', () => {
    it('sets custom weights', () => {
      FeedPreferencesService.setRankingWeights({ freshness: 0.8 });
      expect(FeedPreferencesService.getPreferences().rankingWeights.freshness).toBe(0.8);
    });

    it('clamps weights to [0, 1]', () => {
      FeedPreferencesService.setRankingWeights({ freshness: 5, engagement: -1 });
      const w = FeedPreferencesService.getPreferences().rankingWeights;
      expect(w.freshness).toBeLessThanOrEqual(1);
      expect(w.engagement).toBeGreaterThanOrEqual(0);
    });
  });

  describe('resetPreferences', () => {
    it('reverts to defaults', () => {
      FeedPreferencesService.setMode('for-you');
      FeedPreferencesService.addIncludeKeyword('test');
      FeedPreferencesService.resetPreferences();
      const prefs = FeedPreferencesService.getPreferences();
      expect(prefs.mode).toBe('latest');
      expect(prefs.includeKeywords).toEqual([]);
    });
  });
});
