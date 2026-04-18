// src/stores/communityStore.ts
import { defineStore } from 'pinia';
import { ref } from 'vue';
import config from '@/config';
import { Community, CommunityService } from '../services/communityService';
import { GUN_NAMESPACE } from '../services/gunService';
import { KeyVaultService } from '../services/keyVaultService';
import { useChainStore } from './chainStore';

function getGunRelayBaseUrl(): string {
  try {
    const endpoint = new URL(config.relay.gun);
    endpoint.pathname = endpoint.pathname.replace(/\/gun\/?$/, '');
    endpoint.search = '';
    endpoint.hash = '';
    return endpoint.toString().replace(/\/$/, '');
  } catch {
    return config.relay.gun.replace(/\/gun\/?$/, '').replace(/\/$/, '');
  }
}

const FALLBACK_SOUL_TIMEOUT_MS = 4000;
const FALLBACK_COMMUNITY_SEARCH_TIMEOUT_MS = 8000;
const FALLBACK_POST_SEARCH_TIMEOUT_MS = 12000;
const CLEAN_SLATE_NAMESPACE_VERSION = 3;

function getNamespaceVersion(namespace: string): number {
  const parsed = Number.parseInt(namespace.replace(/^v/i, ''), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isCleanSlateNamespace(namespace: string): boolean {
  return getNamespaceVersion(namespace) >= CLEAN_SLATE_NAMESPACE_VERSION;
}

async function fetchJsonWithTimeout<T>(url: string, timeoutMs: number): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    return await res.json() as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string');
}

function toCommunityRecord(value: unknown): Community | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Record<string, unknown>;
  const id = asString(data.id);
  const name = asString(data.name, id);
  const displayName = asString(data.displayName, name || id);
  if (!id) return null;

  return {
    id,
    name,
    displayName,
    description: asString(data.description),
    creatorId: asString(data.creatorId),
    memberCount: asNumber(data.memberCount),
    postCount: asNumber(data.postCount),
    createdAt: asNumber(data.createdAt, Date.now()),
    rules: asStringArray(data.rules),
    isEncrypted: Boolean(data.isEncrypted),
    encryptionHint: typeof data.encryptionHint === 'string' ? data.encryptionHint : undefined,
    encryptedMeta: typeof data.encryptedMeta === 'string' ? data.encryptedMeta : undefined,
  };
}

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
    if (isCleanSlateNamespace(GUN_NAMESPACE)) return 0;
    try {
      const relayBaseUrl = getGunRelayBaseUrl();
      const json = await fetchJsonWithTimeout<{ results?: Array<{ data?: Record<string, unknown> }> }>(
        `${relayBaseUrl}/db/search?prefix=${GUN_NAMESPACE}/communities&limit=200`,
        FALLBACK_COMMUNITY_SEARCH_TIMEOUT_MS,
      );
      if (!json) return 0;

      let added = 0;
      for (const row of json.results || []) {
        const community = toCommunityRecord(row.data);
        if (!community) continue;

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
    if (isCleanSlateNamespace(GUN_NAMESPACE)) return;
    try {
      const relayBaseUrl = getGunRelayBaseUrl();
      const json = await fetchJsonWithTimeout<{ results?: Array<{ data?: Record<string, unknown> }> }>(
        `${relayBaseUrl}/db/search?prefix=${GUN_NAMESPACE}/posts&limit=500`,
        FALLBACK_POST_SEARCH_TIMEOUT_MS,
      );
      if (!json) return;

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

    // 2. After 1.5s, if Gun gave us nothing (cold relay), v2 can fall back to MySQL.
    // v3+ is clean-slate mode; skip API relay fallback so we don't rehydrate legacy data.
    await new Promise(r => setTimeout(r, 1500));

    if (communities.value.length === 0) {
      const shouldUseFallback = !isCleanSlateNamespace(GUN_NAMESPACE);
      if (shouldUseFallback) {
        console.log('⚠️  Gun returned no communities — falling back to MySQL...');
        await loadCommunitiesFromDB();
        // Also warm up posts so the feed isn't empty
        await loadPostsFromDB();
      } else {
        console.log('ℹ️  Gun returned no communities in clean-slate mode; skipping MySQL fallback.');
      }
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

      // Fallback: fetch from MySQL relay only for v2 and older namespaces.
      if (!currentCommunity.value && !isCleanSlateNamespace(GUN_NAMESPACE)) {
        const relayBaseUrl = getGunRelayBaseUrl();
        const json = await fetchJsonWithTimeout<{ data?: unknown }>(
          `${relayBaseUrl}/db/soul?soul=${GUN_NAMESPACE}/communities/${communityId}`,
          FALLBACK_SOUL_TIMEOUT_MS,
        );
        const fallbackCommunity = toCommunityRecord(json?.data);
        if (fallbackCommunity) {
          currentCommunity.value = fallbackCommunity;
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
      const local = communities.value.find(c => c.id === communityId);
      await CommunityService.joinCommunity(communityId, local ? { memberCount: local.memberCount } : undefined);
      const refreshed = await CommunityService.getCommunity(communityId);
      if (refreshed) {
        await upsertCommunity(refreshed);
      }
    } catch (error) {
      console.warn('Join GunDB write failed (non-critical):', error);
    }
    if (!currentCommunity.value || currentCommunity.value.id !== communityId) {
      await selectCommunity(communityId);
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
