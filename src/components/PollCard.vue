<template>
  <article class="poll-card">
    <div v-if="flagged && filterAction === 'blur' && !revealed" class="flagged-overlay" @click.stop="revealed = true">
      <ion-icon :icon="warningOutline"></ion-icon>
      <span>Poll hidden by word filter — tap to reveal</span>
    </div>

    <div class="poll-body" @click="$emit('click')" :class="{ 'content-blurred': flagged && filterAction === 'blur' && !revealed }">
      <div class="poll-header">
        <div class="poll-badge">
          <ion-icon :icon="statsChartOutline"></ion-icon>
          <span>Poll</span>
        </div>
        <div class="poll-meta">
          <div class="author-avatar-sm" :title="'u/' + authorDisplayName">
            {{ authorInitial }}
          </div>
          <span class="author">u/{{ authorDisplayName }}</span>
          <span class="identity-badge" :class="authorIdentityClass">
            {{ authorIdentityLabel }}
          </span>
          <span class="separator">·</span>
          <span class="timestamp">{{ formatTime(poll.createdAt) }}</span>
          <span v-if="poll.isExpired" class="expired-badge">Ended</span>
          <span v-if="flagged && filterAction === 'flag'" class="flag-badge" title="Flagged by word filter">
            <ion-icon :icon="warningOutline"></ion-icon>
          </span>
        </div>
      </div>

      <h3 class="poll-question">{{ poll.question || 'Untitled Poll' }}</h3>
      <p v-if="poll.description" class="poll-description">{{ poll.description }}</p>

      <div v-if="poll.options && poll.options.length > 0" class="poll-options-preview">
        <div
          v-for="(option, index) in poll.options.slice(0, 3)"
          :key="option.id || index"
          class="option-preview"
        >
          <div class="option-info">
            <span class="option-text">{{ option.text || `Option ${index + 1}` }}</span>
            <span class="option-votes">{{ option.votes || 0 }} votes</span>
          </div>
          <div class="option-bar">
            <div
              class="option-fill"
              :style="{ width: `${getOptionPercent(option)}%` }"
            ></div>
          </div>
        </div>
        <div v-if="poll.options.length > 3" class="more-options">
          +{{ poll.options.length - 3 }} more option{{ poll.options.length - 3 !== 1 ? 's' : '' }}
        </div>
      </div>

      <div v-else class="no-options">
        <p>No poll options available</p>
      </div>

      <div class="poll-footer" @click.stop>
        <div class="poll-stats">
          <button class="stat-icon-btn heart" @click="$emit('upvote')" :class="{ active: hasUpvoted }" title="Like">
            <ion-icon :icon="hasUpvoted ? heart : heartOutline"></ion-icon>
            <span>{{ poll.upvotes || 0 }}</span>
          </button>

          <button class="stat-icon-btn downvote" @click="$emit('downvote')" :class="{ active: hasDownvoted }" title="Downvote">
            <!-- YouTube-style rotated thumbs down -->
            <svg class="thumb-down-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M15 3H6C5.17 3 4.46 3.5 4.16 4.22l-3.02 7.05C1.05 11.5 1 11.74 1 12v2c0 1.1.9 2 2 2h6.31l-.95 4.57-.03.32c0 .41.17.79.44 1.06L9.83 23l6.59-6.59c.36-.36.58-.86.58-1.41V5c0-1.1-.9-2-2-2zm4 0v12h4V3h-4z" fill="currentColor"/>
            </svg>
            <span>{{ poll.downvotes || 0 }}</span>
          </button>

          <div class="stat-item">
            <ion-icon :icon="peopleOutline"></ion-icon>
            <span>{{ displayTotal }} vote{{ displayTotal !== 1 ? 's' : '' }}</span>
          </div>

          <div
            v-if="verifiedTotal > 0"
            class="stat-item verified-tally"
            :class="{ inflated: verifiedInflated }"
            :title="verifiedInflated
              ? 'Reported total far exceeds cryptographically verified votes — treat with caution'
              : verifiedTotal + ' vote(s) cryptographically verified from signed events'"
          >
            <ion-icon :icon="verifiedInflated ? warningOutline : shieldCheckmarkOutline"></ion-icon>
            <span>{{ verifiedTotal }} verified</span>
          </div>

          <div class="stat-item">
            <ion-icon :icon="timeOutline"></ion-icon>
            <span>{{ getTimeRemaining() }}</span>
          </div>

          <div v-if="poll.allowMultipleChoices" class="stat-item">
            <ion-icon :icon="checkmarkDoneOutline"></ion-icon>
            <span>Multiple choice</span>
          </div>
        </div>

        <div class="poll-actions">
          <ion-button
            v-if="showModerationAction"
            fill="clear"
            size="small"
            class="moderation-action"
            :title="moderationActionTitle"
            @click.stop="$emit('moderation-submit')"
          >
            Filter
            <ion-icon slot="end" :icon="shieldCheckmarkOutline"></ion-icon>
          </ion-button>

          <button class="action-btn share-btn" title="Share this poll" @click.stop="handleShare">
            <!-- Curved-arrow share icon -->
            <svg class="reddit-share-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M21 12l-7-7v4C7 10 4 15 3 21c2.5-3.5 6-5.1 11-5.1V20l7-8z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>
            </svg>
          </button>

          <ion-button fill="clear" size="small" class="vote-btn" @click.stop="$emit('vote')">
            Vote Now
            <ion-icon slot="end" :icon="chevronForwardOutline"></ion-icon>
          </ion-button>
        </div>
      </div>
    </div>
  </article>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { IonIcon, IonButton } from '@ionic/vue';

import {
  statsChartOutline,
  peopleOutline,
  timeOutline,
  checkmarkDoneOutline,
  chevronForwardOutline,
  warningOutline,
  shieldCheckmarkOutline,
  heart,
  heartOutline,
} from 'ionicons/icons';
import { Poll } from '../services/pollService';
import type { PollOption } from '../types/poll';
import { useVerifiedPollResults } from '../composables/useVerifiedPollResults';
import { shareLink } from '../composables/useShare';
import type { FilterAction } from '../services/moderationService';
import { generatePseudonym } from '../utils/pseudonym';
import { useUserStore } from '../stores/userStore';
import type { UserProfile } from '../services/userService';
import { formatTrustedIdentityLabel } from '../utils/identityTrust';

const props = defineProps<{
  poll: Poll;
  flagged?: boolean;
  filterAction?: FilterAction;
  showModerationAction?: boolean;
  moderationActionTitle?: string;
  hasUpvoted?: boolean;
  hasDownvoted?: boolean;
}>();
defineEmits(['click', 'vote', 'moderation-submit', 'upvote', 'downvote']);

const results = useVerifiedPollResults(() => props.poll);
const verifiedTotal = results.verifiedTotal;
const displayTotal = results.displayTotal;
const verifiedInflated = computed(() => results.trust.value === 'inflated');

const revealed = ref(false);
const userStore = useUserStore();
const authorProfile = ref<UserProfile | null>(null);
let authorProfileRequestId = 0;

watch(
  () => props.poll.authorId,
  async (authorId) => {
    const requestId = ++authorProfileRequestId;
    if (!authorId) { authorProfile.value = null; return; }
    const profile = await userStore.getProfile(authorId);
    if (requestId !== authorProfileRequestId) return;
    authorProfile.value = profile;
  },
  { immediate: true }
);

const authorDisplayName = computed(() => {
  if (props.poll.authorShowRealName) return props.poll.authorName || 'anon';
  if (props.poll.authorId && props.poll.id) return generatePseudonym(props.poll.id, props.poll.authorId);
  return props.poll.authorName || 'anon';
});

const authorInitial = computed(() => {
  const name = authorDisplayName.value || 'a';
  return name.charAt(0).toUpperCase();
});

const authorIdentityLabel = computed(() =>
  authorProfile.value?.identityTrustLevel === 'trusted-issuer'
    ? formatTrustedIdentityLabel({
        username: authorProfile.value?.identityUsername || authorProfile.value?.customUsername || authorProfile.value?.username || props.poll.authorName,
        issuer: authorProfile.value?.identityIssuer,
      })
    : 'Unverified identity'
);

const authorIdentityClass = computed(() =>
  authorProfile.value?.identityTrustLevel === 'trusted-issuer' ? 'trusted-issuer' : 'unverified'
);

function formatTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const m = Math.floor(diff / 60000);
  const h = Math.floor(diff / 3600000);
  const d = Math.floor(diff / 86400000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  if (d < 7) return `${d}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

function handleShare() {
  const url = props.poll.communityId
    ? `/community/${props.poll.communityId}/poll/${props.poll.id}`
    : `/vote/${props.poll.id}`;
  void shareLink(url, props.poll.question || 'InterPoll poll', 'Vote on this poll on InterPoll');
}

function getOptionPercent(option: { votes: number }): number {
  return results.percent(option as PollOption);
}

function getTimeRemaining(): string {
  if (props.poll.isExpired) return 'Ended';
  const remaining = props.poll.expiresAt - Date.now();
  const d = Math.floor(remaining / 86400000);
  const h = Math.floor((remaining % 86400000) / 3600000);
  if (d > 0) return `${d}d left`;
  if (h > 0) return `${h}h left`;
  return 'Ending soon';
}
</script>

<style scoped>
.poll-card {
  margin: 0 0 2px;
  padding: 18px 20px 16px;
  border-bottom: 1px solid rgba(15, 23, 42, 0.08);
  cursor: pointer;
}

/* ── Header ─────────────────────────────────── */
.poll-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}

.poll-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  background: rgba(var(--ion-color-tertiary-rgb), 0.08);
  border: 1px solid rgba(var(--ion-color-tertiary-rgb), 0.18);
  border-radius: 999px;
  color: var(--ion-color-tertiary);
  font-size: 11px;
  font-weight: 700;
  flex-shrink: 0;
  letter-spacing: 0.02em;
}
.poll-badge ion-icon { font-size: 12px; }

.poll-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  font-size: 12px;
  color: var(--app-text-muted);
  min-width: 0;
}

/* ── Author avatar ─────────────────────────── */
.author-avatar-sm {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  box-shadow: 0 0 0 2px rgba(99,102,241,0.2);
}

.separator { color: rgba(255,255,255,0.2); font-size: 11px; margin: 0 1px; }

.author {
  color: var(--app-text);
  font-weight: 600;
  font-size: 13px;
  letter-spacing: -0.01em;
}

.identity-badge,
.expired-badge {
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 9.5px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  border: 1px solid rgba(255,255,255,0.08);
}
.identity-badge.unverified {
  background: rgba(var(--ion-color-warning-rgb), 0.12);
  color: var(--ion-color-warning);
}
.identity-badge.trusted-issuer {
  background: rgba(var(--ion-color-success-rgb), 0.14);
  color: var(--ion-color-success);
}
.expired-badge {
  background: rgba(var(--ion-color-medium-rgb), 0.1);
  color: var(--app-text-muted);
}

.timestamp { color: var(--app-text-subtle); font-size: 12px; }

/* ── Question ─── cool editorial style ───────── */
.poll-question {
  margin: 0 0 8px;
  font-size: 18px;
  font-weight: 800;
  line-height: 1.25;
  letter-spacing: -0.03em;
  color: var(--app-text);
  /* subtle gradient shimmer on the text */
  background: linear-gradient(135deg, var(--app-text) 60%, rgba(167,139,250,0.85));
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  text-fill-color: transparent;
}

.poll-description {
  margin: 0 0 12px;
  font-size: 13.5px;
  line-height: 1.6;
  color: var(--app-text-muted);
}

/* ── Options ─────────────────────────────────── */
.poll-options-preview {
  display: flex;
  flex-direction: column;
  gap: 9px;
  margin-bottom: 14px;
}

.option-info {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 5px;
}

.option-text {
  color: var(--app-text);
  font-size: 13.5px;
  font-weight: 500;
}

.option-votes,
.no-options p {
  color: var(--app-text-subtle);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.more-options {
  font-size: 12.5px;
  color: var(--app-accent-bright);
  font-weight: 600;
  padding-left: 2px;
  letter-spacing: -0.01em;
}

.option-bar {
  height: 5px;
  background: rgba(255,255,255,0.05);
  border-radius: 999px;
  overflow: hidden;
}

.option-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--app-accent), var(--ion-color-tertiary));
  border-radius: 999px;
  transition: width 0.5s cubic-bezier(0.16, 1, 0.3, 1);
}

/* ── Footer ──────────────────────────────────── */
.poll-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  padding-top: 12px;
  border-top: 1px solid rgba(15,23,42,0.08);
  flex-wrap: wrap;
}

.poll-stats {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}

.poll-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
}

/* ── Stat pill buttons ───────────────────────── */
.stat-icon-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 6px 11px;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.07);
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  color: var(--app-text-muted);
  cursor: pointer;
  transition: color 160ms ease, background 160ms ease, border-color 160ms ease;
}
.stat-icon-btn ion-icon { font-size: 15px; color: var(--app-text-subtle); }

/* Heart upvote — matches PostCard */
.stat-icon-btn.heart,
.stat-icon-btn.heart ion-icon { color: #a78bfa; }
.stat-icon-btn.heart.active,
.stat-icon-btn.heart.active ion-icon { color: #c4b5fd; }

/* YouTube-style thumb-down */
.thumb-down-icon {
  width: 15px;
  height: 15px;
  color: var(--app-text-subtle);
  transform: rotate(-20deg) scaleX(-1);
  flex-shrink: 0;
}
.stat-icon-btn.downvote.active { color: #ef4444; border-color: rgba(239,68,68,0.3); background: rgba(239,68,68,0.1); }
.stat-icon-btn.downvote.active .thumb-down-icon { color: #ef4444; }

/* Share button */
.action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  background: none;
  border: none;
  border-radius: 50%;
  color: var(--app-text-subtle);
  cursor: pointer;
  transition: color 160ms ease, background 160ms ease;
}
.action-btn:hover { color: var(--app-accent-bright); background: rgba(var(--app-accent-rgb),0.08); }
.reddit-share-icon { width: 18px; height: 18px; }

.vote-btn { --color: var(--app-accent-bright); font-size: 12.5px; font-weight: 700; }

/* Stat info pills */
.stat-item {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 6px 11px;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.07);
  border-radius: 999px;
  font-size: 12px;
  color: var(--app-text-muted);
}
.stat-item ion-icon { font-size: 13px; color: var(--app-text-subtle); }

.verified-tally { color: #34d399; border-color: rgba(52,211,153,0.25); background: rgba(52,211,153,0.08); }
.verified-tally ion-icon { color: #34d399; }
.verified-tally.inflated { color: #fbbf24; border-color: rgba(251,191,36,0.3); background: rgba(251,191,36,0.1); }
.verified-tally.inflated ion-icon { color: #fbbf24; }

.moderation-action { --color: var(--ion-color-warning); }
.moderation-action::part(native) { border: 1px solid rgba(var(--ion-color-warning-rgb),0.2); border-radius: 999px; }

/* ── Flagged overlay ─────────────────────────── */
.flagged-overlay {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 14px;
  margin-bottom: 10px;
  background: rgba(var(--ion-color-warning-rgb),0.1);
  border: 1px solid rgba(var(--ion-color-warning-rgb),0.25);
  border-radius: 10px;
  color: var(--ion-color-warning);
  font-size: 12.5px;
  cursor: pointer;
}
.flagged-overlay ion-icon { font-size: 15px; flex-shrink: 0; }

.content-blurred { filter: blur(6px); user-select: none; pointer-events: none; }

.flag-badge { display: inline-flex; align-items: center; color: var(--ion-color-warning); margin-left: 2px; }
.flag-badge ion-icon { font-size: 13px; }

@media (max-width: 576px) {
  .poll-card { padding: 14px 14px 12px; }
  .poll-question { font-size: 16px; }
  .poll-description { font-size: 13px; }
}
</style>