/**
 * Poll content upvote/downvote (heart) tallies, derived from per-user vote nodes.
 *
 * This mirrors `postVoteService.ts` exactly, and for the same reason: the old
 * scheme stored `upvotes`/`downvotes` as mutable numbers on the poll and updated
 * them read-modify-write (`PollService.voteOnPollContent` read the poll, added
 * or subtracted 1 in JS, then wrote the new number back). Under Gun's
 * last-write-wins semantics two people hearting/downvoting within one round
 * trip both read N and both wrote N+1, so one vote silently vanished — the
 * "likes/hearts/downvotes seem broken" behaviour. No amount of local caching
 * fixes that; the data model was the bug, exactly as it was for posts before
 * `postVoteService.ts` existed.
 *
 * Here a vote is a node keyed by user id under `pollVotes/{pollId}/{userId}`.
 * Distinct keys never contend, so concurrent voters cannot clobber each other,
 * and the total is *derived* by counting rather than stored.
 *
 * Clearing a vote writes an explicit `'none'` rather than deleting the node:
 * Gun deletes (`put(null)`) do not propagate reliably, and a toggle-off that
 * relied on that would resurrect on the next peer sync.
 *
 * ── Legacy counters ──────────────────────────────────────────────────────────
 * Polls that predate this change carry totals no vote node accounts for, and a
 * legacy vote may already exist at the old shared key
 * `votes/vote_{userId}_poll_{pollId}`. The first time anyone votes on such a
 * poll under this scheme we freeze the existing counters onto it as an
 * immutable baseline (`voteBaselineUp`/`voteBaselineDown`, guarded by
 * `voteBaselineAt`) and report `baseline + derived`. Because the baseline is
 * written once and never mutated, it reintroduces no read-modify-write race.
 *
 * A user who had voted under the *old* scheme is already inside that baseline.
 * Their new vote node records `baselineType`, and the tally subtracts one from
 * the baseline for it — so migrating a vote nets zero, clearing it nets -1, and
 * flipping it moves one across. The correction is per-user keyed, so it is as
 * contention-free as the votes themselves.
 */

import { GunService } from './gunService';
import { gunPut, gunOnce, gunReadChildren } from '../utils/gunAsync';
import { foldVotes, type VoteType, type VoteValue, type PostTally } from './postVoteService';

export type PollContentVoteType = VoteType;
export type PollContentTally = PostTally;

export interface PollContentVoteResult {
  tally: PollContentTally;
  /** What this user's vote *actually* is now, per the graph — not what the UI guessed. */
  myVote: PollContentVoteType | null;
}

interface VoteNode {
  type?: unknown;
  baselineType?: unknown;
}

const READ_TIMEOUT_MS = 3_000;

function gun() {
  return GunService.getGun();
}

function pollNode(pollId: string) {
  return gun().get('polls').get(pollId);
}

function communityPollNode(pollId: string, communityId?: string) {
  return communityId ? gun().get('communities').get(communityId).get('polls').get(pollId) : null;
}

function pollVotesNode(pollId: string) {
  return gun().get('pollVotes').get(pollId);
}

function parseVote(raw: unknown): VoteValue | null {
  if (!raw || typeof raw !== 'object') return null;
  const type = (raw as VoteNode).type;
  return type === 'up' || type === 'down' || type === 'none' ? type : null;
}

function parseBaselineType(raw: unknown): VoteType | null {
  if (!raw || typeof raw !== 'object') return null;
  const type = (raw as VoteNode).baselineType;
  return type === 'up' || type === 'down' ? type : null;
}

export class PollContentVoteService {
  /**
   * Read the poll's frozen baseline, freezing it from the legacy counters (and
   * the legacy shared vote key, if any) on first touch. `voteBaselineAt` is the
   * guard: once present the baseline is never rewritten, so a later poll-node
   * echo carrying stale counters cannot disturb it.
   *
   * Must stamp `voteBaselineAt` on the *first* vote unconditionally — including
   * when the poll does not exist in the graph yet, freezing a `{0, 0}`
   * baseline. Returning early without writing the guard for a brand-new poll
   * leaves a window where `writeVote`'s advisory `upvotes` hint (written after
   * the vote lands) can be mistaken for a real legacy count on the very next
   * vote, baking in a phantom vote nobody cast. Writing the guard here, before
   * any hint can land, closes that window. Mirrors the same fix in
   * `postVoteService.ts`.
   */
  private static async ensureBaseline(pollId: string): Promise<{ up: number; down: number }> {
    const poll: any = await gunOnce(pollNode(pollId), READ_TIMEOUT_MS);

    if (poll?.voteBaselineAt) {
      return {
        up: Number(poll.voteBaselineUp) || 0,
        down: Number(poll.voteBaselineDown) || 0,
      };
    }

    const baseline = {
      up: Number(poll?.upvotes) || 0,
      down: Number(poll?.downvotes) || 0,
    };
    await gunPut(pollNode(pollId), {
      voteBaselineUp: baseline.up,
      voteBaselineDown: baseline.down,
      voteBaselineAt: Date.now(),
    });
    return baseline;
  }

  private static async readBaseline(pollId: string): Promise<{ up: number; down: number }> {
    const poll: any = await gunOnce(pollNode(pollId), READ_TIMEOUT_MS);
    if (!poll) return { up: 0, down: 0 };
    // No baseline frozen yet means nobody has voted under this scheme, so the
    // legacy counters are still the whole truth.
    if (!poll.voteBaselineAt) {
      return { up: Number(poll.upvotes) || 0, down: Number(poll.downvotes) || 0 };
    }
    return {
      up: Number(poll.voteBaselineUp) || 0,
      down: Number(poll.voteBaselineDown) || 0,
    };
  }

  /** This user's vote as the graph has it. Falls back to the pre-migration shared key. */
  static async getMyVote(pollId: string, userId: string): Promise<PollContentVoteType | null> {
    if (!userId) return null;
    const raw = await gunOnce(pollVotesNode(pollId).get(userId), READ_TIMEOUT_MS);
    const vote = parseVote(raw);
    if (vote) return vote === 'none' ? null : vote;
    return PollContentVoteService.readLegacyVote(pollId, userId);
  }

  /** The pre-migration vote record, `votes/vote_{userId}_poll_{pollId}`. Read-only now. */
  private static async readLegacyVote(pollId: string, userId: string): Promise<PollContentVoteType | null> {
    const raw: any = await gunOnce(gun().get('votes').get(`vote_${userId}_poll_${pollId}`), READ_TIMEOUT_MS);
    const type = raw?.type;
    return type === 'up' || type === 'down' ? type : null;
  }

  static async getTally(pollId: string): Promise<PollContentTally> {
    const [baseline, children] = await Promise.all([
      PollContentVoteService.readBaseline(pollId),
      gunReadChildren<any>(pollVotesNode(pollId), { minMs: 300, maxMs: 4_000 }),
    ]);
    return foldVotes(
      baseline,
      children.map(({ value }) => ({ vote: parseVote(value), baselineType: parseBaselineType(value) })),
    );
  }

  /**
   * Set this user's vote to `direction`, or clear it if that is already their
   * vote (the toggle). Returns the recomputed tally *and* the resulting vote, so
   * callers reconcile against what happened rather than what they predicted.
   */
  static async castVote(
    pollId: string,
    userId: string,
    direction: PollContentVoteType,
    communityId?: string,
  ): Promise<PollContentVoteResult> {
    if (!userId) throw new Error('userId is required to vote');
    const current = await PollContentVoteService.getMyVote(pollId, userId);
    const next: VoteValue = current === direction ? 'none' : direction;
    return PollContentVoteService.writeVote(pollId, userId, next, communityId);
  }

  /** Clear this user's vote unconditionally. */
  static async clearVote(pollId: string, userId: string, communityId?: string): Promise<PollContentVoteResult> {
    if (!userId) throw new Error('userId is required to vote');
    return PollContentVoteService.writeVote(pollId, userId, 'none', communityId);
  }

  private static async writeVote(
    pollId: string,
    userId: string,
    next: VoteValue,
    communityId?: string,
  ): Promise<PollContentVoteResult> {
    const baseline = await PollContentVoteService.ensureBaseline(pollId);

    // Preserve any baseline correction already recorded for this user; only
    // discover it from the legacy key the first time we write their node.
    const existing = await gunOnce(pollVotesNode(pollId).get(userId), READ_TIMEOUT_MS);
    const baselineType = parseVote(existing)
      ? parseBaselineType(existing)
      : await PollContentVoteService.readLegacyVote(pollId, userId);

    const record: Record<string, string | number> = {
      type: next,
      userId,
      pollId,
      at: Date.now(),
    };
    if (baselineType) record.baselineType = baselineType;

    const ack = await gunPut(pollVotesNode(pollId).get(userId), record);
    // 'timeout' means Gun wrote locally but didn't get a relay ack within 8s.
    // This is acceptable — Gun will sync when the relay reconnects.
    // Only throw on explicit Gun error responses (network rejection, auth failure).
    if (!ack.ok && ack.err !== 'timeout') throw new Error(ack.err || 'Vote could not be recorded');

    const children = await gunReadChildren<any>(pollVotesNode(pollId), { minMs: 300, maxMs: 4_000 });
    const folded = new Map(children.map(({ key, value }) => [key, value]));
    // Our own write may not have echoed back yet — count it from what we sent.
    folded.set(userId, record);
    const tally = foldVotes(
      baseline,
      [...folded.values()].map((value) => ({ vote: parseVote(value), baselineType: parseBaselineType(value) })),
    );

    // Advisory mirror for readers that render a poll before its vote set loads.
    // Never authoritative — every read path here prefers the derived tally.
    const tallyHint = { upvotes: tally.upvotes, downvotes: tally.downvotes, score: tally.score };
    void gunPut(pollNode(pollId), tallyHint).catch(() => {});
    const communityNode = communityPollNode(pollId, communityId);
    if (communityNode) void gunPut(communityNode, tallyHint).catch(() => {});

    return { tally, myVote: next === 'none' ? null : next };
  }

  /**
   * Live tally for one poll. Emits on every vote change from any peer.
   *
   * The baseline is read once up front; it is immutable by construction, so a
   * later poll-node echo carrying stale counters cannot move the total.
   */
  static subscribeTally(pollId: string, callback: (tally: PollContentTally) => void): () => void {
    let active = true;
    let baseline = { up: 0, down: 0 };
    const votes = new Map<string, { vote: VoteValue | null; baselineType: VoteType | null }>();

    const emit = () => {
      if (!active) return;
      callback(foldVotes(baseline, votes.values()));
    };

    void PollContentVoteService.readBaseline(pollId).then((value) => {
      if (!active) return;
      baseline = value;
      emit();
    });

    let chain: any = null;
    const attach = () => {
      if (!active) return;
      chain = pollVotesNode(pollId).map().on((value: any, key: string) => {
        if (!active || typeof key !== 'string') return;
        votes.set(key, { vote: parseVote(value), baselineType: parseBaselineType(value) });
        emit();
      });
    };

    const detach = () => {
      try { chain?.off?.(); } catch { /* already detached */ }
      chain = null;
    };

    attach();
    const offReconnect = GunService.onReconnect(() => {
      if (!active) return;
      detach();
      attach();
    });

    return () => {
      active = false;
      offReconnect();
      detach();
    };
  }
}
