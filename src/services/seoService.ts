import { GunService } from './gunService';
import type { Post } from './postService';
import type { Poll } from './pollService';

export class SEOService {
  private static gun = GunService.getGun();

  /**
   * Fetch a post by ID for SEO rendering
   */
  static async getPostForSEO(postId: string): Promise<Post | null> {
    return new Promise((resolve) => {
      let resolved = false;
      
      this.gun.get('posts').get(postId).once((data: any) => {
        if (resolved) return;
        resolved = true;
        
        if (!data?.id || !data?.title) {
          resolve(null);
          return;
        }

        resolve({
          id: data.id,
          communityId: data.communityId || '',
          authorId: data.authorId || '',
          authorName: data.authorName || 'Anonymous',
          title: data.title,
          content: data.content || '',
          imageIPFS: data.imageIPFS || undefined,
          imageThumbnail: data.imageThumbnail || undefined,
          createdAt: data.createdAt || Date.now(),
          upvotes: data.upvotes || 0,
          downvotes: data.downvotes || 0,
          score: data.score || 0,
          commentCount: data.commentCount || 0,
        });
      });

      // Timeout after 3 seconds
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          resolve(null);
        }
      }, 3000);
    });
  }

  /**
   * Fetch a poll by ID for SEO rendering
   */
  static async getPollForSEO(pollId: string): Promise<Poll | null> {
    return new Promise((resolve) => {
      let resolved = false;

      this.gun.get('polls').get(pollId).once(async (data: any) => {
        if (resolved) return;
        resolved = true;

        if (!data?.id || !data?.question) {
          resolve(null);
          return;
        }

        // Load options in parallel
        const options = await this.loadPollOptions(pollId, data.communityId);

        resolve({
          id: data.id,
          communityId: data.communityId || '',
          authorId: data.authorId || '',
          authorName: data.authorName || 'Anonymous',
          question: data.question,
          description: data.description || '',
          options: options || [],
          createdAt: data.createdAt || Date.now(),
          expiresAt: data.expiresAt || Date.now(),
          allowMultipleChoices: !!data.allowMultipleChoices,
          showResultsBeforeVoting: !!data.showResultsBeforeVoting,
          requireLogin: !!data.requireLogin,
          isPrivate: !!data.isPrivate,
          totalVotes: data.totalVotes || 0,
          isExpired: Date.now() > (data.expiresAt ?? 0),
        });
      });

      // Timeout after 3 seconds
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          resolve(null);
        }
      }, 3000);
    });
  }

  /**
   * Get all posts for sitemap generation
   */
  static async getAllPostsForSitemap(): Promise<Array<{ id: string; createdAt: number }>> {
    return new Promise((resolve) => {
      const posts: Array<{ id: string; createdAt: number }> = [];
      let received = false;

      this.gun.get('posts').map().once((data: any, key: string) => {
        if (!data?.id || key.startsWith('_')) return;
        posts.push({ id: data.id, createdAt: data.createdAt || Date.now() });
      });

      // Collect for 1 second then resolve
      setTimeout(() => {
        if (!received) {
          received = true;
          resolve(posts);
        }
      }, 1000);
    });
  }

  /**
   * Get all polls for sitemap generation
   */
  static async getAllPollsForSitemap(): Promise<Array<{ id: string; createdAt: number }>> {
    return new Promise((resolve) => {
      const polls: Array<{ id: string; createdAt: number }> = [];
      let received = false;

      this.gun.get('polls').map().once((data: any, key: string) => {
        if (!data?.id || key.startsWith('_')) return;
        polls.push({ id: data.id, createdAt: data.createdAt || Date.now() });
      });

      // Collect for 1 second then resolve
      setTimeout(() => {
        if (!received) {
          received = true;
          resolve(polls);
        }
      }, 1000);
    });
  }

  private static async loadPollOptions(
    pollId: string,
    communityId: string
  ): Promise<any[] | null> {
    return new Promise((resolve) => {
      let resolved = false;

      this.gun
        .get('polls')
        .get(pollId)
        .get('options')
        .once((data: any) => {
          if (resolved) return;
          resolved = true;

          if (!data || typeof data !== 'object') {
            resolve(null);
            return;
          }

          const keys = Object.keys(data)
            .filter((k) => !k.startsWith('_'))
            .sort((a, b) => Number(a) - Number(b));

          if (keys.length === 0) {
            resolve([]);
            return;
          }

          const options: any[] = [];
          for (const k of keys) {
            const val = data[k];
            options.push({
              id: val?.id ?? '',
              text: val?.text ?? '',
              votes: val?.votes ?? 0,
              voters: [],
            });
          }
          resolve(options);
        });

      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          resolve(null);
        }
      }, 2000);
    });
  }
}

interface Poll {
  id: string;
  communityId: string;
  authorId: string;
  authorName: string;
  question: string;
  description?: string;
  options: any[];
  createdAt: number;
  expiresAt: number;
  allowMultipleChoices: boolean;
  showResultsBeforeVoting: boolean;
  requireLogin: boolean;
  isPrivate: boolean;
  totalVotes: number;
  isExpired: boolean;
}