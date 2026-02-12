<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button default-href="/home"></ion-back-button>
        </ion-buttons>
        <ion-title>{{ community?.displayName || 'Community' }}</ion-title>
        <ion-buttons slot="end">
          <ion-button @click="$router.push('/home')">
            <ion-icon :icon="homeOutline"></ion-icon>
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <!-- Community Header -->
      <div v-if="community" class="community-header">
        <div class="community-info">
          <h1>{{ community.displayName }}</h1>
          <p class="community-id">{{ community.id }}</p>
          <p class="description">{{ community.description }}</p>
        </div>

        <div class="community-stats">
          <div class="stat">
            <ion-icon :icon="peopleOutline"></ion-icon>
            <span>{{ formatNumber(community.memberCount) }} members</span>
          </div>
          <div class="stat">
            <ion-icon :icon="documentTextOutline"></ion-icon>
            <span>{{ totalContentCount }} posts & polls</span>
          </div>
        </div>

        <div class="action-buttons">
          <ion-button 
            expand="block" 
            :color="isJoined ? 'medium' : 'primary'"
            @click="toggleJoin"
          >
            <ion-icon slot="start" :icon="isJoined ? checkmarkCircleOutline : addCircleOutline"></ion-icon>
            {{ isJoined ? 'Joined' : 'Join Community' }}
          </ion-button>

          <div class="button-row" >
            <ion-button  style="background-color: azure;"
              expand="block" 
              fill="outline"
              @click="$router.push(`/community/${communityId}/create-post`)"
              :disabled="!isJoined"
            >
              <ion-icon slot="start" :icon="createOutline"></ion-icon>
              Create Post
            </ion-button>

            <ion-button style="background-color: azure;"
              expand="block" 
              fill="outline"
              @click="$router.push(`/create-poll?communityId=${communityId}`)"
              :disabled="!isJoined"
            >
              <ion-icon slot="start" :icon="statsChartOutline"></ion-icon>
              Create Poll
            </ion-button>
          </div>
        </div>
      </div>

      <!-- Content Filter -->
      <div class="content-filter">
        <ion-segment v-model="contentFilter">
          <ion-segment-button value="all">
            <ion-label>All</ion-label>
          </ion-segment-button>
          <ion-segment-button value="posts">
            <ion-label>Posts</ion-label>
          </ion-segment-button>
          <ion-segment-button value="polls">
            <ion-label>Polls</ion-label>
          </ion-segment-button>
        </ion-segment>
      </div>

      <!-- Loading -->
      <div v-if="isLoading" class="loading-container">
        <ion-spinner></ion-spinner>
        <p>Loading content...</p>
      </div>

      <!-- Content Feed -->
      <div v-else-if="displayedContent.length > 0" class="content-feed">
        <template v-for="item in displayedContent" :key="`${item.type}-${item.data.id}`">
          <!-- Post Card -->
          <PostCard
            v-if="item.type === 'post'"
            :post="item.data"
            :community-name="community?.displayName"
            :has-upvoted="hasUpvoted(item.data.id)"
            :has-downvoted="hasDownvoted(item.data.id)"
            @click="navigateToPost(item.data)"
            @upvote="handleUpvote(item.data)"
            @downvote="handleDownvote(item.data)"
            @comments="navigateToPost(item.data)"
          />
          
          <!-- Poll Card -->
          <PollCard 
            v-else-if="item.type === 'poll'"
            :poll="item.data"
            @click="navigateToPoll(item.data)"
            @vote="navigateToPoll(item.data)"
          />
        </template>
      </div>

      <!-- Empty State -->
      <div v-else class="empty-state">
        <ion-icon :icon="documentTextOutline" size="large"></ion-icon>
        <p v-if="contentFilter === 'posts'">No posts yet</p>
        <p v-else-if="contentFilter === 'polls'">No polls yet</p>
        <p v-else>No content yet</p>
        <ion-button 
          v-if="isJoined"
          @click="contentFilter === 'polls' ? $router.push(`/create-poll?communityId=${communityId}`) : $router.push(`/community/${communityId}/create-post`)"
        >
          Create the first {{ contentFilter === 'polls' ? 'poll' : 'post' }}!
        </ion-button>
        <ion-button v-else @click="toggleJoin">
          Join to create content
        </ion-button>
      </div>

      <!-- Rules Section -->
      <div v-if="community && community.rules && community.rules.length > 0" class="rules-section">
        <div class="rules-header">
          <h3>Community Rules</h3>
        </div>
        <ol class="rules-list">
          <li v-for="(rule, index) in community.rules" :key="index">
            {{ rule }}
          </li>
        </ol>
        <div class="rules-separator"></div>
      </div>
    </ion-content>
  </ion-page>
</template>

<style scoped>
.community-header {
  padding: 24px 16px;
  background: linear-gradient(135deg, var(--ion-color-primary) 0%, var(--ion-color-primary-shade) 100%);
  color: white;
}

.community-info h1 {
  margin: 0 0 4px 0;
  font-size: 28px;
  font-weight: 600;
}

.community-id {
  margin: 0 0 12px 0;
  opacity: 0.9;
  font-size: 14px;
}

.description {
  margin: 0 0 20px 0;
  line-height: 1.5;
  opacity: 0.95;
}

.community-stats {
  display: flex;
  gap: 24px;
  margin-bottom: 20px;
}

.stat {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
}

.stat ion-icon {
  font-size: 18px;
}

.action-buttons {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.button-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.content-filter {
  padding: 12px 16px;
  background: rgba(var(--ion-card-background-rgb), 0.22);
  backdrop-filter: blur(10px) saturate(1.4);
  -webkit-backdrop-filter: blur(10px) saturate(1.4);
  border-bottom: 1px solid rgba(var(--ion-text-color-rgb), 0.08);
  position: sticky;
  top: 0;
  z-index: 10;
}

.loading-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 64px 24px;
}

.loading-container p {
  margin-top: 16px;
  color: var(--ion-color-medium);
}

.content-feed {
  padding: 0;
  margin: 0;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 64px 24px;
  text-align: center;
}

.empty-state ion-icon {
  color: var(--ion-color-medium);
  margin-bottom: 16px;
}

.empty-state p {
  color: var(--ion-color-medium);
  margin: 8px 0 16px 0;
}

.rules-section {
  margin: 24px 0 0 0;
  padding: 16px 0;
  background: transparent;
}

.rules-header {
  padding: 0 16px 12px 16px;
  border-bottom: 1px solid rgba(var(--ion-text-color-rgb), 0.08);
}

.rules-header h3 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: var(--ion-text-color);
}

.rules-list {
  margin: 0;
  padding: 16px 16px 16px 36px;
  list-style-position: outside;
}

.rules-list li {
  margin-bottom: 12px;
  line-height: 1.5;
  color: var(--ion-color-step-600);
}

.rules-list li:last-child {
  margin-bottom: 0;
}

.rules-separator {
  height: 1px;
  background: rgba(var(--ion-text-color-rgb), 0.08);
  margin-top: 16px;
}
</style>

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
  IonIcon,
  IonCard,
  IonCardHeader,
  IonCardTitle,
  IonCardContent,
  IonSegment,
  IonSegmentButton,
  IonLabel,
  IonSpinner,
  toastController
} from '@ionic/vue';
import {
  homeOutline,
  peopleOutline,
  documentTextOutline,
  checkmarkCircleOutline,
  addCircleOutline,
  createOutline,
  statsChartOutline
} from 'ionicons/icons';
import { useCommunityStore } from '../stores/communityStore';
import { usePostStore } from '../stores/postStore';
import { usePollStore } from '../stores/pollStore';
import { useUserStore } from '../stores/userStore';
import { UserService } from '../services/userService';
import PostCard from '../components/PostCard.vue';
import PollCard from '../components/PollCard.vue';
import { Post } from '../services/postService';
import { Poll } from '../services/pollService';

const route = useRoute();
const router = useRouter();
const communityStore = useCommunityStore();
const postStore = usePostStore();
const pollStore = usePollStore();
const userStore = useUserStore();

const communityId = computed(() => route.params.communityId as string);
const community = computed(() => communityStore.currentCommunity);
const isJoined = computed(() => communityStore.isJoined(communityId.value));

const isLoading = ref(false);
const contentFilter = ref<'all' | 'posts' | 'polls'>('all');
const currentUserId = ref('');
const voteVersion = ref(0);

// Get posts and polls for this community
const communityPosts = computed(() => {
  return postStore.posts.filter(p => p.communityId === communityId.value);
});

const communityPolls = computed(() => {
  // Show public polls + private polls authored by the current user
  return pollStore.polls.filter(p =>
    p.communityId === communityId.value &&
    (!p.isPrivate || p.authorId === currentUserId.value)
  );
});

const totalContentCount = computed(() => {
  return communityPosts.value.length + communityPolls.value.length;
});

// Combined and filtered content
const displayedContent = computed(() => {
  const items: Array<{type: 'post' | 'poll', data: any, createdAt: number}> = [];
  
  if (contentFilter.value === 'all' || contentFilter.value === 'posts') {
    communityPosts.value.forEach(post => {
      items.push({ type: 'post', data: post, createdAt: post.createdAt });
    });
  }
  
  if (contentFilter.value === 'all' || contentFilter.value === 'polls') {
    communityPolls.value.forEach(poll => {
      items.push({ type: 'poll', data: poll, createdAt: poll.createdAt });
    });
  }
  
  // Apply user karma filter (hide low-reputation authors locally)
  const minKarma = Number(localStorage.getItem('minUserKarma') || '-1000');

  const filteredByKarma = items.filter((item) => {
    if (minKarma <= -1000) return true; // "Show everyone"

    const authorId = item.data.authorId;
    if (!authorId) return true;

    const cached = userStore.getCachedKarma(authorId);
    if (cached !== null) {
      return cached >= minKarma;
    }

    // No cached profile yet: optimistically include and fetch in background
    userStore.getProfile(authorId);
    return true;
  });

  // Sort by creation date (newest first)
  return filteredByKarma.sort((a, b) => b.createdAt - a.createdAt);
});

function hasUpvoted(postId: string): boolean {
  voteVersion.value; // reactive dependency to trigger re-render on vote changes
  const votedPosts = JSON.parse(localStorage.getItem('upvoted-posts') || '[]');
  return votedPosts.includes(postId);
}

function hasDownvoted(postId: string): boolean {
  voteVersion.value; // reactive dependency to trigger re-render on vote changes
  const votedPosts = JSON.parse(localStorage.getItem('downvoted-posts') || '[]');
  return votedPosts.includes(postId);
}

async function handleUpvote(post: Post) {
  try {
    if (hasUpvoted(post.id)) {
      // Remove from localStorage first (optimistic UI)
      const votedPosts = JSON.parse(localStorage.getItem('upvoted-posts') || '[]');
      const filtered = votedPosts.filter((id: string) => id !== post.id);
      localStorage.setItem('upvoted-posts', JSON.stringify(filtered));
      voteVersion.value++;

      await postStore.removeUpvote(post.id);

      const toast = await toastController.create({
        message: 'Upvote removed',
        duration: 1500,
        color: 'medium'
      });
      await toast.present();
    } else {
      // Clear downvote from localStorage first if needed
      const downvotedPosts = JSON.parse(localStorage.getItem('downvoted-posts') || '[]');
      if (downvotedPosts.includes(post.id)) {
        const filtered = downvotedPosts.filter((id: string) => id !== post.id);
        localStorage.setItem('downvoted-posts', JSON.stringify(filtered));
      }

      // Add to upvoted localStorage
      const votedPosts = JSON.parse(localStorage.getItem('upvoted-posts') || '[]');
      votedPosts.push(post.id);
      localStorage.setItem('upvoted-posts', JSON.stringify(votedPosts));
      voteVersion.value++;

      // Clear existing downvote in store if needed
      if (downvotedPosts.includes(post.id)) {
        await postStore.removeDownvote(post.id);
      }
      await postStore.upvotePost(post.id);

      const toast = await toastController.create({
        message: 'Upvoted',
        duration: 1500,
        color: 'success'
      });
      await toast.present();
    }
  } catch (error) {
    voteVersion.value++;
    console.error('Error upvoting:', error);
    const toast = await toastController.create({
      message: 'Failed to upvote',
      duration: 2000,
      color: 'danger'
    });
    await toast.present();
  }
}

async function handleDownvote(post: Post) {
  try {
    if (hasDownvoted(post.id)) {
      // Remove from localStorage first (optimistic UI)
      const votedPosts = JSON.parse(localStorage.getItem('downvoted-posts') || '[]');
      const filtered = votedPosts.filter((id: string) => id !== post.id);
      localStorage.setItem('downvoted-posts', JSON.stringify(filtered));
      voteVersion.value++;

      await postStore.removeDownvote(post.id);

      const toast = await toastController.create({
        message: 'Downvote removed',
        duration: 1500,
        color: 'medium'
      });
      await toast.present();
    } else {
      // Clear upvote from localStorage first if needed
      const upvotedPosts = JSON.parse(localStorage.getItem('upvoted-posts') || '[]');
      if (upvotedPosts.includes(post.id)) {
        const filtered = upvotedPosts.filter((id: string) => id !== post.id);
        localStorage.setItem('upvoted-posts', JSON.stringify(filtered));
      }

      // Add to downvoted localStorage
      const votedPosts = JSON.parse(localStorage.getItem('downvoted-posts') || '[]');
      votedPosts.push(post.id);
      localStorage.setItem('downvoted-posts', JSON.stringify(votedPosts));
      voteVersion.value++;

      // Clear existing upvote in store if needed
      if (upvotedPosts.includes(post.id)) {
        await postStore.removeUpvote(post.id);
      }
      await postStore.downvotePost(post.id);

      const toast = await toastController.create({
        message: 'Downvoted',
        duration: 1500,
        color: 'warning'
      });
      await toast.present();
    }
  } catch (error) {
    voteVersion.value++;
    console.error('Error downvoting:', error);
    const toast = await toastController.create({
      message: 'Failed to downvote',
      duration: 2000,
      color: 'danger'
    });
    await toast.present();
  }
}

function formatNumber(num: number | undefined | null): string {
  const n = num ?? 0;
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return n.toString();
}

function navigateToPost(post: Post) {
  router.push(`/community/${post.communityId}/post/${post.id}`);
}

function navigateToPoll(poll: Poll) {
  router.push(`/community/${poll.communityId}/poll/${poll.id}`);
}

async function toggleJoin() {
  if (isJoined.value) {
    // Leave is not yet implemented
  } else {
    await communityStore.joinCommunity(communityId.value);
  }
}

async function loadCommunityContent() {
  isLoading.value = true;

  try {
    // Load current user for private poll filtering
    try {
      const user = await UserService.getCurrentUser();
      currentUserId.value = user.id;
    } catch {
      // Not critical
    }

    // Select the community
    await communityStore.selectCommunity(communityId.value);

    // Load posts and polls for this community
    await Promise.all([
      postStore.loadPostsForCommunity(communityId.value),
      pollStore.loadPollsForCommunity(communityId.value)
    ]);

  } catch (error) {
    console.error('Error loading community content:', error);
  } finally {
    isLoading.value = false;
  }
}

onMounted(async () => {
  await loadCommunityContent();
});
</script>

