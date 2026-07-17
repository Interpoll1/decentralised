// src/types/chain.ts

/**
 * Minimal poll shape used by the local chain/snapshot layer (IndexedDB storage,
 * chain snapshots). Distinct from the rich, Gun-replicated `Poll` in
 * `src/types/poll.ts` (used by pollService.ts) — this one only carries what's
 * needed to validate/replay a local vote against the chain.
 */
export interface ChainPollSnapshot {
  id: string;
  title: string;
  description: string;
  options: string[];
  createdAt: number;
}

export interface Vote {
  pollId: string;
  choice: string;
  timestamp: number;
  deviceId: string; // Device fingerprint to prevent double voting
}

export type ActionType = 'vote' | 'community-create' | 'post-create';

export interface ChainBlock {
  index: number;
  timestamp: number;
  previousHash: string;
  voteHash: string;
  signature: string;
  currentHash: string;
  nonce: number;
  pubkey?: string;      // Signer's x-only public key (hex) — absent on legacy blocks
  eventId?: string;     // Reference to the NostrEvent that produced this block
  actionType?: ActionType;  // Type of action recorded in this block
  actionLabel?: string;     // Human-readable label (e.g. community name, post title)
}

export interface Receipt {
  blockIndex: number;
  voteHash: string;
  chainHeadHash: string;
  verificationCode: string;
  mnemonic?: string; // Legacy alias for older stored receipts
  timestamp: number;
  pollId: string;
}