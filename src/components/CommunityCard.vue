<template>
  <div class="community-row" @click="$emit('click')">

    <!-- Round glass avatar -->
    <div class="avatar-wrap" :class="avatarTone">
      <svg class="avatar-svg" viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <defs>
          <filter :id="`glow-${community.id}`" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="1.8" result="blur"/>
            <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
        </defs>
        <!-- Subtle outer ring -->
        <circle cx="22" cy="22" r="20.5" fill="none" stroke="currentColor" stroke-opacity="0.2" stroke-width="0.75"/>
        <!-- Tiny inner accent arc — top-left highlight -->
        <path d="M10 14 A14 14 0 0 1 22 8" fill="none" stroke="currentColor" stroke-opacity="0.35" stroke-width="0.75" stroke-linecap="round"/>
        <!-- Lock icon for private communities -->
        <g v-if="community.isPrivate">
          <rect x="14" y="20" width="16" height="12" rx="2.5" fill="currentColor" fill-opacity="0.8"/>
          <path d="M17 20v-3.5a5 5 0 0110 0V20" stroke="currentColor" stroke-opacity="0.8" stroke-width="2" fill="none" stroke-linecap="round"/>
        </g>
        <!-- Stylish initial — italic serif with glow -->
        <text
          v-else
          x="22" y="29"
          text-anchor="middle"
          font-size="21"
          font-weight="700"
          font-style="italic"
          font-family="Georgia,'Times New Roman',serif"
          fill="currentColor"
          fill-opacity="0.95"
          :filter="`url(#glow-${community.id})`"
        >{{ initial }}</text>
      </svg>
    </div>

    <!-- Info -->
    <div class="community-info">
      <div class="name-row">
        <span class="community-name">{{ community.displayName || community.name }}</span>
        <span v-if="community.isPrivate" class="badge badge--private">Private</span>
        <span v-else-if="community.category" class="badge badge--cat">{{ community.category }}</span>
      </div>
      <p v-if="truncatedDescription" class="community-desc">{{ truncatedDescription }}</p>
      <div class="meta-row">
        <span class="meta-stat">
          <!-- People / members icon -->
          <svg viewBox="0 0 18 18" fill="none" width="13" height="13" aria-hidden="true">
            <circle cx="7" cy="6" r="3" stroke="currentColor" stroke-width="1.5"/>
            <path d="M1 16v-.5a6 6 0 0112 0V16" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            <circle cx="14" cy="6" r="2.2" stroke="currentColor" stroke-width="1.3" opacity="0.6"/>
            <path d="M16.5 14.5a4.5 4.5 0 00-4-2.6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" opacity="0.6"/>
          </svg>
          <span class="meta-label">{{ formatNumber(community.memberCount ?? 1) }} members</span>
        </span>
        <span class="meta-sep">·</span>
        <span class="meta-stat">
          <!-- Speech bubble / posts icon -->
          <svg viewBox="0 0 18 18" fill="none" width="13" height="13" aria-hidden="true">
            <path d="M2 3.5A1.5 1.5 0 013.5 2h11A1.5 1.5 0 0116 3.5v8A1.5 1.5 0 0114.5 13H10l-4 3v-3H3.5A1.5 1.5 0 012 11.5v-8z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
            <path d="M5.5 7h7M5.5 9.5h4.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
          </svg>
          <span class="meta-label">{{ formatNumber(community.postCount ?? 0) }} posts</span>
        </span>
      </div>
    </div>

    <!-- Join chip -->
    <div class="join-chip" :class="isJoined ? 'join-chip--joined' : 'join-chip--open'">
      <svg v-if="isJoined" viewBox="0 0 12 12" fill="none" width="10" height="10" aria-hidden="true">
        <path d="M2 6l3 3 5-5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      {{ isJoined ? 'Joined' : 'Join' }}
    </div>

  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { Community } from '../services/communityService';
import { useCommunityStore } from '../stores/communityStore';

const props = defineProps<{ community: Community }>();
defineEmits(['click']);

const communityStore = useCommunityStore();
const isJoined = computed(() => communityStore.isJoined(props.community.id));
const initial  = computed(() => (props.community.displayName || props.community.name || 'C').charAt(0).toUpperCase());

const TONES = ['tone-violet', 'tone-blue', 'tone-teal', 'tone-amber', 'tone-rose'] as const;
const avatarTone = computed(() => {
  const code = (props.community.id || '').split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return TONES[code % TONES.length];
});

const truncatedDescription = computed(() => {
  const d = props.community.description || '';
  return d.length <= 72 ? d : d.substring(0, 72) + '…';
});

function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'K';
  return n.toString();
}
</script>

<style scoped>
.community-row {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 14px;
  cursor: pointer;
  border-radius: 12px;
  transition: background 130ms ease;
}
.community-row:hover  { background: var(--app-surface-hover, rgba(255,255,255,0.05)); }
.community-row:active { background: rgba(255,255,255,0.07); }

/* ── Round glass avatar ── */
.avatar-wrap {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  /* Glass: frosted backdrop over the aurora background */
  backdrop-filter: blur(12px) saturate(1.4);
  -webkit-backdrop-filter: blur(12px) saturate(1.4);
  border: 1px solid rgba(255,255,255,0.14);
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,0.18),
    inset 0 -1px 0 rgba(0,0,0,0.12),
    0 2px 8px rgba(0,0,0,0.18);
}

.avatar-svg { width: 44px; height: 44px; display: block; }

/* Per-tone tints — colour the avatar's glass */
.tone-violet { background: rgba(99,102,241,0.18);  color: #a5b4fc; }
.tone-blue   { background: rgba(59,130,246,0.18);  color: #93c5fd; }
.tone-teal   { background: rgba(20,184,166,0.16);  color: #5eead4; }
.tone-amber  { background: rgba(245,158,11,0.16);  color: #fcd34d; }
.tone-rose   { background: rgba(236,72,153,0.16);  color: #f9a8d4; }

/* ── Info ── */
.community-info { flex: 1; min-width: 0; }

.name-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 3px;
}
.community-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--app-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.badge {
  padding: 1.5px 7px;
  border-radius: 999px;
  font-size: 9.5px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  flex-shrink: 0;
}
.badge--cat {
  background: rgba(99,102,241,0.1);
  color: rgba(165,180,252,0.9);
  border: 1px solid rgba(99,102,241,0.18);
}
.badge--private {
  background: rgba(245,158,11,0.08);
  color: rgba(251,191,36,0.9);
  border: 1px solid rgba(245,158,11,0.18);
}

.community-desc {
  font-size: 12px;
  color: var(--app-text-subtle);
  margin: 0 0 5px;
  line-height: 1.45;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.meta-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.meta-stat {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11.5px;
  font-weight: 500;
  color: var(--app-text-subtle);
}
.meta-label {
  font-size: 11.5px;
  font-weight: 500;
  color: var(--app-text-subtle);
}
.meta-sep {
  font-size: 11px;
  color: var(--app-text-subtle);
  opacity: 0.4;
  user-select: none;
}

/* ── Join chip ── */
.join-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 12px;
  border-radius: 999px;
  font-size: 11.5px;
  font-weight: 600;
  flex-shrink: 0;
  letter-spacing: 0.01em;
}
.join-chip--joined {
  background: rgba(52,211,153,0.1);
  color: #34d399;
  border: 1px solid rgba(52,211,153,0.2);
}
.join-chip--open {
  background: var(--app-item-surface, rgba(255,255,255,0.04));
  color: var(--app-text-muted);
  border: 1px solid var(--app-border);
}
</style>