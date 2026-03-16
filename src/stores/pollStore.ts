// src/stores/pollStore.ts
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { Poll } from '../services/pollService';
import { PollService } from '../services/pollService';
import { UserService } from '../services/userService';
import { EventService } from '../services/eventService';
import { BroadcastService } from '../services/broadcastService';
import { WebSocketService } from '../services/websocketService';
import { generatePseudonym } from '../utils/pseudonym';

const PAGE_SIZE      = 10;
const SEEN_POLLS_KEY = 'seen-poll-ids';

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

  // ─── Computed ──────────────────────────────────────────────────────────────

  const polls = computed(() => Array.from(pollsMap.value.values()));

  const sortedPolls = computed(() =>
    Array.from(pollsMap.value.values()).sort((a, b) => b.createdAt - a.createdAt)
  );

  const activePolls  = computed(() => sortedPolls.value.filter(p => !p.isExpired));
  const visiblePolls = computed(() => sortedPolls.value.slice(0, visibleCount.value));
  const hasMorePolls = computed(() => visibleCount.value < sortedPolls.value.length);

  // ─── Loading ───────────────────────────────────────────────────────────────

  function loadPollsForCommunity(communityId: string): Promise<void> {
    if (subscribedCommunities.has(communityId) || unsubscribers.has(communityId)) return Promise.resolve();

    return new Promise((resolve) => {
      initialLoadDoneByCommId.set(communityId, false);
      const unsub = PollService.subscribeToPollsInCommunity(
        communityId,

        // Phase 1: shell poll arrives
        (poll) => {
          const inPending = pendingNewPolls.value.findIndex(p => p.id === poll.id);
          if (inPending !== -1) {
            pendingNewPolls.value[inPending] = poll;
            if (currentPoll.value?.id === poll.id) {
              currentPoll.value = poll;
            }
            return;
          }

          if (pollsMap.value.has(poll.id)) {
            pollsMap.value.set(poll.id, poll);
            tryDecryptPoll(poll);
            if (currentPoll.value?.id === poll.id) {
              currentPoll.value = poll;
            }
            return;
          }

          if (seenPollIds.has(poll.id)) {
            pollsMap.value.set(poll.id, poll);
            tryDecryptPoll(poll);
            return;
          }

          const isGenuinelyNew = poll.createdAt > APP_START_TIME;

          if (initialLoadDoneByCommId.get(communityId) && isGenuinelyNew) {
            // Auto-add immediately — no banner
            pollsMap.value.set(poll.id, poll);
            tryDecryptPoll(poll);
            seenPollIds.add(poll.id);
            saveSeenIds(seenPollIds);
          } else {
            pollsMap.value.set(poll.id, poll);
            tryDecryptPoll(poll);
            seenPollIds.add(poll.id);
          }
          if (currentPoll.value?.id === poll.id) {
            currentPoll.value = poll;
          }
        },

        // Initial batch done
        () => {
          subscribedCommunities.add(communityId);
          initialLoadDoneByCommId.set(communityId, true);
          for (const id of pollsMap.value.keys()) seenPollIds.add(id);
          saveSeenIds(seenPollIds);
          resolve();
        },

        // Phase 2: options patched in
        (updatedPoll) => {
          // Always update — options loading in is never "new content"
          pollsMap.value.set(updatedPoll.id, updatedPoll);
          tryDecryptPoll(updatedPoll);
          if (currentPoll.value?.id === updatedPoll.id) {
            currentPoll.value = updatedPoll;
          }
        },
      );

      unsubscribers.set(communityId, unsub);
    });
  }

  // No-op — kept so existing components don't break
  function flushNewPolls() {
    pendingNewPolls.value = [];
  }

  function injectPoll(poll: Poll) {
  const existing = pollsMap.value.get(poll.id)
  // Always update if incoming poll has options and existing doesn't
  if (!existing || (poll.options.length > 0 && existing.options.length === 0)) {
    pollsMap.value.set(poll.id, poll)
    tryDecryptPoll(poll)
  }
  seenPollIds.add(poll.id)
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
    if (original) {
      const optimistic: Poll = {
        ...original,
        totalVotes: original.totalVotes + optionIds.length,
        options: original.options.map(opt =>
          optionIds.includes(opt.id) ? { ...opt, votes: opt.votes + 1 } : opt
        ),
      };
      pollsMap.value.set(pollId, optimistic);
      if (currentPoll.value?.id === pollId) currentPoll.value = optimistic;
    }
    try {
      await PollService.vote(pollId, optionIds, user.id);
    } catch (err) {
      console.warn('Vote failed — rolling back', err);
      if (original) {
        pollsMap.value.set(pollId, original);
        if (currentPoll.value?.id === pollId) currentPoll.value = original;
      }
      throw err;
    }
  }

  // ─── Select ────────────────────────────────────────────────────────────────

  async function selectPoll(pollId: string) {
    isLoading.value = true;
    try {
      const existing = pollsMap.value.get(pollId);
      if (existing && existing.options.length > 0) {
        currentPoll.value = existing;
        return;
      }
      const poll = await PollService.loadPoll(pollId);
      currentPoll.value = poll;
      if (poll) {
        pollsMap.value.set(poll.id, poll);
        tryDecryptPoll(poll);
      }
    } finally {
      isLoading.value = false;
    }
  }

  // ─── Refresh ───────────────────────────────────────────────────────────────

  async function refreshCommunityPolls(communityId: string) {
    const unsub = unsubscribers.get(communityId);
    if (unsub) unsub();
    unsubscribers.delete(communityId);
    subscribedCommunities.delete(communityId);
    for (const [id, poll] of pollsMap.value) {
      if (poll.communityId === communityId) pollsMap.value.delete(id);
    }
    resetVisibleCount();
    await loadPollsForCommunity(communityId);
  }

  return {
    polls, pollsMap, currentPoll, isLoading,
    sortedPolls, activePolls,
    visiblePolls, hasMorePolls, visibleCount,
    newPollCount, pendingNewPolls,
    loadPollsForCommunity, loadMorePolls, resetVisibleCount,
    flushNewPolls, injectPoll, saveSeenNow,
    createPoll, voteOnPoll, selectPoll,
    refreshCommunityPolls,
  };
});
