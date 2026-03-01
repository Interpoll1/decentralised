import { GunService } from './gunService';
import { IPFSService } from './ipfsService';

const API_URL = import.meta.env.VITE_API_URL || 'https://interpoll.onrender.com';

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

    const checkLoadComplete = () => {
      if (initialLoadDone) return;
      initialLoadDone = true;
      if (onInitialLoadDone) onInitialLoadDone();
    };

    const timeboxTimer = setTimeout(() => {
      checkLoadComplete();
    }, 800);

    communityPostsNode.once((allPosts) => {
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
              collectedPosts.push(postData);
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

    subscription = communityPostsNode.on((allPosts) => {
      if (!allPosts) return;
      Object.keys(allPosts).forEach(postId => {
        if (postId === '_' || seenIds.has(postId)) return;
        gun.get('posts').get(postId).once((postData: any) => {
          if (postData && postData.id && !seenIds.has(postData.id)) {
            seenIds.add(postData.id);
            onPost(postData);
          }
        });
      });
    });

    const listenerKey = `${communityId}-posts`;
    postActiveListeners.set(listenerKey, { subscription, timer: timeboxTimer });

    return () => {
      clearTimeout(timeboxTimer);
      if (subscription) subscription.off();
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

    const checkLoadComplete = () => {
      if (initialLoadDone) return;
      initialLoadDone = true;
      if (onInitialLoadDone) onInitialLoadDone();
    };

    const timeboxTimer = setTimeout(() => {
      checkLoadComplete();
    }, 800);

    postsNode.once((allPosts) => {
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
              collectedPosts.push(postData);
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

    subscription = postsNode.on((allPosts) => {
      if (!allPosts) return;
      Object.keys(allPosts).forEach(postId => {
        if (postId === '_' || seenIds.has(postId)) return;
        gun.get('posts').get(postId).once((postData: any) => {
          if (postData && postData.id && !seenIds.has(postData.id)) {
            seenIds.add(postData.id);
            onPost(postData);
          }
        });
      });
    });

    const listenerKey = 'all-posts';
    postActiveListeners.set(listenerKey, { subscription, timer: timeboxTimer });

    return () => {
      clearTimeout(timeboxTimer);
      if (subscription) subscription.off();
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
    postActiveListeners.forEach(({ subscription, timer }) => {
      clearTimeout(timer);
      if (subscription) subscription.off();
    });
    postActiveListeners.clear();
  }
}