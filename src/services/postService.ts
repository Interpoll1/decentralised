import { GunService, GUN_NAMESPACE } from './gunService';
import { IPFSService } from './ipfsService';
import { CryptoService } from './cryptoService';
import { KeyService } from './keyService';
import { isVersionEnabled } from '../utils/dataVersionSettings';
import { EncryptionService } from './encryptionService';
import { KeyVaultService } from './keyVaultService';

const API_URL = 'https://interpoll.endless.sbs';

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

// ── Timebox: 400ms (was 800ms) — Gun is now live-updates only ─────────────────
const INITIAL_LOAD_TIMEBOX_MS = 400;

async function indexForSearch(type: 'post' | 'poll', id: string, data: any) {
  try {
    const { IntegrityService } = await import('@/services/integrityService');
    const body = await IntegrityService.seal(
      { type, id, data } as Record<string, unknown>,
      'index',
    );
    await fetch(`${API_URL}/api/index`, {
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
      const promises = keys.slice(0, MAX_INITIAL_POSTS).map(postId =>
        new Promise<void>((resolve) => {
          gun.get('posts').get(postId).once((postData: any) => {
            if (postData && postData.id && !initialSeenIds.has(postData.id)) {
              initialSeenIds.add(postData.id);
              collectedPosts.push({ ...postData, dataVersion: GUN_NAMESPACE });
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

    // Only fetch posts we haven't seen yet — prevents re-fetching all N posts
    // on every Gun update (was creating thousands of closures → OOM).
    subscription = communityPostsNode.on((allPosts: any) => {
      if (!allPosts) return;
      Object.keys(allPosts).forEach(postId => {
        if (postId === '_' || initialSeenIds.has(postId)) return;
        initialSeenIds.add(postId);
        gun.get('posts').get(postId).once((postData: any) => {
          if (postData && postData.id) {
            onPost({ ...postData, dataVersion: GUN_NAMESPACE });
          }
        });
      });
    });

    if (isVersionEnabled('v1')) {
      pendingLoads++;
      const rawGun = GunService.getRawGun();
      const v1Node = rawGun.get('communities').get(communityId).get('posts');
      v1Node.once((allPosts: any) => {
        if (!allPosts) { checkLoadComplete(); return; }
        const keys = Object.keys(allPosts).filter(k => k !== '_');
        const v1Collected: Post[] = [];
        const promises = keys.slice(0, MAX_INITIAL_POSTS).map(postId =>
          new Promise<void>((resolve) => {
            rawGun.get('posts').get(postId).once((postData: any) => {
              if (postData && postData.id && !initialSeenIds.has(postData.id)) {
                initialSeenIds.add(postData.id);
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
          if (postId === '_' || initialSeenIds.has(postId)) return;
          initialSeenIds.add(postId);
          rawGun.get('posts').get(postId).once((postData: any) => {
            if (postData && postData.id) onPost({ ...postData, dataVersion: 'v1' });
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
    const initialSeenIds = new Set<string>();
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
      const promises = keys.slice(0, MAX_INITIAL_POSTS).map(postId =>
        new Promise<void>((resolve) => {
          gun.get('posts').get(postId).once((postData: any) => {
            if (postData && postData.id && !initialSeenIds.has(postData.id)) {
              initialSeenIds.add(postData.id);
              collectedPosts.push({ ...postData, dataVersion: GUN_NAMESPACE });
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
        if (postId === '_' || initialSeenIds.has(postId)) return;
        initialSeenIds.add(postId);
        gun.get('posts').get(postId).once((postData: any) => {
          if (postData && postData.id) onPost({ ...postData, dataVersion: GUN_NAMESPACE });
        });
      });
    });

    if (isVersionEnabled('v1')) {
      pendingLoads++;
      const rawGun = GunService.getRawGun();
      const v1PostsNode = rawGun.get('posts');
      v1PostsNode.once((allPosts: any) => {
        if (!allPosts) { checkLoadComplete(); return; }
        const keys = Object.keys(allPosts).filter(k => k !== '_');
        const v1Collected: Post[] = [];
        const promises = keys.slice(0, MAX_INITIAL_POSTS).map(postId =>
          new Promise<void>((resolve) => {
            rawGun.get('posts').get(postId).once((postData: any) => {
              if (postData && postData.id && !initialSeenIds.has(postData.id)) {
                initialSeenIds.add(postData.id);
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
          if (postId === '_' || initialSeenIds.has(postId)) return;
          initialSeenIds.add(postId);
          rawGun.get('posts').get(postId).once((postData: any) => {
            if (postData && postData.id) onPost({ ...postData, dataVersion: 'v1' });
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

  // ── API-first getPost with stale-while-revalidate ─────────────────────────
  static async getPost(postId: string): Promise<Post | null> {
    try {
      const res = await fetch(`${API_URL}/api/post/${postId}`, {
        headers: { 'Cache-Control': 'stale-while-revalidate=30' },
      });
      if (res.ok) {
        const data = await res.json();
        if (data?.id) return { ...data, dataVersion: GUN_NAMESPACE };
      }
    } catch {}

    // Fallback to Gun (new posts written but not yet indexed)
    const gun = GunService.getGun();
    return new Promise((resolve) => {
      gun.get('posts').get(postId).once((postData: any) => {
        if (postData && postData.id) resolve({ ...postData, dataVersion: GUN_NAMESPACE });
        else resolve(null);
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
    const newUpvotes   = (post.upvotes   || 0) + (direction === 'up'   ? 1 : 0);
    const newDownvotes = (post.downvotes || 0) + (direction === 'down' ? 1 : 0);
    await PostService.updatePost(postId, { upvotes: newUpvotes, downvotes: newDownvotes, score: newUpvotes - newDownvotes });
  }

  static async removeVote(postId: string, direction: 'up' | 'down', _userId: string): Promise<void> {
    const post = await PostService.getPost(postId);
    if (!post) throw new Error('Post not found');
    const newUpvotes   = direction === 'up'   ? Math.max(0, (post.upvotes   || 0) - 1) : (post.upvotes   || 0);
    const newDownvotes = direction === 'down' ? Math.max(0, (post.downvotes || 0) - 1) : (post.downvotes || 0);
    await PostService.updatePost(postId, { upvotes: newUpvotes, downvotes: newDownvotes, score: newUpvotes - newDownvotes });
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