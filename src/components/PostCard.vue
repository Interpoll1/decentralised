<template>
  <ion-card class="post-card">
    <!-- Clickable card content area -->
    <ion-card-content @click="handleCardClick">
      <!-- Post Header -->
      <div class="post-header">
        <div class="post-meta">
          <span class="community-name">{{ communityName }}</span>
          <span class="separator">•</span>
          <span class="author">u/{{ post.authorName }}</span>
          <span class="separator">•</span>
          <span class="timestamp">{{ formatTime(post.createdAt) }}</span>
        </div>
      </div>

      <!-- Post Title -->
      <h3 class="post-title">{{ post.title }}</h3>

      <!-- Post Content Preview -->
      <p v-if="post.content" class="post-content">{{ truncatedContent }}</p>

      <!-- Post Image -->
      <div v-if="post.imageThumbnail || post.imageIPFS" class="post-image">
        <img :src="post.imageThumbnail || getIPFSUrl(post.imageIPFS)" :alt="post.title" />
      </div>

      <!-- Post Footer - Not clickable for card navigation -->
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
      </div>
    </ion-card-content>
  </ion-card>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { IonCard, IonCardContent, IonIcon } from '@ionic/vue';
import { 
  arrowUpOutline, 
  arrowDownOutline, 
  chatbubbleOutline, 
  trendingUpOutline 
} from 'ionicons/icons';
import { Post } from '../services/postService';

const router = useRouter();

const props = defineProps<{ 
  post: Post;
  communityName?: string;
  hasUpvoted?: boolean;
  hasDownvoted?: boolean;
}>();

const emit = defineEmits(['upvote', 'downvote']);

const truncatedContent = computed(() => {
  const content = props.post.content || '';
  if (content.length <= 200) {
    return content;
  }
  return content.substring(0, 200) + '...';
});

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

function getIPFSUrl(cid?: string): string {
  if (!cid) return '';
  return `https://ipfs.io/ipfs/${cid}`;
}
</script>

<style scoped>
.post-card {
  margin: 12px 12px;
  cursor: pointer;
  border-radius: 20px;
}

.post-header {
  margin-bottom: 8px;
}

.post-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--ion-color-medium);
}

.community-name {
  font-weight: 600;
  color: var(--ion-color-primary);
}

.separator {
  color: var(--ion-color-medium-shade);
}

.author {
  color: var(--ion-color-step-600);
}

.timestamp {
  color: var(--ion-color-medium);
}

.post-title {
  margin: 0 0 8px 0;
  font-size: 18px;
  font-weight: 600;
  line-height: 1.4;
  color: var(--ion-text-color);
}

.post-content {
  margin: 0 0 12px 0;
  font-size: 14px;
  line-height: 1.5;
  color: var(--ion-color-step-600);
}

.post-image {
  margin: 12px 0;
  border-radius: 14px;
  overflow: hidden;
  max-height: 400px;
}

.post-image img {
  width: 100%;
  height: auto;
  display: block;
}

.post-footer {
  border-top: 1px solid rgba(var(--ion-text-color-rgb), 0.05);
  padding-top: 12px;
  margin-top: 12px;
}

.post-stats {
  display: flex;
  align-items: center;
  gap: 14px;
}

.stat-button {
  display: flex;
  align-items: center;
  gap: 4px;
  background: rgba(var(--ion-card-background-rgb), 0.18);
  border: 1px solid var(--glass-border);
  border-top-color: var(--glass-border-top);
  padding: 5px 11px;
  border-radius: 12px;
  cursor: pointer;
  font-size: 13px;
  color: var(--ion-color-step-600);
  transition: var(--liquid-spring);
  backdrop-filter: blur(10px) saturate(1.4);
  -webkit-backdrop-filter: blur(10px) saturate(1.4);
  box-shadow: var(--glass-highlight);
}

.stat-button:hover {
  background: rgba(var(--ion-color-primary-rgb), 0.10);
  border-color: rgba(var(--ion-color-primary-rgb), 0.22);
  transform: translateY(-1px);
}

.stat-button:active {
  transform: scale(0.96) translateY(0);
}

.stat-button.upvote.active {
  background: rgba(var(--ion-color-primary-rgb), 0.14);
  color: var(--ion-color-primary);
  border-color: rgba(var(--ion-color-primary-rgb), 0.30);
  box-shadow: var(--glass-highlight), 0 0 14px rgba(var(--ion-color-primary-rgb), 0.12);
}

.stat-button.downvote.active {
  background: rgba(var(--ion-color-danger-rgb), 0.14);
  color: var(--ion-color-danger);
  border-color: rgba(var(--ion-color-danger-rgb), 0.30);
  box-shadow: var(--glass-highlight), 0 0 14px rgba(var(--ion-color-danger-rgb), 0.12);
}

.stat-button ion-icon {
  font-size: 18px;
}

.stat-item {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  color: var(--ion-color-medium);
}

.stat-item ion-icon {
  font-size: 16px;
}

.stat-item.score {
  margin-left: auto;
  font-weight: 500;
}

@media (max-width: 576px) {
  .post-title {
    font-size: 16px;
  }

  .post-content {
    font-size: 13px;
  }

  .post-stats {
    gap: 10px;
    font-size: 12px;
  }
}
</style>