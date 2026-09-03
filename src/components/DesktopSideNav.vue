<template>
  <nav class="side-nav surface-card" :class="{ collapsed: isCollapsed }">

    <!-- Brand -->
    <div class="side-nav-brand" @click="goHome()">
      <span class="side-nav-brand-mark" aria-hidden="true">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
          <path d="M12 3L4 7.5V16.5L12 21L20 16.5V7.5L12 3Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
          <path d="M12 8V16M8.5 10.5L12 12.5L15.5 10.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </span>
      <span class="side-nav-brand-name">Interpoll</span>
    </div>

    <!-- Collapse toggle -->
    <button class="side-nav-collapse-btn" @click="isCollapsed = !isCollapsed" :title="isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'">
      <svg viewBox="0 0 24 24" fill="none" width="14" height="14">
        <path v-if="!isCollapsed" d="M11 19l-7-7 7-7M18 19l-7-7 7-7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
        <path v-else              d="M13 5l7 7-7 7M6 5l7 7-7 7"  stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <span v-if="!isCollapsed">Collapse</span>
    </button>

    <!-- Primary nav -->
    <button class="side-nav-item" :class="{ active: activeTab === 'home' }" @click="goTab('home')">
      <ion-icon :icon="activeTab === 'home' ? home : homeOutline"></ion-icon>
      <span>Feed</span>
    </button>
    <button class="side-nav-item" :class="{ active: activeTab === 'communities' }" @click="goTab('communities')">
      <ion-icon :icon="activeTab === 'communities' ? people : peopleOutline"></ion-icon>
      <span>Spaces</span>
    </button>
    <button class="side-nav-item" :class="{ active: activeTab === 'chat' }" @click="goTab('chat')">
      <ion-icon :icon="activeTab === 'chat' ? chatbubble : chatbubbleOutline"></ion-icon>
      <span>Messages</span>
    </button>
    <button class="side-nav-item" :class="{ active: activeTab === 'create' }" @click="goTab('create')">
      <ion-icon :icon="activeTab === 'create' ? addCircle : addCircleOutline"></ion-icon>
      <span>Publish</span>
    </button>

    <div class="side-nav-divider"></div>

    <!-- Browse scope -->
    <p class="side-nav-section-label">Browse</p>
    <button class="side-nav-item side-nav-util" :class="{ active: activeTab === 'home' && selectedScope === 'mine' }"  @click="goScope('mine')">
      <svg class="nav-svg-icon" viewBox="0 0 24 24" fill="none" width="18" height="18">
        <path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <span>My Spaces</span>
    </button>
    <button class="side-nav-item side-nav-util" :class="{ active: activeTab === 'home' && selectedScope === 'relay' }" @click="goScope('relay')">
      <svg class="nav-svg-icon" viewBox="0 0 24 24" fill="none" width="18" height="18">
        <circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.8"/>
        <path d="M12 2a10 10 0 100 20A10 10 0 0012 2z" stroke="currentColor" stroke-width="1.8"/>
        <path d="M2 12h20M12 2c-3 3-4.5 6.5-4.5 10S9 19 12 22c3-3 4.5-6.5 4.5-10S15 5 12 2z" stroke="currentColor" stroke-width="1.8"/>
      </svg>
      <span>This Relay</span>
    </button>
    <button class="side-nav-item side-nav-util" :class="{ active: activeTab === 'home' && selectedScope === 'explore' }" @click="goScope('explore')">
      <svg class="nav-svg-icon" viewBox="0 0 24 24" fill="none" width="18" height="18">
        <circle cx="11" cy="11" r="8" stroke="currentColor" stroke-width="1.8"/>
        <path d="M21 21l-4.35-4.35" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      </svg>
      <span>Explore</span>
    </button>

    <div class="side-nav-divider"></div>

    <!-- Categories — collapsible -->
    <button class="side-nav-section-toggle" @click="categoriesOpen = !categoriesOpen">
      <p class="side-nav-section-label" style="margin:0">Categories</p>
      <svg viewBox="0 0 24 24" fill="none" width="12" height="12" :style="categoriesOpen ? 'transform:rotate(180deg)' : ''">
        <path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </button>

    <template v-if="categoriesOpen && !isCollapsed">
      <button
        v-for="cat in ALL_CATEGORIES"
        :key="cat.id"
        class="side-nav-category"
        :class="{ active: selectedCategory === cat.id }"
        @click="goCategory(cat.id)"
        :title="cat.label"
      >
        <ion-icon :icon="cat.icon" :class="'tone-' + cat.id" style="font-size:15px;flex-shrink:0"></ion-icon>
        <span>{{ cat.label }}</span>
      </button>
    </template>

    <div class="side-nav-divider"></div>

    <!-- Utility -->
    <button class="side-nav-item side-nav-util" @click="$router.push('/search')">
      <ion-icon :icon="searchOutline"></ion-icon>
      <span>Search</span>
    </button>
    <button class="side-nav-item side-nav-util" @click="$router.push('/profile')">
      <ion-icon :icon="personCircleOutline"></ion-icon>
      <span>Identity</span>
    </button>
    <button class="side-nav-item side-nav-util" @click="$router.push('/settings')">
      <ion-icon :icon="settingsOutline"></ion-icon>
      <span>Settings</span>
    </button>
    <button class="side-nav-item side-nav-util" @click="$router.push('/chain-explorer')">
      <ion-icon :icon="cube"></ion-icon>
      <span>Chain Explorer</span>
    </button>

    <div class="side-nav-divider"></div>

    <!-- Relay indicator -->
    <RelayIndicator @open="$emit('openRelaySheet')" />
  </nav>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { IonIcon } from '@ionic/vue';
import { useRouter } from 'vue-router';
import {
  home, homeOutline, people, peopleOutline, chatbubble, chatbubbleOutline,
  addCircle, addCircleOutline, searchOutline, personCircleOutline, settingsOutline,
  cube, tvOutline, musicalNotesOutline, starOutline, bookOutline, helpCircleOutline,
  chatbubblesOutline, businessOutline, codeSlashOutline, flaskOutline, cashOutline,
  heartOutline, trophyOutline, leafOutline, schoolOutline, logoBitcoin,
  gameControllerOutline, happyOutline, megaphoneOutline, newspaperOutline,
} from 'ionicons/icons';
import RelayIndicator from './RelayIndicator.vue';

defineProps<{
  activeTab?:       string;
  selectedScope?:   string;
  selectedCategory?: string;
}>();
defineEmits<{ openRelaySheet: [] }>();

const router = useRouter();

// Sidebar collapse — default open on desktop, closed on tablet
const isCollapsed    = ref(window.innerWidth < 900);
const categoriesOpen = ref(true);

function goHome()            { router.push('/home'); }
function goTab(tab: string)  { router.push({ path: '/home', query: { tab } }); }
function goScope(scope: string) {
  localStorage.setItem('interpoll_feed_scope', scope);
  router.push({ path: '/home', query: { tab: 'home', scope } });
}
function goCategory(id: string) {
  router.push({ path: '/home', query: { tab: 'home', category: id } });
}

// ── Updated category list matching new schema ──────────────────────────────
const ALL_CATEGORIES = [
  { id: 'politics',     label: 'Politics',     icon: businessOutline },
  { id: 'technology',   label: 'Technology',   icon: codeSlashOutline },
  { id: 'science',      label: 'Science',      icon: flaskOutline },
  { id: 'finance',      label: 'Finance',      icon: cashOutline },
  { id: 'health',       label: 'Health',       icon: heartOutline },
  { id: 'sports',       label: 'Sports',       icon: trophyOutline },
  { id: 'environment',  label: 'Environment',  icon: leafOutline },
  { id: 'education',    label: 'Education',    icon: schoolOutline },
  { id: 'crypto',       label: 'Crypto',       icon: logoBitcoin },
  { id: 'gaming',       label: 'Gaming',       icon: gameControllerOutline },
  { id: 'opinion',      label: 'Opinion',      icon: chatbubblesOutline },
  { id: 'humour',       label: 'Humour',       icon: happyOutline },
  { id: 'movies-tv',    label: 'Movies & TV',  icon: tvOutline },
  { id: 'music',        label: 'Music',        icon: musicalNotesOutline },
  { id: 'celebrity',    label: 'Celebrity',    icon: starOutline },
  { id: 'story',        label: 'Story',        icon: bookOutline },
  { id: 'ask',          label: 'Ask',          icon: helpCircleOutline },
  { id: 'discussion',   label: 'Discussion',   icon: megaphoneOutline },
  { id: 'news',         label: 'News',         icon: newspaperOutline },
];
</script>

<style scoped>
/* ── Self-contained layout — works on any page, not just hp-root ── */

.side-nav {
  display: none; /* mobile: hidden */
}

@media (min-width: 768px) {
  .side-nav {
    display: flex;
    flex-direction: column;
    gap: 2px;
    width: 190px;
    flex-shrink: 0;
    position: sticky;
    top: 24px;
    padding: 16px 10px 20px;
    max-height: calc(100vh - 48px);
    overflow-y: auto;
    border-radius: var(--app-radius-md, 14px);
    /* Override surface-card border-radius to use md not lg */
    --app-radius-lg: var(--app-radius-md, 14px);
  }
}

@media (min-width: 1024px) { .side-nav { width: 210px; } }
@media (min-width: 1280px) { .side-nav { width: 220px; } }

.side-nav-section-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 14px 4px;
  background: none;
  border: none;
  cursor: pointer;
  width: 100%;
}
.side-nav-section-toggle svg { color: var(--app-text-subtle); transition: transform 0.2s; flex-shrink: 0; }

.side-nav-collapse-btn {
  display: none; /* shown only at ≥768px via HomePage.css */
}

.nav-svg-icon { flex-shrink: 0; color: currentColor; }

@media (min-width: 768px) {
  .side-nav-collapse-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    background: none;
    border: none;
    color: var(--app-text-subtle);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    cursor: pointer;
    padding: 4px 14px 8px;
    transition: color 0.15s;
    width: 100%;
  }
  .side-nav-collapse-btn:hover { color: var(--app-text); }

  /* Collapsed: hide text labels, section labels, dividers */
  .side-nav.collapsed .side-nav-brand-name,
  .side-nav.collapsed .side-nav-item > span,
  .side-nav.collapsed .side-nav-util > span,
  .side-nav.collapsed .side-nav-section-label,
  .side-nav.collapsed .side-nav-section-toggle p,
  .side-nav.collapsed .side-nav-section-toggle svg,
  .side-nav.collapsed .side-nav-category,
  .side-nav.collapsed .side-nav-divider,
  .side-nav.collapsed .side-nav-collapse-btn span { display: none; }

  .side-nav.collapsed { width: 58px; padding: 16px 6px 20px; }
  .side-nav.collapsed .side-nav-brand  { justify-content: center; padding: 6px 4px 14px; }
  .side-nav.collapsed .side-nav-item,
  .side-nav.collapsed .side-nav-util   { justify-content: center; padding: 10px; }
  .side-nav.collapsed .side-nav-collapse-btn { justify-content: center; padding: 4px; }
}
</style>
