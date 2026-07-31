/**
 * useVerifiedPollResults — single trusted source for poll results display.
 *
 * Poll counts in the Gun graph are forgeable: any peer/relay can `put` an
 * inflated `totalVotes` / `option.votes`. Meanwhile every vote is also a
 * Schnorr-signed kind-101 event that `VoteTallyService` aggregates into a
 * per-signer-deduped tally. This composable makes that signed tally the trust
 * anchor for what the UI shows, and consolidates the three previously-duplicated
 * inline percent/total/sort implementations (PollCard, PollDetailPage,
 * ResultsPage) into one place.
 *
 * Trust is anchored at the **poll total**, which is reliable today (deduped by
 * signer). Per-option verified attribution requires the vote event to carry an
 * `option` tag — populated going forward for single-choice votes (see
 * chainStore.addVote), but not for older votes or multi-choice — so per-option
 * *bars* are still drawn from Gun proportions and simply inherit the poll-level
 * trust state rather than claiming per-option verification.
 *
 * Reactivity: VoteTallyService is a plain static store, so the computeds read
 * `poll.totalVotes` to re-evaluate whenever Gun data changes — the signed events
 * that back a vote typically arrive around the same time as the Gun count-write.
 */

import { computed, toValue, type ComputedRef, type MaybeRefOrGetter } from 'vue';
import type { Poll, PollOption, VoteTrustPolicy } from '@/types/poll';
import { VoteTallyService, type PollTrustState, type TieredTally } from '@/services/voteTallyService';
import type { RequiredTier } from '@/services/voteTierService';

/** One result track (Verified or Open) derived from the signed-event tally. */
export interface PollTrack {
  /** Distinct voters in this track. */
  total: ComputedRef<number>;
  /** Signed votes for a given option within this track. */
  count: (option: PollOption) => number;
  /** Bar width 0–100 relative to this track's total. */
  percent: (option: PollOption) => number;
  /** Options ordered by this track's vote count, highest first. */
  sortedOptions: ComputedRef<PollOption[]>;
}

export interface VerifiedPollResults {
  // ── CRITICAL-2 single-track fields (forgery resistance) ──
  /** Trust state of the displayed total vs. the signed lower bound. */
  trust: ComputedRef<PollTrustState>;
  /** Signature-verified distinct-voter count that reached this client (lower bound). */
  verifiedTotal: ComputedRef<number>;
  /** Raw, forgeable total from Gun. */
  reportedTotal: ComputedRef<number>;
  /**
   * Total to headline. Equals the Gun total, except when it reads as `inflated`
   * — then it collapses to the proven verified floor so a forged surplus can't
   * be presented as fact.
   */
  displayTotal: ComputedRef<number>;
  /** Options ordered by (Gun) vote count, highest first. */
  sortedOptions: ComputedRef<PollOption[]>;
  /** Percentage width for an option's results bar, 0–100. */
  percent: (option: PollOption) => number;

  // ── Sybil-resistance tiered fields ──
  /** The poll's effective policy (defaulted for legacy polls). */
  policy: ComputedRef<VoteTrustPolicy>;
  /** True when the creator requires more than an anonymous signature. */
  policyActive: ComputedRef<boolean>;
  /** Voters whose tier meets the required tier. */
  verified: PollTrack;
  /** Voters who did not meet the required tier (potentially-Sybil / unverified). */
  open: PollTrack;
}

const DEFAULT_POLICY: VoteTrustPolicy = { requiredTier: 'open', mode: 'separate' };

export function useVerifiedPollResults(
  pollSource: MaybeRefOrGetter<Poll | null | undefined>,
): VerifiedPollResults {
  const pollId = computed(() => toValue(pollSource)?.id ?? '');
  const options = computed<PollOption[]>(() => toValue(pollSource)?.options ?? []);

  // Prefer the poll's own reported total; fall back to summing option votes when
  // absent (some callers only carry per-option counts).
  const reportedTotal = computed(() => {
    const poll = toValue(pollSource);
    if (!poll) return 0;
    if (typeof poll.totalVotes === 'number') return poll.totalVotes;
    return options.value.reduce((sum, o) => sum + (o.votes || 0), 0);
  });

  const verifiedTotal = computed(() => {
    void reportedTotal.value; // re-read the (non-reactive) tally when Gun data moves
    return VoteTallyService.getVerifiedTotal(pollId.value);
  });

  const trust = computed<PollTrustState>(() =>
    VoteTallyService.trustState(pollId.value, reportedTotal.value),
  );

  const displayTotal = computed(() =>
    trust.value === 'inflated' ? verifiedTotal.value : reportedTotal.value,
  );

  const sortedOptions = computed(() =>
    [...options.value].sort((a, b) => (b.votes || 0) - (a.votes || 0)),
  );

  // Bars are proportional to the displayed total so an inflated poll's bars and
  // headline agree. Guard divide-by-zero.
  const percent = (option: PollOption): number => {
    const denom = displayTotal.value;
    if (denom <= 0) return 0;
    return Math.min(100, ((option.votes || 0) / denom) * 100);
  };

  // ── Tiered tracks ──
  const policy = computed<VoteTrustPolicy>(() => toValue(pollSource)?.voteTrustPolicy ?? DEFAULT_POLICY);
  const policyActive = computed(() => policy.value.requiredTier !== 'open');

  const tiered = computed<TieredTally>(() => {
    void reportedTotal.value; // re-read the non-reactive tally when Gun data moves
    return VoteTallyService.getTieredTally(pollId.value, policy.value.requiredTier as RequiredTier);
  });

  // A track counts a poll option by its id (new votes tag the option id) or, for
  // legacy votes, by its display text — matching VoteTallyService's optionKey rule.
  const buildTrack = (pick: (t: TieredTally) => { byOption: Record<string, number>; total: number }): PollTrack => {
    const total = computed(() => pick(tiered.value).total);
    const count = (option: PollOption): number => {
      const byOption = pick(tiered.value).byOption;
      return (byOption[option.id] || 0) + (option.id !== option.text ? (byOption[option.text] || 0) : 0);
    };
    const percentFn = (option: PollOption): number => {
      const denom = total.value;
      if (denom <= 0) return 0;
      return Math.min(100, (count(option) / denom) * 100);
    };
    const sorted = computed(() => [...options.value].sort((a, b) => count(b) - count(a)));
    return { total, count, percent: percentFn, sortedOptions: sorted };
  };

  const verified = buildTrack((t) => t.verified);
  const open = buildTrack((t) => t.open);

  return {
    trust, verifiedTotal, reportedTotal, displayTotal, sortedOptions, percent,
    policy, policyActive, verified, open,
  };
}

export default useVerifiedPollResults;
