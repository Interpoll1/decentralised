import { GunService, GUN_NAMESPACE } from './gunService';
import { IPFSService } from './ipfsService';
import { CryptoService } from './cryptoService';
import { KeyService } from './keyService';
import { StorageService } from './storageService';
import { isVersionEnabled } from '../utils/dataVersionSettings';
import { EncryptionService } from './encryptionService';
import { KeyVaultService } from './keyVaultService';
import config from '../config';
import { canonicalJSON } from '../../shared-validation/canonical.js';

const CURRENT_CANON_VERSION = 2;

// Post durability (mirrors pollService's relay-persistence machinery) ──────────
const LOCAL_POSTS_META_KEY = 'interpoll-local-posts-v1';
const LOCAL_POSTS_TOMBSTONES_META_KEY = 'interpoll-local-posts-tombstones-v1';
const LOCAL_POST_BACKUP_TTL_MS = 30 * 60 * 1000;

type LocalPostBackupEntry = { post: Post; backedUpAt: number };
type LocalPostBackupMap = Record<string, LocalPostBackupEntry>;

function getApiBase(): string {
  return config.relay.api;
}

function getGunRelayBase(): string {
  return config.relay.gun.replace(/\/gun$/, '');
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
  /** Which canonicalization algorithm contentSignature was produced with. Absent = legacy v1 (canonicalPostPayloadV1). */
  canonVersion?: number;
  /** Client-side only — which GunDB namespace this post came from */
  dataVersion?: string;
  /** Client-side only — whether the relay independently confirmed it holds this post (set on creation). */
  relayConfirmed?: boolean;
}

/** @deprecated Legacy per-service canonicalizer, kept for verifying posts signed before the shared canonicalJSON was adopted. Never sign new posts with this. */
function canonicalPostPayloadV1(post: { authorId: string; title: string; content: string; communityId: string; createdAt: number }): string {
  const obj = { authorId: post.authorId, communityId: post.communityId, content: post.content, createdAt: post.createdAt, title: post.title };
  return JSON.stringify(obj, Object.keys(obj).sort());
}

function canonicalPostPayload(post: { authorId: string; title: string; content: string; communityId: string; createdAt: number }): string {
  return canonicalJSON({ authorId: post.authorId, communityId: post.communityId, content: post.content, createdAt: post.createdAt, title: post.title });
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
      newPost.canonVersion = CURRENT_CANON_VERSION;
      cleanPost.authorPubkey = keyPair.publicKey;
      cleanPost.contentSignature = signature;
      cleanPost.canonVersion = CURRENT_CANON_VERSION;
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

    // Durability: back up locally first (so republish can recover it even if the
    // verification below is slow/fails), then independently confirm the relay
    // actually holds it. If unconfirmed, start the republish loop so the post is
    // re-pushed once the relay is reachable rather than being silently lost.
    await PostService.saveLocalPostBackup(newPost);
    const relayConfirmed = await PostService.verifyRelayPersistence(newPost.id);
    newPost.relayConfirmed = relayConfirmed === null
      ? GunService.getPeerStats().isConnected
      : relayConfirmed;
    if (!newPost.relayConfirmed) {
      PostService.startRepublishLoop();
      setTimeout(() => { void PostService.republishUnconfirmedPosts(); }, 15_000);
    }

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
        if (postId === '_' || inFlightIds.has(postId)) return;
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
    // Tombstone the local backup so the republish loop cannot resurrect it.
    await PostService.removeLocalPostBackup(postId);
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

  static async incrementCommentCount(postId: string, communityId?: string): Promise<void> {
    const gun = GunService.getGun();
    // Read the live Gun value directly rather than via getPost(), whose REST/memory
    // cache snapshot never reflects comment-count changes and would shadow this update.
    const current = await onceWithTimeout(gun.get('posts').get(postId));
    if (!current) return;
    const commentCount = (current.commentCount || 0) + 1;
    await PostService.updatePost(postId, { commentCount, communityId: communityId || current.communityId });
    const cached = postMemoryCache.get(postId);
    if (cached) {
      postMemoryCache.set(postId, { ...cached, commentCount });
    }
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
      const contentPayload = post.canonVersion === CURRENT_CANON_VERSION
        ? canonicalPostPayload(post)
        : canonicalPostPayloadV1(post);
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

  // ── Durability ──────────────────────────────────────────────────────────────
  // Gun put acks fire on local acceptance and read-backs come from the local
  // graph, so neither proves the relay stored a post. Without an independent
  // check + backup + republish, a post created during a relay outage or under
  // rate-limiting stays only in the author's browser and vanishes for everyone
  // else. This mirrors the machinery pollService already has.

  private static republishLoopStarted = false;
  private static republishInFlight = false;
  private static republishAttempts = new Map<string, number>();
  private static localPostBackupWriteQueue: Promise<void> = Promise.resolve();
  private static readonly REPUBLISH_MAX_ATTEMPTS = 5;
  private static readonly REPUBLISH_INTERVAL_MS = 120_000;

  /**
   * Ask the relay's DB mirror whether a post actually reached it. Returns true
   * (relay has it), false (endpoint reachable but post absent after retries), or
   * null when the endpoint is unreachable/has no DB (inconclusive).
   */
  static async verifyRelayPersistence(postId: string, deadlineMs = 8000): Promise<boolean | null> {
    const soul = encodeURIComponent(`${GUN_NAMESPACE}/posts/${postId}`);
    const url = `${getGunRelayBase()}/db/soul?soul=${soul}`;
    const deadline = Date.now() + deadlineMs;
    const retryDelayMs = 1500;
    let endpointReachable = false;
    for (;;) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);
      try {
        const res = await fetch(url, { signal: controller.signal });
        if (res.ok) return true;
        if (res.status === 404) endpointReachable = true;
      } catch {
        // Network error / timeout — endpoint state unknown for this attempt.
      } finally {
        clearTimeout(timer);
      }
      if (Date.now() + retryDelayMs > deadline) {
        return endpointReachable ? false : null;
      }
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }

  /** Gun-shaped record for (re)writing a post. Encrypted posts are already
   *  redacted in the stored Post, so no re-redaction is needed here. */
  private static toGunPostRecord(post: Post): Record<string, unknown> {
    const rec: Record<string, unknown> = {
      id: post.id,
      communityId: post.communityId,
      authorId: post.authorId,
      authorName: post.authorName,
      authorShowRealName: post.authorShowRealName || false,
      title: post.title,
      content: post.content,
      createdAt: post.createdAt,
      upvotes: post.upvotes || 0,
      downvotes: post.downvotes || 0,
      score: post.score || 0,
      commentCount: post.commentCount || 0,
    };
    if (post.imageIPFS) rec.imageIPFS = post.imageIPFS;
    if (post.imageThumbnail) rec.imageThumbnail = post.imageThumbnail;
    if (post.authorPubkey) rec.authorPubkey = post.authorPubkey;
    if (post.contentSignature) rec.contentSignature = post.contentSignature;
    if (post.canonVersion) rec.canonVersion = post.canonVersion;
    if (post.isEncrypted) {
      rec.isEncrypted = true;
      if (post.encryptedContent) rec.encryptedContent = post.encryptedContent;
      if (post.authTag) rec.authTag = post.authTag;
    }
    return rec;
  }

  /** Re-put a post to both the root and community paths. */
  private static warmPostCache(record: Record<string, unknown>): void {
    if (!record?.id) return;
    const gun = GunService.getGun();
    gun.get('posts').get(record.id as string).put(record);
    if (record.communityId) {
      gun.get('communities').get(record.communityId as string).get('posts').get(record.id as string).put(record);
    }
  }

  /**
   * Re-push recent locally-backed-up posts the relay does not confirm holding.
   * Gun never retro-syncs puts made while the relay connection was dead — and a
   * rate-limited relay can drop messages on an open socket — so without this a
   * post created during an outage stays invisible to everyone else.
   */
  static async republishUnconfirmedPosts(): Promise<void> {
    if (this.republishInFlight || typeof window === 'undefined') return;
    this.republishInFlight = true;
    try {
      const [map, tombstones] = await Promise.all([
        this.readLocalPostMap(),
        this.readLocalPostTombstones(),
      ]);
      const now = Date.now();
      const candidates = Object.values(map).filter((entry) => {
        const post = entry?.post;
        if (!post?.id || tombstones[post.id]) return false;
        const ageMs = now - (Number.isFinite(entry.backedUpAt) ? entry.backedUpAt : post.createdAt || 0);
        if (ageMs > LOCAL_POST_BACKUP_TTL_MS) return false;
        return (this.republishAttempts.get(post.id) || 0) < this.REPUBLISH_MAX_ATTEMPTS;
      });
      for (const entry of candidates) {
        const post = entry.post;
        const confirmed = await this.verifyRelayPersistence(post.id, 4000);
        if (confirmed === true) {
          this.republishAttempts.delete(post.id);
          continue;
        }
        if (confirmed === null) continue; // endpoint unreachable — retry next tick
        this.republishAttempts.set(post.id, (this.republishAttempts.get(post.id) || 0) + 1);
        this.warmPostCache(this.toGunPostRecord(post));
        await new Promise((resolve) => setTimeout(resolve, 3000));
        const recheck = await this.verifyRelayPersistence(post.id, 8000);
        if (recheck === true) {
          this.republishAttempts.delete(post.id);
          console.info(`[PostService] Republished post ${post.id} to relay after missed sync`);
        }
      }
    } catch {
      // best-effort sweep
    } finally {
      this.republishInFlight = false;
    }
  }

  /** Start the background republish loop (idempotent). Also re-sweeps on Gun reconnects. */
  static startRepublishLoop(): void {
    if (this.republishLoopStarted || typeof window === 'undefined') return;
    this.republishLoopStarted = true;
    GunService.onReconnect(() => { void this.republishUnconfirmedPosts(); });
    const tick = () => {
      void this.republishUnconfirmedPosts().finally(() => {
        setTimeout(tick, this.REPUBLISH_INTERVAL_MS);
      });
    };
    setTimeout(tick, 20_000);
  }

  private static enqueueLocalPostBackupWrite(task: () => Promise<void>): Promise<void> {
    const run = this.localPostBackupWriteQueue.then(task, task);
    this.localPostBackupWriteQueue = run.catch(() => {});
    return run;
  }

  private static async readLocalPostMap(): Promise<LocalPostBackupMap> {
    try {
      const raw = await StorageService.getMetadata(LOCAL_POSTS_META_KEY);
      if (!raw || typeof raw !== 'object') return {};
      const normalized: LocalPostBackupMap = {};
      Object.entries(raw as Record<string, any>).forEach(([postId, value]) => {
        if (!value || typeof value !== 'object' || !value.post || typeof value.post !== 'object') return;
        const post = value.post as Post;
        if (!post?.id) return;
        normalized[postId] = { post, backedUpAt: Number(value.backedUpAt) || post.createdAt || Date.now() };
      });
      return normalized;
    } catch {
      return {};
    }
  }

  private static async readLocalPostTombstones(): Promise<Record<string, number>> {
    try {
      const raw = await StorageService.getMetadata(LOCAL_POSTS_TOMBSTONES_META_KEY);
      if (!raw || typeof raw !== 'object') return {};
      const normalized: Record<string, number> = {};
      Object.entries(raw as Record<string, unknown>).forEach(([postId, value]) => {
        const ts = Number(value);
        if (Number.isFinite(ts) && ts > 0) normalized[postId] = ts;
      });
      return normalized;
    } catch {
      return {};
    }
  }

  private static localPostBackupSignature(post: Post): string {
    return JSON.stringify({
      id: post.id,
      communityId: post.communityId,
      title: post.title,
      content: post.content,
      upvotes: post.upvotes || 0,
      downvotes: post.downvotes || 0,
      score: post.score || 0,
      commentCount: post.commentCount || 0,
      isEncrypted: Boolean(post.isEncrypted),
      encryptedContent: post.encryptedContent || '',
    });
  }

  private static async saveLocalPostBackup(post: Post): Promise<void> {
    if (!post?.id) return;
    const nextSignature = this.localPostBackupSignature(post);
    await this.enqueueLocalPostBackupWrite(async () => {
      try {
        const [next, tombstones] = await Promise.all([
          this.readLocalPostMap(),
          this.readLocalPostTombstones(),
        ]);
        delete tombstones[post.id];
        const existing = next[post.id];
        if (existing?.post && this.localPostBackupSignature(existing.post) === nextSignature) return;
        next[post.id] = { post, backedUpAt: Date.now() };
        const ordered = Object.values(next).sort((a, b) => {
          const left = Number.isFinite(a.backedUpAt) ? a.backedUpAt : a.post.createdAt;
          const right = Number.isFinite(b.backedUpAt) ? b.backedUpAt : b.post.createdAt;
          return right - left;
        }).slice(0, 500);
        const compact: LocalPostBackupMap = {};
        ordered.forEach((item) => { compact[item.post.id] = item; });
        await StorageService.setMetadata(LOCAL_POSTS_META_KEY, compact);
        await StorageService.setMetadata(LOCAL_POSTS_TOMBSTONES_META_KEY, tombstones);
      } catch {
        // best-effort local backup
      }
    });
  }

  private static async removeLocalPostBackup(postId: string): Promise<void> {
    await this.enqueueLocalPostBackupWrite(async () => {
      try {
        const [map, tombstones] = await Promise.all([
          this.readLocalPostMap(),
          this.readLocalPostTombstones(),
        ]);
        if (!map[postId] && tombstones[postId]) return;
        delete map[postId];
        tombstones[postId] = Date.now();
        const recentTombstones = Object.entries(tombstones)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 1000)
          .reduce<Record<string, number>>((acc, [id, ts]) => { acc[id] = ts; return acc; }, {});
        await StorageService.setMetadata(LOCAL_POSTS_META_KEY, map);
        await StorageService.setMetadata(LOCAL_POSTS_TOMBSTONES_META_KEY, recentTombstones);
      } catch {
        // best-effort cleanup
      }
    });
  }
}
