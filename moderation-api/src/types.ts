/**
 * Core domain types for the Moderation Hash-Match API.
 *
 * This standard is intentionally modeled after real-world hash-sharing
 * systems used for content moderation (e.g. perceptual/cryptographic hash
 * lists for known-bad media), so that an operator can plug this server
 * into an existing moderation pipeline with minimal changes.
 */

/** Supported hash algorithms. Add new algorithms here as needed. */
export type HashAlgorithm = "md5" | "sha1" | "sha256" | "pdq" | "phash";

/** Severity of the content associated with a hash match. */
export type Severity = "low" | "medium" | "high" | "critical";

/** A single hash entry stored in the moderation database. */
export interface HashRecord {
  /** Lowercase hex digest (or base64/binary string for perceptual hashes). */
  hash: string;
  algorithm: HashAlgorithm;
  /** Free-form category tags, e.g. ["csam"], ["violence"], ["spam"]. */
  categories: string[];
  severity: Severity;
  /** Identifier of the system/org/feed that contributed this hash. */
  source: string;
  addedAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
  /** Arbitrary additional context (case id, ticket link, notes, etc.). */
  metadata?: Record<string, unknown>;
}

/** Input shape accepted when submitting a new hash. */
export interface HashRecordInput {
  hash: string;
  algorithm: HashAlgorithm;
  categories: string[];
  severity: Severity;
  source: string;
  metadata?: Record<string, unknown>;
}

/** Response shape for a single hash lookup. */
export interface LookupResult {
  match: boolean;
  hash: string;
  algorithm: HashAlgorithm;
  record?: HashRecord;
}

export type ApiKeyScope = "read" | "write" | "admin";

/** Stored (server-side) representation of an API key. Raw key is never persisted. */
export interface ApiKeyRecord {
  id: string;
  label: string;
  /** SHA-256 hex digest of the raw key. */
  hashedKey: string;
  scopes: ApiKeyScope[];
  createdAt: string;
  lastUsedAt?: string;
  revoked: boolean;
}

export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}
