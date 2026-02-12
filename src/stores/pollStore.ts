// src/stores/pollStore.ts
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { Poll } from '../services/pollService';
import { PollService } from '../services/pollService';
import { UserService } from '../services/userService';
import { EventService } from '../services/eventService';
import { BroadcastService } from '../services/broadcastService';
import { WebSocketService } from '../services/websocketService';

const PAGE_SIZE = 10;

export const usePollStore = defineStore('poll', () => {
  const pollsMap = ref<Map<string, Poll>>(new Map());
  const currentPoll = ref<Poll | null>(null);
  const isLoading = ref(false);

  const visibleCount = ref(PAGE_SIZE);

  const subscribedCommunities = new Set<string>();
  const unsubscribers = new Map<string, () => void>();

  // ─── Computed ──────────────────────────────────────────────────────────────

  const polls = computed(() => Array.from(pollsMap.value.values()));

  const sortedPolls = computed(() =>
    Array.from(pollsMap.value.values()).sort((a, b) => b.createdAt - a.createdAt)
  );

  const activePolls = computed(() => sortedPolls.value.filter((p) => !p.isExpired));

  // Slice shown in feed — only renders PAGE_SIZE at a time
  const visiblePolls = computed(() => sortedPolls.value.slice(0, visibleCount.value));

  const hasMorePolls = computed(() => visibleCount.value < sortedPolls.value.length);

  // ─── Loading ───────────────────────────────────────────────────────────────

 function loadPollsForCommunity(communityId: string): Promise<void> {
  if (subscribedCommunities.has(communityId)) return Promise.resolve();

  return new Promise((resolve) => {
    const unsub = PollService.subscribeToPollsInCommunity(
      communityId,

      // Phase 1: shell with no options → renders list immediately
      (poll) => {
        pollsMap.value.set(poll.id, poll);
      },

      // Hard time-box done → unblock HomePage
      () => {
        subscribedCommunities.add(communityId);
        resolve();
      },

      // Phase 2: options patched in → update vote counts in place
      (updatedPoll) => {
        pollsMap.value.set(updatedPoll.id, updatedPoll);
        if (currentPoll.value?.id === updatedPoll.id) {
          currentPoll.value = updatedPoll;
        }
      },
    );

    unsubscribers.set(communityId, unsub);
  });
}

function loadMorePolls() {
  visibleCount.value += PAGE_SIZE;
}

function resetVisibleCount() {
  visibleCount.value = PAGE_SIZE;
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
    const poll = await PollService.createPoll({
      ...data, authorId: user.id, authorName: user.username || 'Anonymous',
    });
    pollsMap.value.set(poll.id, poll);
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
    } catch (err) {
      console.warn('Failed to create signed poll event:', err);
    }
    return poll;
  }

  // ─── Vote ──────────────────────────────────────────────────────────────────

  async function voteOnPoll(pollId: string, optionIds: string[]) {
    const user = await UserService.getCurrentUser();
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
      await PollService.voteOnPoll(pollId, optionIds, user.id);
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
      const poll = await PollService.getPollById(pollId);
      currentPoll.value = poll;
      if (poll) pollsMap.value.set(poll.id, poll);
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

  // ─── Public API ────────────────────────────────────────────────────────────

  return {
    polls, pollsMap, currentPoll, isLoading,
    sortedPolls, activePolls,
    visiblePolls, hasMorePolls, visibleCount,
    loadPollsForCommunity, loadMorePolls, resetVisibleCount,
    createPoll, voteOnPoll, selectPoll,
    refreshCommunityPolls,
  };
});
