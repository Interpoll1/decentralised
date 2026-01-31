// src/services/postService.ts
import { GunService } from './gunService';
import { IPFSService } from './ipfsService';

export interface Post {
  id: string;
  communityId: string;
  authorId: string;
  authorName: string;
  title: string;
  content: string;
  imageIPFS?: string;
  imageThumbnail?: string;
  createdAt: number;
  upvotes: number;
  downvotes: number;
  score: number;
  commentCount: number;
}

export class PostService {
  static async createPost(
    post: Omit<Post, 'id' | 'createdAt' | 'upvotes' | 'downvotes' | 'score' | 'commentCount'>,
    imageFile?: File
  ): Promise<Post> {
    let imageData;
    if (imageFile) {
      imageData = await IPFSService.uploadImage(imageFile);
    }

    const newPost: Post = {
      id: `post-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      communityId: post.communityId || '',
      authorId: post.authorId || '',
      authorName: post.authorName || 'Anonymous',
      title: post.title || '',
      content: post.content || '',
      imageIPFS: imageData?.cid || '',
      imageThumbnail: imageData?.thumbnail || '',
      createdAt: Date.now(),
      upvotes: 0,
      downvotes: 0,
      score: 0,
      commentCount: 0,
    };

    const cleanPost: any = {
      id: newPost.id,
      communityId: newPost.communityId,
      authorId: newPost.authorId,
      authorName: newPost.authorName,
      title: newPost.title,
      content: newPost.content,
      createdAt: newPost.createdAt,
      upvotes: newPost.upvotes,
      downvotes: newPost.downvotes,
      score: newPost.score,
      commentCount: newPost.commentCount,
    };

    if (newPost.imageIPFS) cleanPost.imageIPFS = newPost.imageIPFS;
    if (newPost.imageThumbnail) cleanPost.imageThumbnail = newPost.imageThumbnail;

    const gun = GunService.getGun();

    await GunService.put(`posts/${newPost.id}`, cleanPost);

    await new Promise<void>((resolve, reject) => {
      gun.get('posts').get(newPost.id).put(cleanPost, (ack: any) => {
        if (ack.err) reject(ack.err);
        else resolve();
      });
    });

    await new Promise<void>((resolve, reject) => {
      gun.get('communities').get(newPost.communityId).get('posts').get(newPost.id).put(cleanPost, (ack: any) => {
        if (ack.err) reject(ack.err);
        else resolve();
      });
    });

    return newPost;
  }

  static subscribeToPostsInCommunity(communityId: string, callback: (post: Post) => void) {
    const gun = GunService.getGun();
    const processedKeys = new Set<string>();

    gun.get('communities').get(communityId).get('posts').map().once((data: any, key: string) => {
      if (!data || !data.id || !data.title || key.startsWith('_')) return;
      if (processedKeys.has(key)) return;
      processedKeys.add(key);

      const cleanPost: Post = {
        id: data.id || '',
        communityId: data.communityId || communityId,
        authorId: data.authorId || '',
        authorName: data.authorName || 'Anonymous',
        title: data.title || '',
        content: data.content || '',
        imageIPFS: data.imageIPFS || undefined,
        imageThumbnail: data.imageThumbnail || undefined,
        createdAt: data.createdAt || Date.now(),
        upvotes: data.upvotes || 0,
        downvotes: data.downvotes || 0,
        score: data.score || 0,
        commentCount: data.commentCount || 0,
      };

      callback(cleanPost);
    });
  }

  static async getAllPostsInCommunity(communityId: string): Promise<Post[]> {
    const gun = GunService.getGun();
    const posts: Post[] = [];
    const seen = new Set<string>();

    return new Promise((resolve) => {
      gun.get('communities').get(communityId).get('posts').map().once((data: any, key: string) => {
        if (!data || !data.id || !data.title || seen.has(data.id)) return;
        seen.add(data.id);

        const post: Post = {
          id: data.id || '',
          communityId: data.communityId || communityId,
          authorId: data.authorId || '',
          authorName: data.authorName || 'Anonymous',
          title: data.title || '',
          content: data.content || '',
          imageIPFS: data.imageIPFS || undefined,
          imageThumbnail: data.imageThumbnail || undefined,
          createdAt: data.createdAt || Date.now(),
          upvotes: data.upvotes || 0,
          downvotes: data.downvotes || 0,
          score: data.score || 0,
          commentCount: data.commentCount || 0,
        };

        posts.push(post);
      });

      setTimeout(() => resolve(posts), 800);
    });
  }

  static async getPost(postId: string): Promise<Post | null> {
    const gun = GunService.getGun();

    return new Promise((resolve) => {
      let resolved = false;

      gun.get('posts').get(postId).once((data: any) => {
        if (!resolved && data && data.id) {
          resolved = true;

          const post: Post = {
            id: data.id || '',
            communityId: data.communityId || '',
            authorId: data.authorId || '',
            authorName: data.authorName || 'Anonymous',
            title: data.title || '',
            content: data.content || '',
            imageIPFS: data.imageIPFS || undefined,
            imageThumbnail: data.imageThumbnail || undefined,
            createdAt: data.createdAt || Date.now(),
            upvotes: data.upvotes || 0,
            downvotes: data.downvotes || 0,
            score: data.score || 0,
            commentCount: data.commentCount || 0,
          };

          resolve(post);
        }
      });

      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          resolve(null);
        }
      }, 3000);
    });
  }

  static async incrementCommentCount(postId: string, communityId: string): Promise<void> {
    const gun = GunService.getGun();

    const current = await new Promise<number>((resolve) => {
      let resolved = false;
      gun.get('posts').get(postId).get('commentCount').once((val: any) => {
        if (!resolved) {
          resolved = true;
          resolve(typeof val === 'number' ? val : Number(val) || 0);
        }
      });
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          resolve(0);
        }
      }, 500);
    });

    const next = current + 1;

    await Promise.all([
      gun.get('posts').get(postId).get('commentCount').put(next),
      gun.get('communities').get(communityId).get('posts').get(postId).get('commentCount').put(next),
    ]);
  }

  static async voteOnPost(postId: string, direction: 'up' | 'down', userId: string): Promise<void> {
    // Delegate to user-specific vote setter to avoid double-counting
    await this.setUserVote(postId, direction, userId);
  }

  /**
   * Remove a user's vote (up or down) from a post.
   * This is used by the store when toggling votes off.
   */
  static async removeVote(postId: string, direction: 'up' | 'down', userId: string): Promise<void> {
    await this.setUserVote(postId, 'none', userId);
  }

  /**
   * Set a user's vote on a post to up, down, or none.
   * Ensures that multiple clicks from the same user do not inflate counts.
   */
  private static async setUserVote(
    postId: string,
    direction: 'up' | 'down' | 'none',
    userId: string,
  ): Promise<void> {
    const gun = GunService.getGun();

    const post = await this.getPost(postId);
    if (!post) return;

    // Read previous vote state for this user
    const prevDirection: 'up' | 'down' | 'none' = await new Promise((resolve) => {
      gun
        .get('postVotes')
        .get(postId)
        .get(userId)
        .once((v: any) => {
          if (v === 'up' || v === 'down') resolve(v);
          else resolve('none');
        });
    });

    if (prevDirection === direction) {
      // No change; avoid double counting
      return;
    }

    let upvotes = post.upvotes || 0;
    let downvotes = post.downvotes || 0;

    // Remove previous vote effect
    if (prevDirection === 'up') upvotes = Math.max(0, upvotes - 1);
    if (prevDirection === 'down') downvotes = Math.max(0, downvotes - 1);

    // Apply new vote effect
    if (direction === 'up') upvotes += 1;
    if (direction === 'down') downvotes += 1;

    const score = upvotes - downvotes;

    await Promise.all([
      gun.get('posts').get(postId).get('upvotes').put(upvotes),
      gun.get('posts').get(postId).get('downvotes').put(downvotes),
      gun.get('posts').get(postId).get('score').put(score),
      gun
        .get('communities')
        .get(post.communityId)
        .get('posts')
        .get(postId)
        .get('upvotes')
        .put(upvotes),
      gun
        .get('communities')
        .get(post.communityId)
        .get('posts')
        .get(postId)
        .get('downvotes')
        .put(downvotes),
      gun
        .get('communities')
        .get(post.communityId)
        .get('posts')
        .get(postId)
        .get('score')
        .put(score),
      gun
        .get('postVotes')
        .get(postId)
        .get(userId)
        .put(direction === 'none' ? null : direction),
    ]);
  }
}