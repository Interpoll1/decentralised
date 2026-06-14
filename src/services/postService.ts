import { GunService, GUN_NAMESPACE } from './gunService';
import { IPFSService } from './ipfsService';
import { CryptoService } from './cryptoService';
import { KeyService } from './keyService';
import { isVersionEnabled } from '../utils/dataVersionSettings';
import { EncryptionService } from './encryptionService';
import { KeyVaultService } from './keyVaultService';
import config from '../config';

function getApiBase(): string {
  return config.relay.api;
}

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
  encryptedContent?: string;
  authTag?: string;
  authorPubkey?: string;
  contentSignature?: string;
  /** Client-side only — which GunDB namespace this post came from */
  dataVersion?: string;
}

function canonicalPostPayload(post: { authorId: string; title: string; content: string; communityId: string; createdAt: number }): string {
  const obj = { authorId: post.authorId, communityId: post.communityId, content: post.content, createdAt: post.createdAt, title: post.title };
  return JSON.stringify(obj, Object.keys(obj).sort());
}

const postActiveListeners = new Map<string, any>();
const MAX_INITIAL_POSTS = 50;
const MAX_COMMUNITY_INITIAL_POSTS = 120;
const MISSING_POST_CACHE_TTL_MS = 30_000;
const missingPostCache = new Map<string, number>();
const postMemoryCache = new Map<string, Post>();

// ── Timebox: 400ms (was 800ms) — Gun is now live-updates only ─────────────────
const INITIAL_LOAD_TIMEBOX_MS = 400;
const GUN_ONCE_TIMEOUT_MS = 1500;

function onceWithTimeout(node: any, timeoutMs = GUN_ONCE_TIMEOUT_MS): Promise<any | null> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(null);
    }, timeoutMs);

    node.once((data: any) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(data ?? null);
    });
  });
}

async function loadPostIdsInBatches(
  postIds: string[],
  loadById: (postId: string) => Promise<any | null>,
  onLoaded: (postData: any) => void,
  batchSize: number,
): Promise<void> {
  for (let i = 0; i < postIds.length; i += batchSize) {
    const batch = postIds.slice(i, i + batchSize);
    const results = await Promise.all(batch.map(loadById));
    for (const postData of results) {
      if (postData) onLoaded(postData);
    }
  }
}

async function indexForSearch(type: 'post' | 'poll', id: string, data: any) {
  try {
    const { IntegrityService } = await import('@/services/integrityService');
    const body = await IntegrityService.seal(
      { type, id, data } as Record<string, unknown>,
      'index',
    );
    await fetch(`${getApiBase()}/api/index`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body)
    });
  } catch (err) {
    console.warn('Search indexing failed:', err);
  }
}

export class PostService {
  /** Evict legacy (non-GUN_NAMESPACE) posts from memory caches and notify UI stores */
  static async evictLegacyPosts(): Promise<void> {
    try {
      // Clear in-memory caches where dataVersion is not current namespace
      for (const [id, post] of Array.from(postMemoryCache.entries())) {
        const dv = (post as any).dataVersion || null;
        if (dv && dv !== GUN_NAMESPACE) postMemoryCache.delete(id);
      }
      // Clear missing cache (conservative)
      missingPostCache.clear();

      // Attempt to purge store-level entries if postStore is available
      try {
        const { usePostStore } = await import('../stores/postStore');
        const postStore = usePostStore();
        if (postStore && typeof postStore.purgeLegacyPosts === 'function') {
          const removed = await postStore.purgeLegacyPosts();
          if (removed > 0) console.info(`[PostService] Purged ${removed} legacy posts from store`);
        }
      } catch (err) {
        // best-effort
      }

      // Notify UI/store layers to purge their maps (backup)
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('evict-legacy-posts', { detail: { namespace: GUN_NAMESPACE } }));
        try { localStorage.removeItem('seen-post-ids'); } catch {}
      }

      console.info('[PostService] Evicted legacy posts from memory cache and store');
    } catch (err) {
      console.warn('[PostService] Failed to evict legacy posts:', err);
    }
  }

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

    const community = post.communityId ? await (await import('./communityService')).CommunityService.getCommunity(post.communityId).catch(() => null) : null;
    const storedEncKey = post.communityId ? await KeyVaultService.getKey(post.communityId) : undefined;
    if (storedEncKey && (community === null || community?.isEncrypted)) {
      try {
        const aesKey = await EncryptionService.importKey(storedEncKey.key);
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

    postMemoryCache.set(newPost.id, newPost);
    missingPostCache.delete(newPost.id);
    return newPost;
  }

  static subscribeToPostsInCommunity(
    communityId: string,
    onPost: (post: Post) => void,
    onInitialLoadDone?: () => void
  ): () => void {
    const gun = GunService.getGun();
    const communityPostsNode = gun.get('communities').get(communityId).get('posts');

    const initialSeenIds = new Set<string>();
    const inFlightIds = new Set<string>();
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

    // ── Timebox: 400ms (was 800ms) ─────────────────────────────────────────────
    const timeboxTimer = setTimeout(() => {
      if (!initialLoadDone) { pendingLoads = 0; checkLoadComplete(); }
    }, INITIAL_LOAD_TIMEBOX_MS);

    communityPostsNode.once((allPosts: any) => {
      if (!allPosts) { checkLoadComplete(); return; }
      const keys = Object.keys(allPosts).filter(k => k !== '_');
      void loadPostIdsInBatches(
        keys.slice(0, MAX_COMMUNITY_INITIAL_POSTS),
        (postId) => onceWithTimeout(gun.get('posts').get(postId)),
        (postData) => {
          if (postData.id && !initialSeenIds.has(postData.id)) {
            initialSeenIds.add(postData.id);
            collectedPosts.push({ ...postData, dataVersion: (postData && postData.dataVersion) ? postData.dataVersion : GUN_NAMESPACE });
          }
        },
        40,
      ).then(() => {
        collectedPosts.sort((a, b) => b.createdAt - a.createdAt);
        collectedPosts.forEach(p => onPost(p));
        checkLoadComplete();
      });
    });

    // Live updates: map().on emits one post-id key at a time, which is more
    // reliable than parsing full-node patches from .on for large communities.
    subscription = communityPostsNode.map().on((_: any, postId: string) => {
      if (!initialLoadDone) return;
      if (!postId || postId === '_' || inFlightIds.has(postId)) return;
      inFlightIds.add(postId);
      void onceWithTimeout(gun.get('posts').get(postId)).then((postData) => {
        if (postData && postData.id) {
          initialSeenIds.add(postData.id);
          onPost({ ...postData, dataVersion: (postData && postData.dataVersion) ? postData.dataVersion : GUN_NAMESPACE });
        }
      }).finally(() => {
        inFlightIds.delete(postId);
      });
    });

    // v1 posts intentionally excluded from community feed — only using GUN v3 namespace

    const listenerKey = `${communityId}-posts-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
    const initialSeenIds = new Set<string>();
    const inFlightIds = new Set<string>();
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

    // ── Timebox: 400ms (was 800ms) ─────────────────────────────────────────────
    const timeboxTimer = setTimeout(() => {
      if (!initialLoadDone) { pendingLoads = 0; checkLoadComplete(); }
    }, INITIAL_LOAD_TIMEBOX_MS);

    postsNode.once((allPosts: any) => {
      if (!allPosts) { checkLoadComplete(); return; }
      const keys = Object.keys(allPosts).filter(k => k !== '_');
      void loadPostIdsInBatches(
        keys.slice(0, MAX_INITIAL_POSTS),
        (postId) => onceWithTimeout(gun.get('posts').get(postId)),
        (postData) => {
          if (postData.id && !initialSeenIds.has(postData.id)) {
            initialSeenIds.add(postData.id);
            collectedPosts.push({ ...postData, dataVersion: (postData && postData.dataVersion) ? postData.dataVersion : GUN_NAMESPACE });
          }
        },
        50,
      ).then(() => {
        collectedPosts.sort((a, b) => b.createdAt - a.createdAt);
        collectedPosts.forEach(p => onPost(p));
        checkLoadComplete();
      });
    });

    subscription = postsNode.on((allPosts: any) => {
      if (!initialLoadDone) return;
      if (!allPosts) return;
      Object.keys(allPosts).forEach(postId => {
        if (postId === '_' || initialSeenIds.has(postId) || inFlightIds.has(postId)) return;
        inFlightIds.add(postId);
        void onceWithTimeout(gun.get('posts').get(postId)).then((postData) => {
          if (postData && postData.id) {
            initialSeenIds.add(postData.id);
            onPost({ ...postData, dataVersion: (postData && postData.dataVersion) ? postData.dataVersion : GUN_NAMESPACE });
          }
        }).finally(() => {
          inFlightIds.delete(postId);
        });
      });
    });

    // v1 posts intentionally excluded from global feed — only using GUN v3 namespace

    const listenerKey = `all-posts-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    postActiveListeners.set(listenerKey, { subscription, v1Subscription, timer: timeboxTimer });

    return () => {
      clearTimeout(timeboxTimer);
      if (subscription) subscription.off();
      if (v1Subscription) v1Subscription.off();
      postActiveListeners.delete(listenerKey);
    };
  }

  // ── API-first getPost with stale-while-revalidate ─────────────────────────
  static async getPost(postId: string): Promise<Post | null> {
    const cached = postMemoryCache.get(postId);
    if (cached) return cached;

    const missingUntil = missingPostCache.get(postId);
    const isRecentlyMissing = typeof missingUntil === 'number' && missingUntil > Date.now();
    if (!isRecentlyMissing) {
      missingPostCache.delete(postId);
    }

    if (!isRecentlyMissing) {
      try {
        const res = await fetch(`${getApiBase()}/api/post/${postId}`, {
          headers: { 'Cache-Control': 'stale-while-revalidate=30' },
        });
        if (res.ok) {
          const data = await res.json();
          if (data?.id) {
            const post = { ...data, dataVersion: (data && data.dataVersion) ? data.dataVersion : GUN_NAMESPACE };
            postMemoryCache.set(postId, post);
            missingPostCache.delete(postId);
            return post;
          }
        } else if (res.status === 404) {
          missingPostCache.set(postId, Date.now() + MISSING_POST_CACHE_TTL_MS);
        }
      } catch {}
    }

    // Fallback to Gun (new posts written but not yet indexed)
    const gun = GunService.getGun();
    const postData = await onceWithTimeout(gun.get('posts').get(postId));
    if (postData && postData.id) {
      const post = { ...postData, dataVersion: (postData && postData.dataVersion) ? postData.dataVersion : GUN_NAMESPACE };
      postMemoryCache.set(postId, post);
      missingPostCache.delete(postId);
      return post;
    }
    missingPostCache.set(postId, Date.now() + MISSING_POST_CACHE_TTL_MS);
    return null;
  }

  static async updatePost(postId: string, updates: Partial<Post>): Promise<void> {
    const gun = GunService.getGun();
    const cleanUpdates: any = {};
    Object.keys(updates).forEach(key => {
      if (key !== 'id' && updates[key as keyof Post] !== undefined) {
        cleanUpdates[key] = updates[key as keyof Post];
      }
    });
    const cached = postMemoryCache.get(postId);
    const communityIdFromUpdate = typeof cleanUpdates.communityId === 'string' && cleanUpdates.communityId
      ? cleanUpdates.communityId
      : null;
    const communityIdFromCache = cached?.communityId || null;
    const resolvedCommunityId = communityIdFromUpdate || communityIdFromCache;

    await new Promise<void>((resolve, reject) => {
      gun.get('posts').get(postId).put(cleanUpdates, (ack: any) => {
        if (ack.err) reject(new Error(ack.err)); else resolve();
      });
    });
    if (resolvedCommunityId) {
      await new Promise<void>((resolve, reject) => {
        gun.get('communities').get(resolvedCommunityId).get('posts').get(postId).put(cleanUpdates, (ack: any) => {
          if (ack.err) reject(new Error(ack.err)); else resolve();
        });
      });
    }

    if (cached) {
      postMemoryCache.set(postId, { ...cached, ...cleanUpdates });
    }
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

  static async voteOnPost(postId: string, direction: 'up' | 'down', userId: string): Promise<Post> {
    const post = await PostService.getPost(postId);
    if (!post) throw new Error('Post not found');
    const gun = GunService.getGun();
    const voteKey = `vote_${userId}_${postId}`;
    const existingVote = await onceWithTimeout(gun.get('votes').get(voteKey));
    let upvotes = post.upvotes || 0;
    let downvotes = post.downvotes || 0;

    if (existingVote?.type === 'up') {
      upvotes = Math.max(0, upvotes - 1);
    } else if (existingVote?.type === 'down') {
      downvotes = Math.max(0, downvotes - 1);
    }

    const togglingOffSameVote = existingVote?.type === direction;
    if (togglingOffSameVote) {
      await new Promise<void>((resolve, reject) => {
        gun.get('votes').get(voteKey).put(null, (ack: any) => {
          if (ack.err) reject(new Error(ack.err)); else resolve();
        });
      });
    } else {
      if (direction === 'up') {
        upvotes += 1;
      } else {
        downvotes += 1;
      }
      await new Promise<void>((resolve, reject) => {
        gun.get('votes').get(voteKey).put({
          userId,
          postId,
          type: direction,
          timestamp: Date.now(),
        }, (ack: any) => {
          if (ack.err) reject(new Error(ack.err)); else resolve();
        });
      });
    }

    const score = upvotes - downvotes;
    await PostService.updatePost(postId, { upvotes, downvotes, score });
    const updated: Post = { ...post, upvotes, downvotes, score };
    postMemoryCache.set(postId, updated);
    return updated;
  }

  static async removeVote(postId: string, direction: 'up' | 'down', userId: string): Promise<Post> {
    const post = await PostService.getPost(postId);
    if (!post) throw new Error('Post not found');
    const gun = GunService.getGun();
    const voteKey = `vote_${userId}_${postId}`;
    const existingVote = await onceWithTimeout(gun.get('votes').get(voteKey));
    if (!existingVote?.type || existingVote.type !== direction) {
      return post;
    }

    let upvotes = post.upvotes || 0;
    let downvotes = post.downvotes || 0;
    if (direction === 'up') {
      upvotes = Math.max(0, upvotes - 1);
    } else {
      downvotes = Math.max(0, downvotes - 1);
    }
    await new Promise<void>((resolve, reject) => {
      gun.get('votes').get(voteKey).put(null, (ack: any) => {
        if (ack.err) reject(new Error(ack.err)); else resolve();
      });
    });
    const score = upvotes - downvotes;
    await PostService.updatePost(postId, { upvotes, downvotes, score });
    const updated: Post = { ...post, upvotes, downvotes, score };
    postMemoryCache.set(postId, updated);
    return updated;
  }

  static verifyPostSignature(post: Post): 'verified' | 'unverified' | 'unsigned' {
    if (!post.authorPubkey || !post.contentSignature) return 'unsigned';
    try {
      const contentPayload = canonicalPostPayload(post);
      const valid = CryptoService.verify(contentPayload, post.contentSignature, post.authorPubkey);
      return valid ? 'verified' : 'unverified';
    } catch { return 'unverified'; }
  }

  static async decryptPost(post: Post): Promise<Post> {
    if (!post.isEncrypted || !post.encryptedContent) return post;
    const storedKey = await KeyVaultService.getKey(post.communityId);
    if (!storedKey) return post;
    try {
      const aesKey = await EncryptionService.importKey(storedKey.key);
      const raw    = JSON.parse(await EncryptionService.decrypt(post.encryptedContent, aesKey));
      const decrypted = {
        title:              typeof raw.title              === 'string'  ? raw.title              : post.title,
        content:            typeof raw.content            === 'string'  ? raw.content            : '',
        authorId:           typeof raw.authorId           === 'string'  ? raw.authorId           : post.authorId,
        authorName:         typeof raw.authorName         === 'string'  ? raw.authorName         : post.authorName,
        authorShowRealName: typeof raw.authorShowRealName === 'boolean' ? raw.authorShowRealName : post.authorShowRealName,
        authorPubkey:       typeof raw.authorPubkey       === 'string'  ? raw.authorPubkey       : post.authorPubkey,
        contentSignature:   typeof raw.contentSignature   === 'string'  ? raw.contentSignature   : post.contentSignature,
        imageIPFS:          typeof raw.imageIPFS          === 'string'  ? raw.imageIPFS          : '',
        imageThumbnail:     typeof raw.imageThumbnail     === 'string'  ? raw.imageThumbnail     : '',
      };
      if (post.authTag) {
        const valid = await EncryptionService.verifyAuthTag(aesKey, post.authTag, post.id, String(post.createdAt), decrypted.authorId);
        if (!valid) { console.warn(`Post ${post.id} failed authTag verification`); return post; }
      }
      return { ...post, ...decrypted };
    } catch (err) {
      console.warn(`Failed to decrypt post ${post.id}:`, err);
      return post;
    }
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
