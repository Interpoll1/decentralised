// src/services/commentService.ts — threaded comments and voting (zero-trust).
//
// Comments are nodes ({ type:'comment', postId, parentId? }) and each vote is a
// signed node keyed `commentVote:${commentId}:${address}` — one vote per identity,
// scores derived. Replaces ~600 lines of Gun denormalization, once()-with-timeout
// reads and manual Schnorr signing.
import { db } from './gdbServices'
import { grantCommunityModerators } from './moderationGrants'

export interface Comment {
  id: string
  postId: string
  communityId: string
  authorId: string
  authorName: string
  authorShowRealName?: boolean
  content: string
  parentId?: string
  createdAt: number
  upvotes: number
  downvotes: number
  score: number
  edited?: boolean
  editedAt?: number
  authorPubkey?: string
  contentSignature?: string
  isEncrypted?: boolean
  encryptedContent?: string
  authTag?: string
}

export interface CreateCommentData {
  postId: string
  communityId: string
  authorId: string
  authorName: string
  authorShowRealName?: boolean
  content: string
  parentId?: string
}

export class CommentService {
  static async createComment(data: CreateCommentData): Promise<Comment> {
    const id = `comment-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
    const record = {
      type: 'comment',
      id,
      postId: data.postId,
      communityId: data.communityId,
      authorId: data.authorId,
      authorName: data.authorName,
      authorShowRealName: data.authorShowRealName ?? false,
      content: data.content,
      parentId: data.parentId ?? '',
      createdAt: Date.now(),
    }
    // ACL-owned by the author, so only they — or a moderator the community owner
    // delegates `delete` to — can remove it (enforced on every peer).
    await db.sm.acls.set(record, id)
    await grantCommunityModerators(id, data.communityId)
    return this.buildComment(record, [])
  }

  static async voteOnComment(commentId: string, direction: 'up' | 'down', _userId?: string): Promise<void> {
    const voter = db.sm.getActiveEthAddress()
    if (!voter) throw new Error('Cannot vote: no active identity')
    // ACL-owned by the voter, so only they can change or retract it.
    await db.sm.acls.set({ type: 'commentVote', commentId, voter, direction, createdAt: Date.now() }, `commentVote:${commentId}:${voter}`)
  }

  static async removeCommentVote(commentId: string, _userId?: string): Promise<void> {
    const voter = db.sm.getActiveEthAddress()
    if (voter) await db.sm.acls.delete(`commentVote:${commentId}:${voter}`)
  }

  static async getAllCommentsInPost(postId: string): Promise<Comment[]> {
    const { results } = await db.map({ query: { type: 'comment', postId } })
    return Promise.all(results.map(n => this.withVotes(n.value)))
  }

  static subscribeToCommentsInPost(
    postId: string,
    onComment: (comment: Comment) => void,
    onInitialDone?: () => void,
  ): () => void {
    let active = true
    let commentUnsub: (() => void) | undefined
    let voteUnsub: (() => void) | undefined
    const commentIds = new Set<string>()

    const emit = async (commentId: string) => {
      if (!active) return
      const { result } = await db.get(commentId)
      if (!result?.value || result.value.type !== 'comment') return
      const comment = await this.withVotes(result.value)
      if (active) onComment(comment)
    }

    void (async () => {
      const { unsubscribe } = await db.map(
        { query: { type: 'comment', postId } },
        ({ id, action }) => {
          if (action === 'removed') { commentIds.delete(id); return }
          commentIds.add(id)
          void emit(id)
        },
      )
      commentUnsub = unsubscribe
      if (active) onInitialDone?.()

      const { unsubscribe: vu } = await db.map(
        { query: { type: 'commentVote' } },
        ({ value }) => {
          const cid = (value as { commentId?: string })?.commentId
          if (cid && commentIds.has(cid)) void emit(cid)
        },
      )
      voteUnsub = vu
    })()

    return () => { active = false; commentUnsub?.(); voteUnsub?.() }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────
  private static async withVotes(record: any): Promise<Comment> {
    const { results } = await db.map({ query: { type: 'commentVote', commentId: record.id } })
    return this.buildComment(record, results.map(n => n.value as { direction: string }))
  }

  private static buildComment(record: any, votes: Array<{ direction: string }>): Comment {
    const upvotes = votes.filter(v => v.direction === 'up').length
    const downvotes = votes.filter(v => v.direction === 'down').length
    return { ...record, upvotes, downvotes, score: upvotes - downvotes } as Comment
  }
}
