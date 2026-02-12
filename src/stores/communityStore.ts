// src/stores/communityStore.ts
import { defineStore } from 'pinia';
import { ref } from 'vue';
import { Community, CommunityService } from '../services/communityService';
import { useChainStore } from './chainStore';

export const useCommunityStore = defineStore('community', () => {
  const communities = ref<Community[]>([]);
  const currentCommunity = ref<Community | null>(null);
  const isLoading = ref(false);
  const joinedCommunities = ref<Set<string>>(new Set());

  // Guard: track whether the live subscription is already running.
  // loadCommunities() was being called multiple times (onMounted + interval +
  // tab switch) and each call did communities.value = [] then re-read from
  // Gun's localStorage cache — blowing away anything that arrived late from
  // the relay and causing the communities watcher to re-fire with a partial list.
  let subscriptionStarted = false;
  const seen = new Set<string>();

  // ─── Load ──────────────────────────────────────────────────────────────────

  async function loadCommunities() {
    // Only start the subscription once. Subsequent calls are no-ops because
    // the live .on() subscription below already delivers new communities.
    if (subscriptionStarted) return;
    subscriptionStarted = true;
    isLoading.value = true;

    // Use a real .on() subscription (not .once()) so communities that arrive
    // late from the relay (not yet in localStorage cache) still populate the
    // list and trigger the HomePage communities watcher for post loading.
    CommunityService.subscribeToCommunitiesLive((community) => {
      if (seen.has(community.id)) {
        // Update in place if data changed
        const index = communities.value.findIndex(c => c.id === community.id);
        if (index >= 0) {
          const existing = communities.value[index];
          if (JSON.stringify(existing) !== JSON.stringify(community)) {
            communities.value[index] = community;
          }
        }
      } else {
        seen.add(community.id);
        communities.value.push(community);
      }
    });

    // Signal loading done after a fixed window — same pattern as postService.
    // Communities cached in localStorage arrive in <50ms. Relay-only ones
    // arrive within 1200ms. After that, the live subscription handles the rest.
    setTimeout(() => { isLoading.value = false; }, 1200);
  }

  // ─── Create ────────────────────────────────────────────────────────────────

  async function createCommunity(data: {
    name: string;
    displayName: string;
    description: string;
    rules: string[];
  }) {
    try {
      const community = await CommunityService.createCommunity({
        ...data,
        creatorId: 'current-user-id',
      });

      const chainStore = useChainStore();
      await chainStore.addAction('community-create', {
        communityId: community.id,
        name: community.name,
        displayName: community.displayName,
        timestamp: community.createdAt,
      }, community.displayName);

      if (!seen.has(community.id)) {
        seen.add(community.id);
        communities.value.unshift(community);
      }

      return community;
    } catch (error) {
      console.error('Error creating community:', error);
      throw error;
    }
  }

  // ─── Select ────────────────────────────────────────────────────────────────

  async function selectCommunity(communityId: string) {
    try {
      const local = communities.value.find(c => c.id === communityId);
      if (local) { currentCommunity.value = local; return; }

      currentCommunity.value = await CommunityService.getCommunity(communityId);

      if (currentCommunity.value && !seen.has(currentCommunity.value.id)) {
        seen.add(currentCommunity.value.id);
        communities.value.push(currentCommunity.value);
      }
    } catch (error) {
      console.error('Error selecting community:', error);
    }
  }

  // ─── Join ──────────────────────────────────────────────────────────────────

  async function joinCommunity(communityId: string) {
    try {
      await CommunityService.joinCommunity(communityId);
      joinedCommunities.value.add(communityId);
      localStorage.setItem('joined-communities', JSON.stringify(
        Array.from(joinedCommunities.value)
      ));
      await selectCommunity(communityId);
    } catch (error) {
      console.error('Error joining community:', error);
    }
  }

  function isJoined(communityId: string): boolean {
    return joinedCommunities.value.has(communityId);
  }

  function loadJoinedCommunities() {
    try {
      const stored = localStorage.getItem('joined-communities');
      if (stored) joinedCommunities.value = new Set(JSON.parse(stored));
    } catch (error) {
      console.error('Error loading joined communities:', error);
    }
  }

  async function refreshCommunities() {
    // Full reset — only use for explicit pull-to-refresh, not on tab switch
    subscriptionStarted = false;
    seen.clear();
    communities.value = [];
    await loadCommunities();
  }

  // ─── Init ──────────────────────────────────────────────────────────────────

  loadJoinedCommunities();

  return {
    communities,
    currentCommunity,
    isLoading,
    joinedCommunities,
    loadCommunities,
    createCommunity,
    selectCommunity,
    joinCommunity,
    isJoined,
    refreshCommunities,
  };
});
