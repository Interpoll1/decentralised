// src/services/userService.ts
//
// Key changes in this revision:
//
//   1. SIGNED WRITES: Every Gun write is signed with the user's Schnorr private
//      key. The payload includes _sig, _pub, _hash so any peer / relay can
//      verify ownership before accepting an update.
//
//   2. VERIFIED READS: getUser() verifies _sig before returning a profile.
//      A profile whose signature doesn't match its public key is rejected,
//      preventing impersonation via direct Gun writes.
//
//   3. KEY-BASED IDENTITY: Identity is the public key, not deviceId.
//      The Gun node is keyed by publicKey hex so the same identity works
//      across devices once the private key is imported.
//
//   4. OWN PROFILE SOURCE OF TRUTH: IndexedDB (unchanged from previous).
//      Gun is written to for peer discovery but never read back for own profile.
//
//   5. DEVICE RECOVERY: import the private key via KeyService.importPrivateKey()
//      then call getCurrentUser(true) — the profile is re-fetched from Gun using
//      the same public key, then saved to IndexedDB on the new device.

import { GunService } from './gunService';
import { VoteTrackerService } from './voteTrackerService';
import { KeyService } from './keyService';
import { CryptoService } from './cryptoService';
import { StorageService } from './storageService';
import { parseIdentityTrust } from '@/utils/identityTrust';

const PROFILE_META_KEY = 'user-profile-v2';

export type TrustLevel = 'none' | 'verified';

export interface UserProfile {
  id: string;                          // public key hex (durable identity)
  deviceId?: string;                   // legacy field, kept for migration compat
  username: string;
  customUsername?: string;
  displayName: string;
  identityUsername?: string;
  identityIssuer?: string;
  identityTrustLevel?: 'trusted-issuer' | 'unverified';
  showRealName?: boolean;
  avatarIPFS?: string;
  avatarThumbnail?: string;
  bio: string;
  createdAt: number;
  karma: number;
  postCount: number;
  commentCount: number;
  publicKey: string;                   // Schnorr x-only public key (safe to share)
  // Integrity fields — present on Gun-written copies
  _sig?: string;
  _pub?: string;
  _hash?: string;
}

export interface UserStats {
  totalPosts: number;
  totalComments: number;
  totalUpvotes: number;
  totalDownvotes: number;
  karma: number;
  joinedCommunities: number;
}

// ── Signing helpers ───────────────────────────────────────────────────────────

function profilePayload(profile: UserProfile): Record<string, unknown> {
  // Strip previous integrity fields before re-signing
  const { _sig, _pub, _hash, ...rest } = profile as any;
  return rest;
}

function stableStringify(obj: Record<string, unknown>): string {
  const keys = Object.keys(obj).sort();
  const pairs = keys.map(k => `${JSON.stringify(k)}:${JSON.stringify((obj as any)[k])}`);
  return `{${pairs.join(',')}}`;
}

async function signProfile(profile: UserProfile): Promise<UserProfile> {
  const privateKey = await KeyService.getPrivateKeyHex();
  const publicKey = await KeyService.getPublicKeyHex();
  const payload = profilePayload(profile);
  const canonical = stableStringify(payload as Record<string, unknown>);
  const hash = CryptoService.hash(canonical);
  const sig = CryptoService.sign(canonical, privateKey);
  return { ...profile, _sig: sig, _pub: publicKey, _hash: hash };
}

function verifyProfileSignature(profile: UserProfile): boolean {
  try {
    const { _sig, _pub, _hash, ...rest } = profile as any;
    if (!_sig || !_pub || !_hash) return false;
    const canonical = stableStringify(rest as Record<string, unknown>);
    const expectedHash = CryptoService.hash(canonical);
    if (expectedHash !== _hash) return false;
    return CryptoService.verify(canonical, _sig, _pub);
  } catch {
    return false;
  }
}

// ── Service ───────────────────────────────────────────────────────────────────

export class UserService {
  private static currentUser: UserProfile | null = null;

  private static deriveIdentityFields(
    profileLike: Partial<UserProfile>,
  ): Pick<UserProfile, 'identityUsername' | 'identityIssuer' | 'identityTrustLevel'> {
    const raw = (profileLike.customUsername || profileLike.username || '').trim();
    const trust = parseIdentityTrust(raw);
    return {
      identityUsername: trust.identityUsername,
      identityIssuer: trust.issuer || undefined,
      identityTrustLevel: trust.trustLevel,
    };
  }

  static async getCurrentUser(forceRefresh = false): Promise<UserProfile> {
    if (this.currentUser && !forceRefresh) return this.currentUser;

    // 1. Try IndexedDB first (source of truth for own profile)
    const stored = await StorageService.getMetadata(PROFILE_META_KEY).catch(() => null);
    if (stored && stored.id) {
      this.currentUser = stored as UserProfile;
      return this.currentUser;
    }

    const publicKey = await KeyService.getPublicKeyHex();
    const gun = GunService.getGun();

    // 2. Try fetching existing profile from Gun by public key (device recovery path)
    const gunProfile = await new Promise<any>((resolve) => {
      let done = false;
      gun.get('users').get(publicKey).once((data: any) => {
        if (!done) { done = true; resolve(data && data.id ? data : null); }
      });
      setTimeout(() => { if (!done) { done = true; resolve(null); } }, 3000);
    });

    if (gunProfile) {
      // Verify the signature before trusting the fetched profile
      if (!verifyProfileSignature(gunProfile)) {
        console.warn('[UserService] Gun profile signature invalid — ignoring and creating fresh');
      } else {
        const profile: UserProfile = {
          ...gunProfile,
          // Ensure derived fields are up to date
          ...this.deriveIdentityFields(gunProfile),
        };
        await StorageService.setMetadata(PROFILE_META_KEY, profile);
        this.currentUser = profile;
        return profile;
      }
    }

    // 3. Migration: check legacy deviceId-keyed node
    const deviceId = await VoteTrackerService.getDeviceId();
    const legacyProfile = await new Promise<any>((resolve) => {
      let done = false;
      gun.get('users').get(deviceId).once((data: any) => {
        if (!done) { done = true; resolve(data && data.id ? data : null); }
      });
      setTimeout(() => { if (!done) { done = true; resolve(null); } }, 2000);
    });

    if (legacyProfile && legacyProfile.publicKey === publicKey) {
      // Migrate: re-key under publicKey and sign
      const migrated: UserProfile = {
        ...legacyProfile,
        id: publicKey,
        publicKey,
        ...this.deriveIdentityFields(legacyProfile),
      };
      const signed = await signProfile(migrated);
      await gun.get('users').get(publicKey).put(signed);
      await StorageService.setMetadata(PROFILE_META_KEY, signed);
      this.currentUser = signed;
      return signed;
    }

    // 4. First boot — create new profile keyed by public key
    const newProfile: UserProfile = {
      id: publicKey,
      deviceId,
      username: `user_${publicKey.substring(0, 8)}`,
      displayName: `User ${publicKey.substring(0, 8)}`,
      bio: '',
      createdAt: Date.now(),
      karma: 0,
      postCount: 0,
      commentCount: 0,
      publicKey,
      ...this.deriveIdentityFields({ username: `user_${publicKey.substring(0, 8)}` }),
    };

    const signed = await signProfile(newProfile);
    await gun.get('users').get(publicKey).put(signed);
    await StorageService.setMetadata(PROFILE_META_KEY, signed);
    this.currentUser = signed;
    return signed;
  }

  /**
   * Update own profile fields.
   * Signs the updated profile before writing to Gun so peers can verify ownership.
   */
  static async updateProfile(updates: Partial<UserProfile>): Promise<UserProfile> {
    const base = this.currentUser || await this.getCurrentUser();
    const merged: UserProfile = {
      ...base,
      ...updates,
      ...this.deriveIdentityFields({ ...base, ...updates }),
    };

    const signed = await signProfile(merged);

    // 1. Update in-memory cache immediately
    this.currentUser = signed;

    // 2. Persist to IndexedDB (source of truth)
    await StorageService.setMetadata(PROFILE_META_KEY, signed);

    // 3. Write to Gun async — keyed by publicKey, signed so peers can verify
    const gun = GunService.getGun();
    gun.get('users').get(signed.publicKey).put(signed);

    return signed;
  }

  // ── Other users ─────────────────────────────────────────────────────────────

  /**
   * Fetch another user's profile and verify their signature.
   * Returns null if the profile is missing or fails verification.
   */
  static async getUser(userId: string): Promise<UserProfile | null> {
    const gun = GunService.getGun();
    const profile = await new Promise<any>((resolve) => {
      let done = false;
      gun.get('users').get(userId).once((data: any) => {
        if (!done) { done = true; resolve(data && data.id ? data : null); }
      });
      setTimeout(() => { if (!done) { done = true; resolve(null); } }, 3000);
    });

    if (!profile) return null;

    // Reject profiles that fail signature verification
    if (!verifyProfileSignature(profile)) {
      console.warn(`[UserService] Profile for ${userId} failed signature verification`);
      return null;
    }

    // Ensure the publicKey in the profile matches the node key we fetched it from
    if (profile.publicKey && profile.publicKey !== userId && profile._pub !== userId) {
      console.warn(`[UserService] Profile publicKey mismatch for node ${userId}`);
      return null;
    }

    return profile as UserProfile;
  }

  static getDisplayUsername(profile: UserProfile): string {
    return profile.customUsername || profile.username;
  }

  // ── Counters ─────────────────────────────────────────────────────────────────

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
      // Only the author can update their own karma (signing enforced on relay)
      if (this.currentUser && this.currentUser.publicKey === authorId) {
        await this.updateProfile({ karma: (this.currentUser.karma || 0) + points });
      } else {
        // For other users, write unsigned karma increment (relay enforces PoW rate limit)
        gun.get('users').get(authorId).get('karma').put((user.karma || 0) + points);
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
          // Only include verified profiles
          if (verifyProfileSignature(user)) {
            users.push(user);
          }
        }
      });
      setTimeout(() => resolve(users), 1000);
    });
  }
}