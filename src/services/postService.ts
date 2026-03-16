import { GunService, GUN_NAMESPACE } from './gunService';
import { IPFSService } from './ipfsService';
import { CryptoService } from './cryptoService';
import { KeyService } from './keyService';
import { isVersionEnabled } from '../utils/dataVersionSettings';
import { EncryptionService } from './encryptionService';
import { KeyVaultService } from './keyVaultService';

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
  isEncrypted?: boolean;
  encryptedContent?: string;    // AES-GCM encrypted post data
  authTag?: string;             // HMAC anti-sabotage tag
  authorPubkey?: string;      // Schnorr x-only public key (64 hex)
  contentSignature?: string;  // Schnorr signature over content hash (128 hex)
  /** Client-side only — which GunDB namespace this post came from */
  dataVersion?: string;
}

/** Deterministic payload for Schnorr sign/verify — key order is sorted for stability. */
function canonicalPostPayload(post: { authorId: string; title: string; content: string; communityId: string; createdAt: number }): string {
  const obj = { authorId: post.authorId, communityId: post.communityId, content: post.content, createdAt: post.createdAt, title: post.title };
  return JSON.stringify(obj, Object.keys(obj).sort());
}

const postActiveListeners = new Map<string, any>();
const INITIAL_LOAD_IDLE_MS = 400;
const INITIAL_LOAD_HARD_TIMEOUT_MS = 30000;
const POST_HYDRATION_TIMEOUT_MS = 8000;

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

    // Sign content for anti-sabotage verification
    try {
      const keyPair = await KeyService.getKeyPair();
      const contentPayload = canonicalPostPayload(newPost);
      const signature = CryptoService.sign(contentPayload, keyPair.privateKey);
      newPost.authorPubkey = keyPair.publicKey;
      newPost.contentSignature = signature;
      cleanPost.authorPubkey = keyPair.publicKey;
      cleanPost.contentSignature = signature;
    } catch (err) {
      console.warn('Failed to sign post content:', err);
    }

    // Encrypt content if community is encrypted
    const community = post.communityId ? await (await import('./communityService')).CommunityService.getCommunity(post.communityId).catch(() => null) : null;
    const storedEncKey = post.communityId ? await KeyVaultService.getKey(post.communityId) : undefined;
    if (storedEncKey && (community === null || community?.isEncrypted)) {
      try {
        const aesKey = await EncryptionService.importKey(storedEncKey.key);
        // Encrypt sensitive fields (including signature data)
        const encryptableData = {
          title: newPost.title,
          content: newPost.content,
          authorId: newPost.authorId,
          authorName: newPost.authorName,
          authorShowRealName: newPost.authorShowRealName,
          authorPubkey: newPost.authorPubkey,
          contentSignature: newPost.contentSignature,
          imageIPFS: newPost.imageIPFS,
          imageThumbnail: newPost.imageThumbnail,
        };
        const encryptedContent = await EncryptionService.encrypt(JSON.stringify(encryptableData), aesKey);
        const authTag = await EncryptionService.generateAuthTag(aesKey, newPost.id, String(newPost.createdAt), newPost.authorId);
        
        // Replace sensitive fields with placeholders
        cleanPost.isEncrypted = true;
        cleanPost.encryptedContent = encryptedContent;
        cleanPost.authTag = authTag;
        cleanPost.title = '🔒 Encrypted Post';
        cleanPost.content = '';
        cleanPost.authorId = 'encrypted';
        cleanPost.authorName = 'encrypted';
        cleanPost.authorShowRealName = false;
        cleanPost.authorPubkey = '';
        cleanPost.contentSignature = '';
        cleanPost.imageIPFS = '';
        cleanPost.imageThumbnail = '';
        
        newPost.isEncrypted = true;
        newPost.encryptedContent = encryptedContent;
        newPost.authTag = authTag;
        newPost.title = '🔒 Encrypted Post';
        newPost.content = '';
        newPost.authorId = 'encrypted';
        newPost.authorName = 'encrypted';
        newPost.authorShowRealName = false;
        newPost.authorPubkey = '';
        newPost.contentSignature = '';
        newPost.imageIPFS = '';
        newPost.imageThumbnail = '';
      } catch (err) {
        throw new Error(`Failed to encrypt post for community ${post.communityId}: ${err}`);
      }
    }

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
      title: cleanPost.title,
      content: cleanPost.content,
      authorName: cleanPost.authorName,
      communitySlug: cleanPost.communityId,
      createdAt: cleanPost.createdAt
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
    const isV1Enabled = isVersionEnabled('v1');

    const seenIds = new Set<string>();
    const emittedSourceById = new Map<string, 'v1' | 'v2'>();
    const deferredLivePosts: Post[] = [];
    let initialLoadDone = false;
    let isActive = true;
    let subscription: any;
    let v1Subscription: any;
    let pendingLoads = isV1Enabled ? 2 : 1;
    let pendingHydrationReads = 0;
    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    const subscriptionStartTime = Date.now();

    const finishInitialLoad = () => {
      if (!isActive || initialLoadDone) return;
      initialLoadDone = true;
      if (settleTimer) {
        clearTimeout(settleTimer);
        settleTimer = undefined;
      }
      if (onInitialLoadDone) onInitialLoadDone();
      if (!isActive) return;
      if (deferredLivePosts.length > 0) {
        deferredLivePosts.sort((a, b) => b.createdAt - a.createdAt);
        deferredLivePosts.forEach(p => onPost(p));
        deferredLivePosts.length = 0;
      }
    };

    const maybeFinishInitialLoad = () => {
      if (!isActive || initialLoadDone) return;
      if (pendingLoads > 0 || pendingHydrationReads > 0) return;

      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(() => {
        settleTimer = undefined;
        if (!initialLoadDone && pendingLoads === 0 && pendingHydrationReads === 0) {
          finishInitialLoad();
        }
      }, INITIAL_LOAD_IDLE_MS);
    };

    const markLoadComplete = () => {
      if (!isActive || initialLoadDone) return;
      pendingLoads = Math.max(0, pendingLoads - 1);
      maybeFinishInitialLoad();
    };

    const loadPost = (
      sourceGun: any,
      postId: string,
      dataVersion: string,
      handlePost: (post: Post) => void,
      source: 'once' | 'on'
    ): Promise<void> => {
      const incomingSource: 'v1' | 'v2' = dataVersion === 'v1' ? 'v1' : 'v2';
      const existingSource = emittedSourceById.get(postId);
      const canUpgradeFromV1 = incomingSource === 'v2' && existingSource === 'v1';

      if (!isActive || postId === '_') {
        return Promise.resolve();
      }
      if (seenIds.has(postId) && !canUpgradeFromV1) {
        return Promise.resolve();
      }

      const trackForInitialHydration = !initialLoadDone;
      if (trackForInitialHydration) {
        pendingHydrationReads++;
        if (settleTimer) {
          clearTimeout(settleTimer);
          settleTimer = undefined;
        }
      }

      return new Promise((resolve) => {
        let settled = false;
        const finalizeLoad = () => {
          if (settled) return;
          settled = true;
          if (trackForInitialHydration) {
            pendingHydrationReads = Math.max(0, pendingHydrationReads - 1);
            maybeFinishInitialLoad();
          }
          resolve();
        };

        const watchdog = setTimeout(() => {
          finalizeLoad();
        }, POST_HYDRATION_TIMEOUT_MS);

        sourceGun.get('posts').get(postId).once((postData: any) => {
          clearTimeout(watchdog);
          if (!isActive) {
            finalizeLoad();
            return;
          }

          if (postData && postData.id) {
            const existingPostSource = emittedSourceById.get(postData.id);
            const canEmit = !existingPostSource || (incomingSource === 'v2' && existingPostSource === 'v1');

            if (!canEmit) {
              finalizeLoad();
              return;
            }

            seenIds.add(postData.id);
            emittedSourceById.set(postData.id, incomingSource);
            const hydratedPost = { ...postData, dataVersion } as Post;
            const createdAt = typeof hydratedPost.createdAt === 'number' ? hydratedPost.createdAt : 0;
            const isLiveDuringInitial = !initialLoadDone && source === 'on' && createdAt > subscriptionStartTime;

            if (isLiveDuringInitial) deferredLivePosts.push(hydratedPost);
            else handlePost(hydratedPost);
          }
          finalizeLoad();
        });
      });
    };

    const hardLoadTimer = setTimeout(() => {
      finishInitialLoad();
    }, INITIAL_LOAD_HARD_TIMEOUT_MS);

    // ── v2 posts (namespaced, current) ───────────────────────────────────
    communityPostsNode.once((allPosts: any) => {
      if (!isActive) return;
      const keys = allPosts ? Object.keys(allPosts).filter(k => k !== '_') : [];
      const promises = keys.map(postId => loadPost(gun, postId, GUN_NAMESPACE, onPost, 'once'));

      Promise.all(promises).then(() => {
        if (!isActive) return;
        markLoadComplete();
      });
    });

    subscription = communityPostsNode.on((allPosts: any) => {
      if (!isActive || !allPosts) return;
      Object.keys(allPosts).forEach(postId => {
        void loadPost(gun, postId, GUN_NAMESPACE, onPost, 'on');
      });
    });

    // ── v1 posts (root-level, legacy) ────────────────────────────────────
    if (isV1Enabled) {
      const rawGun = GunService.getRawGun();
      const v1Node = rawGun.get('communities').get(communityId).get('posts');

      v1Node.once((allPosts: any) => {
        if (!isActive) return;
        const keys = allPosts ? Object.keys(allPosts).filter(k => k !== '_') : [];
        const promises = keys.map(postId => loadPost(rawGun, postId, 'v1', onPost, 'once'));

        Promise.all(promises).then(() => {
          if (!isActive) return;
          markLoadComplete();
        });
      });

      v1Subscription = v1Node.on((allPosts: any) => {
        if (!isActive || !allPosts) return;
        Object.keys(allPosts).forEach(postId => {
          void loadPost(rawGun, postId, 'v1', onPost, 'on');
        });
      });
    }

    const clearTimers = () => {
      clearTimeout(hardLoadTimer);
      if (settleTimer) {
        clearTimeout(settleTimer);
        settleTimer = undefined;
      }
    };

    const dispose = () => {
      if (!isActive) return;
      isActive = false;
      clearTimers();
      if (subscription) subscription.off();
      if (v1Subscription) v1Subscription.off();
    };

    const listenerKey = `${communityId}-posts`;
    const existingListener = postActiveListeners.get(listenerKey);
    if (existingListener) {
      if (typeof existingListener.dispose === 'function') existingListener.dispose();
      else {
        if (typeof existingListener.clearTimers === 'function') existingListener.clearTimers();
        if (existingListener.subscription) existingListener.subscription.off();
        if (existingListener.v1Subscription) existingListener.v1Subscription.off();
      }
    }
    const listenerRecord = { subscription, v1Subscription, clearTimers, dispose };
    postActiveListeners.set(listenerKey, listenerRecord);

    return () => {
      dispose();
      if (postActiveListeners.get(listenerKey) === listenerRecord) {
        postActiveListeners.delete(listenerKey);
      }
    };
  }

  static subscribeToAllPosts(
    onPost: (post: Post) => void,
    onInitialLoadDone?: () => void
  ): () => void {
    const gun = GunService.getGun();
    const postsNode = gun.get('posts');
    const isV1Enabled = isVersionEnabled('v1');

    const seenIds = new Set<string>();
    const emittedSourceById = new Map<string, 'v1' | 'v2'>();
    const deferredLivePosts: Post[] = [];
    let initialLoadDone = false;
    let isActive = true;
    let subscription: any;
    let v1Subscription: any;
    let pendingLoads = isV1Enabled ? 2 : 1;
    let pendingHydrationReads = 0;
    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    const subscriptionStartTime = Date.now();

    const finishInitialLoad = () => {
      if (!isActive || initialLoadDone) return;
      initialLoadDone = true;
      if (settleTimer) {
        clearTimeout(settleTimer);
        settleTimer = undefined;
      }
      if (onInitialLoadDone) onInitialLoadDone();
      if (!isActive) return;
      if (deferredLivePosts.length > 0) {
        deferredLivePosts.sort((a, b) => b.createdAt - a.createdAt);
        deferredLivePosts.forEach(p => onPost(p));
        deferredLivePosts.length = 0;
      }
    };

    const maybeFinishInitialLoad = () => {
      if (!isActive || initialLoadDone) return;
      if (pendingLoads > 0 || pendingHydrationReads > 0) return;

      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(() => {
        settleTimer = undefined;
        if (!initialLoadDone && pendingLoads === 0 && pendingHydrationReads === 0) {
          finishInitialLoad();
        }
      }, INITIAL_LOAD_IDLE_MS);
    };

    const markLoadComplete = () => {
      if (!isActive || initialLoadDone) return;
      pendingLoads = Math.max(0, pendingLoads - 1);
      maybeFinishInitialLoad();
    };

    const loadPost = (
      sourceGun: any,
      postId: string,
      dataVersion: string,
      handlePost: (post: Post) => void,
      source: 'once' | 'on'
    ): Promise<void> => {
      const incomingSource: 'v1' | 'v2' = dataVersion === 'v1' ? 'v1' : 'v2';
      const existingSource = emittedSourceById.get(postId);
      const canUpgradeFromV1 = incomingSource === 'v2' && existingSource === 'v1';

      if (!isActive || postId === '_') {
        return Promise.resolve();
      }
      if (seenIds.has(postId) && !canUpgradeFromV1) {
        return Promise.resolve();
      }

      const trackForInitialHydration = !initialLoadDone;
      if (trackForInitialHydration) {
        pendingHydrationReads++;
        if (settleTimer) {
          clearTimeout(settleTimer);
          settleTimer = undefined;
        }
      }

      return new Promise((resolve) => {
        let settled = false;
        const finalizeLoad = () => {
          if (settled) return;
          settled = true;
          if (trackForInitialHydration) {
            pendingHydrationReads = Math.max(0, pendingHydrationReads - 1);
            maybeFinishInitialLoad();
          }
          resolve();
        };

        const watchdog = setTimeout(() => {
          finalizeLoad();
        }, POST_HYDRATION_TIMEOUT_MS);

        sourceGun.get('posts').get(postId).once((postData: any) => {
          clearTimeout(watchdog);
          if (!isActive) {
            finalizeLoad();
            return;
          }

          if (postData && postData.id) {
            const existingPostSource = emittedSourceById.get(postData.id);
            const canEmit = !existingPostSource || (incomingSource === 'v2' && existingPostSource === 'v1');

            if (!canEmit) {
              finalizeLoad();
              return;
            }

            seenIds.add(postData.id);
            emittedSourceById.set(postData.id, incomingSource);
            const hydratedPost = { ...postData, dataVersion } as Post;
            const createdAt = typeof hydratedPost.createdAt === 'number' ? hydratedPost.createdAt : 0;
            const isLiveDuringInitial = !initialLoadDone && source === 'on' && createdAt > subscriptionStartTime;

            if (isLiveDuringInitial) deferredLivePosts.push(hydratedPost);
            else handlePost(hydratedPost);
          }
          finalizeLoad();
        });
      });
    };

    const hardLoadTimer = setTimeout(() => {
      finishInitialLoad();
    }, INITIAL_LOAD_HARD_TIMEOUT_MS);

    // ── v2 posts ─────────────────────────────────────────────────────────
    postsNode.once((allPosts: any) => {
      if (!isActive) return;
      const keys = allPosts ? Object.keys(allPosts).filter(k => k !== '_') : [];
      const promises = keys.map(postId => loadPost(gun, postId, GUN_NAMESPACE, onPost, 'once'));

      Promise.all(promises).then(() => {
        if (!isActive) return;
        markLoadComplete();
      });
    });

    subscription = postsNode.on((allPosts: any) => {
      if (!isActive || !allPosts) return;
      Object.keys(allPosts).forEach(postId => {
        void loadPost(gun, postId, GUN_NAMESPACE, onPost, 'on');
      });
    });

    // ── v1 posts ─────────────────────────────────────────────────────────
    if (isV1Enabled) {
      const rawGun = GunService.getRawGun();
      const v1PostsNode = rawGun.get('posts');

      v1PostsNode.once((allPosts: any) => {
        if (!isActive) return;
        const keys = allPosts ? Object.keys(allPosts).filter(k => k !== '_') : [];
        const promises = keys.map(postId => loadPost(rawGun, postId, 'v1', onPost, 'once'));

        Promise.all(promises).then(() => {
          if (!isActive) return;
          markLoadComplete();
        });
      });

      v1Subscription = v1PostsNode.on((allPosts: any) => {
        if (!isActive || !allPosts) return;
        Object.keys(allPosts).forEach(postId => {
          void loadPost(rawGun, postId, 'v1', onPost, 'on');
        });
      });
    }

    const clearTimers = () => {
      clearTimeout(hardLoadTimer);
      if (settleTimer) {
        clearTimeout(settleTimer);
        settleTimer = undefined;
      }
    };

    const dispose = () => {
      if (!isActive) return;
      isActive = false;
      clearTimers();
      if (subscription) subscription.off();
      if (v1Subscription) v1Subscription.off();
    };

    const listenerKey = 'all-posts';
    const existingListener = postActiveListeners.get(listenerKey);
    if (existingListener) {
      if (typeof existingListener.dispose === 'function') existingListener.dispose();
      else {
        if (typeof existingListener.clearTimers === 'function') existingListener.clearTimers();
        if (existingListener.subscription) existingListener.subscription.off();
        if (existingListener.v1Subscription) existingListener.v1Subscription.off();
      }
    }
    const listenerRecord = { subscription, v1Subscription, clearTimers, dispose };
    postActiveListeners.set(listenerKey, listenerRecord);

    return () => {
      dispose();
      if (postActiveListeners.get(listenerKey) === listenerRecord) {
        postActiveListeners.delete(listenerKey);
      }
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

  /** Verify the Schnorr signature on a post for anti-sabotage */
  static verifyPostSignature(post: Post): 'verified' | 'unverified' | 'unsigned' {
    if (!post.authorPubkey || !post.contentSignature) return 'unsigned';
    try {
      const contentPayload = canonicalPostPayload(post);
      const valid = CryptoService.verify(contentPayload, post.contentSignature, post.authorPubkey);
      return valid ? 'verified' : 'unverified';
    } catch {
      return 'unverified';
    }
  }

  /**
   * Decrypt an encrypted post using the stored community key.
   * Returns the post with decrypted fields, or the original post if decryption fails.
   */
  static async decryptPost(post: Post): Promise<Post> {
    if (!post.isEncrypted || !post.encryptedContent) return post;

    const storedKey = await KeyVaultService.getKey(post.communityId);
    if (!storedKey) return post;

    try {
      const aesKey = await EncryptionService.importKey(storedKey.key);
      const raw = JSON.parse(await EncryptionService.decrypt(post.encryptedContent, aesKey));
      
      // Validate decrypted shape
      const decrypted = {
        title: typeof raw.title === 'string' ? raw.title : post.title,
        content: typeof raw.content === 'string' ? raw.content : '',
        authorId: typeof raw.authorId === 'string' ? raw.authorId : post.authorId,
        authorName: typeof raw.authorName === 'string' ? raw.authorName : post.authorName,
        authorShowRealName: typeof raw.authorShowRealName === 'boolean' ? raw.authorShowRealName : post.authorShowRealName,
        authorPubkey: typeof raw.authorPubkey === 'string' ? raw.authorPubkey : post.authorPubkey,
        contentSignature: typeof raw.contentSignature === 'string' ? raw.contentSignature : post.contentSignature,
        imageIPFS: typeof raw.imageIPFS === 'string' ? raw.imageIPFS : '',
        imageThumbnail: typeof raw.imageThumbnail === 'string' ? raw.imageThumbnail : '',
      };

      // Verify authTag after decryption using the real authorId
      if (post.authTag) {
        const valid = await EncryptionService.verifyAuthTag(aesKey, post.authTag, post.id, String(post.createdAt), decrypted.authorId);
        if (!valid) {
          console.warn(`Post ${post.id} failed authTag verification — possible sabotage`);
          return post;
        }
      }

      return {
        ...post,
        ...decrypted,
      };
    } catch (err) {
      console.warn(`Failed to decrypt post ${post.id}:`, err);
      return post;
    }
  }

  static unsubscribeAll(): void {
    postActiveListeners.forEach((listener) => {
      if (typeof listener.dispose === 'function') {
        listener.dispose();
        return;
      }
      const { subscription, v1Subscription, timer, clearTimers } = listener;
      if (typeof clearTimers === 'function') clearTimers();
      else clearTimeout(timer);
      if (subscription) subscription.off();
      if (v1Subscription) v1Subscription.off();
    });
    postActiveListeners.clear();
  }
}
