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
  /**
   * IDs of the option(s) this vote selected. Optional for backward compatibility
   * with older callers/stored votes, but callers should populate it: when exactly
   * one option is selected, chainService/chainStore tags the signed kind-101 vote
   * event with it (`['option', id]`), which lets VoteTallyService attribute the
   * verified count to a specific option instead of falling back to the free-text
   * `choice` string (which is option *text* in some callers, *id* in others).
   */
  optionIds?: string[];
  /**
   * Sybil-resistance evidence the caller wants attached to the signed vote event
   * (see EventService.createVoteEvent / voteTierService). All optional and
   * additive — absence just yields a lower trust tier, never a blocked vote.
   */
  powDifficulty?: number;               // solve a vote PoW at this difficulty
  trustCert?: unknown;                  // issuer certificate binding this pubkey
  relayAttestation?: { payload: string; sig: string };
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