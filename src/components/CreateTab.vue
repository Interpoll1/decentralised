<template>
  <div class="create-tab">

    <p class="section-label">What would you like to create?</p>

    <div class="create-options">
      <div class="create-option-item" @click="$router.push('/create-community')">
        <div class="create-icon-wrap primary">
          <ion-icon :icon="peopleOutline"></ion-icon>
        </div>
        <div class="option-content">
          <h3>Community</h3>
          <p>Start a space for discussions</p>
        </div>
        <svg class="chevron" viewBox="0 0 24 24" fill="none">
          <path d="M9 18l6-6-6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>

      <div class="create-option-item" @click="$emit('showPostOptions')">
        <div class="create-icon-wrap secondary">
          <ion-icon :icon="documentTextOutline"></ion-icon>
        </div>
        <div class="option-content">
          <h3>Post</h3>
          <p>Share content in a community</p>
        </div>
        <svg class="chevron" viewBox="0 0 24 24" fill="none">
          <path d="M9 18l6-6-6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>

      <div class="create-option-item" @click="$emit('showPollOptions')">
        <div class="create-icon-wrap tertiary">
          <ion-icon :icon="statsChartOutline"></ion-icon>
        </div>
        <div class="option-content">
          <h3>Poll</h3>
          <p>Ask the community a question</p>
        </div>
        <svg class="chevron" viewBox="0 0 24 24" fill="none">
          <path d="M9 18l6-6-6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
    </div>

    <!-- Quick communities -->
    <div class="quick-post-section">
      <p class="section-label">Post to a community</p>
      <template v-if="joinedCommunities.length > 0">
        <div class="quick-communities">
          <button
            v-for="community in joinedCommunities.slice(0, 10)"
            :key="community.id"
            class="community-chip"
            @click="$router.push(`/community/${community.id}/create-post`)"
          >
            <span class="chip-avatar" :class="avatarTone(community.id)">
              {{ (community.displayName || community.name || 'C').charAt(0).toUpperCase() }}
            </span>
            <span class="chip-label">{{ community.displayName || community.name }}</span>
          </button>
        </div>
        <p class="join-hint">
          Only showing communities you've joined.
          <span class="join-hint-link" @click="$router.push('/communities')">Browse all to join more →</span>
        </p>
      </template>
      <div v-else class="no-communities">
        <p>You haven't joined any communities yet.</p>
        <button class="browse-btn" @click="$router.push('/communities')">Browse Communities</button>
      </div>
    </div>

  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { IonIcon } from '@ionic/vue';
import { peopleOutline, documentTextOutline, statsChartOutline } from 'ionicons/icons';
import { useCommunityStore } from '../stores/communityStore';

defineEmits<{
  (e: 'showPostOptions'): void;
  (e: 'showPollOptions'): void;
}>();

const communityStore = useCommunityStore();

const joinedCommunities = computed(() =>
  communityStore.communities.filter(c => communityStore.isJoined(c.id)),
);

const TONES = ['tone-violet', 'tone-blue', 'tone-teal', 'tone-amber', 'tone-rose'];
function avatarTone(id: string) {
  const code = id.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return TONES[code % TONES.length];
}
</script>

<style scoped>
.create-tab {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 4px 0;
}

/* ── Section label ───────────────────────────── */
.section-label {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--app-text-subtle);
  margin: 0;
  padding: 0 2px;
}

/* ── Create option cards ─────────────────────── */
.create-options {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.create-option-item {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px 18px;
  border-radius: 18px;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.07);
  cursor: pointer;
  transition: background 160ms ease, border-color 160ms ease, transform 160ms ease;
  -webkit-tap-highlight-color: transparent;
}
.create-option-item:hover {
  background: rgba(255,255,255,0.07);
  border-color: rgba(255,255,255,0.12);
  transform: translateY(-1px);
}
.create-option-item:active { transform: translateY(0); }

/* Icon bubble */
.create-icon-wrap {
  width: 46px;
  height: 46px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  font-size: 22px;
}

.create-icon-wrap.primary {
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  box-shadow: 0 4px 14px rgba(99,102,241,0.35);
  color: #fff;
}
.create-icon-wrap.secondary {
  background: linear-gradient(135deg, #f59e0b, #ef4444);
  box-shadow: 0 4px 14px rgba(245,158,11,0.3);
  color: #fff;
}
.create-icon-wrap.tertiary {
  background: linear-gradient(135deg, #14b8a6, #3b82f6);
  box-shadow: 0 4px 14px rgba(20,184,166,0.3);
  color: #fff;
}

/* Text */
.option-content { flex: 1; min-width: 0; }
.option-content h3 {
  margin: 0 0 3px;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--app-text);
}
.option-content p {
  margin: 0;
  font-size: 12.5px;
  color: var(--app-text-muted);
  line-height: 1.4;
}

.chevron {
  width: 18px;
  height: 18px;
  color: var(--app-text-subtle);
  flex-shrink: 0;
}

/* ── Quick community chips ───────────────────── */
.quick-post-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.quick-communities {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.community-chip {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 6px 12px 6px 6px;
  border-radius: 999px;
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.09);
  cursor: pointer;
  transition: background 160ms ease, border-color 160ms ease, transform 160ms ease;
  -webkit-tap-highlight-color: transparent;
}
.community-chip:hover {
  background: rgba(255,255,255,0.09);
  border-color: rgba(255,255,255,0.15);
  transform: translateY(-1px);
}
.community-chip:active { transform: translateY(0); }

.chip-avatar {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 800;
  color: #fff;
  flex-shrink: 0;
}

.tone-violet { background: linear-gradient(135deg, #6366f1, #8b5cf6); }
.tone-blue   { background: linear-gradient(135deg, #3b82f6, #6366f1); }
.tone-teal   { background: linear-gradient(135deg, #14b8a6, #3b82f6); }
.tone-amber  { background: linear-gradient(135deg, #f59e0b, #ef4444); }
.tone-rose   { background: linear-gradient(135deg, #ec4899, #8b5cf6); }

.chip-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--app-text);
  white-space: nowrap;
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.join-hint {
  margin: 6px 0 0;
  font-size: 11.5px;
  color: var(--app-text-subtle);
  padding: 0 2px;
}
.join-hint-link {
  color: #818cf8;
  cursor: pointer;
  white-space: nowrap;
}
.join-hint-link:hover { text-decoration: underline; text-underline-offset: 2px; }

.no-communities {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 10px;
  padding: 14px;
  border-radius: 14px;
  background: rgba(255,255,255,0.03);
  border: 1px dashed rgba(255,255,255,0.1);
}
.no-communities p {
  margin: 0;
  font-size: 13px;
  color: var(--app-text-muted);
}
.browse-btn {
  font-size: 13px;
  font-weight: 600;
  color: #818cf8;
  background: rgba(99,102,241,0.1);
  border: 1px solid rgba(99,102,241,0.25);
  border-radius: 8px;
  padding: 7px 14px;
  cursor: pointer;
  transition: background 150ms;
}
.browse-btn:hover { background: rgba(99,102,241,0.18); }
</style>