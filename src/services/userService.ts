// src/services/userService.ts
import { GunService } from './gunService';
import { VoteTrackerService } from './voteTrackerService';
import { KeyService } from './keyService';

export interface UserProfile {
  id: string;
  username: string;
  displayName: string;
  customUsername?: string;
  showRealName?: boolean;
  avatarIPFS?: string;
  avatarThumbnail?: string;
  bio: string;
  createdAt: number;
  karma: number;
  postCount: number;
  commentCount: number;
  publicKey?: string; // ← Schnorr public key (safe to share)
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
  private static writeQueues = new Map<string, Promise<void>>();

  private static async enqueueWrite<T>(userId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.writeQueues.get(userId) ?? Promise.resolve();
    const run = previous.then(task, task);
    const queueTail = run.then(() => undefined, () => undefined);
    this.writeQueues.set(userId, queueTail);
    try {
      return await run;
    } finally {
      if (this.writeQueues.get(userId) === queueTail) {
        this.writeQueues.delete(userId);
      }
    }
  }

  static async getCurrentUser(forceRefresh = false): Promise<UserProfile> {
    if (this.currentUser && !forceRefresh) return this.currentUser;

    const deviceId = await VoteTrackerService.getDeviceId();
    const gun = GunService.getGun();

    const existingProfile = await new Promise<any>((resolve) => {
      let resolved = false;
      let listener: any;
      listener = gun.get('users').get(deviceId).on((data: any) => {
        if (!resolved && data && !data._ && data.id) {
          resolved = true;
          listener?.off?.();
          resolve(data);
        }
      });
      setTimeout(() => {
        if (!resolved) { resolved = true; listener?.off?.(); resolve(null); }
      }, 3000);
    });

    // Get this device's public key to store/backfill
    const publicKey = await KeyService.getPublicKeyHex();

    if (existingProfile) {
      // Backfill publicKey if it's missing from an older profile
      if (!existingProfile.publicKey) {
        await gun.get('users').get(deviceId).get('publicKey').put(publicKey);
        existingProfile.publicKey = publicKey;
      }
      this.currentUser = existingProfile;
      return existingProfile;
    }

    if (this.currentUser) return this.currentUser;

    // Create new profile — include publicKey from the start
    const newProfile: UserProfile = {
      id: deviceId,
      username: `user_${deviceId.substring(0, 8)}`,
      displayName: `User ${deviceId.substring(0, 8)}`,
      bio: '',
      createdAt: Date.now(),
      karma: 0,
      postCount: 0,
      commentCount: 0,
      publicKey, // ← stored in GunDB so other users can fetch it
    };

    await gun.get('users').get(deviceId).put(newProfile);
    this.currentUser = newProfile;

    return newProfile;
  }

  static async updateProfile(updates: Partial<UserProfile>): Promise<UserProfile> {
    const gun = GunService.getGun();
    const currentUser = await this.getCurrentUser();

    return this.enqueueWrite(currentUser.id, async () => {
      const baseProfile = this.currentUser?.id === currentUser.id
        ? this.currentUser
        : await this.getUser(currentUser.id) ?? currentUser;
      const updatedProfile = { ...baseProfile, ...updates };
      await gun.get('users').get(currentUser.id).put(updatedProfile);

      this.currentUser = updatedProfile;
      return updatedProfile;
    });
  }

  static async getUser(userId: string): Promise<UserProfile | null> {
    const gun = GunService.getGun();
    return await gun.get('users').get(userId).once().then();
  }

  static async incrementPostCount() {
    const user = await this.getCurrentUser(true);
    await this.enqueueWrite(user.id, async () => {
      const latestUser = await this.getUser(user.id) ?? user;
      const nextPostCount = (latestUser.postCount || 0) + 1;
      await GunService.getGun().get('users').get(user.id).get('postCount').put(nextPostCount);
      this.currentUser = {
        ...(this.currentUser?.id === user.id ? this.currentUser : latestUser),
        postCount: nextPostCount,
      };
    });
  }

  static async incrementCommentCount() {
    const user = await this.getCurrentUser(true);
    await this.enqueueWrite(user.id, async () => {
      const latestUser = await this.getUser(user.id) ?? user;
      const nextCommentCount = (latestUser.commentCount || 0) + 1;
      await GunService.getGun().get('users').get(user.id).get('commentCount').put(nextCommentCount);
      this.currentUser = {
        ...(this.currentUser?.id === user.id ? this.currentUser : latestUser),
        commentCount: nextCommentCount,
      };
    });
  }

  static async incrementKarma(authorId: string, points: number = 1) {
    if (!points) return;
    await this.enqueueWrite(authorId, async () => {
      const user = await this.getUser(authorId);
      if (!user) return;
      const nextKarma = (user.karma || 0) + points;
      await GunService.getGun().get('users').get(authorId).get('karma').put(nextKarma);
      if (this.currentUser?.id === authorId) {
        this.currentUser = { ...this.currentUser, karma: nextKarma };
      }
    });
  }

  static async getUserStats(userId: string): Promise<UserStats> {
    const user = await this.getUser(userId);
    if (!user) {
      return { totalPosts: 0, totalComments: 0, totalUpvotes: 0, totalDownvotes: 0, karma: 0, joinedCommunities: 0 };
    }
    return {
      totalPosts: user.postCount,
      totalComments: user.commentCount,
      totalUpvotes: user.karma,
      totalDownvotes: 0,
      karma: user.karma,
      joinedCommunities: 0,
    };
  }

  static async searchUsers(query: string): Promise<UserProfile[]> {
    const gun = GunService.getGun();
    const users: UserProfile[] = [];
    return new Promise((resolve) => {
      gun.get('users').map().once((user: any) => {
        if (user && !user._ && user.username?.includes(query)) {
          users.push(user);
        }
      });
      setTimeout(() => resolve(users), 1000);
    });
  }
}
