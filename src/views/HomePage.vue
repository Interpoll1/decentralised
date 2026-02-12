<template>
  <ion-page>
    <ion-header :class="{ 'header-hidden': isHeaderHidden }">
      <ion-toolbar>
        <ion-title class="logo-title">Interpoll</ion-title>
        <ion-buttons slot="end">
          <ion-button @click="$router.push('/profile')">
            <ion-icon :icon="personCircleOutline"></ion-icon>
          </ion-button>
          <ion-button @click="$router.push('/settings')">
            <ion-icon :icon="settingsOutline"></ion-icon>
          </ion-button>
          <ion-button @click="$router.push('/chain-explorer')">
            <ion-icon :icon="cube"></ion-icon>
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content :scroll-events="true" @ionScroll="handleScroll">
      <!-- HOME TAB - Random Posts Feed -->
      <div v-if="activeTab === 'home'" class="home-tab">
        <!-- Loading Posts -->
        <div v-if="isLoadingPosts" class="loading-container">
          <ion-spinner></ion-spinner>
          <p>Loading content...</p>
        </div>

        <!-- Combined Feed -->
        <!-- Combined Feed -->
<div v-else-if="combinedFeed.length > 0" class="feed-list">
  <template v-for="item in combinedFeed" :key="`${item.type}-${item.data.id}`">
    <!-- Post Card -->
    <PostCard 
      v-if="item.type === 'post'"
      :post="item.data"
      :community-name="getCommunityName(item.data.communityId)"
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
      :community-name="getCommunityName(item.data.communityId)"
      @click="navigateToPoll(item.data)"
      @vote="navigateToPoll(item.data)"
    />
  </template>
  
  <!-- ADD INFINITE SCROLL HERE -->
  <ion-infinite-scroll
    :disabled="!hasMore"
    @ionInfinite="onInfiniteScroll"
  >
    <ion-infinite-scroll-content loading-spinner="bubbles" />
  </ion-infinite-scroll>
</div>

<!-- Empty State -->
<div v-else class="empty-state">
  <ion-icon :icon="documentTextOutline" size="large"></ion-icon>
  <p>No content yet</p>
  <p class="subtitle">Join a community and create the first post or poll!</p>
</div>
</div>

      <!-- COMMUNITIES TAB -->
      <div v-else-if="activeTab === 'communities'" class="communities-tab">
        <!-- Create Community Button -->
        <div class="section-padding">
          <ion-button expand="block" @click="$router.push('/create-community')">
            <ion-icon slot="start" :icon="addCircleOutline"></ion-icon>
            Create Community
          </ion-button>
        </div>

        <!-- Filter Buttons -->
        <div class="section-padding">
          <ion-segment v-model="communityFilter">
            <ion-segment-button value="all">
              <ion-label>All</ion-label>
            </ion-segment-button>
            <ion-segment-button value="joined">
              <ion-label>Joined</ion-label>
            </ion-segment-button>
          </ion-segment>
        </div>

        <!-- Loading Communities -->
        <div v-if="communityStore.isLoading" class="loading-container">
          <ion-spinner></ion-spinner>
          <p>Loading communities...</p>
        </div>

        <!-- Communities List -->
        <div v-else-if="displayedCommunities.length > 0" class="communities-list">
          <CommunityCard 
            v-for="community in displayedCommunities" 
            :key="community.id"
            :community="community"
            @click="$router.push(`/community/${community.id}`)"
          />
        </div>

        <!-- Empty State -->
        <div v-else class="empty-state">
          <ion-icon :icon="earthOutline" size="large"></ion-icon>
          <p>{{ communityFilter === 'joined' ? 'No joined communities' : 'No communities yet' }}</p>
          <ion-button @click="communityFilter === 'joined' ? communityFilter = 'all' : $router.push('/create-community')">
            {{ communityFilter === 'joined' ? 'Browse All' : 'Create the first one!' }}
          </ion-button>
        </div>
      </div>

      <!-- CREATE TAB -->
      <div v-else-if="activeTab === 'create'" class="create-tab">
        <div class="create-layout">
          <!-- Main Create Options -->
          <div class="create-main">
            <div class="section-padding">
              <h2>Create Content</h2>
              <p class="subtitle">What would you like to create?</p>
            </div>

            <!-- Create Options -->
            <div class="create-options">
              <div class="create-option-item" @click="$router.push('/create-community')">
                <ion-icon :icon="peopleOutline" color="primary"></ion-icon>
                <div class="option-content">
                  <h3>Create Community</h3>
                  <p>Start a new community for discussions</p>
                </div>
                <ion-icon :icon="chevronForwardOutline" class="chevron"></ion-icon>
              </div>

              <div class="create-option-item" @click="showPostOptions">
                <ion-icon :icon="documentTextOutline" color="secondary"></ion-icon>
                <div class="option-content">
                  <h3>Create Post</h3>
                  <p>Share content in a community</p>
                </div>
                <ion-icon :icon="chevronForwardOutline" class="chevron"></ion-icon>
              </div>

              <div class="create-option-item" @click="showPollOptions">
                <ion-icon :icon="statsChartOutline" color="tertiary"></ion-icon>
                <div class="option-content">
                  <h3>Create Poll</h3>
                  <p>Ask the community a question</p>
                </div>
                <ion-icon :icon="chevronForwardOutline" class="chevron"></ion-icon>
              </div>
            </div>
          </div>

          <!-- Recent Communities Sidebar (Desktop) -->
          <div v-if="joinedCommunities.length > 0" class="recent-communities-sidebar">
            <div class="section-padding">
              <h3>Your Communities</h3>
              <p class="subtitle">Quick access to post</p>
              
              <div class="quick-communities">
                <ion-chip 
                  v-for="community in joinedCommunities.slice(0, 10)" 
                  :key="community.id"
                  @click="$router.push(`/community/${community.id}/create-post`)"
                >
                  <ion-icon :icon="peopleOutline"></ion-icon>
                  <ion-label>{{ community.displayName }}</ion-label>
                </ion-chip>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Bottom spacing for tab bar -->
      <div class="bottom-spacing"></div>
    </ion-content>

    <!-- Professional Bottom Navigation Bar -->
    <div class="bottom-nav" :class="{ 'bottom-nav-hidden': isTabBarHidden }">
      <button 
        class="nav-item" 
        :class="{ active: activeTab === 'home' }"
        @click="activeTab = 'home'"
      >
        <ion-icon :icon="activeTab === 'home' ? home : homeOutline"></ion-icon>
        <span>Home</span>
      </button>
      
      <button 
        class="nav-item" 
        :class="{ active: activeTab === 'communities' }"
        @click="activeTab = 'communities'"
      >
        <ion-icon :icon="activeTab === 'communities' ? people : peopleOutline"></ion-icon>
        <span>Communities</span>
      </button>
      
      <button 
        class="nav-item" 
        :class="{ active: activeTab === 'create' }"
        @click="activeTab = 'create'"
      >
        <ion-icon :icon="activeTab === 'create' ? addCircle : addCircleOutline"></ion-icon>
        <span>Create</span>
      </button>

    </div>

  </ion-page>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import {
  IonPage, IonHeader, IonToolbar, IonTitle, IonContent,
  IonButtons, IonButton, IonIcon, IonCard, IonCardContent,
  IonSegment, IonSegmentButton, IonLabel, IonSpinner, IonChip,
  IonInfiniteScroll, IonInfiniteScrollContent,
  actionSheetController, toastController
} from '@ionic/vue';
import {
  cube, personCircleOutline, settingsOutline, addCircleOutline,
  earthOutline, peopleOutline, home, homeOutline, documentTextOutline,
  refreshOutline, chevronForwardOutline, people, addCircle, statsChartOutline
} from 'ionicons/icons';
import { useRouter } from 'vue-router';
import { useChainStore } from '../stores/chainStore';
import { useCommunityStore } from '../stores/communityStore';
import { usePostStore } from '../stores/postStore';
import { usePollStore } from '../stores/pollStore';
import CommunityCard from '../components/CommunityCard.vue';
import PostCard from '../components/PostCard.vue';
import PollCard from '../components/PollCard.vue';
import { Post } from '../services/postService';
import { Poll } from '../services/pollService';

const router = useRouter();
const chainStore = useChainStore();
const communityStore = useCommunityStore();
const postStore = usePostStore();
const pollStore = usePollStore();

const activeTab = ref('home');
const communityFilter = ref('all');
const isLoadingPosts = ref(false);
const voteVersion = ref(0);
const isHeaderHidden = ref(false);
const isTabBarHidden = ref(false);
let lastScrollTop = 0;
const scrollThreshold = 50;

// ─── Computed ──────────────────────────────────────────────────────────────

const displayedCommunities = computed(() => {
  if (communityFilter.value === 'joined') {
    return communityStore.communities.filter(c => communityStore.isJoined(c.id));
  }
  return communityStore.communities;
});

const combinedFeed = computed(() => {
  const items: Array<{ type: 'post' | 'poll'; data: any; createdAt: number }> = [];
  postStore.visiblePosts.forEach(post => {
    items.push({ type: 'post', data: post, createdAt: post.createdAt });
  });
  pollStore.visiblePolls.forEach(poll => {
    if (!poll.isPrivate) items.push({ type: 'poll', data: poll, createdAt: poll.createdAt });
  });
  return items.sort((a, b) => b.createdAt - a.createdAt);
});

const hasMore = computed(() => postStore.hasMorePosts || pollStore.hasMorePolls);

const joinedCommunities = computed(() =>
  communityStore.communities.filter(c => communityStore.isJoined(c.id))
);

// ─── Scroll ────────────────────────────────────────────────────────────────

function handleScroll(event: CustomEvent) {
  const scrollTop = event.detail.scrollTop;
  if (scrollTop > lastScrollTop && scrollTop > scrollThreshold) {
    isTabBarHidden.value = true;
    isHeaderHidden.value = true;
  } else if (scrollTop < lastScrollTop) {
    isTabBarHidden.value = false;
    isHeaderHidden.value = false;
  }
  lastScrollTop = scrollTop;
}

// ─── Infinite scroll ───────────────────────────────────────────────────────

async function onInfiniteScroll(event: any) {
  postStore.loadMorePosts();
  pollStore.loadMorePolls();
  await new Promise(r => setTimeout(r, 100));
  event.target.complete();
}

// ─── Voting ────────────────────────────────────────────────────────────────

function hasUpvoted(postId: string): boolean {
  voteVersion.value;
  return JSON.parse(localStorage.getItem('upvoted-posts') || '[]').includes(postId);
}

function hasDownvoted(postId: string): boolean {
  voteVersion.value;
  return JSON.parse(localStorage.getItem('downvoted-posts') || '[]').includes(postId);
}

async function handleUpvote(post: Post) {
  try {
    if (hasUpvoted(post.id)) {
      const filtered = JSON.parse(localStorage.getItem('upvoted-posts') || '[]')
        .filter((id: string) => id !== post.id);
      localStorage.setItem('upvoted-posts', JSON.stringify(filtered));
      voteVersion.value++;
      await postStore.removeUpvote(post.id);
      const t = await toastController.create({ message: 'Upvote removed', duration: 1500, color: 'medium' });
      await t.present();
    } else {
      const downvoted = JSON.parse(localStorage.getItem('downvoted-posts') || '[]');
      if (downvoted.includes(post.id)) {
        localStorage.setItem('downvoted-posts', JSON.stringify(downvoted.filter((id: string) => id !== post.id)));
        await postStore.removeDownvote(post.id);
      }
      const upvoted = JSON.parse(localStorage.getItem('upvoted-posts') || '[]');
      localStorage.setItem('upvoted-posts', JSON.stringify([...upvoted, post.id]));
      voteVersion.value++;
      await postStore.upvotePost(post.id);
      const t = await toastController.create({ message: 'Upvoted', duration: 1500, color: 'success' });
      await t.present();
    }
  } catch {
    voteVersion.value++;
    const t = await toastController.create({ message: 'Failed to upvote', duration: 2000, color: 'danger' });
    await t.present();
  }
}

async function handleDownvote(post: Post) {
  try {
    if (hasDownvoted(post.id)) {
      const filtered = JSON.parse(localStorage.getItem('downvoted-posts') || '[]')
        .filter((id: string) => id !== post.id);
      localStorage.setItem('downvoted-posts', JSON.stringify(filtered));
      voteVersion.value++;
      await postStore.removeDownvote(post.id);
      const t = await toastController.create({ message: 'Downvote removed', duration: 1500, color: 'medium' });
      await t.present();
    } else {
      const upvoted = JSON.parse(localStorage.getItem('upvoted-posts') || '[]');
      if (upvoted.includes(post.id)) {
        localStorage.setItem('upvoted-posts', JSON.stringify(upvoted.filter((id: string) => id !== post.id)));
        await postStore.removeUpvote(post.id);
      }
      const downvoted = JSON.parse(localStorage.getItem('downvoted-posts') || '[]');
      localStorage.setItem('downvoted-posts', JSON.stringify([...downvoted, post.id]));
      voteVersion.value++;
      await postStore.downvotePost(post.id);
      const t = await toastController.create({ message: 'Downvoted', duration: 1500, color: 'warning' });
      await t.present();
    }
  } catch {
    voteVersion.value++;
    const t = await toastController.create({ message: 'Failed to downvote', duration: 2000, color: 'danger' });
    await t.present();
  }
}

// ─── Navigation ────────────────────────────────────────────────────────────

function getCommunityName(communityId: string): string {
  return communityStore.communities.find(c => c.id === communityId)?.displayName || communityId;
}

function navigateToPost(post: Post) {
  router.push(`/community/${post.communityId}/post/${post.id}`);
}

function navigateToPoll(poll: Poll) {
  router.push(`/community/${poll.communityId}/poll/${poll.id}`);
}

// ─── Community subscription management ────────────────────────────────────

// Track which communities have had post/poll subscriptions started here.
// Separate from postStore/pollStore's own tracking — this lets us detect
// communities that arrive AFTER the first loadAllPosts() call and subscribe
// to them incrementally as the live Gun subscription delivers them.
const subscribedFromHome = new Set<string>();

async function subscribeNewCommunities(communities: typeof communityStore.communities) {
  const newOnes = communities.filter(c => !subscribedFromHome.has(c.id));
  if (newOnes.length === 0) return;

  // Mark immediately to prevent duplicate calls from rapid watcher fires
  newOnes.forEach(c => subscribedFromHome.add(c.id));

  // Only show loading spinner for the very first batch
  if (subscribedFromHome.size === newOnes.length) isLoadingPosts.value = true;

  try {
    await Promise.all(
      newOnes.flatMap(community => [
        postStore.loadPostsForCommunity(community.id),
        pollStore.loadPollsForCommunity(community.id),
      ])
    );
  } catch (error) {
    console.error('[HomePage] Error subscribing to communities:', error);
  } finally {
    isLoadingPosts.value = false;
  }
}

async function showPostOptions() {
  if (joinedCommunities.value.length > 0) {
    const actionSheet = await actionSheetController.create({
      header: 'Select Community',
      buttons: [
        ...joinedCommunities.value.slice(0, 10).map(community => ({
          text: community.displayName,
          handler: () => router.push(`/community/${community.id}/create-post`),
        })),
        { text: 'Cancel', role: 'cancel' },
      ],
    });
    await actionSheet.present();
  } else {
    activeTab.value = 'communities';
  }
}

async function showPollOptions() {
  if (joinedCommunities.value.length > 0) {
    const actionSheet = await actionSheetController.create({
      header: 'Select Community',
      buttons: [
        ...joinedCommunities.value.slice(0, 10).map(community => ({
          text: community.displayName,
          handler: () => router.push(`/create-poll?communityId=${community.id}`),
        })),
        { text: 'Cancel', role: 'cancel' },
      ],
    });
    await actionSheet.present();
  } else {
    activeTab.value = 'communities';
  }
}

// ─── Watchers ──────────────────────────────────────────────────────────────

// FIX: Watch the entire communities array with deep:true, not just .length.
//
// OLD: watch(communities.length, (new, old) => { if (new > 0 && old === 0) })
//   → fired ONCE when the first community from localStorage cache arrived
//   → communities arriving later from the relay (not yet cached) were missed
//   → only c-cars got a subscription; c-programming etc. only got subscribed
//     when user manually visited CommunityPage, and disappeared on refresh
//
// NEW: fires on every array mutation (push from live .on() subscription)
//   → subscribeNewCommunities() is idempotent — skips already-subscribed ones
//   → communities arriving 1200ms late from relay still get subscriptions
watch(
  () => communityStore.communities,
  (communities) => { subscribeNewCommunities(communities); },
  { deep: true }
);

// When returning to home tab: just reset visible slice.
// Subscriptions are alive; no reload needed.
watch(activeTab, (newTab) => {
  if (newTab === 'home') {
    postStore.resetVisibleCount();
    pollStore.resetVisibleCount();
  }
});

// ─── Lifecycle ─────────────────────────────────────────────────────────────

onMounted(async () => {
  await chainStore.initialize();
  // loadCommunities() starts the live Gun .on() subscription (once only).
  // The communities watcher above then drives subscribeNewCommunities()
  // for every community that arrives — cached or relay-delayed.
  await communityStore.loadCommunities();
});
</script>


<style scoped>

@import url('https://fonts.googleapis.com/css2?family=Grand+Hotel&display=swap');

.logo-title {
  font-family: 'Grand Hotel', cursive;
  font-size: 34px;
  letter-spacing: 0.5px;
  
  
}
.home-tab h2 {
  margin: 0;
  font-size: 24px;
  font-weight: 600;
}
ion-header {
  transition: transform 0.3s ease;
}

ion-header.header-hidden {
  transform: translateY(-100%);
}

.subtitle {
  margin: 4px 0 0 0;
  color: var(--ion-color-medium);
  font-size: 14px;
}

.section-padding {
  padding: 16px;
}

.loading-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 24px;
}

.loading-container p {
  margin-top: 16px;
  color: var(--ion-color-medium);
}

.communities-list {
  padding: 0;
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
  margin: 8px 0;
}

.bottom-spacing {
  height: 70px;
}

/* Create Tab Layout */
.create-layout {
  display: flex;
  flex-direction: column;
}

.create-main {
  flex: 1;
}

.create-main h2 {
  margin: 0;
  font-size: 24px;
  font-weight: 600;
}

/* Create Options - Simplified */
.create-options {
  display: flex;
  flex-direction: column;
  gap: 0;
  padding: 0 16px;
}

.create-option-item {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px 0;
  cursor: pointer;
  border-bottom: 1px solid rgba(var(--ion-text-color-rgb), 0.08);
}

.create-option-item:last-child {
  border-bottom: none;
}

.create-option-item > ion-icon:first-child {
  font-size: 32px;
  flex-shrink: 0;
}

.option-content {
  flex: 1;
}

.option-content h3 {
  margin: 0 0 4px 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--ion-text-color);
}

.option-content p {
  margin: 0;
  font-size: 13px;
  color: var(--ion-color-medium);
}

.create-option-item .chevron {
  font-size: 20px;
  color: var(--ion-color-medium);
  flex-shrink: 0;
}

/* Recent Communities */
.recent-communities-sidebar {
  display: none;
}

.quick-communities {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}

.quick-communities h3 {
  margin: 0 0 4px 0;
  font-size: 16px;
  font-weight: 600;
}

/* Desktop Layout */
@media (min-width: 768px) {
  .create-layout {
    flex-direction: row;
    gap: 24px;
    max-width: 1200px;
    margin: 0 auto;
    padding: 0 24px;
  }

  .create-main {
    flex: 2;
    max-width: 600px;
  }

  .recent-communities-sidebar {
    display: block;
    flex: 1;
    max-width: 300px;
    position: sticky;
    top: 16px;
    align-self: flex-start;
  }

  .recent-communities-sidebar .section-padding {
    padding: 16px;
    background: rgba(var(--ion-text-color-rgb), 0.02);
    border: 1px solid rgba(var(--ion-text-color-rgb), 0.08);
    border-radius: 12px;
  }

  .recent-communities-sidebar h3 {
    margin: 0 0 4px 0;
    font-size: 16px;
    font-weight: 600;
  }
}

/* Professional Bottom Navigation Bar */
.bottom-nav {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  display: flex;
  justify-content: space-around;
  align-items: center;
  background: var(--ion-background-color);
  border-top: 1px solid rgba(var(--ion-text-color-rgb), 0.1);
  padding: 8px 0 calc(8px + env(safe-area-inset-bottom));
  z-index: 1000;
  transition: transform 0.3s ease;
  box-shadow: 0 -2px 10px rgba(0, 0, 0, 0.05);
}

.bottom-nav-hidden {
  transform: translateY(100%);
}

.nav-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  background: none;
  border: none;
  padding: 2px 4px;
  cursor: pointer;
  color: var(--ion-color-medium);
  transition: all 0.2s ease;
  position: relative;
  flex: 1;
  max-width: 120px;
}

.nav-item ion-icon {
  font-size: 18px;
  transition: all 0.2s ease;
}

.nav-item span {
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.3px;
  transition: all 0.2s ease;
}

.nav-item.active {
  color: var(--ion-color-primary);
}

.nav-item.active ion-icon {
  transform: scale(1.1);
}

.nav-item.active span {
  font-weight: 600;
}

/* Active indicator */
.nav-item.active::before {
  content: '';
  position: absolute;
  top: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 32px;
  height: 3px;
  background: var(--ion-color-primary);
  border-radius: 0 0 3px 3px;
}

ion-list {
  background: transparent;
}

ion-item {
  --background: transparent;
}
</style>








