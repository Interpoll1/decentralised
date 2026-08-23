import { DBSchema, IDBPDatabase } from 'idb';
import platformDB from '@platform/db';
import { ChainBlock, Receipt, Vote, ChainPollSnapshot } from '../types/chain';
import type { StoredEncryptionKey } from '../types/encryption';
import type { StoredComment, StoredChatMessage } from '../types/social';

interface VotingChainDB extends DBSchema {
  blocks: {
    key: number;
    value: ChainBlock;
    indexes: { 'by-hash': string };
  };
  votes: {
    key: string;
    value: Vote;
    indexes: { 'by-poll': string };
  };
  receipts: {
    key: string;
    value: Receipt;
    indexes: { 'by-block': number };
  };
  polls: {
    key: string;
    value: ChainPollSnapshot;
  };
  metadata: {
    key: string;
    value: any;
  };
  'encryption-keys': {
    key: string;
    value: StoredEncryptionKey;
  };
  comments: {
    key: string;
    value: StoredComment;
    indexes: { 'by-post': string };
  };
  'chat-messages': {
    key: string;
    value: StoredChatMessage;
    indexes: { 'by-room': string };
  };
  'vote-index': {
    // Compound key: [pollId, deviceId] — one entry per (poll, device) pair.
    // This makes duplicate-vote checks O(1) instead of O(n chain blocks).
    key: [string, string];
    value: { pollId: string; deviceId: string; timestamp: number };
  };
}

export class StorageService {
  private static dbPromise: Promise<IDBPDatabase>;

  /**
   * True when the active store is a volatile fallback (no persistence).
   *
   * Now derived from the platform backend rather than tracked here: on web it
   * flips when IndexedDB is missing/blocked/hung, and on desktop it stays false
   * because SQLite has no equivalent failure mode.
   */
  static get usingMemoryFallback(): boolean {
    return platformDB.ephemeral;
  }

  static async getDB(): Promise<IDBPDatabase> {
    if (!this.dbPromise) {
      // Which durable store this resolves to is the platform's business:
      // IndexedDB in the browser, SQLite in the desktop shell. Everything below
      // this line talks to the same `idb`-shaped handle either way.
      this.dbPromise = platformDB.open();
    }
    return this.dbPromise;
  }

  // Block operations
  static async saveBlock(block: ChainBlock): Promise {
    const db = await this.getDB();
    await db.put('blocks', block);
  }

  static async getBlock(index: number): Promise {
    const db = await this.getDB();
    return db.get('blocks', index);
  }

  static async getLatestBlock(): Promise {
    const db = await this.getDB();
    const tx = db.transaction('blocks', 'readonly');
    const store = tx.objectStore('blocks');
    const cursor = await store.openCursor(null, 'prev');
    return cursor?.value;
  }

  static async getAllBlocks(): Promise {
    const db = await this.getDB();
    return db.getAll('blocks');
  }

  // Vote operations
  static async saveVote(vote: Vote): Promise {
    const db = await this.getDB();
    await db.put('votes', vote);
  }

  static async getVotesByPoll(pollId: string): Promise {
    const db = await this.getDB();
    return db.getAllFromIndex('votes', 'by-poll', pollId);
  }

  // Receipt operations
  static async saveReceipt(receipt: Receipt): Promise {
    const db = await this.getDB();
    const normalizedReceipt: Receipt = {
      ...receipt,
      verificationCode: receipt.verificationCode || receipt.mnemonic || '',
      mnemonic: receipt.mnemonic || receipt.verificationCode,
    };
    await db.put('receipts', normalizedReceipt);
  }

  static async getReceipt(verificationCode: string): Promise {
    const db = await this.getDB();
    const receipt = await db.get('receipts', verificationCode);
    if (!receipt) return undefined;
    return {
      ...receipt,
      verificationCode: receipt.verificationCode || receipt.mnemonic || '',
      mnemonic: receipt.mnemonic || receipt.verificationCode,
    };
  }

  static async getAllReceipts(): Promise {
    const db = await this.getDB();
    const receipts = await db.getAll('receipts');
    return receipts.map((receipt: Receipt) => ({
      ...receipt,
      verificationCode: receipt.verificationCode || receipt.mnemonic || '',
      mnemonic: receipt.mnemonic || receipt.verificationCode,
    }));
  }

  // Poll operations
  static async savePoll(poll: ChainPollSnapshot): Promise {
    const db = await this.getDB();
    await db.put('polls', poll);
  }

  static async getPoll(id: string): Promise {
    const db = await this.getDB();
    return db.get('polls', id);
  }

  static async getAllPolls(): Promise {
    const db = await this.getDB();
    return db.getAll('polls');
  }

  // ── Comment mirror ──────────────────────────────────────────────────────────
  // The local copy of a comment is what the author (and any reader who has seen
  // it once) renders from. Gun is the replication layer, not the source of truth
  // for display — it holds nothing across a reload.

  static async saveComment(comment: StoredComment): Promise<void> {
    const db = await this.getDB();
    await db.put('comments', comment);
  }

  static async saveComments(comments: StoredComment[]): Promise<void> {
    if (comments.length === 0) return;
    const db = await this.getDB();
    const tx = db.transaction('comments', 'readwrite');
    const store = tx.objectStore('comments');
    await Promise.all(comments.map((comment) => store.put(comment)));
    await tx.done;
  }

  static async getComment(id: string): Promise<StoredComment | undefined> {
    const db = await this.getDB();
    return db.get('comments', id);
  }

  static async getCommentsByPost(postId: string): Promise<StoredComment[]> {
    const db = await this.getDB();
    return db.getAllFromIndex('comments', 'by-post', postId);
  }

  static async getAllComments(): Promise<StoredComment[]> {
    const db = await this.getDB();
    return db.getAll('comments');
  }

  static async deleteComment(id: string): Promise<void> {
    const db = await this.getDB();
    await db.delete('comments', id);
  }

  /**
   * Cap the comment mirror, dropping the oldest rows first. Comments this
   * device authored are never pruned — they may still be the only copy in
   * existence if no relay ever confirmed them.
   */
  static async pruneComments(maxRows = 5_000): Promise<number> {
    const all = await this.getAllComments();
    if (all.length <= maxRows) return 0;
    const prunable = all
      .filter((c) => !c.authoredLocally)
      .sort((a, b) => (a.updatedAt || a.createdAt) - (b.updatedAt || b.createdAt));
    const excess = Math.min(all.length - maxRows, prunable.length);
    const db = await this.getDB();
    for (let i = 0; i < excess; i++) {
      await db.delete('comments', prunable[i].id);
    }
    return excess;
  }

  // ── Chat message mirror ─────────────────────────────────────────────────────

  static async saveChatMessage(message: StoredChatMessage): Promise<void> {
    const db = await this.getDB();
    await db.put('chat-messages', message);
  }

  static async saveChatMessages(messages: StoredChatMessage[]): Promise<void> {
    if (messages.length === 0) return;
    const db = await this.getDB();
    const tx = db.transaction('chat-messages', 'readwrite');
    const store = tx.objectStore('chat-messages');
    await Promise.all(messages.map((message) => store.put(message)));
    await tx.done;
  }

  static async getChatMessage(id: string): Promise<StoredChatMessage | undefined> {
    const db = await this.getDB();
    return db.get('chat-messages', id);
  }

  static async getChatMessagesByRoom(roomId: string): Promise<StoredChatMessage[]> {
    const db = await this.getDB();
    return db.getAllFromIndex('chat-messages', 'by-room', roomId);
  }

  static async getAllChatMessages(): Promise<StoredChatMessage[]> {
    const db = await this.getDB();
    return db.getAll('chat-messages');
  }

  static async deleteChatMessage(id: string): Promise<void> {
    const db = await this.getDB();
    await db.delete('chat-messages', id);
  }

  /** Keep at most `maxPerRoom` messages per conversation, oldest dropped first. */
  static async pruneChatMessages(maxPerRoom = 2_000): Promise<number> {
    const all = await this.getAllChatMessages();
    const byRoom = new Map<string, StoredChatMessage[]>();
    for (const message of all) {
      const bucket = byRoom.get(message.roomId);
      if (bucket) bucket.push(message);
      else byRoom.set(message.roomId, [message]);
    }
    const db = await this.getDB();
    let removed = 0;
    for (const messages of byRoom.values()) {
      if (messages.length <= maxPerRoom) continue;
      messages.sort((a, b) => a.timestamp - b.timestamp || a.seq - b.seq);
      for (const message of messages.slice(0, messages.length - maxPerRoom)) {
        // An unsent message is still only held here — never prune it away.
        if (message.outgoing && message.syncStatus !== 'confirmed' && message.syncStatus !== 'published') continue;
        await db.delete('chat-messages', message.id);
        removed++;
      }
    }
    return removed;
  }

  // Metadata operations
  static async setMetadata(key: string, value: any): Promise {
    const db = await this.getDB();
    await db.put('metadata', value, key);
  }

  static async getMetadata(key: string): Promise {
    const db = await this.getDB();
    return db.get('metadata', key);
  }

  // ── Vote-index operations (O(1) duplicate-vote check) ────────────────────────

  /**
   * Returns true if this device has already submitted a vote for this poll.
   * O(1) — single IDB key lookup on the compound [pollId, deviceId] index.
   */
  static async hasVoted(pollId: string, deviceId: string): Promise<boolean> {
    const db = await this.getDB();
    const entry = await db.get('vote-index', [pollId, deviceId]);
    return entry !== undefined;
  }

  /**
   * Record that this device has voted on this poll.
   * Called after a block is committed to the chain so the index stays consistent.
   */
  static async markVoted(pollId: string, deviceId: string): Promise<void> {
    const db = await this.getDB();
    await db.put('vote-index', { pollId, deviceId, timestamp: Date.now() });
  }

  // ── Utility ────────────────────────────────────────────────────────────────

  static async clearAll(): Promise {
    const db = await this.getDB();
    const tx = db.transaction(
      ['blocks', 'votes', 'receipts', 'polls', 'metadata', 'encryption-keys', 'comments', 'chat-messages', 'vote-index'],
      'readwrite',
    );
    await Promise.all([
      tx.objectStore('blocks').clear(),
      tx.objectStore('votes').clear(),
      tx.objectStore('receipts').clear(),
      tx.objectStore('polls').clear(),
      tx.objectStore('metadata').clear(),
      tx.objectStore('encryption-keys').clear(),
      tx.objectStore('comments').clear(),
      tx.objectStore('chat-messages').clear(),
      tx.objectStore('vote-index').clear(),
    ]);
  }

  /**
   * Destructive: remove any persisted legacy posts (v2) from metadata store
   * This deletes offline copies of posts that were stored under legacy keys.
   */
  static async purgePersistedLegacyPosts(currentNamespace: string): Promise<number> {
    const db = await this.getDB();
    const tx = db.transaction(['metadata'], 'readwrite');
    const store = tx.objectStore('metadata');
    const allKeys = await store.getAllKeys();
    let removed = 0;
    for (const key of allKeys) {
      try {
        const val = await store.get(key as IDBValidKey);
        // Heuristic: legacy posts may be stored under keys like 'post:<id>' or in arrays
        if (!val) continue;
        if (typeof key === 'string' && key.startsWith('post-')) {
          // val should have dataVersion; remove if not matching
          const dv = val && typeof val.dataVersion === 'string' ? val.dataVersion : null;
          if (dv && dv !== currentNamespace) {
            await store.delete(key as IDBValidKey);
            removed++;
          }
          if (!dv && Number.parseInt(currentNamespace.replace(/^v/i, ''), 10) >= 3) {
            // no version and running v3+ -> delete conservatively
            await store.delete(key as IDBValidKey);
            removed++;
          }
        }
        // Also handle arrays of posts stored under metadata keys like 'posts-cache'
        if (typeof val === 'object' && val !== null && Array.isArray((val as any).posts)) {
          const postsArr = (val as any).posts as any[];
          const filtered = postsArr.filter(p => {
            const dv = p && typeof p.dataVersion === 'string' ? p.dataVersion : null;
            if (dv && dv !== currentNamespace) return false;
            if (!dv && Number.parseInt(currentNamespace.replace(/^v/i, ''), 10) >= 3) return false;
            return true;
          });
          if (filtered.length !== postsArr.length) {
            (val as any).posts = filtered;
            await store.put(val, key as IDBValidKey);
            removed += (postsArr.length - filtered.length);
          }
        }
      } catch (err) {
        // best-effort per key
      }
    }
    return removed;
  }
}
