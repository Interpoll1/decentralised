// src/services/postService.ts
//
// DIAGNOSIS (from logs):
// - Empty communities (c-eddd, c-pierredupuy) hit MAX_WAIT_MS (16s) because
//   Gun's internal graph events keep trickling, preventing silence timer from
//   firing. Promise.all blocks on the slowest = 16s total wait.
// - Posts arrive at 22ms but "done" was firing at 6261ms under old approach.
//
// THE FIX: Replace silence timer with a hard INITIAL_LOAD_MS time-box.
// Resolve after 800ms regardless. Subscription stays alive — new items stream
// in and the store's sorted computed automatically puts them at the top.
// Empty communities cost exactly 800ms, not 16s.

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

const postActiveListeners = new Map<string, any>();

/** Max posts to deliver during initial load — keeps the UI snappy. */
const MAX_INITIAL_POSTS = 50;

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

    await new Promise<void>((resolve, reject) => {
      gun.get('posts').get(newPost.id).put(cleanPost, (ack: any) => {
        if (ack.err) reject(new Error(ack.err)); else resolve();
      });
    });
    await new Promise<void>((resolve, reject) => {
      gun.get('communities').get(newPost.communityId).get('posts').get(newPost.id).put(cleanPost, (ack: any) => {
        if (ack.err) reject(new Error(ack.err)); else resolve();
      });
    });

    return newPost;
  }

  /**
   * Subscribe to posts in a community.
   *
   * Phase 1 (initial): .once() snapshot — collects all cached/relay posts,
   *   sorts by recency, and delivers only the most recent MAX_INITIAL_POSTS.
   *   This avoids flooding the Vue reactivity system with thousands of items.
   *
   * Phase 2 (live): .on() subscription — only fires for genuinely new posts
   *   that weren't in the initial snapshot (deduplicated via `seen` set).
   *
   * Returns an unsubscribe function. Call it to stop live updates.
   */
  static subscribeToPostsInCommunity(
    communityId: string,
    onPost: (post: Post) => void,
    onInitialLoadDone?: () => void,
  ): () => void {
    const gun = GunService.getGun();
    const seen = new Set<string>();

    const existing = postActiveListeners.get(communityId);
    if (existing) {
      existing.off();
      postActiveListeners.delete(communityId);
    }

    let initialDone = false;
    const signalDone = () => {
      if (initialDone) return;
      initialDone = true;
      onInitialLoadDone?.();
    };

    // Phase 1: snapshot with .once() — collect, sort, cap
    const initialBatch: Post[] = [];
    const postsNode = gun
      .get('communities')
      .get(communityId)
      .get('posts');

    postsNode.map().once((data: any, key: string) => {
      if (!data || !data.id || !data.title || key.startsWith('_')) return;
      if (seen.has(data.id)) return;
      seen.add(data.id);
      initialBatch.push(this.mapPost(data, communityId));
    });

    // After time-box: sort by recency, deliver only top N, then start live sub
    let liveListener: any = null;
    const initTimer = setTimeout(() => {
      // Sort newest-first and deliver only the most recent posts
      initialBatch.sort((a, b) => b.createdAt - a.createdAt);
      const toDeliver = initialBatch.slice(0, MAX_INITIAL_POSTS);
      toDeliver.forEach(onPost);

      signalDone();

      // Phase 2: live subscription for NEW posts only
      liveListener = postsNode.map().on((data: any, key: string) => {
        if (!data || !data.id || !data.title || key.startsWith('_')) return;
        if (seen.has(data.id)) return;
        seen.add(data.id);
        onPost(this.mapPost(data, communityId));
      });

      postActiveListeners.set(communityId, liveListener);
    }, 800);

    return () => {
      clearTimeout(initTimer);
      signalDone();
      if (liveListener) liveListener.off();
      postActiveListeners.delete(communityId);
    };
  }

  private static mapPost(data: any, communityId: string): Post {
    return {
      id: data.id,
      communityId: data.communityId || communityId,
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
    };
  }

  /** @deprecated use subscribeToPostsInCommunity */
  static getAllPostsInCommunity(communityId: string): Promise<Post[]> {
    return new Promise((resolve) => {
      const posts: Post[] = [];
      const unsub = this.subscribeToPostsInCommunity(
        communityId,
        (post) => posts.push(post),
        () => { unsub(); resolve(posts); },
      );
    });
  }

  static async getPost(postId: string): Promise<Post | null> {
    const gun = GunService.getGun();
    return new Promise((resolve) => {
      let resolved = false;
      gun.get('posts').get(postId).once((data: any) => {
        if (!resolved && data?.id) {
          resolved = true;
          resolve({
            id: data.id,
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
          });
        }
      });
      setTimeout(() => { if (!resolved) { resolved = true; resolve(null); } }, 3000);
    });
  }

  static async incrementCommentCount(postId: string, communityId: string): Promise<void> {
    const gun = GunService.getGun();
    const current = await new Promise<number>((resolve) => {
      let resolved = false;
      gun.get('posts').get(postId).get('commentCount').once((val: any) => {
        if (!resolved) { resolved = true; resolve(typeof val === 'number' ? val : Number(val) || 0); }
      });
      setTimeout(() => { if (!resolved) { resolved = true; resolve(0); } }, 500);
    });
    const next = current + 1;
    await new Promise<void>((r) => gun.get('posts').get(postId).get('commentCount').put(next, () => r()));
    await new Promise<void>((r) => gun.get('communities').get(communityId).get('posts').get(postId).get('commentCount').put(next, () => r()));
  }

  static async voteOnPost(postId: string, direction: 'up' | 'down', userId: string): Promise<void> {
    await this.setUserVote(postId, direction, userId);
  }

  static async removeVote(postId: string, direction: 'up' | 'down', userId: string): Promise<void> {
    await this.setUserVote(postId, 'none', userId);
  }

  private static async setUserVote(postId: string, direction: 'up' | 'down' | 'none', userId: string): Promise<void> {
    const gun = GunService.getGun();
    const post = await this.getPost(postId);
    if (!post) return;

    const prevDirection: 'up' | 'down' | 'none' = await new Promise((resolve) => {
      let resolved = false;
      gun.get('postVotes').get(postId).get(userId).once((v: any) => {
        if (!resolved) { resolved = true; resolve(v === 'up' || v === 'down' ? v : 'none'); }
      });
      setTimeout(() => { if (!resolved) { resolved = true; resolve('none'); } }, 1000);
    });

    if (prevDirection === direction) return;

    let upvotes = post.upvotes || 0;
    let downvotes = post.downvotes || 0;
    if (prevDirection === 'up') upvotes = Math.max(0, upvotes - 1);
    if (prevDirection === 'down') downvotes = Math.max(0, downvotes - 1);
    if (direction === 'up') upvotes += 1;
    if (direction === 'down') downvotes += 1;

    const score = upvotes - downvotes;
    const voteValue = direction === 'none' ? '' : direction;
    const put = (node: any, value: any) => new Promise<void>((r) => node.put(value, () => r()));

    await Promise.all([
      put(gun.get('posts').get(postId).get('upvotes'), upvotes),
      put(gun.get('posts').get(postId).get('downvotes'), downvotes),
      put(gun.get('posts').get(postId).get('score'), score),
      put(gun.get('communities').get(post.communityId).get('posts').get(postId).get('upvotes'), upvotes),
      put(gun.get('communities').get(post.communityId).get('posts').get(postId).get('downvotes'), downvotes),
      put(gun.get('communities').get(post.communityId).get('posts').get(postId).get('score'), score),
      put(gun.get('postVotes').get(postId).get(userId), voteValue),
    ]);
  }
}
