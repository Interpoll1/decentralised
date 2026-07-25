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

function getApiBaseUrl(): string {
  try {
    const endpoint = new URL(config.relay.api);
    endpoint.search = '';
    endpoint.hash = '';
    return endpoint.toString().replace(/\/$/, '');
  } catch {
    return config.relay.api.replace(/\/$/, '');
  }
}

const FALLBACK_SOUL_TIMEOUT_MS = 4000;
const FALLBACK_COMMUNITY_SEARCH_TIMEOUT_MS = 8000;
const FALLBACK_POST_SEARCH_TIMEOUT_MS = 12000;
const FALLBACK_POST_WARMUP_BATCH_SIZE = 20;
const FALLBACK_POST_WARMUP_BATCH_DELAY_MS = 60;
const FALLBACK_POST_EXISTING_CHECK_TIMEOUT_MS = 250;
const COMMUNITY_GUN_LIVE_ENABLED = typeof window !== 'undefined'
  && window.localStorage.getItem('interpoll_community_live') === 'true';
const FALLBACK_POST_WARMUP_ENABLED = typeof window !== 'undefined'
  && window.localStorage.getItem('interpoll_posts_warmup') === 'true';

function isSyncDebugEnabled(): boolean {
  return typeof window !== 'undefined' && window.localStorage.getItem('interpoll_sync_debug') === 'true';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type GunNodeLike = {
  get: (key: string) => GunNodeLike;
  once: (callback: (data: unknown) => void) => void;
  put: (data: Record<string, unknown>) => void;
};

function createRateLogger(label: string, snapshot?: () => Record<string, unknown>) {
  let windowStart = Date.now();
  let count = 0;
  return (delta = 1) => {
    if (!isSyncDebugEnabled()) return;
    count += delta;
    const now = Date.now();
    if (now - windowStart < 1000) return;
    const payload = snapshot ? snapshot() : {};
    console.warn(`[SyncRate] ${label}`, { eventsPerSec: count, ...payload });
    windowStart = now;
    count = 0;
  };
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

function getTopLevelCommunitySoulId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const parts = value.split('/').filter(Boolean);
  if (parts.length !== 3) return null;
  const [namespace, root, id] = parts;
  if (namespace !== GUN_NAMESPACE || root !== 'communities' || !id) return null;
  return id;
}

function isCanonicalCommunityId(id: string): boolean {
  return id.startsWith('c-');
}

function toCommunityRecord(value: unknown, expectedId?: string): Community | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Record<string, unknown>;
  const id = asString(data.id);
  if (!id) return null;
  if (expectedId && id !== expectedId) return null;
  if (!isCanonicalCommunityId(id)) return null;

  const name = asString(data.name, id);
  const displayName = asString(data.displayName, name || id);

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
  let postsWarmupPromise: Promise<void> | null = null;
  const seen = new Set<string>();
  const logCommunityIncomingRate = createRateLogger('community-live');
  const logFallbackWarmupRate = createRateLogger('fallback-post-warmup');

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

  async function loadCommunitiesFromApiFallback(): Promise<number> {
    const apiBaseUrl = getApiBaseUrl();
    const json = await fetchJsonWithTimeout<{ communities?: Array<Record<string, unknown>> }>(
      `${apiBaseUrl}/api/communities`,
      FALLBACK_COMMUNITY_SEARCH_TIMEOUT_MS,
    );
    if (!json?.communities?.length) return 0;

    let added = 0;
    for (const row of json.communities) {
      const community = toCommunityRecord(row);
      if (!community) continue;
      const previousCount = communities.value.length;
      await upsertCommunity(community);
      if (communities.value.length > previousCount) added++;
    }

    if (added > 0) {
      console.log(`✅ Loaded ${added} communities from API fallback`);
    }
    return added;
  }

  async function loadCommunitiesFromDB(): Promise<number> {
    try {
      const relayBaseUrl = getGunRelayBaseUrl();
      const prefix = encodeURIComponent(`${GUN_NAMESPACE}/communities`);
      const json = await fetchJsonWithTimeout<{ results?: Array<{ soul?: unknown; data?: Record<string, unknown> }> }>(
        `${relayBaseUrl}/db/search?prefix=${prefix}&limit=200`,
        FALLBACK_COMMUNITY_SEARCH_TIMEOUT_MS,
      );
      if (!json) {
        console.warn('⚠️  MySQL community fallback unavailable, trying API fallback...');
        return await loadCommunitiesFromApiFallback();
      }

      let added = 0;
      for (const row of json.results || []) {
        const soulId = getTopLevelCommunitySoulId(row.soul);
        if (!soulId) continue;
        const community = toCommunityRecord(row.data, soulId);
        if (!community) continue;

        const previousCount = communities.value.length;
        await upsertCommunity(community);
        if (communities.value.length > previousCount) added++;
      }

      if (added > 0) {
        console.log(`✅ Loaded ${added} communities from MySQL fallback`);
      }
      const apiAdded = await loadCommunitiesFromApiFallback();
      return added + apiAdded;
    } catch (err) {
      console.warn('⚠️  MySQL community fallback failed:', err);
      return await loadCommunitiesFromApiFallback();
    }
  }

  // Same thing for posts — scan all community post index nodes from MySQL
  // so postStore can subscribe to communities even on cold relay
  async function loadPostsFromApiFallback(): Promise<number> {
    const apiBaseUrl = getApiBaseUrl();
    const json = await fetchJsonWithTimeout<{ posts?: Array<Record<string, unknown>> }>(
      `${apiBaseUrl}/api/posts?limit=500`,
      FALLBACK_POST_SEARCH_TIMEOUT_MS,
    );
    if (!json?.posts?.length) return 0;

    const gun = (await import('../services/gunService')).GunService.getGun() as unknown as GunNodeLike;
    let staged = 0;
    for (const d of json.posts) {
      const postId = asString(d.id);
      if (!postId || !asString(d.title)) continue;
      // Avoid hydrating posts from a different dataVersion (e.g., v2 into v3)
      const postDataVersion = typeof d.dataVersion === 'string' ? d.dataVersion : null;
      const namespaceVersion = Number.parseInt(GUN_NAMESPACE.replace(/^v/i, ''), 10) || 0;
      if (postDataVersion && postDataVersion !== GUN_NAMESPACE) continue;
      if (!postDataVersion && namespaceVersion >= 3) continue;

      if (!await shouldHydrateFallbackPost(gun, d)) continue;
      gun.get('posts').get(postId).put(d);
      staged += 1;
      logFallbackWarmupRate();
      if (staged % FALLBACK_POST_WARMUP_BATCH_SIZE === 0) {
        await sleep(FALLBACK_POST_WARMUP_BATCH_DELAY_MS);
      }
    }
    if (staged > 0) {
      console.log(`✅ Warmed ${staged} posts from API fallback (chunked)`);
    }
    return staged;
  }

  async function loadPostsFromDB(): Promise<number> {
    try {
      const relayBaseUrl = getGunRelayBaseUrl();
      const prefix = encodeURIComponent(`${GUN_NAMESPACE}/posts`);
      const json = await fetchJsonWithTimeout<{ results?: Array<{ data?: Record<string, unknown> }> }>(
        `${relayBaseUrl}/db/search?prefix=${prefix}&limit=500`,
        FALLBACK_POST_SEARCH_TIMEOUT_MS,
      );
      if (!json) {
        console.warn('⚠️  MySQL posts fallback unavailable, trying API fallback...');
        return await loadPostsFromApiFallback();
      }

      // Warm up Gun's local cache by putting data back into it so existing
      // postService subscriptions fire correctly
      const gun = (await import('../services/gunService')).GunService.getGun() as unknown as GunNodeLike;
      let staged = 0;
      const candidates = json.results || [];
      for (const row of candidates) {
        const d = row.data;
        if (!d) continue;
        const postId = asString(d.id);
        if (!postId || !asString(d.title)) continue; // only full post nodes

        // Avoid hydrating posts from a different dataVersion (e.g., v2 into v3)
        const postDataVersion = typeof d.dataVersion === 'string' ? d.dataVersion : null;
        const namespaceVersion = Number.parseInt(GUN_NAMESPACE.replace(/^v/i, ''), 10) || 0;
        if (postDataVersion && postDataVersion !== GUN_NAMESPACE) continue;
        if (!postDataVersion && namespaceVersion >= 3) continue;

        if (!await shouldHydrateFallbackPost(gun, d)) continue;
        gun.get('posts').get(postId).put(d);
        staged += 1;
        logFallbackWarmupRate();
        if (staged % FALLBACK_POST_WARMUP_BATCH_SIZE === 0) {
          // Yield between chunks so Gun/DOM are not flooded at startup.
          await sleep(FALLBACK_POST_WARMUP_BATCH_DELAY_MS);
        }
      }
      if (staged > 0) {
        console.log(`✅ Warmed ${staged} posts from MySQL fallback (chunked)`);
      }
      if (staged === 0) {
        // DB may return only index/incomplete rows; API snapshot can still restore the feed.
        return await loadPostsFromApiFallback();
      }
      return staged;
    } catch (err) {
      console.warn('⚠️  MySQL posts warmup failed:', err);
      return await loadPostsFromApiFallback();
    }
  }

  async function readExistingPostWithTimeout(gun: GunNodeLike, postId: string): Promise<Record<string, unknown> | null> {
    if (!postId) return null;
    return await new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve(null);
      }, FALLBACK_POST_EXISTING_CHECK_TIMEOUT_MS);

      gun.get('posts').get(postId).once((data: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (data && typeof data === 'object') {
          resolve(data as Record<string, unknown>);
        } else {
          resolve(null);
        }
      });
    });
  }

  function getPostActivityCount(post: Record<string, unknown>): number {
    return asNumber(post.upvotes) + asNumber(post.downvotes) + asNumber(post.commentCount);
  }

  async function shouldHydrateFallbackPost(gun: GunNodeLike, fallbackPost: Record<string, unknown>): Promise<boolean> {
    const fallbackId = asString(fallbackPost.id);
    if (!fallbackId) return false;

    const existing = await readExistingPostWithTimeout(gun, fallbackId);
    if (!existing?.id) return true;

    const fallbackCreatedAt = asNumber(fallbackPost.createdAt, 0);
    const existingCreatedAt = asNumber(existing.createdAt, 0);
    if (fallbackCreatedAt !== existingCreatedAt) {
      return fallbackCreatedAt > existingCreatedAt;
    }

    // Keep richer/more-updated interaction aggregates if root already has them.
    return getPostActivityCount(fallbackPost) > getPostActivityCount(existing);
  }

  async function hasWarmPostsLoaded(): Promise<boolean> {
    const { usePostStore } = await import('./postStore');
    const postStore = usePostStore();
    return postStore.postsMap.size > 0;
  }

  function startPostsWarmup(options?: { force?: boolean }): Promise<void> {
    const force = options?.force === true;
    if (!FALLBACK_POST_WARMUP_ENABLED && !force) {
      if (isSyncDebugEnabled()) {
        console.log('[SyncDebug] posts warmup disabled (set localStorage.interpoll_posts_warmup=true to enable)');
      }
      return Promise.resolve();
    }
    if (force && isSyncDebugEnabled()) {
      console.log('[SyncDebug] forcing posts warmup because feed is empty');
    }
    if (!postsWarmupPromise) {
      postsWarmupPromise = loadPostsFromDB().then(() => undefined).finally(() => {
        postsWarmupPromise = null;
      });
    }
    return postsWarmupPromise;
  }

  // ─── Load ──────────────────────────────────────────────────────────────────

  async function loadCommunities() {
    if (subscriptionStarted) return;
    subscriptionStarted = true;
    isLoading.value = true;
    await syncJoinedPrivateCommunitiesFromKeys();

    if (COMMUNITY_GUN_LIVE_ENABLED) {
      // Always keep the live subscription active so communities discovered
      // after bootstrap still flow into the list.
      CommunityService.subscribeToCommunitiesLive((community) => {
        logCommunityIncomingRate();
        void upsertCommunity(community);
      });

      await new Promise(r => setTimeout(r, 1500));
      await loadCommunitiesFromDB();
      // Also warm up posts so the feed isn't empty; run in background and chunked
      // to avoid flooding Gun + DOM with thousands of records at startup.
      void startPostsWarmup({ force: !(await hasWarmPostsLoaded()) });
    } else {
      if (isSyncDebugEnabled()) {
        console.log('[SyncDebug] community Gun live subscription disabled; using DB snapshot bootstrap');
      }
      await loadCommunitiesFromDB();
      void startPostsWarmup({ force: !(await hasWarmPostsLoaded()) });
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

      // Fallback: fetch from DB snapshot relay when Gun is empty/unavailable.
      if (!currentCommunity.value) {
        const relayBaseUrl = getGunRelayBaseUrl();
        const soul = encodeURIComponent(`${GUN_NAMESPACE}/communities/${communityId}`);
        const json = await fetchJsonWithTimeout<{ soul?: unknown; data?: unknown }>(
          `${relayBaseUrl}/db/soul?soul=${soul}`,
          FALLBACK_SOUL_TIMEOUT_MS,
        );
        const soulId = getTopLevelCommunitySoulId(json?.soul);
        const fallbackCommunity = soulId ? toCommunityRecord(json?.data, soulId) : null;
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
