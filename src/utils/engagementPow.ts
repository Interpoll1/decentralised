/**
 * Self-contained proof-of-work for *any* engagement action — post votes,
 * comments, comment votes, follows — not just poll votes.
 *
 * This is the generalisation of `votePow.ts` (M2 in the bought-engagement
 * design note). The properties that make vote PoW useful are the ones we need
 * everywhere: the pre-image is derived purely from the action's own fields, so
 * any peer can verify it offline at render time with no relay and no stored
 * challenge; the nonce is excluded from the pre-image so verification is
 * non-circular.
 *
 * `vote` deliberately delegates to `votePowPrefix` so already-published vote
 * PoW keeps verifying — the ladder is being widened, not re-based.
 */

import { CryptoService } from '@/services/cryptoService';
import { countLeadingZeroBits, votePowPrefix, VOTE_POW_DIFFICULTY } from '@/utils/votePow';

/** Engagement actions that can carry Sybil-resistance evidence. */
export type EngagementKind = 'vote' | 'post-vote' | 'comment' | 'comment-vote' | 'follow';

/**
 * Difficulty in leading zero bits per action kind.
 *
 * A poll vote stays at the protocol's 18 bits; cheaper, higher-frequency
 * actions sit lower so a normal user never notices, while a farm delivering
 * thousands of them pays the cost thousands of times.
 */
export const ENGAGEMENT_POW_DIFFICULTY: Record<EngagementKind, number> = {
  vote: VOTE_POW_DIFFICULTY,
  comment: 14,
  'post-vote': 12,
  'comment-vote': 12,
  follow: 12,
};

/** Bound the solver so a hostile/high difficulty can't hang the tab forever. */
const MAX_SOLVE_ITERATIONS = 1 << 24; // ~16.7M hashes
const SOLVER_YIELD_EVERY = 5_000;

/** Deterministic PoW pre-image binding the work to this exact action. */
export function engagementPowPrefix(
  kind: EngagementKind,
  pubkey: string,
  targetId: string,
  createdAt: number,
): string {
  // Poll votes keep the original pre-image so existing vote PoW stays valid.
  if (kind === 'vote') return votePowPrefix(pubkey, targetId, createdAt);
  return `engagepow:${kind}:${pubkey}:${targetId}:${createdAt}:`;
}

/** True when `nonce` solves the PoW at `difficulty` for these fields. */
export function verifyEngagementPow(
  kind: EngagementKind,
  pubkey: string,
  targetId: string,
  createdAt: number,
  nonce: number,
  difficulty: number = ENGAGEMENT_POW_DIFFICULTY[kind],
): boolean {
  if (!Number.isInteger(nonce) || nonce < 0) return false;
  if (!pubkey || !targetId) return false;
  const hash = CryptoService.hash(
    engagementPowPrefix(kind, pubkey, targetId, createdAt) + nonce.toString(),
  );
  return countLeadingZeroBits(hash) >= difficulty;
}

/**
 * Solve the engagement PoW. Yields to the event loop periodically so the UI
 * stays responsive. Returns the nonce, or throws if the bound is exceeded.
 */
export async function computeEngagementPow(
  kind: EngagementKind,
  pubkey: string,
  targetId: string,
  createdAt: number,
  difficulty: number = ENGAGEMENT_POW_DIFFICULTY[kind],
): Promise<number> {
  const prefix = engagementPowPrefix(kind, pubkey, targetId, createdAt);
  for (let nonce = 0; nonce < MAX_SOLVE_ITERATIONS; nonce++) {
    if (countLeadingZeroBits(CryptoService.hash(prefix + nonce.toString())) >= difficulty) {
      return nonce;
    }
    if (nonce % SOLVER_YIELD_EVERY === 0 && nonce > 0) {
      await new Promise<void>((r) => setTimeout(r, 0));
    }
  }
  throw new Error(`engagement PoW not found within ${MAX_SOLVE_ITERATIONS} iterations`);
}
