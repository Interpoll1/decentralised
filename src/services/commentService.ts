/**
 * Comments — local-first, relay-verified.
 *
 * The previous implementation treated Gun as the source of truth. It is not:
 * `GunService.initialize()` runs with `localStorage:false` and `radisk:false`,
 * so Gun keeps comments in a volatile in-memory graph that the memory watchdog
 * evicts under pressure, and a `.put()` whose ack came from that same in-memory
 * graph proves nothing about whether the write ever left the browser. Reads
 * guessed at completion with fixed `setTimeout`s and returned whatever had
 * arrived. Between those, a comment could be posted, displayed, and then simply
 * not exist — the "comments don't persist and are super random" behaviour.
 *
 * The model here:
 *
 *   1. Every comment is written to IndexedDB first and rendered from there.
 *      That copy survives reloads, relay outages and graph eviction.
 *   2. Publishing to Gun is a background job with a durable outbox. It waits for
 *      a real ack, then asks the *relay* whether it holds the soul
 *      (`verifySoulOnRelay`) — a local re-read cannot answer that question.
 *   3. Unconfirmed comments are retried for a week, on a timer and on every Gun
 *      reconnect, and the attempt count survives reload because it lives in the
 *      same IndexedDB row.
 *   4. Reads settle on quiet rather than on a stopwatch, and merge Gun's answer
 *      into the local mirror instead of replacing it.
 *
 * Votes are per-user nodes (`commentVotes/<commentId>/<userId>`) tallied by
 * counting, not a read-modify-write counter on the comment. Concurrent voters
 * used to overwrite each other's totals, which is what made scores jump around.
 * The aggregate is still mirrored onto the comment node, but only as a hint for
 * readers who have not loaded the vote set.
 */

import { GunService, GUN_NAMESPACE } from './gunService';
import { CryptoService } from './cryptoService';
import { KeyService } from './keyService';
import { AuditService } from './auditService';
import { PostService } from './postService';
import { EncryptionService } from './encryptionService';
import { KeyVaultService } from './keyVaultService';
import { StorageService } from './storageService';
import { gunPut, gunOnce, gunReadChildren, verifySoulOnRelay, toGunRecord } from '../utils/gunAsync';
import { foldVotes } from './postVoteService';
import { canonicalJSON } from '../../shared-validation/canonical.js';
import type { Comment, StoredComment, SyncStatus } from '../types/social';

export type { Comment, StoredComment, SyncStatus } from '../types/social';

const CURRENT_CANON_VERSION = 2;

/** How long a locally-authored comment keeps trying to reach a relay. */
const OUTBOX_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_PUBLISH_ATTEMPTS = 12;
const REPUBLISH_INTERVAL_MS = 90_000;
/** Concurrent Gun node reads while hydrating a thread. */
const FETCH_CONCURRENCY = 8;

export interface CommentTally {
  upvotes: number;
  downvotes: number;
  score: number;
}

export interface CommentVoteResult {
  tally: CommentTally;
  /** What this user's vote *actually* is now, per the graph — not what the UI guessed. */
  myVote: 'up' | 'down' | null;
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

// ── Gun paths ─────────────────────────────────────────────────────────────────

function gun() {
  return GunService.getGun();
}

function commentNode(commentId: string) {
  return gun().get('comments').get(commentId);
}

/**
 * Per-post comment index. Entries are written at a *deterministic* key (the
 * comment id) so republishing is idempotent. The old code used `.set()`, which
 * mints a fresh random soul each time and left duplicate index entries pointing
 * at the same comment; reads still normalize those legacy rows.
 */
function commentIndexNode(postId: string) {
  return gun().get('posts').get(postId).get('comments');
}

function commentVotesNode(commentId: string) {
  return gun().get('commentVotes').get(commentId);
}

function commentSoul(commentId: string): string {
  return `${GUN_NAMESPACE}/comments/${commentId}`;
}

// ── Signing ───────────────────────────────────────────────────────────────────

type SignablePayload = Pick<Comment, 'content' | 'postId' | 'communityId' | 'createdAt'>;

/** @deprecated Verification only — for comments signed before `canonicalJSON`. */
function buildSignablePayloadV1(c: SignablePayload): string {
  return JSON.stringify({
    content: c.content,
    postId: c.postId,
    communityId: c.communityId,
    timestamp: c.createdAt,
  });
}

function buildSignablePayload(c: SignablePayload): string {
  return canonicalJSON({
    content: c.content,
    postId: c.postId,
    communityId: c.communityId,
    timestamp: c.createdAt,
  });
}

async function signComment(comment: Comment): Promise<void> {
  try {
    const keyPair = await KeyService.getKeyPair();
    const contentHash = CryptoService.hash(buildSignablePayload(comment));
    comment.contentSignature = CryptoService.sign(contentHash, keyPair.privateKey);
    comment.authorPubkey = keyPair.publicKey;
    comment.canonVersion = CURRENT_CANON_VERSION;
  } catch (err) {
    // A comment without a signature is still a valid comment — it just shows as
    // unsigned in the UI. Never block posting on the key store.
    console.warn('[CommentService] Failed to sign comment:', err);
  }
}

export function verifyCommentSignature(comment: Comment): 'verified' | 'unverified' | 'unsigned' {
  if (!comment.authorPubkey || !comment.contentSignature) return 'unsigned';
  try {
    const contentHash = comment.canonVersion === CURRENT_CANON_VERSION
      ? CryptoService.hash(buildSignablePayload(comment))
      : CryptoService.hash(buildSignablePayloadV1(comment));
    return CryptoService.verify(contentHash, comment.contentSignature, comment.authorPubkey)
      ? 'verified'
      : 'unverified';
  } catch {
    return 'unverified';
  }
}

// ── Encryption (private communities) ──────────────────────────────────────────

const ENCRYPTED_PLACEHOLDER = '🔒 Encrypted comment';

/** Encrypt in place when the community has a stored key. No key = public community. */
async function encryptForCommunity(comment: Comment): Promise<void> {
  if (!comment.communityId) return;
  const storedKey = await KeyVaultService.getKey(comment.communityId);
  if (!storedKey) return;

  const aesKey = await EncryptionService.importKey(storedKey.key);
  const payload = JSON.stringify({
    content: comment.content,
    authorId: comment.authorId,
    authorName: comment.authorName,
  });
  comment.encryptedContent = await EncryptionService.encrypt(payload, aesKey);
  comment.authTag = await EncryptionService.generateAuthTag(
    aesKey,
    comment.id,
    String(comment.createdAt),
    comment.authorId,
  );
  comment.isEncrypted = true;
}

export async function decryptComment(comment: Comment): Promise<Comment> {
  if (!comment.isEncrypted || !comment.encryptedContent) return comment;

  const storedKey = await KeyVaultService.getKey(comment.communityId);
  if (!storedKey) return comment;

  try {
    const aesKey = await EncryptionService.importKey(storedKey.key);
    if (comment.authTag) {
      const valid = await EncryptionService.verifyAuthTag(
        aesKey,
        comment.authTag,
        comment.id,
        String(comment.createdAt),
        comment.authorId,
      );
      if (!valid) {
        console.warn(`[CommentService] Comment ${comment.id} failed authTag verification`);
        return comment;
      }
    }
    const decrypted = JSON.parse(await EncryptionService.decrypt(comment.encryptedContent, aesKey));
    return {
      ...comment,
      content: decrypted.content ?? comment.content,
      authorId: decrypted.authorId ?? comment.authorId,
      authorName: decrypted.authorName ?? comment.authorName,
    };
  } catch {
    return comment;
  }
}

/**
 * The form a comment takes on the wire and in the local mirror. For encrypted
 * communities the plaintext never leaves memory — not into Gun, not into
 * IndexedDB — matching the guarantee that losing the community key makes the
 * content unreadable.
 */
function redactForStorage(comment: Comment): Comment {
  if (!comment.isEncrypted) return comment;
  return { ...comment, content: ENCRYPTED_PLACEHOLDER, authorName: 'encrypted' };
}

// ── Record conversion ─────────────────────────────────────────────────────────

function toGunComment(comment: Comment): Record<string, string | number | boolean> {
  const c = redactForStorage(comment);
  return toGunRecord({
    id: c.id,
    postId: c.postId,
    communityId: c.communityId,
    authorId: c.authorId,
    authorName: c.authorName,
    authorShowRealName: c.authorShowRealName ?? false,
    content: c.content,
    parentId: c.parentId,
    createdAt: c.createdAt,
    upvotes: c.upvotes ?? 0,
    downvotes: c.downvotes ?? 0,
    score: c.score ?? 0,
    edited: !!c.edited,
    editedAt: c.editedAt,
    deleted: c.deleted ? true : undefined,
    authorPubkey: c.authorPubkey,
    contentSignature: c.contentSignature,
    canonVersion: c.canonVersion,
    isEncrypted: c.isEncrypted ? true : undefined,
    encryptedContent: c.encryptedContent,
    authTag: c.authTag,
  });
}

/** Normalize a raw Gun node into a Comment, or null if it isn't one. */
function fromGunComment(raw: any, fallbackPostId?: string): Comment | null {
  if (!raw || typeof raw !== 'object') return null;
  const id = typeof raw.id === 'string' ? raw.id : null;
  if (!id) return null;

  const postId = typeof raw.postId === 'string' && raw.postId ? raw.postId : fallbackPostId;
  if (!postId) return null;

  // Gun round-trips absent optional fields as the string 'null'/'undefined' in
  // some legacy rows; treat those as absent rather than as a parent id, or the
  // comment threads itself under a phantom parent and disappears from the list.
  const parentId = typeof raw.parentId === 'string'
    && raw.parentId !== ''
    && raw.parentId !== 'null'
    && raw.parentId !== 'undefined'
    ? raw.parentId
    : undefined;

  const upvotes = Number(raw.upvotes) || 0;
  const downvotes = Number(raw.downvotes) || 0;

  return {
    id,
    postId,
    communityId: typeof raw.communityId === 'string' ? raw.communityId : '',
    authorId: typeof raw.authorId === 'string' ? raw.authorId : '',
    authorName: typeof raw.authorName === 'string' ? raw.authorName : 'anon',
    authorShowRealName: raw.authorShowRealName === true,
    content: typeof raw.content === 'string' ? raw.content : '',
    parentId,
    createdAt: Number(raw.createdAt) || 0,
    upvotes,
    downvotes,
    score: Number.isFinite(Number(raw.score)) ? Number(raw.score) : upvotes - downvotes,
    edited: raw.edited === true,
    editedAt: Number(raw.editedAt) || undefined,
    deleted: raw.deleted === true,
    authorPubkey: typeof raw.authorPubkey === 'string' ? raw.authorPubkey : undefined,
    contentSignature: typeof raw.contentSignature === 'string' ? raw.contentSignature : undefined,
    canonVersion: Number(raw.canonVersion) || undefined,
    isEncrypted: raw.isEncrypted === true,
    encryptedContent: typeof raw.encryptedContent === 'string' ? raw.encryptedContent : undefined,
    authTag: typeof raw.authTag === 'string' ? raw.authTag : undefined,
  };
}

// ── Local mirror ──────────────────────────────────────────────────────────────

function toStored(comment: Comment, patch: Partial<StoredComment> = {}): StoredComment {
  return {
    ...redactForStorage(comment),
    syncStatus: patch.syncStatus ?? 'pending',
    syncAttempts: patch.syncAttempts ?? 0,
    lastSyncAt: patch.lastSyncAt,
    authoredLocally: patch.authoredLocally ?? false,
    updatedAt: patch.updatedAt ?? Date.now(),
  };
}

/** Which of two versions of the same comment is newer. */
function revisionOf(comment: Comment): number {
  return comment.editedAt || comment.createdAt || 0;
}

/**
 * Fold observed comments into the local mirror.
 *
 * A remote copy never overwrites a locally-authored row that has not been
 * confirmed yet: the relay's version of such a comment is at best a partial
 * echo, and letting it win is how an in-flight comment used to lose its body.
 */
async function mergeIntoMirror(incoming: Comment[], authoredLocally = false): Promise<void> {
  if (incoming.length === 0) return;

  const rows: StoredComment[] = [];
  for (const comment of incoming) {
    const existing = await StorageService.getComment(comment.id);

    if (existing) {
      const localWins = existing.authoredLocally
        && existing.syncStatus !== 'confirmed'
        && revisionOf(existing) >= revisionOf(comment);
      if (localWins) continue;
      // Never let an emptier record replace a fuller one.
      if (!comment.content && existing.content) continue;

      rows.push(toStored(comment, {
        syncStatus: authoredLocally ? existing.syncStatus : 'confirmed',
        syncAttempts: existing.syncAttempts,
        lastSyncAt: existing.lastSyncAt,
        authoredLocally: existing.authoredLocally || authoredLocally,
      }));
      continue;
    }

    rows.push(toStored(comment, {
      // Observed from the graph means it demonstrably exists outside this browser.
      syncStatus: authoredLocally ? 'pending' : 'confirmed',
      authoredLocally,
    }));
  }

  await StorageService.saveComments(rows);
}

async function patchMirror(commentId: string, patch: Partial<StoredComment>): Promise<void> {
  const existing = await StorageService.getComment(commentId);
  if (!existing) return;
  await StorageService.saveComment({ ...existing, ...patch, updatedAt: Date.now() });
}

// ── Publishing ────────────────────────────────────────────────────────────────

/**
 * Push one comment into the graph and find out whether it stuck.
 *
 * Both writes matter: the canonical node is the content, the index entry is how
 * anyone finds it. A comment whose index entry was dropped is invisible even
 * though the node exists — which is exactly how comments "randomly" failed to
 * show up for other people.
 */
async function publishComment(comment: Comment): Promise<SyncStatus> {
  const record = toGunComment(comment);

  const [nodeAck, indexAck] = await Promise.all([
    gunPut(commentNode(comment.id), record),
    gunPut(
      commentIndexNode(comment.postId).get(comment.id),
      toGunRecord({
        commentId: comment.id,
        createdAt: comment.createdAt,
        parentId: comment.parentId,
      }),
    ),
  ]);

  if (!nodeAck.ok && !indexAck.ok) return 'pending';

  const confirmed = await verifySoulOnRelay(commentSoul(comment.id), 6_000);
  if (confirmed === true) return 'confirmed';
  // `false` (relay says no) and `null` (no reachable /db/soul endpoint) both mean
  // "keep trying" — but a peer-acked write is further along than an unsent one.
  return 'published';
}

let republishLoopStarted = false;
let republishInFlight = false;

/**
 * Re-push every locally-authored comment no relay has confirmed.
 *
 * Gun does not retro-sync writes made while a peer was unreachable, so without
 * this a comment written during an outage stays in this browser forever. State
 * lives in IndexedDB, so a reload mid-outage does not reset progress — the old
 * in-memory attempt counters plus a 30-minute TTL meant a comment written during
 * a longer outage was abandoned before the relay ever came back.
 */
export async function republishUnconfirmedComments(): Promise<void> {
  if (republishInFlight || typeof window === 'undefined') return;
  republishInFlight = true;
  try {
    const all = await StorageService.getAllComments();
    const now = Date.now();
    const pending = all.filter((c) =>
      c.authoredLocally
      && c.syncStatus !== 'confirmed'
      && c.syncAttempts < MAX_PUBLISH_ATTEMPTS
      && now - (c.createdAt || 0) < OUTBOX_TTL_MS);

    for (const stored of pending) {
      const status = await publishComment(stored);
      const attempts = stored.syncAttempts + 1;
      await patchMirror(stored.id, {
        syncStatus: status === 'confirmed'
          ? 'confirmed'
          : attempts >= MAX_PUBLISH_ATTEMPTS ? 'failed' : status,
        syncAttempts: attempts,
        lastSyncAt: Date.now(),
      });
      if (status === 'confirmed') {
        console.info(`[CommentService] Comment ${stored.id} confirmed on relay after ${attempts} attempt(s)`);
      }
    }
  } catch (err) {
    console.warn('[CommentService] Republish sweep failed:', err);
  } finally {
    republishInFlight = false;
  }
}

export function startCommentRepublishLoop(): void {
  if (republishLoopStarted || typeof window === 'undefined') return;
  republishLoopStarted = true;

  GunService.onReconnect(() => { void republishUnconfirmedComments(); });
  window.addEventListener('online', () => { void republishUnconfirmedComments(); });

  const tick = () => {
    void republishUnconfirmedComments().finally(() => setTimeout(tick, REPUBLISH_INTERVAL_MS));
  };
  setTimeout(tick, 8_000);
}

// ── Create / edit / delete ────────────────────────────────────────────────────

export async function createComment(data: CreateCommentData): Promise<Comment> {
  if (!data.postId) throw new Error('postId is required');
  if (!data.content?.trim()) throw new Error('content is required');

  const createdAt = Date.now();
  const comment: Comment = {
    id: `comment_${createdAt}_${Math.random().toString(36).slice(2, 11)}`,
    postId: data.postId,
    communityId: data.communityId,
    authorId: data.authorId,
    authorName: data.authorName,
    authorShowRealName: data.authorShowRealName ?? false,
    content: data.content.trim(),
    parentId: data.parentId || undefined,
    createdAt,
    upvotes: 0,
    downvotes: 0,
    score: 0,
    edited: false,
  };

  await signComment(comment);
  await encryptForCommunity(comment);

  // Durable first. Everything after this point can fail without losing the comment.
  await StorageService.saveComment(toStored(comment, { syncStatus: 'pending', authoredLocally: true }));

  // Publish in the background: the comment is already safe, and blocking the UI
  // on a relay round-trip is what made posting feel broken on a slow network.
  void (async () => {
    try {
      const status = await publishComment(comment);
      await patchMirror(comment.id, { syncStatus: status, syncAttempts: 1, lastSyncAt: Date.now() });
    } catch (err) {
      console.warn('[CommentService] Initial publish failed, queued for retry:', err);
    }
    startCommentRepublishLoop();
  })();

  // Best-effort side effects — never allowed to fail the comment.
  void (async () => {
    try {
      const contentHash = CryptoService.hash(JSON.stringify({
        id: comment.id,
        postId: comment.postId,
        communityId: comment.communityId,
        authorId: comment.authorId,
        createdAt: comment.createdAt,
        content: comment.content,
      }));
      await AuditService.logReceipt('comment', {
        commentId: comment.id,
        postId: comment.postId,
        communityId: comment.communityId,
        authorId: comment.authorId,
        createdAt: comment.createdAt,
        contentHash,
      });
    } catch { /* audit is advisory */ }
  })();

  // Mirror the *derived* count onto the post rather than incrementing the stored
  // one: the local mirror already holds this comment, so `getCommentCount` sees
  // it, and a derived write cannot be lost the way read-add-one-write is when
  // two people comment inside one round trip.
  void (async () => {
    try {
      const count = await getCommentCount(data.postId);
      await PostService.setCommentCount(data.postId, count, data.communityId);
    } catch { /* counter is a hint */ }
  })();

  return comment;
}

export async function editComment(commentId: string, newContent: string): Promise<Comment | null> {
  const existing = await getComment(commentId);
  if (!existing) return null;

  const edited: Comment = {
    ...existing,
    content: newContent,
    edited: true,
    editedAt: Date.now(),
  };
  await signComment(edited);
  if (existing.isEncrypted) {
    edited.isEncrypted = false;
    edited.encryptedContent = undefined;
    edited.authTag = undefined;
    await encryptForCommunity(edited);
  }

  const stored = await StorageService.getComment(commentId);
  await StorageService.saveComment(toStored(edited, {
    syncStatus: 'pending',
    syncAttempts: 0,
    authoredLocally: stored?.authoredLocally ?? true,
  }));

  const status = await publishComment(edited);
  await patchMirror(commentId, { syncStatus: status, syncAttempts: 1, lastSyncAt: Date.now() });
  return edited;
}

export async function deleteComment(commentId: string): Promise<void> {
  const existing = await getComment(commentId);
  if (!existing) return;

  // Tombstone rather than remove: a Gun delete does not propagate reliably, and
  // peers that still hold the node would resurrect the original text.
  const tombstoned: Comment = {
    ...existing,
    content: '[deleted]',
    deleted: true,
    edited: true,
    editedAt: Date.now(),
    encryptedContent: undefined,
    authTag: undefined,
    isEncrypted: false,
  };

  await StorageService.saveComment(toStored(tombstoned, {
    syncStatus: 'pending',
    syncAttempts: 0,
    authoredLocally: true,
  }));

  const status = await publishComment(tombstoned);
  await patchMirror(commentId, { syncStatus: status, syncAttempts: 1, lastSyncAt: Date.now() });
}

// ── Reads ─────────────────────────────────────────────────────────────────────

/** Comments already on this device. Resolves immediately — no network. */
export async function getLocalComments(postId: string): Promise<Comment[]> {
  const rows = await StorageService.getCommentsByPost(postId);
  return Promise.all(rows.map((row) => decryptComment(row)));
}

export async function getComment(commentId: string): Promise<Comment | null> {
  const local = await StorageService.getComment(commentId);
  if (local) return decryptComment(local);

  const raw = await gunOnce(commentNode(commentId));
  const comment = fromGunComment(raw);
  if (!comment) return null;
  await mergeIntoMirror([comment]);
  return decryptComment(comment);
}

/**
 * Comment ids listed in a post's index.
 *
 * Handles both entry shapes: the deterministic `<commentId>` keys written now,
 * and the random-soul `.set()` entries the old implementation produced.
 */
async function readCommentIndex(postId: string): Promise<string[]> {
  const children = await gunReadChildren<any>(commentIndexNode(postId), { minMs: 600, maxMs: 8_000 });
  const ids = new Set<string>();
  for (const { key, value } of children) {
    const fromValue = value && typeof value === 'object'
      ? (typeof value.commentId === 'string' ? value.commentId
        : typeof value.id === 'string' ? value.id : null)
      : null;
    const id = fromValue ?? (key.startsWith('comment_') ? key : null);
    if (id) ids.add(id);
  }
  return [...ids];
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

/** Pull a post's comments from the graph and fold them into the local mirror. */
export async function fetchCommentsFromGun(postId: string): Promise<Comment[]> {
  const ids = await readCommentIndex(postId);
  if (ids.length === 0) return [];

  const fetched = await mapWithConcurrency(ids, FETCH_CONCURRENCY, async (id) => {
    const raw = await gunOnce(commentNode(id), 6_000);
    return fromGunComment(raw, postId);
  });

  const comments = fetched.filter((c): c is Comment => c !== null);
  await mergeIntoMirror(comments);
  return Promise.all(comments.map((c) => decryptComment(c)));
}

/**
 * Everything known about a post's comments: the local mirror first, then the
 * graph merged on top. Callers get a single settled list — no fixed timeout, no
 * partial answer presented as complete.
 */
export async function getAllCommentsInPost(postId: string): Promise<Comment[]> {
  const [local, remote] = await Promise.all([
    getLocalComments(postId),
    fetchCommentsFromGun(postId).catch(() => [] as Comment[]),
  ]);

  const byId = new Map<string, Comment>();
  for (const comment of local) byId.set(comment.id, comment);
  for (const comment of remote) {
    const existing = byId.get(comment.id);
    if (!existing || revisionOf(comment) > revisionOf(existing)) byId.set(comment.id, comment);
  }
  return [...byId.values()].sort((a, b) => a.createdAt - b.createdAt);
}

/**
 * Live comment feed for a post.
 *
 * Emits every comment as it arrives *and* whenever an existing one changes, so
 * edits, deletions and vote totals land without a refetch. The previous version
 * used `.once()` per comment, which meant a comment's own updates never
 * appeared. Re-attaches after `GunService.reconnect()` rebuilds the instance —
 * otherwise the subscription silently binds to a discarded Gun and goes quiet.
 */
export function subscribeToCommentsInPost(
  postId: string,
  callback: (comment: Comment) => void,
): () => void {
  let active = true;
  let indexChain: any = null;
  const nodeChains = new Map<string, any>();

  const watchComment = (commentId: string) => {
    if (!active || nodeChains.has(commentId)) return;
    const chain = commentNode(commentId).on((raw: any) => {
      if (!active) return;
      const comment = fromGunComment(raw, postId);
      if (!comment) return;
      void (async () => {
        await mergeIntoMirror([comment]);
        if (!active) return;
        callback(await decryptComment(comment));
      })();
    });
    nodeChains.set(commentId, chain);
  };

  const attach = () => {
    if (!active) return;
    indexChain = commentIndexNode(postId).map().on((value: any, key: string) => {
      if (!active) return;
      const id = value && typeof value === 'object'
        ? (typeof value.commentId === 'string' ? value.commentId
          : typeof value.id === 'string' ? value.id : null)
        : null;
      const commentId = id ?? (typeof key === 'string' && key.startsWith('comment_') ? key : null);
      if (commentId) watchComment(commentId);
    });
  };

  const detach = () => {
    try { indexChain?.off?.(); } catch { /* already detached */ }
    indexChain = null;
    for (const chain of nodeChains.values()) {
      try { chain?.off?.(); } catch { /* already detached */ }
    }
    nodeChains.clear();
  };

  attach();

  const offReconnect = GunService.onReconnect(() => {
    if (!active) return;
    detach();
    attach();
  });

  return () => {
    active = false;
    offReconnect();
    detach();
  };
}

export async function getCommentCount(postId: string): Promise<number> {
  const [ids, local] = await Promise.all([
    readCommentIndex(postId),
    StorageService.getCommentsByPost(postId),
  ]);
  const all = new Set(ids);
  for (const row of local) all.add(row.id);
  return all.size;
}

// ── Votes ─────────────────────────────────────────────────────────────────────

type VoteValue = 'up' | 'down' | 'none';

function parseVote(raw: any): VoteValue | null {
  if (!raw || typeof raw !== 'object') return null;
  const type = raw.type;
  return type === 'up' || type === 'down' || type === 'none' ? type : null;
}

/**
 * This device's record of a vote cast under the pre-migration scheme.
 *
 * Comment votes had no per-user graph node before this — the totals were
 * read-modify-written onto the comment and the only record of *who* voted was
 * the local `upvoted-comments` / `downvoted-comments` sets. Those votes are
 * inside the frozen baseline, so the one device that can identify them must, or
 * migrating such a vote counts it twice.
 */
function readLegacyCommentVote(commentId: string): 'up' | 'down' | null {
  if (typeof localStorage === 'undefined') return null;
  for (const [key, vote] of [['upvoted-comments', 'up'], ['downvoted-comments', 'down']] as const) {
    try {
      const parsed = JSON.parse(localStorage.getItem(key) || '[]');
      if (Array.isArray(parsed) && parsed.includes(commentId)) return vote;
    } catch { /* unreadable cache — no correction to make */ }
  }
  return null;
}

function parseBaselineType(raw: any): 'up' | 'down' | null {
  const type = raw && typeof raw === 'object' ? raw.baselineType : null;
  return type === 'up' || type === 'down' ? type : null;
}

/**
 * The comment's frozen legacy vote counters.
 *
 * Comments that predate the per-user vote scheme carry totals no vote node
 * accounts for. The old code fell back to those counters *only while no vote
 * node existed at all*, so the very first vote cast under the new scheme threw
 * the entire previous total away — a comment sitting at 12 dropped to 1 the
 * moment anyone touched it. Freezing the counters once, behind the
 * `voteBaselineAt` guard, keeps them and adds derived votes on top; because the
 * baseline is written once and never mutated it reintroduces no
 * read-modify-write race. Same rule as posts — see `postVoteService`.
 */
async function readCommentBaseline(
  commentId: string,
  fallback?: Comment,
): Promise<{ up: number; down: number }> {
  const node: any = await gunOnce(commentNode(commentId), 3_000);
  if (node?.voteBaselineAt) {
    return { up: Number(node.voteBaselineUp) || 0, down: Number(node.voteBaselineDown) || 0 };
  }
  const source = node ?? fallback;
  return { up: Number(source?.upvotes) || 0, down: Number(source?.downvotes) || 0 };
}

async function ensureCommentBaseline(
  commentId: string,
  fallback?: Comment,
): Promise<{ up: number; down: number }> {
  const node: any = await gunOnce(commentNode(commentId), 3_000);
  if (node?.voteBaselineAt) {
    return { up: Number(node.voteBaselineUp) || 0, down: Number(node.voteBaselineDown) || 0 };
  }
  const source = node ?? fallback;
  const baseline = { up: Number(source?.upvotes) || 0, down: Number(source?.downvotes) || 0 };
  await gunPut(commentNode(commentId), {
    voteBaselineUp: baseline.up,
    voteBaselineDown: baseline.down,
    voteBaselineAt: Date.now(),
  });
  return baseline;
}

/**
 * Count the per-user vote nodes on top of the comment's frozen baseline.
 *
 * `fallback` supplies the pre-migration counters for a comment whose graph node
 * has not loaded yet (typically the local mirror's copy).
 */
export async function getCommentTally(commentId: string, fallback?: Comment): Promise<CommentTally> {
  const { tally } = await getCommentVoteState(commentId, '', fallback);
  return tally;
}

/**
 * The tally *and* this user's own vote, from a single pass over the vote set.
 *
 * The store used to seed button state from localStorage alone and never correct
 * it, so a vote cast on another device rendered as un-voted and the next click
 * silently removed it. Reading both from one `map()` costs no more than reading
 * the tally did — pass an empty `userId` when only the tally is wanted.
 */
export async function getCommentVoteState(
  commentId: string,
  userId: string,
  fallback?: Comment,
): Promise<CommentVoteResult> {
  const [baseline, children] = await Promise.all([
    readCommentBaseline(commentId, fallback),
    gunReadChildren<any>(commentVotesNode(commentId), { minMs: 300, maxMs: 4_000 }),
  ]);
  const tally = foldVotes(
    baseline,
    children.map(({ value }) => ({ vote: parseVote(value), baselineType: parseBaselineType(value) })),
  );
  const mine = userId ? children.find(({ key }) => key === userId) : undefined;
  const vote = mine ? parseVote(mine.value) : null;
  return { tally, myVote: vote === 'up' || vote === 'down' ? vote : null };
}

export async function getUserVote(commentId: string, userId: string): Promise<'up' | 'down' | null> {
  const raw = await gunOnce(commentVotesNode(commentId).get(userId), 3_000);
  const vote = parseVote(raw);
  return vote === 'up' || vote === 'down' ? vote : null;
}

/**
 * Record this user's vote and return the recomputed tally.
 *
 * The vote is a node keyed by user id, so two people voting at once cannot
 * clobber each other — the old code read the totals, added one, and wrote them
 * back, so simultaneous votes silently cancelled and scores appeared to drift.
 * Re-voting the same way clears the vote (a toggle), stored as an explicit
 * `'none'` rather than a Gun delete, because deletes do not propagate reliably.
 */
export async function voteOnComment(
  commentId: string,
  voteType: 'up' | 'down',
  userId: string,
): Promise<CommentVoteResult> {
  if (!userId) throw new Error('userId is required to vote');

  const local = await StorageService.getComment(commentId);
  const baseline = await ensureCommentBaseline(commentId, local ?? undefined);

  const existing = await gunOnce<any>(commentVotesNode(commentId).get(userId), 3_000);
  const current = parseVote(existing);
  const currentVote = current === 'up' || current === 'down' ? current : null;
  const next: VoteValue = currentVote === voteType ? 'none' : voteType;

  // Preserve any baseline correction already recorded for this user. Their
  // pre-migration vote is inside the frozen baseline, so it must be subtracted
  // once when their new vote is applied — otherwise migrating a vote counts it
  // twice.
  const baselineType = current
    ? parseBaselineType(existing)
    : readLegacyCommentVote(commentId);

  const record: Record<string, string | number> = {
    type: next,
    userId,
    commentId,
    at: Date.now(),
  };
  if (baselineType) record.baselineType = baselineType;

  const ack = await gunPut(commentVotesNode(commentId).get(userId), record);
  // 'timeout' means Gun accepted the write locally but no relay acked within the
  // window; it syncs on reconnect. Throwing on that rolled the vote back out of
  // the UI even though it had landed — only a real error is a failure.
  if (!ack.ok && ack.err !== 'timeout') throw new Error(ack.err || 'Vote could not be recorded');

  const children = await gunReadChildren<any>(commentVotesNode(commentId), { minMs: 300, maxMs: 4_000 });
  const folded = new Map<string, any>(children.map(({ key, value }) => [key, value]));
  // Our own write may not have echoed back yet — count it from what we sent.
  folded.set(userId, record);
  const tally = foldVotes(
    baseline,
    [...folded.values()].map((value) => ({ vote: parseVote(value), baselineType: parseBaselineType(value) })),
  );

  // Mirror the aggregate onto the comment as a hint for readers who have not
  // loaded the vote set. Advisory only — `getCommentTally` always prefers the set.
  void gunPut(commentNode(commentId), {
    upvotes: tally.upvotes,
    downvotes: tally.downvotes,
    score: tally.score,
  }).catch(() => { /* hint only */ });

  if (local) {
    await StorageService.saveComment({ ...local, ...tally, updatedAt: Date.now() });
  }

  return { tally, myVote: next === 'none' ? null : next };
}

/** Live tally updates for one comment. */
export function subscribeToCommentVotes(
  commentId: string,
  callback: (tally: CommentTally) => void,
): () => void {
  let active = true;
  // Read once up front. The baseline is immutable by construction, so a later
  // echo of the comment node carrying stale counters cannot move the total.
  let baseline = { up: 0, down: 0 };
  const votes = new Map<string, { vote: VoteValue | null; baselineType: 'up' | 'down' | null }>();

  const emit = () => {
    if (!active) return;
    callback(foldVotes(baseline, votes.values()));
  };

  void readCommentBaseline(commentId).then((value) => {
    if (!active) return;
    baseline = value;
    emit();
  });

  const chain = commentVotesNode(commentId).map().on((value: any, key: string) => {
    if (!active || typeof key !== 'string') return;
    votes.set(key, { vote: parseVote(value), baselineType: parseBaselineType(value) });
    emit();
  });

  return () => {
    active = false;
    try { chain?.off?.(); } catch { /* already detached */ }
  };
}

// ── Replies ───────────────────────────────────────────────────────────────────

/**
 * Direct replies to a comment, from the loaded thread.
 *
 * The old implementation ran `.map()` over the *entire* `comments` root and
 * filtered client-side — every reply lookup pulled every comment in the network
 * into memory. A post's replies are a subset of its own thread.
 */
export async function getReplies(parentCommentId: string, postId: string): Promise<Comment[]> {
  const comments = await getAllCommentsInPost(postId);
  return comments
    .filter((c) => c.parentId === parentCommentId)
    .sort((a, b) => b.score - a.score || a.createdAt - b.createdAt);
}

export const CommentService = {
  createComment,
  editComment,
  deleteComment,
  getComment,
  getLocalComments,
  getAllCommentsInPost,
  fetchCommentsFromGun,
  subscribeToCommentsInPost,
  getCommentCount,
  getReplies,
  voteOnComment,
  getUserVote,
  getCommentTally,
  getCommentVoteState,
  subscribeToCommentVotes,
  verifyCommentSignature,
  decryptComment,
  startCommentRepublishLoop,
  republishUnconfirmedComments,
};
