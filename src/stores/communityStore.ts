// src/stores/communityStore.ts — communities UI state, backed by reactive GenosDB.
//
// The former store was two-thirds Gun damage control: MySQL/REST fallbacks
// (/db/search, /api/communities, /api/posts) for when the cold relay synced
// nothing, a posts "warmup" that re-put records into Gun's cache, soul parsing,
// rate loggers, and a live subscription that was disabled by default. GenosDB
// syncs P2P and persists to OPFS, so a single reactive subscription is enough.
import { defineStore } from 'pinia'
import { ref, onScopeDispose } from 'vue'
import { Community, CommunityService } from '../services/communityService'
import { UserService } from '../services/userService'

export const useCommunityStore = defineStore('community', () => {
  const communities = ref<Community[]>([])
  const currentCommunity = ref<Community | null>(null)
  const isLoading = ref(false)
  const joinedCommunities = ref<Set<string>>(new Set())

  let unsubscribe: (() => void) | null = null

  // ─── Joined set (local UI preference) ────────────────────────────────────────
  function persistJoined() {
    localStorage.setItem('joined-communities', JSON.stringify(Array.from(joinedCommunities.value)))
  }

  function markJoined(communityId: string) {
    if (joinedCommunities.value.has(communityId)) return
    joinedCommunities.value = new Set(joinedCommunities.value).add(communityId)
    persistJoined()
  }

  function isJoined(communityId: string): boolean {
    return joinedCommunities.value.has(communityId)
  }

  function loadJoinedCommunities() {
    try {
      const stored = localStorage.getItem('joined-communities')
      if (stored) joinedCommunities.value = new Set(JSON.parse(stored))
    } catch (error) {
      console.error('Error loading joined communities:', error)
    }
  }

  /** Deferred to the encryption slice (private communities). */
  async function syncJoinedPrivateCommunitiesFromKeys() {}

  // ─── Store mutation ──────────────────────────────────────────────────────────
  function upsertCommunity(community: Community) {
    const index = communities.value.findIndex(c => c.id === community.id)
    if (index >= 0) communities.value[index] = community
    else communities.value.push(community)
    if (currentCommunity.value?.id === community.id) currentCommunity.value = community
  }

  // ─── Load (live subscription) ────────────────────────────────────────────────
  async function loadCommunities() {
    if (unsubscribe) return
    isLoading.value = true
    unsubscribe = CommunityService.subscribeToCommunitiesLive(upsertCommunity)
    isLoading.value = false
  }

  async function refreshCommunities() {
    unsubscribe?.()
    unsubscribe = null
    communities.value = []
    await loadCommunities()
  }

  // ─── Create ──────────────────────────────────────────────────────────────────
  async function createCommunity(data: {
    name: string; displayName: string; description: string; rules: string[]
  }) {
    const user = await UserService.getCurrentUser()
    if (!user) throw new Error('Must be signed in to create a community')
    const community = await CommunityService.createCommunity({ ...data, creatorId: user.id })
    markJoined(community.id)
    upsertCommunity(community)
    return community
  }

  async function createPrivateCommunity(data: {
    name: string; displayName: string; description: string; rules: string[]
  }, password?: string) {
    const user = await UserService.getCurrentUser()
    if (!user) throw new Error('Must be signed in to create a community')
    const result = await CommunityService.createPrivateCommunity({ ...data, creatorId: user.id }, password)
    markJoined(result.community.id)
    upsertCommunity(result.community)
    return result
  }

  // ─── Select ──────────────────────────────────────────────────────────────────
  async function selectCommunity(communityId: string) {
    const local = communities.value.find(c => c.id === communityId)
    if (local) { currentCommunity.value = local; return }
    const community = await CommunityService.getCommunity(communityId)
    currentCommunity.value = community
    if (community) upsertCommunity(community)
  }

  // ─── Join ──────────────────────────────────────────────────────────────────
  async function joinCommunity(communityId: string) {
    if (isJoined(communityId)) {
      if (currentCommunity.value?.id !== communityId) await selectCommunity(communityId)
      return
    }
    markJoined(communityId)
    await CommunityService.joinCommunity(communityId)
    const refreshed = await CommunityService.getCommunity(communityId)
    if (refreshed) upsertCommunity(refreshed)
    if (currentCommunity.value?.id !== communityId) await selectCommunity(communityId)
  }

  loadJoinedCommunities()

  onScopeDispose(() => { unsubscribe?.() })

  return {
    communities,
    currentCommunity,
    isLoading,
    joinedCommunities,
    loadCommunities,
    createCommunity,
    createPrivateCommunity,
    selectCommunity,
    joinCommunity,
    markJoined,
    syncJoinedPrivateCommunitiesFromKeys,
    isJoined,
    refreshCommunities,
  }
})
