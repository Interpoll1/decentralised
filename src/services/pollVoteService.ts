/**
 * Poll *content* upvote/downvote tallies — the up/down on the poll itself, not
 * the option voting, which is a separate model entirely.
 *
 * Ported onto the same derived scheme as posts (`derivedVoteTally.ts`). The old
 * `PollService.voteOnPollContent()` was the read-modify-write this replaces: it
 * read `poll.upvotes`, adjusted it and wrote the number back, so two voters
 * inside one round trip lost a vote, and a stale read reverted counts that had
 * already landed. It also cleared a vote with `put(null)`, a Gun delete that
 * does not propagate reliably — the toggle-off often simply did not stick.
 *
 * Polls carry a second copy of themselves under the community, so the advisory
 * mirror writes to both. Only the root node holds the frozen baseline, so the
 * community copy can never disagree about it.
 */

import { GunService } from './gunService';
import { gunOnce } from '../utils/gunAsync';
import {
  createDerivedVoteTally,
  type VoteTally,
  type VoteType,
  type VoteResult,
} from './derivedVoteTally';

export type { VoteTally, VoteType, VoteResult };

function gun() {
  return GunService.getGun();
}

const tally = createDerivedVoteTally({
  contentNode: (pollId) => gun().get('polls').get(pollId),
  votesNode: (pollId) => gun().get('pollVotes').get(pollId),
  // The pre-migration content vote, written by the old voteOnPollContent().
  legacyVoteNode: (pollId, userId) => gun().get('votes').get(`vote_${userId}_poll_${pollId}`),
  // Read straight from the graph rather than importing PollService — that
  // would close an import cycle, since PollService delegates voting here.
  mirrorNodes: async (pollId) => {
    const nodes = [gun().get('polls').get(pollId)];
    const poll: any = await gunOnce(gun().get('polls').get(pollId), 3_000);
    if (poll?.communityId) {
      nodes.push(gun().get('communities').get(poll.communityId).get('polls').get(pollId));
    }
    return nodes;
  },
  onReconnect: (handler) => GunService.onReconnect(handler),
});

export class PollVoteService {
  /** This user's content vote as the graph has it. Falls back to the pre-migration key. */
  static getMyVote(pollId: string, userId: string): Promise<VoteType | null> {
    return tally.getMyVote(pollId, userId);
  }

  /** Throws rather than returning a baseline-less total the caller would render. */
  static getTally(pollId: string): Promise<VoteTally> {
    return tally.getTally(pollId);
  }

  /** Set this user's vote, or clear it if that is already their vote (the toggle). */
  static castVote(pollId: string, userId: string, direction: VoteType): Promise<VoteResult> {
    return tally.castVote(pollId, userId, direction);
  }

  /** Clear this user's vote unconditionally. */
  static clearVote(pollId: string, userId: string): Promise<VoteResult> {
    return tally.clearVote(pollId, userId);
  }

  /** Live tally for one poll. Emits on every content-vote change from any peer. */
  static subscribeTally(pollId: string, callback: (tally: VoteTally) => void): () => void {
    return tally.subscribeTally(pollId, callback);
  }
}
