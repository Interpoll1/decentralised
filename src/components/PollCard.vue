<template>
  <article ref="cardEl" class="poll-card" :data-poll-id="poll.id" :data-category="poll.category || ''" :data-tags="Array.isArray(poll.tags) ? poll.tags.join(',') : (poll.tags || '')">
    <div v-if="flagged && filterAction === 'blur' && !revealed" class="flagged-overlay" @click.stop="revealed = true">
      <ion-icon :icon="warningOutline"></ion-icon>
      <span>Poll hidden by word filter — tap to reveal</span>
    </div>

    <div class="poll-body" @click="$emit('click')" :class="{ 'content-blurred': flagged && filterAction === 'blur' && !revealed }">

      <!-- ── Header ──────────────────────────────── -->
      <div class="poll-header">
        <div class="poll-header-left">
          <div class="poll-badge">
            <ion-icon :icon="statsChartOutline"></ion-icon>
            <span>Poll</span>
          </div>
          <!-- Trust tier badge — replaces blank space next to poll badge -->
          <TrustTierBadge
            v-if="voteTier"
            :tier="voteTier"
            :compact="true"
          />
        </div>
        <div class="poll-meta">
          <div class="author-avatar-sm" :title="'u/' + authorDisplayName">{{ authorInitial }}</div>
          <span class="author">u/{{ authorDisplayName }}</span>
          <span class="identity-badge" :class="authorIdentityClass">{{ authorIdentityLabel }}</span>
          <span class="separator">·</span>
          <span class="timestamp">{{ formatTime(poll.createdAt) }}</span>
          <span v-if="poll.isExpired" class="expired-badge">Ended</span>
          <span v-if="flagged && filterAction === 'flag'" class="flag-badge">
            <ion-icon :icon="warningOutline"></ion-icon>
          </span>
          <!-- Relay attribution -->
          <span v-if="relayLabel" class="relay-attr-badge">
            <svg viewBox="0 0 24 24" fill="none" width="9" height="9">
              <circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.8"/>
              <path d="M12 2a10 10 0 100 20A10 10 0 0012 2z" stroke="currentColor" stroke-width="1.8"/>
            </svg>
            {{ relayLabel }}
          </span>
        </div>
      </div>

      <!-- ── Question ─────────────────────────────── -->
      <h3 class="poll-question">{{ poll.question || 'Untitled Poll' }}</h3>
      <p v-if="poll.description" class="poll-description">{{ poll.description }}</p>

      <!-- ── Options preview ──────────────────────── -->
      <div v-if="poll.options && poll.options.length > 0" class="poll-options-preview">
        <div
          v-for="(option, index) in poll.options.slice(0, 3)"
          :key="option.id || index"
          class="option-preview"
        >
          <div class="option-info">
            <span class="option-text">{{ option.text || `Option ${index + 1}` }}</span>
            <span class="option-votes">{{ option.votes || 0 }}</span>
          </div>
          <div class="option-bar">
            <div class="option-fill" :style="{ width: `${getOptionPercent(option)}%` }"></div>
          </div>
        </div>
        <div v-if="poll.options.length > 3" class="more-options">
          +{{ poll.options.length - 3 }} more option{{ poll.options.length - 3 !== 1 ? 's' : '' }}
        </div>
      </div>
      <div v-else class="no-options"><p>No options available</p></div>

      <!-- View count — below options, no icon, subtle -->
      <div v-if="poll.viewCount && poll.viewCount > 0" class="poll-view-count-row">
        {{ formatViewCount(poll.viewCount) }} views
      </div>

      <!-- ── Footer ─────────────────────────────────── -->
      <div class="poll-footer" @click.stop>
        <div class="poll-stats">

          <!-- Like / dislike (kept for content curation) -->
          <button class="stat-icon-btn heart" @click="$emit('upvote')" :class="{ active: hasUpvoted }">
            <ion-icon :icon="hasUpvoted ? heart : heartOutline"></ion-icon>
            <span>{{ poll.upvotes || 0 }}</span>
          </button>
          <button class="stat-icon-btn downvote" @click="$emit('downvote')" :class="{ active: hasDownvoted }">
            <svg class="thumb-down-icon" viewBox="0 0 24 24" fill="none">
              <path d="M15 3H6C5.17 3 4.46 3.5 4.16 4.22l-3.02 7.05C1.05 11.5 1 11.74 1 12v2c0 1.1.9 2 2 2h6.31l-.95 4.57-.03.32c0 .41.17.79.44 1.06L9.83 23l6.59-6.59c.36-.36.58-.86.58-1.41V5c0-1.1-.9-2-2-2zm4 0v12h4V3h-4z" fill="currentColor"/>
            </svg>
            <span>{{ poll.downvotes || 0 }}</span>
          </button>

          <!-- Vote count -->
          <div class="stat-item">
            <ion-icon :icon="peopleOutline"></ion-icon>
            <span>{{ displayTotal }} vote{{ displayTotal !== 1 ? 's' : '' }}</span>
          </div>

          <!-- Verified count — trust signal -->
          <div
            v-if="verifiedTotal > 0"
            class="stat-item verified-tally"
            :class="{ inflated: verifiedInflated }"
            :title="verifiedInflated
              ? 'Reported total far exceeds cryptographically verified votes'
              : verifiedTotal + ' vote(s) cryptographically verified'"
          >
            <ion-icon :icon="verifiedInflated ? warningOutline : shieldCheckmarkOutline"></ion-icon>
            <span>{{ verifiedTotal }} verified</span>
          </div>

          <!-- Time remaining -->
          <div class="stat-item">
            <ion-icon :icon="timeOutline"></ion-icon>
            <span>{{ getTimeRemaining() }}</span>
          </div>

          <!-- Multiple choice -->
          <div v-if="poll.allowMultipleChoices" class="stat-item">
            <ion-icon :icon="checkmarkDoneOutline"></ion-icon>
            <span>Multi-choice</span>
          </div>

          <!-- Time-lock indicator -->
          <div v-if="isTimeLocked" class="stat-item stat-item--timelock">
            <svg viewBox="0 0 24 24" fill="none" width="13" height="13">
              <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.8"/>
              <path d="M12 6v6l4 2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
            </svg>
            <span>Results locked</span>
          </div>

          <!-- Moderation -->
          <ion-button
            v-if="showModerationAction"
            fill="clear" size="small" class="moderation-action"
            :title="moderationActionTitle"
            @click.stop="$emit('moderation-submit')"
          >
            Filter <ion-icon slot="end" :icon="shieldCheckmarkOutline"></ion-icon>
          </ion-button>
        </div>

        <div class="poll-actions">
          <!-- Share -->
          <button class="action-btn" title="Share" @click.stop="handleShare">
            <svg class="reddit-share-icon" viewBox="0 0 24 24" fill="none">
              <path d="M21 12l-7-7v4C7 10 4 15 3 21c2.5-3.5 6-5.1 11-5.1V20l7-8z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>
            </svg>
          </button>

          <!-- Nostr share button if event ID exists -->
          <button v-if="nostrEventId" class="action-btn action-btn--nostr" title="Open in Nostr client" @click.stop="openNostr">
            <svg viewBox="0 0 24 24" fill="none" width="15" height="15">
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>

          <!-- Vote button removed: clicking the card already opens PollDetail -->
        </div>
      </div>

    </div>
  </article>
</template>

<script setup lang="ts">
import { ref, onMounted, nextTick, computed, watch } from 'vue';
import { IonIcon, IonButton } from '@ionic/vue';
import {
  statsChartOutline, peopleOutline, timeOutline, checkmarkDoneOutline,
  chevronForwardOutline, warningOutline, shieldCheckmarkOutline,
  heart, heartOutline,
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
import TrustTierBadge from './TrustTierBadge.vue';
// observePost called by HomePage MutationObserver, not directly here

const cardEl = ref<HTMLElement | null>(null);
const props = defineProps<{
  poll: Poll;
  flagged?: boolean;
  filterAction?: FilterAction;
  showModerationAction?: boolean;
  moderationActionTitle?: string;
  hasUpvoted?: boolean;
  hasDownvoted?: boolean;
  relayLabel?: string;
  userTags?: string[];
}>();

defineEmits(['click', 'vote', 'moderation-submit', 'upvote', 'downvote', 'tag-click']);

const results        = useVerifiedPollResults(() => props.poll);
const verifiedTotal  = results.verifiedTotal;
const displayTotal   = results.displayTotal;
const verifiedInflated = computed(() => results.trust.value === 'inflated');

const revealed    = ref(false);
const userStore   = useUserStore();
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
  { immediate: true },
);

const authorDisplayName = computed(() => {
  if (props.poll.authorShowRealName) return props.poll.authorName || 'anon';
  if (props.poll.authorId && props.poll.id) return generatePseudonym(props.poll.id, props.poll.authorId);
  return props.poll.authorName || 'anon';
});
const authorInitial = computed(() => (authorDisplayName.value || 'a').charAt(0).toUpperCase());

const authorIdentityLabel = computed(() =>
  authorProfile.value?.identityTrustLevel === 'trusted-issuer'
    ? formatTrustedIdentityLabel({
        username: authorProfile.value?.identityUsername || authorProfile.value?.customUsername || props.poll.authorName,
        issuer: authorProfile.value?.identityIssuer,
      })
    : 'Unverified'
);
const authorIdentityClass = computed(() =>
  authorProfile.value?.identityTrustLevel === 'trusted-issuer' ? 'trusted-issuer' : 'unverified'
);

// Trust tier from poll metadata
const voteTier = computed<'anonymous' | 'pow' | 'relay' | 'issuer' | null>(() => {
  const t = (props.poll as any).voteTrustPolicy?.requiredTier || (props.poll as any).trustTier;
  if (!t || t === 'anonymous') return null; // don't show badge for open polls
  return t;
});

const displayTags = computed<string[]>(() => {
  const raw = (props.poll as any).tags ?? [];
  const arr = Array.isArray(raw)
    ? raw
    : String(raw).split(',').map((t: string) => t.trim());
  return arr.filter((t: string) => Boolean(t)).slice(0, 5);
});

// Time-lock
const isTimeLocked = computed(() => {
  return !!(props.poll as any).resultsLockedUntil && (props.poll as any).resultsLockedUntil > Date.now();
});

// Nostr event ID
const nostrEventId = computed(() => (props.poll as any).nostrEventId || (props.poll as any).eventId || '');
function openNostr() {
  if (!nostrEventId.value) return;
  window.open(`https://njump.me/${nostrEventId.value}`, '_blank', 'noopener');
}

function formatTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const m = Math.floor(diff / 60000), h = Math.floor(diff / 3600000), d = Math.floor(diff / 86400000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m`;
  if (h < 24) return `${h}h`;
  if (d < 7) return `${d}d`;
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
function formatViewCount(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'K';
  return n.toString();
}

// View tracking handled by HomePage MutationObserver on the feed container.
</script>

<style scoped>
/* ── Inherits all existing styles — additions only ── */
.poll-card {
  margin: 0 0 2px;
  padding: 18px 20px 16px;
  border-bottom: 1px solid rgba(15, 23, 42, 0.08);
  cursor: pointer;
}

.poll-header { display: flex; flex-direction: column; gap: 8px; margin-bottom: 10px; }
.poll-header-left { display: flex; align-items: center; gap: 8px; }

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
}
.author-avatar-sm {
  width: 22px; height: 22px; border-radius: 50%;
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  color: #fff; font-size: 10px; font-weight: 700;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.separator { color: rgba(255,255,255,0.18); font-size: 11px; }
.author { color: var(--app-text); font-weight: 600; font-size: 12px; }
.identity-badge, .expired-badge {
  padding: 2px 7px; border-radius: 999px; font-size: 9px; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.06em;
}
.identity-badge.unverified    { background: rgba(var(--ion-color-warning-rgb), 0.1); color: var(--ion-color-warning); }
.identity-badge.trusted-issuer { background: rgba(var(--ion-color-success-rgb), 0.12); color: var(--ion-color-success); }
.expired-badge                { background: rgba(var(--ion-color-medium-rgb), 0.1); color: var(--app-text-muted); }
.timestamp { color: var(--app-text-subtle); font-size: 11px; }

/* Relay attribution badge */
.relay-attr-badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 9.5px;
  font-weight: 600;
  color: var(--app-text-subtle);
  padding: 1px 6px;
  border-radius: 5px;
  background: rgba(255,255,255,0.04);
  border: 0.5px solid rgba(255,255,255,0.07);
}

.poll-question {
  margin: 0 0 8px;
  font-size: 18px; font-weight: 800; line-height: 1.25; letter-spacing: -0.03em;
  background: linear-gradient(135deg, var(--app-text) 60%, rgba(167,139,250,0.85));
  -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent;
}
.poll-description { margin: 0 0 12px; font-size: 13.5px; line-height: 1.6; color: var(--app-text-muted); }

.poll-options-preview { display: flex; flex-direction: column; gap: 9px; margin-bottom: 14px; }
.option-info { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; margin-bottom: 5px; }
.option-text  { color: var(--app-text); font-size: 13.5px; font-weight: 500; }
.option-votes { color: var(--app-text-subtle); font-size: 12px; font-variant-numeric: tabular-nums; }
.more-options { font-size: 12.5px; color: var(--app-accent-bright); font-weight: 600; padding-left: 2px; }
.option-bar   { height: 5px; background: rgba(255,255,255,0.05); border-radius: 999px; overflow: hidden; }
.option-fill  { height: 100%; background: linear-gradient(90deg, var(--app-accent), var(--ion-color-tertiary)); border-radius: 999px; transition: width 0.5s cubic-bezier(0.16,1,0.3,1); }

.poll-footer {
  display: flex; justify-content: space-between; align-items: center;
  gap: 8px; padding-top: 12px; border-top: 1px solid rgba(15,23,42,0.08); flex-wrap: wrap;
}
.poll-stats  { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
.poll-actions { display: flex; align-items: center; gap: 4px; margin-left: auto; }

.stat-icon-btn {
  display: inline-flex; align-items: center; gap: 5px; padding: 6px 11px;
  background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.07);
  border-radius: 999px; font-size: 12px; font-weight: 600; color: var(--app-text-muted); cursor: pointer;
  transition: color 160ms, background 160ms;
}
.stat-icon-btn ion-icon { font-size: 15px; color: var(--app-text-subtle); }
.stat-icon-btn.heart,
.stat-icon-btn.heart ion-icon { color: #a78bfa; }
.stat-icon-btn.heart.active,
.stat-icon-btn.heart.active ion-icon { color: #c4b5fd; }
.thumb-down-icon { width: 15px; height: 15px; transform: rotate(-20deg) scaleX(-1); flex-shrink: 0; color: var(--app-text-subtle); }
.stat-icon-btn.downvote.active { color: #ef4444; border-color: rgba(239,68,68,0.3); }
.stat-icon-btn.downvote.active .thumb-down-icon { color: #ef4444; }

.stat-item {
  display: inline-flex; align-items: center; gap: 5px; padding: 6px 11px;
  background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.07);
  border-radius: 999px; font-size: 12px; color: var(--app-text-muted);
}
.stat-item ion-icon { font-size: 13px; color: var(--app-text-subtle); }
.poll-view-count-row {
  font-size: 11px;
  color: var(--app-text-subtle);
  opacity: 0.6;
  margin: -6px 0 8px;
  letter-spacing: 0.01em;
}
.stat-item--timelock {
  color: #fbbf24; border-color: rgba(251,191,36,0.22); background: rgba(251,191,36,0.07);
}
.stat-item--timelock svg { color: #fbbf24; }

.verified-tally { color: #34d399; border-color: rgba(52,211,153,0.25); background: rgba(52,211,153,0.08); }
.verified-tally ion-icon { color: #34d399; }
.verified-tally.inflated { color: #fbbf24; border-color: rgba(251,191,36,0.3); background: rgba(251,191,36,0.1); }

.action-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 32px; height: 32px; background: none; border: none;
  border-radius: 50%; color: var(--app-text-subtle); cursor: pointer;
  transition: color 160ms, background 160ms;
}
.action-btn:hover { color: var(--app-accent-bright); background: rgba(var(--app-accent-rgb),0.08); }
.action-btn--nostr { color: #a78bfa; }
.action-btn--nostr:hover { color: #c4b5fd; background: rgba(167,139,250,0.1); }
.reddit-share-icon { width: 18px; height: 18px; }

.vote-btn {
  --color: var(--app-text-muted);
  --border-color: rgba(255,255,255,0.12);
  --background: transparent;
  --background-hover: rgba(255,255,255,0.05);
  font-size: 12px;
  font-weight: 500;
  text-transform: none;
  letter-spacing: 0;
}
.moderation-action { --color: var(--ion-color-warning); }

.flagged-overlay {
  display: flex; align-items: center; gap: 8px; padding: 9px 14px; margin-bottom: 10px;
  background: rgba(var(--ion-color-warning-rgb),0.1); border: 1px solid rgba(var(--ion-color-warning-rgb),0.25);
  border-radius: 10px; color: var(--ion-color-warning); font-size: 12.5px; cursor: pointer;
}
.content-blurred { filter: blur(6px); user-select: none; pointer-events: none; }
.flag-badge { display: inline-flex; align-items: center; color: var(--ion-color-warning); }
.flag-badge ion-icon { font-size: 13px; }
.no-options p { font-size: 13px; color: var(--app-text-subtle); }

/* ── Tag chips ───────────────────────────────────── */
.post-tag-chips {
  display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 6px;
}
.post-tag-chip {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 3px 10px; border-radius: 999px;
  background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08);
  color: var(--app-text-muted); font-size: 11.5px; font-weight: 600;
  cursor: pointer; transition: color 0.14s, background 0.14s, border-color 0.14s;
}
.post-tag-chip:hover { color: var(--app-text); background: rgba(255,255,255,0.07); }
.post-tag-chip--highlight {
  color: #fbbf24; border-color: rgba(251,191,36,0.28); background: rgba(251,191,36,0.08);
}
.post-tag-chip--highlight:hover { background: rgba(251,191,36,0.14); }

@media (max-width: 576px) {
  .poll-card { padding: 14px 12px 12px; }
  .poll-question { font-size: 16px; }
}
</style>