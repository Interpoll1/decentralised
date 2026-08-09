import { GunService, GUN_NAMESPACE } from './gunService';
import { PostVoteService, type PostTally } from './postVoteService';
import { IPFSService } from './ipfsService';
import { CryptoService } from './cryptoService';
import { KeyService } from './keyService';
import { StorageService } from './storageService';
import { isVersionEnabled } from '../utils/dataVersionSettings';
import { EncryptionService } from './encryptionService';
import { KeyVaultService } from './keyVaultService';
import config from '../config';
import { BoundedMap, BoundedSet } from '../utils/boundedMap';
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
  /** Optional category label (e.g. 'technology', 'politics'). Arrives from Gun a few seconds after post creation. */
  category?: string;
  /** Tags stored in Gun as a comma-separated string, parsed to array on read. */
  tags?: string[];
  /** AI/author sentiment hint — positive | negative | neutral */
  sentiment?: 'positive' | 'negative' | 'neutral';
  /** Whether the post is marked adult-only */
  nsfw?: boolean;
  /** IPFS CID of attached video (stored via Filebase, played via VideoPlayer) */
  videoCID?: string;
  /** IPFS CID of video thumbnail (JPEG extracted client-side before compression) */
  videoThumbnailCID?: string;
  /** Video duration in seconds */
  videoDuration?: number;
  /** Compressed video file size in bytes */
  videoSize?: number;
  /** Video MIME type, e.g. 'video/mp4' */
  videoMimeType?: string;
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

/**
 * Normalize raw Gun post data — coerces Gun-stored scalars back to the types
 * the Post interface expects. Called at every read site so the conversion is
 * not scattered across the service.
 *
 * Gun-stored specifics handled here:
 *  - tags: Gun can't store arrays natively → stored as 'bitcoin,crypto,ethereum',
 *          read back as string, split to string[].
 *  - nsfw: stored as 0/1 in some older writes → coerced to boolean.
 */
function normalizeGunPost(postData: any): any {
  if (!postData || typeof postData !== 'object') return postData;
  const out = { ...postData };
  if (out.tags !== undefined) {
    if (typeof out.tags === 'string') {
      out.tags = out.tags ? out.tags.split(',').map((t: string) => t.trim()).filter(Boolean) : [];
    } else if (!Array.isArray(out.tags)) {
      out.tags = [];
    }
  }
  if (out.nsfw !== undefined) {
    out.nsfw = Boolean(out.nsfw);
  }
  // Video fields — Gun stores numbers as strings in some edge cases, coerce back
  if (out.videoDuration !== undefined) out.videoDuration = Number(out.videoDuration) || 0;
  if (out.videoSize     !== undefined) out.videoSize     = Number(out.videoSize)     || 0;
  // Clean empty string CIDs (Gun sometimes writes '' instead of omitting the field)
  if (!out.videoCID)          delete out.videoCID;
  if (!out.videoThumbnailCID) delete out.videoThumbnailCID;
  if (!out.videoMimeType)     delete out.videoMimeType;
  return out;
}
const MAX_INITIAL_POSTS = 50;
const MAX_COMMUNITY_INITIAL_POSTS = 120;
const MISSING_POST_CACHE_TTL_MS = 30_000;

// Both of these were plain Maps that only ever grew — one entry per post the
// session had ever rendered or failed to find. On a long feed scroll that is the
// single largest app-level heap contributor. Bounded now, and reachable from the
// memory watchdog via PostService.trimCaches().
const MAX_CACHED_POSTS = 400;
const missingPostCache = new BoundedSet<string>({ maxSize: 500, ttlMs: MISSING_POST_CACHE_TTL_MS });
const postMemoryCache = new BoundedMap<string, Post>({ maxSize: MAX_CACHED_POSTS });

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

// Search indexing is not a client concern. The gun-relay process indexes posts
// and polls off its own Gun write hook (gun-relay/gun-relay-enhanced.js,
// maybeIndexNode), so anything that reaches the graph is indexed regardless of
// whether the author was signed in. The old client-side POST to /api/index could
// never have worked: that endpoint requires a shared secret a browser cannot hold,
// so every call returned 401 into a swallowed warning — and it paid for a
// proof-of-work seal on the publish path to do it.

export class PostService {
  /**
   * Release cached post data under memory pressure. Called by the memory watchdog;
   * see the cleanup registration in main.ts.
   *
   * `light` only reclaims entries that have already aged out, `aggressive` shrinks
   * the live cache, `emergency` drops it entirely (correctness is unaffected —
   * every entry is re-derivable from Gun or the relay).
   */
  static trimCaches(level: 'light' | 'aggressive' | 'emergency'): void {
    missingPostCache.prune();
    if (level === 'aggressive') postMemoryCache.trimTo(100);
    if (level === 'emergency') {
      postMemoryCache.clear();
      missingPostCache.clear();
    }
  }

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
      // Dynamic import: ipfs-core is large. Load it only when user attaches an
      // image so vendor-ipfs.js stays out of the critical bundle entirely.
      const { IPFSService } = await import('./ipfsService');
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
      // Optional metadata fields — passed through from the create form
      ...(post.category     ? { category: post.category }          : {}),
      ...(post.tags?.length ? { tags: post.tags }                   : {}),
      ...(post.sentiment    ? { sentiment: post.sentiment }         : {}),
      ...(post.nsfw         ? { nsfw: true }                        : {}),
      // Video fields — only included when a video was uploaded
      ...(post.videoCID          ? { videoCID:          post.videoCID }          : {}),
      ...(post.videoThumbnailCID ? { videoThumbnailCID: post.videoThumbnailCID } : {}),
      ...(post.videoDuration     ? { videoDuration:     post.videoDuration }     : {}),
      ...(post.videoSize         ? { videoSize:         post.videoSize }         : {}),
      ...(post.videoMimeType     ? { videoMimeType:     post.videoMimeType }     : {}),
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

    // Gun can't store arrays — serialise tags as a comma string
    if (newPost.imageIPFS)        cleanPost.imageIPFS        = newPost.imageIPFS;
    if (newPost.imageThumbnail)   cleanPost.imageThumbnail   = newPost.imageThumbnail;
    if (newPost.category)         cleanPost.category         = newPost.category;
    if (newPost.tags?.length)     cleanPost.tags             = newPost.tags.join(',');
    if (newPost.sentiment)        cleanPost.sentiment        = newPost.sentiment;
    if (newPost.nsfw)             cleanPost.nsfw             = 1;
    // Video fields — omit entirely if absent (no null/empty string in Gun)
    if (newPost.videoCID)          cleanPost.videoCID          = newPost.videoCID;
    if (newPost.videoThumbnailCID) cleanPost.videoThumbnailCID = newPost.videoThumbnailCID;
    if (newPost.videoDuration)     cleanPost.videoDuration     = newPost.videoDuration;
    if (newPost.videoSize)         cleanPost.videoSize         = newPost.videoSize;
    if (newPost.videoMimeType)     cleanPost.videoMimeType     = newPost.videoMimeType;

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

    // Gun put ack can hang indefinitely if the relay is still handshaking after
    // a long video upload. Post is already in Gun's local graph — ack just
    // confirms relay write. Timeout after 6s and continue; verifyRelayPersistence
    // + republishLoop handle durability if the relay missed it.
    const gunPutWithTimeout = (node: any, data: any, label: string): Promise<void> =>
      new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          console.warn(`[createPost] Gun ack timeout for ${label} — continuing`);
          resolve();
        }, 6_000);
        node.put(data, (ack: any) => {
          clearTimeout(timer);
          if (ack?.err) console.warn(`[createPost] Gun ack error for ${label}:`, ack.err);
          resolve(); // always resolve — never reject on ack error
        });
      });

    await gunPutWithTimeout(
      gun.get('posts').get(newPost.id),
      cleanPost,
      'posts root',
    );
    await gunPutWithTimeout(
      gun.get('communities').get(newPost.communityId).get('posts').get(newPost.id),
      cleanPost,
      `communities/${newPost.communityId}`,
    );

    postMemoryCache.set(newPost.id, newPost);
    missingPostCache.delete(newPost.id);

    // Durability: back up locally first (so republish can recover it even if the
    // verification below is slow/fails), then independently confirm the relay
    // actually holds it. If unconfirmed, start the republish loop so the post is
    // re-pushed once the relay is reachable rather than being silently lost.
    await PostService.saveLocalPostBackup(newPost);
    // After a video upload the relay has already been active for 60+ seconds —
    // give it only 3s to confirm rather than 8s. If it misses, republishLoop
    // will retry. For normal posts keep 5s (reduced from 8s).
    const hasVideo = !!(newPost as any).videoCID;
    const relayConfirmed = await PostService.verifyRelayPersistence(
      newPost.id,
      hasVideo ? 3_000 : 5_000,
    );
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
      const keys = Object.keys(allPosts).filter(k => k && k !== '_');
      void loadPostIdsInBatches(
        keys.slice(0, MAX_COMMUNITY_INITIAL_POSTS),
        (postId) => postId ? onceWithTimeout(gun.get('posts').get(postId)) : Promise.resolve(null),
        (postData) => {
          if (postData.id && !initialSeenIds.has(postData.id)) {
            initialSeenIds.add(postData.id);
            collectedPosts.push({ ...normalizeGunPost(postData), dataVersion: (postData && postData.dataVersion) ? postData.dataVersion : GUN_NAMESPACE });
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
    // Buffer emitted keys and flush on a short timer so a re-sync burst can't fan
    // out thousands of concurrent gets (the "1K+ records/sec" DOM warning) —
    // batching also lets duplicate keys collapse before we ever hit the network.
    const pendingIds = new Set<string>();
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    const flushPending = () => {
      flushTimer = null;
      const ids = [...pendingIds];
      pendingIds.clear();
      for (const postId of ids) {
        if (inFlightIds.has(postId)) continue;
        inFlightIds.add(postId);
        void onceWithTimeout(gun.get('posts').get(postId)).then((postData) => {
          if (postData && postData.id) {
            initialSeenIds.add(postData.id);
            onPost({ ...normalizeGunPost(postData), dataVersion: (postData && postData.dataVersion) ? postData.dataVersion : GUN_NAMESPACE });
          }
        }).finally(() => {
          inFlightIds.delete(postId);
        });
      }
    };
    subscription = communityPostsNode.map().on((data: any, postId: string) => {
      if (!initialLoadDone) return;
      if (!postId || postId === '_' || inFlightIds.has(postId)) return;
      // Category/metadata patch — bypass batch queue and re-fetch immediately
      if (data && typeof data === 'object' && data.category && !data.title) {
        if (!inFlightIds.has(postId)) {
          inFlightIds.add(postId);
          void onceWithTimeout(gun.get('posts').get(postId)).then((postData) => {
            if (postData && postData.id) {
              onPost({ ...normalizeGunPost(postData), dataVersion: postData.dataVersion || GUN_NAMESPACE });
            }
          }).finally(() => inFlightIds.delete(postId));
        }
        return;
      }
      pendingIds.add(postId);
      if (!flushTimer) flushTimer = setTimeout(flushPending, 100);
    });

    // v1 posts intentionally excluded from community feed — only using GUN v3 namespace

    const listenerKey = `${communityId}-posts-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    postActiveListeners.set(listenerKey, { subscription, v1Subscription, timer: timeboxTimer });

    return () => {
      clearTimeout(timeboxTimer);
      if (flushTimer) clearTimeout(flushTimer);
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
      const keys = Object.keys(allPosts).filter(k => k && k !== '_');
      void loadPostIdsInBatches(
        keys.slice(0, MAX_INITIAL_POSTS),
        (postId) => postId ? onceWithTimeout(gun.get('posts').get(postId)) : Promise.resolve(null),
        (postData) => {
          if (postData.id && !initialSeenIds.has(postData.id)) {
            initialSeenIds.add(postData.id);
            collectedPosts.push({ ...normalizeGunPost(postData), dataVersion: (postData && postData.dataVersion) ? postData.dataVersion : GUN_NAMESPACE });
          }
        },
        50,
      ).then(() => {
        collectedPosts.sort((a, b) => b.createdAt - a.createdAt);
        collectedPosts.forEach(p => onPost(p));
        checkLoadComplete();
      });
    });

    // Live updates. This used to be a plain `.on()` on the whole `posts` root
    // that re-walked *every* key on every root patch and issued a
    // `gun.get('posts').get(id)` for each — one permanent chain per post in the
    // graph, so the heap grew with the size of the network rather than with what
    // the user is actually reading. Use the same batched `map().on` + pendingIds
    // shape as subscribeToCommunityPosts above: one key per emit, deduped, and
    // flushed on a short timer so a re-sync burst can't fan out thousands of gets.
    const pendingIds = new Set<string>();
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    const flushPending = () => {
      flushTimer = null;
      const ids = [...pendingIds];
      pendingIds.clear();
      for (const postId of ids) {
        if (inFlightIds.has(postId)) continue;
        inFlightIds.add(postId);
        void onceWithTimeout(gun.get('posts').get(postId)).then((postData) => {
          if (postData && postData.id) {
            initialSeenIds.add(postData.id);
            onPost({ ...normalizeGunPost(postData), dataVersion: (postData && postData.dataVersion) ? postData.dataVersion : GUN_NAMESPACE });
          }
        }).finally(() => {
          inFlightIds.delete(postId);
        });
      }
    };
    // Re-hydration cooldown. Gun re-emits a key on every update that touches it
    // (including its own echoes and any relay re-send), and each emit here costs
    // a `once()` round-trip plus a fresh object. On the *global* feed root that
    // is enough allocation churn to outrun the collector even though nothing is
    // retained. A post that was refetched seconds ago is not refetched again.
    const REHYDRATE_COOLDOWN_MS = 30_000;
    const lastHydratedAt = new Map<string, number>();
    subscription = postsNode.map().on((data: any, postId: string) => {
      if (!initialLoadDone) return;
      if (!postId || postId === '_' || inFlightIds.has(postId)) return;

      // ── Category/metadata patch from backend categorisation ───────────────
      // When gun.get('v3').get('posts').get(id).put({category, tags, nsfw}) fires,
      // map().on() delivers the partial data as `data`. It won't have `title` or
      // `content` — only the newly written fields. Merge immediately without a
      // full re-fetch so the category badge appears within 1-3s of categorisation.
      if (data && typeof data === 'object' && data.category && !data.title) {
        const normalized = normalizeGunPost(data);
        // Emit as a minimal post-like object; postStore.processIncomingPost will
        // merge it with the existing post via postsMap.value.set(id, withKnownTally(post)).
        // We need to deliver the full existing post merged with the new fields, so
        // do a quick once() but skip the cooldown for metadata-only patches.
        if (!inFlightIds.has(postId)) {
          inFlightIds.add(postId);
          void onceWithTimeout(gun.get('posts').get(postId)).then((postData) => {
            if (postData && postData.id) {
              onPost({ ...normalizeGunPost(postData), dataVersion: postData.dataVersion || GUN_NAMESPACE });
            }
          }).finally(() => inFlightIds.delete(postId));
        }
        return;
      }

      const now = Date.now();
      if (now - (lastHydratedAt.get(postId) ?? 0) < REHYDRATE_COOLDOWN_MS) {
        // Exception: if the incoming Gun patch carries videoCID and our cached
        // post doesn't have it yet, bypass the cooldown so the video skeleton
        // appears immediately rather than waiting up to 30s for the next window.
        const hasCachedVideo = !!(postMemoryCache.get(postId) as any)?.videoCID;
        const incomingHasVideo = !!(data as any)?.videoCID;
        if (!hasCachedVideo && incomingHasVideo) {
          // fall through to refetch
        } else {
          return;
        }
      }
      lastHydratedAt.set(postId, now);
      // Bounded: the map is a rate limiter, not a cache. Oldest entries expire
      // by cooldown anyway, so dropping them just permits an earlier refetch.
      if (lastHydratedAt.size > 2000) {
        for (const [id, at] of lastHydratedAt) {
          if (now - at > REHYDRATE_COOLDOWN_MS) lastHydratedAt.delete(id);
        }
      }
      pendingIds.add(postId);
      if (!flushTimer) flushTimer = setTimeout(flushPending, 100);
    });

    // v1 posts intentionally excluded from global feed — only using GUN v3 namespace

    const listenerKey = `all-posts-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    postActiveListeners.set(listenerKey, { subscription, v1Subscription, timer: timeboxTimer });

    return () => {
      clearTimeout(timeboxTimer);
      if (flushTimer) clearTimeout(flushTimer);
      if (subscription) subscription.off();
      if (v1Subscription) v1Subscription.off();
      postActiveListeners.delete(listenerKey);
    };
  }

  // ── API-first getPost with stale-while-revalidate ─────────────────────────
  static async getPost(postId: string): Promise<Post | null> {
    const cached = postMemoryCache.get(postId);
    if (cached) return cached;

    // The set carries its own TTL now, so membership alone answers the question.
    const isRecentlyMissing = missingPostCache.has(postId);

    if (!isRecentlyMissing) {
      // Skip the REST fetch for poll IDs — they're not in the post API.
      const isPollId = postId.startsWith('poll-');
      if (!isPollId) {
        try {
          const res = await fetch(`${getApiBase()}/api/post/${postId}`);
          if (res.ok) {
            const data = await res.json();
            if (data?.id) {
              const post = { ...normalizeGunPost(data), dataVersion: (data && data.dataVersion) ? data.dataVersion : GUN_NAMESPACE };
              postMemoryCache.set(postId, post);
              missingPostCache.delete(postId);
              return post;
            }
          } else if (res.status === 404) {
            missingPostCache.add(postId);
          }
        } catch {}
      }
    }

    // Fallback to Gun (new posts written but not yet indexed)
    const gun = GunService.getGun();
    const postData = await onceWithTimeout(gun.get('posts').get(postId));
    if (postData && postData.id) {
      const post = { ...normalizeGunPost(postData), dataVersion: (postData && postData.dataVersion) ? postData.dataVersion : GUN_NAMESPACE };
      postMemoryCache.set(postId, post);
      missingPostCache.delete(postId);
      return post;
    }
    missingPostCache.add(postId);
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

  /**
   * Read a post for the client-side view of a vote result.
   *
   * Counters are no longer computed from this — `PostVoteService` derives them
   * from the per-user vote set — so a stale read can no longer revert a vote.
   * This only supplies the surrounding post fields to merge the tally into.
   */
  private static async getPostForCounterUpdate(postId: string): Promise<Post | null> {
    const gun = GunService.getGun();
    // Try the posts path first (works for actual posts)
    const live = await onceWithTimeout(gun.get('posts').get(postId));
    if (live && live.id) {
      return { ...normalizeGunPost(live), dataVersion: live.dataVersion || GUN_NAMESPACE } as Post;
    }
    // For poll IDs: the posts path only has category metadata, not the full poll.
    // Try the polls path to get the actual data for counter updates.
    if (postId.startsWith('poll-')) {
      const pollData = await onceWithTimeout(gun.get('polls').get(postId));
      if (pollData && (pollData.id || pollData.question)) {
        return {
          id: postId,
          communityId: pollData.communityId || '',
          authorId: pollData.authorId || '',
          authorName: pollData.authorName || '',
          title: pollData.question || pollData.title || '',
          content: pollData.description || '',
          createdAt: pollData.createdAt || Date.now(),
          upvotes: pollData.upvotes || 0,
          downvotes: pollData.downvotes || 0,
          score: (pollData.upvotes || 0) - (pollData.downvotes || 0),
          commentCount: 0,
          dataVersion: GUN_NAMESPACE,
        } as Post;
      }
    }
    return PostService.getPost(postId);
  }

  private static applyTally(post: Post, tally: PostTally): Post {
    const updated: Post = { ...post, ...tally };
    postMemoryCache.set(post.id, updated);
    return updated;
  }

  /**
   * Toggle this user's vote on a post.
   *
   * Returns `myVote` alongside the post because the caller cannot predict the
   * outcome: a click the UI believes is "upvote" is a *clear* if the graph
   * already holds an upvote from this user. The old signature returned only the
   * post, so callers guessed from localStorage and rendered +1 while the write
   * did -1 — the single most visible source of vote flicker.
   */
  static async voteOnPost(
    postId: string,
    direction: 'up' | 'down',
    userId: string,
  ): Promise<{ post: Post; myVote: 'up' | 'down' | null }> {
    const post = await PostService.getPostForCounterUpdate(postId);
    if (!post) throw new Error('Post not found');
    const { tally, myVote } = await PostVoteService.castVote(postId, userId, direction);
    return { post: PostService.applyTally(post, tally), myVote };
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

  /**
   * Clear this user's vote, whatever it is.
   *
   * `direction` is no longer used to gate the write. The old version returned
   * the post untouched when the graph read did not confirm a matching vote —
   * including when the read merely timed out — which left the caller's
   * optimistic -1 on screen with nothing behind it.
   */
  static async removeVote(
    postId: string,
    _direction: 'up' | 'down',
    userId: string,
  ): Promise<{ post: Post; myVote: 'up' | 'down' | null }> {
    const post = await PostService.getPostForCounterUpdate(postId);
    if (!post) throw new Error('Post not found');
    const { tally, myVote } = await PostVoteService.clearVote(postId, userId);
    return { post: PostService.applyTally(post, tally), myVote };
  }

  /** This user's vote as the graph has it — the authority for button state. */
  static async getMyVote(postId: string, userId: string): Promise<'up' | 'down' | null> {
    return PostVoteService.getMyVote(postId, userId);
  }

  /** Authoritative counts, derived from the vote set rather than the stored counters. */
  static async getTally(postId: string): Promise<PostTally> {
    return PostVoteService.getTally(postId);
  }

  /** Live authoritative counts for one post. */
  static subscribeToVotes(postId: string, callback: (tally: PostTally) => void): () => void {
    return PostVoteService.subscribeTally(postId, callback);
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
  static async verifyRelayPersistence(postId: string, deadlineMs = 5_000): Promise<boolean | null> {
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