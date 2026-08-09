// src/stores/commentStore.ts
//
// One post's comment thread at a time.
//
// The old store raced a live subscription against four staggered refetches, all
// writing into the same array through a shared `seen` set. A comment that
// arrived by subscription was never refreshed by a later fetch, a comment that
// arrived by fetch could be re-added by the subscription, and navigating between
// posts left the previous post's listeners running. That is where the "comments
// are super random" behaviour came from.
//
// Now: one generation token guards every async step, comments are keyed by id,
// and the service owns durability. The store renders the local mirror
// immediately and merges the graph on top as it arrives.

import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { CommentService } from '../services/commentService';
import type { Comment, SyncStatus } from '../types/social';
import { generatePseudonym } from '../utils/pseudonym';
import { UserService } from '../services/userService';
import { usePostStore } from './postStore';

/** Vote memory, so a reload does not forget what you already voted on. */
const UPVOTED_KEY = 'upvoted-comments';
const DOWNVOTED_KEY = 'downvoted-comments';
/** Cap the post-load tally refresh — enough for a visible thread, bounded traffic. */
const TALLY_REFRESH_LIMIT = 30;
const TALLY_REFRESH_CONCURRENCY = 5;

type VoteChoice = 'up' | 'down' | null;

function readVoteList(key: string): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function writeVoteList(key: string, ids: string[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(ids));
  } catch {
    // Storage full or blocked — Gun still holds the authoritative vote.
  }
}

function rememberVote(commentId: string, choice: VoteChoice): void {
  const up = new Set(readVoteList(UPVOTED_KEY));
  const down = new Set(readVoteList(DOWNVOTED_KEY));
  up.delete(commentId);
  down.delete(commentId);
  if (choice === 'up') up.add(commentId);
  if (choice === 'down') down.add(commentId);
  writeVoteList(UPVOTED_KEY, [...up]);
  writeVoteList(DOWNVOTED_KEY, [...down]);
}

export const useCommentStore = defineStore('comment', () => {
  const comments = ref<Comment[]>([]);
  const isLoading = ref(false);
  const error = ref<string | null>(null);
  const activePostId = ref<string | null>(null);
  /** Publish state for comments this device authored, keyed by comment id. */
  const syncStatus = ref<Record<string, SyncStatus>>({});
  const myVotes = ref<Record<string, VoteChoice>>({});

  let unsubscribe: (() => void) | null = null;
  /** Guards every async continuation against a post switch mid-flight. */
  let generation = 0;

  const index = new Map<string, number>();

  function reindex(): void {
    index.clear();
    comments.value.forEach((comment, i) => index.set(comment.id, i));
  }

  /** Newer revision wins; a record without content never replaces one with content. */
  function upsert(incoming: Comment[]): void {
    let changed = false;
    for (const comment of incoming) {
      const at = index.get(comment.id);
      if (at === undefined) {
        index.set(comment.id, comments.value.length);
        comments.value.push(comment);
        changed = true;
        continue;
      }
      const existing = comments.value[at];
      const incomingRevision = comment.editedAt || comment.createdAt || 0;
      const existingRevision = existing.editedAt || existing.createdAt || 0;
      if (incomingRevision < existingRevision) continue;
      if (!comment.content && existing.content) continue;
      comments.value[at] = { ...existing, ...comment };
      changed = true;
    }
    if (changed) reindex();
  }

  function teardown(): void {
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
  }

  function seedVotesFromCache(ids: string[]): void {
    const up = new Set(readVoteList(UPVOTED_KEY));
    const down = new Set(readVoteList(DOWNVOTED_KEY));
    for (const id of ids) {
      if (up.has(id)) myVotes.value[id] = 'up';
      else if (down.has(id)) myVotes.value[id] = 'down';
      else if (myVotes.value[id] === undefined) myVotes.value[id] = null;
    }
  }

  /**
   * Refresh scores *and this user's own vote* from the authoritative per-user
   * vote nodes, for the top of the thread.
   *
   * The counters carried on a comment are only a hint written by whoever voted
   * last, and `myVotes` is seeded from a per-device localStorage set — so
   * without this a vote cast on another device renders as un-voted, and the
   * next click on it silently *removes* the vote instead of adding one. Both
   * come from a single pass over the vote set, so this costs no more reads than
   * refreshing the tally alone did.
   */
  async function refreshTallies(postId: string, token: number): Promise<void> {
    const userId = await UserService.getCurrentUser().then((u) => u.id).catch(() => '');
    if (token !== generation) return;

    const targets = comments.value
      .filter((c) => c.postId === postId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, TALLY_REFRESH_LIMIT);

    let cursor = 0;
    const workers = Array.from(
      { length: Math.min(TALLY_REFRESH_CONCURRENCY, targets.length) },
      async () => {
        for (;;) {
          const i = cursor++;
          if (i >= targets.length || token !== generation) return;
          const comment = targets[i];
          try {
            if (userId) {
              const { tally, myVote } = await CommentService.getCommentVoteState(comment.id, userId, comment);
              if (token !== generation) return;
              upsert([{ ...comment, ...tally }]);
              myVotes.value[comment.id] = myVote;
              rememberVote(comment.id, myVote);
            } else {
              const tally = await CommentService.getCommentTally(comment.id, comment);
              if (token !== generation) return;
              upsert([{ ...comment, ...tally }]);
            }
          } catch {
            // A tally we cannot read leaves the hint in place.
          }
        }
      },
    );
    await Promise.all(workers);
  }

  /**
   * Push the thread's real size onto the post so its feed card stops showing the
   * mutable `commentCount` field, which is written read-modify-write and loses
   * increments whenever two people comment inside one Gun round trip.
   *
   * Counted from the merged local+graph thread the page is already holding, so
   * it costs nothing extra and is right the moment a comment lands.
   */
  function publishCommentCount(postId: string, authoritative = false): void {
    if (!postId) return;
    const count = comments.value.filter((c) => c.postId === postId).length;
    const postStore = usePostStore();
    if (!authoritative) {
      // Mid-load the thread is still filling in — the local mirror alone can be
      // empty for a post that has plenty of comments elsewhere. A count the
      // store adopts outranks Gun echoes permanently, so before the graph has
      // answered only raise it, never lower it.
      const known = postStore.postsMap.get(postId)?.commentCount
        ?? (postStore.currentPost?.id === postId ? postStore.currentPost.commentCount : 0)
        ?? 0;
      if (count <= known) return;
    }
    postStore.setCommentCount(postId, count);
  }

  async function loadCommentsForPost(postId: string): Promise<void> {
    if (!postId) return;
    const token = ++generation;

    teardown();
    activePostId.value = postId;
    error.value = null;
    isLoading.value = true;
    comments.value = [];
    reindex();

    try {
      // 1. Whatever this device already holds — instant, and correct offline.
      const local = await CommentService.getLocalComments(postId);
      if (token !== generation) return;
      upsert(local);
      seedVotesFromCache(local.map((c) => c.id));
      publishCommentCount(postId);
      isLoading.value = false;

      // 2. Live updates (new comments, edits, deletions, vote hints).
      unsubscribe = CommentService.subscribeToCommentsInPost(postId, (comment) => {
        if (token !== generation) return;
        upsert([comment]);
        seedVotesFromCache([comment.id]);
        publishCommentCount(postId);
      });

      // 3. The graph's own answer, merged on top.
      const remote = await CommentService.fetchCommentsFromGun(postId);
      if (token !== generation) return;
      upsert(remote);
      seedVotesFromCache(remote.map((c) => c.id));
      // The graph has answered — this count may correct the stored one downward.
      publishCommentCount(postId, true);

      void refreshTallies(postId, token);
    } catch (err) {
      if (token !== generation) return;
      error.value = err instanceof Error ? err.message : 'Failed to load comments';
      console.error('[commentStore] Failed to load comments:', err);
    } finally {
      if (token === generation) isLoading.value = false;
    }
  }

  /** Re-run the load for the post currently open (used after memory cleanup). */
  async function reloadActivePost(): Promise<void> {
    if (activePostId.value) await loadCommentsForPost(activePostId.value);
  }

  async function createComment(data: {
    postId: string;
    communityId: string;
    content: string;
    parentId?: string;
  }): Promise<Comment> {
    if (!data.postId) throw new Error('postId is required');
    if (!data.communityId) throw new Error('communityId is required');
    if (!data.content?.trim()) throw new Error('content is required');

    // The device profile id — the same identity posts, polls and karma use. The
    // old store minted a separate `anon_<timestamp>` id in localStorage, so a
    // commenter never matched their own profile: identity badges always read
    // "unverified" and karma landed on an account nobody could look up.
    const profile = await UserService.getCurrentUser();
    const showRealName = profile.showRealName === true;

    const comment = await CommentService.createComment({
      postId: data.postId,
      communityId: data.communityId,
      authorId: profile.id,
      authorName: showRealName
        ? (profile.customUsername || profile.displayName || profile.username)
        : generatePseudonym(data.postId, profile.id),
      authorShowRealName: showRealName,
      content: data.content.trim(),
      parentId: data.parentId,
    });

    upsert([comment]);
    publishCommentCount(data.postId);
    syncStatus.value[comment.id] = 'pending';
    void trackSync(comment.id);
    return comment;
  }

  /** Follow a freshly-posted comment until the relay confirms it (or gives up). */
  async function trackSync(commentId: string): Promise<void> {
    for (let attempt = 0; attempt < 12; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, attempt < 3 ? 1_500 : 10_000));
      const stored = await CommentService.getComment(commentId);
      if (!stored) return;
      const row = syncStatus.value[commentId];
      const next = await currentSyncStatus(commentId);
      if (next && next !== row) syncStatus.value[commentId] = next;
      if (next === 'confirmed' || next === 'failed') return;
    }
  }

  async function currentSyncStatus(commentId: string): Promise<SyncStatus | null> {
    const { StorageService } = await import('../services/storageService');
    const row = await StorageService.getComment(commentId);
    return row?.syncStatus ?? null;
  }

  async function vote(commentId: string, choice: 'up' | 'down'): Promise<void> {
    const previous = myVotes.value[commentId] ?? null;
    const next: VoteChoice = previous === choice ? null : choice;

    const at = index.get(commentId);
    const before = at === undefined ? null : comments.value[at];

    // Optimistic: reflect the click immediately, reconcile with the real tally.
    myVotes.value[commentId] = next;
    rememberVote(commentId, next);
    if (before) {
      const delta = (kind: 'up' | 'down') =>
        (next === kind ? 1 : 0) - (previous === kind ? 1 : 0);
      const upvotes = Math.max(0, (before.upvotes || 0) + delta('up'));
      const downvotes = Math.max(0, (before.downvotes || 0) + delta('down'));
      comments.value[at!] = { ...before, upvotes, downvotes, score: upvotes - downvotes };
    }

    try {
      const profile = await UserService.getCurrentUser();
      const { tally, myVote: resolved } = await CommentService.voteOnComment(commentId, choice, profile.id);
      const current = index.get(commentId);
      if (current !== undefined) {
        comments.value[current] = { ...comments.value[current], ...tally };
      }
      // The graph decides remove-vs-switch, not the optimistic guess above: a
      // click the UI read as "upvote" is a *clear* when the vote node already
      // holds this user's upvote. Reconciling here is what keeps the filled
      // icon and the number from disagreeing.
      myVotes.value[commentId] = resolved;
      rememberVote(commentId, resolved);

      const author = before?.authorId;
      if (author && author !== profile.id) {
        const karmaDelta = (resolved === 'up' ? 1 : resolved === 'down' ? -1 : 0)
          - (previous === 'up' ? 1 : previous === 'down' ? -1 : 0);
        if (karmaDelta !== 0) {
          UserService.incrementKarma(author, karmaDelta).catch(() => { /* karma is advisory */ });
        }
      }
    } catch (err) {
      // Roll back — a vote that never reached the graph must not linger in the UI.
      myVotes.value[commentId] = previous;
      rememberVote(commentId, previous);
      if (before && at !== undefined) comments.value[at] = before;
      console.error('[commentStore] Vote failed:', err);
      throw err;
    }
  }

  async function upvoteComment(commentId: string): Promise<void> {
    await vote(commentId, 'up');
  }

  async function downvoteComment(commentId: string): Promise<void> {
    await vote(commentId, 'down');
  }

  function hasUpvoted(commentId: string): boolean {
    return myVotes.value[commentId] === 'up';
  }

  function hasDownvoted(commentId: string): boolean {
    return myVotes.value[commentId] === 'down';
  }

  /** Comments awaiting relay confirmation — surfaced in the UI as "sending". */
  const pendingComments = computed(() =>
    Object.entries(syncStatus.value)
      .filter(([, status]) => status === 'pending')
      .map(([id]) => id));

  function statusOf(commentId: string): SyncStatus | null {
    return syncStatus.value[commentId] ?? null;
  }

  /**
   * Drop in-memory comments and stop listening. Called by the memory watchdog at
   * `emergency` pressure — nothing is lost, because the durable copy is in
   * IndexedDB and `reloadActivePost()` brings the open thread straight back.
   */
  function clearComments(): void {
    teardown();
    generation++;
    comments.value = [];
    index.clear();
    syncStatus.value = {};
  }

  return {
    comments,
    isLoading,
    error,
    activePostId,
    syncStatus,
    myVotes,
    pendingComments,
    loadCommentsForPost,
    reloadActivePost,
    createComment,
    upvoteComment,
    downvoteComment,
    hasUpvoted,
    hasDownvoted,
    statusOf,
    clearComments,
  };
});
