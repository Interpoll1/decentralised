// src/stores/postStore.ts — posts UI state, backed by reactive GenosDB queries.
//
// Gone: seen-id dedup, the APP_START_TIME re-delivery filter, incoming-post
// batching, sync-rate loggers, the v2/v3 dataVersion legacy-purge machinery and
// evict-legacy-posts listener, and manual EventService/BroadcastService/
// WebSocketService propagation. GenosDB delivers clean reactive events, derives
// scores from signed vote nodes, and syncs P2P + cross-tab natively.
import { defineStore } from 'pinia'
import { ref, computed, onScopeDispose } from 'vue'
import { Post, PostService } from '../services/postService'
import { UserService } from '../services/userService'
import { generatePseudonym } from '../utils/pseudonym'

const PAGE_SIZE = 10

export const usePostStore = defineStore('post', () => {
  const postsMap = ref<Map<string, Post>>(new Map())
  const currentPost = ref<Post | null>(null)
  const isLoading = ref(false)
  const currentFeed = ref<'all' | 'community'>('all')
  const currentCommunityId = ref<string | null>(null)
  const visibleCount = ref(PAGE_SIZE)

  // Kept for backward compatibility with components that still reference them.
  const pendingNewPosts = ref<Post[]>([])
  const newPostCount = computed(() => 0)

  const unsubscribers = new Map<string, () => void>()

  // ─── Computed ──────────────────────────────────────────────────────────────
  const posts = computed(() => Array.from(postsMap.value.values()))
  const sortedPosts = computed(() => [...posts.value].sort((a, b) => b.createdAt - a.createdAt))
  const communityPosts = computed(() =>
    currentCommunityId.value
      ? sortedPosts.value.filter(p => p.communityId === currentCommunityId.value)
      : sortedPosts.value,
  )
  const visiblePosts = computed(() => sortedPosts.value.slice(0, visibleCount.value))
  const hasMorePosts = computed(() => visibleCount.value < sortedPosts.value.length)

  // ─── Helpers ─────────────────────────────────────────────────────────────────
  function injectPost(post: Post) {
    postsMap.value.set(post.id, post)
    if (currentPost.value?.id === post.id) currentPost.value = post
  }

  function loadMorePosts() { visibleCount.value += PAGE_SIZE }
  function resetVisibleCount() { visibleCount.value = PAGE_SIZE; pendingNewPosts.value = [] }

  // ─── Load (live subscription) ────────────────────────────────────────────────
  function loadPostsForCommunity(communityId: string): Promise<void> {
    if (unsubscribers.has(communityId)) return Promise.resolve()
    return new Promise<void>((resolve) => {
      const unsub = PostService.subscribeToPostsInCommunity(communityId, injectPost, resolve)
      unsubscribers.set(communityId, unsub)
    })
  }

  async function refreshPosts() {
    if (!currentCommunityId.value) return
    const communityId = currentCommunityId.value
    unsubscribers.get(communityId)?.()
    unsubscribers.delete(communityId)
    for (const [id, post] of [...postsMap.value.entries()]) {
      if (post.communityId === communityId) postsMap.value.delete(id)
    }
    resetVisibleCount()
    await loadPostsForCommunity(communityId)
  }

  // ─── Create ──────────────────────────────────────────────────────────────────
  async function createPost(data: { communityId: string; title: string; content: string; imageFile?: File }) {
    let joined: string[] = []
    try { joined = JSON.parse(localStorage.getItem('joined-communities') || '[]') } catch { joined = [] }
    if (!joined.includes(data.communityId)) throw new Error('COMMUNITY_JOIN_REQUIRED')

    const user = await UserService.getCurrentUser(true)
    if (!user) throw new Error('Must be signed in to create a post')

    const postId = `post-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
    const showReal = user.showRealName === true
    const authorName = user.customUsername
      ? user.customUsername
      : (showReal ? (user.displayName || user.username) : generatePseudonym(postId, user.id))
    const showRealName = showReal || !!user.customUsername

    const post = await PostService.createPost(
      {
        communityId: data.communityId, authorId: user.id,
        authorName, authorShowRealName: showRealName,
        title: data.title, content: data.content,
      },
      data.imageFile,
      postId,
    )
    await UserService.incrementPostCount()
    await UserService.recordGovernancePost() // governance metric on the user:<address> node
    injectPost(post)
    return post
  }

  /** Remove a post — the author (its owner) or a delegated community moderator. ACL-enforced. */
  async function deletePost(postId: string) {
    await PostService.deletePost(postId)
    postsMap.value.delete(postId)
    if (currentPost.value?.id === postId) currentPost.value = null
  }

  // ─── Select ──────────────────────────────────────────────────────────────────
  async function selectPost(postId: string) {
    const local = postsMap.value.get(postId)
    if (local) { currentPost.value = local; return }
    const fetched = await PostService.getPost(postId)
    currentPost.value = fetched
    if (fetched) postsMap.value.set(fetched.id, fetched)
  }

  // ─── Voting ──────────────────────────────────────────────────────────────────
  async function applyVote(updated: Post | null, postId: string, karmaDelta: number) {
    if (!updated) return
    injectPost(updated)
    await UserService.incrementKarma(updated.authorId, karmaDelta)
  }

  async function voteOnPost(postId: string, direction: 'up' | 'down') {
    await applyVote(await PostService.voteOnPost(postId, direction), postId, direction === 'up' ? 1 : -1)
  }
  async function upvotePost(postId: string) {
    await applyVote(await PostService.voteOnPost(postId, 'up'), postId, 1)
  }
  async function downvotePost(postId: string) {
    await applyVote(await PostService.voteOnPost(postId, 'down'), postId, -1)
  }
  async function removeUpvote(postId: string) {
    await applyVote(await PostService.removeVote(postId, 'up'), postId, -1)
  }
  async function removeDownvote(postId: string) {
    await applyVote(await PostService.removeVote(postId, 'down'), postId, 1)
  }

  // No-ops kept so existing components don't break.
  function flushNewPosts() { pendingNewPosts.value = [] }
  function saveSeenNow() {}
  async function purgeLegacyPosts(): Promise<number> { return 0 }

  onScopeDispose(() => {
    for (const unsub of unsubscribers.values()) unsub()
    unsubscribers.clear()
  })

  return {
    posts, postsMap, currentPost, isLoading, currentFeed,
    sortedPosts, communityPosts, visiblePosts, hasMorePosts, visibleCount,
    newPostCount, pendingNewPosts,
    loadPostsForCommunity, loadMorePosts, resetVisibleCount,
    flushNewPosts, injectPost, saveSeenNow, purgeLegacyPosts,
    createPost, deletePost, selectPost,
    voteOnPost, upvotePost, downvotePost, removeUpvote, removeDownvote,
    refreshPosts,
  }
})
