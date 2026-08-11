/**
 * Post upvote/downvote tallies, derived from per-user vote nodes.
 *
 * The old scheme stored `upvotes`/`downvotes` as mutable numbers on the post and
 * updated them read-modify-write. Under Gun's last-write-wins semantics two
 * people voting within one round trip both read N and both wrote N+1, so a vote
 * silently vanished; a slow read fell back to a stale REST snapshot and reverted
 * votes that had already landed. No amount of local caching fixes that — the
 * data model was the bug.
 *
 * Here a vote is a node keyed by user id under `postVotes/{postId}/{userId}`.
 * Distinct keys never contend, so concurrent voters cannot clobber each other,
 * and the total is *derived* by counting rather than stored. This mirrors the
 * scheme `commentService` already uses for comment votes.
 *
 * Clearing a vote writes an explicit `'none'` rather than deleting the node:
 * Gun deletes (`put(null)`) do not propagate reliably, and the old toggle-off
 * path relied on exactly that.
 *
 * ── Legacy counters ──────────────────────────────────────────────────────────
 * Posts that predate this change carry totals no vote node accounts for. The
 * first time anyone votes on such a post we freeze those counters onto it as an
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

export type VoteType = 'up' | 'down';
/** `'none'` is a cleared vote — an explicit tombstone, not a Gun delete. */
export type VoteValue = VoteType | 'none';

export interface PostTally {
  upvotes: number;
  downvotes: number;
  score: number;
}

export interface PostVoteResult {
  tally: PostTally;
  /** What this user's vote *actually* is now, per the graph — not what the UI guessed. */
  myVote: VoteType | null;
}

interface VoteNode {
  type?: unknown;
  /** Set when this user's pre-migration vote is already counted in the baseline. */
  baselineType?: unknown;
}

const READ_TIMEOUT_MS = 3_000;

function gun() {
  return GunService.getGun();
}

function postNode(postId: string) {
  return gun().get('posts').get(postId);
}

function postVotesNode(postId: string) {
  return gun().get('postVotes').get(postId);
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

function toTally(upvotes: number, downvotes: number): PostTally {
  const up = Math.max(0, upvotes);
  const down = Math.max(0, downvotes);
  return { upvotes: up, downvotes: down, score: up - down };
}

/** Fold a set of vote nodes onto a frozen baseline. Pure — the whole counting rule lives here. */
export function foldVotes(
  baseline: { up: number; down: number },
  nodes: Iterable<{ vote: VoteValue | null; baselineType: VoteType | null }>,
): PostTally {
  let up = baseline.up;
  let down = baseline.down;
  for (const { vote, baselineType } of nodes) {
    // This user's old vote is inside the baseline; remove it before applying the new one.
    if (baselineType === 'up') up -= 1;
    else if (baselineType === 'down') down -= 1;
    if (vote === 'up') up += 1;
    else if (vote === 'down') down += 1;
  }
  return toTally(up, down);
}

export class PostVoteService {
  /**
   * Read the post's frozen baseline, freezing it from the legacy counters on
   * first touch. `voteBaselineAt` is the guard: once present the baseline is
   * never rewritten, so later mirror-writes of `upvotes` cannot disturb it.
   *
   * Must stamp `voteBaselineAt` on the *first* vote unconditionally — including
   * when the post does not exist in the graph yet, freezing a `{0, 0}`
   * baseline. The old code returned an *unwritten* `{0, 0}` early for a
   * brand-new post without ever setting the guard. `writeVote` then left an
   * advisory `upvotes: 1` hint sitting on the post node afterward with no
   * `voteBaselineAt` to mark it as a hint rather than legacy data — so the
   * very next vote (from anyone) froze that hint as if it were a pre-existing
   * count, baking in a phantom vote nobody cast. Writing the guard here,
   * before any hint can land, closes that window.
   */
  private static async ensureBaseline(postId: string): Promise<{ up: number; down: number }> {
    const post: any = await gunOnce(postNode(postId), READ_TIMEOUT_MS);

    if (post?.voteBaselineAt) {
      return {
        up: Number(post.voteBaselineUp) || 0,
        down: Number(post.voteBaselineDown) || 0,
      };
    }

    const baseline = {
      up: Number(post?.upvotes) || 0,
      down: Number(post?.downvotes) || 0,
    };
    await gunPut(postNode(postId), {
      voteBaselineUp: baseline.up,
      voteBaselineDown: baseline.down,
      voteBaselineAt: Date.now(),
    });
    return baseline;
  }

  private static async readBaseline(postId: string): Promise<{ up: number; down: number }> {
    const post: any = await gunOnce(postNode(postId), READ_TIMEOUT_MS);
    if (!post) return { up: 0, down: 0 };
    // No baseline frozen yet means nobody has voted under this scheme, so the
    // legacy counters are still the whole truth.
    if (!post.voteBaselineAt) {
      return { up: Number(post.upvotes) || 0, down: Number(post.downvotes) || 0 };
    }
    return {
      up: Number(post.voteBaselineUp) || 0,
      down: Number(post.voteBaselineDown) || 0,
    };
  }

  /** This user's vote as the graph has it. Falls back to the pre-migration key. */
  static async getMyVote(postId: string, userId: string): Promise<VoteType | null> {
    if (!userId) return null;
    const raw = await gunOnce(postVotesNode(postId).get(userId), READ_TIMEOUT_MS);
    const vote = parseVote(raw);
    if (vote) return vote === 'none' ? null : vote;
    return PostVoteService.readLegacyVote(postId, userId);
  }

  /** The pre-migration vote record, `votes/vote_{userId}_{postId}`. Read-only now. */
  private static async readLegacyVote(postId: string, userId: string): Promise<VoteType | null> {
    const raw: any = await gunOnce(gun().get('votes').get(`vote_${userId}_${postId}`), READ_TIMEOUT_MS);
    const type = raw?.type;
    return type === 'up' || type === 'down' ? type : null;
  }

  static async getTally(postId: string): Promise<PostTally> {
    const [baseline, children] = await Promise.all([
      PostVoteService.readBaseline(postId),
      gunReadChildren<any>(postVotesNode(postId), { minMs: 300, maxMs: 4_000 }),
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
  static async castVote(postId: string, userId: string, direction: VoteType): Promise<PostVoteResult> {
    if (!userId) throw new Error('userId is required to vote');
    const current = await PostVoteService.getMyVote(postId, userId);
    const next: VoteValue = current === direction ? 'none' : direction;
    return PostVoteService.writeVote(postId, userId, next);
  }

  /** Clear this user's vote unconditionally. */
  static async clearVote(postId: string, userId: string): Promise<PostVoteResult> {
    if (!userId) throw new Error('userId is required to vote');
    return PostVoteService.writeVote(postId, userId, 'none');
  }

  private static async writeVote(postId: string, userId: string, next: VoteValue): Promise<PostVoteResult> {
    const baseline = await PostVoteService.ensureBaseline(postId);

    // Preserve any baseline correction already recorded for this user; only
    // discover it from the legacy key the first time we write their node.
    const existing = await gunOnce(postVotesNode(postId).get(userId), READ_TIMEOUT_MS);
    const baselineType = parseVote(existing)
      ? parseBaselineType(existing)
      : await PostVoteService.readLegacyVote(postId, userId);

    const record: Record<string, string | number> = {
      type: next,
      userId,
      postId,
      at: Date.now(),
    };
    if (baselineType) record.baselineType = baselineType;

    const ack = await gunPut(postVotesNode(postId).get(userId), record);
    // 'timeout' means Gun wrote locally but didn't get a relay ack within 8s.
    // This is acceptable — Gun will sync when the relay reconnects.
    // Only throw on explicit Gun error responses (network rejection, auth failure).
    if (!ack.ok && ack.err !== 'timeout') throw new Error(ack.err || 'Vote could not be recorded');

    const children = await gunReadChildren<any>(postVotesNode(postId), { minMs: 300, maxMs: 4_000 });
    const folded = new Map(children.map(({ key, value }) => [key, value]));
    // Our own write may not have echoed back yet — count it from what we sent.
    folded.set(userId, record);
    const tally = foldVotes(
      baseline,
      [...folded.values()].map((value) => ({ vote: parseVote(value), baselineType: parseBaselineType(value) })),
    );

    // Advisory mirror for readers that render a post before its vote set loads.
    // Never authoritative — every read path here prefers the derived tally.
    // Update vote counters on the post/poll node (hint — non-blocking)
    const tallyHint = { upvotes: tally.upvotes, downvotes: tally.downvotes, score: tally.score };
    void gunPut(postNode(postId), tallyHint).catch(() => {});
    // For poll IDs, also update the polls path so the poll's displayed score stays current
    if (postId.startsWith('poll-')) {
      void gunPut(gun().get('polls').get(postId), tallyHint).catch(() => {});
    }

    return { tally, myVote: next === 'none' ? null : next };
  }

  /**
   * Live tally for one post. Emits on every vote change from any peer.
   *
   * The baseline is read once up front; it is immutable by construction, so a
   * later post-node echo carrying stale counters cannot move the total. That is
   * what the store's 15s "grace window" was working around.
   */
  static subscribeTally(postId: string, callback: (tally: PostTally) => void): () => void {
    let active = true;
    let baseline = { up: 0, down: 0 };
    const votes = new Map<string, { vote: VoteValue | null; baselineType: VoteType | null }>();

    const emit = () => {
      if (!active) return;
      callback(foldVotes(baseline, votes.values()));
    };

    void PostVoteService.readBaseline(postId).then((value) => {
      if (!active) return;
      baseline = value;
      emit();
    });

    let chain: any = null;
    const attach = () => {
      if (!active) return;
      chain = postVotesNode(postId).map().on((value: any, key: string) => {
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
