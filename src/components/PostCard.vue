<!-- In PostCard.vue template -->
<template>
  <div class="post-card" v-if="post">
    <!-- Flagged content overlay (blur mode) -->
    <div v-if="flagged && filterAction === 'blur' && !revealed" class="flagged-overlay" @click.stop="revealed = true">
      <ion-icon :icon="warningOutline"></ion-icon>
      <span>Content hidden by word filter — tap to reveal</span>
    </div>

    <!-- Clickable card content area -->
    <div @click="handleCardClick" :class="{ 'content-blurred': flagged && filterAction === 'blur' && !revealed }">
      <!-- Post Header -->
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
        </div>
      </div>

      <!-- Post Title -->
      <h3 class="post-title">{{ post.title }}</h3>

      <!-- Post Content Preview -->
      <p v-if="post.content" class="post-content">{{ truncatedContent }}</p>

      <!-- Post Image -->
      <div v-if="post.imageThumbnail || post.imageIPFS">
        <div class="post-image" :class="{ 'nsfw-blurred': imageNsfw && !imageRevealed }">
          <img
            ref="postImageRef"
            :src="post.imageThumbnail || getIPFSUrl(post.imageIPFS)"
            :alt="post.title"
            crossorigin="anonymous"
            @load="onImageLoad"
          />
          <div v-if="imageNsfw && !imageRevealed" class="nsfw-overlay" @click.stop="imageRevealed = true">
            <ion-icon :icon="eyeOffOutline"></ion-icon>
            <span>Sensitive image ({{ nsfwLabel }}) — tap to reveal</span>
          </div>
        </div>

        <div v-if="showScanAction" class="nsfw-actions">
          <button class="nsfw-scan-button" type="button" @click.stop="scanImage" :disabled="isScanning">
            <ion-icon :icon="shieldOutline"></ion-icon>
            <span>{{ isScanning ? 'Scanning...' : 'Scan image' }}</span>
          </button>
        </div>
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

          <div class="stat-item score" style="margin-right: 15px;">
            <ion-icon :icon="trendingUpOutline"></ion-icon>
            <span>{{ post.score }}</span>
          </div>
        </div>
      </div>
    </div>
    
    <!-- Separator line -->
    <div class="post-separator"></div>
  </div>
</template>

<style scoped>
/* Main Post Card Container */
.post-card {
  margin-left: 20px;
  padding: 8px 0;
  cursor: pointer;
  background: transparent;
  border: none;
}

.post-separator {
  height: 0.5px;
  background: rgba(var(--ion-text-color-rgb), 0.08);
  margin-top: 16px;
}

html.dark .post-separator {
  background: rgba(255, 255, 255, 0.35);
}

html.dark .post-footer {
  border-top-color: rgba(255, 255, 255, 0.25);
}

/* Post Header */
.post-header {
  margin-bottom: 8px;
}

.post-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--ion-color-medium);
  flex-wrap: wrap;
}

.community-name {
  color: var(--ion-color-step-600);
  font-weight: 600;
}

.separator {
  color: var(--ion-color-medium-shade);
}

.author {
  color: var(--ion-color-step-600);
  font-weight: 500;
}

.timestamp {
  color: var(--ion-color-medium);
}

/* Post Title */
.post-title {
  margin: 8px 0;
  margin-right: 10px;
  font-size: 18px;
  font-weight: 600;
  line-height: 1.4;
  color: var(--ion-text-color);
}

/* Post Content */
.post-content {
  margin: 8px 0;
  font-size: 14px;
  
  line-height: 1.5;
  color: var(--ion-color-step-600);
}

/* Post Image */
.post-image {
  margin: 12px 10px;
  border-radius: 12px;
  overflow: hidden;
  background: rgba(var(--ion-card-background-rgb), 0.3);
}

.post-image img {
  width: 100%;
  height: auto;
  display: block;
  object-fit: cover;
}

/* Post Footer - Voting and Stats */
.post-footer {
  margin-top: 1px;
  padding-top: 4px;
  
}

.post-stats {
  display: flex;
  align-items: center;
  gap: 4px;
}

/* Stat Buttons Base Styles */
.stat-button {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 12px 12px;
  background: transparent;
  border: 1px solid rgba(var(--ion-text-color-rgb), 0.08);
  border-radius: 20px;
  font-size: 13px;
  font-weight: 500;
  color: var(--ion-color-medium);
  cursor: pointer;
  transition: all 0.2s ease;
  -webkit-tap-highlight-color: transparent;
}

.stat-button:hover {
  background: rgba(var(--ion-text-color-rgb), 0.04);
  border-color: rgba(var(--ion-text-color-rgb), 0.12);
}

.stat-button:active {
  transform: scale(0.95);
}

.stat-button ion-icon {
  font-size: 16px;
}

.stat-button span {
  min-width: 16px;
  text-align: center;
}

/* Upvote Button */
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

.stat-button.upvote.active ion-icon {
  color: var(--ion-color-success);
}

/* Downvote Button */
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

.stat-button.downvote.active ion-icon {
  color: var(--ion-color-danger);
}

/* Comments Button */
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

/* Score Display (Non-interactive) */
.stat-item.score {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  background: rgba(var(--ion-color-tertiary-rgb), 0.08);
  border: 1px solid rgba(var(--ion-color-tertiary-rgb), 0.18);
  border-radius: 20px;
  font-size: 13px;
  font-weight: 600;
  color: var(--ion-color-tertiary);
  margin-left: auto;
}

.stat-item.score ion-icon {
  font-size: 16px;
  color: var(--ion-color-tertiary);
}

/* Mobile Responsive */
@media (max-width: 576px) {
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
    padding: 5px 10px;
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

/* Dark Mode Enhancements */
html.dark .stat-button {
  border-color: rgba(255, 255, 255, 0.1);
}

html.dark .stat-button:hover {
  background: rgba(255, 255, 255, 0.05);
  border-color: rgba(255, 255, 255, 0.15);
}

/* Flagged content styles */
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

.nsfw-blurred {
  position: relative;
}

.nsfw-blurred img {
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
  border-radius: 12px;
}

.nsfw-overlay ion-icon {
  font-size: 28px;
}

.nsfw-actions {
  display: flex;
  justify-content: flex-start;
  margin: 8px 10px 0;
}

.nsfw-scan-button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border: 1px solid rgba(var(--ion-color-primary-rgb), 0.18);
  border-radius: 999px;
  background: rgba(var(--ion-color-primary-rgb), 0.08);
  color: var(--ion-color-primary);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.nsfw-scan-button:disabled {
  opacity: 0.65;
  cursor: progress;
}

.nsfw-scan-button ion-icon {
  font-size: 15px;
}

/* Accessibility - Focus States */
.stat-button:focus-visible {
  outline: 2px solid var(--ion-color-primary);
  outline-offset: 2px;
}
</style>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useRouter } from 'vue-router';
import { IonIcon } from '@ionic/vue';
import {
  arrowUpOutline, 
  arrowDownOutline, 
  chatbubbleOutline, 
  trendingUpOutline,
  warningOutline,
  eyeOffOutline,
  shieldOutline
} from 'ionicons/icons';
import { Post } from '../services/postService';
import type { FilterAction } from '../services/moderationService';
import { moderationVersion } from '../services/moderationService';
import { IPFSService } from '../services/ipfsService';
import { generatePseudonym } from '../utils/pseudonym';

const router = useRouter();

const props = defineProps<{ 
  post: Post;
  communityName?: string;
  hasUpvoted?: boolean;
  hasDownvoted?: boolean;
  flagged?: boolean;
  filterAction?: FilterAction;
}>();

const revealed = ref(false);
const imageNsfwRaw = ref(false);
const imageRevealed = ref(false);
const nsfwLabel = ref('');
const postImageRef = ref<HTMLImageElement | null>(null);
const nsfwChecked = ref(false);
const isScanning = ref(false);
const highResScanSrc = ref<string | null>(null);
let highResScanPromise: Promise<string | null> | null = null;

watch(() => props.post.imageIPFS, () => {
  nsfwChecked.value = false;
  imageNsfwRaw.value = false;
  imageRevealed.value = false;
  highResScanSrc.value = null;
  highResScanPromise = null;
}, { immediate: true });

const imageNsfw = computed(() => {
  moderationVersion.value;
  return imageNsfwRaw.value && NsfwService.isEnabled();
});

const shouldAutoScan = computed(() => {
  moderationVersion.value;
  return NsfwService.shouldAutoScan('feed');
});

const showScanAction = computed(() => {
  moderationVersion.value;
  return NsfwService.isEnabled() && !shouldAutoScan.value && !nsfwChecked.value;
});

const emit = defineEmits(['upvote', 'downvote']);

const authorDisplayName = computed(() => {
  if (props.post.authorShowRealName) {
    return props.post.authorName || 'anon';
  }
  if (props.post.authorId && props.post.id) {
    return generatePseudonym(props.post.id, props.post.authorId);
  }
  return props.post.authorName || 'anon';
});

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

async function classifyCurrentImage() {
  if (isScanning.value) return;
  isScanning.value = true;
  try {
    const targetImage = await getImageForClassification();
    if (!targetImage) return;
    const result = await NsfwService.classifyImage(targetImage);
    imageNsfwRaw.value = !result.safe;
    nsfwLabel.value = result.classification;
    nsfwChecked.value = true;
  } finally {
    isScanning.value = false;
  }
}

async function onImageLoad() {
  if (nsfwChecked.value || !shouldAutoScan.value) return;
  await classifyCurrentImage();
}

async function scanImage() {
  if (isScanning.value || (!postImageRef.value && !props.post.imageIPFS)) return;
  await classifyCurrentImage();
}

function getIPFSUrl(cid?: string): string {
  if (!cid) return '';
  return `https://ipfs.io/ipfs/${cid}`;
}

function loadImageElement(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

async function loadHighResScanSrc(cid: string): Promise<string | null> {
  try {
    const data = await IPFSService.downloadImage(cid);
    if (props.post.imageIPFS === cid && data) {
      highResScanSrc.value = data;
    }
    return data || null;
  } catch {
    return null;
  } finally {
    if (props.post.imageIPFS === cid) {
      highResScanPromise = null;
    }
  }
}

async function ensureHighResScanSrc(): Promise<string | null> {
  if (highResScanSrc.value) return highResScanSrc.value;
  const cid = props.post.imageIPFS;
  if (!cid) return null;
  if (!highResScanPromise) {
    highResScanPromise = loadHighResScanSrc(cid);
  }
  return highResScanPromise;
}

async function getImageForClassification(): Promise<HTMLImageElement | null> {
  const fullSrc = await ensureHighResScanSrc();
  if (fullSrc) {
    return loadImageElement(fullSrc);
  }
  return postImageRef.value;
}
</script>
