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

  /** Persist a profile node, signed by the active SM identity. */
  private static async writeProfile(profile: UserProfile): Promise<void> {
    await db.put({ type: 'user', ...profile }, profile.id)
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
   * Bumps an author's karma. Note: in a strict zero-trust model karma is best
   * derived from signed votes rather than written onto another user's node;
   * kept here for behavioural parity and revisited in the voting slice.
   */
  static async incrementKarma(authorId: string, points = 1) {
    const author = await this.getUser(authorId)
    if (!author) return
    const updatedKarma = (author.karma || 0) + points
    if (this.currentUser && this.currentUser.id === authorId) {
      await this.updateProfile({ karma: updatedKarma })
    } else {
      await this.writeProfile({ ...author, karma: updatedKarma })
    }
  }

  static async getUserStats(userId: string): Promise<UserStats> {
    const user = await this.getUser(userId)
    if (!user) {
      return { totalPosts: 0, totalComments: 0, totalUpvotes: 0, totalDownvotes: 0, karma: 0, joinedCommunities: 0 }
    }
    return {
      totalPosts: user.postCount || 0,
      totalComments: user.commentCount || 0,
      totalUpvotes: user.karma || 0,
      totalDownvotes: 0,
      karma: user.karma || 0,
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
