import { GunService } from './gunService';
import { VoteTrackerService } from './voteTrackerService';
import { KeyService } from './keyService';
import { StorageService } from './storageService';
import type { TrustLevel } from './trustService';
import { parseIdentityTrust } from '@/utils/identityTrust';

const PROFILE_META_KEY = 'user-profile';

export interface UserProfile {
  id: string;
  username: string;
  customUsername?: string;
  trustLevel?: TrustLevel;
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
  publicKey?: string;
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
  private static currentUser: UserProfile | null = null;

  private static deriveIdentityFields(
    profileLike: Partial<UserProfile>,
  ): Pick<UserProfile, 'identityUsername' | 'identityIssuer' | 'identityTrustLevel'> {
    const identityUsername = (profileLike.identityUsername || profileLike.customUsername || profileLike.username || '').trim();
    const trust = parseIdentityTrust(identityUsername);
    return {
      identityUsername: trust.identityUsername,
      identityIssuer: trust.issuer,
      identityTrustLevel: trust.trustLevel,
    };
  }

  static async getCurrentUser(forceRefresh = false): Promise<UserProfile> {
    if (this.currentUser && !forceRefresh) return this.currentUser;

    const stored = await StorageService.getMetadata(PROFILE_META_KEY).catch(() => null);
    if (stored && stored.id) {
      this.currentUser = stored as UserProfile;
      return this.currentUser;
    }

    const deviceId = await VoteTrackerService.getDeviceId();
    const gun = GunService.getGun();
    const publicKey = await KeyService.getPublicKeyHex();

    const existingProfile = await new Promise<UserProfile | null>((resolve) => {
      let done = false;
      gun.get('users').get(deviceId).once((data: any) => {
        if (!done) {
          done = true;
          resolve(data && data.id ? (data as UserProfile) : null);
        }
      });
      setTimeout(() => {
        if (!done) {
          done = true;
          resolve(null);
        }
      }, 3000);
    });

    if (existingProfile) {
      const derived = this.deriveIdentityFields(existingProfile);
      const profile: UserProfile = {
        ...existingProfile,
        publicKey: existingProfile.publicKey || publicKey,
        ...derived,
      };
      await gun.get('users').get(deviceId).put(profile);
      await StorageService.setMetadata(PROFILE_META_KEY, profile);
      this.currentUser = profile;
      return profile;
    }

    const username = `user_${deviceId.substring(0, 8)}`;
    const newProfile: UserProfile = {
      id: deviceId,
      username,
      displayName: `User ${deviceId.substring(0, 8)}`,
      bio: '',
      createdAt: Date.now(),
      karma: 0,
      postCount: 0,
      commentCount: 0,
      publicKey,
      ...this.deriveIdentityFields({ username }),
    };

    await gun.get('users').get(deviceId).put(newProfile);
    await StorageService.setMetadata(PROFILE_META_KEY, newProfile);
    this.currentUser = newProfile;

    return newProfile;
  }

  static async updateProfile(updates: Partial<UserProfile>): Promise<UserProfile> {
    const base = this.currentUser || await this.getCurrentUser();
    const mergedProfile: UserProfile = { ...base, ...updates };
    const derivedIdentity = this.deriveIdentityFields(mergedProfile);
    const updatedProfile: UserProfile = {
      ...mergedProfile,
      identityUsername: mergedProfile.identityUsername ?? derivedIdentity.identityUsername,
      identityIssuer: mergedProfile.identityIssuer ?? derivedIdentity.identityIssuer,
      identityTrustLevel: mergedProfile.identityTrustLevel ?? derivedIdentity.identityTrustLevel,
    };

    this.currentUser = updatedProfile;
    await StorageService.setMetadata(PROFILE_META_KEY, updatedProfile);

    const gun = GunService.getGun();
    await gun.get('users').get(updatedProfile.id).put(updatedProfile);

    return updatedProfile;
  }

  static async getUser(userId: string): Promise<UserProfile | null> {
    const gun = GunService.getGun();
    return new Promise((resolve) => {
      let done = false;
      gun.get('users').get(userId).once((data: any) => {
        if (!done) {
          done = true;
          resolve(data && data.id ? (data as UserProfile) : null);
        }
      });
      setTimeout(() => {
        if (!done) {
          done = true;
          resolve(null);
        }
      }, 3000);
    });
  }

  static getDisplayUsername(profile: UserProfile): string {
    return profile.customUsername || profile.username;
  }

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
      const updatedKarma = (user.karma || 0) + points;
      await gun.get('users').get(authorId).get('karma').put(updatedKarma);
      if (this.currentUser && this.currentUser.id === authorId) {
        await this.updateProfile({ karma: updatedKarma });
      }
    }
  }

  static async getUserStats(userId: string): Promise<UserStats> {
    const user = await this.getUser(userId);
    if (!user) {
      return {
        totalPosts: 0,
        totalComments: 0,
        totalUpvotes: 0,
        totalDownvotes: 0,
        karma: 0,
        joinedCommunities: 0,
      };
    }
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
        if (user.username?.includes(query) || user.customUsername?.includes(query)) {
          users.push(user as UserProfile);
        }
      });
      setTimeout(() => resolve(users), 1000);
    });
  }
}
