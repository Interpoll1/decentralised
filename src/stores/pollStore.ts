// src/stores/pollStore.ts
import { defineStore } from 'pinia';
import { ref, computed, onScopeDispose } from 'vue';
import type { Poll } from '../services/pollService';
import { PollService } from '../services/pollService';
import { UserService } from '../services/userService';
import { EventService } from '../services/eventService';
import { BroadcastService } from '../services/broadcastService';
import { WebSocketService } from '../services/websocketService';
import { generatePseudonym } from '../utils/pseudonym';

const PAGE_SIZE      = 10;
const SEEN_POLLS_KEY = 'seen-poll-ids';
const INCOMING_POLL_FLUSH_MS = 50;
const INCOMING_POLL_BATCH_SIZE = 100;

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
  const pollsMap     = ref<Map<string, Poll>>(new Map());
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
      pollsMap.value.set(normalizedPoll.id, normalizedPoll);
      tryDecryptPoll(normalizedPoll);
      if (currentPoll.value?.id === normalizedPoll.id) {
        currentPoll.value = normalizedPoll;
      }
      return;
    }

    if (seenPollIds.has(poll.id)) {
      pollsMap.value.set(poll.id, poll);
      tryDecryptPoll(poll);
      return;
    }

    const isGenuinelyNew = poll.createdAt > APP_START_TIME;

    pollsMap.value.set(poll.id, poll);
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

  const sortedPolls = computed(() =>
    [...polls.value].sort((a, b) => b.createdAt - a.createdAt)
  );

  const activePolls  = computed(() => sortedPolls.value.filter(p => !p.isExpired));
  // Public (non-private) poll count — used by the home feed; avoids repeated
  // .filter() allocations across watchers and computeds on every sync tick.
  const publicPollCount = computed(() => {
    let n = 0;
    for (const p of polls.value) if (!p.isPrivate) n++;
    return n;
  });
  const visiblePolls = computed(() => sortedPolls.value.slice(0, visibleCount.value));
  const hasMorePolls = computed(() => visibleCount.value < sortedPolls.value.length);

  // ─── Loading ───────────────────────────────────────────────────────────────

  const pendingLoads = new Map<string, Promise<void>>();

  function loadPollsForCommunity(communityId: string): Promise<void> {
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

    void PollService.loadLocalPollsForCommunity(communityId)
      .then((localPolls) => {
        localPolls.forEach((poll) => {
          injectPoll(poll);
        });
      })
      .catch(() => { /* best-effort local fallback */ });

    const p = new Promise<void>((resolve) => {
      initialLoadDoneByCommId.set(communityId, false);
      // Resolve after 15 s even if GunDB never fires the done callback (graceful degradation)
      const timeoutId = setTimeout(resolve, 15_000);
      const unsub = PollService.subscribeToPollsInCommunity(
        communityId,

        // Phase 1: shell poll arrives
        (poll) => {
          queueIncomingPoll(communityId, poll);
        },

        // Initial batch done
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
      tryDecryptPoll(poll);
    } else if (poll.options.length > 0 && existing.options.length === 0) {
      // Existing has no options yet — take the incoming version
      pollsMap.value.set(poll.id, poll);
      tryDecryptPoll(poll);
    } else if (poll.options.length > 0 && getTotalVotes(poll) >= getTotalVotes(existing)) {
      // Accept updates with equal or higher vote counts (avoids reverting votes)
      // During vote-protection, block only non-advancing updates.
      if (!isVoteProtected(poll.id) || getTotalVotes(poll) > getTotalVotes(existing)) {
        pollsMap.value.set(poll.id, poll);
        tryDecryptPoll(poll);
      }
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

  onScopeDispose(() => {
    if (pendingPollsFlushTimer) {
      clearTimeout(pendingPollsFlushTimer);
      pendingPollsFlushTimer = null;
    }
    pendingPollsByCommunity.clear();
    for (const unsub of unsubscribers.values()) unsub();
    initialLoadDoneByCommId.clear();
    pendingLoads.clear();
  });

  return {
    polls, pollsMap, currentPoll, isLoading,
    sortedPolls, activePolls, publicPollCount,
    visiblePolls, hasMorePolls, visibleCount,
    newPollCount, pendingNewPolls,
    loadPollsForCommunity, loadMorePolls, resetVisibleCount,
    flushNewPolls, injectPoll, saveSeenNow,
    createPoll, voteOnPoll, selectPoll,
    refreshCommunityPolls,
  };
});
