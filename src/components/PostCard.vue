<!-- src/components/PostCard.vue -->
<template>
  <ion-card class="post-card" @click="openPost">
    <!-- Community & Author Info -->
    <div class="post-header">
      <div class="community-info">
        <strong>{{ post.communityId }}</strong>
        <span class="separator">•</span>
        <span class="author">u/{{ post.authorName }}</span>
        <span class="separator">•</span>
        <span class="time">{{ formatTime(post.createdAt) }}</span>
      </div>
    </div>

    <!-- Post Content -->
    <ion-card-header>
      <ion-card-title>{{ post.title }}</ion-card-title>
    </ion-card-header>

    <ion-card-content>
      <p class="post-content">{{ post.content }}</p>
      
      <!-- Image Thumbnail -->
      <img 
        v-if="post.imageThumbnail" 
        :src="post.imageThumbnail" 
        class="post-thumbnail"
        @click.stop="viewFullImage"
      />
    </ion-card-content>

    <!-- Vote & Actions Bar -->
    <div class="post-actions">
      <div class="vote-buttons">
        <ion-button 
          size="small" 
          fill="clear" 
          @click.stop="vote('up')"
          :color="hasUpvoted ? 'primary' : 'medium'"
        >
          <ion-icon :icon="arrowUp"></ion-icon>
        </ion-button>
        <span class="score" :class="scoreClass">{{ post.score }}</span>
        <ion-button 
          size="small" 
          fill="clear" 
          @click.stop="vote('down')"
          :color="hasDownvoted ? 'danger' : 'medium'"
        >
          <ion-icon :icon="arrowDown"></ion-icon>
        </ion-button>
      </div>

      <ion-button size="small" fill="clear">
        <ion-icon :icon="chatbubbleOutline"></ion-icon>
        {{ post.commentCount }} Comments
      </ion-button>

      <ion-button size="small" fill="clear">
        <ion-icon :icon="shareOutline"></ion-icon>
        Share
      </ion-button>
    </div>
  </ion-card>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useRouter } from 'vue-router';
import { IonCard, IonCardHeader, IonCardTitle, IonCardContent, IonButton, IonIcon } from '@ionic/vue';
import { arrowUp, arrowDown, chatbubbleOutline, shareOutline } from 'ionicons/icons';
import { Post } from '../services/postService';

const props = defineProps<{ post: Post }>();
const router = useRouter();

const hasUpvoted = ref(false);
const hasDownvoted = ref(false);

const scoreClass = computed(() => ({
  'positive': props.post.score > 0,
  'negative': props.post.score < 0
}));

const formatTime = (timestamp: number) => {
  const diff = Date.now() - timestamp;
  const hours = Math.floor(diff / (1000 * 60 * 60));
  if (hours < 1) return 'just now';
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
};

const vote = (direction: 'up' | 'down') => {
  // TODO: Implement voting with blockchain
  if (direction === 'up') {
    hasUpvoted.value = !hasUpvoted.value;
    hasDownvoted.value = false;
  } else {
    hasDownvoted.value = !hasDownvoted.value;
    hasUpvoted.value = false;
  }
};

const openPost = () => {
  router.push(`/post/${props.post.id}`);
};

const viewFullImage = () => {
  // TODO: Load full image from IPFS
};
</script>

<style scoped>
.post-card {
  margin-bottom: 8px;
  cursor: pointer;
}

.post-header {
  padding: 12px 16px 0;
}

.community-info {
  font-size: 12px;
  color: var(--ion-color-medium);
}

.separator {
  margin: 0 4px;
}

.post-content {
  font-size: 14px;
  margin-bottom: 12px;
}

.post-thumbnail {
  width: 100%;
  max-height: 400px;
  object-fit: cover;
  border-radius: 8px;
  cursor: pointer;
}

.post-actions {
  display: flex;
  align-items: center;
  padding: 8px;
  border-top: 1px solid var(--ion-color-light);
}

.vote-buttons {
  display: flex;
  align-items: center;
  gap: 4px;
}

.score {
  font-weight: 600;
  min-width: 40px;
  text-align: center;
}

.score.positive {
  color: var(--ion-color-primary);
}

.score.negative {
  color: var(--ion-color-danger);
}
</style>