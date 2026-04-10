import { describe, it, expect, beforeEach } from 'vitest';
import { rankFeedItems, type FeedRankInput } from '../src/utils/feedRanking';
import type { FeedPreferences } from '../src/services/feedPreferencesService';

function makePrefs(overrides: Partial<FeedPreferences> = {}): FeedPreferences {
  return {
    mode: 'smart' as any,
    showPosts: true,
    showPolls: true,
    includeKeywords: [],
    excludeKeywords: [],
    mutedCommunities: [],
    favoriteCommunities: [],
    rankingWeights: {
      freshness: 0.4,
      engagement: 0.25,
      keywords: 0.25,
      community: 0.1,
    },
    ...overrides,
  };
}

function makeItem(overrides: Partial<FeedRankInput> = {}): FeedRankInput {
  return {
    id: 'item-1',
    type: 'post',
    createdAt: Date.now(),
    communityId: 'c1',
    title: 'Test post',
    content: 'Some content here',
    engagementScore: 10,
    ...overrides,
  };
}

describe('rankFeedItems', () => {
  it('returns empty array for empty input', () => {
    expect(rankFeedItems([], makePrefs())).toEqual([]);
  });

  it('returns ranked results with score field', () => {
    const items = [makeItem()];
    const results = rankFeedItems(items, makePrefs());
    expect(results).toHaveLength(1);
    expect(results[0].score).toBeGreaterThan(0);
    expect(results[0].id).toBe('item-1');
  });

  it('filters out posts when showPosts=false', () => {
    const items = [makeItem({ type: 'post' }), makeItem({ id: 'poll-1', type: 'poll' })];
    const results = rankFeedItems(items, makePrefs({ showPosts: false }));
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('poll-1');
  });

  it('filters out polls when showPolls=false', () => {
    const items = [makeItem({ type: 'post' }), makeItem({ id: 'poll-1', type: 'poll' })];
    const results = rankFeedItems(items, makePrefs({ showPolls: false }));
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('item-1');
  });

  it('filters muted communities', () => {
    const items = [
      makeItem({ communityId: 'muted-comm' }),
      makeItem({ id: 'item-2', communityId: 'ok-comm' }),
    ];
    const results = rankFeedItems(items, makePrefs({ mutedCommunities: ['muted-comm'] }));
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('item-2');
  });

  it('boosts favorite communities', () => {
    const items = [
      makeItem({ id: 'fav', communityId: 'fav-comm', engagementScore: 0 }),
      makeItem({ id: 'normal', communityId: 'other', engagementScore: 0 }),
    ];
    const results = rankFeedItems(items, makePrefs({ favoriteCommunities: ['fav-comm'] }));
    const favResult = results.find((r) => r.id === 'fav')!;
    const normalResult = results.find((r) => r.id === 'normal')!;
    expect(favResult.score).toBeGreaterThan(normalResult.score);
  });

  it('sorts by score descending', () => {
    const now = Date.now();
    const items = [
      makeItem({ id: 'old', createdAt: now - 72 * 3600_000, engagementScore: 0 }),
      makeItem({ id: 'new', createdAt: now, engagementScore: 50 }),
    ];
    const results = rankFeedItems(items, makePrefs());
    expect(results[0].id).toBe('new');
  });

  it('demotes items matching exclude keywords', () => {
    const items = [
      makeItem({ id: 'bad', title: 'spam garbage', content: '' }),
      makeItem({ id: 'good', title: 'nice post', content: '' }),
    ];
    const results = rankFeedItems(items, makePrefs({ excludeKeywords: ['spam'] }));
    const bad = results.find((r) => r.id === 'bad')!;
    expect(bad.demoted).toBe(true);
    expect(bad.excludeMatches).toContain('spam');
  });

  it('boosts items matching include keywords', () => {
    const items = [
      makeItem({ id: 'match', title: 'blockchain tech', content: '' }),
      makeItem({ id: 'miss', title: 'cooking recipe', content: '' }),
    ];
    const results = rankFeedItems(items, makePrefs({ includeKeywords: ['blockchain'] }));
    const match = results.find((r) => r.id === 'match')!;
    expect(match.includeMatches).toContain('blockchain');
  });

  it('penalizes items that miss all include keywords', () => {
    const items = [
      makeItem({ id: 'match', title: 'blockchain', content: '' }),
      makeItem({ id: 'miss', title: 'cooking', content: '' }),
    ];
    const results = rankFeedItems(items, makePrefs({ includeKeywords: ['blockchain'] }));
    const matchResult = results.find((r) => r.id === 'match')!;
    const missResult = results.find((r) => r.id === 'miss')!;
    expect(matchResult.score).toBeGreaterThan(missResult.score);
  });

  it('handles zero total weights gracefully', () => {
    const items = [makeItem()];
    const results = rankFeedItems(
      items,
      makePrefs({
        rankingWeights: { freshness: 0, engagement: 0, keywords: 0, community: 0 },
      }),
    );
    expect(results).toHaveLength(1);
    expect(results[0].score).toBeGreaterThan(0);
  });
});
