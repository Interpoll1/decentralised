// src/services/userService.ts
import { GunService } from './gunService';
import { VoteTrackerService } from './voteTrackerService';

export interface UserProfile {
  id: string; // Device fingerprint
  username: string;
  displayName: string;
  avatarIPFS?: string;
  avatarThumbnail?: string;
  bio: string;
  createdAt: number;
  karma: number; // Total upvotes received
  postCount: number;
  commentCount: number;
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

  // Initialize or get current user
  static async getCurrentUser(): Promise<UserProfile> {
    if (this.currentUser) return this.currentUser;

    const deviceId = await VoteTrackerService.getDeviceId();
    const gun = GunService.getGun();

    // Try to load existing profile
    const existingProfile = await gun.get('users').get(deviceId).once().then();

    if (existingProfile && !existingProfile._) {
      this.currentUser = existingProfile;
      return existingProfile;
    }

    // Create new profile
    const newProfile: UserProfile = {
      id: deviceId,
      username: `user_${deviceId.substring(0, 8)}`,
      displayName: `User ${deviceId.substring(0, 8)}`,
      bio: '',
      createdAt: Date.now(),
      karma: 0,
      postCount: 0,
      commentCount: 0
    };

    await gun.get('users').get(deviceId).put(newProfile);
    this.currentUser = newProfile;

    return newProfile;
  }

  // Update user profile
  static async updateProfile(updates: Partial<UserProfile>): Promise<UserProfile> {
    const gun = GunService.getGun();
    const currentUser = await this.getCurrentUser();

    const updatedProfile = { ...currentUser, ...updates };
    await gun.get('users').get(currentUser.id).put(updatedProfile);

    this.currentUser = updatedProfile;
    return updatedProfile;
  }

  // Get user by ID
  static async getUser(userId: string): Promise<UserProfile | null> {
    const gun = GunService.getGun();
    return await gun.get('users').get(userId).once().then();
  }

  // Increment post count
  static async incrementPostCount() {
    const user = await this.getCurrentUser();
    await this.updateProfile({ postCount: user.postCount + 1 });
  }

  // Increment comment count
  static async incrementCommentCount() {
    const user = await this.getCurrentUser();
    await this.updateProfile({ commentCount: user.commentCount + 1 });
  }

  // Increment karma (when someone upvotes your content)
  static async incrementKarma(authorId: string, points: number = 1) {
    const gun = GunService.getGun();
    const user = await this.getUser(authorId);
    
    if (user) {
      await gun.get('users').get(authorId).get('karma').put(user.karma + points);
    }
  }

  // Get user stats
  static async getUserStats(userId: string): Promise<UserStats> {
    const user = await this.getUser(userId);
    
    if (!user) {
      return {
        totalPosts: 0,
        totalComments: 0,
        totalUpvotes: 0,
        totalDownvotes: 0,
        karma: 0,
        joinedCommunities: 0
      };
    }

    // Stats derived from stored user data
    return {
      totalPosts: user.postCount,
      totalComments: user.commentCount,
      totalUpvotes: user.karma,
      totalDownvotes: 0,
      karma: user.karma,
      joinedCommunities: 0
    };
  }

  // Search users by username
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