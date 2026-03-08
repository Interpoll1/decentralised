import { StorageService } from './storageService';
import type { StoredEncryptionKey } from '../types/encryption';

export class KeyVaultService {
  private static readonly STORE_NAME = 'encryption-keys';

  /** Store an encryption key for a community or chat room */
  static async storeKey(entry: StoredEncryptionKey): Promise<void> {
    const db = await StorageService.getDB();
    await db.put(this.STORE_NAME, entry);
  }

  /** Retrieve a stored encryption key by id (communityId or roomId) */
  static async getKey(id: string): Promise<StoredEncryptionKey | undefined> {
    const db = await StorageService.getDB();
    return db.get(this.STORE_NAME, id);
  }

  /** Check if a key exists for the given id */
  static async hasKey(id: string): Promise<boolean> {
    const key = await this.getKey(id);
    return key !== undefined;
  }

  /** Remove a stored key */
  static async removeKey(id: string): Promise<void> {
    const db = await StorageService.getDB();
    await db.delete(this.STORE_NAME, id);
  }

  /** List all stored encryption keys */
  static async listKeys(): Promise<StoredEncryptionKey[]> {
    const db = await StorageService.getDB();
    return db.getAll(this.STORE_NAME);
  }

  /** List keys filtered by type */
  static async listKeysByType(type: StoredEncryptionKey['type']): Promise<StoredEncryptionKey[]> {
    const all = await this.listKeys();
    return all.filter(k => k.type === type);
  }

  /** Export all keys as a JSON string (for backup) */
  static async exportKeys(): Promise<string> {
    const keys = await this.listKeys();
    return JSON.stringify(keys);
  }

  /** Import keys from a JSON string (from backup). Merges with existing keys. */
  static async importKeys(json: string): Promise<number> {
    const keys: StoredEncryptionKey[] = JSON.parse(json);
    if (!Array.isArray(keys)) throw new Error('Invalid key backup format');
    const db = await StorageService.getDB();
    let imported = 0;
    for (const key of keys) {
      if (key.id && key.key && key.type) {
        await db.put(this.STORE_NAME, key);
        imported++;
      }
    }
    return imported;
  }

  /** Clear all stored encryption keys */
  static async clearAll(): Promise<void> {
    const db = await StorageService.getDB();
    await db.clear(this.STORE_NAME);
  }
}
