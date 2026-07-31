/**
 * Storage layer.
 *
 * The HTTP layer only depends on the HashStore / ApiKeyStore interfaces
 * below, not on any concrete implementation. The in-memory implementation
 * here is a reference/dev implementation — swap it for a Postgres, Redis,
 * or DynamoDB-backed implementation in production by implementing the
 * same interface.
 */

import { ApiKeyRecord, HashAlgorithm, HashRecord } from "./types";

function key(algorithm: HashAlgorithm, hash: string): string {
  return `${algorithm}:${hash.toLowerCase()}`;
}

export interface HashStore {
  get(algorithm: HashAlgorithm, hash: string): Promise<HashRecord | undefined>;
  upsert(record: HashRecord): Promise<HashRecord>;
  delete(algorithm: HashAlgorithm, hash: string): Promise<boolean>;
  count(): Promise<number>;
}

export interface ApiKeyStore {
  findByHashedKey(hashedKey: string): Promise<ApiKeyRecord | undefined>;
  create(record: ApiKeyRecord): Promise<ApiKeyRecord>;
  list(): Promise<ApiKeyRecord[]>;
  revoke(id: string): Promise<boolean>;
  touch(id: string): Promise<void>;
}

export class InMemoryHashStore implements HashStore {
  private records = new Map<string, HashRecord>();

  async get(algorithm: HashAlgorithm, hash: string): Promise<HashRecord | undefined> {
    return this.records.get(key(algorithm, hash));
  }

  async upsert(record: HashRecord): Promise<HashRecord> {
    this.records.set(key(record.algorithm, record.hash), record);
    return record;
  }

  async delete(algorithm: HashAlgorithm, hash: string): Promise<boolean> {
    return this.records.delete(key(algorithm, hash));
  }

  async count(): Promise<number> {
    return this.records.size;
  }
}

export class InMemoryApiKeyStore implements ApiKeyStore {
  private byId = new Map<string, ApiKeyRecord>();
  private byHashedKey = new Map<string, ApiKeyRecord>();

  async findByHashedKey(hashedKey: string): Promise<ApiKeyRecord | undefined> {
    return this.byHashedKey.get(hashedKey);
  }

  async create(record: ApiKeyRecord): Promise<ApiKeyRecord> {
    this.byId.set(record.id, record);
    this.byHashedKey.set(record.hashedKey, record);
    return record;
  }

  async list(): Promise<ApiKeyRecord[]> {
    return Array.from(this.byId.values());
  }

  async revoke(id: string): Promise<boolean> {
    const rec = this.byId.get(id);
    if (!rec) return false;
    rec.revoked = true;
    return true;
  }

  async touch(id: string): Promise<void> {
    const rec = this.byId.get(id);
    if (rec) rec.lastUsedAt = new Date().toISOString();
  }
}
