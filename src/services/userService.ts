// src/services/userService.ts
//
// Key design decisions vs original:
//
//   1. OWN PROFILE: stored in IndexedDB (via StorageService) as source of truth.
//      Gun is written to for peer discovery but NEVER read back for own profile.
//      This kills the Gun localStorage-cache race that caused profile to flicker
//      and revert after writes.
//
//   2. OTHER PROFILES: still read from Gun (unchanged behaviour).
//
//   3. updateProfile(): merges into in-memory cache directly, persists to
//      IndexedDB synchronously, writes to Gun async (fire-and-forget).
//      No stale-cache spread because we never re-read Gun for own profile.
//
//   4. getCurrentUser(forceRefresh): forceRefresh now reads from IndexedDB,
//      not Gun — so it always gets the latest written value immediately.

import { GunService } from './gunService';
import { VoteTrackerService } from './voteTrackerService';
import { KeyService } from './keyService';
import { StorageService } from './storageService';
import type { TrustLevel } from './trustService';

const PROFILE_META_KEY = 'own-user-profile';

export interface UserProfile {
  id: string;
  username: string;           // auto-generated fallback (user_xxxxxxxx)
  customUsername?: string;    // user-chosen via ClaimUsernamePage
  trustLevel?: TrustLevel;    // 'none' | 'verified'
  displayName: string;
  showRealName?: boolean;
  avatarIPFS?: string;
  avatarThumbnail?: string;
  bio: string;
  createdAt: number;
  karma: number;
  postCount: number;
  commentCount: number;
  publicKey?: string;         // Schnorr x-only public key (safe to share)
}

export interface UserStats {
  totalPosts: number;
  totalComments: number;
  totalUpvotes: number;
  totalDownvotes: number;
  karma: number;
  joinedCommunities: number;
}

export class UserService {
  // In-memory cache — always reflects the latest written state.
  private static currentUser: UserProfile | null = null;

  // ── Own profile ────────────────────────────────────────────────────────────

  /**
   * Get the current user's profile.
   *
   * Priority: in-memory cache → IndexedDB → Gun (first boot only).
   * forceRefresh skips the in-memory cache but still reads IndexedDB, not Gun.
   * This means reads are always instant and never race with Gun's local cache.
   */
  static async getCurrentUser(forceRefresh = false): Promise<UserProfile> {
    if (this.currentUser && !forceRefresh) return this.currentUser;

    // 1. Try IndexedDB (our source of truth for own profile)
    const stored = await StorageService.getMetadata(PROFILE_META_KEY).catch(() => null);
    if (stored && stored.id) {
      this.currentUser = stored as UserProfile;
      return this.currentUser;
    }

    // 2. First boot: read from Gun to migrate existing profile
    const deviceId = await VoteTrackerService.getDeviceId();
    const gun = GunService.getGun();
    const publicKey = await KeyService.getPublicKeyHex();

    const gunProfile = await new Promise<any>((resolve) => {
      let done = false;
      // Use .once() — we want a single snapshot, not a live subscription.
      // Gun .once() returns whatever it has locally or from the network.
      gun.get('users').get(deviceId).once((data: any) => {
        if (!done) { done = true; resolve(data && data.id ? data : null); }
      });
      // Fallback timeout in case Gun returns nothing
      setTimeout(() => { if (!done) { done = true; resolve(null); } }, 3000);
    });

    let profile: UserProfile;

    if (gunProfile) {
      profile = { ...gunProfile, publicKey: gunProfile.publicKey || publicKey };
    } else {
      // Brand new user
      profile = {
        id: deviceId,
        username: `user_${deviceId.substring(0, 8)}`,
        displayName: `User ${deviceId.substring(0, 8)}`,
        bio: '',
        createdAt: Date.now(),
        karma: 0,
        postCount: 0,
        commentCount: 0,
        publicKey,
        trustLevel: 'none',
      };
      // Write to Gun so peers can discover this user
      gun.get('users').get(deviceId).put(profile);
    }

    // Persist to IndexedDB so future reads are instant and Gun-independent
    await StorageService.setMetadata(PROFILE_META_KEY, profile).catch(() => {});
    this.currentUser = profile;
    return profile;
  }

  /**
   * Update own profile fields.
   * - Merges into in-memory cache immediately (no re-fetch, no stale spread).
   * - Persists to IndexedDB synchronously (source of truth).
   * - Writes to Gun async so peers see the update (fire-and-forget).
   */
  static async updateProfile(updates: Partial<UserProfile>): Promise<UserProfile> {
    // Use cached profile directly — never re-read from Gun here
    const base = this.currentUser || await this.getCurrentUser();
    const updated: UserProfile = { ...base, ...updates };

    // 1. Update in-memory cache immediately so any subsequent call sees it
    this.currentUser = updated;

    // 2. Persist to IndexedDB (source of truth, instant on next read)
    await StorageService.setMetadata(PROFILE_META_KEY, updated).catch(() => {});

    // 3. Write to Gun async for peer visibility (don't await — don't block UI)
    const gun = GunService.getGun();
    gun.get('users').get(updated.id).put(updated);

    return updated;
  }

  // ── Other users ────────────────────────────────────────────────────────────

  static async getUser(userId: string): Promise<UserProfile | null> {
    const gun = GunService.getGun();
    return new Promise((resolve) => {
      let done = false;
      gun.get('users').get(userId).once((data: any) => {
        if (!done) { done = true; resolve(data && data.id ? data : null); }
      });
      setTimeout(() => { if (!done) { done = true; resolve(null); } }, 3000);
    });
  }

  static getDisplayUsername(profile: UserProfile): string {
    return profile.customUsername || profile.username;
  }

  // ── Counters (still Gun-backed, that's fine for non-critical fields) ──────

  static async incrementPostCount() {
    const user = this.currentUser || await this.getCurrentUser();
    await this.updateProfile({ postCount: (user.postCount || 0) + 1 });
  }

  static async incrementCommentCount() {
    const user = this.currentUser || await this.getCurrentUser();
    await this.updateProfile({ commentCount: (user.commentCount || 0) + 1 });
  }

  static async incrementKarma(authorId: string, points = 1) {
    const gun = GunService.getGun();
    const user = await this.getUser(authorId);
    if (user) {
      gun.get('users').get(authorId).get('karma').put((user.karma || 0) + points);
      // If it's our own karma, also update local cache
      if (this.currentUser && this.currentUser.id === authorId) {
        await this.updateProfile({ karma: (this.currentUser.karma || 0) + points });
      }
    }
  }

  static async getUserStats(userId: string): Promise<UserStats> {
    const user = await this.getUser(userId);
    if (!user) return { totalPosts: 0, totalComments: 0, totalUpvotes: 0, totalDownvotes: 0, karma: 0, joinedCommunities: 0 };
    return {
      totalPosts: user.postCount || 0,
      totalComments: user.commentCount || 0,
      totalUpvotes: user.karma || 0,
      totalDownvotes: 0,
      karma: user.karma || 0,
      joinedCommunities: 0,
    };
  }

  static async searchUsers(query: string): Promise<UserProfile[]> {
    const gun = GunService.getGun();
    const users: UserProfile[] = [];
    return new Promise((resolve) => {
      gun.get('users').map().once((user: any) => {
        if (user && !user._ && (
          user.username?.includes(query) ||
          user.customUsername?.includes(query)
        )) {
          users.push(user);
        }
      });
      setTimeout(() => resolve(users), 1000);
    });
  }
}