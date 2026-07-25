import { GunService, GUN_NAMESPACE } from './gunService';
import { CryptoService } from './cryptoService';
import { KeyService } from './keyService';
import { AuditService } from './auditService';
import { PostService } from './postService';
import { EncryptionService } from './encryptionService';
import { KeyVaultService } from './keyVaultService';
import { StorageService } from './storageService';
import { BoundedMap, BoundedSet } from '../utils/boundedMap';
import config from '../config';
import { canonicalJSON } from '../../shared-validation/canonical.js';

const CURRENT_CANON_VERSION = 2;

// Comment durability (mirrors post/poll relay-persistence machinery) ──────────
const LOCAL_COMMENTS_META_KEY = 'interpoll-local-comments-v1';
const LOCAL_COMMENTS_TOMBSTONES_META_KEY = 'interpoll-local-comments-tombstones-v1';
const LOCAL_COMMENT_BACKUP_TTL_MS = 30 * 60 * 1000;
const REPUBLISH_MAX_ATTEMPTS = 5;
const REPUBLISH_INTERVAL_MS = 120_000;

type LocalCommentBackupEntry = { comment: Comment; backedUpAt: number };
type LocalCommentBackupMap = Record<string, LocalCommentBackupEntry>;

let commentRepublishLoopStarted = false;
let commentRepublishInFlight = false;
// Republish bookkeeping: entries are only removed on success, so failures used to
// accumulate for the life of the session (and commentIndexRepublished was never
// cleared at all). Both are hints — losing one costs at most a redundant republish.
const commentRepublishAttempts = new BoundedMap<string, number>({ maxSize: 500, ttlMs: 60 * 60_000 });
const commentIndexRepublished = new BoundedSet<string>({ maxSize: 1000, ttlMs: 60 * 60_000 });
let localCommentBackupWriteQueue: Promise<void> = Promise.resolve();

function getGunRelayBase(): string {
  return config.relay.gun.replace(/\/gun$/, '');
}

function getGun() {
  return GunService.getGun();
}

export interface Comment {
  id: string;
  postId: string;
  communityId: string;
  authorId: string;
  authorName: string;
  authorShowRealName?: boolean;
  content: string;
  parentId?: string;
  createdAt: number;
  upvotes: number;
  downvotes: number;
  score: number;
  edited?: boolean;
  editedAt?: number;
  authorPubkey?: string;
  contentSignature?: string;
  /** Which canonicalization algorithm contentSignature was produced with. Absent = legacy v1 (buildSignablePayloadV1). */
  canonVersion?: number;
  isEncrypted?: boolean;
  encryptedContent?: string;    // AES-GCM encrypted comment data
  authTag?: string;             // HMAC anti-sabotage tag
}

export interface CreateCommentData {
  postId: string;
  communityId: string;
  authorId: string;
  authorName: string;
  authorShowRealName?: boolean;
  content: string;
  parentId?: string;
}

/** @deprecated Legacy per-service canonicalizer, kept for verifying comments signed before the shared canonicalJSON was adopted. Never sign new comments with this. */
function buildSignablePayloadV1(c: Pick<Comment, 'content' | 'postId' | 'communityId' | 'createdAt'>): string {
  return JSON.stringify({
    content: c.content,
    postId: c.postId,
    communityId: c.communityId,
    timestamp: c.createdAt,
  });
}

function buildSignablePayload(c: Pick<Comment, 'content' | 'postId' | 'communityId' | 'createdAt'>): string {
  return canonicalJSON({
    content: c.content,
    postId: c.postId,
    communityId: c.communityId,
    timestamp: c.createdAt,
  });
}

/**
 * Create a new comment
 */
export async function createComment(data: CreateCommentData): Promise<Comment> {
  const commentId = `comment_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const timestamp = Date.now();

  const comment: Comment = {
    id: commentId,
    postId: data.postId,
    communityId: data.communityId,
    authorId: data.authorId,
    authorName: data.authorName,
    authorShowRealName: data.authorShowRealName || false,
    content: data.content,
    parentId: data.parentId || undefined,
    createdAt: timestamp,
    upvotes: 0,
    downvotes: 0,
    score: 0,
    edited: false
  };

  // Sign content for anti-sabotage verification
  try {
    const keyPair = await KeyService.getKeyPair();
    const contentHash = CryptoService.hash(buildSignablePayload(comment));
    const signature = CryptoService.sign(contentHash, keyPair.privateKey);
    comment.authorPubkey = keyPair.publicKey;
    comment.contentSignature = signature;
    comment.canonVersion = CURRENT_CANON_VERSION;
  } catch (err) {
    console.warn('Failed to sign comment content:', err);
  }

  // Encrypt content if community is encrypted
  if (data.communityId) {
    const storedKey = await KeyVaultService.getKey(data.communityId);
    if (storedKey) {
      try {
        const aesKey = await EncryptionService.importKey(storedKey.key);
        const encryptableData = {
          content: comment.content,
          authorId: comment.authorId,
          authorName: comment.authorName,
        };
        comment.encryptedContent = await EncryptionService.encrypt(JSON.stringify(encryptableData), aesKey);
        comment.authTag = await EncryptionService.generateAuthTag(aesKey, comment.id, String(comment.createdAt), comment.authorId);
        comment.isEncrypted = true;
      } catch (err) {
        throw new Error(`Failed to encrypt comment: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  return new Promise((resolve, reject) => {
    const commentNode = getGun().get('comments').get(commentId);
    
    // Set each field individually (Gun.js prefers this approach)
    commentNode.get('id').put(commentId);
    commentNode.get('postId').put(data.postId);
    commentNode.get('communityId').put(data.communityId);
    commentNode.get('authorId').put(data.authorId);
    commentNode.get('authorName').put(comment.isEncrypted ? 'encrypted' : data.authorName);
    commentNode.get('authorShowRealName').put(data.authorShowRealName || false);
    commentNode.get('content').put(comment.isEncrypted ? '🔒 Encrypted comment' : data.content);
    
    if (data.parentId) {
      commentNode.get('parentId').put(data.parentId);
    }
    
    commentNode.get('createdAt').put(timestamp);
    commentNode.get('upvotes').put(0);
    commentNode.get('downvotes').put(0);
    commentNode.get('score').put(0);
    commentNode.get('edited').put(false);

    if (comment.authorPubkey) {
      commentNode.get('authorPubkey').put(comment.authorPubkey);
    }
    if (comment.contentSignature) {
      commentNode.get('contentSignature').put(comment.contentSignature);
    }

    if (comment.isEncrypted) {
      commentNode.get('isEncrypted').put(true);
      commentNode.get('encryptedContent').put(comment.encryptedContent);
      commentNode.get('authTag').put(comment.authTag);
    }

    // Add to post's comments index
    getGun().get('posts')
      .get(data.postId)
      .get('comments')
      .set({ commentId, createdAt: timestamp });
    
    setTimeout(() => {
      // Audit receipt (fire-and-forget)
      (async () => {
        try {
          const contentHash = CryptoService.hash(
            JSON.stringify({
              id: comment.id,
              postId: comment.postId,
              communityId: comment.communityId,
              authorId: comment.authorId,
              createdAt: comment.createdAt,
              content: comment.content,
            })
          );

          await AuditService.logReceipt('comment', {
            commentId: comment.id,
            postId: comment.postId,
            communityId: comment.communityId,
            authorId: comment.authorId,
            createdAt: comment.createdAt,
            contentHash,
          });
        } catch (_error) {
          // Non-fatal: audit logging failed
        }
      })();

      // Bump comment count on the associated post (best-effort)
      (async () => {
        try {
          await PostService.incrementCommentCount(data.postId, data.communityId);
        } catch (_err) {
          // Non-fatal: comment count increment failed
        }
      })();

      // Durability: back up locally and kick the republish loop. Not awaited —
      // comment creation must stay fast; the loop verifies + re-pushes in the
      // background. Encrypted comments are redacted before backup (no plaintext).
      void saveLocalCommentBackup(comment);
      startCommentRepublishLoop();
      setTimeout(() => { void republishUnconfirmedComments(); }, 15_000);

      resolve(comment);
    }, 100);
  });
}

/**
 * Get a single comment by ID
 */
export async function getComment(commentId: string): Promise<Comment | null> {
  return new Promise((resolve) => {
    getGun().get('comments')
      .get(commentId)
      .once((data) => {
        if (data && data.id) {
          resolve(data as Comment);
        } else {
          resolve(null);
        }
      });
  });
}

/**
 * Subscribe to real-time updates for comments in a post.
 * Returns an unsubscribe function to clean up all listeners.
 */
export function subscribeToCommentsInPost(
  postId: string,
  callback: (comment: Comment) => void
): () => void {
  const seenCommentIds = new Set<string>();
  let active = true;

  const listener = getGun().get('posts')
    .get(postId)
    .get('comments')
    .map()
    .on((data: any) => {
      if (!active || !data?.commentId || seenCommentIds.has(data.commentId)) return;
      seenCommentIds.add(data.commentId);
      // Use .once() — not .on() — to avoid permanent inner subscriptions
      getGun().get('comments')
        .get(data.commentId)
        .once((commentData: any) => {
          if (!active) return;
          if (commentData && commentData.id) {
            const comment: Comment = {
              id: commentData.id,
              postId: commentData.postId || postId,
              communityId: commentData.communityId,
              authorId: commentData.authorId,
              authorName: commentData.authorName,
              authorShowRealName: commentData.authorShowRealName === true,
              content: commentData.content,
              parentId: commentData.parentId && commentData.parentId !== 'null' && commentData.parentId !== '' ? commentData.parentId : undefined,
              createdAt: commentData.createdAt,
              upvotes: commentData.upvotes || 0,
              downvotes: commentData.downvotes || 0,
              score: commentData.score || 0,
              edited: commentData.edited || false,
              editedAt: commentData.editedAt,
              authorPubkey: commentData.authorPubkey || undefined,
              contentSignature: commentData.contentSignature || undefined,
              isEncrypted: commentData.isEncrypted || false,
              encryptedContent: commentData.encryptedContent || undefined,
              authTag: commentData.authTag || undefined,
            };
            callback(comment);
          }
        });
    });

  return () => {
    active = false;
    if (listener?.off) listener.off();
  };
}

/**
 * Get all comments for a post (one-time fetch)
 */
export async function getAllCommentsInPost(postId: string): Promise<Comment[]> {
  return new Promise((resolve) => {
    const comments: Comment[] = [];
    const seen = new Set<string>();

    getGun().get('posts')
      .get(postId)
      .get('comments')
      .map()
      .once((data: any) => {
        if (data && data.commentId && !seen.has(data.commentId)) {
          seen.add(data.commentId);
          
          getGun().get('comments')
            .get(data.commentId)
            .once((commentData: any) => {
              if (commentData && commentData.id) {
                const comment: Comment = {
                  id: commentData.id,
                  postId: commentData.postId || postId,
                  communityId: commentData.communityId,
                  authorId: commentData.authorId,
                  authorName: commentData.authorName,
                  authorShowRealName: commentData.authorShowRealName === true,
                  content: commentData.content,
                  // CRITICAL: Only set parentId if it actually exists (not null, undefined, or empty string)
                  parentId: commentData.parentId && commentData.parentId !== 'null' && commentData.parentId !== '' ? commentData.parentId : undefined,
                  createdAt: commentData.createdAt,
                  upvotes: commentData.upvotes || 0,
                  downvotes: commentData.downvotes || 0,
                  score: commentData.score || 0,
                  edited: commentData.edited || false,
                  editedAt: commentData.editedAt,
                  authorPubkey: commentData.authorPubkey || undefined,
                  contentSignature: commentData.contentSignature || undefined,
                  isEncrypted: commentData.isEncrypted || false,
                  encryptedContent: commentData.encryptedContent || undefined,
                  authTag: commentData.authTag || undefined,
                };
                comments.push(comment);
              }
            });
        }
      });

    // Wait for all comments to load
    setTimeout(() => {
      resolve(comments);
    }, 1500);
  });
}

/**
 * Get replies to a comment
 */
export async function getReplies(parentCommentId: string): Promise<Comment[]> {
  return new Promise((resolve) => {
    const replies: Comment[] = [];
    const seen = new Set<string>();

    getGun().get('comments')
      .map()
      .once((comment: any) => {
        if (
          comment && 
          comment.id && 
          comment.parentId === parentCommentId &&
          !seen.has(comment.id)
        ) {
          seen.add(comment.id);
          replies.push(comment as Comment);
        }
      });

    setTimeout(() => {
      resolve(replies.sort((a, b) => b.score - a.score));
    }, 500);
  });
}

/**
 * Vote on a comment
 */
export async function voteOnComment(
  commentId: string,
  voteType: 'up' | 'down',
  userId: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    // Get current comment data
    getGun().get('comments')
      .get(commentId)
      .once((comment: any) => {
        if (!comment || !comment.id) {
          reject(new Error('Comment not found'));
          return;
        }

        const voteKey = `vote_${userId}_${commentId}`;
        
        // Check existing vote
        getGun().get('votes')
          .get(voteKey)
          .once((existingVote: any) => {
            let upvotes = comment.upvotes || 0;
            let downvotes = comment.downvotes || 0;

            // Remove old vote if exists
            if (existingVote && existingVote.type) {
              if (existingVote.type === 'up') {
                upvotes = Math.max(0, upvotes - 1);
              } else if (existingVote.type === 'down') {
                downvotes = Math.max(0, downvotes - 1);
              }
            }

            // Add new vote (or toggle off if same vote)
            if (!existingVote || existingVote.type !== voteType) {
              if (voteType === 'up') {
                upvotes++;
              } else {
                downvotes++;
              }

              // Store the vote
              getGun().get('votes')
                .get(voteKey)
                .put({
                  userId,
                  commentId,
                  type: voteType,
                  timestamp: Date.now()
                });
            } else {
              // Toggle off - remove vote
              getGun().get('votes')
                .get(voteKey)
                .put(null);
            }

            const score = upvotes - downvotes;

            // Update comment - use .put() on the parent node with all fields
            const commentNode = getGun().get('comments').get(commentId);
            
            // Update vote counts
            commentNode.put({
              upvotes: upvotes,
              downvotes: downvotes,
              score: score
            }, (ack: any) => {
              if (ack.err) {
                reject(new Error(ack.err));
              } else {
                resolve();
              }
            });
          });
      });
  });
}

/**
 * Edit a comment
 */
export async function editComment(commentId: string, newContent: string): Promise<void> {
  return new Promise((resolve, reject) => {
    getGun().get('comments')
      .get(commentId)
      .once(async (comment: any) => {
        if (!comment || !comment.id) {
          reject(new Error('Comment not found'));
          return;
        }

        getGun().get('comments')
          .get(commentId)
          .get('content')
          .put(newContent);

        getGun().get('comments')
          .get(commentId)
          .get('edited')
          .put(true);

        getGun().get('comments')
          .get(commentId)
          .get('editedAt')
          .put(Date.now());

        // Re-sign with updated content
        try {
          const keyPair = await KeyService.getKeyPair();
          const contentHash = CryptoService.hash(buildSignablePayload({
            content: newContent,
            postId: comment.postId,
            communityId: comment.communityId,
            createdAt: comment.createdAt,
          }));
          const signature = CryptoService.sign(contentHash, keyPair.privateKey);
          const commentNode = getGun().get('comments').get(commentId);
          commentNode.get('authorPubkey').put(keyPair.publicKey);
          commentNode.get('contentSignature').put(signature);
          commentNode.get('canonVersion').put(CURRENT_CANON_VERSION);
        } catch (_err) {
          // Non-fatal: signature update failed
        }

        // Refresh the durability backup so a republish carries the edited content.
        void saveLocalCommentBackup({
          ...(comment as Comment),
          id: commentId,
          content: newContent,
          edited: true,
          editedAt: Date.now(),
        });

        resolve();
      });
  });
}

/**
 * Delete a comment
 */
export async function deleteComment(commentId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    getGun().get('comments')
      .get(commentId)
      .once((comment: any) => {
        if (!comment || !comment.id) {
          reject(new Error('Comment not found'));
          return;
        }

        // Mark as deleted instead of actually deleting
        getGun().get('comments')
          .get(commentId)
          .get('content')
          .put('[deleted]');

        getGun().get('comments')
          .get(commentId)
          .get('deleted')
          .put(true);

        // Tombstone the local backup so the republish loop cannot resurrect
        // pre-delete content over the '[deleted]' marker.
        void removeLocalCommentBackup(commentId);

        resolve();
      });
  });
}

/**
 * Get user's vote on a comment
 */
export async function getUserVote(
  commentId: string,
  userId: string
): Promise<'up' | 'down' | null> {
  return new Promise((resolve) => {
    const voteKey = `vote_${userId}_${commentId}`;
    
    getGun().get('votes')
      .get(voteKey)
      .once((vote: any) => {
        if (vote && vote.type) {
          resolve(vote.type as 'up' | 'down');
        } else {
          resolve(null);
        }
      });
  });
}

/**
 * Get comment count for a post
 */
export async function getCommentCount(postId: string): Promise<number> {
  return new Promise((resolve) => {
    let count = 0;
    const seen = new Set<string>();

    getGun().get('posts')
      .get(postId)
      .get('comments')
      .map()
      .once((commentRef: any) => {
        if (commentRef && commentRef.ref && !seen.has(commentRef.ref)) {
          seen.add(commentRef.ref);
          count++;
        }
      });

    setTimeout(() => {
      resolve(count);
    }, 500);
  });
}

/** Verify the Schnorr signature on a comment for anti-sabotage */
export function verifyCommentSignature(comment: Comment): 'verified' | 'unverified' | 'unsigned' {
  if (!comment.authorPubkey || !comment.contentSignature) return 'unsigned';
  try {
    const contentHash = comment.canonVersion === CURRENT_CANON_VERSION
      ? CryptoService.hash(buildSignablePayload(comment))
      : CryptoService.hash(buildSignablePayloadV1(comment));
    const valid = CryptoService.verify(contentHash, comment.contentSignature, comment.authorPubkey);
    return valid ? 'verified' : 'unverified';
  } catch {
    return 'unverified';
  }
}

/** Decrypt an encrypted comment using the stored community key */
export async function decryptComment(comment: Comment): Promise<Comment> {
  if (!comment.isEncrypted || !comment.encryptedContent) return comment;

  const storedKey = await KeyVaultService.getKey(comment.communityId);
  if (!storedKey) return comment;

  try {
    const aesKey = await EncryptionService.importKey(storedKey.key);
    
    if (comment.authTag) {
      const valid = await EncryptionService.verifyAuthTag(aesKey, comment.authTag, comment.id, String(comment.createdAt), comment.authorId);
      if (!valid) {
        console.warn(`Comment ${comment.id} failed authTag verification`);
        return comment;
      }
    }

    const decrypted = JSON.parse(await EncryptionService.decrypt(comment.encryptedContent, aesKey));
    return {
      ...comment,
      content: decrypted.content || comment.content,
      authorId: decrypted.authorId || comment.authorId,
      authorName: decrypted.authorName || comment.authorName,
    };
  } catch {
    return comment;
  }
}

// ── Durability ────────────────────────────────────────────────────────────────
// Comments, like posts, are written to Gun with acks that only prove local
// acceptance. Without a backup + relay-persistence check + republish, a comment
// created during a relay outage or under rate-limiting stays only in the
// author's browser. Encrypted comments MUST be redacted before backup/republish
// (the in-memory Comment keeps plaintext; only the Gun writes redact it).

/** Redact an encrypted comment so no plaintext is stored/republished. */
function redactCommentForWire(c: Comment): Comment {
  if (!c.isEncrypted) return c;
  return { ...c, content: '🔒 Encrypted comment', authorName: 'encrypted' };
}

function toGunCommentRecord(c: Comment): Record<string, unknown> {
  const r = redactCommentForWire(c);
  const rec: Record<string, unknown> = {
    id: r.id,
    postId: r.postId,
    communityId: r.communityId,
    authorId: r.authorId,
    authorName: r.authorName,
    authorShowRealName: r.authorShowRealName || false,
    content: r.content,
    createdAt: r.createdAt,
    upvotes: r.upvotes || 0,
    downvotes: r.downvotes || 0,
    score: r.score || 0,
    edited: !!r.edited,
  };
  if (r.parentId) rec.parentId = r.parentId;
  if (r.editedAt) rec.editedAt = r.editedAt;
  if (r.authorPubkey) rec.authorPubkey = r.authorPubkey;
  if (r.contentSignature) rec.contentSignature = r.contentSignature;
  if (r.canonVersion) rec.canonVersion = r.canonVersion;
  if (r.isEncrypted) {
    rec.isEncrypted = true;
    if (r.encryptedContent) rec.encryptedContent = r.encryptedContent;
    if (r.authTag) rec.authTag = r.authTag;
  }
  return rec;
}

/** Re-put a comment's canonical node and (idempotently) its post-index entry. */
function warmCommentCache(rec: Record<string, unknown>): void {
  const id = rec.id as string;
  if (!id) return;
  getGun().get('comments').get(id).put(rec);
  const postId = rec.postId as string | undefined;
  if (postId && !commentIndexRepublished.has(id)) {
    // Deterministic key (not .set()) so repeated republishes don't duplicate the index entry.
    getGun().get('posts').get(postId).get('comments').get(id).put({ commentId: id, createdAt: rec.createdAt });
    commentIndexRepublished.add(id);
  }
}

/** Ask the relay's DB mirror whether a comment actually reached it. */
async function verifyCommentRelayPersistence(commentId: string, deadlineMs = 8000): Promise<boolean | null> {
  const soul = encodeURIComponent(`${GUN_NAMESPACE}/comments/${commentId}`);
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
      // endpoint state unknown this attempt
    } finally {
      clearTimeout(timer);
    }
    if (Date.now() + retryDelayMs > deadline) return endpointReachable ? false : null;
    await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
  }
}

function enqueueLocalCommentBackupWrite(task: () => Promise<void>): Promise<void> {
  const run = localCommentBackupWriteQueue.then(task, task);
  localCommentBackupWriteQueue = run.catch(() => {});
  return run;
}

async function readLocalCommentMap(): Promise<LocalCommentBackupMap> {
  try {
    const raw = await StorageService.getMetadata(LOCAL_COMMENTS_META_KEY);
    if (!raw || typeof raw !== 'object') return {};
    const normalized: LocalCommentBackupMap = {};
    Object.entries(raw as Record<string, any>).forEach(([id, value]) => {
      if (!value || typeof value !== 'object' || !value.comment || typeof value.comment !== 'object') return;
      const comment = value.comment as Comment;
      if (!comment?.id) return;
      normalized[id] = { comment, backedUpAt: Number(value.backedUpAt) || comment.createdAt || Date.now() };
    });
    return normalized;
  } catch {
    return {};
  }
}

async function readLocalCommentTombstones(): Promise<Record<string, number>> {
  try {
    const raw = await StorageService.getMetadata(LOCAL_COMMENTS_TOMBSTONES_META_KEY);
    if (!raw || typeof raw !== 'object') return {};
    const normalized: Record<string, number> = {};
    Object.entries(raw as Record<string, unknown>).forEach(([id, value]) => {
      const ts = Number(value);
      if (Number.isFinite(ts) && ts > 0) normalized[id] = ts;
    });
    return normalized;
  } catch {
    return {};
  }
}

function localCommentBackupSignature(c: Comment): string {
  const r = redactCommentForWire(c);
  return JSON.stringify({
    id: r.id, postId: r.postId, content: r.content,
    upvotes: r.upvotes || 0, downvotes: r.downvotes || 0, score: r.score || 0,
    edited: !!r.edited, isEncrypted: !!r.isEncrypted, encryptedContent: r.encryptedContent || '',
  });
}

async function saveLocalCommentBackup(comment: Comment): Promise<void> {
  if (!comment?.id) return;
  const stored = redactCommentForWire(comment); // never persist plaintext for encrypted comments
  const nextSignature = localCommentBackupSignature(comment);
  await enqueueLocalCommentBackupWrite(async () => {
    try {
      const [next, tombstones] = await Promise.all([readLocalCommentMap(), readLocalCommentTombstones()]);
      delete tombstones[comment.id];
      const existing = next[comment.id];
      if (existing?.comment && localCommentBackupSignature(existing.comment) === nextSignature) return;
      next[comment.id] = { comment: stored, backedUpAt: Date.now() };
      const ordered = Object.values(next).sort((a, b) => {
        const left = Number.isFinite(a.backedUpAt) ? a.backedUpAt : a.comment.createdAt;
        const right = Number.isFinite(b.backedUpAt) ? b.backedUpAt : b.comment.createdAt;
        return right - left;
      }).slice(0, 500);
      const compact: LocalCommentBackupMap = {};
      ordered.forEach((item) => { compact[item.comment.id] = item; });
      await StorageService.setMetadata(LOCAL_COMMENTS_META_KEY, compact);
      await StorageService.setMetadata(LOCAL_COMMENTS_TOMBSTONES_META_KEY, tombstones);
    } catch {
      // best-effort local backup
    }
  });
}

async function removeLocalCommentBackup(commentId: string): Promise<void> {
  await enqueueLocalCommentBackupWrite(async () => {
    try {
      const [map, tombstones] = await Promise.all([readLocalCommentMap(), readLocalCommentTombstones()]);
      if (!map[commentId] && tombstones[commentId]) return;
      delete map[commentId];
      tombstones[commentId] = Date.now();
      const recentTombstones = Object.entries(tombstones)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 1000)
        .reduce<Record<string, number>>((acc, [id, ts]) => { acc[id] = ts; return acc; }, {});
      await StorageService.setMetadata(LOCAL_COMMENTS_META_KEY, map);
      await StorageService.setMetadata(LOCAL_COMMENTS_TOMBSTONES_META_KEY, recentTombstones);
    } catch {
      // best-effort cleanup
    }
  });
}

export async function republishUnconfirmedComments(): Promise<void> {
  if (commentRepublishInFlight || typeof window === 'undefined') return;
  commentRepublishInFlight = true;
  try {
    const [map, tombstones] = await Promise.all([readLocalCommentMap(), readLocalCommentTombstones()]);
    const now = Date.now();
    const candidates = Object.values(map).filter((entry) => {
      const c = entry?.comment;
      if (!c?.id || tombstones[c.id]) return false;
      const ageMs = now - (Number.isFinite(entry.backedUpAt) ? entry.backedUpAt : c.createdAt || 0);
      if (ageMs > LOCAL_COMMENT_BACKUP_TTL_MS) return false;
      return (commentRepublishAttempts.get(c.id) || 0) < REPUBLISH_MAX_ATTEMPTS;
    });
    for (const entry of candidates) {
      const c = entry.comment;
      const confirmed = await verifyCommentRelayPersistence(c.id, 4000);
      if (confirmed === true) { commentRepublishAttempts.delete(c.id); continue; }
      if (confirmed === null) continue; // endpoint unreachable — retry next tick
      commentRepublishAttempts.set(c.id, (commentRepublishAttempts.get(c.id) || 0) + 1);
      warmCommentCache(toGunCommentRecord(c));
      await new Promise((resolve) => setTimeout(resolve, 3000));
      const recheck = await verifyCommentRelayPersistence(c.id, 8000);
      if (recheck === true) {
        commentRepublishAttempts.delete(c.id);
        console.info(`[CommentService] Republished comment ${c.id} to relay after missed sync`);
      }
    }
  } catch {
    // best-effort sweep
  } finally {
    commentRepublishInFlight = false;
  }
}

export function startCommentRepublishLoop(): void {
  if (commentRepublishLoopStarted || typeof window === 'undefined') return;
  commentRepublishLoopStarted = true;
  GunService.onReconnect(() => { void republishUnconfirmedComments(); });
  const tick = () => {
    void republishUnconfirmedComments().finally(() => { setTimeout(tick, REPUBLISH_INTERVAL_MS); });
  };
  setTimeout(tick, 20_000);
}

// Export as CommentService object for compatibility
export const CommentService = {
  createComment,
  getComment,
  subscribeToCommentsInPost,
  getAllCommentsInPost,
  getReplies,
  voteOnComment,
  editComment,
  deleteComment,
  getUserVote,
  getCommentCount,
  verifyCommentSignature,
  decryptComment,
  startCommentRepublishLoop,
  republishUnconfirmedComments,
  verifyCommentRelayPersistence,
};
