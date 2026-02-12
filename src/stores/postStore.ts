// src/stores/postStore.ts
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { Post, PostService } from '../services/postService';
import { UserService } from '../services/userService';
import { EventService } from '../services/eventService';
import { BroadcastService } from '../services/broadcastService';
import { WebSocketService } from '../services/websocketService';
import { useChainStore } from './chainStore';

const PAGE_SIZE = 10;

export const usePostStore = defineStore('post', () => {
  const postsMap = ref<Map<string, Post>>(new Map());
  const currentPost = ref<Post | null>(null);
  const isLoading = ref(false);
  const currentFeed = ref<'all' | 'community'>('all');
  const currentCommunityId = ref<string | null>(null);
  const visibleCount = ref(PAGE_SIZE);

  const subscribedCommunities = new Set<string>();
  const unsubscribers = new Map<string, () => void>();

  // ─── Computed ──────────────────────────────────────────────────────────────

  const posts = computed(() => Array.from(postsMap.value.values()));

  // Sort by createdAt DESC so newest always appears first regardless of score.
  // Score-based sort was causing "old" posts to stay at top when new ones arrived.
  const sortedPosts = computed(() =>
    Array.from(postsMap.value.values()).sort((a, b) => b.createdAt - a.createdAt)
  );

  const communityPosts = computed(() => {
    if (!currentCommunityId.value) return sortedPosts.value;
    return sortedPosts.value.filter(p => p.communityId === currentCommunityId.value);
  });

  const visiblePosts = computed(() => sortedPosts.value.slice(0, visibleCount.value));
  const hasMorePosts = computed(() => visibleCount.value < sortedPosts.value.length);

  // ─── Loading ───────────────────────────────────────────────────────────────

  function loadPostsForCommunity(communityId: string): Promise<void> {
  // Already subscribed — live subscription is active, data is current.
  // No need to re-subscribe; Gun delivers new items to the existing listener.
  if (subscribedCommunities.has(communityId)) return Promise.resolve();

  return new Promise((resolve) => {
    const unsub = PostService.subscribeToPostsInCommunity(
      communityId,
      (post) => {
        postsMap.value.set(post.id, post);
      },
      () => {
        subscribedCommunities.add(communityId);
        resolve();
      },
    );

    unsubscribers.set(communityId, unsub);
  });
}

function loadMorePosts() {
  visibleCount.value += PAGE_SIZE;
}

function resetVisibleCount() {
  visibleCount.value = PAGE_SIZE;
}

  // ─── Create ────────────────────────────────────────────────────────────────

  async function createPost(data: { communityId: string; title: string; content: string; imageFile?: File; }) {
    try {
      const currentUser = await UserService.getCurrentUser();
      const post = await PostService.createPost({
        communityId: data.communityId, authorId: currentUser.id,
        authorName: currentUser.username, title: data.title, content: data.content,
      }, data.imageFile);

      await UserService.incrementPostCount();
      const chainStore = useChainStore();
      await chainStore.addAction('post-create', {
        postId: post.id, communityId: data.communityId,
        title: data.title, timestamp: post.createdAt,
      }, data.title);

      postsMap.value.set(post.id, post);

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

  // ─── Refresh (explicit user action only) ──────────────────────────────────

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
    loadPostsForCommunity, loadMorePosts, resetVisibleCount,
    createPost, selectPost,
    voteOnPost, upvotePost, downvotePost, removeUpvote, removeDownvote,
    refreshPosts,
  };
});
