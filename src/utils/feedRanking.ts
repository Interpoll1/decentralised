import type { FeedPreferences, FeedRankingWeights } from '../services/feedPreferencesService';

const FRESHNESS_WINDOW_HOURS = 72;
const DEFAULT_INCLUDE_MISS_PENALTY = 0.82;

export interface FeedRankInput {
  id: string;
  type: 'post' | 'poll';
  createdAt: number;
  communityId: string;
  title: string;
  content: string;
  engagementScore: number;
}

export interface FeedRankResult {
  id: string;
  createdAt: number;
  score: number;
  includeMatches: string[];
  excludeMatches: string[];
  demoted: boolean;
}

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasKeywordMatch(normalizedText: string, keyword: string): boolean {
  if (!normalizedText || !keyword) return false;

  if (keyword.includes(' ')) {
    return normalizedText.includes(keyword);
  }

  const regex = new RegExp(`\\b${escapeRegExp(keyword)}\\b`, 'i');
  return regex.test(normalizedText);
}

function findMatches(normalizedText: string, keywords: string[]): string[] {
  if (!normalizedText || keywords.length === 0) return [];
  return keywords.filter((keyword) => hasKeywordMatch(normalizedText, keyword));
}

function computeFreshnessScore(createdAt: number, now: number): number {
  const ageHours = Math.max(0, (now - createdAt) / 3_600_000);
  const freshness = 1 - ageHours / FRESHNESS_WINDOW_HOURS;
  return clamp01(freshness);
}

function computeEngagementScore(rawEngagement: number): number {
  const clean = Math.max(0, rawEngagement);
  if (clean === 0) return 0;
  return clamp01(Math.log1p(clean) / Math.log1p(200));
}

function normalizeWeights(weights: FeedRankingWeights): FeedRankingWeights {
  const total = weights.freshness + weights.engagement + weights.keywords + weights.community;
  if (total <= 0) {
    return {
      freshness: 0.4,
      engagement: 0.25,
      keywords: 0.25,
      community: 0.1,
    };
  }

  return {
    freshness: weights.freshness / total,
    engagement: weights.engagement / total,
    keywords: weights.keywords / total,
    community: weights.community / total,
  };
}

function getCommunityScore(
  communityId: string,
  favorites: ReadonlySet<string>,
  joinedCommunityIds: ReadonlySet<string>,
): number {
  if (favorites.has(communityId)) return 1;
  if (joinedCommunityIds.has(communityId)) return 0.6;
  return 0.3;
}

function getExcludeDemotionMultiplier(excludedMatchCount: number): number {
  if (excludedMatchCount <= 0) return 1;
  return Math.max(0.15, 1 - excludedMatchCount * 0.35);
}

function getKeywordScore(includeMatches: string[], includeKeywords: string[]): number {
  if (includeKeywords.length === 0) return 0.5;
  return clamp01(includeMatches.length / includeKeywords.length);
}

export function rankFeedItems(
  items: FeedRankInput[],
  preferences: FeedPreferences,
  joinedCommunityIds: ReadonlySet<string> = new Set<string>(),
): FeedRankResult[] {
  const now = Date.now();
  const normalizedWeights = normalizeWeights(preferences.rankingWeights);
  const mutedCommunities = new Set(preferences.mutedCommunities);
  const favoriteCommunities = new Set(preferences.favoriteCommunities);

  const ranked = items
    .filter((item) => {
      if (item.type === 'post' && !preferences.showPosts) return false;
      if (item.type === 'poll' && !preferences.showPolls) return false;
      return !mutedCommunities.has(item.communityId);
    })
    .map((item) => {
      const normalizedText = normalizeText(`${item.title} ${item.content}`);
      const includeMatches = findMatches(normalizedText, preferences.includeKeywords);
      const excludeMatches = findMatches(normalizedText, preferences.excludeKeywords);

      const freshnessScore = computeFreshnessScore(item.createdAt, now);
      const engagementScore = computeEngagementScore(item.engagementScore);
      const keywordScore = getKeywordScore(includeMatches, preferences.includeKeywords);
      const communityScore = getCommunityScore(
        item.communityId,
        favoriteCommunities,
        joinedCommunityIds,
      );

      const weightedScore =
        freshnessScore * normalizedWeights.freshness +
        engagementScore * normalizedWeights.engagement +
        keywordScore * normalizedWeights.keywords +
        communityScore * normalizedWeights.community;

      const includePenalty =
        preferences.includeKeywords.length > 0 && includeMatches.length === 0
          ? DEFAULT_INCLUDE_MISS_PENALTY
          : 1;

      const excludeDemotion = getExcludeDemotionMultiplier(excludeMatches.length);
      const score = weightedScore * includePenalty * excludeDemotion;

      return {
        id: item.id,
        createdAt: item.createdAt,
        score,
        includeMatches,
        excludeMatches,
        demoted: excludeMatches.length > 0,
      };
    });

  ranked.sort((a, b) => b.score - a.score || b.createdAt - a.createdAt);
  return ranked;
}
