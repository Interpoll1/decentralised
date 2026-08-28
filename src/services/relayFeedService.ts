/**
 * relayFeedService.ts
 *
 * REST-first cold-start feed loader.
 *
 * Contract:
 *   1. fetchFeedPage()  → interleaved posts+polls from MySQL, < 200 ms
 *   2. fetchPostsPage() → posts only (used by postStore.loadPostsForCommunity)
 *   3. fetchPollsPage() → polls only (used by pollStore.loadPollsForCommunity)
 *   4. fetchCommentCounts() → batch endpoint; returns index-derived counts for
 *      up to 50 IDs in one round-trip — no LWW race, no N individual Gun reads
 *
 * All functions fall back to empty/null on any error so callers can
 * silently degrade to Gun-only mode when the relay is unreachable.
 */

import config from '../config';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface FeedPost {
  id: string;
  communityId: string;
  authorId: string;
  authorName: string;
  authorShowRealName: boolean;
  title: string;
  content: string;
  imageIPFS: string;
  imageThumbnail: string;
  createdAt: number;
  upvotes: number;
  downvotes: number;
  score: number;
  commentCount: number;
  isEncrypted: boolean;
  category: string | null;
  tags: string | null;
  sentiment: string | null;
  nsfw: boolean;
  dataVersion: string;
}

export interface FeedPollOption {
  id: string;
  text: string;
  votes: number;
  voters: never[];
}

export interface FeedPoll {
  id: string;
  communityId: string;
  authorId: string;
  authorName: string;
  question: string;
  description: string;
  options: FeedPollOption[];
  createdAt: number;
  expiresAt: number;
  allowMultipleChoices: boolean;
  showResultsBeforeVoting: boolean;
  requireLogin: boolean;
  isPrivate: boolean;
  totalVotes: number;
  isExpired: boolean;
  isEncrypted: boolean;
  category: string | null;
  tags: string | null;
  dataVersion: string;
}

export type FeedItem =
  | { type: 'post'; createdAt: number; data: FeedPost }
  | { type: 'poll'; createdAt: number; data: FeedPoll };

export interface FeedPage {
  items: FeedItem[];
  hasMore: boolean;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function apiBase(): string {
  return config.relay.api;
}

const FETCH_TIMEOUT_MS = 8_000;

function fetchWithTimeout(url: string, ms = FETCH_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer));
}

// ─── Combined feed ────────────────────────────────────────────────────────────

export interface FeedOptions {
  /** Comma-separated community IDs. Empty = global feed. */
  communityIds?: string;
  /** Cursor: only items with createdAt < before. */
  before?: number;
  /** Page size 1–50. Default 20. */
  limit?: number;
  dataVersion?: 'v3' | 'v2';
}

export async function fetchFeedPage(opts: FeedOptions = {}): Promise<FeedPage> {
  const params = new URLSearchParams();
  if (opts.communityIds) params.set('communityIds', opts.communityIds);
  if (opts.before && opts.before > 0) params.set('before', String(opts.before));
  if (opts.limit) params.set('limit', String(opts.limit));
  if (opts.dataVersion) params.set('dataVersion', opts.dataVersion);
  try {
    const res = await fetchWithTimeout(`${apiBase()}/api/feed?${params}`);
    if (!res.ok) return { items: [], hasMore: false };
    const json = await res.json();
    return {
      items: Array.isArray(json?.items) ? (json.items as FeedItem[]) : [],
      hasMore: !!json.hasMore,
    };
  } catch {
    return { items: [], hasMore: false };
  }
}

// ─── Posts only ───────────────────────────────────────────────────────────────

export interface PostsOptions {
  communityId?: string;
  before?: number;
  limit?: number;
  dataVersion?: 'v3' | 'v2';
}

export async function fetchPostsPage(
  opts: PostsOptions = {},
): Promise<{ posts: FeedPost[]; hasMore: boolean }> {
  const params = new URLSearchParams();
  if (opts.communityId) params.set('communityId', opts.communityId);
  if (opts.before && opts.before > 0) params.set('before', String(opts.before));
  if (opts.limit) params.set('limit', String(opts.limit));
  if (opts.dataVersion) params.set('dataVersion', opts.dataVersion);
  try {
    const res = await fetchWithTimeout(`${apiBase()}/api/posts?${params}`);
    if (!res.ok) return { posts: [], hasMore: false };
    const json = await res.json();
    return {
      posts: Array.isArray(json?.posts) ? (json.posts as FeedPost[]) : [],
      hasMore: !!json.hasMore,
    };
  } catch {
    return { posts: [], hasMore: false };
  }
}

// ─── Polls only ───────────────────────────────────────────────────────────────

export interface PollsOptions {
  communityId?: string;
  before?: number;
  limit?: number;
  dataVersion?: 'v3' | 'v2';
}

export async function fetchPollsPage(
  opts: PollsOptions = {},
): Promise<{ polls: FeedPoll[]; hasMore: boolean }> {
  const params = new URLSearchParams();
  if (opts.communityId) params.set('communityId', opts.communityId);
  if (opts.before && opts.before > 0) params.set('before', String(opts.before));
  if (opts.limit) params.set('limit', String(opts.limit));
  if (opts.dataVersion) params.set('dataVersion', opts.dataVersion);
  try {
    const res = await fetchWithTimeout(`${apiBase()}/api/polls?${params}`);
    if (!res.ok) return { polls: [], hasMore: false };
    const json = await res.json();
    return {
      polls: Array.isArray(json?.polls) ? (json.polls as FeedPoll[]) : [],
      hasMore: !!json.hasMore,
    };
  } catch {
    return { polls: [], hasMore: false };
  }
}

// ─── Comment counts (batch) ───────────────────────────────────────────────────

/**
 * Fetch accurate comment counts for up to 50 post/poll IDs in one HTTP call.
 *
 * The relay derives counts from the comment INDEX (soul child count) rather
 * than the mutable `commentCount` field on the post node, which suffers from
 * concurrent-write LWW races. Use this to overwrite feed-card counts after
 * the REST snapshot loads.
 */
export async function fetchCommentCounts(
  ids: string[],
): Promise<Record<string, number>> {
  if (ids.length === 0) return {};
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 50) chunks.push(ids.slice(i, i + 50));
  const results: Record<string, number> = {};
  await Promise.all(
    chunks.map(async (chunk) => {
      try {
        const res = await fetchWithTimeout(
          `${apiBase()}/api/comment-counts?ids=${encodeURIComponent(chunk.join(','))}`,
          5_000,
        );
        if (!res.ok) return;
        const json = await res.json();
        if (json?.counts && typeof json.counts === 'object') {
          Object.assign(results, json.counts);
        }
      } catch {
        // non-fatal — feed still renders with Gun-stored counts
      }
    }),
  );
  return results;
}

export interface PostTallyResult {
  upvotes: number;
  downvotes: number;
  score: number;
}

/**
 * Fetch authoritative vote tallies for a batch of post/poll IDs from the
 * relay's /api/vote-tally endpoint. The relay derives counts from postVotes
 * children in gun_nodes rather than the mutable upvotes/downvotes field on the
 * post node (which goes stale after refresh due to Gun LWW races).
 */
export async function fetchVoteTallies(
  ids: string[],
): Promise<Record<string, PostTallyResult>> {
  if (ids.length === 0) return {};
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 50) chunks.push(ids.slice(i, i + 50));
  const results: Record<string, PostTallyResult> = {};
  await Promise.all(
    chunks.map(async (chunk) => {
      try {
        const res = await fetchWithTimeout(
          `${apiBase()}/api/vote-tally?ids=${encodeURIComponent(chunk.join(','))}`,
          5_000,
        );
        if (!res.ok) return;
        const json = await res.json();
        if (json?.tallies && typeof json.tallies === 'object') {
          Object.assign(results, json.tallies);
        }
      } catch {
        // non-fatal — store falls back to Gun-stored counts
      }
    }),
  );
  return results;
}