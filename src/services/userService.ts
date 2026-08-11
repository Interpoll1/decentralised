// src/services/userService.ts

import { GunService } from './gunService';
import { VoteTrackerService } from './voteTrackerService';
import { KeyService } from './keyService';
import { CryptoService } from './cryptoService';
import { StorageService } from './storageService';
import { parseIdentityTrust } from '@/utils/identityTrust';
import { gunPut, gunReadChildren } from '../utils/gunAsync';
import type { TrustLevel } from './trustService';

const PROFILE_META_KEY = 'user-profile-v2';

export interface UserProfile {
  id: string;                          // public key hex (durable identity)
  deviceId?: string;                   // legacy field, kept for migration compat
  username: string;
  customUsername?: string;
  trustLevel?: TrustLevel;            // kept from v1 for compat
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

/**
 * Sum per-voter karma-event leaves into an author's karma total. Pure — the
 * whole counting rule lives here, same shape as `PostVoteService.foldVotes`.
 * Each `(voterId, sourceId)` pair has its own leaf, so two people voting on
 * the same author at the same moment write to different keys and cannot
 * clobber each other — summing the leaves (instead of adding to a shared
 * `karma` scalar) cannot lose a vote's contribution.
 */
export function foldKarmaEvents(entries: Iterable<{ value: unknown }>): number {
  let total = 0;
  for (const { value } of Array.from(entries)) {
    const v = value && typeof value === 'object' ? Number((value as any).value) : NaN;
    if (v === 1 || v === -1) total += v;
  }
  return total;
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

  /**
   * Secondary reverse index: pubkey → publicKey pointer, stored under the
   * dedicated `user-pubkey-index` Gun root. Best-effort only (Gun has no
   * cross-node transactions), so `getUserByPubkey` falls back to a scan.
   * Written lazily whenever a profile is touched — no bulk backfill.
   */
  private static writePubkeyIndex(pubkey: string | undefined): void {
    if (!pubkey) return;
    try {
      const gun = GunService.getGun();
      // In v2, identity is keyed by publicKey, so the index entry just
      // confirms the key exists and timestamps the last touch.
      gun.get('user-pubkey-index').get(pubkey).put({ publicKey: pubkey, updatedAt: Date.now() });
    } catch {
      // Secondary index is best-effort; a failed write degrades to a scan, not a break.
    }
  }

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
        this.writePubkeyIndex(profile.publicKey);
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
      this.writePubkeyIndex(signed.publicKey);
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
    this.writePubkeyIndex(signed.publicKey);
    return signed;
  }

  /**
   * Update own profile fields.
   * Signs the updated profile before writing to Gun so peers can verify ownership.
   */
  /**
   * Serializes `updateProfile` calls so two near-simultaneous updates (e.g. two
   * tabs posting at once) queue instead of both reading the same base and
   * clobbering each other's field. This is the same read-modify-write race as
   * the other counters, just within one device instead of across devices —
   * `postCount`/`commentCount` are the fields it actually matters for, since
   * every other field here is a full replacement, not an increment.
   */
  private static profileWriteQueue: Promise<unknown> = Promise.resolve();

  static async updateProfile(updates: Partial<UserProfile>): Promise<UserProfile> {
    const run = async (): Promise<UserProfile> => {
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
      this.writePubkeyIndex(signed.publicKey);

      return signed;
    };

    const result = this.profileWriteQueue.then(run, run);
    // Keep the queue alive even if this update fails, but never let one
    // rejection wedge every update after it.
    this.profileWriteQueue = result.catch(() => {});
    return result;
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

    // Karma is derived from per-voter event leaves, not trusted from the
    // signed scalar on the profile — see setKarmaEvent/getKarma. This overlay
    // does not touch the signature: it corrects what's displayed, the same way
    // withKnownTally overlays a post's vote counts without re-signing anything.
    const karma = await this.getKarma(userId).catch(() => null);

    return { ...(profile as UserProfile), ...(karma !== null ? { karma } : {}) };
  }

  /**
   * Resolve a profile by its Schnorr public key.
   *
   * In v2, the Gun node is already keyed by publicKey, so this is typically
   * equivalent to getUser(pubkey). The `user-pubkey-index` pointer is checked
   * first for forward-compat with any legacy deviceId-keyed nodes that were
   * migrated and left a pointer behind, then falls back to a direct lookup,
   * then to a full scan.
   */
  static async getUserByPubkey(pubkey: string): Promise<UserProfile | null> {
    if (!pubkey) return null;
    const gun = GunService.getGun();

    // Check the reverse index for a legacy deviceId pointer
    const pointer = await new Promise<{ deviceId?: string; publicKey?: string } | null>((resolve) => {
      let done = false;
      gun.get('user-pubkey-index').get(pubkey).once((data: any) => {
        if (!done) {
          done = true;
          resolve(data && (data.deviceId || data.publicKey) ? data : null);
        }
      });
      setTimeout(() => { if (!done) { done = true; resolve(null); } }, 3000);
    });

    // If the pointer carries a legacy deviceId, try that node first
    if (pointer?.deviceId && pointer.deviceId !== pubkey) {
      const profile = await this.getUser(pointer.deviceId);
      if (profile) return profile;
    }

    // Direct lookup — v2 nodes are keyed by publicKey
    const direct = await this.getUser(pubkey);
    if (direct) return direct;

    // Last resort: full scan
    return this.findUserByPubkeyScan(pubkey);
  }

  private static async findUserByPubkeyScan(pubkey: string): Promise<UserProfile | null> {
    const gun = GunService.getGun();
    return new Promise((resolve) => {
      let found: UserProfile | null = null;
      gun.get('users').map().once((user: any) => {
        if (found || !user || user._ || !user.id) return;
        if (user.publicKey === pubkey && verifyProfileSignature(user)) {
          found = user as UserProfile;
        }
      });
      setTimeout(() => resolve(found), 1000);
    });
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

  private static karmaEventsNode(authorId: string) {
    return GunService.getGun().get('karmaEvents').get(authorId);
  }

  /**
   * Record this voter's karma contribution to one source (a specific post or
   * comment), or clear it. Each `(voterId, sourceId)` pair gets its own leaf,
   * so two people voting on the same author around the same moment write to
   * different keys and cannot clobber each other. A vote flip or clear simply
   * overwrites this voter's own leaf with the new value — idempotent, and safe
   * to retry. This mirrors the per-user vote/membership nodes used for post,
   * comment and poll counts.
   *
   * The old version read `user.karma`, added `points`, and wrote the sum back
   * as a single scalar. Two people voting on the same author within one round
   * trip both read the same N and both wrote N+1 (or, worse, the "other user"
   * write path had no ack or retry at all), so votes on someone else's karma
   * were routinely lost.
   */
  static async setKarmaEvent(authorId: string, voterId: string, sourceId: string, value: -1 | 0 | 1): Promise<void> {
    if (!authorId || !voterId || !sourceId) return;
    const key = `${voterId}_${sourceId}`;
    const ack = await gunPut(this.karmaEventsNode(authorId).get(key), { voterId, sourceId, value, at: Date.now() });
    if (!ack.ok && ack.err !== 'timeout') {
      console.warn('[UserService] karma event write failed:', ack.err);
    }
    // Advisory mirror for readers that render a profile before its karma
    // events load. Never authoritative — getKarma()/getUser() below always
    // prefer the derived sum. Only the profile owner can sign their own node,
    // so this stays unsigned and best-effort for everyone else's profile.
    void this.refreshKarmaHint(authorId).catch(() => {});
  }

  /** Sum of this author's karma-event leaves — the authoritative karma total. */
  static async getKarma(authorId: string): Promise<number> {
    if (!authorId) return 0;
    const events = await gunReadChildren<any>(this.karmaEventsNode(authorId), { minMs: 300, maxMs: 3_000 });
    return foldKarmaEvents(events);
  }

  /** Mirror the derived karma total onto the profile as a hint (unsigned, best-effort). */
  private static async refreshKarmaHint(authorId: string): Promise<void> {
    const karma = await this.getKarma(authorId);
    if (this.currentUser?.publicKey === authorId) {
      // Own profile: go through updateProfile so the signature stays valid.
      await this.updateProfile({ karma });
      return;
    }
    void gunPut(GunService.getGun().get('users').get(authorId).get('karma'), karma).catch(() => {});
  }

  /**
   * Set this voter's karma contribution toward `authorId` for one source
   * (a post or comment id), replacing any previous contribution from the same
   * voter+source pair. `points` is the new net value for that pair (-1, 0, or
   * 1) — callers already compute the delta between the old and new vote state
   * themselves (see `karmaFor` in postStore/commentStore); this just needs the
   * resulting sign.
   */
  static async incrementKarma(authorId: string, voterId: string, sourceId: string, points: -1 | 0 | 1): Promise<void> {
    if (!authorId || authorId === voterId) return; // no self-karma
    await this.setKarmaEvent(authorId, voterId, sourceId, points);
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
        if (!user || user._ || !user.id) return;
        if (
          user.username?.includes(query) ||
          user.customUsername?.includes(query)
        ) {
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
