<template>
  <!-- Flat row — no card border/background, just a divider -->
  <div class="community-row" @click="$emit('click')">

    <div class="community-avatar" :class="avatarTone">
      <ion-icon v-if="community.isPrivate" :icon="lockClosedOutline"></ion-icon>
      <template v-else>{{ initial }}</template>
    </div>

    <div class="community-info">
      <div class="community-name-row">
        <span class="community-name">{{ community.displayName || community.name }}</span>
        <span v-if="community.isPrivate" class="type-badge private">Private</span>
        <span v-else class="type-badge general">General</span>
      </div>
      <div class="community-meta">
        <span class="stat">
          <svg viewBox="0 0 24 24" fill="none" width="12" height="12"><circle cx="9" cy="7" r="4" stroke="currentColor" stroke-width="1.8"/><path d="M3 21v-1a6 6 0 0112 0v1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
          {{ formatNumber(community.memberCount ?? 1) }}
        </span>
        <span class="stat">
          <svg viewBox="0 0 24 24" fill="none" width="12" height="12"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" stroke="currentColor" stroke-width="1.8"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
          {{ formatNumber(community.postCount ?? 0) }}
        </span>
        <span v-if="truncatedDescription" class="community-desc-inline">· {{ truncatedDescription }}</span>
      </div>
    </div>

    <div class="join-chip" :class="isJoined ? 'joined' : 'not-joined'">
      {{ isJoined ? '✓ Joined' : 'Join' }}
    </div>

  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { IonIcon } from '@ionic/vue';
import { lockClosedOutline } from 'ionicons/icons';
import { Community } from '../services/communityService';
import { useCommunityStore } from '../stores/communityStore';

const props = defineProps<{ community: Community }>();
defineEmits(['click']);

const communityStore = useCommunityStore();
const isJoined = computed(() => communityStore.isJoined(props.community.id));
const initial  = computed(() => (props.community.displayName || props.community.name || 'C').charAt(0).toUpperCase());

const TONES = ['tone-violet', 'tone-blue', 'tone-teal', 'tone-amber', 'tone-rose'];
const avatarTone = computed(() => {
  const code = (props.community.id || '').split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return TONES[code % TONES.length];
});

const truncatedDescription = computed(() => {
  const d = props.community.description || '';
  return d.length <= 60 ? d : d.substring(0, 60) + '…';
});

const formatNumber = (n: number | undefined | null): string => {
  const v = n ?? 0;
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(1) + 'M';
  if (v >= 1_000)     return (v / 1_000).toFixed(1) + 'K';
  return v.toString();
};
</script>

<style scoped>
.community-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 13px 4px;
  cursor: pointer;
  border-bottom: 1px solid rgba(255,255,255,0.06);
  background: transparent;
  transition: background 130ms;
}
.community-row:last-child { border-bottom: none; }
.community-row:hover { background: rgba(99,102,241,0.04); }
.community-row:active { background: rgba(99,102,241,0.07); }

/* Avatar — colour comes from tone class, not global white */
.community-avatar {
  width: 40px; height: 40px;
  border-radius: 10px;
  display: flex; align-items: center; justify-content: center;
  font-size: 16px; font-weight: 800;
  flex-shrink: 0;
}
.community-avatar ion-icon { font-size: 17px; }

/* Muted translucent tones — consistent with comment avatars and sidebar chips */
.tone-violet { background: rgba(99,  102, 241, 0.20); color: #a5b4fc; }
.tone-blue   { background: rgba(59,  130, 246, 0.20); color: #93c5fd; }
.tone-teal   { background: rgba(20,  184, 166, 0.20); color: #5eead4; }
.tone-amber  { background: rgba(245, 158,  11, 0.20); color: #fcd34d; }
.tone-rose   { background: rgba(236,  72, 153, 0.20); color: #f9a8d4; }

/* Info */
.community-info { flex: 1; min-width: 0; }

.community-name-row {
  display: flex; align-items: center; gap: 5px;
  margin-bottom: 2px;
}
.community-name {
  font-size: 14px; font-weight: 700;
  color: var(--app-text);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.type-badge {
  padding: 1px 6px; border-radius: 999px;
  font-size: 9px; font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.06em; flex-shrink: 0;
}
.type-badge.general { background: rgba(99,102,241,0.1); color: #818cf8; }
.type-badge.private { background: rgba(251,191,36,0.1);  color: #fbbf24; }

.community-meta {
  display: flex; align-items: center; gap: 8px;
  font-size: 12px; color: var(--app-text-subtle);
}
.stat { display: inline-flex; align-items: center; gap: 3px; font-weight: 600; }
.community-desc-inline {
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  max-width: 200px; font-weight: 400;
}

/* Join chip */
.join-chip {
  padding: 4px 10px; border-radius: 999px;
  font-size: 11px; font-weight: 700;
  white-space: nowrap; flex-shrink: 0;
}
.join-chip.joined  { background: rgba(52,211,153,0.12); color: #34d399; }
.join-chip.not-joined { background: rgba(255,255,255,0.06); color: var(--app-text-muted); border: 1px solid rgba(255,255,255,0.1); }
</style>
