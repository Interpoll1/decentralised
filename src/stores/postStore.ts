// src/stores/postStore.ts
import { defineStore } from 'pinia';
import { ref, computed, shallowRef, triggerRef, watchEffect } from 'vue';
import { Post, PostService } from '../services/postService';
import type { PostTally } from '../services/postVoteService';
import { UserService } from '../services/userService';
import { EventService } from '../services/eventService';
import { BroadcastService } from '../services/broadcastService';
import { WebSocketService } from '../services/websocketService';
import { useChainStore } from './chainStore';
import { generatePseudonym } from '../utils/pseudonym';
import { enabledVersions, type DataVersion } from '../utils/dataVersionSettings';
import { GUN_NAMESPACE } from '../services/gunService';
import { BoundedMap } from '../utils/boundedMap';
// relayFeedService imports removed from store — REST warmup lives in dbWarmup.ts

const PAGE_SIZE      = 10;
const SEEN_POSTS_KEY = 'seen-post-ids';
const MY_VOTES_KEY   = 'my-post-votes-v1';
const POST_DEBUG = localStorage.getItem('interpoll_post_debug') === 'true';
const SYNC_DEBUG = localStorage.getItem('interpoll_sync_debug') === 'true';
const INCOMING_POST_FLUSH_MS = 50;
const INCOMING_POST_BATCH_SIZE = 100;

// Timestamp when this app session started.
// Gun re-delivers ALL posts on every reconnect — we only treat a post
// as "new" if its createdAt is after this timestamp.
const APP_START_TIME = Date.now();

function loadSeenIds(): Set<string> {
  try {
    const stored = localStorage.getItem(SEEN_POSTS_KEY);
    return stored ? new Set(JSON.parse(stored)) : new Set();
  } catch { return new Set(); }
}

function saveSeenIds(ids: Set<string>) {
  try {
    const arr = Array.from(ids).slice(-500);
    localStorage.setItem(SEEN_POSTS_KEY, JSON.stringify(arr));
  } catch {}
}

/**
 * Load this user's votes, migrating the two legacy sets written by each view.
 *
 * `upvoted-posts` / `downvoted-posts` were maintained independently by
 * HomePage, CommunityPage and PostDetailPage, and were treated as the authority
 * on whether a click meant "vote" or "unvote" — while the service decided the
 * same question from the graph. When the two disagreed the vote inverted. This
 * store now holds the state, and the graph corrects it.
 */
function loadMyVotes(): Map<string, 'up' | 'down'> {
  const votes = new Map<string, 'up' | 'down'>();
  try {
    const stored = localStorage.getItem(MY_VOTES_KEY);
    if (stored) {
      for (const [id, vote] of Object.entries(JSON.parse(stored) as Record<string, 'up' | 'down'>)) {
        if (vote === 'up' || vote === 'down') votes.set(id, vote);
      }
      return votes;
    }
    for (const [key, vote] of [['upvoted-posts', 'up'], ['downvoted-posts', 'down']] as const) {
      const legacy = localStorage.getItem(key);
      if (!legacy) continue;
      for (const id of JSON.parse(legacy) as string[]) votes.set(id, vote);
    }
  } catch { /* unreadable cache — the graph is the authority anyway */ }
  return votes;
}

function saveMyVotes(votes: Map<string, 'up' | 'down'>) {
  try {
    localStorage.setItem(MY_VOTES_KEY, JSON.stringify(Object.fromEntries(votes)));
  } catch { /* quota — non-fatal, this is only a paint hint */ }
}

function postDebug(label: string, data?: Record<string, unknown>) {
  if (!POST_DEBUG) return;
  if (data) console.log(`[PostStoreDebug] ${label}`, data);
  else console.log(`[PostStoreDebug] ${label}`);
}

function createRateLogger(label: string, snapshot?: () => Record<string, unknown>) {
  let windowStart = Date.now();
  let count = 0;
  return (delta = 1) => {
    if (!SYNC_DEBUG) return;
    count += delta;
    const now = Date.now();
    if (now - windowStart < 1000) return;
    const payload = snapshot ? snapshot() : {};
    console.warn(`[SyncRate] ${label}`, { eventsPerSec: count, ...payload });
    windowStart = now;
    count = 0;
  };
}

export const usePostStore = defineStore('post', () => {
  // Listen for eviction signals and purge legacy posts from the store
  if (typeof window !== 'undefined') {
    window.addEventListener('evict-legacy-posts', (ev: any) => {
      const ns = ev?.detail?.namespace || null;
      if (!ns) return;
      const keysToDelete: string[] = [];
      for (const [id, p] of postsMap.value.entries()) {
        const dv = (p as any).dataVersion || null;
        if (dv && dv !== ns) keysToDelete.push(id);
      }
      for (const k of keysToDelete) postsMap.value.delete(k);
      console.info(`[PostStore] Evicted ${keysToDelete.length} legacy posts (namespace filter ${ns})`);
    });
  }

  // shallowRef instead of ref: Vue only tracks the Map reference, not every
  // nested Post object. This means tally patches via postsMap.value.set() do
  // NOT cause a full sortedPosts recompute on their own — we call triggerRef()
  // selectively from setTally/setCommentCount when sort order might change.
  const postsMap = shallowRef<Map<string, Post>>(new Map());
  const currentPost        = ref<Post | null>(null);
  const isLoading          = ref(false);
  const currentFeed        = ref<'all' | 'community'>('all');
  const currentCommunityId = ref<string | null>(null);
  const visibleCount       = ref(PAGE_SIZE);
  const initialLoadDone    = ref(false);

  // No more banner — kept for backward compat
  const pendingNewPosts = ref<Post[]>([]);
  const newPostCount    = computed(() => 0);

  const seenPostIds = loadSeenIds();
  const subscribedCommunities = new Set<string>();
  const unsubscribers = new Map<string, () => void>();
  // Per-community initial load tracking: ensures no cross-community misclassification
  const communityInitialLoadDone = new Map<string, boolean>();
  const communityArrivalCounts = new Map<string, number>();
  const pendingPostsByCommunity = new Map<string, Map<string, Post>>();
  let pendingPostsFlushTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * postId → counts derived from the per-user vote set (`PostVoteService`).
   *
   * The counters carried on a post node are an advisory mirror: any peer can
   * echo a pre-vote snapshot of them at any time. Once we have derived a tally
   * for a post it outranks every such echo, permanently — which is why the old
   * 15-second "grace window" that shielded a fresh vote (and then let a late
   * echo revert it on screen) is gone.
   */
  // Bounded like the other long-lived caches here. Eviction only costs a post
  // its overlay, after which it falls back to the advisory counters — the same
  // state it starts in.
  const tallies = new BoundedMap<string, PostTally>({ maxSize: 1000 });

  /**
   * Derived comment counts from the relay's comment index (not the mutable
   * commentCount Gun field which suffers LWW concurrent-write races). Once a
   * count lands here it permanently outranks any Gun echo of the post node —
   * same protection pattern as tallies.
   */
  const knownCommentCounts = new BoundedMap<string, number>({ maxSize: 1000 });

  /**
   * Update the stored comment count for a post and patch it into the store map
   * immediately so feed cards refresh without waiting for a Gun echo.
   */
  function setCommentCount(postId: string, count: number): void {
    knownCommentCounts.set(postId, count);
    const existing = postsMap.value.get(postId);
    if (existing) {
      postsMap.value.set(postId, { ...existing, commentCount: count });
      // Comment count doesn't affect sort order — no triggerRef needed here.
      // The card will update because currentPost is a separate ref.
    }
    if (currentPost.value?.id === postId) {
      currentPost.value = { ...currentPost.value, commentCount: count };
    }
  }

  /** postId → this user's vote, as last confirmed by the graph. */
  const myVotes = ref(loadMyVotes());

  /**
   * Overlay the derived tally AND the index-derived comment count onto an
   * incoming post. Both outrank Gun echoes of the mutable fields.
   */
  function withKnownTally(incoming: Post): Post {
    let post: Post = incoming;
    const tally = tallies.get(incoming.id);
    if (tally) post = { ...post, ...tally };
    const count = knownCommentCounts.get(incoming.id);
    if (count !== undefined) post = { ...post, commentCount: count };
    return post;
  }

  function setTally(postId: string, tally: PostTally) {
    tallies.set(postId, tally);
    const existing = postsMap.value.get(postId);
    if (existing) {
      const scoreChanged = existing.score !== tally.score;
      postsMap.value.set(postId, { ...existing, ...tally });
      // Only notify sorted computed when score changes — otherwise the upvote
      // counter update on a single card was triggering a full feed re-sort.
      if (scoreChanged) triggerRef(postsMap);
    }
    if (currentPost.value?.id === postId) {
      currentPost.value = { ...currentPost.value, ...tally };
    }
  }
  const getPendingIncomingPostCount = () => {
    let total = 0;
    for (const queue of pendingPostsByCommunity.values()) total += queue.size;
    return total;
  };
  const logIncomingPostRate = createRateLogger('post-incoming', () => ({
    queueDepth: getPendingIncomingPostCount(),
    subscribedCommunities: subscribedCommunities.size,
    postsInStore: postsMap.value.size,
  }));
  const logPostFlushRate = createRateLogger('post-flush', () => ({
    queueDepth: getPendingIncomingPostCount(),
  }));

  function handlePostSyncUpdate(incomingPost: Post) {
    if (!incomingPost?.id) return;
    const communityId = incomingPost.communityId || currentCommunityId.value || '';
    processIncomingPost(communityId, incomingPost);
  }

  function broadcastPostUpdate(updatedPost: Post) {
    BroadcastService.broadcast('post-updated', updatedPost);
    void WebSocketService.broadcast('post-updated', updatedPost);
  }

  BroadcastService.subscribe('post-updated', handlePostSyncUpdate);
  WebSocketService.subscribe('post-updated', handlePostSyncUpdate);

  /**
   * A derived tally from another tab of this browser.
   *
   * Sent on its own channel rather than riding the counters in `post-updated`:
   * that message also carries plain Gun echoes from remote peers, whose counter
   * fields are exactly the forgeable, stale values the tally exists to outrank.
   * Only a tab running this code sends `post-vote-tally`, so it can be trusted.
   */
  BroadcastService.subscribe('post-vote-tally', (payload: { postId?: string; tally?: PostTally }) => {
    if (!payload?.postId || !payload.tally) return;
    setTally(payload.postId, payload.tally);
  });

  /** Attempt to decrypt an encrypted post and update the store */
  function tryDecryptPost(post: Post) {
    if (!post.isEncrypted || !post.encryptedContent) return;
    PostService.decryptPost(post).then(decrypted => {
      if (decrypted !== post && postsMap.value.get(post.id) === post) {
        postsMap.value.set(post.id, decrypted);
        if (currentPost.value?.id === post.id) {
          currentPost.value = decrypted;
        }
      }
    }).catch(() => { /* no key or decryption failed — keep encrypted version */ });
  }

  function processIncomingPost(communityId: string, post: Post) {
    // Avoid accepting legacy posts into a v3 client.
    // Exception: category-only patches ({category, tags, nsfw} with no title)
    // are synthetic objects built in postService with dataVersion already injected —
    // but for safety we also allow them through if the post already exists in store
    // (it's an update to a post we already accepted, not a new foreign-namespace post).
    const namespaceVersion = Number.parseInt(GUN_NAMESPACE.replace(/^v/i, ''), 10) || 0;
    const postDataVersion = (post as any).dataVersion || null;
    const isCategoryPatch = !!(post as any).category && !(post as any).title;
    const alreadyInStore  = postsMap.value.has(post.id);
    // Allow through if: correct namespace, OR it's a category patch for a known post
    if (!isCategoryPatch || !alreadyInStore) {
      if (postDataVersion && postDataVersion !== GUN_NAMESPACE) return;
      if (!postDataVersion && namespaceVersion >= 3) return;
    }

    // Always update existing posts in-place (vote counts, edits, category patches)
    if (alreadyInStore) {
      const existing = postsMap.value.get(post.id)!;
      // For category patches, merge only the new fields onto the existing post
      let merged: Post;
      if (isCategoryPatch) {
        merged = { ...existing, category: (post as any).category, tags: (post as any).tags, nsfw: (post as any).nsfw };
      } else {
        // Gun delivers post fields asynchronously — videoCID and other media
        // fields often arrive in a later peer-sync update than title/content.
        // If the incoming post is missing these fields but the stored post has
        // them (or vice-versa), preserve whichever side has the data so a
        // partial Gun delivery never silently clears fields we already have.
        const updated = withKnownTally(post);
        merged = {
          ...updated,
          videoCID:          updated.videoCID          ?? existing.videoCID,
          videoThumbnailCID: updated.videoThumbnailCID ?? existing.videoThumbnailCID,
          videoDuration:     updated.videoDuration     ?? existing.videoDuration,
          videoSize:         updated.videoSize         ?? existing.videoSize,
          videoMimeType:     updated.videoMimeType     ?? existing.videoMimeType,
          imageIPFS:         updated.imageIPFS         ?? existing.imageIPFS,
          imageThumbnail:    updated.imageThumbnail    ?? existing.imageThumbnail,
        };
      }
      postsMap.value.set(post.id, merged);
      triggerRef(postsMap);
      tryDecryptPost(merged);
      return;
    }

    // Already seen in a previous session → add silently, no banner
    if (seenPostIds.has(post.id)) {
      postsMap.value.set(post.id, post);
      tryDecryptPost(post);
      const next = (communityArrivalCounts.get(communityId) || 0) + 1;
      communityArrivalCounts.set(communityId, next);
      return;
    }

    // Only genuinely new if created AFTER this session started.
    // This prevents Gun re-delivering old posts from triggering banner.
    const isGenuinelyNew = post.createdAt > APP_START_TIME;

    if (communityInitialLoadDone.get(communityId) && isGenuinelyNew) {
      // Auto-prepend immediately — no banner, no click required
      postsMap.value.set(post.id, post);
      tryDecryptPost(post);
      seenPostIds.add(post.id);
      saveSeenIds(seenPostIds);
      const next = (communityArrivalCounts.get(communityId) || 0) + 1;
      communityArrivalCounts.set(communityId, next);
    } else {
      // Initial load or stale Gun re-delivery → add silently
      postsMap.value.set(post.id, post);
      tryDecryptPost(post);
      seenPostIds.add(post.id);
      const next = (communityArrivalCounts.get(communityId) || 0) + 1;
      communityArrivalCounts.set(communityId, next);
    }
  }

  function scheduleIncomingPostsFlush() {
    if (pendingPostsFlushTimer) return;
    pendingPostsFlushTimer = setTimeout(() => {
      pendingPostsFlushTimer = null;
      let processed = 0;
      const queues = Array.from(pendingPostsByCommunity.entries());
      let cursor = 0;
      while (processed < INCOMING_POST_BATCH_SIZE && queues.length > 0) {
        const [communityId, queue] = queues[cursor];
        const first = queue.values().next().value as Post | undefined;
        if (first) {
          queue.delete(first.id);
          processIncomingPost(communityId, first);
          processed++;
        }
        if (queue.size === 0) {
          pendingPostsByCommunity.delete(communityId);
          queues.splice(cursor, 1);
          if (queues.length === 0) break;
          if (cursor >= queues.length) cursor = 0;
          continue;
        }
        cursor = (cursor + 1) % queues.length;
      }
      if (processed > 0) logPostFlushRate(processed);
      if (pendingPostsByCommunity.size > 0) scheduleIncomingPostsFlush();
    }, INCOMING_POST_FLUSH_MS);
  }

  function queueIncomingPost(communityId: string, post: Post) {
    const queue = pendingPostsByCommunity.get(communityId) || new Map<string, Post>();
    queue.set(post.id, post);
    pendingPostsByCommunity.set(communityId, queue);
    logIncomingPostRate();
    scheduleIncomingPostsFlush();
  }

  function flushCommunityIncomingPosts(communityId: string) {
    const queue = pendingPostsByCommunity.get(communityId);
    if (!queue) return;
    pendingPostsByCommunity.delete(communityId);
    for (const post of queue.values()) {
      processIncomingPost(communityId, post);
    }
  }

  // ─── Computed ──────────────────────────────────────────────────────────────

  const posts = computed(() => Array.from(postsMap.value.values()));

  function matchesVersion(p: Post): boolean {
    const namespaceVersion = Number.parseInt(GUN_NAMESPACE.replace(/^v/i, ''), 10) || 0;
    // In v3+ mode, require explicit dataVersion match to avoid legacy bleed.
    if (namespaceVersion >= 3) return p.dataVersion === GUN_NAMESPACE;
    const v = p.dataVersion || GUN_NAMESPACE;
    return enabledVersions.value.includes(v as DataVersion);
  }

  // Maintained sorted array — rebuilt only when postsMap changes (triggerRef).
  // Tally patches that don't change sort order (upvote count only) do NOT
  // rebuild this array, eliminating the biggest source of feed jank.
  const _sortedPostsCache = shallowRef<Post[]>([]);

  function rebuildSortedPosts() {
    const arr = Array.from(postsMap.value.values())
      .filter(matchesVersion)
      .sort((a, b) => b.createdAt - a.createdAt);
    _sortedPostsCache.value = arr;
  }

  // Mirror: whenever postsMap is triggered (new post added or score changed)
  // rebuild the sorted array. watchEffect subscribes to postsMap.value because
  // shallowRef fires only on triggerRef() or .value reassignment — not on
  // every individual .set() call inside the Map.
  watchEffect(() => {
    void postsMap.value; // reactive dependency
    rebuildSortedPosts();
  });

  const sortedPosts = computed(() => _sortedPostsCache.value);

  const communityPosts = computed(() => {
    if (!currentCommunityId.value) return sortedPosts.value;
    return sortedPosts.value.filter(p => p.communityId === currentCommunityId.value);
  });

  const visiblePosts = computed(() => sortedPosts.value.slice(0, visibleCount.value));
  const hasMorePosts = computed(() => visibleCount.value < sortedPosts.value.length);

  // ─── Loading ───────────────────────────────────────────────────────────────

  async function loadPostsForCommunity(communityId: string): Promise<void> {
    if (POST_DEBUG) {
      postDebug('load-community-start', {
        communityId,
        alreadySubscribed: subscribedCommunities.has(communityId),
        hasUnsubscriber: unsubscribers.has(communityId),
        currentPostsInCommunity: Array.from(postsMap.value.values()).filter(p => p.communityId === communityId).length,
        totalPostsInStore: postsMap.value.size,
        visibleCount: visibleCount.value,
      });
    }
    // Allow re-subscription if previous attempt yielded zero posts (GunDB was offline/slow)
    if (subscribedCommunities.has(communityId) || unsubscribers.has(communityId)) {
      const hasPosts = Array.from(postsMap.value.values()).some(p => p.communityId === communityId);
      if (hasPosts) return Promise.resolve();
      // Clean up stale subscription state before re-subscribing
      const oldUnsub = unsubscribers.get(communityId);
      if (oldUnsub) { oldUnsub(); unsubscribers.delete(communityId); }
      subscribedCommunities.delete(communityId);
    }

    communityInitialLoadDone.set(communityId, false);
    communityArrivalCounts.set(communityId, 0);

    // REST warmup is handled by dbWarmup.ts (called from onMounted before this).
    // This function's job is solely to open the Gun live-updates subscription.
    // Gun delivers: (a) any posts dbWarmup missed, (b) real-time new posts.
    const subscriptionStartTime = Date.now();

    await new Promise<void>((resolve) => {
      const unsub = PostService.subscribeToPostsInCommunity(
        communityId,
        (post) => {
          queueIncomingPost(communityId, post);
        },
        () => {
          flushCommunityIncomingPosts(communityId);
          subscribedCommunities.add(communityId);
          communityInitialLoadDone.set(communityId, true);
          for (const id of postsMap.value.keys()) seenPostIds.add(id);
          saveSeenIds(seenPostIds);
          if (POST_DEBUG) {
            postDebug('load-community-initial-done', {
              communityId,
              durationMs: Date.now() - subscriptionStartTime,
              arrivals: communityArrivalCounts.get(communityId) || 0,
              totalPostsInStore: postsMap.value.size,
              communityPosts: Array.from(postsMap.value.values()).filter(p => p.communityId === communityId).length,
              visibleCount: visibleCount.value,
            });
          }
          resolve();
        },
      );
      unsubscribers.set(communityId, unsub);
    });
  }

  // No-op — kept so existing components that call flushNewPosts() don't break
  function flushNewPosts() {
    pendingNewPosts.value = [];
  }

  function injectPost(post: Post) {
    // Prevent injecting posts from other namespace versions
    const postDataVersion = (post as any).dataVersion || null;
    const namespaceVersion = Number.parseInt(GUN_NAMESPACE.replace(/^v/i, ''), 10) || 0;
    if (postDataVersion && postDataVersion !== GUN_NAMESPACE) return;
    if (!postDataVersion && namespaceVersion >= 3) return;

    if (!postsMap.value.has(post.id)) {
      postsMap.value.set(post.id, post);
      tryDecryptPost(post);
      if (POST_DEBUG) {
        postDebug('inject-post', {
          postId: post.id,
          communityId: post.communityId,
          createdAt: post.createdAt,
          totalPostsInStore: postsMap.value.size,
        });
      }
    }
    seenPostIds.add(post.id);
  }

  function saveSeenNow() {
    saveSeenIds(seenPostIds);
  }

  /**
   * Purge any posts from the store and local Gun cache that do not match
   * the current active namespace (eradicate v2 when running v3).
   */
  async function purgeLegacyPosts(): Promise<number> {
    const removed: string[] = [];
    for (const [id, post] of postsMap.value) {
      const v = post.dataVersion || null;
      if (v !== GUN_NAMESPACE) removed.push(id);
    }
    if (removed.length === 0) return 0;

    for (const id of removed) {
      postsMap.value.delete(id);
    }

    // Attempt to clear local Gun nodes as well (best-effort)
    try {
      const gunModule = await import('../services/gunService');
      const gun = gunModule.GunService?.getGun?.();
      if (gun && typeof gun.get === 'function') {
        for (const id of removed) {
          try {
            // Put null to clear the node locally — Gun may ignore depending on persistence
            gun.get('posts').get(id).put(null);
          } catch (err) {
            // best-effort
          }
        }
      }
    } catch (err) {
      // ignore
    }

    return removed.length;
  }

  function loadMorePosts() {
    const before = visibleCount.value;
    visibleCount.value += PAGE_SIZE;
    if (POST_DEBUG) {
      postDebug('load-more-posts', {
        before,
        after: visibleCount.value,
        pageSize: PAGE_SIZE,
        totalSortedPosts: sortedPosts.value.length,
      });
    }
  }

  function resetVisibleCount() {
    const before = visibleCount.value;
    visibleCount.value    = PAGE_SIZE;
    pendingNewPosts.value = [];
    // Note: communityInitialLoadDone is NOT reset here—it persists per community
    // across refreshes, so truly new posts after refresh correctly trigger banner
    if (POST_DEBUG) {
      postDebug('reset-visible-count', {
        before,
        after: visibleCount.value,
        pageSize: PAGE_SIZE,
      });
    }
  }

  /**
   * Shrink postsMap under memory pressure, keeping what the user can actually
   * reach: everything currently rendered (the visible window), plus the post
   * being viewed. Anything else is re-fetchable from Gun or the relay on scroll.
   *
   * Called by the memory watchdog — see the cleanup registration in main.ts.
   * Returns the number of posts dropped.
   */
  function trimPostsToVisible(extra = PAGE_SIZE): number {
    const keep = new Set<string>();
    const ordered = sortedPosts.value;
    const limit = Math.min(ordered.length, visibleCount.value + extra);
    for (let i = 0; i < limit; i++) keep.add(ordered[i].id);
    if (currentPost.value) keep.add(currentPost.value.id);

    let removed = 0;
    for (const id of Array.from(postsMap.value.keys())) {
      if (!keep.has(id)) { postsMap.value.delete(id); removed++; }
    }
    if (removed > 0) postDebug('trim-posts-to-visible', { removed, kept: postsMap.value.size });
    return removed;
  }

  // ─── Create ────────────────────────────────────────────────────────────────

  async function createPost(data: {
    communityId: string;
    title: string;
    content: string;
    imageFile?: File;
    videoCID?: string;
    videoThumbnailCID?: string;
    videoDuration?: number;
    videoSize?: number;
    videoMimeType?: string;
  }) {
    try {
      let joinedCommunityIds: string[] = [];
      try {
        joinedCommunityIds = JSON.parse(localStorage.getItem('joined-communities') || '[]');
      } catch {
        joinedCommunityIds = [];
      }
      if (!joinedCommunityIds.includes(data.communityId)) {
        throw new Error('COMMUNITY_JOIN_REQUIRED');
      }
      // Force refresh so we always get the latest customUsername, not a stale cache
      const currentUser = await UserService.getCurrentUser(true);
      const showReal = currentUser.showRealName === true;
      const postId = `post-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      // If user has set a customUsername, always use it (it IS their identity).
      // Only fall back to pseudonym for users who have never set one.
      const authorName = currentUser.customUsername
        ? currentUser.customUsername
        : (showReal
            ? (currentUser.displayName || currentUser.username)
            : generatePseudonym(postId, currentUser.id));
      // Show real name whenever a customUsername is set
      const showRealName = showReal || !!currentUser.customUsername;

      const post = await PostService.createPost({
        communityId: data.communityId, authorId: currentUser.id,
        authorName, authorShowRealName: showRealName,
        title: data.title, content: data.content,
        // Video fields — only present when user attached a video
        ...(data.videoCID          ? { videoCID:          data.videoCID }          : {}),
        ...(data.videoThumbnailCID ? { videoThumbnailCID: data.videoThumbnailCID } : {}),
        ...(data.videoDuration     ? { videoDuration:     data.videoDuration }     : {}),
        ...(data.videoSize         ? { videoSize:         data.videoSize }         : {}),
        ...(data.videoMimeType     ? { videoMimeType:     data.videoMimeType }     : {}),
      }, data.imageFile, postId);

      await UserService.incrementPostCount();
      const chainStore = useChainStore();
      await chainStore.addAction('post-create', {
        postId: post.id, communityId: data.communityId,
        title: data.title, timestamp: post.createdAt,
      }, data.title);

      postsMap.value.set(post.id, post);
      seenPostIds.add(post.id);
      saveSeenIds(seenPostIds);

      try {
        const postEvent = await EventService.createPostEvent({
          id: post.id, communityId: data.communityId,
          title: data.title, content: data.content, imageIPFS: post.imageIPFS,
        });
        BroadcastService.broadcast('new-event', postEvent);
        WebSocketService.broadcast('new-event', postEvent);
      } catch (err) { console.warn('Failed to create signed post event:', err); }

      return post;
    } catch (error) { console.error('Error creating post:', error); throw error; }
  }

  // ─── Select ────────────────────────────────────────────────────────────────

  async function selectPost(postId: string) {
    try {
      const local = postsMap.value.get(postId);
      if (local) { currentPost.value = local; return; }
      const fetched = await PostService.getPost(postId);
      currentPost.value = fetched;
      if (fetched) {
        postsMap.value.set(fetched.id, fetched);
        tryDecryptPost(fetched);
      }
    } catch (error) { console.error('Error selecting post:', error); }
  }

  // ─── Voting ────────────────────────────────────────────────────────────────

  /** This user's vote on a post, or null. Seeded from localStorage, corrected by the graph. */
  function myVote(postId: string): 'up' | 'down' | null {
    return myVotes.value.get(postId) ?? null;
  }

  function setMyVote(postId: string, vote: 'up' | 'down' | null) {
    if (vote) myVotes.value.set(postId, vote);
    else myVotes.value.delete(postId);
    // Reassign so template reads of myVote() re-evaluate; Map mutation is not reactive.
    myVotes.value = new Map(myVotes.value);
    saveMyVotes(myVotes.value);
  }

  /**
   * Predict a toggle's effect on the counts for instant feedback.
   *
   * Purely cosmetic and always superseded by the derived tally that comes back.
   * It predicts from `myVotes`, the same state the button's filled/hollow
   * rendering uses, so the number and the icon can never disagree mid-flight.
   *
   * Must call `triggerRef(postsMap)`: `postsMap` is a `shallowRef`, so Vue only
   * reacts to `.value` reassignment or an explicit trigger — never to `.set()`
   * mutating the Map in place. Without this, the optimistic write here landed
   * in the Map correctly but nothing re-rendered from it: the heart/downvote
   * button and count sat frozen until the network round trip finished and
   * `reconcileVote` happened to trigger a re-render for an unrelated reason,
   * at which point the UI jumped straight from the pre-click state to the
   * final state — the "delay, then sudden reset" behaviour.
   */
  function applyOptimisticToggle(postId: string, next: 'up' | 'down' | null): Post | null {
    // A post open on the detail page may not be in postsMap — fall back to
    // currentPost so the count moves there too, not just the button state.
    const existing = postsMap.value.get(postId)
      ?? (currentPost.value?.id === postId ? currentPost.value : null);
    if (!existing) return null;
    const snapshot = { ...existing };
    const previous = myVote(postId);
    const delta = (vote: 'up' | 'down') =>
      (next === vote ? 1 : 0) - (previous === vote ? 1 : 0);
    const upvotes = Math.max(0, (existing.upvotes || 0) + delta('up'));
    const downvotes = Math.max(0, (existing.downvotes || 0) + delta('down'));
    const optimistic: Post = { ...existing, upvotes, downvotes, score: upvotes - downvotes };
    postsMap.value.set(postId, optimistic);
    triggerRef(postsMap);
    if (currentPost.value?.id === postId) currentPost.value = optimistic;
    return snapshot;
  }

  function rollbackVote(postId: string, snapshot: Post | null, previousVote: 'up' | 'down' | null) {
    setMyVote(postId, previousVote);
    if (!snapshot) return;
    postsMap.value.set(postId, snapshot);
    triggerRef(postsMap);
    if (currentPost.value?.id === postId) currentPost.value = snapshot;
  }

  function reconcileVote(postId: string, updated: Post, resolvedVote: 'up' | 'down' | null) {
    const tally: PostTally = { upvotes: updated.upvotes, downvotes: updated.downvotes, score: updated.score };
    setTally(postId, tally);
    BroadcastService.broadcast('post-vote-tally', { postId, tally });
    setMyVote(postId, resolvedVote);
    const merged = { ...updated };
    postsMap.value.set(postId, merged);
    triggerRef(postsMap);
    if (currentPost.value?.id === postId) currentPost.value = merged;
    broadcastPostUpdate(merged);
  }

  /**
   * Toggle this user's vote: clicking the direction you already hold clears it.
   *
   * Views used to make this decision themselves from their own localStorage set
   * and then call `upvotePost` or `removeUpvote` accordingly — while the service
   * independently decided the same thing from the graph. One toggle, decided
   * once, here; the graph's answer is what everything reconciles to.
   */
  async function toggleVote(postId: string, direction: 'up' | 'down') {
    const previousVote = myVote(postId);
    const predicted = previousVote === direction ? null : direction;
    const snapshot = applyOptimisticToggle(postId, predicted);
    setMyVote(postId, predicted);
    try {
      const currentUser = await UserService.getCurrentUser();
      const { post, myVote: resolved } = await PostService.voteOnPost(postId, direction, currentUser.id);
      reconcileVote(postId, post, resolved);
      const karmaDelta = karmaFor(resolved) - karmaFor(previousVote);
      if (karmaDelta !== 0) void UserService.incrementKarma(post.authorId, karmaDelta).catch(() => {});
    } catch (error) {
      rollbackVote(postId, snapshot, previousVote);
      console.error('Error voting:', error); throw error;
    }
  }

  /** Clear this user's vote regardless of direction. */
  async function clearVote(postId: string) {
    const previousVote = myVote(postId);
    if (!previousVote) return;
    const snapshot = applyOptimisticToggle(postId, null);
    setMyVote(postId, null);
    try {
      const currentUser = await UserService.getCurrentUser();
      const { post, myVote: resolved } = await PostService.removeVote(postId, previousVote, currentUser.id);
      reconcileVote(postId, post, resolved);
      const karmaDelta = karmaFor(resolved) - karmaFor(previousVote);
      if (karmaDelta !== 0) void UserService.incrementKarma(post.authorId, karmaDelta).catch(() => {});
    } catch (error) {
      rollbackVote(postId, snapshot, previousVote);
      console.error('Error clearing vote:', error); throw error;
    }
  }

  /** Karma contribution of a vote state, so a flip is one net adjustment rather than two. */
  function karmaFor(vote: 'up' | 'down' | null): number {
    return vote === 'up' ? 1 : vote === 'down' ? -1 : 0;
  }

  /**
   * Pull the authoritative tally and vote state for one post.
   *
   * Worth the round trip on a post the user is looking at directly; the feed
   * renders the advisory counters carried on the post node until then.
   */
  async function refreshVoteState(postId: string) {
    try {
      const currentUser = await UserService.getCurrentUser();
      const [tally, vote] = await Promise.all([
        PostService.getTally(postId),
        PostService.getMyVote(postId, currentUser.id),
      ]);
      setTally(postId, tally);
      setMyVote(postId, vote);
    } catch (error) {
      console.error('Error refreshing vote state:', error);
    }
  }

  /** Live authoritative counts while a post is on screen. Returns an unsubscribe. */
  function subscribeToVotes(postId: string): () => void {
    return PostService.subscribeToVotes(postId, (tally) => setTally(postId, tally));
  }

  // Legacy call shapes, kept so any caller not yet migrated still toggles
  // through the single decision point above.
  const voteOnPost = (postId: string, direction: 'up' | 'down') => toggleVote(postId, direction);
  const upvotePost = (postId: string) => toggleVote(postId, 'up');
  const downvotePost = (postId: string) => toggleVote(postId, 'down');
  const removeUpvote = (postId: string) => clearVote(postId);
  const removeDownvote = (postId: string) => clearVote(postId);

  // ─── Refresh ───────────────────────────────────────────────────────────────

  async function refreshPosts() {
    if (!currentCommunityId.value) return;
    pendingPostsByCommunity.delete(currentCommunityId.value);
    const unsub = unsubscribers.get(currentCommunityId.value);
    if (unsub) unsub();
    unsubscribers.delete(currentCommunityId.value);
    subscribedCommunities.delete(currentCommunityId.value);
    for (const [id, post] of postsMap.value) {
      if (post.communityId === currentCommunityId.value) postsMap.value.delete(id);
    }
    resetVisibleCount();
    await loadPostsForCommunity(currentCommunityId.value);
  }

  // Run immediate purge on initialization for v3 clients to ensure no legacy posts persist
  (async () => {
    try {
      const namespaceVersion = Number.parseInt(GUN_NAMESPACE.replace(/^v/i, ''), 10) || 0;
      if (namespaceVersion >= 3) {
        const removed = await purgeLegacyPosts();
        if (removed > 0) {
          saveSeenIds(new Set());
          // clear seen-post-ids to avoid restoring old IDs
          try { localStorage.removeItem(SEEN_POSTS_KEY); } catch {}
          if (POST_DEBUG) postDebug('purged-legacy-posts', { removed });
        }
      }
    } catch (err) { /* ignore */ }
  })();

  return {
    posts, postsMap, currentPost, isLoading, currentFeed,
    sortedPosts, communityPosts, visiblePosts, hasMorePosts, visibleCount,
    newPostCount, pendingNewPosts,
    loadPostsForCommunity, loadMorePosts, resetVisibleCount,
    flushNewPosts, injectPost, saveSeenNow, purgeLegacyPosts, trimPostsToVisible,
    createPost, selectPost,
    toggleVote, clearVote, myVote, myVotes, refreshVoteState, subscribeToVotes,
    voteOnPost, upvotePost, downvotePost, removeUpvote, removeDownvote,
    setCommentCount,
    refreshPosts,
  };
});
