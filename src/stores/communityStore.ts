// src/stores/communityStore.ts
import { defineStore } from 'pinia';
import { ref } from 'vue';
import { Community, CommunityService } from '../services/communityService';
import { KeyVaultService } from '../services/keyVaultService';
import { useChainStore } from './chainStore';

const GUN_RELAY_URL = import.meta.env.VITE_GUN_URL?.replace('/gun', '') || 'https://interpoll2.endless.sbs';
export const useCommunityStore = defineStore('community', () => {
  const communities       = ref<Community[]>([]);
  const currentCommunity  = ref<Community | null>(null);
  const isLoading         = ref(false);
  const joinedCommunities = ref<Set<string>>(new Set());

  let subscriptionStarted = false;
  const seen = new Set<string>();

  function persistJoinedCommunities() {
    localStorage.setItem('joined-communities', JSON.stringify(Array.from(joinedCommunities.value)));
  }

  function markJoined(communityId: string) {
    if (joinedCommunities.value.has(communityId)) return;
    const next = new Set(joinedCommunities.value);
    next.add(communityId);
    joinedCommunities.value = next;
    persistJoinedCommunities();
  }

  function unmarkJoined(communityId: string) {
    if (!joinedCommunities.value.has(communityId)) return;
    const next = new Set(joinedCommunities.value);
    next.delete(communityId);
    joinedCommunities.value = next;
    persistJoinedCommunities();
  }

  async function syncJoinedPrivateCommunitiesFromKeys() {
    try {
      const keys = await KeyVaultService.listKeysByType('community');
      let changed = false;
      const next = new Set(joinedCommunities.value);
      for (const key of keys) {
        if (!next.has(key.id)) {
          next.add(key.id);
          changed = true;
        }
      }
      if (changed) {
        joinedCommunities.value = next;
        persistJoinedCommunities();
      }
    } catch (error) {
      console.error('Error syncing joined private communities:', error);
    }
  }

  async function resolveAccessibleCommunity(community: Community): Promise<Community> {
    if (!community.isEncrypted) return community;
    if (!joinedCommunities.value.has(community.id) && !await KeyVaultService.hasKey(community.id)) {
      return community;
    }
    return await CommunityService.decryptCommunityMeta(community) ?? community;
  }

  async function upsertCommunity(community: Community) {
    const resolved = await resolveAccessibleCommunity(community);
    seen.add(resolved.id);
    const index = communities.value.findIndex(c => c.id === resolved.id);
    if (index >= 0) {
      communities.value[index] = resolved;
    } else {
      communities.value.push(resolved);
    }

    if (currentCommunity.value?.id === resolved.id) {
      currentCommunity.value = resolved;
    }
  }

  function adjustMemberCount(communityId: string, delta: number) {
    const updateCount = (community: Community): Community => ({
      ...community,
      memberCount: Math.max(1, (community.memberCount || 0) + delta),
    });

    const index = communities.value.findIndex(c => c.id === communityId);
    if (index >= 0) {
      communities.value[index] = updateCount(communities.value[index]);
    }

    if (currentCommunity.value?.id === communityId) {
      currentCommunity.value = updateCount(currentCommunity.value);
    }
  }

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
          isEncrypted: !!d.isEncrypted,
          encryptionHint: d.encryptionHint || undefined,
          encryptedMeta: d.encryptedMeta || undefined,
        };

        const previousCount = communities.value.length;
        await upsertCommunity(community);
        if (communities.value.length > previousCount) added++;
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
    await syncJoinedPrivateCommunitiesFromKeys();

    // 1. Start Gun live subscription — gets data from localStorage cache
    //    instantly and from relay as it arrives
    CommunityService.subscribeToCommunitiesLive((community) => {
      void upsertCommunity(community);
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

      markJoined(community.id);
      await upsertCommunity(community);

      return community;
    } catch (error) {
      console.error('Error creating community:', error);
      throw error;
    }
  }

  async function createPrivateCommunity(data: {
    name: string;
    displayName: string;
    description: string;
    rules: string[];
  }, password?: string) {
    try {
      const result = await CommunityService.createPrivateCommunity({
        ...data,
        creatorId: 'current-user-id',
      }, password);

      const chainStore = useChainStore();
      await chainStore.addAction('community-create', {
        communityId: result.community.id,
        name: result.community.name,
        displayName: result.community.displayName,
        timestamp: result.community.createdAt,
        isEncrypted: true,
      }, result.community.displayName);

      markJoined(result.community.id);
      await upsertCommunity(result.community);

      return result;
    } catch (error) {
      console.error('Error creating private community:', error);
      throw error;
    }
  }

  // ─── Select ────────────────────────────────────────────────────────────────

  async function selectCommunity(communityId: string) {
    try {
      const local = communities.value.find(c => c.id === communityId);
      if (local) {
        currentCommunity.value = await resolveAccessibleCommunity(local);
        if (currentCommunity.value !== local) {
          await upsertCommunity(currentCommunity.value);
        }
        return;
      }

      // Try Gun first
      currentCommunity.value = await CommunityService.getCommunity(communityId);

      // Fallback: fetch from MySQL relay if Gun returned null
      if (!currentCommunity.value) {
        const res  = await fetch(`${GUN_RELAY_URL}/db/soul?soul=v2/communities/${communityId}`);
        if (res.ok) {
          const json = await res.json();
          if (json?.data?.id) {
            currentCommunity.value = {
              id: json.data.id,
              name: json.data.name || json.data.id,
              displayName: json.data.displayName || json.data.name || json.data.id,
              description: json.data.description || '',
              creatorId: json.data.creatorId || '',
              memberCount: json.data.memberCount || 0,
              postCount: json.data.postCount || 0,
              createdAt: json.data.createdAt || Date.now(),
              rules: Array.isArray(json.data.rules) ? json.data.rules : [],
              isEncrypted: !!json.data.isEncrypted,
              encryptionHint: json.data.encryptionHint || undefined,
              encryptedMeta: json.data.encryptedMeta || undefined,
            };
          }
        }
      }

      if (currentCommunity.value) {
        currentCommunity.value = await resolveAccessibleCommunity(currentCommunity.value);
        await upsertCommunity(currentCommunity.value);
      }
    } catch (error) {
      console.error('Error selecting community:', error);
    }
  }

  // ─── Join ──────────────────────────────────────────────────────────────────

  async function joinCommunity(communityId: string) {
    await syncJoinedPrivateCommunitiesFromKeys();
    if (isJoined(communityId)) {
      if (!currentCommunity.value || currentCommunity.value.id !== communityId) {
        await selectCommunity(communityId);
      }
      return;
    }
    if (await KeyVaultService.hasKey(communityId)) {
      markJoined(communityId);
      if (!currentCommunity.value || currentCommunity.value.id !== communityId) {
        await selectCommunity(communityId);
      }
      return;
    }
    markJoined(communityId);
    adjustMemberCount(communityId, 1);
    try {
      await CommunityService.joinCommunity(communityId);
      const refreshed = await CommunityService.getCommunity(communityId);
      if (refreshed) {
        await upsertCommunity(refreshed);
      }
      if (!currentCommunity.value || currentCommunity.value.id !== communityId) {
        await selectCommunity(communityId);
      }
    } catch (error) {
      unmarkJoined(communityId);
      adjustMemberCount(communityId, -1);
      console.error('Error joining community:', error);
      throw error;
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
    await syncJoinedPrivateCommunitiesFromKeys();
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
    createPrivateCommunity,
    selectCommunity,
    joinCommunity,
    markJoined,
    syncJoinedPrivateCommunitiesFromKeys,
    isJoined,
    refreshCommunities,
  };
});
