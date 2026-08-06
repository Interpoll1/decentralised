<template>
  <div class="community-card" @click="$emit('click')">

    <!-- Avatar -->
    <div class="community-avatar" :class="avatarTone">
      <ion-icon v-if="community.isPrivate" :icon="lockClosedOutline"></ion-icon>
      <template v-else>{{ initial }}</template>
    </div>

    <!-- Info -->
    <div class="community-info">
      <div class="community-name-row">
        <span class="community-name">{{ community.displayName || community.name }}</span>
        <span v-if="community.isPrivate" class="type-badge private">Private</span>
        <span v-else class="type-badge general">General</span>
      </div>

      <span class="community-id">c/{{ community.id }}</span>

      <p v-if="truncatedDescription" class="community-desc">{{ truncatedDescription }}</p>

      <div class="community-stats">
        <span class="stat">
          <ion-icon :icon="peopleOutline"></ion-icon>
          {{ formatNumber(community.memberCount ?? 1) }}
        </span>
        <span class="stat">
          <ion-icon :icon="documentTextOutline"></ion-icon>
          {{ formatNumber(community.postCount ?? 0) }}
        </span>
      </div>
    </div>

    <!-- Join badge -->
    <div class="join-badge" :class="isJoined ? 'joined' : 'not-joined'">
      {{ isJoined ? 'Joined' : 'Not joined' }}
    </div>

  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { IonIcon } from '@ionic/vue';
import { peopleOutline, documentTextOutline, lockClosedOutline } from 'ionicons/icons';
import { Community } from '../services/communityService';
import { useCommunityStore } from '../stores/communityStore';

const props = defineProps<{ community: Community }>();
defineEmits(['click']);

const communityStore = useCommunityStore();
const isJoined = computed(() => communityStore.isJoined(props.community.id));

const initial = computed(() =>
  (props.community.displayName || props.community.name || 'C').charAt(0).toUpperCase()
);

// Give each community a consistent colour tone based on its name
const TONES = ['tone-violet', 'tone-blue', 'tone-teal', 'tone-amber', 'tone-rose'];
const avatarTone = computed(() => {
  const code = (props.community.id || '').split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return TONES[code % TONES.length];
});

const truncatedDescription = computed(() => {
  const desc = props.community.description || '';
  return desc.length <= 90 ? desc : desc.substring(0, 90) + '…';
});

const formatNumber = (n: number | undefined | null): string => {
  const v = n ?? 0;
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(1) + 'M';
  if (v >= 1_000)     return (v / 1_000).toFixed(1) + 'K';
  return v.toString();
};
</script>

<style scoped>
.community-card {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px 16px;
  border-radius: 16px;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.07);
  cursor: pointer;
  transition: background 160ms ease, border-color 160ms ease, transform 160ms ease;
}
.community-card:hover {
  background: rgba(255,255,255,0.07);
  border-color: rgba(255,255,255,0.12);
  transform: translateY(-1px);
}
.community-card:active { transform: translateY(0); }

/* ── Avatar ──────────────────────────────────── */
.community-avatar {
  width: 46px;
  height: 46px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  font-weight: 800;
  color: #fff;
  flex-shrink: 0;
  letter-spacing: -0.02em;
}
.community-avatar ion-icon { font-size: 20px; }

.tone-violet { background: linear-gradient(135deg, #6366f1, #8b5cf6); box-shadow: 0 4px 12px rgba(99,102,241,0.3); }
.tone-blue   { background: linear-gradient(135deg, #3b82f6, #6366f1); box-shadow: 0 4px 12px rgba(59,130,246,0.3); }
.tone-teal   { background: linear-gradient(135deg, #14b8a6, #3b82f6); box-shadow: 0 4px 12px rgba(20,184,166,0.3); }
.tone-amber  { background: linear-gradient(135deg, #f59e0b, #ef4444); box-shadow: 0 4px 12px rgba(245,158,11,0.3); }
.tone-rose   { background: linear-gradient(135deg, #ec4899, #8b5cf6); box-shadow: 0 4px 12px rgba(236,72,153,0.3); }

/* ── Info ────────────────────────────────────── */
.community-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.community-name-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.community-name {
  font-size: 15px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--app-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.type-badge {
  padding: 2px 7px;
  border-radius: 999px;
  font-size: 9.5px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  border: 1px solid transparent;
  flex-shrink: 0;
}
.type-badge.general {
  background: rgba(99,102,241,0.1);
  color: #818cf8;
  border-color: rgba(99,102,241,0.2);
}
.type-badge.private {
  background: rgba(251,191,36,0.1);
  color: #fbbf24;
  border-color: rgba(251,191,36,0.2);
}

.community-id {
  font-size: 11.5px;
  color: var(--app-text-subtle);
  font-weight: 500;
}

.community-desc {
  font-size: 13px;
  line-height: 1.5;
  color: var(--app-text-muted);
  margin: 2px 0 0;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.community-stats {
  display: flex;
  gap: 12px;
  margin-top: 6px;
}

.stat {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  font-weight: 600;
  color: var(--app-text-subtle);
  font-variant-numeric: tabular-nums;
}
.stat ion-icon { font-size: 13px; }

/* ── Join badge ──────────────────────────────── */
.join-badge {
  padding: 5px 11px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.02em;
  white-space: nowrap;
  flex-shrink: 0;
  align-self: center;
}
.join-badge.joined {
  background: rgba(52,211,153,0.12);
  color: #34d399;
  border: 1px solid rgba(52,211,153,0.25);
}
.join-badge.not-joined {
  background: rgba(255,255,255,0.05);
  color: var(--app-text-muted);
  border: 1px solid rgba(255,255,255,0.09);
}
</style>