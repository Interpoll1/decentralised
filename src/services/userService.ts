// src/services/userService.ts — user profiles in the zero-trust model.
//
// Identity is the active Security Manager Ethereum address (the signing key),
// not a spoofable device id. Profiles are GenosDB nodes keyed by that address;
// every write is signed by the SM and verified by peers. This replaces the
// former Gun + KeyService + StorageService + device-fingerprint stack.
import { db } from './gdbServices'

export interface UserProfile {
  id: string
  username: string
  customUsername?: string
  displayName: string
  showRealName?: boolean
  avatarId?: string
  avatarThumbnail?: string
  bio: string
  createdAt: number
  karma: number
  postCount: number
  commentCount: number
  publicKey?: string
}

export interface UserStats {
  totalPosts: number
  totalComments: number
  totalUpvotes: number
  totalDownvotes: number
  karma: number
  joinedCommunities: number
}

export class UserService {
  private static currentUser: UserProfile | null = null

  /** Read the SM role for an address from the `user:<address>` node (defaults to 'guest'). */
  static async getRole(address: string): Promise<string> {
    if (!address) return 'guest'
    const { result } = await db.get(`user:${address}`)
    return (result?.value?.role as string) || 'guest'
  }

  /**
   * Increments `postCount` on the active identity's SM role node (`user:<address>`)
   * so the governance engine can evaluate the member -> trusted rule. Spreads the
   * existing value — `db.put` replaces the whole node, so `role`/`ethAddress` must
   * be preserved (per the GenosDB governance docs).
   */
  static async recordGovernancePost(): Promise<void> {
    const address = db.sm.getActiveEthAddress()
    if (!address) return
    const id = `user:${address}`
    const { result } = await db.get(id)
    const current = (result?.value as Record<string, any>) ?? { ethAddress: address, role: 'guest' }
    await db.put({ ...current, postCount: (current.postCount || 0) + 1 }, id)
  }

  /** Read a profile node by address. */
  private static async readProfile(address: string): Promise<UserProfile | null> {
    const { result } = await db.get(address)
    return (result?.value && result.value.id) ? (result.value as UserProfile) : null
  }

  /**
   * Persist a profile as an ACL-owned node (owner = the profile's address = the
   * active identity), so no other peer can delete or overwrite it. `karma` is
   * derived from signed votes and never stored; the ACL bookkeeping fields
   * (`owner`/`collaborators`) are managed by the SM, so all three are stripped.
   */
  private static async writeProfile(profile: UserProfile): Promise<void> {
    const { karma, owner, collaborators, ...persisted } =
      profile as UserProfile & { owner?: string; collaborators?: unknown }
    await db.sm.acls.set({ type: 'user', ...persisted }, profile.id)
  }

  /**
   * Returns the profile of the currently signed-in identity, creating a minimal
   * one on first use. Returns `null` when no identity is active (zero-trust:
   * acting requires a signing key).
   */
  static async getCurrentUser(forceRefresh = false): Promise<UserProfile | null> {
    const address = db.sm.getActiveEthAddress()
    if (!address) return null

    // The cache is only valid for the active identity — after logout + a new
    // login the address changes, and a stale profile must never be returned.
    if (this.currentUser?.id === address && !forceRefresh) return this.currentUser

    const existing = await this.readProfile(address)
    if (existing) {
      this.currentUser = existing
      return this.currentUser
    }

    const short = address.slice(2, 10)
    const username = `user_${short}`
    const newProfile: UserProfile = {
      id: address,
      username,
      displayName: `User ${short}`,
      bio: '',
      createdAt: Date.now(),
      karma: 0,
      postCount: 0,
      commentCount: 0,
      publicKey: address,
    }
    await this.writeProfile(newProfile)
    this.currentUser = newProfile
    return newProfile
  }

  /** Like getCurrentUser, but with derived karma attached (for the profile views). */
  static async getCurrentUserWithKarma(forceRefresh = false): Promise<UserProfile | null> {
    const user = await this.getCurrentUser(forceRefresh)
    if (!user) return null
    return { ...user, karma: await this.getKarma(user.id) }
  }

  static async updateProfile(updates: Partial<UserProfile>): Promise<UserProfile> {
    const base = this.currentUser || await this.getCurrentUser()
    if (!base) throw new Error('Cannot update profile: no active identity')

    const updated: UserProfile = { ...base, ...updates }
    this.currentUser = updated
    await this.writeProfile(updated)
    return updated
  }

  static async getUser(userId: string): Promise<UserProfile | null> {
    return this.readProfile(userId)
  }

  static getDisplayUsername(profile: UserProfile): string {
    return profile.customUsername || profile.username
  }

  static async incrementPostCount() {
    const user = this.currentUser || await this.getCurrentUser()
    if (user) await this.updateProfile({ postCount: (user.postCount || 0) + 1 })
  }

  static async incrementCommentCount() {
    const user = this.currentUser || await this.getCurrentUser()
    if (user) await this.updateProfile({ commentCount: (user.commentCount || 0) + 1 })
  }

  /**
   * Derive a user's karma from signed votes: the net (up − down) across every vote
   * on their posts and comments — the same way post/comment scores are derived.
   * Karma is never written onto another user's node, so profiles can be ACL-owned.
   * Two-step join (votes don't carry the author): find the user's content ids,
   * then aggregate the votes that reference them.
   */
  static async getKarma(userId: string): Promise<number> {
    if (!userId) return 0
    const [posts, comments] = await Promise.all([
      db.map({ query: { type: 'post', authorId: userId } }),
      db.map({ query: { type: 'comment', authorId: userId } }),
    ])
    const postIds = posts.results.map((n: { value: { id: string } }) => n.value.id)
    const commentIds = comments.results.map((n: { value: { id: string } }) => n.value.id)
    if (!postIds.length && !commentIds.length) return 0

    const voteQueries: Promise<{ results: Array<{ value: { direction?: string } }> }>[] = []
    if (postIds.length) voteQueries.push(db.map({ query: { type: 'postVote', postId: { $in: postIds } } }))
    if (commentIds.length) voteQueries.push(db.map({ query: { type: 'commentVote', commentId: { $in: commentIds } } }))

    let karma = 0
    for (const { results } of await Promise.all(voteQueries)) {
      for (const n of results) karma += n.value.direction === 'up' ? 1 : -1
    }
    return karma
  }

  static async getUserStats(userId: string): Promise<UserStats> {
    const user = await this.getUser(userId)
    if (!user) {
      return { totalPosts: 0, totalComments: 0, totalUpvotes: 0, totalDownvotes: 0, karma: 0, joinedCommunities: 0 }
    }
    const karma = await this.getKarma(userId)
    return {
      totalPosts: user.postCount || 0,
      totalComments: user.commentCount || 0,
      totalUpvotes: karma,
      totalDownvotes: 0,
      karma,
      joinedCommunities: 0,
    }
  }

  static async searchUsers(query: string): Promise<UserProfile[]> {
    const { results } = await db.map({ query: { type: 'user' } })
    return results
      .map(node => node.value as UserProfile)
      .filter(u => u?.username?.includes(query) || u?.customUsername?.includes(query))
  }
}
