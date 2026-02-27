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
        <div class="community-top">
          <div class="community-info">
            <h1>{{ community.displayName }}</h1>
            <p class="community-id">{{ community.id }}</p>
          </div>
          <ion-button
            :color="isJoined ? 'medium' : 'primary'"
            shape="round"
            size="small"
            @click="toggleJoin"
          >
            <ion-icon slot="start" :icon="isJoined ? checkmarkCircleOutline : addCircleOutline"></ion-icon>
            {{ isJoined ? 'Joined' : 'Join' }}
          </ion-button>
        </div>

        <p class="description">{{ community.description }}</p>

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

        <div class="button-row" v-if="isJoined">
          <ion-button
            size="small"
            @click="$router.push(`/community/${communityId}/create-post`)"
          >
            <ion-icon slot="start" :icon="createOutline"></ion-icon>
            Create Post
          </ion-button>
          <ion-button
            size="small"
            @click="$router.push(`/create-poll?communityId=${communityId}`)"
          >
            <ion-icon slot="start" :icon="statsChartOutline"></ion-icon>
            Create Poll
          </ion-button>
        </div>
      </div>

      
      <!-- Content Filter -->
      <div class="content-filter">
        <button
          class="tab-btn"
          :class="{ active: contentFilter === 'all' }"
          @click="contentFilter = 'all'"
        >All</button>
        <button
          class="tab-btn"
          :class="{ active: contentFilter === 'posts' }"
          @click="contentFilter = 'posts'"
        >Posts</button>
        <button
          class="tab-btn"
          :class="{ active: contentFilter === 'polls' }"
          @click="contentFilter = 'polls'"
        >Polls</button>
      </div>

      <!-- Loading -->
      <div v-if="isLoading" class="loading-container">
        <ion-spinner></ion-spinner>
        <p>Loading content...</p>
      </div>

      <!-- Content Feed -->
      <div v-else-if="displayedContent.length > 0" class="content-feed">
        <template v-for="item in displayedContent" :key="`${item.type}-${item.data.id}`">
          <PostCard
            v-if="item.type === 'post'"
            :post="item.data"
            :community-name="community?.displayName"
            :has-upvoted="hasUpvoted(item.data.id)"
            :has-downvoted="hasDownvoted(item.data.id)"
            :flagged="item.flagged"
            :filter-action="currentModSettings.wordFilterAction"
            @click="navigateToPost(item.data)"
            @upvote="handleUpvote(item.data)"
            @downvote="handleDownvote(item.data)"
            @comments="navigateToPost(item.data)"
          />
          <PollCard
            v-else-if="item.type === 'poll'"
            :poll="item.data"
            :flagged="item.flagged"
            :filter-action="currentModSettings.wordFilterAction"
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
      <div v-if="community?.rules?.length > 0" class="rules-section">
        <h3>Community Rules</h3>
        <ol class="rules-list">
          <li v-for="(rule, index) in community.rules" :key="index">{{ rule }}</li>
        </ol>
      </div>
     
    </ion-content>
  </ion-page>
</template>

<style scoped>
/* ── Header ─────────────────────────────────────── */
.community-header {
  padding: 16px 16px 0;
  border-bottom: 1px solid rgba(var(--ion-text-color-rgb), 0.08);
}

.community-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}

.community-info h1 {
  margin: 0 0 2px;
  font-size: 22px;
  font-weight: 700;
}

.community-id {
  margin: 0;
  font-size: 13px;
  color: var(--ion-color-medium);
}

.description {
  margin: 0 0 12px;
  font-size: 14px;
  line-height: 1.5;
  color: var(--ion-color-step-600);
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.community-stats {
  display: flex;
  gap: 20px;
  margin-bottom: 14px;
}

.stat {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--ion-color-medium);
}

.stat ion-icon {
  font-size: 16px;
}

.button-row {
  display: flex;
  gap: 8px;
  margin-bottom: 14px;
}

/* ── Filter ──────────────────────────────────────── */
.content-filter {
  display: flex;
  position: sticky;
  top: 0;
  z-index: 10;
  background: rgba(var(--ion-card-background-rgb), 0.22);
  backdrop-filter: blur(10px) saturate(1.4);
  -webkit-backdrop-filter: blur(10px) saturate(1.4);
  border-bottom: 1px solid rgba(var(--ion-text-color-rgb), 0.08);
}

.tab-btn {
  flex: 1;
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  padding: 12px 0;
  font-size: 14px;
  font-weight: 500;
  color: var(--ion-color-medium);
  cursor: pointer;
  transition: color 0.2s, border-color 0.2s;
  letter-spacing: 0.01em;
}

.tab-btn.active {
  color: var(--ion-color-primary);
  border-bottom-color: var(--ion-color-primary);
  font-weight: 700;
}

/* ── Loading / Empty ─────────────────────────────── */
.loading-container,
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 64px 24px;
  text-align: center;
}

.loading-container p,
.empty-state p {
  color: var(--ion-color-medium);
  margin: 12px 0 16px;
}

.empty-state ion-icon {
  color: var(--ion-color-medium);
}

/* ── Rules ───────────────────────────────────────── */
.rules-section {
  padding: 20px 16px;
  border-top: 1px solid rgba(var(--ion-text-color-rgb), 0.08);
  margin-top: 16px;
}

.rules-section h3 {
  margin: 0 0 12px;
  font-size: 16px;
  font-weight: 600;
}

.rules-list {
  margin: 0;
  padding-left: 20px;
}

.rules-list li {
  margin-bottom: 10px;
  font-size: 14px;
  line-height: 1.5;
  color: var(--ion-color-step-600);
}

.rules-list li:last-child {
  margin-bottom: 0;
}
</style>

<script setup lang="ts">
import { ref, computed, onMounted, watchEffect } from 'vue';
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
import { ModerationService, moderationVersion } from '../services/moderationService';

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

const currentModSettings = computed(() => {
  moderationVersion.value;
  return ModerationService.getSettings();
});

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

// Pre-fetch author profiles outside computed to avoid side-effects
watchEffect(() => {
  const authorIds = new Set([
    ...communityPosts.value.map(p => p.authorId),
    ...communityPolls.value.map(p => p.authorId),
  ]);
  for (const id of authorIds) {
    if (id && userStore.getCachedKarma(id) === null) {
      userStore.getProfile(id);
    }
  }
});

// Combined and filtered content
const displayedContent = computed(() => {
  moderationVersion.value; // reactive dependency on moderation settings
  const items: Array<{type: 'post' | 'poll', data: any, createdAt: number, flagged: boolean}> = [];
  const settings = ModerationService.getSettings();
  
  if (contentFilter.value === 'all' || contentFilter.value === 'posts') {
    communityPosts.value.forEach(post => {
      const textToCheck = `${post.title || ''} ${post.content || ''}`;
      const filterResult = ModerationService.checkContent(textToCheck);

      // Word filter — hide mode removes from list
      if (filterResult.flagged && settings.wordFilterAction === 'hide') return;

      // Score filter
      if (post.score !== undefined && post.score < settings.minContentScore) return;

      // Karma filter
      if (post.authorId) {
        const cached = userStore.getCachedKarma(post.authorId);
        if (ModerationService.shouldHideByKarma(cached)) return;
      }

      items.push({ type: 'post', data: post, createdAt: post.createdAt, flagged: filterResult.flagged });
    });
  }
  
  if (contentFilter.value === 'all' || contentFilter.value === 'polls') {
    communityPolls.value.forEach(poll => {
      const textToCheck = `${poll.question || ''} ${poll.description || ''}`;
      const filterResult = ModerationService.checkContent(textToCheck);

      if (filterResult.flagged && settings.wordFilterAction === 'hide') return;

      if (poll.authorId) {
        const cached = userStore.getCachedKarma(poll.authorId);
        if (ModerationService.shouldHideByKarma(cached)) return;
      }

      items.push({ type: 'poll', data: poll, createdAt: poll.createdAt, flagged: filterResult.flagged });
    });
  }

  return items.sort((a, b) => b.createdAt - a.createdAt);
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
  router.push(`/post/${post.id}`);
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

