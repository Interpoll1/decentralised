import { openDB, DBSchema, IDBPDatabase } from 'idb';
import type { StoredEncryptionKey } from '../types/encryption';

interface InterpollDB extends DBSchema {
  metadata: {
    key: string;
    value: any;
  };
  'encryption-keys': {
    key: string;
    value: StoredEncryptionKey;
  };
}

/**
 * Local IndexedDB store for small per-identity metadata and encryption keys.
 * Polls, votes and posts live in GenosDB (signed, P2P-synced) — not here.
 */
export class StorageService {
  private static dbPromise: Promise<IDBPDatabase<InterpollDB>>;

  static async getDB(): Promise<IDBPDatabase<InterpollDB>> {
    if (!this.dbPromise) {
      this.dbPromise = openDB<InterpollDB>('interpoll-db', 2, {
        upgrade(db, oldVersion) {
          if (oldVersion < 1) {
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

  // Metadata operations
  static async setMetadata(key: string, value: any): Promise<void> {
    const db = await this.getDB();
    await db.put('metadata', value, key);
  }

  static async getMetadata(key: string): Promise<any> {
    const db = await this.getDB();
    return db.get('metadata', key);
  }

  // Utility
  static async clearAll(): Promise<void> {
    const db = await this.getDB();
    const tx = db.transaction(['metadata', 'encryption-keys'], 'readwrite');
    await Promise.all([
      tx.objectStore('metadata').clear(),
      tx.objectStore('encryption-keys').clear(),
    ]);
  }

  /**
   * Destructive: remove any persisted legacy posts (v2) from metadata store.
   * This deletes offline copies of posts that were stored under legacy keys.
   */
  static async purgePersistedLegacyPosts(currentNamespace: string): Promise<number> {
    const db = await this.getDB();
    const tx = db.transaction('metadata', 'readwrite');
    const store = tx.objectStore('metadata');
    const allKeys = await store.getAllKeys();
    let removed = 0;
    for (const key of allKeys) {
      try {
        const val = await store.get(key);
        if (!val) continue;
        if (typeof key === 'string' && key.startsWith('post-')) {
          const dv = val && typeof val.dataVersion === 'string' ? val.dataVersion : null;
          if (dv && dv !== currentNamespace) {
            await store.delete(key);
            removed++;
          }
          if (!dv && Number.parseInt(currentNamespace.replace(/^v/i, ''), 10) >= 3) {
            await store.delete(key);
            removed++;
          }
        }
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
