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
            <div class="post-meta">
              <ion-chip @click="$router.push(`/community/${post.communityId}`)">
                <ion-icon :icon="peopleOutline"></ion-icon>
                <ion-label>{{ communityName }}</ion-label>
              </ion-chip>
              <span class="separator">•</span>
              <span class="author">u/{{ postAuthorDisplayName }}</span>
              <span class="identity-badge" :class="postAuthorIdentityClass">
                {{ postAuthorIdentityLabel }}
              </span>
              <span class="separator">•</span>
              <span class="timestamp">{{ formatTime(post.createdAt) }}</span>
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
                <button class="vote-button upvote" @click="handleUpvote" :class="{ active: hasUpvoted }">
                  <ion-icon :icon="arrowUpOutline"></ion-icon>
                  <span>{{ formatNumber(post.upvotes) }}</span>
                </button>
                
                <button class="vote-button downvote" @click="handleDownvote" :class="{ active: hasDownvoted }">
                  <ion-icon :icon="arrowDownOutline"></ion-icon>
                  <span>{{ formatNumber(post.downvotes) }}</span>
                </button>

                <div class="stat-item score">
                  <ion-icon :icon="trendingUpOutline"></ion-icon>
                  <span>Score: {{ post.score }}</span>
                </div>
              </div>

              <button class="action-button share" @click="sharePost">
                <ion-icon :icon="shareSocialOutline"></ion-icon>
                <span>Share</span>
              </button>
            </div>
          </div>

          <div class="section-separator"></div>
        </div>

        <!-- Commenters Panel -->
        <div v-if="uniqueCommenters.length > 0" class="commenters-section">
          <h3 class="section-title">
            Commenters ({{ uniqueCommenters.length }})
          </h3>
          <div class="commenters-list">
            <div v-for="commenter in uniqueCommenters" :key="commenter.authorId" class="commenter-chip">
              <span class="commenter-online-dot"></span>
              <span class="commenter-name">u/{{ commenter.displayName }}</span>
              <span class="identity-badge" :class="commenter.identityTrustLevel === 'trusted-issuer' ? 'trusted-issuer' : 'unverified'">
                {{ commenter.identityTrustLabel }}
              </span>
              <ion-badge color="medium" class="commenter-count">{{ commenter.commentCount }}</ion-badge>
            </div>
          </div>
          <div class="section-separator"></div>
        </div>

        <!-- Comments Section -->
        <div class="comments-section">
          <h3 class="section-title">
            Comments ({{ allComments.length }})
          </h3>

          <!-- Add Comment Form -->
          <div class="add-comment-form">
            <ion-textarea
              v-model="newCommentText"
              placeholder="Add a comment..."
              :auto-grow="true"
              :rows="3"
              class="comment-textarea"
            ></ion-textarea>
            <ion-button 
              expand="block" 
              @click="submitComment"
              :disabled="!newCommentText.trim()"
            >
              <ion-icon slot="start" :icon="sendOutline"></ion-icon>
              Post Comment
            </ion-button>
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
      </div>
      </DesktopPageShell>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import DesktopPageShell from '../components/DesktopPageShell.vue';

function autoLink(text: string): string {
  if (!text) return '';
  // Simple URL regex
  return text.replace(/(https?:\/\/[\w\-\.\/?#&=;%+~:@,]+[\w\/])/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
}

import { ref, computed, onMounted, onUnmounted, watch, defineAsyncComponent, h } from 'vue';
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
  peopleOutline, arrowUpOutline, arrowDownOutline,
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

const hasUpvoted = computed(() => postStore.myVote(postId.value) === 'up');
const hasDownvoted = computed(() => postStore.myVote(postId.value) === 'down');

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
    const labels = { up: 'Upvote', down: 'Downvote' };
    await presentVoteToast(wasActive ? `${labels[direction]} removed` : `${labels[direction]}d`, version);
  } catch (error) {
    console.error('Error voting:', error);
  }
}

async function handleUpvote() {
  await handlePostVote('up');
}

async function handleDownvote() {
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

.vote-button {
  display: flex;
  align-items: center;
  gap: 6px;
  background: rgba(var(--ion-card-background-rgb), 0.20);
  border: 1px solid rgba(var(--ion-text-color-rgb), 0.1);
  padding: 8px 12px;
  font-size: 14px;
  color: var(--ion-color-medium);
  cursor: pointer;
  border-radius: 14px;
  font-family: inherit;
  font-weight: 500;
}

.vote-button.upvote.active {
  background: rgba(var(--ion-color-primary-rgb), 0.15);
  color: var(--ion-color-primary);
  border-color: rgba(var(--ion-color-primary-rgb), 0.3);
}

.vote-button.upvote.active ion-icon {
  color: var(--ion-color-primary);
}

.vote-button.downvote.active {
  color: var(--ion-color-danger);
  background: rgba(var(--ion-color-danger-rgb), 0.15);
  border-color: rgba(var(--ion-color-danger-rgb), 0.3);
}

.vote-button.downvote.active ion-icon {
  color: var(--ion-color-danger);
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
  margin: 16px 0;
}

html.dark .section-separator {
  background: rgba(255, 255, 255, 0.35);
}

.commenters-section {
  padding: 2px 0;
  background: transparent;
}

.section-title {
  font-size: 18px;
  font-weight: 600;
  margin: 0 0 12px 0;
  padding: 0 16px;
  color: var(--ion-text-color);
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
  padding: 16px 0;
  background: transparent;
}

.add-comment-form {
  margin-bottom: 24px;
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
</style>