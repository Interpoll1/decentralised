import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { ChainBlock, Receipt, Vote, Poll } from '../types/chain';

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
}

export class StorageService {
  private static dbPromise: Promise<IDBPDatabase>;

  static async getDB(): Promise<IDBPDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = openDB('interpoll-db', 1, {
        upgrade(db) {
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
    await db.put('receipts', receipt);
  }

  static async getReceipt(mnemonic: string): Promise {
    const db = await this.getDB();
    return db.get('receipts', mnemonic);
  }

  static async getAllReceipts(): Promise {
    const db = await this.getDB();
    return db.getAll('receipts');
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
    const tx = db.transaction(['blocks', 'votes', 'receipts', 'polls', 'metadata'], 'readwrite');
    await Promise.all([
      tx.objectStore('blocks').clear(),
      tx.objectStore('votes').clear(),
      tx.objectStore('receipts').clear(),
      tx.objectStore('polls').clear(),
      tx.objectStore('metadata').clear(),
    ]);
  }
}