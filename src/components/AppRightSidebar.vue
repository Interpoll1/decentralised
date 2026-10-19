<template>
  <aside class="app-right-sidebar">

    <!-- Explore spaces -->
    <section class="ars-section">
      <header class="ars-header">
        <h2>Explore spaces</h2>
        <button class="ars-link" @click="router.push('/home?tab=orbit&view=spaces')">See all</button>
      </header>
      <div class="ars-list">
        <button
          v-for="c in communities.slice(0, 4)"
          :key="c.id"
          class="ars-row ars-space"
          @click="router.push(`/community/${c.id}`)"
        >
          <span class="ars-avatar" :class="avatarTone(c)">
            <template v-if="!(c as any).isPrivate">{{ (c.displayName || c.name || 'C').charAt(0).toUpperCase() }}</template>
            <svg v-else viewBox="0 0 24 24" fill="none" width="14" height="14" aria-hidden="true">
              <rect x="3" y="11" width="18" height="11" rx="2" stroke="currentColor" stroke-width="2"/>
              <path d="M7 11V7a5 5 0 0110 0v4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
          </span>
          <span class="ars-info">
            <span class="ars-name">{{ c.displayName || c.name }}</span>
            <span class="ars-meta">{{ formatNumber(c.memberCount) }} {{ c.memberCount === 1 ? 'member' : 'members' }}</span>
            <span v-if="c.description" class="ars-desc">{{ c.description }}</span>
          </span>
          <svg class="ars-chev" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <p v-if="!communities.length" class="ars-empty">No spaces yet — create the first one.</p>
      </div>
      <button class="ars-create" @click="router.push('/create-community')">
        <svg viewBox="0 0 24 24" fill="none" width="14" height="14" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>
        Create space
      </button>
    </section>

    <!-- Topics gaining momentum -->
    <section class="ars-section">
      <header class="ars-header">
        <h2>Topics gaining momentum</h2>
        <span class="ars-pill">This week</span>
      </header>
      <div v-if="trendingLoaded" class="ars-list">
        <button
          v-for="row in trendingCategories"
          :key="row.tag || row.id"
          class="ars-row ars-topic"
          @click="router.push(row.tag ? `/home?tag=${row.tag}` : `/home?category=${row.id}`)"
        >
          <ion-icon v-if="row.icon" :icon="row.icon" :class="row.tone" class="ars-topic__icon"></ion-icon>
          <span class="ars-topic__label">{{ row.label }}</span>
          <span v-if="row.posts" class="ars-topic__count">{{ row.posts }} {{ row.posts === '1' ? 'post' : 'posts' }}</span>
          <svg class="ars-chev" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <p v-if="!trendingCategories.length" class="ars-empty">Topics appear once posts are categorised.</p>
      </div>
      <div v-else class="ars-skeleton">
        <div v-for="i in 4" :key="i" class="ars-skeleton-row"></div>
      </div>
    </section>

    <!-- About Interpoll -->
    <section class="ars-section ars-about">
      <div class="ars-about-row">
        <div class="ars-about-text">
          <h2>Interpoll</h2>
          <p>A peer-to-peer network built on GunDB. Content syncs across all peers — no central server required.</p>
          <button class="ars-link ars-about-link" @click="router.push('/resilience')">Learn more →</button>
        </div>
        <BitMascot :size="56" :mood="bitMood" :title="bit.hasUsername === false ? 'Claim a username' : ''" :style="bit.hasUsername === false ? 'cursor:pointer' : ''" @click="onBitClick" />
      </div>
    </section>

  </aside>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { IonIcon } from '@ionic/vue';
import { useCommunityStore } from '../stores/communityStore';
import { usePostStore } from '../stores/postStore';
import { usePollStore } from '../stores/pollStore';
import { CATEGORY_MAP } from '../composables/useCategories';
import { ModerationService, moderationVersion } from '../services/moderationService';
import config from '../config';
import BitMascot from './BitMascot.vue';
import { useBitStore } from '../stores/bitStore';

const router = useRouter();
const bit = useBitStore();
// Bit perks up when you still need a username; clicking him takes you there.
const bitMood = computed(() => (bit.hasUsername === false ? 'alert' : 'idle'));
function onBitClick() { if (bit.hasUsername === false) void router.push('/claim-username'); }
const communityStore = useCommunityStore();

const communities = computed(() => communityStore.communities);

function avatarTone(c: any): string {
  if (c.isPrivate) return 'tone-private';
  const cat = String(c.category || c.tags?.[0] || '').toLowerCase();
  if (cat.includes('tech') || cat.includes('program')) return 'tone-tech';
  if (cat.includes('politic')) return 'tone-politics';
  if (cat.includes('nsfw') || c.nsfw) return 'tone-nsfw';
  // Hash-based fallback
  const TONES = ['tone-violet','tone-blue','tone-teal','tone-amber','tone-rose'];
  const code = (c.id || '').split('').reduce((a: number, ch: string) => a + ch.charCodeAt(0), 0);
  return TONES[code % TONES.length];
}

function formatNumber(n: number | undefined | null): string {
  const v = n ?? 0;
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(1) + 'M';
  if (v >= 1_000)     return (v / 1_000).toFixed(1) + 'K';
  return v.toString();
}

const postStore = usePostStore();
const pollStore = usePollStore();

type TrendRow = { id: string; tag: string; label: string; posts: string; icon: any; tone: string; hot: boolean };
const relayTrending = ref<TrendRow[]>([]);
const relayLoaded = ref(false);

// Counts come from content this client actually holds, so they match what
// the feed shows when a category is clicked. Relay aggregate is a fallback.
const localTrending = computed<TrendRow[]>(() => {
  // Mirror HomePage.combinedFeed: skip moderation-blocked items and only
  // count selectable categories (exact-match, same as the feed filter).
  moderationVersion.value;
  const counts = new Map<string, number>();
  const bump = (c: unknown, text: string) => {
    if (typeof c !== 'string' || !CATEGORY_MAP.has(c)) return;
    if (ModerationService.isPostBodyBlocked(text)) return;
    counts.set(c, (counts.get(c) ?? 0) + 1);
  };
  for (const p of postStore.sortedPosts as any[])
    bump(p.category, [p.title, p.content].filter(Boolean).join(' '));
  for (const p of pollStore.sortedPolls as any[]) {
    if (p.isPrivate) continue;
    bump(p.category, [p.question, p.description, ...(p.options || []).map((o: any) => o.text)].filter(Boolean).join(' '));
  }
  return [...counts.entries()]
    .sort((x, y) => y[1] - x[1])
    .slice(0, 5)
    .map(([id, n]) => {
      const def = CATEGORY_MAP.get(id);
      return { id, tag: '', label: def?.label || id, posts: String(n), icon: def?.icon,
               tone: def?.tone || 'tone-default', hot: false };
    });
});

const trendingCategories = computed(() =>
  localTrending.value.length ? localTrending.value : relayTrending.value);
const trendingLoaded = computed(() => localTrending.value.length > 0 || relayLoaded.value);

onMounted(async () => {
  try {
    const res = await fetch(`${config.relay.api}/api/trending-categories`);
    if (res.ok) {
      const data = await res.json();
      const rows = Array.isArray(data) ? data : (data.categories || []);
      relayTrending.value = rows
        .filter((row: any) => CATEGORY_MAP.has(row.id || row.category))
        .slice(0, 5).map((row: any) => {
        const def = CATEGORY_MAP.get(row.id || row.category);
        return { id: row.id || '', tag: '', label: def?.label || row.label || row.id || '',
                 posts: String(row.posts || row.count || ''), icon: def?.icon,
                 tone: def?.tone || 'tone-default', hot: false };
      });
    }
  } catch { /* silent */ } finally {
    relayLoaded.value = true;
  }
});
</script>

<style scoped>
.app-right-sidebar {
  display: none; /* hidden on mobile */
}

@media (min-width: 768px) {
  .app-right-sidebar {
    display: flex;
    flex-direction: column;
    gap: 12px;
    width: 240px;
    flex-shrink: 0;
    position: sticky;
    top: 72px;
    align-self: flex-start;
    max-height: calc(100vh - 88px);
    overflow-y: auto;
    scrollbar-width: none;
  }
  .app-right-sidebar::-webkit-scrollbar { display: none; }
}

@media (min-width: 1024px) { .app-right-sidebar { width: 268px; } }
@media (min-width: 1280px) { .app-right-sidebar { width: 288px; } }

.ars-section {
  padding: 14px;
  border-radius: 14px;
  background: var(--app-bg-elevated);
  border: 1px solid var(--app-border);
}

.ars-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
.ars-header h2, .ars-about h2 { margin: 0; font-size: 13.5px; font-weight: 700; letter-spacing: -0.005em; color: var(--app-text); }
.ars-link { background: none; border: none; cursor: pointer; color: var(--app-accent); font: inherit; font-size: 12px; font-weight: 600; padding: 0; }
.ars-pill {
  padding: 3px 9px; border-radius: 999px; font-size: 11px; font-weight: 600; color: var(--app-text-muted);
  background: rgba(255,255,255,0.04); border: 1px solid var(--app-border);
}

.ars-list { display: flex; flex-direction: column; gap: 2px; }
.ars-row {
  display: flex; align-items: center; gap: 10px; width: 100%; padding: 8px 6px; border-radius: 10px; cursor: pointer;
  background: none; border: none; text-align: left; font: inherit; color: var(--app-text); transition: background 120ms;
}
.ars-row:hover { background: rgba(255,255,255,0.04); }
.ars-chev { width: 15px; height: 15px; flex-shrink: 0; color: var(--app-text-subtle); margin-left: auto; }

.ars-avatar {
  width: 34px; height: 34px; border-radius: 10px; display: grid; place-items: center; flex-shrink: 0;
  font-size: 14px; font-weight: 800;
}
.tone-violet  { background: rgba(167,139,250,0.16); color: #c4b5fd; }
.tone-blue    { background: rgba(59,130,246,0.16);  color: #93c5fd; }
.tone-teal    { background: rgba(20,184,166,0.16);  color: #5eead4; }
.tone-amber   { background: rgba(245,158,11,0.16);  color: #fcd34d; }
.tone-rose    { background: rgba(236,72,153,0.16);  color: #f9a8d4; }
.tone-general { background: rgba(var(--app-accent-rgb),0.14); color: var(--app-accent); }
.tone-tech    { background: rgba(var(--app-accent-rgb),0.14); color: var(--app-accent); }
.tone-politics{ background: rgba(239,68,68,0.15);   color: #fca5a5; }
.tone-private { background: rgba(251,191,36,0.15);  color: #fcd34d; }
.tone-nsfw    { background: rgba(236,72,153,0.15);  color: #f9a8d4; }

.ars-info { display: flex; flex-direction: column; min-width: 0; gap: 1px; }
.ars-name { font-size: 13px; font-weight: 650; color: var(--app-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ars-meta { font-size: 11.5px; color: var(--app-text-muted); }
.ars-desc { font-size: 11.5px; line-height: 1.35; color: var(--app-text-subtle); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }

.ars-create {
  display: flex; align-items: center; justify-content: center; gap: 6px; width: 100%; margin-top: 8px; padding: 8px 12px; cursor: pointer;
  border-radius: 10px; background: rgba(var(--app-accent-rgb), 0.08); border: 1px dashed rgba(var(--app-accent-rgb), 0.35);
  color: var(--app-accent); font: inherit; font-size: 12.5px; font-weight: 650; transition: background 120ms;
}
.ars-create:hover { background: rgba(var(--app-accent-rgb), 0.14); }

.ars-topic { padding: 9px 6px; }
.ars-topic__icon { font-size: 16px; flex-shrink: 0; }
.ars-topic__label { flex: 1; min-width: 0; font-size: 13px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ars-topic__count { font-size: 11.5px; color: var(--app-text-muted); white-space: nowrap; }
.ars-topic .ars-chev { margin-left: 0; }
.ars-empty { margin: 4px 6px 2px; font-size: 12px; line-height: 1.5; color: var(--app-text-muted); }

.ars-skeleton { display: flex; flex-direction: column; gap: 8px; }
.ars-skeleton-row { height: 30px; border-radius: 8px; background: rgba(255,255,255,0.05); animation: ars-shimmer 1.4s ease-in-out infinite; }
@keyframes ars-shimmer { 0%, 100% { opacity: 0.5; } 50% { opacity: 1; } }

.ars-about-row { display: flex; align-items: flex-start; gap: 12px; }
.ars-about-text { flex: 1; min-width: 0; }
.ars-about-text p { font-size: 12px; color: var(--app-text-muted); margin: 4px 0 8px; line-height: 1.5; }
.ars-about-link { font-size: 12.5px; }
</style>
