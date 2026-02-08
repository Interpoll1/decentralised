// src/stores/pollStore.ts
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { Poll } from '../services/pollService';
import { PollService } from '../services/pollService';
import { UserService } from '../services/userService';
import { EventService } from '../services/eventService';
import { BroadcastService } from '../services/broadcastService';
import { WebSocketService } from '../services/websocketService';

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
    isPrivate: boolean;
    inviteCodeCount?: number;
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

    // Create and broadcast signed poll event
    try {
      const pollEvent = await EventService.createPollEvent({
        id: poll.id,
        communityId: data.communityId,
        question: data.question,
        description: data.description,
        options: data.options,
        durationDays: data.durationDays,
        allowMultipleChoices: data.allowMultipleChoices,
        showResultsBeforeVoting: data.showResultsBeforeVoting,
        requireLogin: data.requireLogin,
        isPrivate: data.isPrivate,
      });

      BroadcastService.broadcast('new-event', pollEvent);
      WebSocketService.broadcast('new-event', pollEvent);
    } catch (err) {
      console.warn('Failed to create signed poll event:', err);
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

  // Load a single poll by id (used on the vote page)
  async function selectPoll(pollId: string) {
    isLoading.value = true;
    try {
      const existing = polls.value.find((p) => p.id === pollId);
      if (existing) {
        currentPoll.value = existing;
        return;
      }

      const poll = await PollService.getPollById(pollId);
      currentPoll.value = poll;

      if (poll && !polls.value.some((p) => p.id === poll.id)) {
        polls.value.push(poll);
      }
    } finally {
      isLoading.value = false;
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
    selectPoll,
  };
});