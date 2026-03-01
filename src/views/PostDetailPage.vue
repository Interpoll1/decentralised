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
              <span class="separator">•</span>
              <span class="timestamp">{{ formatTime(post.createdAt) }}</span>
            </div>
            <h1 class="post-title">{{ post.title }}</h1>
          </div>

          <div class="post-body">
            <!-- Post Content -->
            <div v-if="post.content" class="post-content">
              {{ post.content }}
            </div>

            <!-- Post Image -->
            <div v-if="post.imageThumbnail || post.imageIPFS" class="post-image" :class="{ 'nsfw-blurred': detailImageNsfw && !detailImageRevealed }">
              <img
                ref="detailImageRef"
                :src="post.imageThumbnail || getIPFSUrl(post.imageIPFS)"
                :alt="post.title"
                crossorigin="anonymous"
                @load="onDetailImageLoad"
              />
              <div v-if="detailImageNsfw && !detailImageRevealed" class="nsfw-overlay" @click="detailImageRevealed = true">
                <ion-icon :icon="eyeOffOutline"></ion-icon>
                <span>Sensitive image ({{ detailNsfwLabel }}) — tap to reveal</span>
              </div>
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
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch, watchEffect } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  IonPage, IonHeader, IonToolbar, IonTitle, IonContent,
  IonButtons, IonBackButton, IonButton, IonIcon, IonCard,
  IonCardHeader, IonCardTitle, IonCardContent, IonChip,
  IonLabel, IonSpinner, IonTextarea, IonBadge,
  toastController, actionSheetController
} from '@ionic/vue';
import {
  peopleOutline, arrowUpOutline, arrowDownOutline,
  trendingUpOutline, chatbubbleOutline, sendOutline,
  shareSocialOutline, alertCircleOutline, refreshOutline,
  eyeOffOutline
} from 'ionicons/icons';
import { usePostStore } from '../stores/postStore';
import { useCommentStore } from '../stores/commentStore';
import { useCommunityStore } from '../stores/communityStore';
import { useUserStore } from '../stores/userStore';
import CommentCard from '../components/CommentCard.vue';
import { Post } from '../services/postService';
import { generatePseudonym } from '../utils/pseudonym';
import { ModerationService, moderationVersion } from '../services/moderationService';
import { NsfwService } from '../services/nsfwService';

const route = useRoute();
const router = useRouter();
const postStore = usePostStore();
const commentStore = useCommentStore();
const communityStore = useCommunityStore();
const userStore = useUserStore();

const post = ref<Post | null>(null);
const isLoading = ref(true);
const newCommentText = ref('');
const voteVersion = ref(0);
const detailImageNsfwRaw = ref(false);
const detailImageRevealed = ref(false);
const detailNsfwLabel = ref('');
const detailImageRef = ref<HTMLImageElement | null>(null);

const detailImageNsfw = computed(() => {
  moderationVersion.value;
  return detailImageNsfwRaw.value && NsfwService.isEnabled();
});

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

// Pre-fetch author profiles outside computed
watchEffect(() => {
  for (const c of allComments.value) {
    if (c.authorId && userStore.getCachedKarma(c.authorId) === null) {
      userStore.getProfile(c.authorId);
    }
  }
});

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
  const authorMap = new Map<string, { authorId: string; displayName: string; commentCount: number }>();

  commentStore.comments
    .filter(c => c.postId === postId.value || c.postId === post.value?.id)
    .forEach(c => {
      const existing = authorMap.get(c.authorId);
      if (existing) {
        existing.commentCount++;
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
        });
      }
    });

  return Array.from(authorMap.values()).sort((a, b) => b.commentCount - a.commentCount);
});

const hasUpvoted = computed(() => {
  voteVersion.value;
  return JSON.parse(localStorage.getItem('upvoted-posts') || '[]').includes(postId.value);
});

const hasDownvoted = computed(() => {
  voteVersion.value;
  return JSON.parse(localStorage.getItem('downvoted-posts') || '[]').includes(postId.value);
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

async function onDetailImageLoad() {
  if (!detailImageRef.value) return;
  const result = await NsfwService.classifyImage(detailImageRef.value);
  detailImageNsfwRaw.value = !result.safe;
  detailNsfwLabel.value = result.classification;
}

function getIPFSUrl(cid?: string): string {
  return cid ? `https://ipfs.io/ipfs/${cid}` : '';
}

function toggleLocalStorageItem(key: string, id: string, add: boolean) {
  const items: string[] = JSON.parse(localStorage.getItem(key) || '[]');
  const updated = add ? [...items, id] : items.filter(i => i !== id);
  localStorage.setItem(key, JSON.stringify(updated));
}

async function handleUpvote() {
  if (!post.value) return;
  try {
    if (hasUpvoted.value) {
      toggleLocalStorageItem('upvoted-posts', post.value.id, false);
      // Optimistic update
      post.value = { ...post.value, upvotes: post.value.upvotes - 1, score: post.value.score - 1 };
      voteVersion.value++;
      postStore.removeUpvote(post.value.id); // fire and forget
      (await toastController.create({ message: 'Upvote removed', duration: 1500, color: 'medium' })).present();
    } else {
      const wasDownvoted = hasDownvoted.value;
      toggleLocalStorageItem('downvoted-posts', post.value.id, false);
      toggleLocalStorageItem('upvoted-posts', post.value.id, true);
      // Optimistic update
      post.value = { ...post.value,
        upvotes: post.value.upvotes + 1,
        downvotes: wasDownvoted ? post.value.downvotes - 1 : post.value.downvotes,
        score: post.value.score + (wasDownvoted ? 2 : 1),
      };
      voteVersion.value++;
      if (wasDownvoted) postStore.removeDownvote(post.value.id); // fire and forget
      postStore.upvotePost(post.value.id); // fire and forget
      (await toastController.create({ message: 'Upvoted', duration: 1500, color: 'success' })).present();
    }
  } catch {
    voteVersion.value++;
  }
}

async function handleDownvote() {
  if (!post.value) return;
  try {
    if (hasDownvoted.value) {
      toggleLocalStorageItem('downvoted-posts', post.value.id, false);
      // Optimistic update
      post.value = { ...post.value, downvotes: post.value.downvotes - 1, score: post.value.score + 1 };
      voteVersion.value++;
      postStore.removeDownvote(post.value.id); // fire and forget
      (await toastController.create({ message: 'Downvote removed', duration: 1500, color: 'medium' })).present();
    } else {
      const wasUpvoted = hasUpvoted.value;
      toggleLocalStorageItem('upvoted-posts', post.value.id, false);
      toggleLocalStorageItem('downvoted-posts', post.value.id, true);
      // Optimistic update
      post.value = { ...post.value,
        downvotes: post.value.downvotes + 1,
        upvotes: wasUpvoted ? post.value.upvotes - 1 : post.value.upvotes,
        score: post.value.score - (wasUpvoted ? 2 : 1),
      };
      voteVersion.value++;
      if (wasUpvoted) postStore.removeUpvote(post.value.id); // fire and forget
      postStore.downvotePost(post.value.id); // fire and forget
      (await toastController.create({ message: 'Downvoted', duration: 1500, color: 'warning' })).present();
    }
  } catch {
    voteVersion.value++;
  }
}

async function submitComment() {
  if (!post.value || !newCommentText.value.trim()) return;
  try {
    await commentStore.createComment({
      postId: post.value.id,
      communityId: post.value.communityId,
      content: newCommentText.value.trim()
    });
    newCommentText.value = '';
    (await toastController.create({ message: 'Comment posted', duration: 2000, color: 'success' })).present();
    setTimeout(() => {
      if (post.value) commentStore.loadCommentsForPost(post.value.id);
    }, 500);
  } catch {
    (await toastController.create({ message: 'Failed to post comment', duration: 2000, color: 'danger' })).present();
  }
}

async function handleCommentUpvote(comment: any) {
  try {
    const wasUpvoted = JSON.parse(localStorage.getItem('upvoted-comments') || '[]').includes(comment.id);
    await commentStore.upvoteComment(comment.id);
    (await toastController.create({
      message: wasUpvoted ? 'Upvote removed' : 'Comment upvoted',
      duration: 1500,
      color: wasUpvoted ? 'medium' : 'success'
    })).present();
  } catch { /* silent */ }
}

async function handleCommentDownvote(comment: any) {
  try {
    const wasDownvoted = JSON.parse(localStorage.getItem('downvoted-comments') || '[]').includes(comment.id);
    await commentStore.downvoteComment(comment.id);
    (await toastController.create({
      message: wasDownvoted ? 'Downvote removed' : 'Comment downvoted',
      duration: 1500,
      color: wasDownvoted ? 'medium' : 'warning'
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
          toastController.create({ message: 'Link copied to clipboard', duration: 2000, color: 'success' })
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
    post.value = postStore.currentPost;
    if (post.value) {
      await commentStore.loadCommentsForPost(post.value.id);
    }
  } catch { /* silent */ }
  finally {
    isLoading.value = false;
  }
}

async function refreshPost() {
  await loadPost();
  (await toastController.create({ message: 'Post refreshed', duration: 1500, color: 'success' })).present();
}

onMounted(async () => {
  await loadPost();
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

.post-image.nsfw-blurred {
  position: relative;
}

.post-image.nsfw-blurred img {
  filter: blur(20px);
}

.nsfw-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  background: rgba(0, 0, 0, 0.35);
  cursor: pointer;
  color: white;
  font-size: 13px;
  text-align: center;
  padding: 8px;
  border-radius: 8px;
}

.nsfw-overlay ion-icon {
  font-size: 28px;
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
</style>



