<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button :default-href="post?.communityId ? `/community/${post.communityId}` : '/home'"></ion-back-button>
        </ion-buttons>
        <ion-title>Post</ion-title>
        <ion-buttons slot="end">
          <ion-button @click="refreshPost">
            <ion-icon :icon="refreshOutline"></ion-icon>
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <DesktopPageShell>
      <BurstOverlay />

      <!-- Loading -->
      <div v-if="isLoading" class="loading-container">
        <ion-spinner></ion-spinner>
        <p>Loading post...</p>
      </div>

      <!-- Post Not Found -->
      <div v-else-if="!post" class="empty-state">
        <ion-icon :icon="alertCircleOutline" size="large"></ion-icon>
        <p>Post not found</p>
        <ion-button @click="$router.push('/home')">Go Home</ion-button>
      </div>

      <!-- Post Content -->
      <div v-else>
        <!-- Post Section -->
        <div class="post-detail-section">
          <div class="post-header">
            <!-- Author row with avatar -->
            <div class="post-author-row">
              <div class="post-author-avatar" :class="postAuthorAvatarTone">
                {{ (postAuthorDisplayName || '?').charAt(0).toUpperCase() }}
              </div>
              <div class="post-author-info">
                <div class="post-author-name-row">
                  <span class="author-name">{{ postAuthorDisplayName }}</span>
                  <span class="identity-badge" :class="postAuthorIdentityClass">{{ postAuthorIdentityLabel }}</span>
                </div>
                <div class="post-author-sub">
                  <ion-chip class="community-chip" @click="$router.push(`/community/${post.communityId}`)">
                    <ion-icon :icon="peopleOutline"></ion-icon>
                    <ion-label>{{ communityName }}</ion-label>
                  </ion-chip>
                  <span class="separator">·</span>
                  <span class="timestamp">{{ formatTime(post.createdAt) }}</span>
                </div>
              </div>
            </div>
            <h1 class="post-title">{{ post.title }}</h1>
          </div>

          <div class="post-body">
            <!-- Post Content -->
            <div v-if="post.content" class="post-content" v-html="autoLink(post.content)"></div>

            <!-- Post Image -->
            <div v-if="post.imageThumbnail || post.imageIPFS" class="post-image">
              <img
                :src="fullImageSrc || post.imageThumbnail || getIPFSUrl(post.imageIPFS)"
                :alt="post.title"
              />
            </div>

            <!-- Post Video -->
            <div v-if="post.videoCID" class="post-video">
              <VideoPlayer
                :cid="post.videoCID"
                :thumbnail-url="post.videoThumbnailCID
                  ? `https://ipfs.filebase.io/ipfs/${post.videoThumbnailCID}`
                  : null"
                :duration="post.videoDuration"
                :file-size="post.videoSize"
                :mime-type="post.videoMimeType"
              />
            </div>

            <!-- Vote & Actions Bar -->
            <div class="actions-bar">
              <div class="vote-buttons">

                <!-- Heart upvote — inline SVG so fill animates -->
                <button
                  class="vote-button heart"
                  :class="{ active: hasUpvoted, 'pop-heart': heartPop }"
                  @click="handleUpvote"
                >
                  <svg class="vote-svg heart-svg" viewBox="0 0 24 24" fill="none">
                    <path
                      class="heart-path"
                      d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"
                      :fill="hasUpvoted ? '#c4b5fd' : 'none'"
                      :stroke="hasUpvoted ? '#c4b5fd' : 'currentColor'"
                      stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"
                    />
                  </svg>
                  <span class="vote-count">{{ formatNumber(post.upvotes) }}</span>
                </button>

                <!-- Thumb-down — PollCard style, rotate(-20deg) -->
                <button
                  class="vote-button dislike"
                  :class="{ active: hasDownvoted, 'pop-down': downPop }"
                  @click="handleDownvote"
                >
                  <svg class="vote-svg thumb-svg" viewBox="0 0 24 24" fill="none" style="transform:rotate(-20deg) scaleX(-1)">
                    <path
                      d="M15 3H6C5.17 3 4.46 3.5 4.16 4.22l-3.02 7.05C1.05 11.5 1 11.74 1 12v2c0 1.1.9 2 2 2h6.31l-.95 4.57-.03.32c0 .41.17.79.44 1.06L9.83 23l6.59-6.59c.36-.36.58-.86.58-1.41V5c0-1.1-.9-2-2-2zm4 0v12h4V3h-4z"
                      :fill="hasDownvoted ? '#ef4444' : 'currentColor'"
                    />
                  </svg>
                  <span class="vote-count">{{ formatNumber(post.downvotes) }}</span>
                </button>

                <div class="stat-item score">
                  <ion-icon :icon="trendingUpOutline"></ion-icon>
                  <span>Score: {{ post.score }}</span>
                </div>
                <span v-if="post.viewCount && post.viewCount > 0" class="detail-view-count">
                  {{ post.viewCount >= 1_000_000 ? (post.viewCount/1_000_000).toFixed(1)+'M' : post.viewCount >= 1000 ? (post.viewCount/1000).toFixed(1)+'K' : post.viewCount }} views
                </span>
              </div>

              <button class="action-button share" @click="sharePost">
                <ion-icon :icon="shareSocialOutline"></ion-icon>
                <span>Share</span>
              </button>
            </div>
          </div>

          <div class="section-separator"></div>
        </div>

        <!-- Commenters panel removed — redundant with comments list -->

        <!-- Tab row: Comments | Related -->
        <div class="section-tabs">
          <button
            class="section-tab"
            :class="{ active: activeSection === 'comments' }"
            @click="activeSection = 'comments'"
          >
            Comments ({{ allComments.length }})
          </button>
          <button
            v-if="relatedPosts.length > 0"
            class="section-tab"
            :class="{ active: activeSection === 'related' }"
            @click="activeSection = 'related'"
          >
            Related ({{ relatedPosts.length }})
          </button>
        </div>

        <!-- Comments Section -->
        <div v-if="activeSection === 'comments'" class="comments-section">
          <!-- Add Comment Form -->
          <div class="add-comment-form">
            <div class="comment-input-row">
              <div class="commenter-self-avatar" :class="selfAvatarTone">
                {{ selfAvatarInitial }}
              </div>
              <input
                v-model="newCommentText"
                placeholder="Add a comment…"
                class="comment-input"
                @keydown.enter.ctrl="submitComment"
                @keydown.enter.meta="submitComment"
              />
              <button
                class="comment-send-btn"
                :disabled="!newCommentText.trim()"
                @click="submitComment"
              >
                <svg viewBox="0 0 24 24" fill="none" width="18" height="18">
                  <path d="M22 2L11 13M22 2L15 22l-4-9-9-4 20-7z"
                    stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </button>
            </div>
          </div>

          <!-- Comments List -->
          <div v-if="allComments.length > 0" class="comments-list">
            <CommentCard
              v-for="comment in sortedComments"
              :key="comment.id"
              :comment="comment"
              :post-id="post.id"
              :community-id="post.communityId"
              :flagged="isCommentFlagged(comment.content)"
              :filter-action="modSettings.wordFilterAction"
              @upvote="(c: any) => handleCommentUpvote(c)"
              @downvote="(c: any) => handleCommentDownvote(c)"
            />
          </div>

          <!-- Empty Comments State -->
          <div v-else class="empty-comments">
            <ion-icon :icon="chatbubbleOutline" size="large"></ion-icon>
            <p>No comments yet</p>
            <p class="subtitle">Be the first to comment!</p>
          </div>
        </div>

        <!-- Related Posts Section -->
        <div v-else-if="activeSection === 'related'" class="related-section">
          <div class="related-list">
            <div
              v-for="rp in relatedPosts"
              :key="rp.id"
              class="related-row"
              @click="$router.push(`/post/${rp.id}`)"
            >
              <div class="related-meta">
                <span class="related-community">{{ rp.communityId }}</span>
                <span class="related-dot">·</span>
                <span class="related-time">{{ formatTime(rp.createdAt) }}</span>
              </div>
              <div class="related-title">{{ rp.title }}</div>
              <div v-if="rp.tags && rp.tags.length" class="related-tags">
                <span v-for="t in rp.tags.slice(0,3)" :key="t" class="related-tag">#{{ t }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      </DesktopPageShell>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import DesktopPageShell from '../components/DesktopPageShell.vue';
import { trackDetailView } from '../services/viewTrackingService';
import BurstOverlay     from '../components/BurstOverlay.vue';
import { useBurst }     from '../composables/useBurst';

function autoLink(text: string): string {
  if (!text) return '';
  // Simple URL regex
  return text.replace(/(https?:\/\/[\w\-\.\/?#&=;%+~:@,]+[\w\/])/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
}

import { ref, computed, type Ref, onMounted, onUnmounted, watch, defineAsyncComponent, h } from 'vue';
const VideoPlayer = defineAsyncComponent({
  loader: () => import('../components/VideoPlayer.vue'),
  loadingComponent: {
    template: `
      <div class="video-loading-placeholder">
        <div class="video-loading-icon">▶</div>
        <span>Loading video…</span>
      </div>
    `,
  },
  delay: 200,
  timeout: 10_000,
});
import { useRoute, useRouter } from 'vue-router';
import {
  IonPage, IonHeader, IonToolbar, IonTitle, IonContent,
  IonButtons, IonBackButton, IonButton, IonIcon,
  IonChip,
  IonLabel, IonSpinner, IonTextarea, IonBadge,
  toastController, actionSheetController
} from '@ionic/vue';
import {
  peopleOutline, heart, heartOutline, thumbsDownOutline, thumbsDown,
  trendingUpOutline, chatbubbleOutline, sendOutline,
  shareSocialOutline, alertCircleOutline, refreshOutline
} from 'ionicons/icons';
import { usePostStore } from '../stores/postStore';
import { useCommentStore } from '../stores/commentStore';
import { useCommunityStore } from '../stores/communityStore';
import { useUserStore } from '../stores/userStore';
import CommentCard from '../components/CommentCard.vue';
import { Post } from '../services/postService';
import { generatePseudonym } from '../utils/pseudonym';
import { ModerationService, moderationVersion } from '../services/moderationService';
import { formatTrustedIdentityLabel } from '../utils/identityTrust';

import { IPFSService } from '../services/ipfsService';
import { checkContent } from '../utils/contentGuard';

const route = useRoute();
const router = useRouter();
const postStore = usePostStore();
const commentStore = useCommentStore();
const communityStore = useCommunityStore();
const userStore = useUserStore();

// Tracks the store rather than snapshotting it: the store reassigns
// `currentPost` on every vote reconciliation and graph update, and a one-time
// copy left this page showing counts frozen at load time.
const post = computed<Post | null>(() => postStore.currentPost);
const isLoading = ref(true);
const newCommentText = ref('');
const voteVersion = ref(0);
const fullImageSrc = ref<string | null>(null);
const postAuthorTrustLevel = ref<'trusted-issuer' | 'unverified'>('unverified');
let postAuthorTrustRequestId = 0;
let fullImageLoadPromise: Promise<string | null> | null = null;

// Load full-res image from GunDB to replace thumbnail
watch(
  () => post.value?.imageIPFS,
  (cid) => {
    fullImageSrc.value = null;
    fullImageLoadPromise = null;
    if (!cid) return;
    fullImageLoadPromise = loadFullImageSrc(cid);
  },
  { immediate: true }
);

const postId = computed(() => route.params.postId as string);

// Meta tags via watch — avoids @unhead/vue context issues
watch(post, (p) => {
  if (!p) return;
  document.title = `${p.title} - Interpoll`;

  const setMeta = (attr: string, val: string, content: string) => {
    let el = document.querySelector(`meta[${attr}="${val}"]`);
    if (!el) {
      el = document.createElement('meta');
      el.setAttribute(attr, val);
      document.head.appendChild(el);
    }
    el.setAttribute('content', content);
  };

  const desc = p.content?.slice(0, 160) ?? '';
  setMeta('name', 'description', desc);
  setMeta('property', 'og:title', p.title);
  setMeta('property', 'og:description', desc);
  setMeta('property', 'og:url', window.location.href);
});

const communityName = computed(() => {
  const cid = post.value?.communityId;
  const community = communityStore.communities.find(c => c.id === cid);
  return community?.displayName || cid || 'Community';
});

const postAuthorDisplayName = computed(() => {
  if (!post.value) return 'anon';
  if (post.value.authorShowRealName) {
    return post.value.authorName || 'anon';
  }
  if (post.value.authorId && post.value.id) {
    return generatePseudonym(post.value.id, post.value.authorId);
  }
  return post.value.authorName || 'anon';
});

const postAuthorIdentityLabel = computed(() =>
  postAuthorTrustLevel.value === 'trusted-issuer'
    ? formatTrustedIdentityLabel({
      username: userStore.profiles[post.value?.authorId || '']?.identityUsername
        || userStore.profiles[post.value?.authorId || '']?.customUsername
        || userStore.profiles[post.value?.authorId || '']?.username
        || post.value?.authorName,
      issuer: userStore.profiles[post.value?.authorId || '']?.identityIssuer,
    })
    : 'Unverified identity'
);

const postAuthorIdentityClass = computed(() =>
  postAuthorTrustLevel.value === 'trusted-issuer' ? 'trusted-issuer' : 'unverified'
);

const POST_AUTHOR_TONES = ['av-violet','av-blue','av-teal','av-amber','av-rose','av-indigo','av-green'];
const postAuthorAvatarTone = computed(() => {
  const code = (post.value?.authorId || '').split('').reduce((a: number, c: string) => a + c.charCodeAt(0), 0);
  return POST_AUTHOR_TONES[code % POST_AUTHOR_TONES.length];
});

const allComments = computed(() =>
  commentStore.comments.filter(c => {
    const matchesPost = c.postId === postId.value || c.postId === post.value?.id;
    return matchesPost && !c.parentId;
  })
);

const modSettings = computed(() => {
  moderationVersion.value; // reactive dependency
  return ModerationService.getSettings();
});

watch(
  () => post.value?.authorId,
  async (authorId) => {
    const requestId = ++postAuthorTrustRequestId;
    if (!authorId) {
      postAuthorTrustLevel.value = 'unverified';
      return;
    }
    const profile = await userStore.getProfile(authorId);
    if (requestId !== postAuthorTrustRequestId) return;
    postAuthorTrustLevel.value = profile?.identityTrustLevel === 'trusted-issuer' ? 'trusted-issuer' : 'unverified';
  },
  { immediate: true }
);

watch(
  () => allComments.value.map((c) => c.authorId).join('|'),
  () => {
    for (const c of allComments.value) {
      if (c.authorId && userStore.getCachedKarma(c.authorId) === null) {
        userStore.getProfile(c.authorId);
      }
    }
  },
  { immediate: true }
);

const sortedComments = computed(() => {
  moderationVersion.value; // reactive dependency
  const settings = ModerationService.getSettings();

  return allComments.value
    .filter((c) => {
      // Karma filter
      if (c.authorId) {
        const cached = userStore.getCachedKarma(c.authorId);
        if (ModerationService.shouldHideByKarma(cached)) return false;
      }

      // Score filter
      if (c.score < settings.minContentScore) return false;

      // Word filter — hide mode
      if (settings.wordFilterAction === 'hide') {
        const result = ModerationService.checkContent(c.content || '');
        if (result.flagged) return false;
      }

      return true;
    })
    .sort((a, b) => b.score !== a.score ? b.score - a.score : b.createdAt - a.createdAt);
});

function isCommentFlagged(content: string): boolean {
  return ModerationService.checkContent(content || '').flagged;
}

const uniqueCommenters = computed(() => {
  const authorMap = new Map<string, {
    authorId: string;
    displayName: string;
    commentCount: number;
    authorShowRealName: boolean;
    identityTrustLevel: 'trusted-issuer' | 'unverified';
    identityTrustLabel: string;
  }>();

  commentStore.comments
    .filter(c => c.postId === postId.value || c.postId === post.value?.id)
    .forEach(c => {
      const existing = authorMap.get(c.authorId);
      if (existing) {
        existing.commentCount++;
        if (!existing.authorShowRealName && c.authorShowRealName === true) {
          existing.displayName = c.authorName || 'anon';
        }
        existing.authorShowRealName = existing.authorShowRealName || c.authorShowRealName === true;
        existing.identityTrustLevel = userStore.profiles[c.authorId]?.identityTrustLevel === 'trusted-issuer' ? 'trusted-issuer' : 'unverified';
        existing.identityTrustLabel = existing.identityTrustLevel === 'trusted-issuer'
          ? formatTrustedIdentityLabel({
            username: userStore.profiles[c.authorId]?.identityUsername
              || userStore.profiles[c.authorId]?.customUsername
              || userStore.profiles[c.authorId]?.username
              || existing.displayName,
            issuer: userStore.profiles[c.authorId]?.identityIssuer,
          })
          : 'Unverified identity';
      } else {
        const name = c.authorShowRealName
          ? (c.authorName || 'anon')
          : (c.authorId && postId.value
            ? generatePseudonym(postId.value, c.authorId)
            : (c.authorName || 'anon'));
        authorMap.set(c.authorId, {
          authorId: c.authorId,
          displayName: name,
          commentCount: 1,
          authorShowRealName: c.authorShowRealName === true,
          identityTrustLevel: userStore.profiles[c.authorId]?.identityTrustLevel === 'trusted-issuer' ? 'trusted-issuer' : 'unverified',
          identityTrustLabel: userStore.profiles[c.authorId]?.identityTrustLevel === 'trusted-issuer'
            ? formatTrustedIdentityLabel({
              username: userStore.profiles[c.authorId]?.identityUsername
                || userStore.profiles[c.authorId]?.customUsername
                || userStore.profiles[c.authorId]?.username
                || name,
              issuer: userStore.profiles[c.authorId]?.identityIssuer,
            })
            : 'Unverified identity',
        });
      }
    });

  return Array.from(authorMap.values()).sort((a, b) => b.commentCount - a.commentCount);
});

// Avatar tone for commenter chips
const COMMENTER_TONES = ['av-violet','av-blue','av-teal','av-amber','av-rose','av-indigo'];
function commenterAvatarTone(authorId: string): string {
  const code = (authorId || '').split('').reduce((a,c) => a + c.charCodeAt(0), 0);
  return COMMENTER_TONES[code % COMMENTER_TONES.length];
}

// Related posts — same community, category, or overlapping tags, excluding current post
const activeSection = ref<'comments' | 'related'>('comments');

const relatedPosts = computed(() => {
  if (!post.value) return [];
  const current     = post.value;
  const currentTags = Array.isArray(current.tags) ? current.tags
    : typeof current.tags === 'string' ? (current.tags as string).split(',').map((t: string) => t.trim()).filter(Boolean)
    : [];
  const currentCat  = current.category || '';
  const currentComm = current.communityId || '';

  return postStore.sortedPosts
    .filter(p => {
      if (p.id === current.id) return false;
      const pTags = Array.isArray(p.tags) ? p.tags
        : typeof p.tags === 'string' ? (p.tags as string).split(',').map((t: string) => t.trim()).filter(Boolean)
        : [];
      const tagOverlap  = currentTags.length > 0 && pTags.some((t: string) => currentTags.includes(t));
      const sameCat     = currentCat && p.category === currentCat;
      const sameComm    = currentComm && p.communityId === currentComm;
      return tagOverlap || sameCat || sameComm;
    })
    .slice(0, 8);
});

const hasUpvoted = computed(() => postStore.myVote(postId.value) === 'up');
const hasDownvoted = computed(() => postStore.myVote(postId.value) === 'down');

// Pop animation state — triggers the keyframe on each click
const heartPop = ref(false);
const downPop  = ref(false);
const { triggerBurst } = useBurst();

function triggerPop(popRef: Ref<boolean>) {
  popRef.value = true;
  setTimeout(() => { popRef.value = false; }, 600);
}

// Self avatar for comment input box
const SELF_TONES = ['av-violet','av-blue','av-teal','av-amber','av-rose','av-indigo','av-green'];
const selfAvatarInitial = computed(() => {
  const name = (userStore.currentUser as any)?.displayName
    || (userStore.currentUser as any)?.username || '?';
  return name.charAt(0).toUpperCase();
});
const selfAvatarTone = computed(() => {
  const id = (userStore.currentUser as any)?.id || '';
  const code = id.split('').reduce((a: number, c: string) => a + c.charCodeAt(0), 0);
  return SELF_TONES[code % SELF_TONES.length];
});

function formatTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

function formatNumber(num: number | undefined | null): string {
  const n = num ?? 0;
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return n.toString();
}

function getIPFSUrl(cid?: string): string {
  return cid ? `https://ipfs.io/ipfs/${cid}` : '';
}

async function loadFullImageSrc(cid: string): Promise<string | null> {
  try {
    const data = await IPFSService.downloadImage(cid);
    if (post.value?.imageIPFS === cid && data) {
      fullImageSrc.value = data;
    }
    return data || null;
  } catch {
    return null;
  } finally {
    if (post.value?.imageIPFS === cid) {
      fullImageLoadPromise = null;
    }
  }
}

async function presentVoteToast(message: string, expectedVersion: number) {
  const toast = await toastController.create({ message, duration: 1500 });
  // Skip if a newer vote action has since superseded this one, to avoid a stale toast.
  if (voteVersion.value === expectedVersion) {
    toast.present();
  }
}

/**
 * The store owns both the counts and the optimistic prediction now, so this no
 * longer hand-computes deltas onto a local copy of the post — the two used to
 * drift apart whenever the store's reconciliation disagreed with the arithmetic
 * here (notably on a side switch, which guessed ±2).
 */
async function handlePostVote(direction: 'up' | 'down') {
  if (!post.value) return;
  const id = post.value.id;
  const wasActive = postStore.myVote(id) === direction;
  voteVersion.value++;
  const version = voteVersion.value;
  try {
    await postStore.toggleVote(id, direction);
    const labels = { up: 'Liked', down: 'Disliked' };
    const removeLabels = { up: 'Like removed', down: 'Dislike removed' };
    await presentVoteToast(wasActive ? removeLabels[direction] : labels[direction], version);
  } catch (error) {
    console.error('Error voting:', error);
  }
}

async function handleUpvote() {
  triggerPop(heartPop);
  triggerBurst('heart');
  await handlePostVote('up');
}

async function handleDownvote() {
  triggerPop(downPop);
  triggerBurst('dislike');
  await handlePostVote('down');
}

async function submitComment() {
  if (!post.value || !newCommentText.value.trim()) return;
  const guard = checkContent(newCommentText.value.trim(), 'comment');
  if (!guard.ok) {
    (await toastController.create({ message: guard.reason!, duration: 2500, color: 'warning' })).present();
    return;
  }
  try {
    await commentStore.createComment({
      postId: post.value.id,
      communityId: post.value.communityId,
      content: newCommentText.value.trim()
    });
    newCommentText.value = '';
    (await toastController.create({ message: 'Comment posted', duration: 2000 })).present();
    // No reload: the store already holds the comment and the live subscription
    // delivers the graph's copy. The old reload restarted the thread load and
    // cancelled the in-flight one, so a fresh comment could vanish on screen.
  } catch {
    (await toastController.create({ message: 'Failed to post comment', duration: 2000 })).present();
  }
}

async function handleCommentUpvote(comment: any) {
  try {
    // Ask the store, not localStorage — the store is the one that knows about
    // votes cast this session but not yet written back.
    const wasUpvoted = commentStore.hasUpvoted(comment.id);
    await commentStore.upvoteComment(comment.id);
    (await toastController.create({
      message: wasUpvoted ? 'Upvote removed' : 'Comment upvoted',
      duration: 1500,
    })).present();
  } catch { /* silent */ }
}

async function handleCommentDownvote(comment: any) {
  try {
    const wasDownvoted = commentStore.hasDownvoted(comment.id);
    await commentStore.downvoteComment(comment.id);
    (await toastController.create({
      message: wasDownvoted ? 'Downvote removed' : 'Comment downvoted',
      duration: 1500,
    })).present();
  } catch { /* silent */ }
}

async function sharePost() {
  if (!post.value) return;
  const actionSheet = await actionSheetController.create({
    header: 'Share Post',
    buttons: [
      {
        text: 'Copy Link',
        icon: 'link-outline',
        handler: () => {
          navigator.clipboard.writeText(window.location.href);
          toastController.create({ message: 'Link copied to clipboard', duration: 2000 })
            .then(t => t.present());
        }
      },
      {
        text: 'Share via...',
        icon: 'share-social-outline',
        handler: () => {
          navigator.share?.({
            title: post.value!.title,
            text: post.value!.content,
            url: window.location.href
          });
        }
      },
      { text: 'Cancel', role: 'cancel' }
    ]
  });
  await actionSheet.present();
}

async function loadPost() {
  isLoading.value = true;
  try {
    await postStore.selectPost(postId.value);
    if (postId.value) trackDetailView(postId.value, 'post');
    if (post.value) {
      // Authoritative counts + this user's real vote state, straight from the
      // vote set — worth the round trip on a post being read directly.
      void postStore.refreshVoteState(post.value.id);
      // Not awaited: the store renders the local mirror first and merges the
      // graph as it arrives. Awaiting it held the whole page behind the spinner
      // until the relay answered.
      void commentStore.loadCommentsForPost(post.value.id);
    }
  } catch { /* silent */ }
  finally {
    isLoading.value = false;
  }
}

async function refreshPost() {
  await loadPost();
  (await toastController.create({ message: 'Post refreshed', duration: 1500 })).present();
}

let unsubscribeVotes: (() => void) | null = null;

onMounted(async () => {
  await loadPost();
  // Live counts while the post is on screen — other people's votes land here
  // without a refresh, and cannot be undone by a stale post-node echo.
  if (post.value) unsubscribeVotes = postStore.subscribeToVotes(post.value.id);
});

onUnmounted(() => {
  unsubscribeVotes?.();
  unsubscribeVotes = null;
  commentStore.clearComments();
});
</script>

<style scoped>
.loading-container,
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  gap: 16px;
  text-align: center;
}

.empty-state ion-icon {
  font-size: 64px;
  color: var(--ion-color-medium);
}

.post-detail-section {
  padding: 16px 0;
  background: transparent;
}

.post-header {
  padding: 0 16px 12px 16px;
}

.post-meta {
  display: flex;
  align-items: center;
  font-size: 12px;
  color: var(--ion-color-medium);
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 12px;
}

.separator {
  margin: 0 4px;
}

.post-title {
  font-size: 18px;
  font-weight: 700;
  line-height: 1.3;
  margin: 8px 0 0 0;
  color: var(--ion-text-color);
}

.post-body {
  padding: 0 16px;
}

.post-content {
  font-size: 14px;
  line-height: 1.6;
  margin: 16px 0;
  white-space: pre-wrap;
  color: var(--ion-text-color);
}

.post-image {
  margin: 16px 0;
  border-radius: 8px;
  overflow: hidden;
}

.post-video {
  margin: 16px 0;
  border-radius: 8px;
  overflow: hidden;
}

.post-image img {
  width: 100%;
  height: auto;
  display: block;
}

.actions-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid rgba(var(--ion-text-color-rgb), 0.08);
}

.vote-buttons {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* ── Vote button base ── */
.vote-button {
  display: flex;
  align-items: center;
  gap: 6px;
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.09);
  padding: 7px 12px;
  font-size: 13px;
  font-weight: 600;
  font-family: inherit;
  color: rgba(255,255,255,0.55);
  cursor: pointer;
  border-radius: 12px;
  transition: background 150ms, border-color 150ms, color 150ms;
  -webkit-tap-highlight-color: transparent;
  position: relative;
  overflow: hidden;
}
.vote-button:hover {
  background: rgba(255,255,255,0.08);
  color: rgba(255,255,255,0.8);
}

/* SVG icon sizing */
.vote-svg {
  width: 17px; height: 17px;
  flex-shrink: 0;
  transition: transform 200ms;
}
.vote-count { line-height: 1; }

/* ── Heart (upvote) ── */
.vote-button.heart { color: rgba(196,181,253,0.7); }
.vote-button.heart:hover { color: #c4b5fd; background: rgba(167,139,250,0.08); }
.vote-button.heart.active {
  background: rgba(167,139,250,0.15);
  border-color: rgba(167,139,250,0.35);
  color: #c4b5fd;
}

/* ── Dislike (downvote) ── */
.vote-button.dislike { color: rgba(255,255,255,0.4); }
.vote-button.dislike:hover { color: rgba(255,255,255,0.75); background: rgba(239,68,68,0.06); }
.vote-button.dislike.active {
  background: rgba(239,68,68,0.13);
  border-color: rgba(239,68,68,0.3);
  color: #ef4444;
}

/* ── Instagram-style pop on upvote ── */
@keyframes heart-pop {
  0%   { transform: scale(1); }
  25%  { transform: scale(1.45); }
  50%  { transform: scale(0.88); }
  75%  { transform: scale(1.18); }
  100% { transform: scale(1); }
}
@keyframes down-pop {
  0%   { transform: rotate(-20deg) scaleX(-1) scale(1); }
  30%  { transform: rotate(-20deg) scaleX(-1) scale(1.4); }
  60%  { transform: rotate(-20deg) scaleX(-1) scale(0.85); }
  100% { transform: rotate(-20deg) scaleX(-1) scale(1); }
}
@keyframes ripple {
  0%   { transform: scale(0); opacity: 0.35; }
  100% { transform: scale(3.5); opacity: 0; }
}

.pop-heart .heart-svg {
  animation: heart-pop 0.55s cubic-bezier(0.36, 0.07, 0.19, 0.97);
}
.pop-down .thumb-svg {
  animation: down-pop 0.5s cubic-bezier(0.36, 0.07, 0.19, 0.97);
}

/* Ripple layer — appears behind icon on click */
.vote-button::after {
  content: '';
  position: absolute;
  inset: 0; margin: auto;
  width: 20px; height: 20px;
  border-radius: 50%;
  pointer-events: none;
  opacity: 0;
}
.pop-heart::after {
  background: rgba(196,181,253,0.4);
  animation: ripple 0.5s ease-out;
}
.pop-down::after {
  background: rgba(239,68,68,0.35);
  animation: ripple 0.45s ease-out;
}

.stat-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  color: var(--ion-color-medium);
  padding: 0 8px;
}

.action-button {
  display: flex;
  align-items: center;
  gap: 6px;
  background: rgba(var(--ion-card-background-rgb), 0.20);
  border: 1px solid rgba(var(--ion-text-color-rgb), 0.1);
  padding: 8px 14px;
  font-size: 14px;
  color: var(--ion-color-medium);
  cursor: pointer;
  border-radius: 14px;
  font-family: inherit;
}

.section-separator {
  height: 1px;
  background: rgba(var(--ion-text-color-rgb), 0.08);
  margin: 10px 0;
}

html.dark .section-separator {
  background: rgba(255, 255, 255, 0.35);
}

.commenters-section {
  padding: 2px 0;
  background: transparent;
}

.section-title {
  font-size: 15px;
  font-weight: 700;
  margin: 0 0 8px 0;
  padding: 0 16px;
  color: var(--ion-text-color);
  letter-spacing: -0.1px;
}

.commenters-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 0 16px;
}

.commenter-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: rgba(var(--ion-card-background-rgb), 0.20);
  border: 1px solid rgba(var(--ion-text-color-rgb), 0.1);
  border-radius: 20px;
  font-size: 13px;
  font-weight: 500;
}

.commenter-online-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--ion-color-success);
  flex-shrink: 0;
}

.commenter-name {
  color: var(--ion-text-color);
}

.identity-badge {
  border-radius: 10px;
  padding: 1px 8px;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
}

.identity-badge.unverified {
  background: rgba(var(--ion-color-warning-rgb), 0.16);
  color: var(--ion-color-warning-shade);
}

.identity-badge.trusted-issuer {
  background: rgba(var(--ion-color-success-rgb), 0.14);
  color: var(--ion-color-success-shade);
}

.commenter-count {
  font-size: 10px;
  --padding-start: 4px;
  --padding-end: 4px;
}

.comments-section {
  padding: 10px 0 0;
  background: transparent;
}

.add-comment-form {
  margin-bottom: 12px;
  padding: 0 16px;
}

.comment-textarea {
  margin-bottom: 12px;
  --background: rgba(var(--ion-card-background-rgb), 0.3);
  --padding-start: 12px;
  --padding-end: 12px;
  --padding-top: 12px;
  --padding-bottom: 12px;
  border-radius: 12px;
}

.comments-list {
  display: flex;
  flex-direction: column;
  gap: 0;
  padding: 0 16px;
}

.empty-comments {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 40px 20px;
  gap: 12px;
}

.empty-comments ion-icon {
  font-size: 48px;
  color: var(--ion-color-medium);
}

.empty-comments p {
  margin: 0;
  color: var(--ion-color-medium);
}

.subtitle {
  font-size: 14px;
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

ion-content {
  --background:
    radial-gradient(ellipse at 15% 0%,   rgba(139, 92, 246, 0.30) 0%%, transparent 50%%),
    radial-gradient(ellipse at 85% 10%%,  rgba(99, 102, 241, 0.20) 0%%, transparent 45%%),
    radial-gradient(ellipse at 50%% 100%%, rgba(79,  70, 229, 0.20) 0%%, transparent 55%%),
    #0d0e1c;
}

/* ── Commenter chips ── */
.commenter-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px 5px 6px;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.07);
  border-radius: 999px;
  font-size: 12px;
}
.commenter-avatar {
  width: 22px; height: 22px;
  border-radius: 6px;
  display: flex; align-items: center; justify-content: center;
  font-size: 10px; font-weight: 800; flex-shrink: 0;
}
.av-violet { background: rgba(99,102,241,0.25); color: #a5b4fc; }
.av-blue   { background: rgba(59,130,246,0.22);  color: #93c5fd; }
.av-teal   { background: rgba(20,184,166,0.22);  color: #5eead4; }
.av-amber  { background: rgba(245,158,11,0.22);  color: #fcd34d; }
.av-rose   { background: rgba(236,72,153,0.22);  color: #f9a8d4; }
.av-indigo { background: rgba(129,140,248,0.22); color: #c7d2fe; }

.commenter-name  { font-weight: 700; color: var(--app-text); }
.commenter-count {
  font-size: 10px; font-weight: 700;
  background: rgba(255,255,255,0.1); color: rgba(255,255,255,0.6);
  padding: 1px 5px; border-radius: 999px;
}

/* ── Section tabs (Comments | Related) ── */
.section-tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 16px;
  border-bottom: 1px solid rgba(255,255,255,0.07);
  padding-bottom: 0;
}
.section-tab {
  padding: 8px 16px;
  font-size: 13px;
  font-weight: 600;
  color: rgba(255,255,255,0.4);
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  transition: color 150ms, border-color 150ms;
  margin-bottom: -1px;
}
.section-tab:hover { color: rgba(255,255,255,0.7); }
.section-tab.active {
  color: var(--app-text);
  border-bottom-color: #818cf8;
}

/* ── Related posts ── */
.related-section { margin-top: 0; }

.related-list {
  display: flex;
  flex-direction: column;
  gap: 0;
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid rgba(255,255,255,0.07);
  background: rgba(255,255,255,0.02);
  margin-top: 10px;
}

.related-row {
  padding: 12px 16px;
  border-bottom: 1px solid rgba(255,255,255,0.05);
  cursor: pointer;
  transition: background 120ms;
}
.related-row:last-child { border-bottom: none; }
.related-row:hover { background: rgba(255,255,255,0.04); }

.related-meta {
  display: flex; align-items: center; gap: 5px;
  font-size: 11px; color: rgba(255,255,255,0.35);
  margin-bottom: 4px;
}
.related-community { font-weight: 600; color: rgba(255,255,255,0.5); }
.related-dot { opacity: 0.4; }

.related-title {
  font-size: 14px; font-weight: 600;
  color: var(--app-text);
  line-height: 1.4;
  margin-bottom: 5px;
}

.related-tags { display: flex; gap: 5px; flex-wrap: wrap; }
.related-tag {
  font-size: 11px; font-weight: 600;
  color: #818cf8; background: rgba(99,102,241,0.1);
  padding: 1px 6px; border-radius: 999px;
}

/* ── Post author row ── */
.post-author-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 14px;
}
.post-author-avatar {
  width: 42px; height: 42px;
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 17px; font-weight: 800;
  flex-shrink: 0;
}
/* reuse av- tone classes from commenter avatars */
.av-violet { background: rgba(99,102,241,0.22);  color: #a5b4fc; }
.av-blue   { background: rgba(59,130,246,0.22);   color: #93c5fd; }
.av-teal   { background: rgba(20,184,166,0.22);   color: #5eead4; }
.av-amber  { background: rgba(245,158,11,0.22);   color: #fcd34d; }
.av-rose   { background: rgba(236,72,153,0.22);   color: #f9a8d4; }
.av-indigo { background: rgba(129,140,248,0.22);  color: #c7d2fe; }
.av-green  { background: rgba(52,211,153,0.22);   color: #6ee7b7; }

.post-author-info { display: flex; flex-direction: column; gap: 3px; }
.post-author-name-row { display: flex; align-items: center; gap: 7px; }
.author-name { font-size: 15px; font-weight: 700; color: var(--app-text); }
.post-author-sub {
  display: flex; align-items: center; gap: 5px;
  font-size: 12px; color: rgba(255,255,255,0.4);
}
.community-chip {
  height: 22px !important;
  --padding-start: 7px; --padding-end: 7px;
  font-size: 11px !important;
}
.community-chip ion-icon { font-size: 12px; }



/* ── Commenter avatars: round ── */
.commenter-avatar {
  border-radius: 50% !important;
}

/* burst CSS moved to global style block below */

/* ══ Compact comment input row ══════════════════════════════════ */
.comment-input-row {
  display: flex;
  align-items: center;
  gap: 10px;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.09);
  border-radius: 999px;
  padding: 6px 8px 6px 10px;
}
.commenter-self-avatar {
  width: 28px; height: 28px;
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 12px; font-weight: 800;
  flex-shrink: 0;
}
.comment-input {
  flex: 1;
  background: none;
  border: none;
  outline: none;
  color: var(--app-text, #fff);
  font-size: 14px;
  font-family: inherit;
  padding: 2px 0;
}
.comment-input::placeholder { color: rgba(255,255,255,0.3); }
.comment-send-btn {
  width: 32px; height: 32px;
  border-radius: 50%;
  background: var(--app-accent, #6366f1);
  border: none;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer;
  color: #fff;
  flex-shrink: 0;
  transition: background 120ms, opacity 120ms;
}
.comment-send-btn:disabled { opacity: 0.35; cursor: default; }
.comment-send-btn:not(:disabled):hover { background: #818cf8; }

/* ══ Two-column comments + related ══════════════════════════════ */
.related-list {
  display: flex;
  flex-direction: column;
  gap: 0;
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid rgba(255,255,255,0.07);
  background: rgba(255,255,255,0.02);
  margin-top: 4px;
}
.related-row {
  padding: 11px 14px;
  border-bottom: 1px solid rgba(255,255,255,0.05);
  cursor: pointer;
  transition: background 120ms;
}
.related-row:last-child { border-bottom: none; }
.related-row:hover { background: rgba(255,255,255,0.04); }

/* ── Burst overlay (teleported to body — must NOT be scoped) ── */
/* These rules are in <style scoped> so we use :global() */
</style>
<style>
/* ── Instagram burst — GLOBAL (teleported outside scoped component) ── */
.burst-overlay {
  position: fixed;
  inset: 0;
  z-index: 99999;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}
.burst-heart {
  width: 160px; height: 160px;
  animation: burst-scale 0.75s cubic-bezier(0.17, 0.89, 0.32, 1.28) forwards;
  filter: drop-shadow(0 0 32px rgba(196,181,253,0.8));
}
.burst-overlay.dislike .burst-heart {
  filter: drop-shadow(0 0 32px rgba(239,68,68,0.8));
}
@keyframes burst-scale {
  0%   { transform: scale(0.1) rotate(-15deg); opacity: 0; }
  35%  { transform: scale(1.4) rotate(5deg);  opacity: 1; }
  55%  { transform: scale(0.95) rotate(-2deg); opacity: 1; }
  75%  { transform: scale(1.1) rotate(1deg);  opacity: 0.9; }
  100% { transform: scale(1.2) rotate(0deg);  opacity: 0; }
}
.burst-particles { position: absolute; inset: 0; }
.burst-particle {
  position: absolute;
  top: 50%; left: 50%;
  width: 10px; height: 10px;
  border-radius: 50%;
  animation: burst-particle-fly 0.8s ease-out forwards;
  animation-delay: calc(var(--i) * 0.035s);
  transform-origin: 0 0;
}
@keyframes burst-particle-fly {
  0%   { transform: translate(-50%,-50%) rotate(calc(var(--i)*45deg)) translateY(0px) scale(1); opacity:1; }
  100% { transform: translate(-50%,-50%) rotate(calc(var(--i)*45deg)) translateY(-110px) scale(0.3); opacity:0; }
}
.heart-burst-enter-active { animation: burst-scale 0.75s cubic-bezier(0.17,0.89,0.32,1.28); }
.heart-burst-leave-active { transition: opacity 0.1s ease; }
.heart-burst-leave-to    { opacity: 0; }

.detail-view-count {
  font-size: 12px;
  font-weight: 500;
  color: rgba(255,255,255,0.3);
  pointer-events: none;
  margin-left: 4px;
}
</style>