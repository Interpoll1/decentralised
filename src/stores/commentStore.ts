// src/stores/commentStore.ts — comments UI state, backed by reactive GenosDB.
//
// Gone: the double load (subscribe + delayed one-time fetch), the Math.max
// vote-protection against Gun re-deliveries, and the anonymous-user shim.
// A single reactive subscription delivers threaded comments with derived scores.
import { defineStore } from 'pinia'
import { ref, onScopeDispose } from 'vue'
import { Comment, CommentService } from '../services/commentService'
import { generatePseudonym } from '../utils/pseudonym'
import { UserService } from '../services/userService'

function readVoteSet(key: string): string[] {
  try { return JSON.parse(localStorage.getItem(key) || '[]') } catch { return [] }
}
function writeVoteSet(key: string, ids: string[]) {
  localStorage.setItem(key, JSON.stringify(ids))
}

export const useCommentStore = defineStore('comment', () => {
  const comments = ref<Comment[]>([])
  const isLoading = ref(false)
  const voteVersion = ref(0)
  let commentUnsub: (() => void) | null = null

  function upsert(comment: Comment) {
    const index = comments.value.findIndex(c => c.id === comment.id)
    if (index >= 0) comments.value[index] = comment
    else comments.value.push(comment)
  }

  async function loadCommentsForPost(postId: string) {
    isLoading.value = true
    comments.value = comments.value.filter(c => c.postId !== postId)
    commentUnsub?.()
    commentUnsub = CommentService.subscribeToCommentsInPost(postId, upsert, () => { isLoading.value = false })
  }

  async function createComment(data: { postId: string; communityId: string; content: string; parentId?: string }) {
    if (!data.postId) throw new Error('postId is required')
    if (!data.communityId) throw new Error('communityId is required')
    if (!data.content?.trim()) throw new Error('content is required')

    const user = await UserService.getCurrentUser()
    if (!user) throw new Error('Must be signed in to comment')

    const showReal = user.showRealName === true
    const authorName = showReal
      ? (user.customUsername || user.displayName || user.username)
      : generatePseudonym(data.postId, user.id)

    const comment = await CommentService.createComment({
      postId: data.postId,
      communityId: data.communityId,
      authorId: user.id,
      authorName,
      authorShowRealName: showReal,
      content: data.content,
      parentId: data.parentId,
    })
    upsert(comment)
    return comment
  }

  function hasUpvoted(commentId: string): boolean {
    return readVoteSet('upvoted-comments').includes(commentId)
  }
  function hasDownvoted(commentId: string): boolean {
    return readVoteSet('downvoted-comments').includes(commentId)
  }

  function setVote(key: string, commentId: string, on: boolean) {
    const ids = readVoteSet(key).filter(id => id !== commentId)
    if (on) ids.push(commentId)
    writeVoteSet(key, ids)
  }

  async function castVote(commentId: string, direction: 'up' | 'down') {
    const sameKey = direction === 'up' ? 'upvoted-comments' : 'downvoted-comments'
    const otherKey = direction === 'up' ? 'downvoted-comments' : 'upvoted-comments'
    const had = direction === 'up' ? hasUpvoted(commentId) : hasDownvoted(commentId)

    setVote(sameKey, commentId, !had)
    if (!had) setVote(otherKey, commentId, false)

    // Karma is derived from these signed vote nodes (UserService.getKarma), not pushed.
    if (had) await CommentService.removeCommentVote(commentId)
    else await CommentService.voteOnComment(commentId, direction)

    voteVersion.value++
  }

  async function upvoteComment(commentId: string) {
    try { await castVote(commentId, 'up') } catch (error) { voteVersion.value++; console.error('Error upvoting comment:', error); throw error }
  }
  async function downvoteComment(commentId: string) {
    try { await castVote(commentId, 'down') } catch (error) { voteVersion.value++; console.error('Error downvoting comment:', error); throw error }
  }

  function clearComments() {
    commentUnsub?.()
    commentUnsub = null
    comments.value = []
  }

  onScopeDispose(() => { commentUnsub?.() })

  return {
    comments,
    isLoading,
    voteVersion,
    loadCommentsForPost,
    createComment,
    upvoteComment,
    downvoteComment,
    hasUpvoted,
    hasDownvoted,
    clearComments,
  }
})
