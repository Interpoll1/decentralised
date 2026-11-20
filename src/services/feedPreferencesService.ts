import { ref } from 'vue';

const STORAGE_KEY = 'interpoll_feed_preferences';
const STORAGE_VERSION = 1;

export type FeedMode = 'latest' | 'for-you';

export interface FeedRankingWeights {
  freshness: number;
  engagement: number;
  keywords: number;
  community: number;
}

export interface FeedPreferences {
  mode: FeedMode;
  includeKeywords: string[];
  excludeKeywords: string[];
  mutedCommunities: string[];
  favoriteCommunities: string[]
  showPosts: boolean;
  showPolls: boolean;
  rankingWeights: FeedRankingWeights;
  /** Categories the user has explicitly followed or auto-followed via engagement */
  followedCategories: string[];
  /** Categories the user has hidden from their feed */
  hiddenCategories: string[];
  /** Tag → engagement count; used for personalised ranking */
  engagedTags: Record<string, number>;
  /** Whether to show NSFW-flagged posts */
  showNsfw: boolean;
}

interface PersistedFeedPreferences extends Partial<FeedPreferences> {
  version?: number;
}

type FeedPreferencesUpdate = Omit<Partial<FeedPreferences>, 'rankingWeights'> & {
  rankingWeights?: Partial<FeedRankingWeights>;
};

const DEFAULT_RANKING_WEIGHTS: FeedRankingWeights = {
  freshness: 0.4,
  engagement: 0.25,
  keywords: 0.25,
  community: 0.1,
};

const DEFAULT_PREFERENCES: FeedPreferences = {
  mode: 'latest',
  includeKeywords: [],
  excludeKeywords: [],
  mutedCommunities: [],
  favoriteCommunities: [],
  showPosts: true,
  showPolls: true,
  rankingWeights: { ...DEFAULT_RANKING_WEIGHTS },
  followedCategories: [],
  hiddenCategories: [],
  engagedTags: {},
  showNsfw: false,
};

export const feedPreferencesVersion = ref(0);

function normalizeKeywordTerm(term: string): string {
  return term.toLowerCase().trim().replace(/\s+/g, ' ');
}

function normalizeKeywordList(list: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const term of list) {
    const clean = normalizeKeywordTerm(term);
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    normalized.push(clean);
  }

  return normalized;
}

function normalizeCommunityList(list: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const communityId of list) {
    const clean = communityId.trim();
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    normalized.push(clean);
  }

  return normalized;
}

function clampWeight(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || Number.isNaN(value) || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(1, Math.max(0, value));
}

function sanitizeRankingWeights(weights?: Partial<FeedRankingWeights>): FeedRankingWeights {
  const merged: FeedRankingWeights = {
    freshness: clampWeight(weights?.freshness, DEFAULT_RANKING_WEIGHTS.freshness),
    engagement: clampWeight(weights?.engagement, DEFAULT_RANKING_WEIGHTS.engagement),
    keywords: clampWeight(weights?.keywords, DEFAULT_RANKING_WEIGHTS.keywords),
    community: clampWeight(weights?.community, DEFAULT_RANKING_WEIGHTS.community),
  };

  const total = merged.freshness + merged.engagement + merged.keywords + merged.community;
  if (total <= 0) {
    return { ...DEFAULT_RANKING_WEIGHTS };
  }

  return merged;
}

function clonePreferences(preferences: FeedPreferences): FeedPreferences {
  return {
    ...preferences,
    includeKeywords: [...preferences.includeKeywords],
    excludeKeywords: [...preferences.excludeKeywords],
    mutedCommunities: [...preferences.mutedCommunities],
    favoriteCommunities: [...preferences.favoriteCommunities],
    rankingWeights: { ...preferences.rankingWeights },
  };
}

function sanitizePreferences(raw: Partial<FeedPreferences>): FeedPreferences {
  const mode: FeedMode = raw.mode === 'for-you' ? 'for-you' : 'latest';

  const includeKeywords = normalizeKeywordList(raw.includeKeywords ?? []);
  const excludeKeywords = normalizeKeywordList(raw.excludeKeywords ?? []);
  const mutedCommunities = normalizeCommunityList(raw.mutedCommunities ?? []);
  const mutedSet = new Set(mutedCommunities);
  const favoriteCommunities = normalizeCommunityList(raw.favoriteCommunities ?? []).filter(
    (communityId) => !mutedSet.has(communityId),
  );

  let showPosts = raw.showPosts !== false;
  let showPolls = raw.showPolls !== false;
  if (!showPosts && !showPolls) {
    showPosts = true;
  }

  return {
    mode,
    includeKeywords,
    excludeKeywords,
    mutedCommunities,
    favoriteCommunities,
    showPosts,
    showPolls,
    rankingWeights: sanitizeRankingWeights(raw.rankingWeights),
    followedCategories: Array.isArray(raw.followedCategories)
      ? raw.followedCategories.filter((c): c is string => typeof c === 'string' && !!c)
      : [],
    hiddenCategories: Array.isArray(raw.hiddenCategories)
      ? raw.hiddenCategories.filter((c): c is string => typeof c === 'string' && !!c)
      : [],
    engagedTags: (raw.engagedTags && typeof raw.engagedTags === 'object' && !Array.isArray(raw.engagedTags))
      ? Object.fromEntries(
          Object.entries(raw.engagedTags as Record<string, unknown>)
            .filter(([k, v]) => typeof k === 'string' && typeof v === 'number')
            .map(([k, v]) => [k, v as number]),
        )
      : {},
    showNsfw: raw.showNsfw === true,
  };
}

export class FeedPreferencesService {
  private static preferences: FeedPreferences | null = null;

  static getDefaultPreferences(): FeedPreferences {
    return clonePreferences(DEFAULT_PREFERENCES);
  }

  static getPreferences(): FeedPreferences {
    if (!this.preferences) {
      this.preferences = this.loadFromStorage();
    }

    return clonePreferences(this.preferences);
  }

  static savePreferences(partial: FeedPreferencesUpdate): FeedPreferences {
    const current = this.getPreferences();
    const merged: Partial<FeedPreferences> = {
      ...current,
      ...partial,
      rankingWeights: {
        ...current.rankingWeights,
        ...(partial.rankingWeights ?? {}),
      },
    };

    const next = sanitizePreferences(merged);
    this.saveToStorage(next);
    return clonePreferences(next);
  }

  /**
   * Record an engagement event (upvote, long-read, share) for a post.
   * Increments tag scores and auto-follows the post's category after 3 engagements.
   * Safe to call fire-and-forget; never throws.
   */
  static trackEngagement(post: { category?: string; tags?: string[] }): void {
    try {
      const prefs = this.getPreferences();
      let changed = false;

      // ── Category auto-follow ─────────────────────────────────────────────────
      if (post.category && !prefs.followedCategories.includes(post.category)) {
        const key = `cat_engage_${post.category}`;
        const count = parseInt(localStorage.getItem(key) || '0', 10) + 1;
        localStorage.setItem(key, String(count));
        if (count >= 3) {
          prefs.followedCategories.push(post.category);
          changed = true;
        }
      }

      // ── Tag engagement scoring ───────────────────────────────────────────────
      if (post.tags && post.tags.length > 0) {
        for (const tag of post.tags) {
          if (tag && typeof tag === 'string') {
            prefs.engagedTags[tag] = (prefs.engagedTags[tag] || 0) + 1;
          }
        }
        changed = true;
      }

      if (changed) this.savePreferences(prefs);
    } catch {
      // Non-fatal — engagement tracking should never break a user action
    }
  }

  static setMode(mode: FeedMode): FeedPreferences {    return this.savePreferences({ mode });
  }

  static setContentTypeVisibility(showPosts: boolean, showPolls: boolean): FeedPreferences {
    return this.savePreferences({ showPosts, showPolls });
  }

  static setRankingWeights(rankingWeights: Partial<FeedRankingWeights>): FeedPreferences {
    return this.savePreferences({ rankingWeights });
  }

  static addIncludeKeyword(term: string): FeedPreferences {
    const clean = normalizeKeywordTerm(term);
    if (!clean) return this.getPreferences();

    const current = this.getPreferences();
    if (current.includeKeywords.includes(clean)) return current;

    return this.savePreferences({
      includeKeywords: [...current.includeKeywords, clean],
      excludeKeywords: current.excludeKeywords.filter((keyword) => keyword !== clean),
    });
  }

  static removeIncludeKeyword(term: string): FeedPreferences {
    const clean = normalizeKeywordTerm(term);
    const current = this.getPreferences();
    return this.savePreferences({
      includeKeywords: current.includeKeywords.filter((keyword) => keyword !== clean),
    });
  }

  static addExcludeKeyword(term: string): FeedPreferences {
    const clean = normalizeKeywordTerm(term);
    if (!clean) return this.getPreferences();

    const current = this.getPreferences();
    if (current.excludeKeywords.includes(clean)) return current;

    return this.savePreferences({
      excludeKeywords: [...current.excludeKeywords, clean],
      includeKeywords: current.includeKeywords.filter((keyword) => keyword !== clean),
    });
  }

  static removeExcludeKeyword(term: string): FeedPreferences {
    const clean = normalizeKeywordTerm(term);
    const current = this.getPreferences();
    return this.savePreferences({
      excludeKeywords: current.excludeKeywords.filter((keyword) => keyword !== clean),
    });
  }

  static toggleMutedCommunity(communityId: string): FeedPreferences {
    const clean = communityId.trim();
    if (!clean) return this.getPreferences();

    const current = this.getPreferences();
    const isMuted = current.mutedCommunities.includes(clean);

    if (isMuted) {
      return this.savePreferences({
        mutedCommunities: current.mutedCommunities.filter((id) => id !== clean),
      });
    }

    return this.savePreferences({
      mutedCommunities: [...current.mutedCommunities, clean],
      favoriteCommunities: current.favoriteCommunities.filter((id) => id !== clean),
    });
  }

  static toggleFavoriteCommunity(communityId: string): FeedPreferences {
    const clean = communityId.trim();
    if (!clean) return this.getPreferences();

    const current = this.getPreferences();
    const isFavorite = current.favoriteCommunities.includes(clean);

    if (isFavorite) {
      return this.savePreferences({
        favoriteCommunities: current.favoriteCommunities.filter((id) => id !== clean),
      });
    }

    return this.savePreferences({
      favoriteCommunities: [...current.favoriteCommunities, clean],
      mutedCommunities: current.mutedCommunities.filter((id) => id !== clean),
    });
  }

  static resetPreferences(): FeedPreferences {
    this.saveToStorage(this.getDefaultPreferences());
    return this.getPreferences();
  }

  private static loadFromStorage(): FeedPreferences {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return this.getDefaultPreferences();
      }

      const parsed = JSON.parse(raw) as PersistedFeedPreferences;
      const merged: Partial<FeedPreferences> = {
        ...DEFAULT_PREFERENCES,
        ...parsed,
        rankingWeights: {
          ...DEFAULT_PREFERENCES.rankingWeights,
          ...(parsed.rankingWeights ?? {}),
        },
      };

      if (parsed.version !== STORAGE_VERSION) {
        const migrated = sanitizePreferences(merged);
        this.saveToStorage(migrated);
        return migrated;
      }

      return sanitizePreferences(merged);
    } catch (error) {
      console.warn('[FeedPreferencesService] Failed to load preferences, using defaults:', error);
      return this.getDefaultPreferences();
    }
  }

  private static saveToStorage(next: FeedPreferences) {
    this.preferences = sanitizePreferences(next);

    const payload: PersistedFeedPreferences = {
      version: STORAGE_VERSION,
      ...this.preferences,
    };

    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    feedPreferencesVersion.value++;
  }
}
