/**
 * Domain types for the social layer (comments and chat).
 *
 * These live outside the services so `StorageService` can persist them without
 * importing a service (which would close an import cycle: service → storage →
 * service). `commentService` re-exports `Comment` so existing imports keep
 * working.
 */

/**
 * How far a locally-created record has got on its way into the graph.
 *
 * - `pending`   — in IndexedDB, not yet acked by any Gun peer.
 * - `published` — a peer acked the write, but no relay has confirmed holding it.
 * - `confirmed` — the relay's DB mirror reports the soul (see `verifySoulOnRelay`).
 * - `failed`    — retries exhausted; the record is kept and shown, not discarded.
 *
 * Records authored elsewhere and merely observed arrive as `confirmed`: they
 * demonstrably exist outside this browser, which is exactly what the status means.
 */
export type SyncStatus = 'pending' | 'published' | 'confirmed' | 'failed';

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
  deleted?: boolean;
  authorPubkey?: string;
  contentSignature?: string;
  /** Canonicalization used for `contentSignature`. Absent = legacy v1. */
  canonVersion?: number;
  isEncrypted?: boolean;
  /** AES-GCM ciphertext of the comment body, for encrypted communities. */
  encryptedContent?: string;
  /** HMAC tag binding the ciphertext to (id, createdAt, authorId). */
  authTag?: string;
}

/**
 * A comment as held in IndexedDB.
 *
 * The local copy is authoritative for *display*: Gun runs with no local
 * persistence, so without this row a comment vanishes from the author's own
 * screen the moment the graph is evicted or the relay drops the write.
 */
export interface StoredComment extends Comment {
  syncStatus: SyncStatus;
  syncAttempts: number;
  lastSyncAt?: number;
  /** True for comments this device authored — only those need republishing. */
  authoredLocally: boolean;
  /** Plaintext is never stored for encrypted communities (see commentService). */
  updatedAt: number;
}

export type ChatKind = 'dm' | 'room';

/**
 * A chat message as held in IndexedDB.
 *
 * `text` is plaintext. That is deliberate: the keys needed to decrypt the
 * ciphertext (the RSA identity keypair, the room AES key) live in the *same*
 * IndexedDB, so storing ciphertext here would protect nothing while costing
 * offline history. Clearing site data removes both together.
 */
export interface StoredChatMessage {
  id: string;
  /** Sorted `a:b` pair for DMs, room id for group rooms. */
  roomId: string;
  kind: ChatKind;
  senderId: string;
  senderName?: string;
  /** DM only. */
  recipientId?: string;
  text: string;
  timestamp: number;
  /** Monotonic per-sender counter; breaks ties when clocks collide or skew. */
  seq: number;
  outgoing: boolean;
  syncStatus: SyncStatus;
  syncAttempts: number;
  readAt?: number;
  /** Set when the message could not be encrypted/sent, so the UI can offer a retry. */
  error?: string;
}
