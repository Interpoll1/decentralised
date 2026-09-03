<template>
  <nav class="app-side-nav surface-card">

    <!-- Brand -->
    <div class="asn-brand" @click="goHome">
      <span class="asn-brand-mark">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
          <path d="M12 3L4 7.5V16.5L12 21L20 16.5V7.5L12 3Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
          <path d="M12 8V16M8.5 10.5L12 12.5L15.5 10.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </span>
      <span class="asn-brand-name">Interpoll</span>
    </div>

    <!-- Primary nav -->
    <button class="asn-item" :class="{ active: activeRoute === 'home' }" @click="go('home')">
      <svg class="asn-icon" viewBox="0 0 24 24" fill="none">
        <path v-if="activeRoute==='home'" d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H5a1 1 0 01-1-1V9.5z" fill="currentColor"/>
        <path v-else d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H5a1 1 0 01-1-1V9.5z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
        <path v-if="activeRoute!=='home'" d="M9 21V13h6v8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
      </svg>
      <span>Feed</span>
    </button>

    <button class="asn-item" :class="{ active: activeRoute === 'spaces' }" @click="go('spaces')">
      <svg class="asn-icon" viewBox="0 0 24 24" fill="none">
        <circle v-if="activeRoute==='spaces'" cx="9" cy="7" r="4" fill="currentColor"/>
        <circle v-else cx="9" cy="7" r="4" stroke="currentColor" stroke-width="1.7"/>
        <path d="M3 21v-1a6 6 0 0112 0v1" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
        <path d="M16 3.13a4 4 0 010 7.74M21 21v-1a4 4 0 00-3-3.85" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
      </svg>
      <span>Spaces</span>
    </button>

    <button class="asn-item" :class="{ active: activeRoute === 'chat' }" @click="go('chat')">
      <svg class="asn-icon" viewBox="0 0 24 24" fill="none">
        <path v-if="activeRoute==='chat'" d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" fill="currentColor"/>
        <path v-else d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
      </svg>
      <span>Messages</span>
      <span v-if="totalUnread > 0" class="asn-badge">{{ totalUnread > 99 ? '99+' : totalUnread }}</span>
    </button>

    <button class="asn-item" :class="{ active: activeRoute === 'create' }" @click="go('create')">
      <svg class="asn-icon" viewBox="0 0 24 24" fill="none">
        <circle v-if="activeRoute==='create'" cx="12" cy="12" r="10" fill="currentColor"/>
        <circle v-else cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.7"/>
        <path d="M12 8v8M8 12h8" :stroke="activeRoute==='create' ? 'white' : 'currentColor'" stroke-width="1.8" stroke-linecap="round"/>
      </svg>
      <span>Publish</span>
    </button>

    <div class="asn-divider"></div>

    <!-- Categories -->
    <button class="asn-section-toggle" @click="catsOpen = !catsOpen">
      <span class="asn-section-label">Categories</span>
      <svg viewBox="0 0 24 24" fill="none" width="12" height="12"
           :style="catsOpen ? 'transform:rotate(180deg)' : ''" style="transition:transform 0.2s;flex-shrink:0">
        <path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </button>
    <template v-if="catsOpen">
      <button
        v-for="cat in (catsExpanded ? categories : categories.slice(0, 5))"
        :key="cat.id"
        class="asn-category"
        :class="{ active: activeCategory === cat.id }"
        @click="selectCat(cat.id)"
      >
        <ion-icon :icon="cat.icon" :class="'tone-' + cat.id"></ion-icon>
        <span>{{ cat.label }}</span>
      </button>
      <button class="asn-category asn-cats-more" @click="catsExpanded = !catsExpanded">
        <svg viewBox="0 0 24 24" fill="none" width="14" height="14" style="flex-shrink:0;opacity:0.5">
          <path v-if="catsExpanded" d="M18 15l-6-6-6 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
          <path v-else d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <span style="opacity:0.6;font-size:12px">{{ catsExpanded ? 'Show less' : `+${categories.length - 5} more` }}</span>
      </button>
    </template>

    <div class="asn-divider"></div>

    <!-- Utility links -->
    <button v-if="canScanQr" class="asn-item asn-util" @click="scanQr()">
      <svg class="asn-icon" viewBox="0 0 24 24" fill="none">
        <rect x="3" y="3" width="7" height="7" rx="1" stroke="currentColor" stroke-width="1.7"/>
        <rect x="14" y="3" width="7" height="7" rx="1" stroke="currentColor" stroke-width="1.7"/>
        <rect x="3" y="14" width="7" height="7" rx="1" stroke="currentColor" stroke-width="1.7"/>
        <path d="M14 14h2v2h-2zM18 14h3M14 18h3M18 18h3v3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
      </svg>
      <span>Scan QR</span>
    </button>
    <button class="asn-item asn-util" :class="{ active: activeRoute==='search' }" @click="router.push('/search')">
      <svg class="asn-icon" viewBox="0 0 24 24" fill="none">
        <circle cx="11" cy="11" r="8" stroke="currentColor" stroke-width="1.7"/>
        <path d="M21 21l-4.35-4.35" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
      </svg>
      <span>Search</span>
    </button>
    <button class="asn-item asn-util" :class="{ active: activeRoute==='profile' }" @click="router.push('/profile')">
      <svg class="asn-icon" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="8" r="4" stroke="currentColor" stroke-width="1.7"/>
        <path d="M4 20c0-4 3.58-7 8-7s8 3 8 7" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
      </svg>
      <span>Identity</span>
    </button>
    <button class="asn-item asn-util" :class="{ active: activeRoute==='settings' }" @click="router.push('/settings')">
      <svg class="asn-icon" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.7"/>
        <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" stroke="currentColor" stroke-width="1.7"/>
      </svg>
      <span>Settings</span>
    </button>
    <button class="asn-item asn-util" :class="{ active: activeRoute==='chain' }" @click="router.push('/chain-explorer')">
      <svg class="asn-icon" viewBox="0 0 24 24" fill="none">
        <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
        <path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
      </svg>
      <span>Chain Explorer</span>
    </button>

    <div class="asn-divider"></div>
    <RelayIndicator @open="$emit('open-relay')" />
  </nav>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import RelayIndicator from './RelayIndicator.vue';
import { useCategories } from '../composables/useCategories';
import { useQrScan } from '../composables/useQrScan';

const props = defineProps<{
  totalUnread?: number;
  activeTab?: string;          // for HomePage two-way binding
  activeCategory?: string;
}>();

const emit = defineEmits<{
  (e: 'update:activeTab', v: string): void;
  (e: 'open-relay'): void;
  (e: 'select-category', id: string): void;
}>();

const router = useRouter();
const route  = useRoute();

const { ALL_CATEGORIES } = useCategories();
const categories = ALL_CATEGORIES;

const { isSupported: canScanQr, scan: scanQr } = useQrScan();

const catsOpen    = ref(true);
const catsExpanded = ref(false);

// Derive active route from current path OR from activeTab prop (HomePage passes this)
const activeRoute = computed(() => {
  if (props.activeTab) return props.activeTab === 'communities' ? 'spaces' : props.activeTab;
  const p = route.path;
  if (p === '/home' || p === '/') return 'home';
  if (p.includes('communit'))      return 'spaces';
  if (p.includes('chat'))          return 'chat';
  if (p.includes('search'))        return 'search';
  if (p.includes('profile'))       return 'profile';
  if (p.includes('setting'))       return 'settings';
  if (p.includes('chain'))         return 'chain';
  return '';
});

function goHome() {
  if (props.activeTab !== undefined) emit('update:activeTab', 'home');
  else router.push('/home');
}

function go(tab: string) {
  if (props.activeTab !== undefined) {
    // HomePage mode — emit to parent
    const ionicTab = tab === 'spaces' ? 'communities' : tab;
    emit('update:activeTab', ionicTab);
  } else {
    // Subpage mode — navigate directly
    const paths: Record<string, string> = {
      home: '/home', spaces: '/home', chat: '/home', create: '/home'
    };
    router.push(paths[tab] ?? '/home');
  }
}

function selectCat(id: string) {
  emit('select-category', id);
  if (props.activeTab !== undefined) emit('update:activeTab', 'home');
}
</script>

<style scoped>
.app-side-nav {
  display: none; /* mobile: always hidden */
}

@media (min-width: 768px) {
  .app-side-nav {
    display: flex;
    flex-direction: column;
    gap: 1px;
    width: 200px;
    flex-shrink: 0;
    position: sticky;
    top: 24px;
    padding: 14px 8px 16px;
    max-height: calc(100vh - 48px);
    overflow-y: auto;
    overflow-x: hidden;
    scrollbar-width: none;
    border-radius: var(--app-radius-md, 14px);
  }
  .app-side-nav::-webkit-scrollbar { display: none; }
}

@media (min-width: 1024px) { .app-side-nav { width: 210px; } }
@media (min-width: 1280px) { .app-side-nav { width: 224px; } }

/* Brand */
.asn-brand {
  display: flex; align-items: center; gap: 10px;
  padding: 6px 10px 14px;
  cursor: pointer;
  color: var(--app-text);
  text-decoration: none;
}
.asn-brand-mark {
  width: 32px; height: 32px;
  display: flex; align-items: center; justify-content: center;
  background: var(--app-accent);
  border-radius: 8px;
  color: white;
  flex-shrink: 0;
}
.asn-brand-name {
  font-size: 17px; font-weight: 700;
  letter-spacing: -0.3px;
  color: var(--app-text);
}

/* Nav items */
.asn-item {
  display: flex; align-items: center; gap: 11px;
  padding: 9px 12px;
  border-radius: 10px;
  border: none; background: none;
  color: var(--app-text-muted);
  font-size: 14px; font-weight: 600;
  cursor: pointer;
  transition: background 120ms, color 120ms;
  position: relative;
  text-align: left;
  width: 100%;
}
.asn-item:hover {
  background: var(--app-surface-hover, rgba(255,255,255,0.06));
  color: var(--app-text);
}
.asn-item.active {
  background: var(--app-accent-subtle, rgba(99,102,241,0.15));
  color: var(--app-accent-bright);
}
.asn-icon {
  width: 20px; height: 20px;
  flex-shrink: 0;
}
.asn-util { opacity: 0.8; }
.asn-util.active { opacity: 1; }

/* Badge */
.asn-badge {
  margin-left: auto;
  background: var(--app-accent);
  color: white;
  font-size: 10px; font-weight: 700;
  padding: 1px 6px;
  border-radius: 999px;
  min-width: 18px; text-align: center;
}

/* Divider */
.asn-divider {
  height: 1px;
  margin: 6px 4px;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,0.07), transparent);
}

/* Section toggle */
.asn-section-toggle {
  display: flex; align-items: center; justify-content: space-between;
  padding: 6px 12px 4px;
  background: none; border: none;
  cursor: pointer;
  width: 100%;
}
.asn-section-label {
  font-size: 10px; font-weight: 700;
  letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--app-text-subtle, rgba(255,255,255,0.35));
}

/* Categories */
.asn-category {
  display: flex; align-items: center; gap: 10px;
  padding: 7px 12px;
  border-radius: 8px;
  border: none; background: none;
  color: var(--app-text-muted);
  font-size: 13px; font-weight: 500;
  cursor: pointer;
  transition: background 120ms, color 120ms;
  width: 100%; text-align: left;
}
.asn-category:hover { background: var(--app-surface-hover, rgba(255,255,255,0.05)); color: var(--app-text); }
.asn-category.active { color: var(--app-accent-bright); background: var(--app-accent-subtle, rgba(99,102,241,0.12)); }
.asn-category ion-icon { font-size: 15px; flex-shrink: 0; }
.asn-cats-more { opacity: 0.7; }
</style>
