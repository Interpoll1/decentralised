/**
 * The derived up/down vote tally, shared by posts and polls.
 *
 * The old scheme stored `upvotes`/`downvotes` as mutable numbers on the content
 * node and updated them read-modify-write. Under Gun's last-write-wins semantics
 * two people voting within one round trip both read N and both wrote N+1, so a
 * vote silently vanished; a slow read fell back to a stale snapshot and reverted
 * votes that had already landed. No amount of local caching fixes that — the
 * data model was the bug.
 *
 * Here a vote is a node keyed by user id under `<votesRoot>/{contentId}/{userId}`.
 * Distinct keys never contend, so concurrent voters cannot clobber each other,
 * and the total is *derived* by counting rather than stored.
 *
 * Clearing a vote writes an explicit `'none'` rather than deleting the node:
 * Gun deletes (`put(null)`) do not propagate reliably, and the old toggle-off
 * paths relied on exactly that.
 *
 * ── Legacy counters ──────────────────────────────────────────────────────────
 * Content that predates this change carries totals no vote node accounts for.
 * The first time anyone votes we freeze those counters onto it as an immutable
 * baseline (`voteBaselineUp`/`voteBaselineDown`, guarded by `voteBaselineAt`)
 * and report `baseline + derived`. Because the baseline is written once and
 * never mutated, it reintroduces no read-modify-write race.
 *
 * A user who had voted under the *old* scheme is already inside that baseline.
 * Their new vote node records `baselineType`, and the tally subtracts one from
 * the baseline for it — so migrating a vote nets zero, clearing it nets -1, and
 * flipping it moves one across. The correction is per-user keyed, so it is as
 * contention-free as the votes themselves.
 *
 * ── An unreadable baseline is not a zero baseline ────────────────────────────
 * `gunOnce` resolves `null` on timeout, which is indistinguishable from "no
 * counters" unless we make it so. Folding a timed-out read as zero collapsed the
 * total to the derived votes alone and restored it on the next good read — the
 * single most visible source of a jumping count. "Unknown" is `null` here and
 * every caller handles it explicitly.
 */

import { gunPut, gunOnce, gunReadChildren } from '../utils/gunAsync';

export type VoteType = 'up' | 'down';
/** `'none'` is a cleared vote — an explicit tombstone, not a Gun delete. */
export type VoteValue = VoteType | 'none';

export interface VoteTally {
  upvotes: number;
  downvotes: number;
  score: number;
}

export interface VoteResult {
  tally: VoteTally;
  /** What this user's vote *actually* is now, per the graph — not what the UI guessed. */
  myVote: VoteType | null;
  /**
   * False when the baseline could not be read, so `tally` counts the vote nodes
   * alone and is missing any legacy total. The vote itself still landed; callers
   * should keep their existing counts rather than adopt this one, or they will
   * show a number that drops and then comes back.
   */
  tallyAuthoritative: boolean;
  /**
   * False when no peer acked the write within the timeout. The record is in the
   * local graph and queued for the peers regardless, so the vote is *not* an
   * error — it is simply unconfirmed, and `tally` is advisory.
   */
  confirmed: boolean;
}

export interface Baseline {
  up: number;
  down: number;
}

interface VoteNode {
  type?: unknown;
  /** Set when this user's pre-migration vote is already counted in the baseline. */
  baselineType?: unknown;
}

const READ_TIMEOUT_MS = 3_000;

export interface DerivedVoteTallyConfig {
  /** The content node carrying the legacy counters and the frozen baseline. */
  contentNode: (contentId: string) => any;
  /** The per-user vote set: `<votesRoot>/{contentId}`. */
  votesNode: (contentId: string) => any;
  /** The pre-migration single-vote record, if this content type had one. */
  legacyVoteNode?: (contentId: string, userId: string) => any;
  /**
   * Where to mirror the tally as an advisory hint. Never authoritative — every
   * read path prefers the derived tally — but it lets a client paint a number
   * before the vote set loads. Polls carry a second copy under the community.
   */
  mirrorNodes?: (contentId: string) => Promise<any[]> | any[];
  /** Reconnect hook, so a live subscription re-attaches after a drop. */
  onReconnect?: (handler: () => void) => () => void;
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

function toTally(upvotes: number, downvotes: number): VoteTally {
  const up = Math.max(0, upvotes);
  const down = Math.max(0, downvotes);
  return { upvotes: up, downvotes: down, score: up - down };
}

/** Fold a set of vote nodes onto a frozen baseline. Pure — the whole counting rule lives here. */
export function foldVotes(
  baseline: Baseline,
  nodes: Iterable<{ vote: VoteValue | null; baselineType: VoteType | null }>,
): VoteTally {
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

export interface DerivedVoteTally {
  getMyVote(contentId: string, userId: string): Promise<VoteType | null>;
  getTally(contentId: string): Promise<VoteTally>;
  castVote(contentId: string, userId: string, direction: VoteType): Promise<VoteResult>;
  clearVote(contentId: string, userId: string): Promise<VoteResult>;
  subscribeTally(contentId: string, callback: (tally: VoteTally) => void): () => void;
}

export function createDerivedVoteTally(config: DerivedVoteTallyConfig): DerivedVoteTally {
  const { contentNode, votesNode, legacyVoteNode, mirrorNodes, onReconnect } = config;

  /** The pre-migration vote record. Read-only now. */
  async function readLegacyVote(contentId: string, userId: string): Promise<VoteType | null> {
    if (!legacyVoteNode) return null;
    const raw: any = await gunOnce(legacyVoteNode(contentId, userId), READ_TIMEOUT_MS);
    const type = raw?.type;
    return type === 'up' || type === 'down' ? type : null;
  }

  /**
   * Read the frozen baseline, freezing it from the legacy counters on first
   * touch. `voteBaselineAt` is the guard: once present the baseline is never
   * rewritten, so later mirror-writes of `upvotes` cannot disturb it.
   *
   * Returns `null` when the content node did not arrive — freezing a 0 baseline
   * there would erase a legacy total permanently, since the freeze is by design
   * never rewritten.
   */
  async function ensureBaseline(contentId: string): Promise<Baseline | null> {
    const node: any = (await gunOnce(contentNode(contentId), READ_TIMEOUT_MS))
      ?? (await gunOnce(contentNode(contentId), READ_TIMEOUT_MS));
    if (!node) return null;

    if (node.voteBaselineAt) {
      return {
        up: Number(node.voteBaselineUp) || 0,
        down: Number(node.voteBaselineDown) || 0,
      };
    }

    const baseline = {
      up: Number(node.upvotes) || 0,
      down: Number(node.downvotes) || 0,
    };
    await gunPut(contentNode(contentId), {
      voteBaselineUp: baseline.up,
      voteBaselineDown: baseline.down,
      voteBaselineAt: Date.now(),
    });
    return baseline;
  }

  /** The frozen baseline, or `null` when the content node did not arrive. */
  async function readBaseline(contentId: string): Promise<Baseline | null> {
    const node: any = await gunOnce(contentNode(contentId), READ_TIMEOUT_MS);
    if (!node) return null;
    // No baseline frozen yet means nobody has voted under this scheme, so the
    // legacy counters are still the whole truth.
    if (!node.voteBaselineAt) {
      return { up: Number(node.upvotes) || 0, down: Number(node.downvotes) || 0 };
    }
    return {
      up: Number(node.voteBaselineUp) || 0,
      down: Number(node.voteBaselineDown) || 0,
    };
  }

  /** `readBaseline` with one retry, for paths that would otherwise report a wrong total. */
  async function readBaselineOrRetry(contentId: string): Promise<Baseline | null> {
    return (await readBaseline(contentId)) ?? readBaseline(contentId);
  }

  async function writeVote(contentId: string, userId: string, next: VoteValue): Promise<VoteResult> {
    // Independent reads — serialising them made a single click wait out two
    // timeouts back to back before the write was even attempted.
    const [baseline, existing] = await Promise.all([
      ensureBaseline(contentId),
      gunOnce(votesNode(contentId).get(userId), READ_TIMEOUT_MS),
    ]);

    // Preserve any baseline correction already recorded for this user; only
    // discover it from the legacy key the first time we write their node.
    const baselineType = parseVote(existing)
      ? parseBaselineType(existing)
      : await readLegacyVote(contentId, userId);

    const record: Record<string, string | number> = {
      type: next,
      userId,
      contentId,
      at: Date.now(),
    };
    if (baselineType) record.baselineType = baselineType;

    // A peer that answers with an error has *rejected* the write — that is a real
    // failure and the caller must roll back. A timeout is not: `gunPut`'s ack
    // proves only that some peer replied in time, and with a busy graph it
    // routinely does not, even though the record is already in the local graph
    // and queued for every peer. Throwing there discarded votes that had in fact
    // been cast. Treat it as unconfirmed instead: report the vote, and mark the
    // tally non-authoritative so callers keep their optimistic counts rather
    // than rendering a number the relay has not agreed to yet.
    const ack = await gunPut(votesNode(contentId).get(userId), record);
    if (!ack.ok && ack.err !== 'timeout') throw new Error(ack.err || 'Vote could not be recorded');
    const confirmed = ack.ok;

    const children = await gunReadChildren<any>(votesNode(contentId), { minMs: 300, maxMs: 4_000 });
    const folded = new Map(children.map(({ key, value }) => [key, value]));
    // Our own write may not have echoed back yet — count it from what we sent.
    folded.set(userId, record);
    const tally = foldVotes(
      baseline ?? { up: 0, down: 0 },
      [...folded.values()].map((value) => ({ vote: parseVote(value), baselineType: parseBaselineType(value) })),
    );

    // Advisory mirror, skipped when the baseline is unknown or the write is
    // unconfirmed: it would be a low number that every other client then
    // renders until its own tally lands.
    if (baseline && confirmed && mirrorNodes) {
      void (async () => {
        for (const node of await mirrorNodes(contentId)) {
          void gunPut(node, {
            upvotes: tally.upvotes,
            downvotes: tally.downvotes,
            score: tally.score,
          }).catch(() => { /* hint only */ });
        }
      })().catch(() => { /* hint only */ });
    }

    return {
      tally,
      myVote: next === 'none' ? null : next,
      tallyAuthoritative: Boolean(baseline) && confirmed,
      confirmed,
    };
  }

  return {
    /** This user's vote as the graph has it. Falls back to the pre-migration key. */
    async getMyVote(contentId, userId) {
      if (!userId) return null;
      const raw = await gunOnce(votesNode(contentId).get(userId), READ_TIMEOUT_MS);
      const vote = parseVote(raw);
      if (vote) return vote === 'none' ? null : vote;
      return readLegacyVote(contentId, userId);
    },

    /** Throws rather than returning a baseline-less total the caller would render. */
    async getTally(contentId) {
      const [baseline, children] = await Promise.all([
        readBaselineOrRetry(contentId),
        gunReadChildren<any>(votesNode(contentId), { minMs: 300, maxMs: 4_000 }),
      ]);
      if (!baseline) throw new Error('Baseline unavailable — tally would be incomplete');
      return foldVotes(
        baseline,
        children.map(({ value }) => ({ vote: parseVote(value), baselineType: parseBaselineType(value) })),
      );
    },

    /**
     * Set this user's vote to `direction`, or clear it if that is already their
     * vote (the toggle). Returns the recomputed tally *and* the resulting vote,
     * so callers reconcile against what happened rather than what they predicted.
     */
    async castVote(contentId, userId, direction) {
      if (!userId) throw new Error('userId is required to vote');
      const current = await this.getMyVote(contentId, userId);
      const next: VoteValue = current === direction ? 'none' : direction;
      return writeVote(contentId, userId, next);
    },

    /** Clear this user's vote unconditionally. */
    async clearVote(contentId, userId) {
      if (!userId) throw new Error('userId is required to vote');
      return writeVote(contentId, userId, 'none');
    },

    /**
     * Live tally for one item. Emits on every vote change from any peer.
     *
     * Nothing is emitted until the baseline is known: vote nodes start streaming
     * immediately, and folding them onto an assumed zero shows a derived-only
     * count that then visibly jumps.
     */
    subscribeTally(contentId, callback) {
      let active = true;
      let baseline: Baseline | null = null;
      const votes = new Map<string, { vote: VoteValue | null; baselineType: VoteType | null }>();

      const emit = () => {
        if (!active || !baseline) return;
        callback(foldVotes(baseline, votes.values()));
      };

      void readBaselineOrRetry(contentId).then((value) => {
        if (!active || !value) return;
        baseline = value;
        emit();
      });

      let chain: any = null;
      const attach = () => {
        if (!active) return;
        chain = votesNode(contentId).map().on((value: any, key: string) => {
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
      const offReconnect = onReconnect?.(() => {
        if (!active) return;
        detach();
        attach();
      });

      return () => {
        active = false;
        offReconnect?.();
        detach();
      };
    },
  };
}
