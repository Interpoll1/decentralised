<template>
  <header class="atn" role="banner">
    <div class="atn-inner">
      <button class="atn-brand" aria-label="Interpoll home" @click="go('home')">
        <span class="atn-name">Interpoll</span>
      </button>

      <nav class="atn-tabs" aria-label="Primary">
        <button v-for="t in tabs" :key="t.id" class="atn-tab" :class="{ active: active === t.id }" :data-tour="t.tour" @click="go(t.id)">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" v-html="t.icon"></svg>
          <span>{{ t.label }}</span>
          <span v-if="t.id === 'chat' && (totalUnread ?? 0) > 0" class="atn-badge">{{ (totalUnread ?? 0) > 99 ? '99+' : totalUnread }}</span>
        </button>
      </nav>

      <form class="atn-search" role="search" @submit.prevent="submitSearch">
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="1.8"/><path d="M20 20l-3.5-3.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
        <input v-model="query" type="search" placeholder="Search Interpoll" aria-label="Search Interpoll" autocomplete="off" spellcheck="false" enterkeyhint="search" @focus="onSearchFocus" @input="onSearchInput" />
      </form>

      <div class="atn-actions">
        <button class="atn-publish" @click="go('create')">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>
          Publish
        </button>
        <button class="atn-icon atn-relay" aria-label="Relay & network" title="Relay & network" @click="emit('open-relay')">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 20v-8M8.5 16.5C7 15.2 6 13.2 6 11a6 6 0 0112 0c0 2.2-1 4.2-2.5 5.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/></svg>
          <RelayIndicator :compact="true" class="atn-live" />
        </button>
        <div class="atn-me">
          <button class="atn-avatar" data-tour="profile" aria-haspopup="menu" :aria-expanded="menuOpen" aria-label="Account menu" @click="menuOpen = !menuOpen">
            {{ initial }}
          </button>
          <template v-if="menuOpen">
            <div class="atn-backdrop" @click="menuOpen = false"></div>
            <div class="atn-menu" role="menu">
              <button v-for="m in menuItems" :key="m.label" class="atn-menu__item" role="menuitem" @click="pick(m.run)">
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" v-html="m.icon"></svg>{{ m.label }}
              </button>
            </div>
          </template>
        </div>
      </div>
    </div>
  </header>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { UserService } from '../services/userService';
import { useQrScan } from '../composables/useQrScan';
import RelayIndicator from './RelayIndicator.vue';

defineProps<{ totalUnread?: number }>();
const emit = defineEmits<{ (e: 'open-relay'): void }>();

const route = useRoute();
const router = useRouter();
const { isSupported: canScanQr, scan: scanQr } = useQrScan();

const query = ref('');
const menuOpen = ref(false);
const initial = ref('·');

onMounted(async () => {
  const user: any = await UserService.getCurrentUser().catch(() => null);
  const name = user?.customUsername || user?.displayName || user?.username || '';
  if (name) initial.value = String(name).charAt(0).toUpperCase();
});

type TabId = 'home' | 'orbit' | 'chat' | 'network' | 'settings';
const tabs: Array<{ id: TabId; label: string; icon: string; tour?: string }> = [
  { id: 'home', label: 'Home', tour: 'home', icon: '<path d="M4 10.5L12 4l8 6.5V19a1.5 1.5 0 01-1.5 1.5H15v-5.5a1 1 0 00-1-1h-4a1 1 0 00-1 1v5.5H5.5A1.5 1.5 0 014 19z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>' },
  { id: 'orbit', label: 'Orbit', tour: 'orbit', icon: '<circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="1.8" stroke-dasharray="2 3"/><circle cx="19" cy="9" r="1.6" fill="currentColor"/><circle cx="6" cy="17" r="1.3" fill="currentColor"/>' },
  { id: 'chat', label: 'Messages', tour: 'chat', icon: '<path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>' },
  { id: 'network', label: 'Network', icon: '<circle cx="12" cy="5.5" r="2.2" stroke="currentColor" stroke-width="1.8"/><circle cx="5.5" cy="18" r="2.2" stroke="currentColor" stroke-width="1.8"/><circle cx="18.5" cy="18" r="2.2" stroke="currentColor" stroke-width="1.8"/><path d="M11 7.4L6.5 16M13 7.4l4.5 8.6M7.7 18h8.6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>' },
  { id: 'settings', label: 'Settings', icon: '<circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.8"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>' },
];

const active = computed<TabId | ''>(() => {
  const p = route.path;
  const tab = Array.isArray(route.query.tab) ? route.query.tab[0] : route.query.tab;
  if (p === '/home' || p === '/') {
    if (tab === 'communities') return 'orbit';
    if (tab === 'orbit') return 'orbit';
    if (tab === 'chat') return 'chat';
    if (tab === 'create') return '';
    return 'home';
  }
  if (p.startsWith('/network')) return 'network';
  if (p.startsWith('/settings')) return 'settings';
  if (p.includes('communit')) return 'orbit';
  if (p.includes('chat')) return 'chat';
  return '';
});

function lastScope(): string {
  try {
    const s = localStorage.getItem('interpoll_feed_scope');
    return s && s !== 'explore' ? s : 'relay';
  } catch { return 'relay'; }
}

function go(id: TabId | 'create') {
  menuOpen.value = false;
  switch (id) {
    case 'home':    void router.push({ path: '/home', query: { scope: lastScope() } }); break;
    case 'orbit':   void router.push({ path: '/home', query: { tab: 'orbit', view: 'map' } }); break;
    case 'chat':    void router.push({ path: '/home', query: { tab: 'chat' } }); break;
    case 'network': void router.push('/network'); break;
    case 'settings': void router.push('/settings'); break;
    case 'create':  void router.push({ path: '/home', query: { tab: 'create' } }); break;
  }
}

const isDesktop = () => typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches;
let searchTimer: ReturnType<typeof setTimeout> | null = null;
// Large screens: clicking the box opens the results page right away, and typing updates it live.
function onSearchFocus() {
  if (isDesktop() && route.path !== '/search') void router.push({ path: '/search', query: query.value.trim() ? { q: query.value.trim() } : {} });
}
function onSearchInput() {
  if (!isDesktop()) return;
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    const q = query.value.trim();
    void router[route.path === '/search' ? 'replace' : 'push']({ path: '/search', query: q ? { q } : {} });
  }, 250);
}
watch(() => route.query.q, (q) => { if (route.path === '/search' && typeof q === 'string' && q !== query.value.trim()) query.value = q; });

function submitSearch() {
  const q = query.value.trim();
  void router.push(q ? { path: '/search', query: { q } } : { path: '/search' });
}

function pick(run: () => void) { menuOpen.value = false; run(); }

const menuItems = computed(() => {
  const items: Array<{ label: string; icon: string; run: () => void }> = [
    { label: 'Identity', icon: '<circle cx="12" cy="8" r="4" stroke="currentColor" stroke-width="1.7"/><path d="M4 20c0-4 3.58-7 8-7s8 3 8 7" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>', run: () => void router.push('/profile') },
    { label: 'Resilience Center', icon: '<path d="M12 2l8 3v6c0 5-3.4 8.4-8 11-4.6-2.6-8-6-8-11V5l8-3z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>', run: () => void router.push('/resilience') },
    { label: 'Chain Explorer', icon: '<path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>', run: () => void router.push('/chain-explorer') },
  ];
  if (canScanQr) {
    items.splice(1, 0, { label: 'Scan QR', icon: '<rect x="3" y="3" width="7" height="7" rx="1" stroke="currentColor" stroke-width="1.7"/><rect x="14" y="3" width="7" height="7" rx="1" stroke="currentColor" stroke-width="1.7"/><rect x="3" y="14" width="7" height="7" rx="1" stroke="currentColor" stroke-width="1.7"/><path d="M14 14h2v2h-2zM18 14h3M14 18h3M18 18h3v3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>', run: () => void scanQr() });
  }
  return items;
});
</script>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=Grand+Hotel&display=swap');
/* Desktop only — phones keep the Ionic header and bottom nav. */
.atn { display: none; }

@media (min-width: 768px) {
  .atn {
    display: block;
    position: sticky; top: 0; z-index: 50;
    background: rgba(9, 11, 10, 0.86);
    backdrop-filter: blur(18px) saturate(1.2);
    -webkit-backdrop-filter: blur(18px) saturate(1.2);
    border-bottom: 1px solid var(--app-border);
  }
  .atn-inner {
    display: flex; align-items: center; gap: 18px;
    width: min(1320px, calc(100% - 64px)); height: 68px; margin: 0 auto;
  }
}

.atn-brand { display: flex; align-items: center; gap: 9px; padding: 0; background: none; border: none; color: var(--app-text); cursor: pointer; font: inherit; }
.atn-name { font-family: 'Grand Hotel', cursive; font-size: 32px; font-weight: 400 !important; letter-spacing: 0.01em !important; line-height: 1; text-shadow: none !important; }

.atn-tabs { display: flex; align-items: center; gap: 2px; margin-left: 36px; }
.atn-tab {
  position: relative; display: inline-flex; align-items: center; gap: 7px; height: 34px; padding: 0 12px;
  border: none; border-radius: 9px; background: none; cursor: pointer; font: inherit; font-size: 13.5px; font-weight: 600;
  color: var(--app-text-muted); transition: background 120ms, color 120ms;
}
.atn-tab svg { width: 17px; height: 17px; flex-shrink: 0; }
.atn-tab:hover { color: var(--app-text); background: rgba(255, 255, 255, 0.05); }
.atn-tab.active { color: var(--app-accent); background: rgba(var(--app-accent-rgb), 0.1); }
.atn-badge {
  min-width: 17px; height: 17px; padding: 0 5px; border-radius: 999px; display: inline-flex; align-items: center; justify-content: center;
  background: var(--app-accent); color: #04120a; font-size: 10.5px; font-weight: 800;
}

.atn-search {
  flex: 1; max-width: 360px; margin: 0 auto; height: 36px; display: flex; align-items: center; gap: 8px; padding: 0 12px;
  border-radius: 999px; padding: 0 16px; background: rgba(255, 255, 255, 0.04); border: 1px solid var(--app-border); color: var(--app-text-subtle);
  transition: border-color 120ms, background 120ms, box-shadow 120ms;
}
.atn-search:focus-within { border-color: rgba(var(--app-accent-rgb), 0.5); background: rgba(255, 255, 255, 0.06); box-shadow: 0 0 0 3px rgba(var(--app-accent-rgb), 0.12); }
.atn-search svg { width: 16px; height: 16px; flex-shrink: 0; }
.atn-search input { flex: 1; min-width: 0; height: 100%; background: none; border: none; outline: none; color: var(--app-text); font: inherit; font-size: 13.5px; }
.atn-search input::placeholder { color: var(--app-text-subtle); }
.atn-search input::-webkit-search-cancel-button { display: none; }

.atn-actions { display: flex; align-items: center; gap: 10px; margin-left: auto; }
.atn-publish {
  display: inline-flex; align-items: center; gap: 6px; height: 34px; padding: 0 14px; border: none; border-radius: 9px; cursor: pointer;
  background: var(--app-accent); color: #04120a; font: inherit; font-size: 13.5px; font-weight: 700; transition: filter 120ms, transform 120ms;
}
.atn-publish svg { width: 15px; height: 15px; }
.atn-publish:hover { filter: brightness(1.08); }
.atn-publish:active { transform: scale(0.97); }
.atn-icon {
  position: relative; width: 34px; height: 34px; display: grid; place-items: center; border: none; border-radius: 50%; cursor: pointer;
  background: none; color: var(--app-text-muted); transition: background 120ms, color 120ms;
}
.atn-icon svg { width: 19px; height: 19px; }
.atn-icon:hover { background: rgba(255, 255, 255, 0.06); color: var(--app-text); }
.atn-relay { position: relative; }
.atn-live { position: absolute; top: 5px; right: 5px; pointer-events: none; }
.atn-icon--dot::after { content: ''; position: absolute; top: 7px; right: 8px; width: 8px; height: 8px; border-radius: 50%; background: var(--app-accent); box-shadow: 0 0 0 2px #0b0e0c; }

.atn-me { position: relative; }
.atn-avatar {
  width: 32px; height: 32px; border-radius: 50%; border: 1px solid rgba(var(--app-accent-rgb), 0.45); cursor: pointer;
  background: linear-gradient(135deg, #1c3a2a, #0f2218); color: var(--app-accent); font: inherit; font-size: 13px; font-weight: 800;
}
.atn-backdrop { position: fixed; inset: 0; z-index: 90; }
.atn-menu {
  position: absolute; right: 0; top: calc(100% + 8px); z-index: 100; min-width: 210px; padding: 6px;
  border-radius: 12px; background: var(--app-bg-elevated); border: 1px solid var(--app-border-strong); box-shadow: var(--app-shadow-lg);
}
.atn-menu__item {
  display: flex; align-items: center; gap: 11px; width: 100%; padding: 9px 11px; border: none; border-radius: 8px; background: none;
  color: var(--app-text); font: inherit; font-size: 13.5px; font-weight: 550; text-align: left; cursor: pointer;
}
.atn-menu__item svg { width: 17px; height: 17px; color: var(--app-text-muted); flex-shrink: 0; }
.atn-menu__item:hover { background: rgba(var(--app-accent-rgb), 0.09); }
.atn-menu__item:hover svg { color: var(--app-accent); }

@media (max-width: 1023px) {
  .atn-tab span:not(.atn-badge) { display: none; }
  .atn-tab { padding: 0 10px; }
  .atn-search { max-width: 220px; }
}
</style>