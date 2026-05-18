// src/stores/postStore.ts
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { Post, PostService } from '../services/postService';
import { UserService } from '../services/userService';
import { EventService } from '../services/eventService';
import { BroadcastService } from '../services/broadcastService';
import { WebSocketService } from '../services/websocketService';
import { useChainStore } from './chainStore';
import { generatePseudonym } from '../utils/pseudonym';
import { enabledVersions, type DataVersion } from '../utils/dataVersionSettings';
import { GUN_NAMESPACE } from '../services/gunService';

const PAGE_SIZE      = 10;
const SEEN_POSTS_KEY = 'seen-post-ids';
const POST_DEBUG = localStorage.getItem('interpoll_post_debug') === 'true';

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

function postDebug(label: string, data?: Record<string, unknown>) {
  if (!POST_DEBUG) return;
  if (data) console.log(`[PostStoreDebug] ${label}`, data);
  else console.log(`[PostStoreDebug] ${label}`);
}

export const usePostStore = defineStore('post', () => {
  const postsMap           = ref<Map<string, Post>>(new Map());
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

  // ─── Computed ──────────────────────────────────────────────────────────────

  const posts = computed(() => Array.from(postsMap.value.values()));

  function matchesVersion(p: Post): boolean {
    const v = p.dataVersion || GUN_NAMESPACE;
    return enabledVersions.value.includes(v as DataVersion);
  }

  const sortedPosts = computed(() =>
    Array.from(postsMap.value.values())
      .filter(matchesVersion)
      .sort((a, b) => b.createdAt - a.createdAt)
  );

  const communityPosts = computed(() => {
    if (!currentCommunityId.value) return sortedPosts.value;
    return sortedPosts.value.filter(p => p.communityId === currentCommunityId.value);
  });

  const visiblePosts = computed(() => sortedPosts.value.slice(0, visibleCount.value));
  const hasMorePosts = computed(() => visibleCount.value < sortedPosts.value.length);

  // ─── Loading ───────────────────────────────────────────────────────────────

  function loadPostsForCommunity(communityId: string): Promise<void> {
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

    return new Promise((resolve) => {
      communityInitialLoadDone.set(communityId, false);
      const subscriptionStartTime = Date.now();
      communityArrivalCounts.set(communityId, 0);

      const unsub = PostService.subscribeToPostsInCommunity(
        communityId,
        (post) => {
          // Always update existing posts in-place (vote counts, edits)
          if (postsMap.value.has(post.id)) {
            postsMap.value.set(post.id, post);
            tryDecryptPost(post);
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
        },
        () => {
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

  // ─── Create ────────────────────────────────────────────────────────────────

  async function createPost(data: { communityId: string; title: string; content: string; imageFile?: File; }) {
    try {
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

  async function voteOnPost(postId: string, direction: 'up' | 'down') {
    try {
      const currentUser = await UserService.getCurrentUser();
      const updated = await PostService.voteOnPost(postId, direction, currentUser.id);
      if (updated) {
        postsMap.value.set(postId, updated);
        if (currentPost.value?.id === postId) currentPost.value = updated;
        await UserService.incrementKarma(updated.authorId, direction === 'up' ? 1 : -1);
      }
    } catch (error) { console.error('Error voting:', error); throw error; }
  }

  async function upvotePost(postId: string) {
    try {
      const currentUser = await UserService.getCurrentUser();
      const updated = await PostService.voteOnPost(postId, 'up', currentUser.id);
      if (updated) {
        postsMap.value.set(postId, updated);
        if (currentPost.value?.id === postId) currentPost.value = updated;
        await UserService.incrementKarma(updated.authorId, 1);
      }
    } catch (error) { console.error('Error upvoting:', error); throw error; }
  }

  async function downvotePost(postId: string) {
    try {
      const currentUser = await UserService.getCurrentUser();
      const updated = await PostService.voteOnPost(postId, 'down', currentUser.id);
      if (updated) {
        postsMap.value.set(postId, updated);
        if (currentPost.value?.id === postId) currentPost.value = updated;
        await UserService.incrementKarma(updated.authorId, -1);
      }
    } catch (error) { console.error('Error downvoting:', error); throw error; }
  }

  async function removeUpvote(postId: string) {
    try {
      const currentUser = await UserService.getCurrentUser();
      const updated = await PostService.removeVote(postId, 'up', currentUser.id);
      if (updated) {
        postsMap.value.set(postId, updated);
        if (currentPost.value?.id === postId) currentPost.value = updated;
        await UserService.incrementKarma(updated.authorId, -1);
      }
    } catch (error) { console.error('Error removing upvote:', error); throw error; }
  }

  async function removeDownvote(postId: string) {
    try {
      const currentUser = await UserService.getCurrentUser();
      const updated = await PostService.removeVote(postId, 'down', currentUser.id);
      if (updated) {
        postsMap.value.set(postId, updated);
        if (currentPost.value?.id === postId) currentPost.value = updated;
        await UserService.incrementKarma(updated.authorId, 1);
      }
    } catch (error) { console.error('Error removing downvote:', error); throw error; }
  }

  // ─── Refresh ───────────────────────────────────────────────────────────────

  async function refreshPosts() {
    if (!currentCommunityId.value) return;
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

  return {
    posts, postsMap, currentPost, isLoading, currentFeed,
    sortedPosts, communityPosts, visiblePosts, hasMorePosts, visibleCount,
    newPostCount, pendingNewPosts,
    loadPostsForCommunity, loadMorePosts, resetVisibleCount,
    flushNewPosts, injectPost, saveSeenNow,
    createPost, selectPost,
    voteOnPost, upvotePost, downvotePost, removeUpvote, removeDownvote,
    refreshPosts,
  };
});
