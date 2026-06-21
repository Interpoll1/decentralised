<!-- In PostCard.vue template -->
<template>
  <article class="post-card" :class="{ 'post-removed': isHidden }" v-if="post">
    <div v-if="flagged && filterAction === 'blur' && !revealed" class="flagged-overlay" @click.stop="revealed = true">
      <ion-icon :icon="warningOutline"></ion-icon>
      <span>Content hidden by word filter — tap to reveal</span>
    </div>

    <div class="post-body" @click="handleCardClick" :class="{ 'content-blurred': flagged && filterAction === 'blur' && !revealed }">
      <div class="post-header">
        <div class="post-meta">
          <span class="community-name">{{ communityName }}</span>
          <span class="separator">•</span>
          <span class="author">u/{{ authorDisplayName }}</span>
          <span class="separator">•</span>
          <span class="timestamp">{{ formatTime(post.createdAt) }}</span>
          <span v-if="flagged && filterAction === 'flag'" class="flag-badge" title="Flagged by word filter">
            <ion-icon :icon="warningOutline"></ion-icon>
          </span>
          <span v-if="isHidden" class="removed-badge" title="Removed from this community by its owner">
            <ion-icon :icon="eyeOffOutline"></ion-icon> removed
          </span>
        </div>
      </div>

      <h3 class="post-title">{{ post.title }}</h3>

      <p v-if="post.content" class="post-content">{{ truncatedContent }}</p>

      <div v-if="post.imageThumbnail || post.imageId">
        <div class="post-image">
          <img
            :src="post.imageThumbnail || getImageUrl(post.imageId)"
            :alt="post.title"
          />
        </div>
      </div>

      <div class="post-footer" @click.stop>
        <div class="post-stats">
          <button class="stat-button upvote" @click="handleUpvote" :class="{ active: hasUpvoted }">
            <ion-icon :icon="arrowUpOutline"></ion-icon>
            <span>{{ formatNumber(post.upvotes) }}</span>
          </button>
          
          <button class="stat-button downvote" @click="handleDownvote" :class="{ active: hasDownvoted }">
            <ion-icon :icon="arrowDownOutline"></ion-icon>
            <span>{{ formatNumber(post.downvotes) }}</span>
          </button>

          <button class="stat-button comments" @click="handleCommentsClick">
            <ion-icon :icon="chatbubbleOutline"></ion-icon>
            <span>{{ formatNumber(post.commentCount) }}</span>
          </button>

          <div class="stat-item score">
            <ion-icon :icon="trendingUpOutline"></ion-icon>
            <span>{{ post.score }}</span>
          </div>
        </div>

        <div v-if="canModerate" class="mod-actions">
          <button v-if="!isHidden" class="mod-button" @click="handleRemove">
            <ion-icon :icon="trashOutline"></ion-icon>
            <span>Remove from community</span>
          </button>
          <button v-else class="mod-button restore" @click="handleRestore">
            <ion-icon :icon="arrowUndoOutline"></ion-icon>
            <span>Restore</span>
          </button>
        </div>
      </div>
    </div>
  </article>
</template>

<style scoped>
.post-card {
  margin: 0 0 24px;
  padding: 20px 0 18px;
  border-bottom: 1px solid rgba(15, 23, 42, 0.08);
}

.post-header {
  margin-bottom: 12px;
}

.post-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--app-text-muted);
  flex-wrap: wrap;
}

.community-name {
  color: var(--app-accent-bright);
  font-weight: 600;
}

.separator {
  color: rgba(255, 255, 255, 0.25);
}

.author {
  color: var(--app-text);
  font-weight: 500;
}

.timestamp {
  color: var(--app-text-subtle);
}

.post-title {
  margin: 0 0 10px;
  font-size: 20px;
  font-weight: 600;
  line-height: 1.25;
  letter-spacing: -0.02em;
  color: var(--app-text);
}

.post-content {
  margin: 0 0 14px;
  font-size: 14px;
  line-height: 1.7;
  color: var(--app-text-muted);
}

.post-image {
  margin: 0 0 16px;
  border-radius: 16px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
}

.post-image img {
  width: 100%;
  height: auto;
  display: block;
  object-fit: cover;
}

.post-footer {
  margin-top: 4px;
  padding-top: 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.post-stats {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.stat-button {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 10px 12px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 999px;
  font-size: 13px;
  font-weight: 600;
  color: var(--app-text-muted);
  cursor: pointer;
  transition: all var(--app-transition);
  -webkit-tap-highlight-color: transparent;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05);
}

.stat-button:hover {
  background: rgba(255, 255, 255, 0.05);
  border-color: rgba(255, 255, 255, 0.1);
}

.stat-button:active {
  transform: scale(0.98);
}

.stat-button ion-icon {
  font-size: 16px;
}

.stat-button span {
  min-width: 16px;
  text-align: center;
}

.stat-button.upvote {
  border-color: rgba(var(--ion-color-success-rgb), 0.15);
}

.stat-button.upvote:hover {
  background: rgba(var(--ion-color-success-rgb), 0.08);
  border-color: rgba(var(--ion-color-success-rgb), 0.25);
  color: var(--ion-color-success);
}

.stat-button.upvote.active {
  background: rgba(var(--ion-color-success-rgb), 0.12);
  border-color: var(--ion-color-success);
  color: var(--ion-color-success);
}

.stat-button.downvote {
  border-color: rgba(var(--ion-color-danger-rgb), 0.15);
}

.stat-button.downvote:hover {
  background: rgba(var(--ion-color-danger-rgb), 0.08);
  border-color: rgba(var(--ion-color-danger-rgb), 0.25);
  color: var(--ion-color-danger);
}

.stat-button.downvote.active {
  background: rgba(var(--ion-color-danger-rgb), 0.12);
  border-color: var(--ion-color-danger);
  color: var(--ion-color-danger);
}

.stat-button.comments {
  border-color: rgba(var(--ion-color-primary-rgb), 0.15);
}

.stat-button.comments:hover {
  background: rgba(var(--ion-color-primary-rgb), 0.08);
  border-color: rgba(var(--ion-color-primary-rgb), 0.25);
  color: var(--ion-color-primary);
}

.stat-button.comments:active {
  background: rgba(var(--ion-color-primary-rgb), 0.12);
}

.stat-item.score {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 10px 12px;
  background: rgba(var(--ion-color-tertiary-rgb), 0.08);
  border: 1px solid rgba(var(--ion-color-tertiary-rgb), 0.18);
  border-radius: 999px;
  font-size: 13px;
  font-weight: 600;
  color: var(--ion-color-tertiary);
  margin-left: auto;
  margin-right: 0;
}

.stat-item.score ion-icon {
  font-size: 16px;
  color: var(--ion-color-tertiary);
}

@media (max-width: 576px) {
  .post-card {
    margin: 0 0 14px;
    padding: 16px 0 14px;
  }

  .post-title {
    font-size: 16px;
  }

  .post-content {
    font-size: 13px;
  }

  .post-stats {
    gap: 6px;
    flex-wrap: wrap;
  }

  .stat-button {
    padding: 8px 10px;
    font-size: 12px;
  }

  .stat-button ion-icon {
    font-size: 14px;
  }

  .stat-item.score {
    padding: 5px 10px;
    font-size: 12px;
  }
}

.flagged-overlay {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  background: rgba(var(--ion-color-warning-rgb), 0.10);
  border: 1px solid rgba(var(--ion-color-warning-rgb), 0.25);
  border-radius: 10px;
  color: var(--ion-color-warning-shade);
  font-size: 13px;
  cursor: pointer;
  margin-bottom: 8px;
}

.flagged-overlay ion-icon {
  font-size: 18px;
  flex-shrink: 0;
}

.content-blurred {
  filter: blur(6px);
  user-select: none;
  pointer-events: none;
}

.flag-badge {
  display: inline-flex;
  align-items: center;
  color: var(--ion-color-warning);
  margin-left: 4px;
}

.flag-badge ion-icon {
  font-size: 14px;
}

.stat-button:focus-visible {
  box-shadow: var(--app-focus-ring);
}

/* ── Moderation ───────────────────────────────────── */
.post-removed {
  opacity: 0.5;
}

.removed-badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 11px;
  font-weight: 600;
  color: var(--ion-color-danger);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.removed-badge ion-icon {
  font-size: 13px;
}

.mod-actions {
  margin-top: 12px;
}

.mod-button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 12px;
  background: rgba(var(--ion-color-danger-rgb), 0.08);
  border: 1px solid rgba(var(--ion-color-danger-rgb), 0.25);
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  color: var(--ion-color-danger);
  cursor: pointer;
  transition: all var(--app-transition);
}

.mod-button:hover {
  background: rgba(var(--ion-color-danger-rgb), 0.14);
}

.mod-button.restore {
  background: rgba(var(--ion-color-success-rgb), 0.08);
  border-color: rgba(var(--ion-color-success-rgb), 0.25);
  color: var(--ion-color-success);
}

.mod-button.restore:hover {
  background: rgba(var(--ion-color-success-rgb), 0.14);
}

.mod-button ion-icon {
  font-size: 14px;
}
</style>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useRouter } from 'vue-router';
import { IonIcon, toastController } from '@ionic/vue';
import {
  arrowUpOutline,
  arrowDownOutline,
  chatbubbleOutline,
  trendingUpOutline,
  warningOutline,
  trashOutline,
  arrowUndoOutline,
  eyeOffOutline
} from 'ionicons/icons';
import { Post } from '../services/postService';
import type { FilterAction } from '../services/moderationService';
import { generatePseudonym } from '../utils/pseudonym';
import { stripMarkdown } from '../utils/markdown';
import { useUserStore } from '../stores/userStore';
import { useCommunityStore } from '../stores/communityStore';
import type { UserProfile } from '../services/userService';

const router = useRouter();
const userStore = useUserStore();
const communityStore = useCommunityStore();
const authorProfile = ref<UserProfile | null>(null);
let authorProfileRequestId = 0;

const props = defineProps<{ 
  post: Post;
  communityName?: string;
  hasUpvoted?: boolean;
  hasDownvoted?: boolean;
  flagged?: boolean;
  filterAction?: FilterAction;
}>();

const revealed = ref(false);

const emit = defineEmits(['upvote', 'downvote']);

watch(
  () => props.post.authorId,
  async (authorId) => {
    const requestId = ++authorProfileRequestId;
    if (!authorId) {
      authorProfile.value = null;
      return;
    }
    const profile = await userStore.getProfile(authorId);
    if (requestId !== authorProfileRequestId) return;
    authorProfile.value = profile;
  },
  { immediate: true }
);

const currentAuthorProfile = computed(() => {
  if (!props.post.authorId) return authorProfile.value;
  return userStore.profiles[props.post.authorId] || authorProfile.value;
});

const authorDisplayName = computed(() => {
  if (props.post.authorShowRealName) {
    return props.post.authorName || 'anon';
  }
  if (currentAuthorProfile.value?.customUsername) {
    return currentAuthorProfile.value.customUsername;
  }
  if (currentAuthorProfile.value?.showRealName && currentAuthorProfile.value?.displayName) {
    return currentAuthorProfile.value.displayName;
  }
  if (props.post.authorId && props.post.id) {
    return generatePseudonym(props.post.id, props.post.authorId);
  }
  return props.post.authorName || 'anon';
});

const truncatedContent = computed(() => {
  const content = stripMarkdown(props.post.content || '');
  if (content.length <= 200) {
    return content;
  }
  return content.substring(0, 200) + '...';
});

// ── Moderation (community owner only) ──────────────────────────────────────────
const isHidden = computed(() =>
  communityStore.isPostHidden(props.post.communityId, props.post.id)
);
const canModerate = computed(() =>
  communityStore.canModerate(props.post.communityId)
);

async function moderate(run: () => Promise<void>, failMessage: string) {
  try {
    await run();
  } catch (e) {
    const toast = await toastController.create({
      message: (e as Error)?.message || failMessage,
      duration: 2500,
      color: 'danger',
    });
    await toast.present();
  }
}

const handleRemove = () =>
  moderate(() => communityStore.hidePost(props.post.communityId, props.post.id), 'Could not remove post');
const handleRestore = () =>
  moderate(() => communityStore.unhidePost(props.post.communityId, props.post.id), 'Could not restore post');

function handleCardClick() {
  router.push(`/post/${props.post.id}`);
}

function handleUpvote(event: Event) {
  event.stopPropagation();
  emit('upvote');
}

function handleDownvote(event: Event) {
  event.stopPropagation();
  emit('downvote');
}

function handleCommentsClick(event: Event) {
  event.stopPropagation();
  router.push(`/post/${props.post.id}`);
}

function formatTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  
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

function getImageUrl(cid?: string): string {
  if (!cid) return '';
  return `https://ipfs.io/ipfs/${cid}`;
}
</script>
