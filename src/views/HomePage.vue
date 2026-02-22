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
      <div class="page-layout">

        <!-- ── LEFT NAV (desktop only) ─────────────────── -->
        <nav class="side-nav">
          <button
            class="side-nav-item"
            :class="{ active: activeTab === 'home' }"
            @click="activeTab = 'home'"
          >
            <ion-icon :icon="activeTab === 'home' ? home : homeOutline"></ion-icon>
            <span>Home</span>
          </button>
          <button
            class="side-nav-item"
            :class="{ active: activeTab === 'communities' }"
            @click="activeTab = 'communities'"
          >
            <ion-icon :icon="activeTab === 'communities' ? people : peopleOutline"></ion-icon>
            <span>Communities</span>
          </button>
          <button
            class="side-nav-item"
            :class="{ active: activeTab === 'create' }"
            @click="activeTab = 'create'"
          >
            <ion-icon :icon="activeTab === 'create' ? addCircle : addCircleOutline"></ion-icon>
            <span>Create</span>
          </button>
        </nav>

        <!-- ── MAIN CONTENT ────────────────────────────── -->
        <main class="main-content">

          <!-- HOME TAB -->
          <div v-if="activeTab === 'home'" class="home-tab">
            <div v-if="isLoadingPosts" class="loading-container">
              <ion-spinner></ion-spinner>
              <p>Loading content...</p>
            </div>

            <div v-else-if="combinedFeed.length > 0" class="feed-list">
              <template v-for="item in combinedFeed" :key="`${item.type}-${item.data.id}`">
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
                <PollCard
                  v-else-if="item.type === 'poll'"
                  :poll="item.data"
                  :community-name="getCommunityName(item.data.communityId)"
                  @click="navigateToPoll(item.data)"
                  @vote="navigateToPoll(item.data)"
                />
              </template>

              <ion-infinite-scroll :disabled="!hasMore" @ionInfinite="onInfiniteScroll">
                <ion-infinite-scroll-content loading-spinner="bubbles" />
              </ion-infinite-scroll>
            </div>

            <div v-else class="empty-state">
              <ion-icon :icon="documentTextOutline" size="large"></ion-icon>
              <p>No content yet</p>
              <p class="subtitle">This may take 5–10 seconds on first visit. Join a community and create the first post or poll!</p>
            </div>
          </div>

          <!-- COMMUNITIES TAB -->
          <div v-else-if="activeTab === 'communities'" class="communities-tab">
            <div class="communities-toolbar">
              <div class="tab-bar">
                <button class="tab-btn" :class="{ active: communityFilter === 'all' }" @click="communityFilter = 'all'">All</button>
                <button class="tab-btn" :class="{ active: communityFilter === 'joined' }" @click="communityFilter = 'joined'">Joined</button>
              </div>
              <ion-button size="small" @click="$router.push('/create-community')">
                <ion-icon slot="start" :icon="addCircleOutline"></ion-icon>
                New Community
              </ion-button>
            </div>

            <div v-if="communityStore.isLoading" class="loading-container">
              <ion-spinner></ion-spinner>
              <p>Loading communities...</p>
            </div>

            <div v-else-if="displayedCommunities.length > 0" class="communities-list">
              <CommunityCard
                v-for="community in displayedCommunities"
                :key="community.id"
                :community="community"
                @click="$router.push(`/community/${community.id}`)"
              />
            </div>

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
            <p class="section-label">What would you like to create?</p>

            <div class="create-options">
              <div class="create-option-item" @click="$router.push('/create-community')">
                <div class="create-icon-wrap primary">
                  <ion-icon :icon="peopleOutline"></ion-icon>
                </div>
                <div class="option-content">
                  <h3>Community</h3>
                  <p>Start a space for discussions</p>
                </div>
                <ion-icon :icon="chevronForwardOutline" class="chevron"></ion-icon>
              </div>

              <div class="create-option-item" @click="showPostOptions">
                <div class="create-icon-wrap secondary">
                  <ion-icon :icon="documentTextOutline"></ion-icon>
                </div>
                <div class="option-content">
                  <h3>Post</h3>
                  <p>Share content in a community</p>
                </div>
                <ion-icon :icon="chevronForwardOutline" class="chevron"></ion-icon>
              </div>

              <div class="create-option-item" @click="showPollOptions">
                <div class="create-icon-wrap tertiary">
                  <ion-icon :icon="statsChartOutline"></ion-icon>
                </div>
                <div class="option-content">
                  <h3>Poll</h3>
                  <p>Ask the community a question</p>
                </div>
                <ion-icon :icon="chevronForwardOutline" class="chevron"></ion-icon>
              </div>
            </div>

            <!-- Quick access chips for joined communities -->
            <div v-if="joinedCommunities.length > 0" class="quick-post-section">
              <p class="section-label">Post to a community</p>
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

        </main>

        <!-- ── RIGHT SIDEBAR (desktop only) ───────────── -->
        <aside class="right-sidebar">
          <div class="sidebar-section">
            <div class="sidebar-header">
              <span>Communities</span>
              <button class="sidebar-link" @click="activeTab = 'communities'">See all</button>
            </div>

            <ion-button expand="block" size="small" @click="$router.push('/create-community')" class="sidebar-create-btn">
              <ion-icon slot="start" :icon="addCircleOutline"></ion-icon>
              Create Community
            </ion-button>

            <div class="sidebar-communities">
              <div
                v-for="community in communityStore.communities.slice(0, 8)"
                :key="community.id"
                class="sidebar-community-item"
                @click="$router.push(`/community/${community.id}`)"
              >
                <div class="sidebar-community-avatar">
                  {{ community.displayName?.charAt(0)?.toUpperCase() }}
                </div>
                <div class="sidebar-community-info">
                  <span class="sidebar-community-name">{{ community.displayName }}</span>
                  <span class="sidebar-community-meta">{{ community.memberCount || 0 }} members</span>
                </div>
                <ion-icon
                  v-if="communityStore.isJoined(community.id)"
                  :icon="checkmarkCircleOutline"
                  class="joined-check"
                ></ion-icon>
              </div>
            </div>
          </div>

          <div class="sidebar-section sidebar-about">
            <p class="sidebar-about-title">Interpoll</p>
            <p class="sidebar-about-text">A peer-to-peer community platform built on GunDB. Posts and votes sync across all peers.</p>
          </div>
        </aside>

      </div>

      <div class="bottom-spacing"></div>
    </ion-content>

    <!-- Bottom Nav (mobile only) -->
    <div class="bottom-nav" :class="{ 'bottom-nav-hidden': isTabBarHidden }">
      <button class="nav-item" :class="{ active: activeTab === 'home' }" @click="activeTab = 'home'">
        <ion-icon :icon="activeTab === 'home' ? home : homeOutline"></ion-icon>
        <span>Home</span>
      </button>
      <button class="nav-item" :class="{ active: activeTab === 'communities' }" @click="activeTab = 'communities'">
        <ion-icon :icon="activeTab === 'communities' ? people : peopleOutline"></ion-icon>
        <span>Communities</span>
      </button>
      <button class="nav-item" :class="{ active: activeTab === 'create' }" @click="activeTab = 'create'">
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
  IonButtons, IonButton, IonIcon, IonSegment, IonSegmentButton,
  IonLabel, IonSpinner, IonChip,
  IonInfiniteScroll, IonInfiniteScrollContent,
  actionSheetController, toastController
} from '@ionic/vue';
import {
  cube, personCircleOutline, settingsOutline, addCircleOutline,
  earthOutline, peopleOutline, home, homeOutline, documentTextOutline,
  chevronForwardOutline, people, addCircle, statsChartOutline,
  checkmarkCircleOutline
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

const displayedCommunities = computed(() => {
  if (communityFilter.value === 'joined') {
    return communityStore.communities.filter(c => communityStore.isJoined(c.id));
  }
  return communityStore.communities;
});

const combinedFeed = computed(() => {
  const items: Array<{ type: 'post' | 'poll'; data: any; createdAt: number }> = [];
  postStore.visiblePosts.forEach(post => items.push({ type: 'post', data: post, createdAt: post.createdAt }));
  pollStore.visiblePolls.forEach(poll => {
    if (!poll.isPrivate) items.push({ type: 'poll', data: poll, createdAt: poll.createdAt });
  });
  return items.sort((a, b) => b.createdAt - a.createdAt);
});

const hasMore = computed(() => postStore.hasMorePosts || pollStore.hasMorePolls);
const joinedCommunities = computed(() => communityStore.communities.filter(c => communityStore.isJoined(c.id)));

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

async function onInfiniteScroll(event: any) {
  postStore.loadMorePosts();
  pollStore.loadMorePolls();
  await new Promise(r => setTimeout(r, 100));
  event.target.complete();
}

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
      const filtered = JSON.parse(localStorage.getItem('upvoted-posts') || '[]').filter((id: string) => id !== post.id);
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
      const filtered = JSON.parse(localStorage.getItem('downvoted-posts') || '[]').filter((id: string) => id !== post.id);
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

function getCommunityName(communityId: string): string {
  return communityStore.communities.find(c => c.id === communityId)?.displayName || communityId;
}

function navigateToPost(post: Post) {
  router.push(`/community/${post.communityId}/post/${post.id}`);
}

function navigateToPoll(poll: Poll) {
  router.push(`/community/${poll.communityId}/poll/${poll.id}`);
}

const subscribedFromHome = new Set<string>();

async function subscribeNewCommunities(communities: typeof communityStore.communities) {
  const newOnes = communities.filter(c => !subscribedFromHome.has(c.id));
  if (newOnes.length === 0) return;
  newOnes.forEach(c => subscribedFromHome.add(c.id));
  if (subscribedFromHome.size === newOnes.length) isLoadingPosts.value = true;
  try {
    await Promise.all(newOnes.flatMap(community => [
      postStore.loadPostsForCommunity(community.id),
      pollStore.loadPollsForCommunity(community.id),
    ]));
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

watch(() => communityStore.communities, (communities) => { subscribeNewCommunities(communities); }, { deep: true });

watch(activeTab, (newTab) => {
  if (newTab === 'home') {
    postStore.resetVisibleCount();
    pollStore.resetVisibleCount();
  }
});

onMounted(async () => {
  await chainStore.initialize();
  await communityStore.loadCommunities();
});
</script>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=Grand+Hotel&display=swap');

/* ── Logo ─────────────────────────────────────────── */
.logo-title {
  font-family: 'Grand Hotel', cursive;
  font-size: 32px;
  margin-left: 20px;
  letter-spacing: 0.5px;
  padding-inline-start: 0;
  --color: var(--ion-text-color);
}

/* ── Page Layout ──────────────────────────────────── */
.page-layout {
  display: flex;
  align-items: flex-start;
  max-width: 1200px;
  margin: 0 auto;
  position: relative;
}

/* ── Left Side Nav (desktop) ──────────────────────── */
.side-nav {
  display: none;
}

/* ── Main Content ─────────────────────────────────── */
.main-content {
  flex: 1;
  min-width: 0;
}

/* ── Right Sidebar (desktop) ──────────────────────── */
.right-sidebar {
  display: none;
}

/* ── Communities toolbar ──────────────────────────── */
.communities-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid rgba(var(--ion-text-color-rgb), 0.08);
}

.tab-bar {
  display: flex;
  gap: 0;
}

.tab-btn {
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  padding: 8px 14px;
  font-size: 14px;
  font-weight: 500;
  color: var(--ion-color-medium);
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s;
}

.tab-btn.active {
  color: var(--ion-color-primary);
  border-bottom-color: var(--ion-color-primary);
  font-weight: 700;
}

/* ── Loading / Empty ──────────────────────────────── */
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
  margin: 6px 0;
}

.subtitle {
  color: var(--ion-color-medium);
  font-size: 13px;
}

/* ── Create Tab ───────────────────────────────────── */
.section-label {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--ion-color-medium);
  margin: 20px 16px 10px;
}

.create-options {
  display: flex;
  flex-direction: column;
}

.create-option-item {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 16px;
  cursor: pointer;
  border-bottom: 1px solid rgba(var(--ion-text-color-rgb), 0.07);
  transition: background 0.15s;
}

.create-option-item:active {
  background: rgba(var(--ion-text-color-rgb), 0.04);
}

.create-icon-wrap {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  font-size: 20px;
}

.create-icon-wrap.primary { background: rgba(var(--ion-color-primary-rgb), 0.12); color: var(--ion-color-primary); }
.create-icon-wrap.secondary { background: rgba(var(--ion-color-secondary-rgb), 0.12); color: var(--ion-color-secondary); }
.create-icon-wrap.tertiary { background: rgba(var(--ion-color-tertiary-rgb), 0.12); color: var(--ion-color-tertiary); }

.option-content { flex: 1; }
.option-content h3 { margin: 0 0 2px; font-size: 15px; font-weight: 600; }
.option-content p { margin: 0; font-size: 13px; color: var(--ion-color-medium); }

.chevron { font-size: 18px; color: var(--ion-color-medium); }

.quick-post-section { margin-top: 8px; }

.quick-communities {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 0 16px 16px;
}

/* ── Bottom Spacing ───────────────────────────────── */
.bottom-spacing { height: 80px; }

/* ── Mobile Bottom Nav ────────────────────────────── */
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

.bottom-nav-hidden { transform: translateY(100%); }

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
  transition: color 0.2s;
  flex: 1;
  max-width: 120px;
}

.nav-item ion-icon { font-size: 22px; }
.nav-item span { font-size: 11px; font-weight: 500; }
.nav-item.active { color: var(--ion-color-primary); }
.nav-item.active span { font-weight: 700; }

ion-header {
  transition: transform 0.3s ease;
}

ion-header::after {
  display: none;
}

ion-header ion-toolbar {
  --background: var(--ion-background-color);
  --border-width: 0;
  --box-shadow: none;
  border-bottom: 1px solid rgba(var(--ion-text-color-rgb), 0.08);
}

/* Constrain toolbar inner content to match page layout on desktop */
@media (min-width: 768px) {
  ion-header ion-toolbar {
    max-width: 100%;
    padding-inline-start: 32px;
    padding-inline-end: 32px;
  }
}

ion-header.header-hidden {
  transform: translateY(-100%);
}

/* ── Tablet (768px+) ──────────────────────────────── */
@media (min-width: 768px) {
  .logo-title{
    margin-left: 10%;
  }
  .bottom-nav { display: none; }
  .bottom-spacing { height: 24px; }

  .page-layout {
    padding: 0 16px;
    gap: 24px;
  }

  .side-nav {
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: 200px;
    flex-shrink: 0;
    position: sticky;
    top: 16px;
    padding-top: 16px;
  }

  .side-nav-item {
    display: flex;
    align-items: center;
    gap: 12px;
    background: none;
    border: none;
    padding: 10px 14px;
    border-radius: 10px;
    font-size: 15px;
    font-weight: 500;
    color: var(--ion-color-medium);
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
    text-align: left;
    width: 100%;
  }

  .side-nav-item ion-icon { font-size: 20px; flex-shrink: 0; }

  .side-nav-item:hover {
    background: rgba(var(--ion-text-color-rgb), 0.06);
    color: var(--ion-text-color);
  }

  .side-nav-item.active {
    background: rgba(var(--ion-color-primary-rgb), 0.1);
    color: var(--ion-color-primary);
    font-weight: 700;
  }
}

/* ── Desktop (1024px+) ────────────────────────────── */
@media (min-width: 1024px) {
  .page-layout { gap: 32px; }

  .side-nav { width: 220px; }

  .right-sidebar {
    display: flex;
    flex-direction: column;
    gap: 12px;
    width: 280px;
    flex-shrink: 0;
    position: sticky;
    top: 16px;
    padding-top: 16px;
    align-self: flex-start;
  }

  .sidebar-section {
    border: 1px solid rgba(var(--ion-text-color-rgb), 0.08);
    border-radius: 12px;
    overflow: hidden;
  }

  .sidebar-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 14px 8px;
    font-size: 13px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--ion-color-medium);
  }

  .sidebar-link {
    background: none;
    border: none;
    font-size: 12px;
    color: var(--ion-color-primary);
    cursor: pointer;
    font-weight: 600;
    padding: 0;
  }

  .sidebar-create-btn {
    margin: 0 10px 10px;
  }

  .sidebar-communities {
    display: flex;
    flex-direction: column;
  }

  .sidebar-community-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 14px;
    cursor: pointer;
    transition: background 0.15s;
    border-top: 1px solid rgba(var(--ion-text-color-rgb), 0.06);
  }

  .sidebar-community-item:hover {
    background: rgba(var(--ion-text-color-rgb), 0.04);
  }

  .sidebar-community-avatar {
    width: 32px;
    height: 32px;
    border-radius: 8px;
    background: rgba(var(--ion-color-primary-rgb), 0.12);
    color: var(--ion-color-primary);
    font-size: 14px;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .sidebar-community-info {
    flex: 1;
    min-width: 0;
  }

  .sidebar-community-name {
    display: block;
    font-size: 14px;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .sidebar-community-meta {
    display: block;
    font-size: 12px;
    color: var(--ion-color-medium);
  }

  .joined-check {
    font-size: 16px;
    color: var(--ion-color-primary);
    flex-shrink: 0;
  }

  .sidebar-about {
    padding: 14px;
  }

  .sidebar-about-title {
    font-family: 'Grand Hotel', cursive;
    font-size: 20px;
    margin: 0 0 6px;
  }

  .sidebar-about-text {
    font-size: 12px;
    color: var(--ion-color-medium);
    line-height: 1.5;
    margin: 0;
  }
}

/* ── Large Desktop (1280px+) ──────────────────────── */
@media (min-width: 1280px) {
  .side-nav { width: 240px; }
  .right-sidebar { width: 300px; }
}
</style>
