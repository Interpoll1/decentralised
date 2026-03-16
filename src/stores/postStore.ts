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
    if (subscribedCommunities.has(communityId) || unsubscribers.has(communityId)) return Promise.resolve();

    return new Promise((resolve) => {
      communityInitialLoadDone.set(communityId, false);
      const subscriptionStartTime = Date.now();

      const unsub = PostService.subscribeToPostsInCommunity(
        communityId,
        (post) => {
          // Always update existing posts in-place (vote counts, edits)
          if (postsMap.value.has(post.id)) {
            postsMap.value.set(post.id, post);
            return;
          }

          // Already seen in a previous session → add silently, no banner
          if (seenPostIds.has(post.id)) {
            postsMap.value.set(post.id, post);
            return;
          }

          // Only genuinely new if created AFTER this session started.
          // This prevents Gun re-delivering old posts from triggering banner.
          const isGenuinelyNew = post.createdAt > APP_START_TIME;

          if (initialLoadDone.value && isGenuinelyNew) {
            // Auto-prepend immediately — no banner, no click required
            postsMap.value.set(post.id, post);
            seenPostIds.add(post.id);
            saveSeenIds(seenPostIds);
          } else {
            // Initial load or stale Gun re-delivery → add silently
            postsMap.value.set(post.id, post);
            seenPostIds.add(post.id);
          }
        },
        () => {
          subscribedCommunities.add(communityId);
          communityInitialLoadDone.set(communityId, true);
          for (const id of postsMap.value.keys()) seenPostIds.add(id);
          saveSeenIds(seenPostIds);
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
    }
    seenPostIds.add(post.id);
  }

  function saveSeenNow() {
    saveSeenIds(seenPostIds);
  }

  function loadMorePosts() { visibleCount.value += PAGE_SIZE; }

  function resetVisibleCount() {
    visibleCount.value    = PAGE_SIZE;
    pendingNewPosts.value = [];
    // Note: communityInitialLoadDone is NOT reset here—it persists per community
    // across refreshes, so truly new posts after refresh correctly trigger banner
  }

  // ─── Create ────────────────────────────────────────────────────────────────

  async function createPost(data: { communityId: string; title: string; content: string; imageFile?: File; }) {
    try {
      const currentUser = await UserService.getCurrentUser();
      const showReal = currentUser.showRealName === true;
      const postId = `post-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const authorName = showReal
        ? (currentUser.customUsername || currentUser.displayName || currentUser.username)
        : generatePseudonym(postId, currentUser.id);

      const post = await PostService.createPost({
        communityId: data.communityId, authorId: currentUser.id,
        authorName, authorShowRealName: showReal,
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
      if (fetched) postsMap.value.set(fetched.id, fetched);
    } catch (error) { console.error('Error selecting post:', error); }
  }

  // ─── Voting ────────────────────────────────────────────────────────────────

  async function voteOnPost(postId: string, direction: 'up' | 'down') {
    try {
      const currentUser = await UserService.getCurrentUser();
      await PostService.voteOnPost(postId, direction, currentUser.id);
      const post = postsMap.value.get(postId);
      if (post) {
        const updated = { ...post };
        if (direction === 'up') updated.upvotes++; else updated.downvotes++;
        updated.score = updated.upvotes - updated.downvotes;
        postsMap.value.set(postId, updated);
        await UserService.incrementKarma(post.authorId, direction === 'up' ? 1 : -1);
      }
    } catch (error) { console.error('Error voting:', error); throw error; }
  }

  async function upvotePost(postId: string) {
    try {
      const currentUser = await UserService.getCurrentUser();
      await PostService.voteOnPost(postId, 'up', currentUser.id);
      const updated = await PostService.getPost(postId);
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
      await PostService.voteOnPost(postId, 'down', currentUser.id);
      const updated = await PostService.getPost(postId);
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
      await PostService.removeVote(postId, 'up', currentUser.id);
      const updated = await PostService.getPost(postId);
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
      await PostService.removeVote(postId, 'down', currentUser.id);
      const updated = await PostService.getPost(postId);
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
