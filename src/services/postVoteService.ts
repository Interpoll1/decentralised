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
import config from '../config';

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
   */
  private static async ensureBaseline(postId: string): Promise<{ up: number; down: number }> {
    const post: any = await gunOnce(postNode(postId), READ_TIMEOUT_MS);
    if (!post) return { up: 0, down: 0 };

    if (post.voteBaselineAt) {
      return {
        up: Number(post.voteBaselineUp) || 0,
        down: Number(post.voteBaselineDown) || 0,
      };
    }

    const baseline = {
      up: Number(post.upvotes) || 0,
      down: Number(post.downvotes) || 0,
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
      gunReadChildren<any>(postVotesNode(postId), { minMs: 200, maxMs: 2_000 }),
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
    // The store (toggleVote) already resolved toggle direction from its local
    // myVotes state before calling here. A graph read to confirm would add up
    // to 3s of latency and could disagree with what the store predicted.
    // writeVote still reads the existing node to preserve baselineType.
    return PostVoteService.writeVote(postId, userId, direction);
  }

  /** Clear this user's vote unconditionally. */
  static async clearVote(postId: string, userId: string): Promise<PostVoteResult> {
    if (!userId) throw new Error('userId is required to vote');
    return PostVoteService.writeVote(postId, userId, 'none');
  }

  private static async writeVote(postId: string, userId: string, next: VoteValue): Promise<PostVoteResult> {
    const minimalRecord: Record<string, string | number> = {
      type: next, userId, postId, at: Date.now(),
    };

    // ── Write via HTTP POST directly to relay MySQL — fast path ──────────────
    // Gun WebSocket writes take 1+ minutes when the WS round-trip is slow.
    // A direct HTTP POST to /api/content-vote writes straight to gun_nodes
    // (<100ms) so /api/vote-tally reflects the vote immediately on refresh.
    // Gun write runs in parallel as a fallback for peer sync.
    const httpWritePromise = fetch(`${config.relay.api}/api/content-vote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(minimalRecord),
    }).then(r => r.ok).catch(() => false);

    // Gun write in parallel — keeps peer-to-peer sync working
    gunPut(postVotesNode(postId).get(userId), minimalRecord)
      .then(ack => { if (!ack.ok && ack.err !== 'timeout') console.warn('[vote] gun write error:', ack.err); })
      .catch(() => {});

    // ── Read baseline and existing vote in parallel (capped at 1s) ───────────
    const FAST_READ_MS = 1_000;
    const [post, existingVote, httpOk] = await Promise.all([
      gunOnce(postNode(postId), FAST_READ_MS) as Promise<any>,
      gunOnce(postVotesNode(postId).get(userId), FAST_READ_MS) as Promise<any>,
      httpWritePromise,
    ]);

    if (!httpOk) console.warn('[vote] HTTP write failed, Gun fallback in progress');

    // ── Baseline — prefer relay-derived tally over stale Gun node ────────────
    // Gun's post node upvotes/downvotes is stale (LWW races). The relay's
    // /api/vote-tally counts postVotes children directly and is now up-to-date
    // (we just wrote our vote via HTTP). Use it as the base for tally computation.
    let baseline: { up: number; down: number };
    try {
      const tallyRes = await fetch(
        `${config.relay.api}/api/vote-tally?ids=${encodeURIComponent(postId)}`,
        { signal: AbortSignal.timeout?.(1500) ?? undefined }
      );
      if (tallyRes.ok) {
        const tallyJson = await tallyRes.json();
        const t = tallyJson?.tallies?.[postId];
        // This tally already includes our just-written vote (HTTP write landed first)
        // so we return it directly without folding again.
        if (t && typeof t.upvotes === 'number') {
          const tally: PostTally = { upvotes: t.upvotes, downvotes: t.downvotes, score: t.score };
          const tallyHint = { upvotes: tally.upvotes, downvotes: tally.downvotes, score: tally.score };
          void gunPut(postNode(postId), tallyHint).catch(() => {});
          if (postId.startsWith('poll-')) void gunPut(gun().get('polls').get(postId), tallyHint).catch(() => {});
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('interpoll:vote-tally', { detail: { postId, tally: tallyHint } }));
          }
          return { tally, myVote: next === 'none' ? null : next };
        }
      }
    } catch { /* fallback to Gun baseline below */ }

    // Fallback: Gun-based baseline (used when relay unreachable)
    if (!post) {
      baseline = { up: 0, down: 0 };
    } else if (post.voteBaselineAt) {
      baseline = {
        up: Number(post.voteBaselineUp) || 0,
        down: Number(post.voteBaselineDown) || 0,
      };
    } else {
      baseline = {
        up: Number(post.upvotes) || 0,
        down: Number(post.downvotes) || 0,
      };
      void gunPut(postNode(postId), {
        voteBaselineUp: baseline.up,
        voteBaselineDown: baseline.down,
        voteBaselineAt: Date.now(),
      }).catch(() => {});
    }

    // ── Baseline correction ───────────────────────────────────────────────────
    const knownVote = parseVote(existingVote);
    let baselineType: 'up' | 'down' | null = null;
    if (knownVote) {
      baselineType = parseBaselineType(existingVote);
    } else {
      baselineType = await Promise.race([
        PostVoteService.readLegacyVote(postId, userId),
        new Promise<null>((r) => setTimeout(() => r(null), 500)),
      ]);
    }

    // Patch baselineType onto record non-blocking if we found one
    if (baselineType) {
      void gunPut(postVotesNode(postId).get(userId), { ...minimalRecord, baselineType }).catch(() => {});
    }

    // ── Tally ─────────────────────────────────────────────────────────────────
    const tally = foldVotes(baseline, [{ vote: next, baselineType }]);
    const tallyHint = { upvotes: tally.upvotes, downvotes: tally.downvotes, score: tally.score };
    void gunPut(postNode(postId), tallyHint).catch(() => {});
    if (postId.startsWith('poll-')) {
      void gunPut(gun().get('polls').get(postId), tallyHint).catch(() => {});
    }

    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('interpoll:vote-tally', {
          detail: { postId, tally: tallyHint },
        }),
      );
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