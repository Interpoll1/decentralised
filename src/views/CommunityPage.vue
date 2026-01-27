<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button default-href="/home"></ion-back-button>
        </ion-buttons>
        <ion-title>{{ community?.displayName || 'Community' }}</ion-title>
        <ion-buttons slot="end">
          <ion-button @click="refreshFeed">
            <ion-icon :icon="refreshOutline"></ion-icon>
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <!-- Community Header -->
      <ion-card v-if="community" class="community-header">
        <ion-card-content>
          <div class="community-info">
            <div>
              <h2>{{ community.displayName }}</h2>
              <p class="community-name">{{ community.id }}</p>
              <p class="description">{{ community.description }}</p>
            </div>
            <ion-button 
              :fill="isJoined ? 'outline' : 'solid'"
              @click="toggleJoin"
            >
              {{ isJoined ? 'Joined' : 'Join' }}
            </ion-button>
          </div>

          <div class="community-stats">
            <div class="stat">
              <strong>{{ community.memberCount }}</strong>
              <span>Members</span>
            </div>
            <div class="stat">
              <strong>{{ community.postCount }}</strong>
              <span>Posts</span>
            </div>
            <div class="stat">
              <strong>{{ formatDate(community.createdAt) }}</strong>
              <span>Created</span>
            </div>
          </div>
        </ion-card-content>
      </ion-card>

      <!-- Create Post Button -->
      <div class="create-post-section ion-padding">
        <ion-button 
          expand="block" 
          @click="createPost"
        >
          <ion-icon slot="start" :icon="addOutline"></ion-icon>
          Create Post
        </ion-button>
      </div>

      <!-- Loading -->
      <div v-if="postStore.isLoading" class="loading-container">
        <ion-spinner></ion-spinner>
        <p>Loading posts...</p>
      </div>

      <!-- Posts Feed -->
      <div v-else-if="posts.length > 0" class="posts-feed">
        <PostCard 
          v-for="post in posts" 
          :key="post.id"
          :post="post"
        />
      </div>

      <!-- Empty State -->
      <div v-else class="empty-state">
        <ion-icon :icon="documentTextOutline" size="large"></ion-icon>
        <p>No posts yet</p>
        <ion-button @click="createPost">
          Be the first to post!
        </ion-button>
      </div>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonButtons,
  IonBackButton,
  IonButton,
  IonCard,
  IonCardContent,
  IonIcon,
  IonSpinner
} from '@ionic/vue';
import { addOutline, refreshOutline, documentTextOutline } from 'ionicons/icons';
import { useCommunityStore } from '../stores/communityStore';
import { usePostStore } from '../stores/postStore';
import PostCard from '../components/PostCard.vue';

const route = useRoute();
const router = useRouter();
const communityStore = useCommunityStore();
const postStore = usePostStore();

const communityId = route.params.communityId as string;
const community = computed(() => communityStore.currentCommunity);
const posts = computed(() => postStore.communityPosts);
const isJoined = computed(() => communityStore.isJoined(communityId));

onMounted(async () => {
  // Load community details
  await communityStore.selectCommunity(communityId);
  
  // Load posts for this community
  await postStore.loadPostsForCommunity(communityId);
});

const toggleJoin = async () => {
  if (!isJoined.value) {
    await communityStore.joinCommunity(communityId);
  }
  // TODO: Add leave functionality
};

const createPost = () => {
  router.push(`/community/${communityId}/create-post`);
};

const refreshFeed = async () => {
  await postStore.refreshPosts();
};

const formatDate = (timestamp: number) => {
  return new Date(timestamp).toLocaleDateString();
};
</script>

<style scoped>
.community-header {
  margin: 0;
  border-radius: 0;
}

.community-info {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 16px;
}

.community-name {
  color: var(--ion-color-medium);
  font-size: 14px;
  margin: 4px 0;
}

.description {
  margin-top: 8px;
  font-size: 14px;
  line-height: 1.5;
}

.community-stats {
  display: flex;
  gap: 24px;
  padding-top: 16px;
  border-top: 1px solid var(--ion-color-light);
}

.stat {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.stat strong {
  font-size: 18px;
  color: var(--ion-color-primary);
}

.stat span {
  font-size: 12px;
  color: var(--ion-color-medium);
  margin-top: 4px;
}

.create-post-section {
  background: var(--ion-color-light);
  padding: 12px 16px;
}

.posts-feed {
  padding: 8px;
}

.loading-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px;
  gap: 16px;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px;
  gap: 16px;
  color: var(--ion-color-medium);
}

.empty-state ion-icon {
  font-size: 64px;
  opacity: 0.5;
}
</style>