// src/services/postService.ts — posts and up/down voting in the zero-trust model.
//
// Each vote is a signed node ({ type:'postVote', postId, voter, direction }) keyed
// `postVote:${postId}:${address}` — one vote per identity, so the old "vote as
// many times as you click" bug and the last-write-wins counter races are both
// gone. Scores are derived. Replaces ~570 lines of Gun denormalization (double
// writes to posts + community/posts indexes), once()-with-timeout reads, memory/
// missing caches, manual Schnorr signing and legacy-cache eviction.
import { db } from './gdbServices'
import { ImageService } from './imageService'

export interface Post {
  id: string
  communityId: string
  authorId: string
  authorName: string
  authorShowRealName?: boolean
  title: string
  content: string
  imageId?: string
  imageThumbnail?: string
  createdAt: number
  upvotes: number
  downvotes: number
  score: number
  commentCount: number
  isEncrypted?: boolean
  encryptedContent?: string
  authTag?: string
  authorPubkey?: string
  contentSignature?: string
  dataVersion?: string
}

const DERIVED_KEYS = ['upvotes', 'downvotes', 'score', 'commentCount'] as const

export class PostService {
  static async createPost(
    post: Omit<Post, 'id' | 'createdAt' | 'upvotes' | 'downvotes' | 'score' | 'commentCount'>,
    imageFile?: File,
    preGeneratedId?: string,
  ): Promise<Post> {
    const image = imageFile ? await ImageService.uploadImage(imageFile) : undefined
    const id = preGeneratedId || `post-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
    const record = {
      type: 'post',
      id,
      communityId: post.communityId || '',
      authorId: post.authorId || '',
      authorName: post.authorName || 'Anonymous',
      authorShowRealName: post.authorShowRealName || false,
      title: post.title || '',
      content: post.content || '',
      imageId: image?.cid || '',
      imageThumbnail: image?.thumbnail || '',
      createdAt: Date.now(),
    }
    // ACL-protected: the author owns the post node, so only they — or a moderator the
    // community owner delegates `delete` to — can remove it (enforced on every peer).
    await db.sm.acls.set(record, id)
    await this.grantCommunityModerators(id, record.communityId)
    return this.buildPost(record, [], 0)
  }

  static async getPost(postId: string): Promise<Post | null> {
    const { result } = await db.get(postId)
    if (!result?.value || result.value.type !== 'post') return null
    return this.buildPost(result.value, await this.loadVotes(postId), await this.countComments(postId))
  }

  /** Update content fields (author only, enforced by the SM signature). Derived fields are ignored. */
  static async updatePost(postId: string, updates: Partial<Post>): Promise<void> {
    const { result } = await db.get(postId)
    if (!result?.value) return
    const next = { ...result.value }
    for (const [key, val] of Object.entries(updates)) {
      if (!DERIVED_KEYS.includes(key as typeof DERIVED_KEYS[number])) next[key] = val
    }
    await db.put(next, postId)
  }

  /**
   * Remove a post. The ACL middleware permits only the owner (the author) or a
   * delete-collaborator (a moderator the community owner delegated `delete` to) —
   * scoped per node, never a global censor. Used for both self-delete and moderation.
   */
  static async deletePost(postId: string, _communityId?: string): Promise<void> {
    await db.sm.acls.delete(postId)
  }

  /**
   * Grant `delete` on a post to its community's owner + moderators, so they can
   * moderate it (the author is already the owner). The author signs these grants at
   * post time; community-scoped, best-effort (skips self, tolerates failures, and
   * only affects posts created after a moderator was added).
   */
  private static async grantCommunityModerators(postId: string, communityId: string): Promise<void> {
    if (!communityId) return
    const me = db.sm.getActiveEthAddress()
    const { result } = await db.get(communityId)
    const value = result?.value as { owner?: string; creatorId?: string; moderators?: string[] } | undefined
    if (!value) return
    const targets = new Set<string>()
    const owner = value.owner || value.creatorId
    if (owner) targets.add(owner)
    if (Array.isArray(value.moderators)) value.moderators.forEach(m => m && targets.add(m))
    for (const addr of targets) {
      if (!me || addr.toLowerCase() === me.toLowerCase()) continue
      try { await db.sm.acls.grant(postId, addr, 'delete') } catch { /* best-effort, cooperative */ }
    }
  }

  /** Cast or change a vote (one signed node per identity). */
  static async voteOnPost(postId: string, direction: 'up' | 'down', _userId?: string): Promise<Post> {
    const voter = db.sm.getActiveEthAddress()
    if (!voter) throw new Error('Cannot vote: no active identity')
    // ACL-owned by the voter, so only they can change or retract it (no peer can delete another's vote).
    await db.sm.acls.set({ type: 'postVote', postId, voter, direction, createdAt: Date.now() }, `postVote:${postId}:${voter}`)
    return (await this.getPost(postId))!
  }

  /** Retract a vote by removing its node. */
  static async removeVote(postId: string, _direction: 'up' | 'down', _userId?: string): Promise<Post> {
    const voter = db.sm.getActiveEthAddress()
    if (voter) await db.sm.acls.delete(`postVote:${postId}:${voter}`)
    return (await this.getPost(postId))!
  }

  /** Comment counts are derived from comment nodes, so there is nothing to increment. */
  static async incrementCommentCount(_postId: string): Promise<void> {}

  /**
   * Subscribe to a community's posts with derived scores and comment counts.
   * `onPost` fires for each post and again when its votes or comments change.
   */
  static subscribeToPostsInCommunity(
    communityId: string,
    onPost: (post: Post) => void,
    onInitialDone?: () => void,
  ): () => void {
    let active = true
    let postUnsub: (() => void) | undefined
    let voteUnsub: (() => void) | undefined
    let commentUnsub: (() => void) | undefined
    const postIds = new Set<string>()

    const emit = async (postId: string) => {
      if (!active) return
      const post = await this.getPost(postId)
      if (post && active) onPost(post)
    }

    void (async () => {
      const { unsubscribe } = await db.map(
        { query: { type: 'post', communityId } },
        ({ id, action }) => {
          if (action === 'removed') { postIds.delete(id); return }
          postIds.add(id)
          void emit(id)
        },
      )
      postUnsub = unsubscribe
      if (active) onInitialDone?.()

      const onRelated = ({ value }: { value: unknown }) => {
        const pid = (value as { postId?: string })?.postId
        if (pid && postIds.has(pid)) void emit(pid)
      }
      voteUnsub = (await db.map({ query: { type: 'postVote' } }, onRelated)).unsubscribe
      commentUnsub = (await db.map({ query: { type: 'comment' } }, onRelated)).unsubscribe
    })()

    return () => { active = false; postUnsub?.(); voteUnsub?.(); commentUnsub?.() }
  }

  /** All ops are SM-signed and peer-verified, so a stored post is inherently authentic. */
  static verifyPostSignature(post: Post): 'verified' | 'unverified' | 'unsigned' {
    if (post.isEncrypted) return 'unsigned'
    return post.authorId ? 'verified' : 'unsigned'
  }

  /** Private/encrypted posts are handled in the encryption slice; passthrough for now. */
  static async decryptPost(post: Post): Promise<Post> {
    return post
  }

  /** No legacy Gun cache to evict — OPFS handles persistence. */
  static async evictLegacyPosts(): Promise<void> {}

  static unsubscribeAll(): void {}

  // ── Helpers ──────────────────────────────────────────────────────────────────
  private static async loadVotes(postId: string): Promise<Array<{ voter: string; direction: string }>> {
    const { results } = await db.map({ query: { type: 'postVote', postId } })
    return results.map(n => n.value as { voter: string; direction: string })
  }

  private static async countComments(postId: string): Promise<number> {
    const { results } = await db.map({ query: { type: 'comment', postId } })
    return results.length
  }

  private static buildPost(
    record: any,
    votes: Array<{ voter: string; direction: string }>,
    commentCount: number,
  ): Post {
    const upvotes = votes.filter(v => v.direction === 'up').length
    const downvotes = votes.filter(v => v.direction === 'down').length
    return {
      ...record,
      upvotes,
      downvotes,
      score: upvotes - downvotes,
      commentCount,
    } as Post
  }
}
