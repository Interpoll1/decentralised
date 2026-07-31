/**
 * SQLite-backed storage, implementing the same HashStore / ApiKeyStore
 * interfaces as store.ts's in-memory versions. Uses Node's built-in
 * `node:sqlite` module (DatabaseSync) — requires Node >= 22.5, no native
 * compilation or extra npm dependency required.
 *
 * Swap this in for InMemoryHashStore/InMemoryApiKeyStore in index.ts when
 * you want data to survive restarts.
 */

import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { ApiKeyStore, HashStore } from "./store";
import { ApiKeyRecord, ApiKeyScope, HashAlgorithm, HashRecord } from "./types";

function ensureDirFor(filePath: string): void {
  if (filePath === ":memory:") return;
  mkdirSync(dirname(filePath), { recursive: true });
}

/** Opens (and migrates, if needed) the SQLite database file. */
export function openDatabase(filePath: string): DatabaseSync {
  ensureDirFor(filePath);
  const db = new DatabaseSync(filePath);

  // WAL mode gives much better concurrent read/write behavior for a
  // long-running server process than the default rollback journal.
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");

  db.exec(`
    CREATE TABLE IF NOT EXISTS hash_records (
      algorithm   TEXT NOT NULL,
      hash        TEXT NOT NULL,
      categories  TEXT NOT NULL,      -- JSON array
      severity    TEXT NOT NULL,
      source      TEXT NOT NULL,
      metadata    TEXT,               -- JSON object, nullable
      added_at    TEXT NOT NULL,
      updated_at  TEXT NOT NULL,
      PRIMARY KEY (algorithm, hash)
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id           TEXT PRIMARY KEY,
      label        TEXT NOT NULL,
      hashed_key   TEXT NOT NULL UNIQUE,
      scopes       TEXT NOT NULL,     -- JSON array
      created_at   TEXT NOT NULL,
      last_used_at TEXT,
      revoked      INTEGER NOT NULL DEFAULT 0
    );
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_api_keys_hashed_key ON api_keys (hashed_key);`);

  return db;
}

interface HashRow {
  algorithm: string;
  hash: string;
  categories: string;
  severity: string;
  source: string;
  metadata: string | null;
  added_at: string;
  updated_at: string;
}

function rowToHashRecord(row: HashRow): HashRecord {
  return {
    algorithm: row.algorithm as HashAlgorithm,
    hash: row.hash,
    categories: JSON.parse(row.categories),
    severity: row.severity as HashRecord["severity"],
    source: row.source,
    metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    addedAt: row.added_at,
    updatedAt: row.updated_at,
  };
}

export class SqliteHashStore implements HashStore {
  constructor(private db: DatabaseSync) {}

  async get(algorithm: HashAlgorithm, hash: string): Promise<HashRecord | undefined> {
    const row = this.db
      .prepare("SELECT * FROM hash_records WHERE algorithm = ? AND hash = ?")
      .get(algorithm, hash.toLowerCase()) as HashRow | undefined;
    return row ? rowToHashRecord(row) : undefined;
  }

  async upsert(record: HashRecord): Promise<HashRecord> {
    this.db
      .prepare(
        `INSERT INTO hash_records (algorithm, hash, categories, severity, source, metadata, added_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (algorithm, hash) DO UPDATE SET
           categories = excluded.categories,
           severity = excluded.severity,
           source = excluded.source,
           metadata = excluded.metadata,
           updated_at = excluded.updated_at`
      )
      .run(
        record.algorithm,
        record.hash.toLowerCase(),
        JSON.stringify(record.categories),
        record.severity,
        record.source,
        record.metadata ? JSON.stringify(record.metadata) : null,
        record.addedAt,
        record.updatedAt
      );
    return record;
  }

  async delete(algorithm: HashAlgorithm, hash: string): Promise<boolean> {
    const result = this.db
      .prepare("DELETE FROM hash_records WHERE algorithm = ? AND hash = ?")
      .run(algorithm, hash.toLowerCase());
    return result.changes > 0;
  }

  async count(): Promise<number> {
    const row = this.db.prepare("SELECT COUNT(*) as n FROM hash_records").get() as { n: number };
    return row.n;
  }
}

interface ApiKeyRow {
  id: string;
  label: string;
  hashed_key: string;
  scopes: string;
  created_at: string;
  last_used_at: string | null;
  revoked: number;
}

function rowToApiKeyRecord(row: ApiKeyRow): ApiKeyRecord {
  return {
    id: row.id,
    label: row.label,
    hashedKey: row.hashed_key,
    scopes: JSON.parse(row.scopes) as ApiKeyScope[],
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at ?? undefined,
    revoked: Boolean(row.revoked),
  };
}

export class SqliteApiKeyStore implements ApiKeyStore {
  constructor(private db: DatabaseSync) {}

  async findByHashedKey(hashedKey: string): Promise<ApiKeyRecord | undefined> {
    const row = this.db.prepare("SELECT * FROM api_keys WHERE hashed_key = ?").get(hashedKey) as
      | ApiKeyRow
      | undefined;
    return row ? rowToApiKeyRecord(row) : undefined;
  }

  async create(record: ApiKeyRecord): Promise<ApiKeyRecord> {
    this.db
      .prepare(
        `INSERT INTO api_keys (id, label, hashed_key, scopes, created_at, last_used_at, revoked)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
        record.label,
        record.hashedKey,
        JSON.stringify(record.scopes),
        record.createdAt,
        record.lastUsedAt ?? null,
        record.revoked ? 1 : 0
      );
    return record;
  }

  async list(): Promise<ApiKeyRecord[]> {
    const rows = this.db.prepare("SELECT * FROM api_keys ORDER BY created_at ASC").all() as unknown as ApiKeyRow[];
    return rows.map(rowToApiKeyRecord);
  }

  async revoke(id: string): Promise<boolean> {
    const result = this.db.prepare("UPDATE api_keys SET revoked = 1 WHERE id = ?").run(id);
    return result.changes > 0;
  }

  async touch(id: string): Promise<void> {
    this.db.prepare("UPDATE api_keys SET last_used_at = ? WHERE id = ?").run(new Date().toISOString(), id);
  }
}
