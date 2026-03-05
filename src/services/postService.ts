import { GunService } from './gunService';
import { IPFSService } from './ipfsService';
import { isVersionEnabled } from '../utils/dataVersionSettings';

const API_URL = import.meta.env.VITE_API_URL || 'https://interpoll.onrender.com';

export interface Post {
  id: string;
  communityId: string;
  authorId: string;
  authorName: string;
  authorShowRealName?: boolean;
  title: string;
  content: string;
  imageIPFS?: string;
  imageThumbnail?: string;
  createdAt: number;
  upvotes: number;
  downvotes: number;
  score: number;
  commentCount: number;
  /** Client-side only — which GunDB namespace this post came from */
  dataVersion?: 'v1' | 'v2';
}

const postActiveListeners = new Map<string, any>();
const MAX_INITIAL_POSTS = 50;

async function indexForSearch(type: 'post' | 'poll', id: string, data: any) {
  try {
    await fetch(`${API_URL}/api/index`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ type, id, data })
    });
  } catch (err) {
    console.warn('Search indexing failed:', err);
  }
}

export class PostService {
  static async createPost(
    post: Omit<Post, 'id' | 'createdAt' | 'upvotes' | 'downvotes' | 'score' | 'commentCount'>,
    imageFile?: File,
    preGeneratedId?: string
  ): Promise<Post> {
    let imageData;
    if (imageFile) {
      imageData = await IPFSService.uploadImage(imageFile);
    }

    const newPost: Post = {
      id: preGeneratedId || `post-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      communityId: post.communityId || '',
      authorId: post.authorId || '',
      authorName: post.authorName || 'Anonymous',
      authorShowRealName: post.authorShowRealName || false,
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
      authorShowRealName: newPost.authorShowRealName,
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

    await indexForSearch('post', newPost.id, {
      title: newPost.title,
      content: newPost.content,
      authorName: newPost.authorName,
      communitySlug: newPost.communityId,
      createdAt: newPost.createdAt
    });

    return newPost;
  }

  static subscribeToPostsInCommunity(
    communityId: string,
    onPost: (post: Post) => void,
    onInitialLoadDone?: () => void
  ): () => void {
    const gun = GunService.getGun();
    const communityPostsNode = gun.get('communities').get(communityId).get('posts');

    const seenIds = new Set<string>();
    const collectedPosts: Post[] = [];
    let initialLoadDone = false;
    let subscription: any;
    let v1Subscription: any;
    let pendingLoads = 1; // v2 always loads

    const checkLoadComplete = () => {
      if (initialLoadDone) return;
      pendingLoads--;
      if (pendingLoads > 0) return;
      initialLoadDone = true;
      if (onInitialLoadDone) onInitialLoadDone();
    };

    const timeboxTimer = setTimeout(() => {
      if (!initialLoadDone) {
        pendingLoads = 0;
        checkLoadComplete();
      }
    }, 800);

    // ── v2 posts (namespaced, current) ───────────────────────────────────
    communityPostsNode.once((allPosts: any) => {
      if (!allPosts) {
        checkLoadComplete();
        return;
      }

      const keys = Object.keys(allPosts).filter(k => k !== '_');
      const promises = keys.slice(0, MAX_INITIAL_POSTS).map(postId =>
        new Promise<void>((resolve) => {
          gun.get('posts').get(postId).once((postData: any) => {
            if (postData && postData.id && !seenIds.has(postData.id)) {
              seenIds.add(postData.id);
              collectedPosts.push({ ...postData, dataVersion: 'v2' });
            }
            resolve();
          });
        })
      );

      Promise.all(promises).then(() => {
        collectedPosts.sort((a, b) => b.createdAt - a.createdAt);
        collectedPosts.forEach(p => onPost(p));
        checkLoadComplete();
      });
    });

    subscription = communityPostsNode.on((allPosts: any) => {
      if (!allPosts) return;
      Object.keys(allPosts).forEach(postId => {
        if (postId === '_' || seenIds.has(postId)) return;
        gun.get('posts').get(postId).once((postData: any) => {
          if (postData && postData.id && !seenIds.has(postData.id)) {
            seenIds.add(postData.id);
            onPost({ ...postData, dataVersion: 'v2' });
          }
        });
      });
    });

    // ── v1 posts (root-level, legacy) ────────────────────────────────────
    if (isVersionEnabled('v1')) {
      pendingLoads++;
      const rawGun = GunService.getRawGun();
      const v1Node = rawGun.get('communities').get(communityId).get('posts');

      v1Node.once((allPosts: any) => {
        if (!allPosts) {
          checkLoadComplete();
          return;
        }

        const keys = Object.keys(allPosts).filter(k => k !== '_');
        const v1Collected: Post[] = [];
        const promises = keys.slice(0, MAX_INITIAL_POSTS).map(postId =>
          new Promise<void>((resolve) => {
            rawGun.get('posts').get(postId).once((postData: any) => {
              if (postData && postData.id && !seenIds.has(postData.id)) {
                seenIds.add(postData.id);
                v1Collected.push({ ...postData, dataVersion: 'v1' });
              }
              resolve();
            });
          })
        );

        Promise.all(promises).then(() => {
          v1Collected.sort((a, b) => b.createdAt - a.createdAt);
          v1Collected.forEach(p => onPost(p));
          checkLoadComplete();
        });
      });

      v1Subscription = v1Node.on((allPosts: any) => {
        if (!allPosts) return;
        Object.keys(allPosts).forEach(postId => {
          if (postId === '_' || seenIds.has(postId)) return;
          rawGun.get('posts').get(postId).once((postData: any) => {
            if (postData && postData.id && !seenIds.has(postData.id)) {
              seenIds.add(postData.id);
              onPost({ ...postData, dataVersion: 'v1' });
            }
          });
        });
      });
    }

    const listenerKey = `${communityId}-posts`;
    postActiveListeners.set(listenerKey, { subscription, v1Subscription, timer: timeboxTimer });

    return () => {
      clearTimeout(timeboxTimer);
      if (subscription) subscription.off();
      if (v1Subscription) v1Subscription.off();
      postActiveListeners.delete(listenerKey);
    };
  }

  static subscribeToAllPosts(
    onPost: (post: Post) => void,
    onInitialLoadDone?: () => void
  ): () => void {
    const gun = GunService.getGun();
    const postsNode = gun.get('posts');

    const seenIds = new Set<string>();
    const collectedPosts: Post[] = [];
    let initialLoadDone = false;
    let subscription: any;
    let v1Subscription: any;
    let pendingLoads = 1;

    const checkLoadComplete = () => {
      if (initialLoadDone) return;
      pendingLoads--;
      if (pendingLoads > 0) return;
      initialLoadDone = true;
      if (onInitialLoadDone) onInitialLoadDone();
    };

    const timeboxTimer = setTimeout(() => {
      if (!initialLoadDone) {
        pendingLoads = 0;
        checkLoadComplete();
      }
    }, 800);

    // ── v2 posts ─────────────────────────────────────────────────────────
    postsNode.once((allPosts: any) => {
      if (!allPosts) {
        checkLoadComplete();
        return;
      }

      const keys = Object.keys(allPosts).filter(k => k !== '_');
      const promises = keys.slice(0, MAX_INITIAL_POSTS).map(postId =>
        new Promise<void>((resolve) => {
          gun.get('posts').get(postId).once((postData: any) => {
            if (postData && postData.id && !seenIds.has(postData.id)) {
              seenIds.add(postData.id);
              collectedPosts.push({ ...postData, dataVersion: 'v2' });
            }
            resolve();
          });
        })
      );

      Promise.all(promises).then(() => {
        collectedPosts.sort((a, b) => b.createdAt - a.createdAt);
        collectedPosts.forEach(p => onPost(p));
        checkLoadComplete();
      });
    });

    subscription = postsNode.on((allPosts: any) => {
      if (!allPosts) return;
      Object.keys(allPosts).forEach(postId => {
        if (postId === '_' || seenIds.has(postId)) return;
        gun.get('posts').get(postId).once((postData: any) => {
          if (postData && postData.id && !seenIds.has(postData.id)) {
            seenIds.add(postData.id);
            onPost({ ...postData, dataVersion: 'v2' });
          }
        });
      });
    });

    // ── v1 posts ─────────────────────────────────────────────────────────
    if (isVersionEnabled('v1')) {
      pendingLoads++;
      const rawGun = GunService.getRawGun();
      const v1PostsNode = rawGun.get('posts');

      v1PostsNode.once((allPosts: any) => {
        if (!allPosts) {
          checkLoadComplete();
          return;
        }

        const keys = Object.keys(allPosts).filter(k => k !== '_');
        const v1Collected: Post[] = [];
        const promises = keys.slice(0, MAX_INITIAL_POSTS).map(postId =>
          new Promise<void>((resolve) => {
            rawGun.get('posts').get(postId).once((postData: any) => {
              if (postData && postData.id && !seenIds.has(postData.id)) {
                seenIds.add(postData.id);
                v1Collected.push({ ...postData, dataVersion: 'v1' });
              }
              resolve();
            });
          })
        );

        Promise.all(promises).then(() => {
          v1Collected.sort((a, b) => b.createdAt - a.createdAt);
          v1Collected.forEach(p => onPost(p));
          checkLoadComplete();
        });
      });

      v1Subscription = v1PostsNode.on((allPosts: any) => {
        if (!allPosts) return;
        Object.keys(allPosts).forEach(postId => {
          if (postId === '_' || seenIds.has(postId)) return;
          rawGun.get('posts').get(postId).once((postData: any) => {
            if (postData && postData.id && !seenIds.has(postData.id)) {
              seenIds.add(postData.id);
              onPost({ ...postData, dataVersion: 'v1' });
            }
          });
        });
      });
    }

    const listenerKey = 'all-posts';
    postActiveListeners.set(listenerKey, { subscription, v1Subscription, timer: timeboxTimer });

    return () => {
      clearTimeout(timeboxTimer);
      if (subscription) subscription.off();
      if (v1Subscription) v1Subscription.off();
      postActiveListeners.delete(listenerKey);
    };
  }

  static async getPost(postId: string): Promise<Post | null> {
    const gun = GunService.getGun();
    return new Promise((resolve) => {
      gun.get('posts').get(postId).once((postData: any) => {
        if (postData && postData.id) {
          resolve(postData);
        } else {
          resolve(null);
        }
      });
    });
  }

  static async updatePost(postId: string, updates: Partial<Post>): Promise<void> {
    const gun = GunService.getGun();
    const cleanUpdates: any = {};
    Object.keys(updates).forEach(key => {
      if (key !== 'id' && updates[key as keyof Post] !== undefined) {
        cleanUpdates[key] = updates[key as keyof Post];
      }
    });

    await new Promise<void>((resolve, reject) => {
      gun.get('posts').get(postId).put(cleanUpdates, (ack: any) => {
        if (ack.err) reject(new Error(ack.err)); else resolve();
      });
    });
  }

  static async deletePost(postId: string, communityId: string): Promise<void> {
    const gun = GunService.getGun();
    await new Promise<void>((resolve, reject) => {
      gun.get('posts').get(postId).put(null, (ack: any) => {
        if (ack.err) reject(new Error(ack.err)); else resolve();
      });
    });
    await new Promise<void>((resolve, reject) => {
      gun.get('communities').get(communityId).get('posts').get(postId).put(null, (ack: any) => {
        if (ack.err) reject(new Error(ack.err)); else resolve();
      });
    });
  }

  static async voteOnPost(postId: string, direction: 'up' | 'down', _userId: string): Promise<void> {
    const post = await PostService.getPost(postId);
    if (!post) throw new Error('Post not found');
    const newUpvotes = (post.upvotes || 0) + (direction === 'up' ? 1 : 0);
    const newDownvotes = (post.downvotes || 0) + (direction === 'down' ? 1 : 0);
    await PostService.updatePost(postId, { upvotes: newUpvotes, downvotes: newDownvotes, score: newUpvotes - newDownvotes });
  }

  static async removeVote(postId: string, direction: 'up' | 'down', _userId: string): Promise<void> {
    const post = await PostService.getPost(postId);
    if (!post) throw new Error('Post not found');
    const newUpvotes = direction === 'up' ? Math.max(0, (post.upvotes || 0) - 1) : (post.upvotes || 0);
    const newDownvotes = direction === 'down' ? Math.max(0, (post.downvotes || 0) - 1) : (post.downvotes || 0);
    await PostService.updatePost(postId, { upvotes: newUpvotes, downvotes: newDownvotes, score: newUpvotes - newDownvotes });
  }

  static unsubscribeAll(): void {
    postActiveListeners.forEach(({ subscription, v1Subscription, timer }) => {
      clearTimeout(timer);
      if (subscription) subscription.off();
      if (v1Subscription) v1Subscription.off();
    });
    postActiveListeners.clear();
  }
}