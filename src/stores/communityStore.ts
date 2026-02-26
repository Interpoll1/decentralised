// src/stores/communityStore.ts
import { defineStore } from 'pinia';
import { ref } from 'vue';
import { Community, CommunityService } from '../services/communityService';
import { useChainStore } from './chainStore';

const GUN_RELAY_URL = import.meta.env.VITE_GUN_URL?.replace('/gun', '') || 'https://interpoll2.onrender.com';
const API_URL       = import.meta.env.VITE_API_URL || 'https://interpoll.onrender.com';

export const useCommunityStore = defineStore('community', () => {
  const communities       = ref<Community[]>([]);
  const currentCommunity  = ref<Community | null>(null);
  const isLoading         = ref(false);
  const joinedCommunities = ref<Set<string>>(new Set());

  let subscriptionStarted = false;
  const seen = new Set<string>();

  // ─── MySQL REST fallback ───────────────────────────────────────────────────
  // When Gun returns nothing (cold relay), fetch directly from MySQL via the
  // gun-relay's /db/search endpoint and hydrate the store immediately.

  async function loadCommunitiesFromDB(): Promise<number> {
    try {
      const res  = await fetch(`${GUN_RELAY_URL}/db/search?prefix=v2/communities&limit=200`);
      if (!res.ok) return 0;
      const json = await res.json();

      let added = 0;
      for (const row of json.results || []) {
        const d = row.data;
        // Only leaf community nodes have an `id` field — skip index nodes
        if (!d?.id || !d?.displayName) continue;
        if (seen.has(d.id)) continue;

        const community: Community = {
          id:          d.id,
          name:        d.name        || d.id,
          displayName: d.displayName,
          description: d.description || '',
          creatorId:   d.creatorId   || '',
          memberCount: d.memberCount || 0,
          postCount:   d.postCount   || 0,
          createdAt:   d.createdAt   || Date.now(),
          rules:       Array.isArray(d.rules) ? d.rules : [],
        };

        seen.add(community.id);
        communities.value.push(community);
        added++;
      }

      if (added > 0) {
        console.log(`✅ Loaded ${added} communities from MySQL fallback`);
      }
      return added;
    } catch (err) {
      console.warn('⚠️  MySQL community fallback failed:', err);
      return 0;
    }
  }

  // Same thing for posts — scan all community post index nodes from MySQL
  // so postStore can subscribe to communities even on cold relay
  async function loadPostsFromDB(): Promise<void> {
    try {
      const res  = await fetch(`${GUN_RELAY_URL}/db/search?prefix=v2/posts&limit=500`);
      if (!res.ok) return;
      const json = await res.json();

      // Warm up Gun's local cache by putting data back into it so existing
      // postService subscriptions fire correctly
      const gun = (await import('../services/gunService')).GunService.getGun();
      for (const row of json.results || []) {
        const d = row.data;
        if (!d?.id || !d?.title) continue; // only full post nodes
        gun.get('posts').get(d.id).put(d);
      }
    } catch (err) {
      console.warn('⚠️  MySQL posts warmup failed:', err);
    }
  }

  // ─── Load ──────────────────────────────────────────────────────────────────

  async function loadCommunities() {
    if (subscriptionStarted) return;
    subscriptionStarted = true;
    isLoading.value = true;

    // 1. Start Gun live subscription — gets data from localStorage cache
    //    instantly and from relay as it arrives
    CommunityService.subscribeToCommunitiesLive((community) => {
      if (seen.has(community.id)) {
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

    // 2. After 1.5s, if Gun gave us nothing (cold relay), fall back to MySQL
    await new Promise(r => setTimeout(r, 1500));

    if (communities.value.length === 0) {
      console.log('⚠️  Gun returned no communities — falling back to MySQL...');
      await loadCommunitiesFromDB();
      // Also warm up posts so the feed isn't empty
      await loadPostsFromDB();
    }

    isLoading.value = false;
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

      // Try Gun first
      currentCommunity.value = await CommunityService.getCommunity(communityId);

      // Fallback: fetch from MySQL relay if Gun returned null
      if (!currentCommunity.value) {
        const res  = await fetch(`${GUN_RELAY_URL}/db/soul?soul=v2/communities/${communityId}`);
        if (res.ok) {
          const json = await res.json();
          if (json?.data?.id) currentCommunity.value = json.data as Community;
        }
      }

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