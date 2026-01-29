// src/stores/pollStore.ts
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { Poll } from '../services/pollService';
import { PollService } from '../services/pollService';
import { UserService } from '../services/userService';

export const usePollStore = defineStore('poll', () => {
  const polls = ref<Poll[]>([]);
  const currentPoll = ref<Poll | null>(null);
  const isLoading = ref(false);

  const sortedPolls = computed(() =>
    [...polls.value].sort((a, b) => b.createdAt - a.createdAt)
  );

  const activePolls = computed(() =>
    sortedPolls.value.filter((p) => !p.isExpired)
  );

  // ─────────────────────────────────────────────
  // Loading & subscription
  // ─────────────────────────────────────────────

  async function loadPollsForCommunity(communityId: string) {
    if (isLoading.value) return;
    isLoading.value = true;

    const seen = new Set<string>();

    // Real-time subscription
    PollService.subscribeToPollsInCommunity(communityId, (poll) => {
      if (seen.has(poll.id)) return;
      seen.add(poll.id);

      const index = polls.value.findIndex((p) => p.id === poll.id);
      if (index >= 0) {
        polls.value[index] = poll;
      } else {
        polls.value.push(poll);
      }
    });

    // One-shot bulk load (helps with initial population & missed early events)
    try {
      const fetched = await PollService.getAllPollsInCommunity(communityId);

      for (const poll of fetched) {
        if (seen.has(poll.id)) continue;
        seen.add(poll.id);
        polls.value.push(poll);
      }
    } catch (err) {
      console.warn('Failed to perform initial poll fetch', err);
      // subscription should still keep things alive
    } finally {
      isLoading.value = false;
    }
  }

  // ─────────────────────────────────────────────
  // Mutations / Actions
  // ─────────────────────────────────────────────

  async function createPoll(data: {
    communityId: string;
    question: string;
    description?: string;
    options: string[];
    durationDays: number;
    allowMultipleChoices: boolean;
    showResultsBeforeVoting: boolean;
    requireLogin: boolean;
  }) {
    const user = await UserService.getCurrentUser();

    const poll = await PollService.createPoll({
      ...data,
      authorId: user.id,
      authorName: user.username || 'Anonymous',
    });

    // optimistic insert at top (newest)
    if (!polls.value.some((p) => p.id === poll.id)) {
      polls.value.unshift(poll);
    }

    return poll;
  }

  async function voteOnPoll(pollId: string, optionIds: string[]) {
    const user = await UserService.getCurrentUser();

    // optimistic update
    const poll = polls.value.find((p) => p.id === pollId);
    if (poll) {
      poll.totalVotes += optionIds.length;

      for (const optionId of optionIds) {
        const option = poll.options.find((o) => o.id === optionId);
        if (option) {
          option.votes += 1;
        }
      }
    }

    try {
      await PollService.voteOnPoll(pollId, optionIds, user.id);
    } catch (err) {
      console.warn('Vote failed — local state may be inconsistent', err);
      // You could add rollback logic here if desired
      throw err;
    }
  }

  // ─────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────

  return {
    // state
    polls,
    currentPoll,
    isLoading,

    // derived
    sortedPolls,
    activePolls,

    // actions
    loadPollsForCommunity,
    createPoll,
    voteOnPoll,
  };
});