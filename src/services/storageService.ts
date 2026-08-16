import { openDB, DBSchema, IDBPDatabase } from 'idb';
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
    // keyPath is 'timestamp' (see the upgrade handler), so the key is numeric.
    key: number;
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

// How long to wait for IndexedDB to open before assuming it is blocked and
// falling back to the in-memory store. On some mobile browsers (notably iOS
// Safari in Private mode) `openDB` never resolves or rejects — it just hangs,
// which surfaces to the user as the whole app "freezing" on load.
const IDB_OPEN_TIMEOUT_MS = 4_000;

export class StorageService {
  private static dbPromise: Promise<IDBPDatabase<VotingChainDB>>;

  /** True when the active store is the volatile in-memory fallback (no persistence). */
  static usingMemoryFallback = false;

  static async getDB(): Promise<IDBPDatabase<VotingChainDB>> {
    if (!this.dbPromise) {
      this.dbPromise = this.openDatabase();
    }
    return this.dbPromise;
  }

  private static async openDatabase(): Promise<IDBPDatabase<VotingChainDB>> {
    // Feature-detect: some restricted/mobile contexts expose no IndexedDB at all.
    const hasIndexedDB = typeof indexedDB !== 'undefined' && indexedDB !== null;
    if (hasIndexedDB) {
      try {
        const open = openDB<VotingChainDB>('interpoll-db', 4, {
          upgrade(db, oldVersion) {
            if (oldVersion < 1) {
              // Blocks store
              const blockStore = db.createObjectStore('blocks', { keyPath: 'index' });
              blockStore.createIndex('by-hash', 'currentHash');

              // Votes store
              const voteStore = db.createObjectStore('votes', { keyPath: 'timestamp' });
              voteStore.createIndex('by-poll', 'pollId');

              // Receipts store
              const receiptStore = db.createObjectStore('receipts', { keyPath: 'mnemonic' });
              receiptStore.createIndex('by-block', 'blockIndex');

              // Polls store
              db.createObjectStore('polls', { keyPath: 'id' });

              // Metadata store
              db.createObjectStore('metadata');
            }
            if (oldVersion < 2) {
              db.createObjectStore('encryption-keys', { keyPath: 'id' });
            }
            if (oldVersion < 3) {
              // Durable mirrors for the social layer. Gun runs with
              // `localStorage:false, radisk:false`, so without these a comment
              // or message exists only in a volatile in-memory graph that the
              // memory watchdog is free to evict.
              const commentStore = db.createObjectStore('comments', { keyPath: 'id' });
              commentStore.createIndex('by-post', 'postId');

              const chatStore = db.createObjectStore('chat-messages', { keyPath: 'id' });
              chatStore.createIndex('by-room', 'roomId');
            }
            if (oldVersion < 4) {
              // O(1) duplicate-vote index — compound key [pollId, deviceId].
              // One entry per (poll, device) pair so hasVoted() is a single IDB
              // key lookup instead of a full chain scan.
              db.createObjectStore('vote-index', { keyPath: ['pollId', 'deviceId'] });
            }
          },
        });
        // Race the open against a timeout so a hung request can't freeze the app.
        const db = await Promise.race([
          open,
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('IndexedDB open timed out')), IDB_OPEN_TIMEOUT_MS),
          ),
        ]);
        return db;
      } catch (err) {
        console.warn('[Storage] IndexedDB unavailable — using in-memory fallback (data will not persist):', err);
      }
    } else {
      console.warn('[Storage] IndexedDB not present — using in-memory fallback (data will not persist)');
    }
    this.usingMemoryFallback = true;
    return createInMemoryDB();
  }

  // Block operations
  static async saveBlock(block: ChainBlock): Promise<void> {
    const db = await this.getDB();
    await db.put('blocks', block);
  }

  static async getBlock(index: number): Promise<ChainBlock | undefined> {
    const db = await this.getDB();
    return db.get('blocks', index);
  }

  static async getLatestBlock(): Promise<ChainBlock | undefined> {
    const db = await this.getDB();
    const tx = db.transaction('blocks', 'readonly');
    const store = tx.objectStore('blocks');
    const cursor = await store.openCursor(null, 'prev');
    return cursor?.value;
  }

  static async getAllBlocks(): Promise<ChainBlock[]> {
    const db = await this.getDB();
    return db.getAll('blocks');
  }

  // Vote operations
  static async saveVote(vote: Vote): Promise<void> {
    const db = await this.getDB();
    await db.put('votes', vote);
  }

  static async getVotesByPoll(pollId: string): Promise<Vote[]> {
    const db = await this.getDB();
    return db.getAllFromIndex('votes', 'by-poll', pollId);
  }

  // Receipt operations
  static async saveReceipt(receipt: Receipt): Promise<void> {
    const db = await this.getDB();
    const normalizedReceipt: Receipt = {
      ...receipt,
      verificationCode: receipt.verificationCode || receipt.mnemonic || '',
      mnemonic: receipt.mnemonic || receipt.verificationCode,
    };
    await db.put('receipts', normalizedReceipt);
  }

  static async getReceipt(verificationCode: string): Promise<Receipt | undefined> {
    const db = await this.getDB();
    const receipt = await db.get('receipts', verificationCode);
    if (!receipt) return undefined;
    return {
      ...receipt,
      verificationCode: receipt.verificationCode || receipt.mnemonic || '',
      mnemonic: receipt.mnemonic || receipt.verificationCode,
    };
  }

  static async getAllReceipts(): Promise<Receipt[]> {
    const db = await this.getDB();
    const receipts = await db.getAll('receipts');
    return receipts.map((receipt: Receipt) => ({
      ...receipt,
      verificationCode: receipt.verificationCode || receipt.mnemonic || '',
      mnemonic: receipt.mnemonic || receipt.verificationCode,
    }));
  }

  // Poll operations
  static async savePoll(poll: ChainPollSnapshot): Promise<void> {
    const db = await this.getDB();
    await db.put('polls', poll);
  }

  static async getPoll(id: string): Promise<ChainPollSnapshot | undefined> {
    const db = await this.getDB();
    return db.get('polls', id);
  }

  static async getAllPolls(): Promise<ChainPollSnapshot[]> {
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
  static async setMetadata(key: string, value: any): Promise<void> {
    const db = await this.getDB();
    await db.put('metadata', value, key);
  }

  static async getMetadata(key: string): Promise<any> {
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

  static async clearAll(): Promise<void> {
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
        const val = await store.get(key);
        // Heuristic: legacy posts may be stored under keys like 'post:<id>' or in arrays
        if (!val) continue;
        if (typeof key === 'string' && key.startsWith('post-')) {
          // val should have dataVersion; remove if not matching
          const dv = val && typeof val.dataVersion === 'string' ? val.dataVersion : null;
          if (dv && dv !== currentNamespace) {
            await store.delete(key);
            removed++;
          }
          if (!dv && Number.parseInt(currentNamespace.replace(/^v/i, ''), 10) >= 3) {
            // no version and running v3+ -> delete conservatively
            await store.delete(key);
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
            await store.put(val, key);
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

/**
 * Minimal in-memory stand-in for the subset of the `idb` API that
 * `StorageService` uses. Activated only when IndexedDB is missing, throws, or
 * hangs (e.g. iOS Safari Private mode). Keeps the app functional for the
 * session — data simply does not persist across reloads.
 */
function createInMemoryDB(): IDBPDatabase<VotingChainDB> {
  const stores: Record<string, Map<any, any>> = {
    blocks: new Map(),
    votes: new Map(),
    receipts: new Map(),
    polls: new Map(),
    metadata: new Map(),
    'encryption-keys': new Map(),
    comments: new Map(),
    'chat-messages': new Map(),
    'vote-index': new Map(),
  };
  // Stores with an inline keyPath derive their key from the value; `metadata`
  // uses out-of-line (explicit) keys.
  const keyPaths: Record<string, string | null> = {
    blocks: 'index',
    votes: 'timestamp',
    receipts: 'mnemonic',
    polls: 'id',
    metadata: null,
    'encryption-keys': 'id',
    comments: 'id',
    'chat-messages': 'id',
    // vote-index uses compound key [pollId, deviceId] — handled specially below
    'vote-index': null,
  };
  const indexes: Record<string, Record<string, string>> = {
    blocks: { 'by-hash': 'currentHash' },
    votes: { 'by-poll': 'pollId' },
    receipts: { 'by-block': 'blockIndex' },
    comments: { 'by-post': 'postId' },
    'chat-messages': { 'by-room': 'roomId' },
  };

  const resolveKey = (name: string, value: any, explicitKey?: any) => {
    const kp = keyPaths[name];
    let key = kp ? value?.[kp] : explicitKey;
    // Compound keys (arrays) must be serialised for Map equality to work
    if (Array.isArray(key)) key = key.join('\x00');
    return key;
  };
  const store = (name: string): Map<any, any> => stores[name] ?? (stores[name] = new Map());

  const objectStore = (name: string) => ({
    async put(value: any, key?: any) { store(name).set(resolveKey(name, value, key), value); },
    async get(key: any) { return store(name).get(key); },
    async delete(key: any) { store(name).delete(key); },
    async clear() { store(name).clear(); },
    async getAllKeys() { return [...store(name).keys()]; },
    async getAll() { return [...store(name).values()]; },
    async openCursor(_query?: any, direction?: 'next' | 'prev') {
      const entries = [...store(name).entries()].sort((a, b) =>
        a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0,
      );
      if (direction === 'prev') entries.reverse();
      return entries.length ? { value: entries[0][1], key: entries[0][0] } : null;
    },
  });

  const db: any = {
    async put(name: string, value: any, key?: any) { store(name).set(resolveKey(name, value, key), value); },
    async get(name: string, key: any) { return store(name).get(Array.isArray(key) ? key.join('\x00') : key); },
    async delete(name: string, key: any) { store(name).delete(Array.isArray(key) ? key.join('\x00') : key); },
    async getAll(name: string) { return [...store(name).values()]; },
    async getAllFromIndex(name: string, index: string, query: any) {
      const kp = indexes[name]?.[index];
      const all = [...store(name).values()];
      return kp ? all.filter((v) => v?.[kp] === query) : all;
    },
    transaction(_names: string | string[], _mode?: string) {
      return { objectStore, done: Promise.resolve() };
    },
  };
  return db as unknown as IDBPDatabase<VotingChainDB>;
}