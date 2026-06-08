// src/stores/pollStore.ts — polls UI state, backed by reactive GenosDB queries.
//
// The former store carried ~300 lines fighting Gun: seen-id dedup, an
// APP_START_TIME re-delivery filter, a 10s "vote-protection" window against
// last-write-wins races, incoming-poll batching to survive floods, sync-rate
// loggers, and manual BroadcastService/WebSocketService propagation. None of it
// is needed: GenosDB delivers clean reactive events (initial/added/updated/
// removed), derives vote tallies deterministically, and syncs P2P + cross-tab
// out of the box.
import { defineStore } from 'pinia'
import { ref, computed, onScopeDispose } from 'vue'
import type { Poll } from '../services/pollService'
import { PollService } from '../services/pollService'
import { UserService } from '../services/userService'
import { generatePseudonym } from '../utils/pseudonym'

const PAGE_SIZE = 10

export const usePollStore = defineStore('poll', () => {
  const pollsMap = ref<Map<string, Poll>>(new Map())
  const currentPoll = ref<Poll | null>(null)
  const isLoading = ref(false)
  const visibleCount = ref(PAGE_SIZE)

  // Kept for backward compatibility with components that still reference them.
  const pendingNewPolls = ref<Poll[]>([])
  const newPollCount = computed(() => 0)

  const unsubscribers = new Map<string, () => void>()

  // ─── Computed ──────────────────────────────────────────────────────────────
  const polls = computed(() => Array.from(pollsMap.value.values()))
  const sortedPolls = computed(() => [...polls.value].sort((a, b) => b.createdAt - a.createdAt))
  const activePolls = computed(() => sortedPolls.value.filter(p => !p.isExpired))
  const visiblePolls = computed(() => sortedPolls.value.slice(0, visibleCount.value))
  const hasMorePolls = computed(() => visibleCount.value < sortedPolls.value.length)

  // ─── Helpers ─────────────────────────────────────────────────────────────────
  function injectPoll(poll: Poll) {
    pollsMap.value.set(poll.id, poll)
    if (currentPoll.value?.id === poll.id) currentPoll.value = poll
  }

  function loadMorePolls() { visibleCount.value += PAGE_SIZE }
  function resetVisibleCount() { visibleCount.value = PAGE_SIZE; pendingNewPolls.value = [] }

  // ─── Load (live subscription) ────────────────────────────────────────────────
  function loadPollsForCommunity(communityId: string): Promise<void> {
    if (unsubscribers.has(communityId)) return Promise.resolve()
    return new Promise<void>((resolve) => {
      const unsub = PollService.subscribeToPollsInCommunity(
        communityId,
        injectPoll,
        resolve,
      )
      unsubscribers.set(communityId, unsub)
    })
  }

  async function refreshCommunityPolls(communityId: string) {
    unsubscribers.get(communityId)?.()
    unsubscribers.delete(communityId)
    for (const [id, p] of [...pollsMap.value.entries()]) {
      if (p.communityId === communityId) pollsMap.value.delete(id)
    }
    resetVisibleCount()
    await loadPollsForCommunity(communityId)
  }

  // ─── Create ──────────────────────────────────────────────────────────────────
  async function createPoll(data: {
    communityId: string
    question: string
    description?: string
    options: string[]
    durationDays: number
    allowMultipleChoices: boolean
    showResultsBeforeVoting: boolean
    requireLogin: boolean
    isPrivate: boolean
    inviteCodeCount?: number
  }) {
    const user = await UserService.getCurrentUser()
    if (!user) throw new Error('Must be signed in to create a poll')

    const showReal = user.showRealName === true
    const pollId = `poll-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
    const authorName = showReal
      ? (user.customUsername || user.displayName || user.username)
      : generatePseudonym(pollId, user.id)

    const poll = await PollService.createPoll(
      { ...data, authorId: user.id, authorName, authorShowRealName: showReal },
      pollId,
    )
    injectPoll(poll)
    return poll
  }

  // ─── Vote ──────────────────────────────────────────────────────────────────
  async function voteOnPoll(pollId: string, optionIds: string[]) {
    const user = await UserService.getCurrentUser()
    if (!user) throw new Error('Must be signed in to vote')

    const original = pollsMap.value.get(pollId)
    // Optimistic bump for instant feedback; the derived tally reconciles it.
    if (original) {
      const optimistic: Poll = {
        ...original,
        options: original.options.map(o =>
          optionIds.includes(o.id)
            ? { ...o, votes: o.votes + 1, voters: [...o.voters, user.id] }
            : o,
        ),
      }
      optimistic.totalVotes = optimistic.options.reduce((sum, o) => sum + o.votes, 0)
      injectPoll(optimistic)
    }

    try {
      await PollService.vote(pollId, optionIds, user.id, original?.communityId)
      const canonical = await PollService.loadPoll(pollId, original?.communityId)
      if (canonical) injectPoll(canonical)
    } catch (err) {
      if (original) injectPoll(original)
      throw err
    }
  }

  // ─── Select ──────────────────────────────────────────────────────────────────
  async function selectPoll(pollId: string, communityId?: string) {
    isLoading.value = true
    try {
      const existing = pollsMap.value.get(pollId)
      if (existing && existing.options.length > 0) {
        currentPoll.value = existing
        return
      }
      const poll = await PollService.loadPoll(pollId, communityId)
      currentPoll.value = poll
      if (poll) pollsMap.value.set(poll.id, poll)
    } finally {
      isLoading.value = false
    }
  }

  // No-op kept so existing components don't break.
  function flushNewPolls() { pendingNewPolls.value = [] }
  function saveSeenNow() {}

  onScopeDispose(() => {
    for (const unsub of unsubscribers.values()) unsub()
    unsubscribers.clear()
  })

  return {
    polls, pollsMap, currentPoll, isLoading,
    sortedPolls, activePolls,
    visiblePolls, hasMorePolls, visibleCount,
    newPollCount, pendingNewPolls,
    loadPollsForCommunity, loadMorePolls, resetVisibleCount,
    flushNewPolls, injectPoll, saveSeenNow,
    createPoll, voteOnPoll, selectPoll,
    refreshCommunityPolls,
  }
})
