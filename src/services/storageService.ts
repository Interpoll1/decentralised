import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { ChainBlock, Receipt, Vote, Poll } from '../types/chain';
import type { StoredEncryptionKey } from '../types/encryption';

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
    value: Poll;
  };
  metadata: {
    key: string;
    value: any;
  };
  'encryption-keys': {
    key: string;
    value: StoredEncryptionKey;
  };
}

export class StorageService {
  private static dbPromise: Promise<IDBPDatabase>;

  static async getDB(): Promise<IDBPDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = openDB('interpoll-db', 2, {
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
        },
      });
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
  static async savePoll(poll: Poll): Promise {
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

  // Metadata operations
  static async setMetadata(key: string, value: any): Promise {
    const db = await this.getDB();
    await db.put('metadata', value, key);
  }

  static async getMetadata(key: string): Promise {
    const db = await this.getDB();
    return db.get('metadata', key);
  }

  // Utility
  static async clearAll(): Promise {
    const db = await this.getDB();
    const tx = db.transaction(['blocks', 'votes', 'receipts', 'polls', 'metadata', 'encryption-keys'], 'readwrite');
    await Promise.all([
      tx.objectStore('blocks').clear(),
      tx.objectStore('votes').clear(),
      tx.objectStore('receipts').clear(),
      tx.objectStore('polls').clear(),
      tx.objectStore('metadata').clear(),
      tx.objectStore('encryption-keys').clear(),
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