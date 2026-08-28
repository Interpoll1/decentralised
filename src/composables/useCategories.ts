/**
 * useCategories.ts
 *
 * Single source of truth for:
 *  - Updated category list (matching new backend schema)
 *  - Tag-based feed filtering (user history driven)
 *  - User history tracking (decaying weights stored in localStorage)
 *  - Trending tags fetched from relay
 */

import { ref, computed, readonly } from 'vue';
import {
  tvOutline, musicalNotesOutline, starOutline, bookOutline,
  helpCircleOutline, chatbubblesOutline, businessOutline, codeSlashOutline,
  flaskOutline, cashOutline, heartOutline, trophyOutline, leafOutline,
  schoolOutline, logoBitcoin, gameControllerOutline, happyOutline,
  megaphoneOutline, newspaperOutline,
} from 'ionicons/icons';
import config from '../config';

// ─── Category definition ──────────────────────────────────────────────────────

export interface CategoryDef {
  id:     string;
  label:  string;
  icon:   string;
  tone:   string;
}

/** Complete updated category list — matches backend schema */
export const ALL_CATEGORIES: CategoryDef[] = [
  { id: 'politics',    label: 'Politics',    icon: businessOutline,      tone: 'politics'    },
  { id: 'technology',  label: 'Technology',  icon: codeSlashOutline,     tone: 'technology'  },
  { id: 'science',     label: 'Science',     icon: flaskOutline,         tone: 'science'     },
  { id: 'finance',     label: 'Finance',     icon: cashOutline,          tone: 'finance'     },
  { id: 'health',      label: 'Health',      icon: heartOutline,         tone: 'health'      },
  { id: 'sports',      label: 'Sports',      icon: trophyOutline,        tone: 'sports'      },
  { id: 'environment', label: 'Environment', icon: leafOutline,          tone: 'environment' },
  { id: 'education',   label: 'Education',   icon: schoolOutline,        tone: 'education'   },
  { id: 'crypto',      label: 'Crypto',      icon: logoBitcoin,          tone: 'crypto'      },
  { id: 'gaming',      label: 'Gaming',      icon: gameControllerOutline,tone: 'gaming'      },
  { id: 'opinion',     label: 'Opinion',     icon: chatbubblesOutline,   tone: 'opinion'     },
  { id: 'humour',      label: 'Humour',      icon: happyOutline,         tone: 'humour'      },
  { id: 'movies-tv',   label: 'Movies & TV', icon: tvOutline,            tone: 'movies-tv'   },
  { id: 'music',       label: 'Music',       icon: musicalNotesOutline,  tone: 'music'       },
  { id: 'celebrity',   label: 'Celebrity',   icon: starOutline,          tone: 'celebrity'   },
  { id: 'story',       label: 'Story',       icon: bookOutline,          tone: 'story'       },
  { id: 'ask',         label: 'Ask',         icon: helpCircleOutline,    tone: 'ask'         },
  { id: 'discussion',  label: 'Discussion',  icon: megaphoneOutline,     tone: 'discussion'  },
  { id: 'news',        label: 'News',        icon: newspaperOutline,     tone: 'news'        },
];

/** Quick lookup map */
export const CATEGORY_MAP = new Map(ALL_CATEGORIES.map(c => [c.id, c]));

/** Top 8 categories shown as horizontal chips in the feed bar */
export const FEED_BAR_CATEGORIES = ALL_CATEGORIES.slice(0, 8);

// ─── User history ─────────────────────────────────────────────────────────────

const HISTORY_KEY   = 'interpoll_feed_prefs';
const DECAY_RATE    = 0.95;   // multiply category weights by this each day
const MAX_TAGS      = 20;

interface FeedPrefs {
  categoryWeights: Record<string, number>;
  recentTags:      string[];
  lastDecay:       number; // Unix ms
}

function loadPrefs(): FeedPrefs {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (raw) return JSON.parse(raw) as FeedPrefs;
  } catch { /* corrupt — reset */ }
  return { categoryWeights: {}, recentTags: [], lastDecay: Date.now() };
}

function savePrefs(p: FeedPrefs) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(p)); } catch { /* storage full */ }
}

function applyDailyDecay(p: FeedPrefs): FeedPrefs {
  const days = (Date.now() - p.lastDecay) / 86_400_000;
  if (days < 1) return p;
  const factor = Math.pow(DECAY_RATE, Math.floor(days));
  const w: Record<string, number> = {};
  for (const [cat, weight] of Object.entries(p.categoryWeights)) {
    const decayed = weight * factor;
    if (decayed > 0.01) w[cat] = decayed; // prune near-zero
  }
  return { ...p, categoryWeights: w, lastDecay: Date.now() };
}

// ─── Composable ───────────────────────────────────────────────────────────────

const trendingTags  = ref<Array<{ tag: string; count: number }>>([]);
const trendingLoaded = ref(false);

export function useCategories() {
  const prefs = ref<FeedPrefs>(applyDailyDecay(loadPrefs()));

  /** Top 3 category IDs by weight — used for personalised feed requests */
  const topCategories = computed(() =>
    Object.entries(prefs.value.categoryWeights)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([id]) => id)
  );

  /** Recent tags the user has engaged with */
  const recentTags = computed(() => prefs.value.recentTags);

  /**
   * Record engagement with a post/poll.
   * Call this when a user clicks, votes, or spends >3s on an item.
   */
  function recordEngagement(categoryId: string | undefined, tags: string[] = []) {
    const p = { ...prefs.value };

    // Category weight
    if (categoryId && CATEGORY_MAP.has(categoryId)) {
      p.categoryWeights[categoryId] = (p.categoryWeights[categoryId] ?? 0) + 1;
    }

    // Recent tags (deduplicate, cap at MAX_TAGS)
    if (tags.length) {
      const existing = new Set(p.recentTags);
      for (const t of tags) {
        if (t) existing.delete(t); // move to front
      }
      p.recentTags = [...tags.filter(Boolean), ...p.recentTags].slice(0, MAX_TAGS);
    }

    prefs.value = p;
    savePrefs(p);
  }

  /**
   * Whether a tag is in the user's recent history — used to highlight chips.
   */
  function isUserTag(tag: string): boolean {
    return prefs.value.recentTags.includes(tag);
  }

  /**
   * Load trending tags from the relay API (cached per session).
   */
  async function loadTrendingTags(window: '24h' | '7d' = '7d') {
    if (trendingLoaded.value) return;
    try {
      const res = await fetch(`${config.relay.api}/api/tags/trending?limit=10&window=${window}`);
      if (!res.ok) return;
      const json = await res.json();
      trendingTags.value = json.tags || [];
      trendingLoaded.value = true;
    } catch { /* non-fatal */ }
  }

  /**
   * Build query params for the personalised feed endpoint.
   */
  function personalisedFeedParams(): Record<string, string> {
    const cats = topCategories.value;
    const tags = prefs.value.recentTags.slice(0, 8);
    const params: Record<string, string> = {};
    if (cats.length) params.categories = cats.join(',');
    if (tags.length) params.tags        = tags.join(',');
    return params;
  }

  return {
    ALL_CATEGORIES,
    FEED_BAR_CATEGORIES,
    CATEGORY_MAP,
    topCategories,
    recentTags,
    trendingTags: readonly(trendingTags),
    recordEngagement,
    isUserTag,
    loadTrendingTags,
    personalisedFeedParams,
  };
}
