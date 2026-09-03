<template>
  <aside class="app-right-sidebar">

    <!-- Spaces -->
    <div class="ars-section surface-card">
      <div class="ars-header">
        <span>Spaces</span>
        <button class="ars-link" @click="router.push('/home?tab=communities')">See all</button>
      </div>
      <button class="ars-create-cta" @click="router.push('/create-community')">
        <svg viewBox="0 0 24 24" fill="none" width="14" height="14">
          <path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
        </svg>
        Create Space
      </button>
      <div class="ars-communities">
        <div
          v-for="c in communities.slice(0, 5)"
          :key="c.id"
          class="ars-community-row"
          @click="router.push(`/community/${c.id}`)"
        >
          <div class="ars-community-avatar" :class="avatarTone(c)">
            <template v-if="!(c as any).isPrivate">{{ (c.displayName || c.name || 'C').charAt(0).toUpperCase() }}</template>
            <svg v-else viewBox="0 0 24 24" fill="none" width="12" height="12">
              <rect x="3" y="11" width="18" height="11" rx="2" stroke="currentColor" stroke-width="2"/>
              <path d="M7 11V7a5 5 0 0110 0v4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
          </div>
          <div class="ars-community-info">
            <span class="ars-community-name">{{ c.displayName || c.name }}</span>
            <span class="ars-community-meta">{{ formatNumber(c.memberCount) }} members</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Trending -->
    <div class="ars-section surface-card">
      <div class="ars-header"><span>Trending Globally</span></div>
      <div v-if="trendingLoaded" class="ars-trending-list">
        <button
          v-for="row in trendingCategories"
          :key="row.tag || row.id"
          class="ars-trending-row"
          @click="router.push(row.tag ? `/home?tag=${row.tag}` : `/home?category=${row.id}`)"
        >
          <div class="ars-trending-left">
            <ion-icon v-if="row.icon" :icon="row.icon" :class="row.tone" style="font-size:14px;flex-shrink:0"></ion-icon>
            <span class="ars-trending-label">{{ row.label }}</span>
            <span v-if="row.hot" class="ars-hot-badge">🔥</span>
          </div>
          <div class="ars-trending-right">
            <span v-if="row.posts" class="ars-trending-meta">{{ row.posts }}</span>
          </div>
        </button>
      </div>
      <div v-else class="ars-trending-skeleton">
        <div v-for="i in 4" :key="i" class="ars-skeleton-row"></div>
      </div>
    </div>

    <!-- About Interpoll -->
    <div class="ars-section ars-about surface-card">
      <div class="ars-about-row">
        <div class="ars-about-text">
          <p class="ars-about-title">Interpoll</p>
          <p class="ars-about-desc">A peer-to-peer network built on GunDB. Content syncs across all peers — no central server required.</p>
        </div>
        <svg width="52" height="44" viewBox="0 0 56 48" fill="none" flex-shrink="0">
          <circle cx="28" cy="24" r="7" fill="url(#ars-g)"/>
          <circle cx="10" cy="12" r="4" fill="#7c8cff" opacity="0.85"/>
          <circle cx="46" cy="14" r="4" fill="#a78bfa" opacity="0.85"/>
          <circle cx="12" cy="38" r="3.5" fill="#7c8cff" opacity="0.7"/>
          <circle cx="44" cy="36" r="3.5" fill="#a78bfa" opacity="0.7"/>
          <line x1="28" y1="24" x2="10" y2="12" stroke="#7c8cff" stroke-width="1.2" opacity="0.5"/>
          <line x1="28" y1="24" x2="46" y2="14" stroke="#a78bfa" stroke-width="1.2" opacity="0.5"/>
          <line x1="28" y1="24" x2="12" y2="38" stroke="#7c8cff" stroke-width="1.2" opacity="0.4"/>
          <line x1="28" y1="24" x2="44" y2="36" stroke="#a78bfa" stroke-width="1.2" opacity="0.4"/>
          <defs>
            <radialGradient id="ars-g" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(28 24) rotate(90) scale(7)">
              <stop stop-color="#a78bfa"/>
              <stop offset="1" stop-color="#5e6ad2"/>
            </radialGradient>
          </defs>
        </svg>
      </div>
    </div>

  </aside>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { IonIcon } from '@ionic/vue';
import { useCommunityStore } from '../stores/communityStore';
import { CATEGORY_MAP } from '../composables/useCategories';
import config from '../config';

const router = useRouter();
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

const trendingLoaded = ref(false);
const trendingCategories = ref<Array<{ id: string; label: string; posts: string; icon: any; tone: string }>>([]);

onMounted(async () => {
  try {
    // Fetch external global trends from the relay's search-engine data
    const res = await fetch(`${config.relay.api}/api/trends/external`);
    if (!res.ok) throw new Error('trends unavailable');
    const data = await res.json();
    const raw  = Array.isArray(data) ? data : (data.trends || []);

    trendingCategories.value = raw
      .sort((a: any, b: any) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, 6)
      .map((row: any) => {
        const catId = row.category || '';
        const def   = CATEGORY_MAP.get(catId);
        const isHot = Array.isArray(row.sources) && row.sources.length >= 2;
        return {
          id:    catId,
          tag:   row.tag || row.id || catId,
          label: row.tag ? '#' + row.tag : (def?.label || catId),
          posts: String(row.score ?? ''),
          icon:  def?.icon,
          tone:  def?.tone || 'tone-default',
          hot:   isHot,
          sources: row.sources || [],
        };
      });
  } catch {
    // Fallback to internal trending categories endpoint
    try {
      const res2 = await fetch(`${config.relay.api}/api/trending-categories`);
      if (res2.ok) {
        const data2 = await res2.json();
        const cats  = Array.isArray(data2) ? data2 : (data2.categories || []);
        trendingCategories.value = cats.slice(0, 5).map((row: any) => {
          const def = CATEGORY_MAP.get(row.id || row.category);
          return { id: row.id || '', tag: '', label: def?.label || row.label || row.id || '',
                   posts: String(row.posts || row.count || ''), icon: def?.icon,
                   tone: def?.tone || 'tone-default', hot: false, sources: [] };
        });
      }
    } catch { /* silent */ }
  } finally {
    trendingLoaded.value = true;
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
    top: 24px;
    align-self: flex-start;
    max-height: calc(100vh - 48px);
    overflow-y: auto;
    scrollbar-width: none;
  }
  .app-right-sidebar::-webkit-scrollbar { display: none; }
}

@media (min-width: 1024px) { .app-right-sidebar { width: 260px; } }
@media (min-width: 1280px) { .app-right-sidebar { width: 280px; } }

.ars-section {
  padding: 14px 16px;
  border-radius: var(--app-radius-md, 14px);
}

/* Header */
.ars-header {
  display: flex; justify-content: space-between; align-items: center;
  margin-bottom: 10px;
  font-size: 11px; font-weight: 700; letter-spacing: 0.07em;
  text-transform: uppercase; color: rgba(255,255,255,0.35);
}
.ars-link {
  background: none; border: none; cursor: pointer;
  color: var(--app-accent-bright); font-size: 11px; font-weight: 600;
  padding: 0;
}

/* Create CTA */
.ars-create-cta {
  display: flex; align-items: center; justify-content: center; gap: 6px;
  width: 100%; padding: 9px 14px; border-radius: 10px; border: none;
  background: linear-gradient(180deg, var(--app-accent-bright), var(--app-accent));
  color: #fff; font-size: 13px; font-weight: 700; cursor: pointer;
  margin-bottom: 12px;
  transition: opacity 130ms;
}
.ars-create-cta:hover { opacity: 0.88; }

/* Communities */
.ars-communities { display: flex; flex-direction: column; gap: 1px; }
.ars-community-row {
  display: flex; align-items: center; gap: 10px;
  padding: 7px 4px; border-radius: 8px; cursor: pointer;
  transition: background 120ms;
}
.ars-community-row:hover { background: rgba(255,255,255,0.04); }
.ars-community-avatar {
  width: 30px; height: 30px; border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  font-size: 13px; font-weight: 800; flex-shrink: 0;
}
.tone-violet  { background: rgba(99,102,241,0.2);  color: #a5b4fc; }
.tone-blue    { background: rgba(59,130,246,0.2);   color: #93c5fd; }
.tone-teal    { background: rgba(20,184,166,0.2);   color: #5eead4; }
.tone-amber   { background: rgba(245,158,11,0.2);   color: #fcd34d; }
.tone-rose    { background: rgba(236,72,153,0.2);   color: #f9a8d4; }
.tone-general { background: rgba(99,102,241,0.15);  color: #a5b4fc; }
.tone-tech    { background: rgba(59,130,246,0.18);  color: #93c5fd; }
.tone-politics{ background: rgba(239,68,68,0.15);   color: #fca5a5; }
.tone-private { background: rgba(251,191,36,0.15);  color: #fcd34d; }
.tone-nsfw    { background: rgba(236,72,153,0.15);  color: #f9a8d4; }

.ars-community-info { min-width: 0; }
.ars-community-name {
  display: block; font-size: 13px; font-weight: 700; color: var(--app-text);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.ars-community-meta { font-size: 11px; color: rgba(255,255,255,0.35); }

/* Trending */
.ars-trending-list { display: flex; flex-direction: column; gap: 1px; }
.ars-trending-row {
  display: flex; align-items: center; gap: 8px;
  padding: 7px 4px; border-radius: 8px; cursor: pointer;
  background: none; border: none; width: 100%; text-align: left;
  font-family: inherit; color: var(--app-text);
  transition: background 120ms;
}
.ars-trending-row:hover { background: rgba(255,255,255,0.04); }
.ars-trending-left {
  display: flex; align-items: center; gap: 8px;
  font-size: 13px; font-weight: 600; flex: 1; min-width: 0;
}
.ars-trending-left ion-icon { font-size: 15px; flex-shrink: 0; }
.ars-trending-meta { font-size: 11px; color: rgba(255,255,255,0.35); white-space: nowrap; flex-shrink: 0; }

/* Skeleton */
.ars-trending-skeleton { display: flex; flex-direction: column; gap: 8px; }
.ars-hot-badge {
  font-size: 12px;
  line-height: 1;
  margin-left: 2px;
}
.ars-trending-right { display: flex; align-items: center; gap: 4px; }
.ars-trending-label { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.ars-skeleton-row {
  height: 28px; border-radius: 8px;
  background: rgba(255,255,255,0.05);
  animation: ars-shimmer 1.4s ease-in-out infinite;
}
@keyframes ars-shimmer {
  0%, 100% { opacity: 0.5; } 50% { opacity: 1; }
}

/* About */
.ars-about-row { display: flex; align-items: flex-start; gap: 12px; }
.ars-about-text { flex: 1; min-width: 0; }
.ars-about-title { font-size: 14px; font-weight: 700; color: var(--app-text); margin: 0 0 4px; }
.ars-about-desc { font-size: 12px; color: rgba(255,255,255,0.4); margin: 0; line-height: 1.5; }
</style>
