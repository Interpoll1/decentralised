<template>
  <div class="communities-tab">

    <!-- Toolbar: filter pills + new community btn -->
    <div class="communities-toolbar">
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

      <button class="new-community-btn" @click="$router.push('/create-community')">
        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
        </svg>
        New Community
      </button>
    </div>

    <!-- Search bar -->
    <div class="search-wrap">
      <svg class="search-icon" viewBox="0 0 24 24" fill="none">
        <circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2"/>
        <path d="M16.5 16.5L21 21" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      </svg>
      <input
        v-model="communitySearchQuery"
        class="search-input"
        type="search"
        placeholder="Search all communities…"
        autocomplete="off"
      />
    </div>

    <!-- Loading -->
    <div v-if="communityStore.isLoading" class="loading-state">
      <div class="spinner"></div>
      <p>Loading communities…</p>
    </div>

    <!-- Search scope hint — shown while searching -->
    <div v-else-if="isSearching && searchResults.length > 0" class="search-scope-hint">
      <svg viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="1.5"/><path d="M21 21l-4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      Searching all {{ allPublicCommunities.length }} public communities
    </div>

    <!-- List -->
    <div v-if="!communityStore.isLoading && filteredCommunities.length > 0" class="communities-list">
      <CommunityCard
        v-for="community in filteredCommunities"
        :key="community.id"
        :community="community"
        @click="$router.push(`/community/${community.id}`)"
      />
      <!-- Join nudge shown at the bottom of search results for unjoined hits -->
      <div v-if="isSearching && searchResults.some(c => !communityStore.isJoined(c.id))" class="join-nudge">
        <svg viewBox="0 0 24 24" fill="none"><path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        Communities you haven't joined won't appear in your feed or Create tab — click one above to join.
      </div>
    </div>

    <!-- Empty -->
    <div v-else-if="!communityStore.isLoading && filteredCommunities.length === 0" class="empty-state">
      <div class="empty-icon">
        <ion-icon :icon="earthOutline"></ion-icon>
      </div>

      <!-- No search results -->
      <template v-if="isSearching">
        <p class="empty-title">No communities match "{{ communitySearchQuery.trim() }}"</p>
        <p class="empty-sub">Try a different name or <button class="inline-link" @click="$router.push('/create-community')">create one</button>.</p>
      </template>

      <!-- Joined tab empty -->
      <template v-else-if="communityFilter === 'joined'">
        <p class="empty-title">You haven't joined any communities yet</p>
        <p class="empty-sub">Join communities to see them here and post from the Create tab.</p>
        <button class="empty-cta" @click="$emit('update:communityFilter', 'all')">Browse all communities</button>
      </template>

      <!-- Private tab empty -->
      <template v-else-if="communityFilter === 'private'">
        <p class="empty-title">No private communities joined</p>
        <button class="empty-cta" @click="$emit('update:communityFilter', 'joined')">Show Joined</button>
      </template>

      <!-- All tab empty -->
      <template v-else>
        <p class="empty-title">No public communities yet</p>
        <button class="empty-cta" @click="$router.push('/create-community')">Create the first one</button>
      </template>
    </div>

  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { IonIcon } from '@ionic/vue';
import { earthOutline } from 'ionicons/icons';
import { useCommunityStore } from '../stores/communityStore';
import CommunityCard from './CommunityCard.vue';

const props = defineProps<{
  communityFilter: 'all' | 'joined' | 'private';
}>();
defineEmits<{
  (e: 'update:communityFilter', val: 'all' | 'joined' | 'private'): void;
}>();

const communityStore = useCommunityStore();
const communitySearchQuery = ref('');

// Default view: respects the active filter tab
const displayedCommunities = computed(() => {
  const all = communityStore.communities;
  if (props.communityFilter === 'joined')  return all.filter(c => communityStore.isJoined(c.id));
  if (props.communityFilter === 'private') return all.filter(c => c.isPrivate && communityStore.isJoined(c.id));
  return all.filter(c => !c.isPrivate);
});

// Search always spans ALL public communities regardless of the active filter tab,
// so users can discover and find communities they haven't joined yet.
const allPublicCommunities = computed(() =>
  communityStore.communities.filter(c => !c.isPrivate)
);

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
</script>

<style scoped>
.communities-tab {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* ── Toolbar ─────────────────────────────────── */
.communities-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}

/* Filter pills */
.filter-pills {
  display: flex;
  gap: 4px;
  padding: 4px;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.07);
  border-radius: 999px;
}

.filter-pill {
  padding: 6px 16px;
  border-radius: 999px;
  border: none;
  background: transparent;
  color: var(--app-text-muted);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background 160ms ease, color 160ms ease;
  white-space: nowrap;
}
.filter-pill:hover { color: var(--app-text); }
.filter-pill.active {
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  color: #fff;
  box-shadow: 0 2px 10px rgba(99,102,241,0.35);
}

/* New Community button */
.new-community-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border-radius: 999px;
  border: none;
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  color: #fff;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: -0.01em;
  cursor: pointer;
  box-shadow: 0 4px 14px rgba(99,102,241,0.38), inset 0 1px 0 rgba(255,255,255,0.18);
  transition: opacity 160ms ease, transform 160ms ease;
  white-space: nowrap;
}
.new-community-btn:hover { opacity: 0.9; transform: translateY(-1px); }
.new-community-btn:active { transform: translateY(0); }
.new-community-btn svg { width: 14px; height: 14px; flex-shrink: 0; }

/* ── Search bar ──────────────────────────────── */
.search-wrap {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-radius: 999px;
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.09);
  transition: border-color 180ms ease, box-shadow 180ms ease;
  outline: none;
  -webkit-tap-highlight-color: transparent;
}
.search-wrap:focus-within {
  border-color: rgba(99,102,241,0.45);
  box-shadow: 0 0 0 3px rgba(99,102,241,0.1);
  outline: none;
}
.search-wrap:focus {
  outline: none;
}
.search-icon {
  width: 16px;
  height: 16px;
  color: var(--app-text-subtle);
  flex-shrink: 0;
}
.search-input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  box-shadow: none;
  font-size: 14px;
  color: var(--ion-text-color);
  font-family: inherit;
  -webkit-appearance: none;
  appearance: none;
}
.search-input:focus { outline: none; box-shadow: none; }
.search-input::placeholder { color: var(--app-text-subtle); }
.search-input::-webkit-search-cancel-button { cursor: pointer; }
.search-input::-webkit-search-decoration { -webkit-appearance: none; }

/* ── List ────────────────────────────────────── */
.communities-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* ── Loading ─────────────────────────────────── */
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
  width: 28px;
  height: 28px;
  border: 2.5px solid rgba(99,102,241,0.2);
  border-top-color: #6366f1;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

/* ── Empty state ─────────────────────────────── */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 56px 24px;
  text-align: center;
}
.empty-icon {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: rgba(99,102,241,0.1);
  border: 1px solid rgba(99,102,241,0.2);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #818cf8;
  font-size: 26px;
}
.empty-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--app-text-muted);
  margin: 0;
}
.empty-sub {
  font-size: 13px;
  color: var(--app-text-subtle);
  margin: 0;
  text-align: center;
  line-height: 1.5;
}
.inline-link {
  background: none;
  border: none;
  padding: 0;
  color: #818cf8;
  font-size: inherit;
  font-family: inherit;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 2px;
}

/* Search scope hint */
.search-scope-hint {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  color: var(--app-text-subtle);
  padding: 0 2px;
}
.search-scope-hint svg {
  width: 13px;
  height: 13px;
  flex-shrink: 0;
  opacity: 0.6;
}

/* Join nudge at bottom of search results */
.join-nudge {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  padding: 12px 14px;
  border-radius: 12px;
  background: rgba(99, 102, 241, 0.07);
  border: 1px solid rgba(99, 102, 241, 0.18);
  font-size: 12.5px;
  color: var(--app-text-muted);
  line-height: 1.5;
}
.join-nudge svg {
  width: 15px;
  height: 15px;
  flex-shrink: 0;
  color: #818cf8;
  margin-top: 1px;
}
.empty-cta {
  padding: 9px 22px;
  border-radius: 999px;
  border: none;
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  color: #fff;
  font-size: 13.5px;
  font-weight: 700;
  cursor: pointer;
  box-shadow: 0 4px 14px rgba(99,102,241,0.35);
  transition: opacity 160ms ease, transform 160ms ease;
}
.empty-cta:hover { opacity: 0.9; transform: translateY(-1px); }
</style>