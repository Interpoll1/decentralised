<template>
  <div class="communities-tab">

    <!-- Toolbar -->
    <div class="toolbar">
      <div class="filter-pills">
        <button
          class="filter-pill"
          :class="{ active: communityFilter === 'all' }"
          @click="$emit('update:communityFilter', 'all')"
        >All</button>
        <button
          class="filter-pill"
          :class="{ active: communityFilter === 'joined' }"
          @click="$emit('update:communityFilter', 'joined')"
        >Joined</button>
        <button
          class="filter-pill"
          :class="{ active: communityFilter === 'private' }"
          @click="$emit('update:communityFilter', 'private')"
        >Private</button>
      </div>

      <button class="new-btn" @click="$router.push('/create-community')">
        <svg viewBox="0 0 16 16" fill="none" width="12" height="12" aria-hidden="true">
          <path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
        New community
      </button>
    </div>

    <!-- Search -->
    <div class="search-wrap">
      <svg viewBox="0 0 20 20" fill="none" width="14" height="14" class="search-icon" aria-hidden="true">
        <circle cx="9" cy="9" r="6" stroke="currentColor" stroke-width="1.8"/>
        <path d="M14 14l4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      </svg>
      <input
        v-model="communitySearchQuery"
        class="search-input"
        type="search"
        placeholder="Search communities…"
        autocomplete="off"
      />
    </div>

    <!-- Loading -->
    <div v-if="communityStore.isLoading" class="loading-state">
      <div class="spinner"></div>
      <p>Loading communities…</p>
    </div>

    <template v-else>

      <!-- Featured strip: top 3 by member count, only on All tab when not searching -->
      <template v-if="!isSearching && communityFilter === 'all' && featuredCommunities.length > 0">
        <p class="section-label">Active now</p>
        <div class="featured-grid">
          <div
            v-for="c in featuredCommunities"
            :key="c.id"
            class="feat-tile"
            :class="featTone(c.id)"
            @click="$router.push(`/community/${c.id}`)"
          >
            <!-- Round glass avatar inside tile -->
            <div class="feat-avatar" :class="featTone(c.id)">
              <svg viewBox="0 0 36 36" xmlns="http://www.w3.org/2000/svg" width="36" height="36" aria-hidden="true">
                <defs>
                  <filter :id="`feat-glow-${c.id}`" x="-40%" y="-40%" width="180%" height="180%">
                    <feGaussianBlur stdDeviation="1.4" result="blur"/>
                    <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
                  </filter>
                </defs>
                <circle cx="18" cy="18" r="16.5" fill="none" stroke="currentColor" stroke-opacity="0.2" stroke-width="0.75"/>
                <path d="M8 11.5 A11 11 0 0 1 18 6.5" fill="none" stroke="currentColor" stroke-opacity="0.3" stroke-width="0.75" stroke-linecap="round"/>
                <text
                  x="18" y="23.5"
                  text-anchor="middle"
                  font-size="17"
                  font-weight="700"
                  font-style="italic"
                  font-family="Georgia,'Times New Roman',serif"
                  fill="currentColor"
                  fill-opacity="0.95"
                  :filter="`url(#feat-glow-${c.id})`"
                >{{ firstChar(c) }}</text>
              </svg>
            </div>
            <span class="feat-name">{{ c.displayName || c.name }}</span>
            <span class="feat-members">
              <svg viewBox="0 0 18 18" fill="none" width="11" height="11" aria-hidden="true">
                <circle cx="7" cy="6" r="3" stroke="currentColor" stroke-width="1.5"/>
                <path d="M1 16v-.5a6 6 0 0112 0V16" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                <circle cx="14" cy="6" r="2.2" stroke="currentColor" stroke-width="1.3" opacity="0.55"/>
                <path d="M16.5 14.5a4.5 4.5 0 00-4-2.6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" opacity="0.55"/>
              </svg>
              {{ formatNumber(c.memberCount ?? 1) }} members
              <span v-if="communityStore.isJoined(c.id)" class="joined-dot"></span>
            </span>
          </div>
        </div>
      </template>

      <!-- Search hint -->
      <p v-if="isSearching && searchResults.length > 0" class="search-hint">
        <svg viewBox="0 0 16 16" fill="none" width="12" height="12" aria-hidden="true">
          <circle cx="7" cy="7" r="5" stroke="currentColor" stroke-width="1.5"/>
          <path d="M12 12l3 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
        Searching {{ allPublicCommunities.length }} public communities
      </p>

      <!-- Section label -->
      <p
        v-if="!isSearching && filteredCommunities.length > 0"
        class="section-label"
        :style="communityFilter === 'all' && featuredCommunities.length > 0 ? 'margin-top:18px' : ''"
      >
        {{ communityFilter === 'joined' ? 'Your communities' : communityFilter === 'private' ? 'Private communities' : 'All communities' }}
      </p>

      <!-- List -->
      <div v-if="filteredCommunities.length > 0" class="community-list">
        <CommunityCard
          v-for="community in filteredCommunities"
          :key="community.id"
          :community="community"
          @click="$router.push(`/community/${community.id}`)"
        />

        <div v-if="isSearching && searchResults.some(c => !communityStore.isJoined(c.id))" class="join-nudge">
          <svg viewBox="0 0 16 16" fill="none" width="13" height="13" aria-hidden="true">
            <circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.4"/>
            <path d="M8 5v3.5m0 2.5h.01" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
          </svg>
          Communities you haven't joined won't appear in your feed — click one to join.
        </div>
      </div>

      <!-- Empty states -->
      <div v-else class="empty-state">
        <div class="empty-icon">
          <svg viewBox="0 0 24 24" fill="none" width="22" height="22" aria-hidden="true">
            <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.5"/>
            <path d="M12 8v4m0 4h.01" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
          </svg>
        </div>
        <template v-if="isSearching">
          <p class="empty-title">No results for "{{ communitySearchQuery.trim() }}"</p>
          <p class="empty-sub">Try a different name or <button class="inline-link" @click="$router.push('/create-community')">create one</button>.</p>
        </template>
        <template v-else-if="communityFilter === 'joined'">
          <p class="empty-title">No communities joined yet</p>
          <p class="empty-sub">Join communities to post and see their content in your feed.</p>
          <button class="empty-cta" @click="$emit('update:communityFilter', 'all')">Browse all</button>
        </template>
        <template v-else-if="communityFilter === 'private'">
          <p class="empty-title">No private communities</p>
          <button class="empty-cta" @click="$emit('update:communityFilter', 'joined')">Show joined</button>
        </template>
        <template v-else>
          <p class="empty-title">No communities yet</p>
          <button class="empty-cta" @click="$router.push('/create-community')">Create the first one</button>
        </template>
      </div>

    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useCommunityStore } from '../stores/communityStore';
import CommunityCard from './CommunityCard.vue';
import type { Community } from '../services/communityService';

const props = defineProps<{
  communityFilter: 'all' | 'joined' | 'private';
}>();
defineEmits<{
  (e: 'update:communityFilter', val: 'all' | 'joined' | 'private'): void;
}>();

const communityStore = useCommunityStore();
const communitySearchQuery = ref('');

const allPublicCommunities = computed(() =>
  communityStore.communities.filter(c => !c.isPrivate)
);

const displayedCommunities = computed(() => {
  const all = communityStore.communities;
  if (props.communityFilter === 'joined')  return all.filter(c => communityStore.isJoined(c.id));
  if (props.communityFilter === 'private') return all.filter(c => c.isPrivate && communityStore.isJoined(c.id));
  return all.filter(c => !c.isPrivate);
});

const isSearching = computed(() => communitySearchQuery.value.trim().length > 0);

const searchResults = computed(() => {
  const q = communitySearchQuery.value.trim().toLowerCase();
  if (!q) return [];
  return allPublicCommunities.value.filter(c =>
    c.displayName?.toLowerCase().includes(q) ||
    c.name?.toLowerCase().includes(q) ||
    c.description?.toLowerCase().includes(q),
  );
});

const filteredCommunities = computed(() =>
  isSearching.value ? searchResults.value : displayedCommunities.value
);

const featuredCommunities = computed(() =>
  [...allPublicCommunities.value]
    .sort((a, b) => (b.memberCount ?? 0) - (a.memberCount ?? 0))
    .slice(0, 3)
);

const TONES = ['tone-violet', 'tone-blue', 'tone-teal', 'tone-amber', 'tone-rose'] as const;
function featTone(id: string) {
  const code = (id || '').split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return TONES[code % TONES.length];
}
function firstChar(c: Community) {
  return (c.displayName || c.name || 'C').charAt(0).toUpperCase();
}
function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'K';
  return n.toString();
}
</script>

<style scoped>
.communities-tab {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 0 6px;
}

/* ── Toolbar ── */
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
  padding: 6px 0 10px;
}

.filter-pills {
  display: flex;
  gap: 2px;
  padding: 3px;
  background: var(--app-item-surface, rgba(255,255,255,0.04));
  border: 1px solid var(--app-border);
  border-radius: 999px;
}
.filter-pill {
  padding: 7px 16px;
  border-radius: 999px;
  border: none;
  background: transparent;
  color: var(--app-text-subtle);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background 130ms, color 130ms;
  white-space: nowrap;
}
.filter-pill:hover { color: var(--app-text); }
.filter-pill.active {
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  color: #fff;
  box-shadow: 0 1px 8px rgba(99,102,241,0.3);
}

.new-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 15px;
  border-radius: 999px;
  border: 1px solid var(--app-border);
  background: var(--app-item-surface, rgba(255,255,255,0.04));
  color: var(--app-text-muted);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background 130ms, border-color 130ms, color 130ms;
  white-space: nowrap;
}
.new-btn:hover {
  background: rgba(99,102,241,0.1);
  border-color: rgba(99,102,241,0.3);
  color: #a5b4fc;
}

/* ── Search ── */
.search-wrap {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-radius: 12px;
  background: var(--app-search-surface, rgba(255,255,255,0.05));
  border: 1px solid var(--app-border);
  transition: border-color 150ms, box-shadow 150ms;
}
.search-wrap:focus-within {
  border-color: rgba(99,102,241,0.4);
  box-shadow: 0 0 0 3px rgba(99,102,241,0.08);
}
.search-icon { color: var(--app-text-subtle); flex-shrink: 0; }
.search-input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  font-size: 14px;
  color: var(--app-text);
  font-family: inherit;
  -webkit-appearance: none;
  appearance: none;
}
.search-input::placeholder { color: var(--app-text-subtle); }
.search-input::-webkit-search-decoration,
.search-input::-webkit-search-cancel-button { -webkit-appearance: none; }

/* ── Section label ── */
.section-label {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--app-text-subtle);
  padding: 0 2px;
  margin: 0;
}

/* ── Featured tiles ── */
.featured-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}
.feat-tile {
  /* fully transparent — sits directly on aurora background */
  background: transparent;
  border: 1px solid var(--app-border);
  border-radius: 14px;
  padding: 14px 12px 12px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 8px;
  transition: background 130ms, border-color 130ms, transform 130ms;
}
.feat-tile:hover {
  background: var(--app-item-surface, rgba(255,255,255,0.04));
  border-color: var(--app-border-strong);
  transform: translateY(-1px);
}
.feat-tile:active { transform: translateY(0); }

/* Round glass avatar inside featured tile */
.feat-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  flex-shrink: 0;
  backdrop-filter: blur(10px) saturate(1.3);
  -webkit-backdrop-filter: blur(10px) saturate(1.3);
  border: 1px solid rgba(255,255,255,0.13);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.16), 0 2px 6px rgba(0,0,0,0.15);
}
.feat-avatar.tone-violet { background: rgba(99,102,241,0.18); color: #a5b4fc; }
.feat-avatar.tone-blue   { background: rgba(59,130,246,0.18); color: #93c5fd; }
.feat-avatar.tone-teal   { background: rgba(20,184,166,0.16); color: #5eead4; }
.feat-avatar.tone-amber  { background: rgba(245,158,11,0.16); color: #fcd34d; }
.feat-avatar.tone-rose   { background: rgba(236,72,153,0.16); color: #f9a8d4; }

.feat-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--app-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.feat-members {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11.5px;
  font-weight: 500;
  color: var(--app-text-subtle);
}
.joined-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--app-success, #34d399);
  margin-left: 2px;
  flex-shrink: 0;
}

/* Tile tone used only for avatar child colour — no tile bg tint  */
.feat-tile.tone-violet,
.feat-tile.tone-blue,
.feat-tile.tone-teal,
.feat-tile.tone-amber,
.feat-tile.tone-rose { background: transparent; }

/* ── Community list ── */
.community-list {
  display: flex;
  flex-direction: column;
  /* No gap — CommunityCard rows handle their own hover area */
}

/* ── Loading ── */
.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 48px 0;
  color: var(--app-text-muted);
  font-size: 14px;
}
.spinner {
  width: 24px;
  height: 24px;
  border: 2px solid rgba(99,102,241,0.2);
  border-top-color: #6366f1;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

/* ── Empty state ── */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 52px 24px;
  text-align: center;
}
.empty-icon {
  width: 50px;
  height: 50px;
  border-radius: 50%;
  background: var(--app-item-surface, rgba(255,255,255,0.04));
  border: 1px solid var(--app-border);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--app-text-muted);
}
.empty-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--app-text-muted);
  margin: 0;
}
.empty-sub {
  font-size: 13px;
  color: var(--app-text-subtle);
  margin: 0;
  line-height: 1.5;
}
.inline-link {
  background: none;
  border: none;
  padding: 0;
  color: #818cf8;
  font: inherit;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 2px;
}
.empty-cta {
  padding: 8px 20px;
  border-radius: 999px;
  border: none;
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  color: #fff;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  box-shadow: 0 4px 14px rgba(99,102,241,0.28);
  transition: opacity 130ms, transform 130ms;
}
.empty-cta:hover { opacity: 0.9; transform: translateY(-1px); }

/* ── Search hint ── */
.search-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--app-text-subtle);
  padding: 0 2px;
  margin: 0;
}

/* ── Join nudge ── */
.join-nudge {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 11px 14px;
  border-radius: 10px;
  background: rgba(99,102,241,0.06);
  border: 1px solid rgba(99,102,241,0.14);
  font-size: 12.5px;
  color: var(--app-text-muted);
  line-height: 1.5;
  margin-top: 4px;
}
.join-nudge svg { flex-shrink: 0; color: #818cf8; margin-top: 1px; }
</style>