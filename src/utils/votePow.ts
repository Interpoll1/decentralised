/**
 * Self-contained proof-of-work for vote events (Sybil-resistance tier `pow`).
 *
 * Unlike `powService.ts` — whose challenge prefix is issued by the relay and
 * therefore can only be verified server-side — this PoW is derived purely from
 * the vote's own fields, so ANY peer can verify it offline at tally time with no
 * relay and no stored challenge. The pre-image deliberately excludes the nonce
 * so verification is non-circular, and excludes the event id so it can be
 * computed before the id (which commits to the resulting `pow` tag) is finalized.
 */

import { CryptoService } from '@/services/cryptoService';

/** Protocol difficulty in leading zero bits. Tunable; keep client + verifier in sync. */
export const VOTE_POW_DIFFICULTY = 18;

/** Bound the solver so a hostile/high difficulty can't hang the tab forever. */
const MAX_SOLVE_ITERATIONS = 1 << 24; // ~16.7M hashes
const SOLVER_YIELD_EVERY = 5_000;

/** Count leading zero bits of a hex hash (mirrors powService/trustService). */
export function countLeadingZeroBits(hexHash: string): number {
  let bits = 0;
  for (const ch of hexHash) {
    const nibble = parseInt(ch, 16);
    if (nibble === 0) {
      bits += 4;
    } else {
      if (nibble < 2) bits += 3;
      else if (nibble < 4) bits += 2;
      else if (nibble < 8) bits += 1;
      break;
    }
  }
  return bits;
}

/** Deterministic PoW pre-image binding the work to this exact vote. */
export function votePowPrefix(pubkey: string, pollId: string, createdAt: number): string {
  return `votepow:${pubkey}:${pollId}:${createdAt}:`;
}

/** True when `nonce` solves the vote PoW at `difficulty` for these fields. */
export function verifyVotePow(
  pubkey: string,
  pollId: string,
  createdAt: number,
  nonce: number,
  difficulty: number = VOTE_POW_DIFFICULTY,
): boolean {
  if (!Number.isInteger(nonce) || nonce < 0) return false;
  const hash = CryptoService.hash(votePowPrefix(pubkey, pollId, createdAt) + nonce.toString());
  return countLeadingZeroBits(hash) >= difficulty;
}

/**
 * Solve the vote PoW. Yields to the event loop periodically so the UI stays
 * responsive. Returns the nonce, or throws if the bound is exceeded.
 */
export async function computeVotePow(
  pubkey: string,
  pollId: string,
  createdAt: number,
  difficulty: number = VOTE_POW_DIFFICULTY,
): Promise<number> {
  const prefix = votePowPrefix(pubkey, pollId, createdAt);
  for (let nonce = 0; nonce < MAX_SOLVE_ITERATIONS; nonce++) {
    if (countLeadingZeroBits(CryptoService.hash(prefix + nonce.toString())) >= difficulty) {
      return nonce;
    }
    if (nonce % SOLVER_YIELD_EVERY === 0 && nonce > 0) {
      await new Promise<void>((r) => setTimeout(r, 0));
    }
  }
  throw new Error(`vote PoW not found within ${MAX_SOLVE_ITERATIONS} iterations`);
}
