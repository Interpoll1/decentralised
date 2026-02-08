// src/types/nostr.ts — Nostr-compatible event types for InterPoll

// Event kinds for InterPoll
export const EventKind = {
  POLL_CREATION: 100,
  VOTE_CAST: 101,
  POLL_UPDATE: 102,
} as const;

export type EventKindValue = (typeof EventKind)[keyof typeof EventKind];

// Core Nostr-compatible signed event
export interface NostrEvent {
  id: string;             // SHA-256 of the serialized event (hex, 64 chars)
  pubkey: string;         // 32-byte x-only public key (hex, 64 chars)
  created_at: number;     // Unix timestamp in seconds
  kind: EventKindValue;
  tags: string[][];       // Array of tag arrays, e.g. [["poll_id", "abc123"]]
  content: string;        // JSON-encoded payload
  sig: string;            // 64-byte Schnorr signature (hex, 128 chars)
}

// Unsigned event (before ID computation and signing)
export interface UnsignedEvent {
  pubkey: string;
  created_at: number;
  kind: EventKindValue;
  tags: string[][];
  content: string;
}

// Key pair stored in IndexedDB
export interface StoredKeyPair {
  privateKey: string;     // 32-byte hex (64 chars)
  publicKey: string;      // 32-byte x-only hex (64 chars)
  createdAt: number;
}
