// src/types/poll.ts
//
// Canonical Poll/PollOption shape — the rich, Gun-replicated object actually
// written/read by pollService.ts. Distinct from `ChainPollSnapshot` in
// `src/types/chain.ts`, which is the minimal local chain/snapshot-layer shape.

export interface PollOption {
  id: string;
  text: string;
  votes: number;
  /**
   * Voter IDs for this option. Declared as an array for API ergonomics, but
   * Gun cannot reliably store sparse arrays — on the wire, pollService.ts
   * encodes this as an index-keyed object map (see buildVotersMap/buildOptionsMap
   * in pollService.ts) and reconstructs the array shape on read.
   */
  voters: string[];
}

export interface Poll {
  id: string;
  communityId: string;
  authorId: string;
  authorName: string;
  authorShowRealName?: boolean;
  question: string;
  description?: string;
  options: PollOption[];
  createdAt: number;
  expiresAt: number;
  allowMultipleChoices: boolean;
  showResultsBeforeVoting: boolean;
  requireLogin: boolean;
  isPrivate: boolean;
  totalVotes: number;
  isExpired: boolean;
  authorPubkey?: string;
  contentSignature?: string;
  isEncrypted?: boolean;
  encryptedContent?: string;
  authTag?: string;
  /** Whether the relay independently confirmed it holds this poll (set on creation). */
  relayConfirmed?: boolean;
  /**
   * Sybil-resistance policy chosen by the poll creator. Rides inside the signed
   * poll content so it can't be forged. Absent = legacy poll, treated as
   * `{ requiredTier: 'open', mode: 'separate' }` (every vote counts, one track).
   * See voteTierService.ts for tiers and useVerifiedPollResults for display.
   */
  voteTrustPolicy?: VoteTrustPolicy;
}

export interface VoteTrustPolicy {
  /** Minimum tier a vote must reach to enter the "Verified" result track. */
  requiredTier: 'open' | 'pow' | 'relay' | 'issuer';
  /**
   * `separate` — anyone may vote; sub-tier votes show in a separate "Open" track.
   * `gate` — sub-tier votes are excluded from the trusted track.
   * Voting is never blocked outright; `gate` only affects which track counts.
   */
  mode: 'separate' | 'gate';
}
