<template>
  <article ref="cardEl" class="post-card" :class="{ 'post-card--flagged': flagged && filterAction === 'blur' && !revealed }" :data-post-id="post.id" :data-category="post.category || ''" :data-tags="Array.isArray(post.tags) ? post.tags.join(',') : (post.tags || '')">

    <!-- Flagged overlay -->
    <div v-if="flagged && filterAction === 'blur' && !revealed" class="post-flagged-overlay" @click.stop="revealed = true">
      <ion-icon :icon="warningOutline"></ion-icon>
      <span>Post hidden by word filter — tap to reveal</span>
    </div>

    <div class="post-inner" @click="$emit('click')" :class="{ 'content-blurred': flagged && filterAction === 'blur' && !revealed }">

      <!-- ── Header ───────────────────────────────── -->
      <div class="post-header">
        <div class="post-header-meta">
          <div class="post-avatar" :title="authorDisplayName">{{ authorInitial }}</div>
          <div class="post-meta-text">
            <div class="post-meta-row">
              <span class="post-author">{{ authorDisplayName }}</span>
              <span class="post-identity-badge" :class="authorIdentityClass">{{ authorIdentityLabel }}</span>
              <span class="post-sep">·</span>
              <span class="post-time">{{ formatTime(post.createdAt) }}</span>
            </div>
            <div class="post-meta-row post-meta-row--sub">
              <span v-if="communityName" class="post-community">
                <ion-icon :icon="peopleOutline" style="font-size:11px"></ion-icon>
                {{ communityName }}
              </span>
              <!-- Relay attribution -->
              <span v-if="relayLabel" class="post-relay-attr">
                <svg viewBox="0 0 24 24" fill="none" width="9" height="9">
                  <circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.8"/>
                  <path d="M12 2a10 10 0 100 20A10 10 0 0012 2z" stroke="currentColor" stroke-width="1.8"/>
                  <path d="M2 12h20M12 2c-3 3-4.5 6.5-4.5 10S9 19 12 22c3-3 4.5-6.5 4.5-10S15 5 12 2z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
                </svg>
                {{ relayLabel }}
              </span>
              <!-- Time-lock indicator -->
              <span v-if="isTimeLocked" class="post-timelock-badge">
                <svg viewBox="0 0 24 24" fill="none" width="10" height="10">
                  <rect x="3" y="11" width="18" height="11" rx="2" stroke="currentColor" stroke-width="1.8"/>
                  <path d="M7 11V7a5 5 0 0110 0v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
                </svg>
                locked
              </span>
            </div>
          </div>
        </div>
        <span v-if="flagged && filterAction === 'flag'" class="post-flag-dot">
          <ion-icon :icon="warningOutline"></ion-icon>
        </span>
      </div>

      <!-- ── Content ──────────────────────────────── -->
      <h3 class="post-title">{{ post.title }}</h3>

      <div v-if="post.content" class="post-excerpt">
        {{ truncated ? truncateText(post.content, 200) : post.content }}
        <button v-if="post.content.length > 200" class="post-read-more" @click.stop="truncated = !truncated">
          {{ truncated ? 'Read more' : 'Show less' }}
        </button>
      </div>

      <!-- Media preview -->
      <div v-if="post.mediaUrl || post.videoCID" class="post-media">
        <img
          v-if="post.mediaUrl && isImageUrl(post.mediaUrl)"
          :src="post.mediaUrl"
          :alt="post.title"
          class="post-media-img"
          loading="lazy"
          @click.stop
        />
        <!-- Video: use IPFS CID path with skeleton while async component loads -->
        <template v-else-if="post.videoCID">
          <Suspense>
            <VideoPlayer
              :cid="post.videoCID"
              :thumbnail-url="post.videoThumbnailCID
                ? `https://ipfs.filebase.io/ipfs/${post.videoThumbnailCID}`
                : null"
              :duration="post.videoDuration"
              :file-size="post.videoSize"
              :mime-type="post.videoMimeType"
              :compact="true"
              class="post-media-video"
            />
            <template #fallback>
              <div class="post-video-skeleton">
                <div class="post-video-skeleton__icon">▶</div>
              </div>
            </template>
          </Suspense>
        </template>
      </div>

      <!-- ── Nostr event ID strip ─────────────────── -->
      <div v-if="nostrEventId" class="post-nostr-strip" @click.stop>
        <svg class="post-nostr-icon" viewBox="0 0 24 24" fill="none" width="12" height="12">
          <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <code class="post-nostr-id">{{ shortenNostrId(nostrEventId) }}</code>
        <button class="post-nostr-open" @click.stop="openNostr" title="Open in Nostr client">↗</button>
        <button class="post-nostr-copy" @click.stop="copyNostrId" :title="nostrCopied ? 'Copied!' : 'Copy event ID'">
          <svg v-if="!nostrCopied" viewBox="0 0 24 24" fill="none" width="11" height="11">
            <rect x="9" y="9" width="13" height="13" rx="2" stroke="currentColor" stroke-width="1.8"/>
            <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" stroke="currentColor" stroke-width="1.8"/>
          </svg>
          <svg v-else viewBox="0 0 24 24" fill="none" width="11" height="11">
            <path d="M20 6L9 17l-5-5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </div>

      <!-- View count — below content, no icon, subtle -->
      <div v-if="post.viewCount && post.viewCount > 0" class="post-view-count-row">
        {{ formatViewCount(post.viewCount) }} views
      </div>

      <!-- ── Footer ───────────────────────────────── -->
      <div class="post-footer" @click.stop>

        <div class="post-actions">
          <!-- Like (heart) -->
          <button
            class="post-action-btn post-action-btn--heart"
            :class="{ active: hasUpvoted }"
            @click.stop="$emit('upvote')"
            :aria-label="hasUpvoted ? 'Unlike' : 'Like'"
          >
            <ion-icon :icon="hasUpvoted ? heart : heartOutline" style="font-size:15px"></ion-icon>
            <span>{{ post.upvotes || 0 }}</span>
          </button>

          <!-- Downvote -->
          <button
            class="post-action-btn post-action-btn--down"
            :class="{ active: hasDownvoted }"
            @click.stop="$emit('downvote')"
            :aria-label="hasDownvoted ? 'Remove downvote' : 'Downvote'"
          >
            <svg class="thumb-down-icon" viewBox="0 0 24 24" fill="none" width="14" height="14">
              <path d="M15 3H6C5.17 3 4.46 3.5 4.16 4.22l-3.02 7.05C1.05 11.5 1 11.74 1 12v2c0 1.1.9 2 2 2h6.31l-.95 4.57-.03.32c0 .41.17.79.44 1.06L9.83 23l6.59-6.59c.36-.36.58-.86.58-1.41V5c0-1.1-.9-2-2-2zm4 0v12h4V3h-4z" fill="currentColor"/>
            </svg>
            <span>{{ post.downvotes || 0 }}</span>
          </button>

          <!-- Comments -->
          <button class="post-action-btn" @click.stop="$emit('comments')">
            <svg viewBox="0 0 24 24" fill="none" width="14" height="14">
              <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
            </svg>
            <span>{{ commentCount }}</span>
          </button>

          <!-- Share -->
          <button class="post-action-btn" @click.stop="handleShare" aria-label="Share post">
            <svg viewBox="0 0 24 24" fill="none" width="14" height="14">
              <path d="M21 12l-7-7v4C7 10 4 15 3 21c2.5-3.5 6-5.1 11-5.1V20l7-8z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>
            </svg>
            <span>Share</span>
          </button>

          <!-- Nostr open (compact, in footer too) -->
          <button v-if="nostrEventId" class="post-action-btn post-action-btn--nostr" @click.stop="openNostr" title="Open in Nostr">
            <svg viewBox="0 0 24 24" fill="none" width="14" height="14">
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>

          <!-- Moderation -->
          <ion-button
            v-if="showModerationAction"
            fill="clear" size="small" class="post-mod-btn"
            :title="moderationActionTitle"
            @click.stop="$emit('moderation-submit')"
          >
            <ion-icon slot="start" :icon="shieldCheckmarkOutline"></ion-icon>
            Filter
          </ion-button>
        </div>

      </div>

    </div>
  </article>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { IonIcon, IonButton } from '@ionic/vue';
import { peopleOutline, warningOutline, shieldCheckmarkOutline, heart, heartOutline } from 'ionicons/icons';
import { defineAsyncComponent } from 'vue';
import type { Post } from '../services/postService';
import type { FilterAction } from '../services/moderationService';
import { generatePseudonym } from '../utils/pseudonym';
import { formatTrustedIdentityLabel } from '../utils/identityTrust';
import { useUserStore } from '../stores/userStore';
import type { UserProfile } from '../services/userService';
// onMounted/nextTick not needed — view tracking via HomePage MutationObserver
import { shareLink } from '../composables/useShare';
// observePost called by HomePage MutationObserver, not directly here

const VideoPlayer = defineAsyncComponent(() => import('./VideoPlayer.vue'));

const cardEl = ref<HTMLElement | null>(null);
const props = defineProps<{
  post: Post;
  communityName?: string;
  hasUpvoted?: boolean;
  hasDownvoted?: boolean;
  flagged?: boolean;
  filterAction?: FilterAction;
  showModerationAction?: boolean;
  moderationActionTitle?: string;
  relayLabel?: string;
  userTags?: string[];
}>();

defineEmits(['click', 'upvote', 'downvote', 'comments', 'moderation-submit', 'tag-click']);

// ── State ──────────────────────────────────────────────────────────────────
const revealed     = ref(false);
const truncated    = ref(true);
const nostrCopied  = ref(false);

const userStore     = useUserStore();
const authorProfile = ref<UserProfile | null>(null);
let profileRequestId = 0;

watch(
  () => props.post.authorId,
  async (id) => {
    const reqId = ++profileRequestId;
    if (!id) { authorProfile.value = null; return; }
    const p = await userStore.getProfile(id);
    if (reqId !== profileRequestId) return;
    authorProfile.value = p;
  },
  { immediate: true },
);

// ── Computed ───────────────────────────────────────────────────────────────
const authorDisplayName = computed(() => {
  if (props.post.authorShowRealName) return props.post.authorName || 'anon';
  if (props.post.authorId && props.post.id) return generatePseudonym(props.post.id, props.post.authorId);
  return props.post.authorName || 'anon';
});
const authorInitial = computed(() => (authorDisplayName.value || 'a').charAt(0).toUpperCase());

const authorIdentityLabel = computed(() =>
  authorProfile.value?.identityTrustLevel === 'trusted-issuer'
    ? formatTrustedIdentityLabel({
        username: authorProfile.value?.identityUsername || props.post.authorName,
        issuer:   authorProfile.value?.identityIssuer,
      })
    : 'Unverified'
);
const authorIdentityClass = computed(() =>
  authorProfile.value?.identityTrustLevel === 'trusted-issuer' ? 'trusted-issuer' : 'unverified'
);

const commentCount  = computed(() => (props.post as any).commentCount ?? 0);

const displayTags = computed<string[]>(() => {
  const raw = (props.post as any).tags ?? [];
  const arr = Array.isArray(raw)
    ? raw
    : String(raw).split(',').map((t: string) => t.trim());
  return arr.filter((t: string) => Boolean(t)).slice(0, 5);
});
const isTimeLocked  = computed(() => !!(props.post as any).resultsLockedUntil && (props.post as any).resultsLockedUntil > Date.now());
const nostrEventId  = computed(() => (props.post as any).nostrEventId || (props.post as any).eventId || '');

// ── Methods ────────────────────────────────────────────────────────────────
function formatTime(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000), h = Math.floor(diff / 3600000), d = Math.floor(diff / 86400000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m`;
  if (h < 24) return `${h}h`;
  if (d < 7)  return `${d}d`;
  return new Date(ts).toLocaleDateString();
}

function truncateText(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max).trimEnd() + '…';
}

function isImageUrl(url: string): boolean {
  return /\.(jpg|jpeg|png|gif|webp|avif|svg)(\?|$)/i.test(url);
}

function shortenNostrId(id: string): string {
  if (id.length > 20) return id.slice(0, 12) + '…' + id.slice(-6);
  return id;
}

function openNostr() {
  if (!nostrEventId.value) return;
  window.open(`https://njump.me/${nostrEventId.value}`, '_blank', 'noopener');
}

async function copyNostrId() {
  if (!nostrEventId.value) return;
  await navigator.clipboard.writeText(nostrEventId.value).catch(() => {});
  nostrCopied.value = true;
  setTimeout(() => { nostrCopied.value = false; }, 2000);
}

function handleShare() {
  const url = props.post.communityId
    ? `/community/${props.post.communityId}/post/${props.post.id}`
    : `/post/${props.post.id}`;
  void shareLink(url, props.post.title || 'Interpoll post', 'Read this post on Interpoll');
}
function formatViewCount(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'K';
  return n.toString();
}

// View tracking handled by HomePage MutationObserver on the feed container.
// observePost is called when the article element is inserted into the DOM.
</script>

<style scoped>
/* ── Card shell ─────────────────────────────────── */
.post-card {
  padding: 18px 20px 14px;
  border-bottom: 1px solid rgba(15, 23, 42, 0.08);
  cursor: pointer;
  transition: background 0.12s;
}
.post-card:hover { background: rgba(255,255,255,0.012); }
.post-card--flagged { opacity: 0.7; }

.post-inner { display: flex; flex-direction: column; gap: 10px; }
.content-blurred { filter: blur(6px); user-select: none; pointer-events: none; }

/* ── Flagged overlay ────────────────────────────── */
.post-flagged-overlay {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 14px; margin-bottom: 6px;
  background: rgba(var(--ion-color-warning-rgb), 0.08);
  border: 1px solid rgba(var(--ion-color-warning-rgb), 0.2);
  border-radius: 10px; color: var(--ion-color-warning);
  font-size: 12.5px; cursor: pointer;
}

/* ── Header ─────────────────────────────────────── */
.post-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
.post-header-meta { display: flex; align-items: flex-start; gap: 10px; flex: 1; min-width: 0; }
.post-avatar {
  width: 28px; height: 28px; border-radius: 50%; flex-shrink: 0;
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  color: #fff; font-size: 11px; font-weight: 700;
  display: flex; align-items: center; justify-content: center;
}
.post-meta-text { display: flex; flex-direction: column; gap: 3px; min-width: 0; flex: 1; }
.post-meta-row { display: flex; align-items: center; flex-wrap: wrap; gap: 5px; }
.post-meta-row--sub { gap: 4px; }
.post-author { font-size: 12.5px; font-weight: 700; color: var(--app-text); }
.post-time   { font-size: 11.5px; color: var(--app-text-subtle); }
.post-sep    { color: rgba(255,255,255,0.15); font-size: 11px; }
.post-community { display: flex; align-items: center; gap: 3px; font-size: 11px; color: var(--app-text-subtle); }

.post-identity-badge {
  font-size: 9.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.07em;
  padding: 2px 6px; border-radius: 5px;
}
.post-identity-badge.unverified     { background: rgba(var(--ion-color-warning-rgb),0.08); color: var(--ion-color-warning); }
.post-identity-badge.trusted-issuer { background: rgba(var(--ion-color-success-rgb),0.1);  color: var(--ion-color-success); }

/* Relay attribution */
.post-relay-attr {
  display: inline-flex; align-items: center; gap: 3px;
  font-size: 9.5px; font-weight: 600; color: var(--app-text-subtle);
  padding: 1px 6px; border-radius: 5px;
  background: rgba(255,255,255,0.04); border: 0.5px solid rgba(255,255,255,0.07);
}

/* Time-lock badge */
.post-timelock-badge {
  display: inline-flex; align-items: center; gap: 3px;
  font-size: 9.5px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;
  color: #fbbf24; padding: 1px 6px; border-radius: 5px;
  background: rgba(251,191,36,0.08); border: 0.5px solid rgba(251,191,36,0.18);
}

.post-flag-dot { color: var(--ion-color-warning); flex-shrink: 0; }

/* ── Content ─────────────────────────────────────── */
.post-title {
  margin: 0; font-size: 17px; font-weight: 800;
  line-height: 1.28; letter-spacing: -0.025em;
  color: var(--app-text);
}
.post-excerpt {
  font-size: 13.5px; line-height: 1.6; color: var(--app-text-muted); margin: 0;
}
.post-read-more {
  background: none; border: none; color: var(--app-accent-bright);
  font-size: 13px; font-weight: 600; cursor: pointer; padding: 0 0 0 4px;
}

.post-media { border-radius: 10px; overflow: hidden; margin-top: 2px; }
.post-media-img { width: 100%; max-height: 320px; object-fit: cover; display: block; }
.post-media-video { width: 100%; }
.post-video-skeleton {
  width: 100%; height: 180px;
  background: rgba(255,255,255,0.05);
  border-radius: 10px;
  display: flex; align-items: center; justify-content: center;
  animation: skeleton-pulse 1.4s ease-in-out infinite;
}
.post-video-skeleton__icon {
  font-size: 28px; opacity: 0.2;
}
@keyframes skeleton-pulse {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.5; }
}

/* ── Nostr strip ─────────────────────────────────── */
.post-nostr-strip {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  background: rgba(167, 139, 250, 0.06);
  border: 0.5px solid rgba(167, 139, 250, 0.16);
  border-radius: 8px;
  cursor: default;
}
.post-nostr-icon { color: #a78bfa; flex-shrink: 0; }
.post-nostr-id {
  flex: 1;
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  color: var(--app-text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.post-nostr-open, .post-nostr-copy {
  background: none; border: none;
  color: var(--app-text-subtle); font-size: 11px; font-weight: 700;
  cursor: pointer; padding: 2px 4px; border-radius: 4px;
  transition: color 0.15s;
  flex-shrink: 0;
}
.post-nostr-open:hover { color: #a78bfa; }
.post-nostr-copy:hover { color: var(--app-accent-bright); }

/* ── Footer / actions ────────────────────────────── */
.post-footer { display: flex; align-items: center; justify-content: space-between; }
.post-actions { display: flex; align-items: center; gap: 2px; flex-wrap: wrap; }

.post-action-btn {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 6px 11px; border-radius: 999px;
  background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.07);
  font-size: 12px; font-weight: 600;
  color: var(--app-text-muted); cursor: pointer;
  transition: color 0.14s, background 0.14s;
}
.post-action-btn:hover { color: var(--app-text); background: rgba(255,255,255,0.08); }
.post-action-btn svg { flex-shrink: 0; }

.post-view-count-row {
  font-size: 11px;
  color: var(--app-text-subtle);
  opacity: 0.6;
  margin: 2px 0 4px;
  letter-spacing: 0.01em;
}
.post-action-btn--heart             { color: #a78bfa; }
.post-action-btn--heart.active      { color: #c4b5fd; }
.post-action-btn--down              { color: var(--app-text-muted); }
.post-action-btn--down.active       { color: #ef4444; }
.post-action-btn--down .thumb-down-icon { color: var(--app-text-subtle); transform: rotate(-20deg) scaleX(-1); }
.post-action-btn--down.active { color: #ef4444; }
.post-action-btn--down.active .thumb-down-icon { color: #ef4444; }
.post-action-btn--down.active       { color: #f87171; }
.post-action-btn--nostr             { color: #a78bfa; }
.post-action-btn--nostr:hover       { color: #c4b5fd; background: rgba(167,139,250,0.08); }

.post-mod-btn { --color: var(--ion-color-warning); font-size: 12px; }

/* ── Tag chips ───────────────────────────────────── */
.post-tag-chips {
  display: flex; flex-wrap: wrap; gap: 6px;
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
  .post-card  { padding: 14px 12px 12px; }
  .post-title { font-size: 15px; }
}
</style>