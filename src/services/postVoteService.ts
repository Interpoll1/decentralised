/**
 * Post upvote/downvote tallies, derived from per-user vote nodes.
 *
 * The counting rule, the frozen legacy baseline and the unreadable-baseline
 * handling all live in `derivedVoteTally.ts`, shared with polls. This file is
 * the post-shaped binding: which Gun nodes hold the content, the vote set, the
 * pre-migration record (`votes/vote_{userId}_{postId}`) and the advisory mirror.
 */

import { GunService } from './gunService';
import {
  createDerivedVoteTally,
  foldVotes,
  type VoteTally,
  type VoteType,
  type VoteValue,
  type VoteResult,
} from './derivedVoteTally';

export type { VoteType, VoteValue };
export { foldVotes };

/** @deprecated Use `VoteTally`. Kept so existing imports keep resolving. */
export type PostTally = VoteTally;
export type PostVoteResult = VoteResult;

function gun() {
  return GunService.getGun();
}

const tally = createDerivedVoteTally({
  contentNode: (postId) => gun().get('posts').get(postId),
  votesNode: (postId) => gun().get('postVotes').get(postId),
  legacyVoteNode: (postId, userId) => gun().get('votes').get(`vote_${userId}_${postId}`),
  mirrorNodes: (postId) => [gun().get('posts').get(postId)],
  onReconnect: (handler) => GunService.onReconnect(handler),
});

export class PostVoteService {
  /** This user's vote as the graph has it. Falls back to the pre-migration key. */
  static getMyVote(postId: string, userId: string): Promise<VoteType | null> {
    return tally.getMyVote(postId, userId);
  }

  /** Throws rather than returning a baseline-less total the caller would render. */
  static getTally(postId: string): Promise<VoteTally> {
    return tally.getTally(postId);
  }

  /** Set this user's vote, or clear it if that is already their vote (the toggle). */
  static castVote(postId: string, userId: string, direction: VoteType): Promise<VoteResult> {
    return tally.castVote(postId, userId, direction);
  }

  /** Clear this user's vote unconditionally. */
  static clearVote(postId: string, userId: string): Promise<VoteResult> {
    return tally.clearVote(postId, userId);
  }

  /** Live tally for one post. Emits on every vote change from any peer. */
  static subscribeTally(postId: string, callback: (tally: VoteTally) => void): () => void {
    return tally.subscribeTally(postId, callback);
  }
}