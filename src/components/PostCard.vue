<!-- PostCard.vue -->
<template>
  <article class="post-card" v-if="post">
    <div v-if="flagged && filterAction === 'blur' && !revealed" class="flagged-overlay" @click.stop="revealed = true">
      <ion-icon :icon="warningOutline"></ion-icon>
      <span>Content hidden by word filter — tap to reveal</span>
    </div>

    <div class="post-body" @click="handleCardClick" :class="{ 'content-blurred': flagged && filterAction === 'blur' && !revealed }">
      <div class="post-header">
        <div class="post-meta">
          <!-- Avatar beside username -->
          <div class="author-avatar" :title="'u/' + authorDisplayName">
            {{ authorInitial }}
          </div>
          <span class="community-name">{{ communityName }}</span>
          <span class="separator">·</span>
          <span class="author-wrap">
            <span class="author">u/{{ authorDisplayName }}</span>
            <button
              v-if="canInviteAuthor"
              class="invite-chat-btn"
              type="button"
              @click.stop="handleInviteToChat"
            >
              Invite to chat
            </button>
          </span>
          <span class="identity-badge" :class="authorIdentityClass">
            {{ authorIdentityLabel }}
          </span>
          <span class="separator">·</span>
          <span class="timestamp">{{ formatTime(post.createdAt) }}</span>
          <span v-if="flagged && filterAction === 'flag'" class="flag-badge" title="Flagged by word filter">
            <ion-icon :icon="warningOutline"></ion-icon>
          </span>
        </div>
      </div>

      <h3 class="post-title">{{ post.title }}</h3>

      <p v-if="post.content" class="post-content" v-html="autoLink(truncatedContent)"></p>

      <div v-if="post.imageThumbnail || post.imageIPFS" class="post-image" @click.stop="openLightbox">
        <img
          :src="post.imageThumbnail || getIPFSUrl(post.imageIPFS)"
          :alt="post.title"
          loading="lazy"
        />
        <div class="image-expand-hint">
          <ion-icon :icon="expandOutline"></ion-icon>
        </div>
      </div>

      <!-- Video attachment -->
      <div v-if="post.videoCID" class="post-video" @click.stop>
        <!--
          Skeleton: visible immediately from post data, zero network cost.
          Clicking it lazy-mounts VideoPlayer which then takes over.
        -->
        <div v-if="!videoPlayerMounted" class="post-video-skeleton" @click="videoPlayerMounted = true">
          <div class="post-video-skeleton__play">
            <svg viewBox="0 0 48 48" fill="none">
              <circle cx="24" cy="24" r="24" fill="rgba(0,0,0,0.55)"/>
              <polygon points="19,14 37,24 19,34" fill="#fff"/>
            </svg>
          </div>
          <div class="post-video-skeleton__meta">
            <svg viewBox="0 0 24 24" fill="currentColor" class="post-video-skeleton__cam-icon">
              <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/>
            </svg>
            <span>{{ post.videoDuration ? formatDuration(post.videoDuration) : 'Video' }}</span>
          </div>
        </div>
        <VideoPlayer
          v-if="videoPlayerMounted"
          :cid="post.videoCID"
          :thumbnail-url="post.videoThumbnailCID ? getIPFSUrl(post.videoThumbnailCID) : null"
          :duration="post.videoDuration"
          :file-size="post.videoSize"
          :mime-type="post.videoMimeType"
          :compact="true"
        />
      </div>

      <!-- Image lightbox -->
      <teleport to="body">
        <div v-if="lightboxOpen" class="lightbox-overlay" @click="lightboxOpen = false">
          <button class="lightbox-close" @click.stop="lightboxOpen = false" title="Close">
            <ion-icon :icon="closeOutline"></ion-icon>
          </button>
          <img
            class="lightbox-img"
            :src="post.imageThumbnail || getIPFSUrl(post.imageIPFS)"
            :alt="post.title"
            @click.stop
          />
        </div>
      </teleport>

      <div class="post-footer" @click.stop>
        <div class="post-stats">
          <button class="stat-icon-btn heart" @click="handleUpvote" :class="{ active: hasUpvoted }" title="Like">
            <ion-icon :icon="hasUpvoted ? heart : heartOutline"></ion-icon>
            <span>{{ formatNumber(post.upvotes) }}</span>
          </button>

          <!-- YouTube-style rotated thumbs down -->
          <button class="stat-icon-btn downvote" @click="handleDownvote" :class="{ active: hasDownvoted }" title="Downvote">
            <svg class="thumb-down-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M15 3H6C5.17 3 4.46 3.5 4.16 4.22l-3.02 7.05C1.05 11.5 1 11.74 1 12v2c0 1.1.9 2 2 2h6.31l-.95 4.57-.03.32c0 .41.17.79.44 1.06L9.83 23l6.59-6.59c.36-.36.58-.86.58-1.41V5c0-1.1-.9-2-2-2zm4 0v12h4V3h-4z" fill="currentColor"/>
            </svg>
            <span>{{ formatNumber(post.downvotes) }}</span>
          </button>

          <!-- Comments — navigates to post + scrolls to comments -->
          <button class="stat-icon-btn comments" @click="handleCommentsClick" title="Comments">
            <ion-icon :icon="chatbubbleOutline"></ion-icon>
            <span>{{ formatNumber(post.commentCount) }}</span>
          </button>

          <div class="stat-score">
            <ion-icon :icon="trendingUpOutline"></ion-icon>
            <span>{{ post.score }}</span>
          </div>

          <button
            v-if="showModerationAction"
            class="stat-icon-btn moderation-btn"
            @click="handleModerationAction"
            :title="moderationActionTitle"
          >
            <ion-icon :icon="shieldCheckmarkOutline"></ion-icon>
          </button>

          <!-- Curved-arrow share icon -->
          <button class="stat-icon-btn share" @click="handleShare" title="Share this post">
            <svg class="share-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M21 12l-7-7v4C7 10 4 15 3 21c2.5-3.5 6-5.1 11-5.1V20l7-8z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
  </article>
</template>

<style scoped>
.post-card {
  margin: 0 0 2px;
  padding: 18px 20px 16px;
  border-bottom: 1px solid var(--app-border);
  cursor: pointer;
}

/* ── Header ──────────────────────────────────── */
.post-header { margin-bottom: 10px; }

.post-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--app-text-muted);
  flex-wrap: wrap;
}

/* Avatar in header row */
.author-avatar {
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

.community-name {
  color: var(--app-accent-bright);
  font-weight: 700;
  font-size: 12.5px;
  letter-spacing: -0.01em;
}

.separator { color: rgba(255,255,255,0.2); font-size: 11px; margin: 0 1px; }

.author {
  color: var(--app-text);
  font-weight: 600;
  font-size: 13px;
  letter-spacing: -0.01em;
}

.author-wrap {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.invite-chat-btn {
  border: 1px solid rgba(var(--app-accent-rgb),0.24);
  background: rgba(var(--app-accent-rgb),0.1);
  color: var(--app-accent-bright);
  border-radius: 999px;
  padding: 2px 8px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
  cursor: pointer;
  opacity: 0;
  transform: translateY(1px);
  transition: opacity 160ms ease, transform 160ms ease;
}
.post-meta:hover .invite-chat-btn,
.invite-chat-btn:focus-visible { opacity: 1; transform: translateY(0); }

.identity-badge {
  border-radius: 999px;
  padding: 2px 8px;
  font-size: 9.5px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  border: 1px solid rgba(255,255,255,0.08);
}
.identity-badge.unverified {
  background: rgba(var(--ion-color-warning-rgb),0.12);
  color: var(--ion-color-warning);
}
.identity-badge.trusted-issuer {
  background: rgba(var(--ion-color-success-rgb),0.14);
  color: var(--ion-color-success);
}

.timestamp { color: var(--app-text-subtle); font-size: 12px; }

/* ── Title — editorial gradient style ────────── */
.post-title {
  margin: 0 0 8px;
  font-size: 18px;
  font-weight: 800;
  line-height: 1.25;
  letter-spacing: -0.03em;
  background: linear-gradient(135deg, var(--app-text) 60%, rgba(167,139,250,0.85));
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  text-fill-color: transparent;
}

.post-content {
  margin: 0 0 12px;
  font-size: 13.5px;
  line-height: 1.65;
  color: var(--app-text-muted);
}

/* Capped image height */
.post-image {
  margin: 0 0 14px;
  border-radius: 12px;
  overflow: hidden;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.08);
  max-height: 260px;
  position: relative;
  cursor: zoom-in;
}
.post-image img { width: 100%; height: 100%; display: block; object-fit: cover; max-height: 260px; transition: transform 300ms ease; }
.post-image:hover img { transform: scale(1.015); }

.image-expand-hint {
  position: absolute;
  bottom: 8px;
  right: 8px;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: rgba(0,0,0,0.55);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 14px;
  opacity: 0;
  transform: scale(0.85);
  transition: opacity 200ms ease, transform 200ms ease;
  pointer-events: none;
}
.post-image:hover .image-expand-hint { opacity: 1; transform: scale(1); }

/* ── Video attachment ────────────────────────── */
.post-video {
  margin: 0 0 14px;
  border-radius: 12px;
  overflow: hidden;
}

/* Skeleton — shown instantly, no network required */
.post-video-skeleton {
  position: relative;
  aspect-ratio: 16 / 9;
  max-height: clamp(220px, 35vw, 360px);
  background: linear-gradient(135deg, #0f0f22 0%, #1a1a35 100%);
  border: 1px solid rgba(255,255,255,0.07);
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  overflow: hidden;
}

/* Subtle shimmer sweep */
.post-video-skeleton::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(
    100deg,
    transparent 20%,
    rgba(255,255,255,0.04) 50%,
    transparent 80%
  );
  background-size: 200% 100%;
  animation: skeleton-sweep 2s linear infinite;
}
@keyframes skeleton-sweep {
  from { background-position: 200% 0; }
  to   { background-position: -200% 0; }
}

.post-video-skeleton:hover::after { animation-duration: 0.6s; }

.post-video-skeleton__play {
  width: 64px;
  height: 64px;
  flex-shrink: 0;
  filter: drop-shadow(0 4px 16px rgba(0,0,0,0.7));
  transition: transform 0.15s;
  z-index: 1;
}
.post-video-skeleton:hover .post-video-skeleton__play { transform: scale(1.08); }
.post-video-skeleton:hover .post-video-skeleton__play circle { fill: rgba(99,102,241,0.75); }

/* Duration / label badge bottom-right */
.post-video-skeleton__meta {
  position: absolute;
  bottom: 10px;
  right: 10px;
  display: flex;
  align-items: center;
  gap: 5px;
  background: rgba(0,0,0,0.72);
  color: #fff;
  font-size: 0.72rem;
  font-weight: 600;
  padding: 3px 8px;
  border-radius: 5px;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.03em;
  z-index: 1;
}
.post-video-skeleton__cam-icon {
  width: 13px;
  height: 13px;
  flex-shrink: 0;
  opacity: 0.8;
}

/* ── Lightbox ──────────────────────────────── */
.lightbox-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: rgba(0,0,0,0.92);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: zoom-out;
  animation: lb-in 180ms ease;
}
@keyframes lb-in {
  from { opacity: 0; }
  to   { opacity: 1; }
}
.lightbox-img {
  max-width: min(92vw, 1200px);
  max-height: 90vh;
  border-radius: 10px;
  object-fit: contain;
  box-shadow: 0 32px 80px rgba(0,0,0,0.6);
  cursor: default;
  animation: lb-img-in 220ms cubic-bezier(0.16,1,0.3,1);
}
@keyframes lb-img-in {
  from { transform: scale(0.94); opacity: 0; }
  to   { transform: scale(1);    opacity: 1; }
}
.lightbox-close {
  position: fixed;
  top: 18px;
  right: 20px;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: rgba(255,255,255,0.1);
  border: 1px solid rgba(255,255,255,0.15);
  color: #fff;
  font-size: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 160ms ease;
  z-index: 10000;
}
.lightbox-close:hover { background: rgba(255,255,255,0.2); }

/* ── Footer ──────────────────────────────────── */
.post-footer {
  margin-top: 4px;
  padding-top: 10px;
}

.post-stats {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
}

/* Flat icon buttons */
.stat-icon-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 2px;
  background: none;
  border: none;
  font-size: 13px;
  font-weight: 600;
  color: var(--app-text-muted);
  cursor: pointer;
  transition: color 160ms ease, transform 160ms ease;
  -webkit-tap-highlight-color: transparent;
}
.stat-icon-btn ion-icon { font-size: 18px; }
.stat-icon-btn:hover { color: var(--app-text); }
.stat-icon-btn:active { transform: scale(0.94); }

.stat-icon-btn.heart,
.stat-icon-btn.heart ion-icon { color: #a78bfa; }
.stat-icon-btn.heart.active,
.stat-icon-btn.heart.active ion-icon { color: #c4b5fd; }

.stat-icon-btn.comments,
.stat-icon-btn.comments ion-icon { color: #fbbf24; }
.stat-icon-btn.comments:hover,
.stat-icon-btn.comments:hover ion-icon { color: #fcd34d; }

/* YouTube-style thumb-down */
.thumb-down-icon {
  width: 18px;
  height: 18px;
  color: var(--app-text-muted);
  transform: rotate(-20deg) scaleX(-1);
  flex-shrink: 0;
}
.stat-icon-btn.downvote:hover .thumb-down-icon { color: var(--app-text); }
.stat-icon-btn.downvote.active { color: #ef4444; }
.stat-icon-btn.downvote.active .thumb-down-icon { color: #ef4444; }

/* Reddit-style share icon */
.share-icon {
  width: 17px;
  height: 17px;
  color: currentColor;
  flex-shrink: 0;
}
.stat-icon-btn.share { color: #34d399; }
.stat-icon-btn.share:hover { color: #6ee7b7; }

/* Moderation */
.stat-icon-btn.moderation-btn { color: var(--ion-color-warning); }

/* Score */
.stat-score {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 13px;
  font-weight: 700;
  color: #818cf8;
}
.stat-score ion-icon { font-size: 15px; }

/* ── Flagged overlay ─────────────────────────── */
.flagged-overlay {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  background: rgba(var(--ion-color-warning-rgb),0.10);
  border: 1px solid rgba(var(--ion-color-warning-rgb),0.25);
  border-radius: 10px;
  color: var(--ion-color-warning-shade);
  font-size: 12.5px;
  cursor: pointer;
  margin-bottom: 10px;
}
.flagged-overlay ion-icon { font-size: 16px; flex-shrink: 0; }

.content-blurred { filter: blur(6px); user-select: none; pointer-events: none; }

.flag-badge { display: inline-flex; align-items: center; color: var(--ion-color-warning); margin-left: 2px; }
.flag-badge ion-icon { font-size: 13px; }

:focus-visible { box-shadow: var(--app-focus-ring); outline: none; }

@media (max-width: 576px) {
  .invite-chat-btn { opacity: 1; transform: translateY(0); pointer-events: auto; }
  .post-card { padding: 14px 14px 12px; }
  .post-title { font-size: 16px; }
  .post-content { font-size: 13px; }
  .post-stats { gap: 10px; }
  .post-image { max-height: 200px; }
  .post-image img { max-height: 200px; }
}
/* ── Video loading placeholder ─────────────── */
.video-loading-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  width: 100%;
  aspect-ratio: 16 / 9;
  border-radius: 12px;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.08);
  color: var(--app-text-muted);
  font-size: 13.5px;
  font-weight: 500;
}
.video-loading-icon {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: rgba(99,102,241,0.12);
  border: 1px solid rgba(99,102,241,0.22);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  color: #818cf8;
  animation: vl-pulse 1.6s ease-in-out infinite;
}
@keyframes vl-pulse {
  0%, 100% { opacity: 0.6; transform: scale(0.97); }
  50%       { opacity: 1;   transform: scale(1.03); }
}
</style>

<script setup lang="ts">
function autoLink(text: string): string {
  if (!text) return '';
  return text.replace(/(https?:\/\/[\w\-\.\/?#&=;%+~:@,]+[\w\/])/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
}

import { ref, computed, watch, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { IonIcon, toastController } from '@ionic/vue';
import VideoPlayer from './VideoPlayer.vue';
import { formatDuration } from '../services/videoService';
import {
  chatbubbleOutline,
  trendingUpOutline,
  warningOutline,
  shieldCheckmarkOutline,
  heart,
  heartOutline,
  expandOutline,
  closeOutline,
} from 'ionicons/icons';
import { Post } from '../services/postService';
import type { FilterAction } from '../services/moderationService';
import { generatePseudonym } from '../utils/pseudonym';
import { useUserStore } from '../stores/userStore';
import type { UserProfile } from '../services/userService';
import { UserService } from '../services/userService';
import { ChatInviteService } from '../services/chatInviteService';
import { formatTrustedIdentityLabel } from '../utils/identityTrust';
import { shareLink } from '../composables/useShare';

const router = useRouter();
const userStore = useUserStore();
const authorProfile = ref<UserProfile | null>(null);
let authorProfileRequestId = 0;

const props = defineProps<{
  post: Post;
  communityName?: string;
  hasUpvoted?: boolean;
  hasDownvoted?: boolean;
  flagged?: boolean;
  filterAction?: FilterAction;
  showModerationAction?: boolean;
  moderationActionTitle?: string;
}>();

const revealed = ref(false);
const currentUserId = ref('');
const lightboxOpen = ref(false);
const videoPlayerMounted = ref(false);

function openLightbox() { lightboxOpen.value = true; }

const emit = defineEmits(['upvote', 'downvote', 'moderation-submit']);

watch(
  () => props.post.authorId,
  async (authorId) => {
    const requestId = ++authorProfileRequestId;
    if (!authorId) { authorProfile.value = null; return; }
    const profile = await userStore.getProfile(authorId);
    if (requestId !== authorProfileRequestId) return;
    authorProfile.value = profile;
  },
  { immediate: true }
);

const currentAuthorProfile = computed(() =>
  !props.post.authorId ? authorProfile.value : (userStore.profiles[props.post.authorId] || authorProfile.value)
);

const authorDisplayName = computed(() => {
  if (props.post.authorShowRealName) return props.post.authorName || 'anon';
  if (currentAuthorProfile.value?.customUsername) return currentAuthorProfile.value.customUsername;
  if (currentAuthorProfile.value?.showRealName && currentAuthorProfile.value?.displayName) return currentAuthorProfile.value.displayName;
  if (props.post.authorId && props.post.id) return generatePseudonym(props.post.id, props.post.authorId);
  return props.post.authorName || 'anon';
});

const authorInitial = computed(() => (authorDisplayName.value || 'a').charAt(0).toUpperCase());

const authorIdentityLabel = computed(() =>
  currentAuthorProfile.value?.identityTrustLevel === 'trusted-issuer'
    ? formatTrustedIdentityLabel({
        username: currentAuthorProfile.value?.identityUsername || currentAuthorProfile.value?.customUsername || currentAuthorProfile.value?.username || props.post.authorName,
        issuer: currentAuthorProfile.value?.identityIssuer,
      })
    : 'Unverified identity'
);

const authorIdentityClass = computed(() =>
  currentAuthorProfile.value?.identityTrustLevel === 'trusted-issuer' ? 'trusted-issuer' : 'unverified'
);

const canInviteAuthor = computed(() =>
  !!props.post.authorId && !!currentUserId.value && props.post.authorId !== currentUserId.value
);

const truncatedContent = computed(() => {
  const c = props.post.content || '';
  return c.length <= 200 ? c : c.substring(0, 200) + '…';
});

function handleCardClick() {
  router.push(`/post/${props.post.id}`);
}
function handleUpvote(e: Event) { e.stopPropagation(); emit('upvote'); }
function handleDownvote(e: Event) { e.stopPropagation(); emit('downvote'); }
function handleCommentsClick(e: Event) {
  e.stopPropagation();
  router.push(`/post/${props.post.id}#comments`);
}
function handleModerationAction(e: Event) { e.stopPropagation(); emit('moderation-submit'); }
function handleShare(e: Event) {
  e.stopPropagation();
  void shareLink(`/post/${props.post.id}`, props.post.title || 'InterPoll post', 'Check out this post on InterPoll');
}

async function handleInviteToChat() {
  if (!canInviteAuthor.value) return;
  try {
    await ChatInviteService.sendInvite(props.post.authorId);
    const t = await toastController.create({ message: `Chat invite sent to u/${authorDisplayName.value}`, duration: 2200, color: 'success' });
    await t.present();
  } catch {
    const t = await toastController.create({ message: 'Failed to send chat invite', duration: 2200, color: 'danger' });
    await t.present();
  }
}

onMounted(async () => {
  try { currentUserId.value = (await UserService.getCurrentUser()).id; } catch { currentUserId.value = ''; }
});

function formatTime(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000), h = Math.floor(diff / 3600000), d = Math.floor(diff / 86400000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  if (d < 7) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}

function formatNumber(n: number | undefined | null): string {
  const v = n ?? 0;
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(1) + 'M';
  if (v >= 1_000) return (v / 1_000).toFixed(1) + 'K';
  return v.toString();
}

function getIPFSUrl(cid?: string): string {
  return cid ? `https://ipfs.io/ipfs/${cid}` : '';
}
</script>