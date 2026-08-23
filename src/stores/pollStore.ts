// src/stores/pollStore.ts
import { defineStore } from 'pinia';
import { ref, computed, onScopeDispose, shallowRef, triggerRef, watchEffect } from 'vue';
import type { Poll } from '../services/pollService';
import { PollService } from '../services/pollService';
import type { VoteTally } from '../services/derivedVoteTally';
import { BoundedMap } from '../utils/boundedMap';
import { UserService } from '../services/userService';
import { EventService } from '../services/eventService';
import { BroadcastService } from '../services/broadcastService';
import { WebSocketService } from '../services/websocketService';
import { GunService } from '../services/gunService';
import { generatePseudonym } from '../utils/pseudonym';
// relayFeedService imports removed from store — REST warmup lives in dbWarmup.ts

const PAGE_SIZE      = 10;
const SEEN_POLLS_KEY = 'seen-poll-ids';
const MY_POLL_VOTES_KEY = 'my-poll-content-votes-v1';
const INCOMING_POLL_FLUSH_MS = 50;
const INCOMING_POLL_BATCH_SIZE = 100;

/**
 * Per-poll content vote state (up/down on the poll card itself, not on options).
 * Stored in localStorage so it survives reloads, same as postStore myVotes.
 * Keyed by pollId → 'up' | 'down'.
 */
const MY_POLL_CONTENT_VOTES_KEY = 'my-poll-content-votes-v1';

function loadMyPollContentVotes(): Map<string, 'up' | 'down'> {
  const votes = new Map<string, 'up' | 'down'>();
  try {
    const stored = localStorage.getItem(MY_POLL_CONTENT_VOTES_KEY);
    if (stored) {
      for (const [id, vote] of Object.entries(JSON.parse(stored) as Record<string, 'up' | 'down'>)) {
        if (vote === 'up' || vote === 'down') votes.set(id, vote);
      }
    }
  } catch { /* unreadable cache — graph is authority */ }
  return votes;
}

function saveMyPollContentVotes(votes: Map<string, 'up' | 'down'>): void {
  try {
    localStorage.setItem(MY_POLL_CONTENT_VOTES_KEY, JSON.stringify(Object.fromEntries(votes)));
  } catch { /* quota — non-fatal */ }
}

function isSyncDebugEnabled(): boolean {
  return typeof window !== 'undefined' && window.localStorage.getItem('interpoll_sync_debug') === 'true';
}

// Same as postStore — filter Gun re-deliveries by session start time
const APP_START_TIME = Date.now();

function loadSeenIds(): Set<string> {
  try {
    const stored = localStorage.getItem(SEEN_POLLS_KEY);
    return stored ? new Set(JSON.parse(stored)) : new Set();
  } catch { return new Set(); }
}

function saveSeenIds(ids: Set<string>) {
  try {
    const arr = Array.from(ids).slice(-500);
    localStorage.setItem(SEEN_POLLS_KEY, JSON.stringify(arr));
  } catch {}
}

/** This user's poll *content* votes, seeded from localStorage and corrected by the graph. */
function loadMyPollVotes(): Map<string, 'up' | 'down'> {
  const votes = new Map<string, 'up' | 'down'>();
  try {
    const stored = localStorage.getItem(MY_POLL_VOTES_KEY);
    if (stored) {
      for (const [id, vote] of Object.entries(JSON.parse(stored) as Record<string, 'up' | 'down'>)) {
        if (vote === 'up' || vote === 'down') votes.set(id, vote);
      }
      return votes;
    }
    // Migrate the two legacy sets each view maintained independently. They were
    // treated as the authority on whether a click meant vote or unvote while the
    // service decided the same question from the graph; when the two disagreed
    // the click inverted, and a side-switch issued two writes to one node.
    for (const [key, vote] of [['upvoted-polls', 'up'], ['downvoted-polls', 'down']] as const) {
      const legacy = localStorage.getItem(key);
      if (!legacy) continue;
      for (const id of JSON.parse(legacy) as string[]) votes.set(id, vote);
    }
  } catch { /* unreadable cache — the graph is the authority anyway */ }
  return votes;
}

function saveMyPollVotes(votes: Map<string, 'up' | 'down'>) {
  try {
    localStorage.setItem(MY_POLL_VOTES_KEY, JSON.stringify(Object.fromEntries(votes)));
  } catch { /* quota — non-fatal, this is only a paint hint */ }
}

function createRateLogger(label: string, snapshot?: () => Record<string, unknown>) {
  let windowStart = Date.now();
  let count = 0;
  return (delta = 1) => {
    if (!isSyncDebugEnabled()) return;
    count += delta;
    const now = Date.now();
    if (now - windowStart < 1000) return;
    const payload = snapshot ? snapshot() : {};
    console.warn(`[SyncRate] ${label}`, { eventsPerSec: count, ...payload });
    windowStart = now;
    count = 0;
  };
}

export const usePollStore = defineStore('poll', () => {
  // shallowRef: Vue only tracks the Map reference. Tally-only mutations
  // (vote count changes) use in-place .set() WITHOUT triggerRef so they don't
  // cause a full feed re-sort. Only new polls and score changes call triggerRef.
  const pollsMap = shallowRef<Map<string, Poll>>(new Map());
  const currentPoll  = ref<Poll | null>(null);
  const isLoading    = ref(false);
  const visibleCount = ref(PAGE_SIZE);

  // No more banner — kept for backward compat
  const pendingNewPolls = ref<Poll[]>([]);
  const newPollCount    = computed(() => 0);

  const seenPollIds = loadSeenIds();
  const subscribedCommunities = new Set<string>();
  const unsubscribers = new Map<string, () => void>();
  // Per-community initial load tracking to avoid cross-community misclassification
  const initialLoadDoneByCommId = new Map<string, boolean>();
  // Recently-voted polls: Gun subscription won't overwrite vote counts during this window
  const recentlyVotedPolls = new Map<string, number>();
  const VOTE_PROTECTION_MS = 10_000; // 10s protection window after voting

  /**
   * Per-poll content vote state — confirmed from graph after each cast.
   * Replaces the stale localStorage Sets (upvoted-polls / downvoted-polls) that
   * lived in HomePage.vue and diverged from the actual graph state.
   */
  const myPollContentVotes = ref(loadMyPollContentVotes());
  const pendingPollsByCommunity = new Map<string, Map<string, Poll>>();
  let pendingPollsFlushTimer: ReturnType<typeof setTimeout> | null = null;
  const getPendingIncomingPollCount = () => {
    let total = 0;
    for (const queue of pendingPollsByCommunity.values()) total += queue.size;
    return total;
  };
  const logIncomingPollRate = createRateLogger('poll-incoming', () => ({
    queueDepth: getPendingIncomingPollCount(),
    subscribedCommunities: subscribedCommunities.size,
    pollsInStore: pollsMap.value.size,
  }));
  const logPollFlushRate = createRateLogger('poll-flush', () => ({
    queueDepth: getPendingIncomingPollCount(),
  }));

  function handlePollSyncUpdate(incomingPoll: Poll) {
    if (!incomingPoll?.id || !Array.isArray(incomingPoll.options) || incomingPoll.options.length === 0) {
      return;
    }
    injectPoll(incomingPoll);
  }

  BroadcastService.subscribe('poll-updated', handlePollSyncUpdate);
  WebSocketService.subscribe('poll-updated', handlePollSyncUpdate);

  /**
   * pollId → content-vote counts derived from the per-user vote set.
   *
   * The `upvotes`/`downvotes`/`score` carried on a poll node are an advisory
   * mirror any peer can echo from a pre-vote snapshot. A derived tally outranks
   * every such echo permanently — which is why content votes no longer rely on
   * `VOTE_PROTECTION_MS`, whose expiry a late echo could simply wait out.
   *
   * `recentlyVotedPolls` still guards *option* votes (`totalVotes`), which are a
   * different model and were not ported.
   */
  const contentTallies = new BoundedMap<string, VoteTally>({ maxSize: 1000 });

  /** pollId → this user's content vote, as last confirmed by the graph. */
  const myContentVotes = ref(loadMyPollVotes());

  /** Overlay the derived content tally, if we have one, onto an incoming copy. */
  function withKnownTally(incoming: Poll): Poll {
    const tally = contentTallies.get(incoming.id);
    return tally ? { ...incoming, ...tally } : incoming;
  }

  function setContentTally(pollId: string, tally: VoteTally) {
    contentTallies.set(pollId, tally);
    const existing = pollsMap.value.get(pollId);
    if (existing) pollsMap.value.set(pollId, { ...existing, ...tally });
    if (currentPoll.value?.id === pollId) {
      currentPoll.value = { ...currentPoll.value, ...tally };
    }
  }

  function isVoteProtected(pollId: string): boolean {
    const ts = recentlyVotedPolls.get(pollId);
    if (!ts) return false;
    if (Date.now() - ts > VOTE_PROTECTION_MS) {
      recentlyVotedPolls.delete(pollId);
      return false;
    }
    return true;
  }

  function getTotalVotes(poll: Poll): number {
    if (typeof poll.totalVotes === 'number') return poll.totalVotes;
    return poll.options.reduce((sum, opt) => sum + (opt.votes || 0), 0);
  }

  /** Attempt to decrypt an encrypted poll and update the store */
  function tryDecryptPoll(poll: Poll) {
    if (!poll.isEncrypted || !poll.encryptedContent) return;
    PollService.decryptPoll(poll).then(decrypted => {
      if (decrypted !== poll && pollsMap.value.get(poll.id) === poll) {
        pollsMap.value.set(poll.id, decrypted);
        if (currentPoll.value?.id === poll.id) {
          currentPoll.value = decrypted;
        }
      }
    }).catch(() => { /* no key or decryption failed — keep encrypted version */ });
  }

  function processIncomingPoll(communityId: string, poll: Poll) {
    if (pollsMap.value.has(poll.id)) {
      const existing = pollsMap.value.get(poll.id)!;
      const normalizedPoll =
        existing.communityId && !poll.communityId
          ? { ...poll, communityId: existing.communityId }
          : poll;
      // During vote-protection, block only non-advancing updates.
      if (isVoteProtected(normalizedPoll.id) && getTotalVotes(normalizedPoll) <= getTotalVotes(existing)) return;
      // Don't overwrite a poll that has options with one that has none
      if (existing.options.length > 0 && normalizedPoll.options.length === 0) {
        return;
      }
      pollsMap.value.set(normalizedPoll.id, withKnownTally(normalizedPoll));
      tryDecryptPoll(normalizedPoll);
      if (currentPoll.value?.id === normalizedPoll.id) {
        currentPoll.value = normalizedPoll;
      }
      return;
    }

    if (seenPollIds.has(poll.id)) {
      pollsMap.value.set(poll.id, withKnownTally(poll));
      tryDecryptPoll(poll);
      return;
    }

    const isGenuinelyNew = poll.createdAt > APP_START_TIME;

    pollsMap.value.set(poll.id, withKnownTally(poll));
    tryDecryptPoll(poll);
    seenPollIds.add(poll.id);
    // Flush persisted seen-IDs immediately for live arrivals
    if (initialLoadDoneByCommId.get(communityId) && isGenuinelyNew) {
      saveSeenIds(seenPollIds);
    }
    if (currentPoll.value?.id === poll.id) {
      currentPoll.value = poll;
    }
  }

  function scheduleIncomingPollsFlush() {
    if (pendingPollsFlushTimer) return;
    pendingPollsFlushTimer = setTimeout(() => {
      pendingPollsFlushTimer = null;
      let processed = 0;
      const queues = Array.from(pendingPollsByCommunity.entries());
      let cursor = 0;
      while (processed < INCOMING_POLL_BATCH_SIZE && queues.length > 0) {
        const [communityId, queue] = queues[cursor];
        const first = queue.values().next().value as Poll | undefined;
        if (first) {
          queue.delete(first.id);
          processIncomingPoll(communityId, first);
          processed++;
        }
        if (queue.size === 0) {
          pendingPollsByCommunity.delete(communityId);
          queues.splice(cursor, 1);
          if (queues.length === 0) break;
          if (cursor >= queues.length) cursor = 0;
          continue;
        }
        cursor = (cursor + 1) % queues.length;
      }
      if (processed > 0) logPollFlushRate(processed);
      if (pendingPollsByCommunity.size > 0) scheduleIncomingPollsFlush();
    }, INCOMING_POLL_FLUSH_MS);
  }

  function queueIncomingPoll(communityId: string, poll: Poll) {
    const queue = pendingPollsByCommunity.get(communityId) || new Map<string, Poll>();
    queue.set(poll.id, poll);
    pendingPollsByCommunity.set(communityId, queue);
    logIncomingPollRate();
    scheduleIncomingPollsFlush();
  }

  function flushCommunityIncomingPolls(communityId: string) {
    const queue = pendingPollsByCommunity.get(communityId);
    if (!queue) return;
    pendingPollsByCommunity.delete(communityId);
    for (const poll of queue.values()) {
      processIncomingPoll(communityId, poll);
    }
  }

  // ─── Computed ──────────────────────────────────────────────────────────────

  const polls = computed(() => Array.from(pollsMap.value.values()));

  const _sortedPollsCache = shallowRef<Poll[]>([]);

  function rebuildSortedPolls() {
    _sortedPollsCache.value = Array.from(pollsMap.value.values())
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  watchEffect(() => {
    void pollsMap.value; // subscribe to shallowRef trigger
    rebuildSortedPolls();
  });

  const sortedPolls = computed(() => _sortedPollsCache.value);

  const activePolls  = computed(() => sortedPolls.value.filter(p => !p.isExpired));
  const visiblePolls = computed(() => sortedPolls.value.slice(0, visibleCount.value));
  const hasMorePolls = computed(() => visibleCount.value < sortedPolls.value.length);

  // ─── Loading ───────────────────────────────────────────────────────────────

  const pendingLoads = new Map<string, Promise<void>>();

  async function loadPollsForCommunity(communityId: string): Promise<void> {
    // If a load is already in-flight, return the same promise to avoid orphaning it
    if (pendingLoads.has(communityId)) return pendingLoads.get(communityId)!;

    // Allow re-subscription if previous attempt yielded zero polls (GunDB was offline/slow)
    if (subscribedCommunities.has(communityId) || unsubscribers.has(communityId)) {
      const hasLiveSubscription = subscribedCommunities.has(communityId) && unsubscribers.has(communityId);
      const hasPolls = Array.from(pollsMap.value.values()).some(p => p.communityId === communityId);
      if (hasLiveSubscription && hasPolls) return Promise.resolve();
      // Clean up stale subscription state before re-subscribing
      const oldUnsub = unsubscribers.get(communityId);
      if (oldUnsub) { oldUnsub(); unsubscribers.delete(communityId); }
      subscribedCommunities.delete(communityId);
    }

    // ── Step 1: Local IndexedDB warmup (instant, zero network) ───────────────
    void PollService.loadLocalPollsForCommunity(communityId)
      .then((localPolls) => { localPolls.forEach((poll) => { injectPoll(poll); }); })
      .catch(() => { /* best-effort */ });

    // REST warmup is handled by dbWarmup.ts before this is called.
    // This function opens the Gun live-updates subscription only.
    const p = new Promise<void>((resolve) => {
      initialLoadDoneByCommId.set(communityId, false);
      const timeoutId = setTimeout(resolve, 15_000);
      const unsub = PollService.subscribeToPollsInCommunity(
        communityId,
        (poll) => {
          queueIncomingPoll(communityId, poll);
        },
        () => {
          flushCommunityIncomingPolls(communityId);
          clearTimeout(timeoutId);
          subscribedCommunities.add(communityId);
          initialLoadDoneByCommId.set(communityId, true);
          for (const id of pollsMap.value.keys()) seenPollIds.add(id);
          saveSeenIds(seenPollIds);
          resolve();
        },
      );
      unsubscribers.set(communityId, unsub);
    });
    pendingLoads.set(communityId, p);
    p.finally(() => { if (pendingLoads.get(communityId) === p) pendingLoads.delete(communityId); });
    return p;
  }

  // No-op — kept so existing components don't break
  function flushNewPolls() {
    pendingNewPolls.value = [];
  }

  function injectPoll(poll: Poll) {
    const existing = pollsMap.value.get(poll.id);
    if (!existing) {
      pollsMap.value.set(poll.id, poll);
      triggerRef(pollsMap);
      tryDecryptPoll(poll);
    } else if (poll.options.length > 0 && existing.options.length === 0) {
      pollsMap.value.set(poll.id, poll);
      triggerRef(pollsMap);
      tryDecryptPoll(poll);
    } else if (poll.options.length > 0 && getTotalVotes(poll) >= getTotalVotes(existing)) {
      if (!isVoteProtected(poll.id) || getTotalVotes(poll) > getTotalVotes(existing)) {
        pollsMap.value.set(poll.id, poll);
        triggerRef(pollsMap);
        tryDecryptPoll(poll);
      }
    } else if (poll.category && poll.category !== existing.category) {
      // Category arrived on a poll whose vote counts haven't changed —
      // merge category fields only and trigger so combinedFeed re-evaluates.
      pollsMap.value.set(poll.id, {
        ...existing,
        category:  poll.category,
        tags:      poll.tags  ?? existing.tags,
        sentiment: poll.sentiment ?? existing.sentiment,
        nsfw:      poll.nsfw  ?? existing.nsfw,
      });
      triggerRef(pollsMap);
    }
    if (currentPoll.value?.id === poll.id) {
      currentPoll.value = pollsMap.value.get(poll.id) || currentPoll.value;
    }
    seenPollIds.add(poll.id);
  }

  function saveSeenNow() {
    saveSeenIds(seenPollIds);
  }

  function loadMorePolls() { visibleCount.value += PAGE_SIZE; }

  function resetVisibleCount() {
    visibleCount.value    = PAGE_SIZE;
    pendingNewPolls.value = [];
    // Note: initialLoadDoneByCommId is NOT reset here—it persists per community
    // across refreshes, so truly new polls after refresh correctly trigger banner
  }

  /**
   * Shrink pollsMap under memory pressure, keeping the visible window, the poll
   * being viewed, and any poll inside its post-vote protection window (dropping
   * one of those would discard a local vote count with nothing to reconcile
   * against). Everything else re-loads from Gun on scroll.
   *
   * Called by the memory watchdog — see the cleanup registration in main.ts.
   */
  function trimPollsToVisible(extra = PAGE_SIZE): number {
    const keep = new Set<string>();
    const ordered = sortedPolls.value;
    const limit = Math.min(ordered.length, visibleCount.value + extra);
    for (let i = 0; i < limit; i++) keep.add(ordered[i].id);
    if (currentPoll.value) keep.add(currentPoll.value.id);
    const now = Date.now();
    for (const [id, votedAt] of recentlyVotedPolls) {
      if (now - votedAt < VOTE_PROTECTION_MS) keep.add(id);
    }

    let removed = 0;
    for (const id of Array.from(pollsMap.value.keys())) {
      if (!keep.has(id)) { pollsMap.value.delete(id); removed++; }
    }
    return removed;
  }

  // ─── Create ────────────────────────────────────────────────────────────────

  async function createPoll(data: {
    communityId: string;
    question: string;
    description?: string;
    options: string[];
    durationDays: number;
    allowMultipleChoices: boolean;
    showResultsBeforeVoting: boolean;
    requireLogin: boolean;
    isPrivate: boolean;
    inviteCodeCount?: number;
    voteTrustPolicy?: import('../types/poll').VoteTrustPolicy;
  }) {
    const user = await UserService.getCurrentUser();
    const showReal = user.showRealName === true;
    const pollId = `poll-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    const authorName = showReal
      ? (user.customUsername || user.displayName || user.username)
      : generatePseudonym(pollId, user.id);

    const poll = await PollService.createPoll({
      ...data, authorId: user.id, authorName, authorShowRealName: showReal,
    }, pollId);

    pollsMap.value.set(poll.id, poll);
    seenPollIds.add(poll.id);
    saveSeenIds(seenPollIds);
    BroadcastService.broadcast('poll-updated', poll);
    void WebSocketService.broadcast('poll-updated', poll);

    try {
      const pollEvent = await EventService.createPollEvent({
        id: poll.id, communityId: data.communityId, question: data.question,
        description: data.description, options: data.options,
        durationDays: data.durationDays, allowMultipleChoices: data.allowMultipleChoices,
        showResultsBeforeVoting: data.showResultsBeforeVoting,
        requireLogin: data.requireLogin, isPrivate: data.isPrivate,
      });
      BroadcastService.broadcast('new-event', pollEvent);
      WebSocketService.broadcast('new-event', pollEvent);
    } catch (err) { console.warn('Failed to create signed poll event:', err); }

    return poll;
  }

  // ─── Vote ──────────────────────────────────────────────────────────────────

  async function voteOnPoll(pollId: string, optionIds: string[]) {
    const user     = await UserService.getCurrentUser();
    const original = pollsMap.value.get(pollId);
    const communityId = original?.communityId || currentPoll.value?.communityId;

    // Sweep expired vote-protection entries
    const now = Date.now();
    for (const [id, ts] of recentlyVotedPolls) {
      if (now - ts > VOTE_PROTECTION_MS) recentlyVotedPolls.delete(id);
    }

    // Mark as vote-protected BEFORE optimistic update to block stale Gun re-deliveries
    recentlyVotedPolls.set(pollId, now);

    if (original) {
      const optimistic: Poll = {
        ...original,
        options: original.options.map(opt =>
          optionIds.includes(opt.id) ? { ...opt, votes: opt.votes + 1 } : opt
        ),
      } as Poll;
      optimistic.totalVotes = optimistic.options.reduce((sum, opt) => sum + (opt.votes || 0), 0);
      pollsMap.value.set(pollId, optimistic);
      if (currentPoll.value?.id === pollId) currentPoll.value = optimistic;
    }
    try {
      await PollService.vote(pollId, optionIds, user.id, communityId);
      const canonical = await PollService.loadPoll(pollId, communityId);
      if (canonical) {
        pollsMap.value.set(pollId, canonical);
        if (currentPoll.value?.id === pollId) currentPoll.value = canonical;
      }
      const confirmed = canonical || pollsMap.value.get(pollId);
      if (confirmed) {
        BroadcastService.broadcast('poll-updated', confirmed);
        void WebSocketService.broadcast('poll-updated', confirmed);
      }
    } catch (err) {
      console.warn('Vote failed — rolling back', err);
      recentlyVotedPolls.delete(pollId);
      if (original) {
        pollsMap.value.set(pollId, original);
        if (currentPoll.value?.id === pollId) currentPoll.value = original;
      }
      throw err;
    }
  }

  /** This user's content vote on a poll, or null. */
  function myContentVote(pollId: string): 'up' | 'down' | null {
    return myContentVotes.value.get(pollId) ?? null;
  }

  function setMyContentVote(pollId: string, vote: 'up' | 'down' | null) {
    if (vote) myContentVotes.value.set(pollId, vote);
    else myContentVotes.value.delete(pollId);
    // Reassign so template reads re-evaluate; Map mutation is not reactive.
    myContentVotes.value = new Map(myContentVotes.value);
    saveMyPollVotes(myContentVotes.value);
  }

  /**
   * Toggle this user's content vote on a poll: clicking the direction you
   * already hold clears it.
   *
   * The previous version only ever *incremented* — it added +1 optimistically
   * whichever way the graph was about to go, so un-voting rendered the count
   * moving the wrong way before the reconcile yanked it back. The decision is
   * made once, here, and the graph's answer is what everything reconciles to.
   */
  async function voteOnPollContent(pollId: string, direction: 'up' | 'down') {
    const user = await UserService.getCurrentUser();
    const original = pollsMap.value.get(pollId)
      ?? (currentPoll.value?.id === pollId ? currentPoll.value : null);
    const previousVote = myContentVote(pollId);
    const predicted = previousVote === direction ? null : direction;

    // Optimistic paint, predicted from the same state the button's filled/hollow
    // rendering uses, so the number and the icon cannot disagree mid-flight.
    if (original) {
      const delta = (vote: 'up' | 'down') =>
        (predicted === vote ? 1 : 0) - (previousVote === vote ? 1 : 0);
      const upvotes = Math.max(0, (original.upvotes || 0) + delta('up'));
      const downvotes = Math.max(0, (original.downvotes || 0) + delta('down'));
      const optimistic: Poll = { ...original, upvotes, downvotes, score: upvotes - downvotes };
      pollsMap.value.set(pollId, optimistic);
      if (currentPoll.value?.id === pollId) currentPoll.value = optimistic;
    }
    setMyContentVote(pollId, predicted);

    try {
      const { myVote, tallyAuthoritative, ...tally } =
        await PollService.voteOnPollContent(pollId, direction, user.id);
      setMyContentVote(pollId, myVote);
      // A non-authoritative tally omits the legacy baseline the service could
      // not read; adopting it would drop the count and restore it a moment
      // later, so the optimistic numbers stay instead.
      if (tallyAuthoritative) {
        setContentTally(pollId, tally);
        const updated = pollsMap.value.get(pollId);
        if (updated) {
          BroadcastService.broadcast('poll-updated', updated);
          void WebSocketService.broadcast('poll-updated', updated);
        }
      }
    } catch (err) {
      // Roll back optimistic changes
      console.warn('Poll content vote failed — rolling back', err);
      setMyContentVote(pollId, previousVote);
      if (original) {
        pollsMap.value.set(pollId, original);
        if (currentPoll.value?.id === pollId) currentPoll.value = original;
      }
      throw err;
    }
  }

  /** Pull the authoritative content tally and vote state for one poll. */
  async function refreshContentVoteState(pollId: string) {
    try {
      const user = await UserService.getCurrentUser();
      const [tally, vote] = await Promise.all([
        PollService.getContentTally(pollId),
        PollService.getMyContentVote(pollId, user.id),
      ]);
      setContentTally(pollId, tally);
      setMyContentVote(pollId, vote);
    } catch (error) {
      console.error('Error refreshing poll vote state:', error);
    }
  }

  /** Live authoritative content counts while a poll is on screen. */
  function subscribeToContentVotes(pollId: string): () => void {
    return PollService.subscribeToContentVotes(pollId, (tally) => setContentTally(pollId, tally));
  }

  /** pollId → live tally subscription, for the polls currently rendered in a feed. */
  const feedVoteSubs = new Map<string, () => void>();

  /**
   * Keep live content tallies for exactly the polls a feed is showing — without
   * it a feed renders the advisory mirror, which peers re-echo from stale
   * snapshots, so counts drift and flip as echoes arrive.
   */
  function syncFeedVoteSubscriptions(pollIds: string[]) {
    const wanted = new Set(pollIds);
    for (const [pollId, unsubscribe] of feedVoteSubs) {
      if (wanted.has(pollId)) continue;
      unsubscribe();
      feedVoteSubs.delete(pollId);
    }
    for (const pollId of wanted) {
      if (feedVoteSubs.has(pollId)) continue;
      feedVoteSubs.set(pollId, subscribeToContentVotes(pollId));
    }
  }

  /** Drop every feed subscription — call when the feed unmounts. */
  function stopFeedVoteSubscriptions() {
    for (const unsubscribe of feedVoteSubs.values()) unsubscribe();
    feedVoteSubs.clear();
  }

  function upvotePoll(pollId: string) { return voteOnPollContent(pollId, 'up'); }
  function downvotePoll(pollId: string) { return voteOnPollContent(pollId, 'down'); }

  // ─── Select ────────────────────────────────────────────────────────────────

  async function selectPoll(pollId: string, communityId?: string) {
    isLoading.value = true;
    try {
      const existing = pollsMap.value.get(pollId);
      if (existing && existing.options.length > 0) {
        tryDecryptPoll(existing);
        currentPoll.value = existing;
        return;
      }
      const poll = await PollService.loadPollWithApiFallback(pollId, communityId);
      if (poll) {
        pollsMap.value.set(poll.id, poll);
        tryDecryptPoll(poll);
        currentPoll.value = poll;
      } else {
        currentPoll.value = null;
      }
    } finally {
      isLoading.value = false;
    }
  }

  // ─── Refresh ───────────────────────────────────────────────────────────────

  async function refreshCommunityPolls(communityId: string) {
    pendingPollsByCommunity.delete(communityId);
    const unsub = unsubscribers.get(communityId);
    if (unsub) unsub();
    unsubscribers.delete(communityId);
    subscribedCommunities.delete(communityId);
    initialLoadDoneByCommId.delete(communityId);
    pendingLoads.delete(communityId);
    const toDelete = [...pollsMap.value.entries()]
      .filter(([, p]) => p.communityId === communityId)
      .map(([id]) => id);
    for (const id of toDelete) {
      pollsMap.value.delete(id);
      recentlyVotedPolls.delete(id);
    }
    resetVisibleCount();
    await loadPollsForCommunity(communityId);
  }

  // ── Category patch watcher ────────────────────────────────────────────────
  // Gun's map().on() doesn't fire for property updates on existing nodes,
  // and loadPollFromGun fails silently when options time out (300ms).
  // Instead we subscribe directly to the category leaf of each poll node
  // and patch it onto the in-memory poll without re-fetching options.

  function patchPollCategory(pollId: string, data: { category?: string; tags?: string; sentiment?: string; nsfw?: any }) {
    const existing = pollsMap.value.get(pollId);
    if (!existing) return;
    const tags = data.tags
      ? data.tags.split(',').map((t: string) => t.trim()).filter(Boolean)
      : existing.tags;
    pollsMap.value.set(pollId, {
      ...existing,
      ...(data.category  ? { category:  data.category  }              : {}),
      ...(tags?.length   ? { tags }                                    : {}),
      ...(data.sentiment ? { sentiment: data.sentiment as Poll['sentiment'] } : {}),
      ...(data.nsfw      ? { nsfw: true }                              : {}),
    });
    // Trigger so combinedFeed re-evaluates — category change affects which
    // filter tab this poll appears under.
    triggerRef(pollsMap);
    if (currentPoll.value?.id === pollId) {
      currentPoll.value = pollsMap.value.get(pollId)!;
    }
  }

  // Subscribe to category updates on all gun poll paths.
  // Called once after initial load so we only watch polls already in the store.
  function watchCategoryUpdates() {
    try {
      const gun = GunService.getGun();

      // v3/polls/<id> — global feed path
      gun.get('polls').map().on((data: any, pollId: string) => {
        if (!data || !pollId || pollId === '_' || !data.category) return;
        // Only patch — don't trigger a full reload
        patchPollCategory(pollId, data);
      });

      // v3/communities/<cid>/polls/<id> — community feed path
      // Use a flat map on the polls node directly (namespaced proxy handles v3 prefix)
      // Each poll appears in both gun.get('polls') and community paths;
      // the global polls subscription above covers all polls already loaded.
      // For community-specific updates, subscribe to each community's polls node.
      // This is handled incrementally as communities load rather than a nested map
      // (gun.map().get().map() is not reliable across Gun versions).
      const knownCommunityIds = new Set(polls.value.map(p => p.communityId).filter(Boolean));
      for (const cid of knownCommunityIds) {
        gun.get('communities').get(cid).get('polls').map().on((data: any, pollId: string) => {
          if (!data || !pollId || pollId === '_' || !data.category) return;
          patchPollCategory(pollId, data);
        });
      }
    } catch { /* GunService not ready yet — categories will load on next poll fetch */ }
  }

  onScopeDispose(() => {
    if (pendingPollsFlushTimer) {
      clearTimeout(pendingPollsFlushTimer);
      pendingPollsFlushTimer = null;
    }
    pendingPollsByCommunity.clear();
    stopFeedVoteSubscriptions();
    for (const unsub of unsubscribers.values()) unsub();
    initialLoadDoneByCommId.clear();
    pendingLoads.clear();
  });

  // Start watching after a short delay so initial load completes first
  setTimeout(watchCategoryUpdates, 3000);

  return {
    polls, pollsMap, currentPoll, isLoading,
    sortedPolls, activePolls,
    visiblePolls, hasMorePolls, visibleCount,
    newPollCount, pendingNewPolls,
    loadPollsForCommunity, loadMorePolls, resetVisibleCount, trimPollsToVisible,
    flushNewPolls, injectPoll, saveSeenNow,
    createPoll, voteOnPoll, selectPoll,
    voteOnPollContent, upvotePoll, downvotePoll,
    myContentVote, myContentVotes, refreshContentVoteState, subscribeToContentVotes,
    syncFeedVoteSubscriptions, stopFeedVoteSubscriptions,
    refreshCommunityPolls,
  };
});