<template>
  <ion-page>
    <ion-header :class="{ 'header-hidden': isHeaderHidden }">
      <ion-toolbar>
        <ion-title class="logo-title">Interpoll</ion-title>
        <!-- These buttons are hidden on desktop (768px+) and moved to side-nav -->
        <ion-buttons slot="end" class="header-util-buttons">
          <ion-button @click="$router.push('/search')">
            <ion-icon :icon="searchOutline"></ion-icon>
          </ion-button>
          <ion-button @click="$router.push('/profile')">
            <ion-icon :icon="personCircleOutline"></ion-icon>
          </ion-button>
          <ion-button @click="$router.push('/settings')">
            <ion-icon :icon="settingsOutline"></ion-icon>
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ambient-page" :scroll-events="true" @ionScroll="handleScroll">
      <div class="page-layout ambient-page__content">

        <!-- ── LEFT NAV (desktop only) ─────────────────── -->
        <nav class="side-nav surface-card">
          <!-- Primary nav tabs -->
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
            :class="{ active: activeTab === 'chat' }"
            @click="activeTab = 'chat'"
          >
            <ion-icon :icon="activeTab === 'chat' ? chatbubble : chatbubbleOutline"></ion-icon>
            <span>Chat</span>

            <span v-if="totalUnread > 0" class="nav-badge nav-badge--desktop">
              {{ totalUnread > 99 ? '99+' : totalUnread }}
            </span>
          </button>
          <button
            class="side-nav-item"
            :class="{ active: activeTab === 'create' }"
            @click="activeTab = 'create'"
          >
            <ion-icon :icon="activeTab === 'create' ? addCircle : addCircleOutline"></ion-icon>
            <span>Create</span>
          </button>

          <!-- ── Utility nav items (desktop only, replaces header buttons) ── -->
          <div class="side-nav-divider"></div>

          <button class="side-nav-item side-nav-util" @click="$router.push('/search')">
            <ion-icon :icon="searchOutline"></ion-icon>
            <span>Search</span>
          </button>
          <button class="side-nav-item side-nav-util" @click="$router.push('/profile')">
            <ion-icon :icon="personCircleOutline"></ion-icon>
            <span>Profile</span>
          </button>
          <button class="side-nav-item side-nav-util" @click="$router.push('/settings')">
            <ion-icon :icon="settingsOutline"></ion-icon>
            <span>Settings</span>
          </button>
          <button class="side-nav-item side-nav-util" @click="$router.push('/resilience')">
            <ion-icon :icon="shieldOutline"></ion-icon>
            <span>Resilience Center</span>
          </button>

          <button
            v-if="auth.isLoggedIn"
            class="side-nav-item side-nav-util side-nav-logout"
            @click="handleLogout"
          >
            <ion-icon :icon="logOutOutline"></ion-icon>
            <span>Log out</span>
          </button>
        </nav>

        <!-- ── MAIN CONTENT ────────────────────────────── -->
        <main class="main-content surface-card">

          <!-- HOME TAB -->
          <div v-if="activeTab === 'home'" class="home-tab">
            <div class="feed-mode-toggle surface-pill">
              <button
                class="mode-btn"
                :class="{ active: feedMode === 'for-you' }"
                @click="setFeedMode('for-you')"
              >
                For You
              </button>
              <button
                class="mode-btn"
                :class="{ active: feedMode === 'latest' }"
                @click="setFeedMode('latest')"
              >
                Latest
              </button>
            </div>

            <div v-if="isLoadingPosts" class="loading-container">
              <ion-spinner></ion-spinner>
              <p>Loading content...</p>
            </div>

            <div v-else-if="combinedFeed.length > 0" class="feed-list">
  <!-- New content banner -->
  <div
    v-if="newContentCount > 0"
    class="new-content-banner"
    @click="flushNewContent"
  >
    ↑ {{ newContentCount }} new
    {{ postStore.newPostCount > 0 && pollStore.newPollCount > 0 ? 'posts & polls' : postStore.newPostCount > 0 ? 'posts' : 'polls' }}
    — tap to show
  </div>
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
                <button class="tab-btn" :class="{ active: communityFilter === 'private' }" @click="communityFilter = 'private'">Private</button>
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
              <p>{{ communityFilter === 'private' ? 'No joined private communities' : communityFilter === 'joined' ? 'No joined communities' : 'No public communities yet' }}</p>
              <ion-button @click="communityFilter === 'private' ? communityFilter = 'joined' : communityFilter === 'joined' ? communityFilter = 'all' : $router.push('/create-community')">
                {{ communityFilter === 'private' ? 'Show Joined' : communityFilter === 'joined' ? 'Browse All' : 'Create the first one!' }}
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

          <!-- CHAT TAB -->
          <div v-if="activeTab === 'chat'" class="chat-tab">
            <div class="tab-intro">
              <p>{{ totalUnread > 0 ? `${totalUnread} unread message${totalUnread > 1 ? 's' : ''}` : '' }}</p>
            </div>

            <!-- User Search -->
            <div class="user-search-box">
              <ion-searchbar
                v-model="userSearchQuery"
                placeholder="Search users by name..."
                @ionInput="handleUserSearch"
                debounce="300"
              ></ion-searchbar>
            </div>

            <!-- Search Results -->
            <div v-if="userSearchQuery && userSearchResults.length > 0" class="user-search-results">
              <div class="search-results-header">
                <span>Search Results</span>
                <button @click="clearUserSearch" class="clear-search-btn">Clear</button>
              </div>
              <div
                v-for="user in userSearchResults"
                :key="user.id"
                class="user-result-item"
                @click="startChatWithUser(user)"
              >
                <div class="user-avatar">
                  <ion-icon :icon="personCircleOutline"></ion-icon>
                </div>
                <div class="user-info">
                  <div class="user-name">{{ user.name }}</div>
                  <div class="user-username">u/{{ user.username }}</div>
                </div>
                <ion-icon :icon="chatbubbleOutline" class="chat-icon"></ion-icon>
              </div>
            </div>

            <div v-if="userSearchQuery && userSearchResults.length === 0 && !searchingUsers" class="no-users-found">
              <p>No users found for "{{ userSearchQuery }}"</p>
            </div>

            <div v-if="searchingUsers" class="searching-users">
              <ion-spinner></ion-spinner>
              <p>Searching users...</p>
            </div>

            <!-- Chat List -->
            <div class="chat-list">
              <div class="chat-list-header" v-if="!userSearchQuery">
                <span>Recent Conversations</span>
              </div>

              <div v-if="chatList.length === 0 && !userSearchQuery" class="empty-chat">
                <ion-icon :icon="chatbubbleOutline" class="empty-chat-icon"></ion-icon>
                <p>No conversations yet</p>
                <p class="empty-hint">Search for users above to start chatting</p>
              </div>

              <div
                v-for="chat in chatList"
                :key="chat.userId"
                class="chat-item"
                @click="openChat(chat)"
                v-show="!userSearchQuery"
              >
                <div class="chat-avatar">
                  <ion-icon :icon="personCircleOutline"></ion-icon>
                </div>
                <div class="chat-info">
                  <div class="chat-header-row">
                    <span class="chat-name">{{ chat.name }}</span>
                    <span class="chat-time">{{ formatChatTime(chat.lastMessageTime) }}</span>
                  </div>
                  <div class="chat-preview">
                    {{ chat.lastMessage }}
                  </div>
                </div>
                <div v-if="chat.unreadCount > 0" class="unread-badge">
                  {{ chat.unreadCount }}
                </div>
              </div>
            </div>
          </div>

        </main>

        <!-- ── RIGHT SIDEBAR (desktop only) ───────────── -->
        <aside class="right-sidebar">
          <div class="sidebar-section surface-card">
            <div class="sidebar-header">
              <span>Communities</span>
              <button class="sidebar-link" @click="activeTab = 'communities'">See all</button>
            </div>

             <div class="sidebar-communities">
               <div
                 v-for="community in sidebarCommunities"
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

          <div class="sidebar-section sidebar-about surface-card">
            <p class="sidebar-about-title">Interpoll</p>
            <p class="sidebar-about-text">A peer-to-peer community platform built on GenosDB. Posts and votes sync across all peers.</p>
          </div>
        </aside>

      </div>

    </ion-content>

    <!-- Bottom Nav (mobile only) -->
    <ion-footer class="bottom-nav-footer">
      <div class="bottom-nav" :class="{ 'bottom-nav-hidden': isTabBarHidden }">
        <button class="nav-item" :class="{ active: activeTab === 'home' }" @click="activeTab = 'home'">
          <ion-icon :icon="activeTab === 'home' ? home : homeOutline"></ion-icon>
          <span>Home</span>
        </button>
        <button class="nav-item" :class="{ active: activeTab === 'communities' }" @click="activeTab = 'communities'">
          <ion-icon :icon="activeTab === 'communities' ? people : peopleOutline"></ion-icon>
          <span>Communities</span>
        </button>
        <button class="nav-item" :class="{ active: activeTab === 'chat' }" @click="activeTab = 'chat'">
          <ion-icon :icon="activeTab === 'chat' ? chatbubble : chatbubbleOutline"></ion-icon>
          <span>Chat</span>
          <span v-if="totalUnread > 0" class="nav-badge nav-badge--mobile">
            {{ totalUnread > 99 ? '99+' : totalUnread }}
          </span>
        </button>
        <button class="nav-item" :class="{ active: activeTab === 'create' }" @click="activeTab = 'create'">
          <ion-icon :icon="activeTab === 'create' ? addCircle : addCircleOutline"></ion-icon>
          <span>Create</span>
        </button>
      </div>
    </ion-footer>

  </ion-page>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import {
  IonPage, IonHeader, IonToolbar, IonTitle, IonContent,IonBadge,  
  IonButtons, IonButton, IonIcon, IonSegment, IonSegmentButton, IonFooter,
  IonLabel, IonSpinner, IonChip, IonSearchbar,
  IonInfiniteScroll, IonInfiniteScrollContent,
  actionSheetController, toastController
} from '@ionic/vue';
import {
  personCircleOutline, settingsOutline, addCircleOutline,
  earthOutline, peopleOutline, home, homeOutline, documentTextOutline,
  chevronForwardOutline, people, addCircle, statsChartOutline,
  checkmarkCircleOutline, searchOutline, chatbubble, chatbubbleOutline,
  shieldOutline, logOutOutline
} from 'ionicons/icons';
import { useRouter } from 'vue-router';
import { useAuthStore } from '../stores/authStore';
import { useCommunityStore } from '../stores/communityStore';
import { usePostStore } from '../stores/postStore';
import { usePollStore } from '../stores/pollStore';
import CommunityCard from '../components/CommunityCard.vue';
import PostCard from '../components/PostCard.vue';
import PollCard from '../components/PollCard.vue';
import { Post } from '../services/postService';
import { Poll } from '../services/pollService';
import { db } from '../services/gdbServices';
import { UserService } from '../services/userService';
import ChatService from '../services/chatService';
import config from '../config';
import { formatAddress } from '../utils/address';

const router = useRouter();
const auth = useAuthStore();

/**
 * Identity-scoped startup: background chat (DM notifications). HomePage mounts
 * underneath the identity gate, so this is a no-op until an identity is active —
 * the `auth.isLoggedIn` watcher re-fires it right after login, and
 * `handleLogout` re-arms it for the next identity.
 */
let userServicesInitDone = false;
async function initUserScopedServices() {
  if (userServicesInitDone || !auth.isLoggedIn) return;
  try {
    const currentUser = await UserService.getCurrentUser();
    if (!currentUser) return;
    userServicesInitDone = true;
    currentUserId = currentUser.id;
    // Keep startup sync light: defer heavy chat graph subscriptions until the
    // chat tab is opened.
    await ensureBackgroundChatInitialized();
    if (activeTab.value === 'chat') {
      await ensureChatInitialized();
    }
  } catch (err) {
    userServicesInitDone = false;
    console.warn('Identity-scoped init failed (will retry on next login):', err);
  }
}

watch(() => auth.isLoggedIn, (loggedIn) => {
  if (loggedIn) void initUserScopedServices();
});

/**
 * Log out the active Security Manager identity. Clears local signing so the
 * OnboardingModal (gated on `!auth.isLoggedIn`) reappears, letting the user
 * switch or recover an identity without clearing browser storage by hand.
 */
async function handleLogout() {
  if (!confirm('Log out of this identity? You will need your recovery phrase or passkey to sign in again.')) return;
  await auth.logout();
  activeTab.value = 'home';
  // Re-arm identity-scoped services so the next login (possibly a different
  // identity) initialises cleanly instead of reusing the previous session.
  userServicesInitDone = false;
  currentUserId = '';
  bgChatService?.disconnect();
  bgChatService = null;
  bgChatInitPromise = null;
  chatInitPromise = null;
  chatListUnsub?.();
  chatListUnsub = null;
  chatList.value = [];
}
const communityStore = useCommunityStore();
const postStore = usePostStore();
const pollStore = usePollStore();

const FEED_DEBUG = localStorage.getItem('interpoll_feed_debug') === 'true';
const SYNC_DEBUG = localStorage.getItem('interpoll_sync_debug') === 'true';
const HOME_GUN_FEED_ENABLED = localStorage.getItem('interpoll_home_gun_feed') === 'true';
const FEED_INITIAL_RENDER_TARGET = 50;

function feedDebug(label: string, data?: Record<string, unknown>) {
  if (!FEED_DEBUG) return;
  if (data) console.log(`[FeedDebug] ${label}`, data);
  else console.log(`[FeedDebug] ${label}`);
}

function syncDebug(label: string, data?: Record<string, unknown>) {
  if (!SYNC_DEBUG) return;
  if (data) console.log(`[SyncDebug] ${label}`, data);
  else console.log(`[SyncDebug] ${label}`);
}

const activeTab = ref('home');
const communityFilter = ref('all');
const isLoadingPosts = ref(false);
const voteVersion = ref(0);
const isHeaderHidden = ref(false);
const isTabBarHidden = ref(false);
const warmupComplete = ref(false);
let lastScrollTop = 0;
const scrollThreshold = 50;

// Add after the activeTab ref
const feedMode = ref<'for-you' | 'latest'>('for-you')
function setFeedMode(mode: 'for-you' | 'latest') {
  feedMode.value = mode
}

// ── Chat state ────────────────────────────────────────────────────────────────

const chatList = ref<Array<{
  userId: string;
  name: string;
  lastMessage: string;
  lastMessageTime: number;
  unreadCount: number;
  publicKey: string;
}>>([]);

const totalUnread = computed(() => chatList.value.reduce((sum, c) => sum + c.unreadCount, 0));

let bgChatService: ChatService | null = null;
let currentUserId = '';
const gunListeners: Array<() => void> = [];
let chatInitPromise: Promise<void> | null = null;
let bgChatInitPromise: Promise<void> | null = null;

const userSearchQuery   = ref('');
const userSearchResults = ref<Array<{ id: string; name: string; username: string; publicKey: string }>>([]);
const searchingUsers    = ref(false);

// ── Vote cache ────────────────────────────────────────────────────────────────

const upvotedCache   = ref<Set<string>>(new Set(JSON.parse(localStorage.getItem('upvoted-posts')   || '[]')));
const downvotedCache = ref<Set<string>>(new Set(JSON.parse(localStorage.getItem('downvoted-posts') || '[]')));

// ── Computed ──────────────────────────────────────────────────────────────────

const displayedCommunities = computed(() => {
  if (communityFilter.value === 'joined') {
    return communityStore.communities.filter(c => communityStore.isJoined(c.id));
  }
  return communityStore.communities;
});

const sessionSeed = Math.floor(Math.random() * 10000)

function seededRandom(index: number): number {
  const x = Math.sin(index + sessionSeed) * 10000
  return x - Math.floor(x)
}

const combinedFeed = computed(() => {
  const items: Array<{ type: 'post' | 'poll'; data: any; createdAt: number }> = []

  postStore.sortedPosts.forEach(post =>
    items.push({ type: 'post', data: post, createdAt: post.createdAt })
  )
  pollStore.sortedPolls.forEach(poll => {
    if (!poll.isPrivate) items.push({ type: 'poll', data: poll, createdAt: poll.createdAt })
  })

  if (feedMode.value === 'latest') {
    items.sort((a, b) => b.createdAt - a.createdAt)
  } else {
    const now = Date.now()
    const maxAge = 30 * 24 * 60 * 60 * 1000

    items.sort((a, b) => {
      const scoreA = a.type === 'post' ? (a.data.score ?? 0) : (a.data.totalVotes ?? 0)
      const scoreB = b.type === 'post' ? (b.data.score ?? 0) : (b.data.totalVotes ?? 0)

      const idxA = items.indexOf(a)
      const idxB = items.indexOf(b)
      const rand = seededRandom(idxA * 31 + idxB)

      // ~20% of comparisons: pure discovery slot, ignore score/age entirely
      if (rand < 0.2) return seededRandom(idxA) - seededRandom(idxB)

      const ageA = Math.max(0, 1 - (now - a.createdAt) / maxAge)
      const ageB = Math.max(0, 1 - (now - b.createdAt) / maxAge)

      // Low engagement boost: score < 5 gets a flat bump
      const engBoostA = scoreA < 5 ? 0.15 : 0
      const engBoostB = scoreB < 5 ? 0.15 : 0

      // Old content boost: older than 7 days gets a random per-session lift
      const oldBoostA = (now - a.createdAt) > 7 * 24 * 60 * 60 * 1000 ? seededRandom(idxA + 999) * 0.2 : 0
      const oldBoostB = (now - b.createdAt) > 7 * 24 * 60 * 60 * 1000 ? seededRandom(idxB + 999) * 0.2 : 0

      const weightA = ageA * 0.4 + Math.min(scoreA / 20, 1) * 0.25 + seededRandom(idxA) * 0.15 + engBoostA + oldBoostA
      const weightB = ageB * 0.4 + Math.min(scoreB / 20, 1) * 0.25 + seededRandom(idxB) * 0.15 + engBoostB + oldBoostB

      return weightB - weightA
    })
  }

  return items.slice(0, postStore.visibleCount)
})


const hasMore = computed(() => {
  const totalItems = postStore.sortedPosts.length + pollStore.sortedPolls.filter(p => !p.isPrivate).length;
  return postStore.visibleCount < totalItems;
});

function ensureInitialFeedVisible(reason: string) {
  const totalItems = postStore.sortedPosts.length + pollStore.sortedPolls.filter(p => !p.isPrivate).length;
  const target = Math.min(FEED_INITIAL_RENDER_TARGET, totalItems);
  const nextVisible = Math.max(postStore.visibleCount, target);
  if (nextVisible !== postStore.visibleCount) {
    const previous = postStore.visibleCount;
    postStore.visibleCount = nextVisible;
    pollStore.visibleCount = nextVisible;
    if (FEED_DEBUG) {
      feedDebug('expanded-visible-count', {
        reason,
        previous,
        next: nextVisible,
        totalItems,
        postCount: postStore.sortedPosts.length,
        publicPollCount: pollStore.sortedPolls.filter(p => !p.isPrivate).length,
      });
    }
  } else {
    if (FEED_DEBUG) {
      feedDebug('visible-count-unchanged', {
        reason,
        visibleCount: postStore.visibleCount,
        totalItems,
        postCount: postStore.sortedPosts.length,
        publicPollCount: pollStore.sortedPolls.filter(p => !p.isPrivate).length,
      });
    }
  }
}

watch(
  () => [postStore.sortedPosts.length, pollStore.sortedPolls.filter(p => !p.isPrivate).length, activeTab.value, warmupComplete.value] as const,
  ([postCount, pollCount, tab, isWarm]) => {
    if (tab !== 'home' || !isWarm) return;
    const target = Math.min(FEED_INITIAL_RENDER_TARGET, postCount + pollCount);
    if (postStore.visibleCount < target) {
      ensureInitialFeedVisible('feed-items-increased');
    }
  },
);

const joinedCommunities = computed(() => communityStore.communities.filter(c => communityStore.isJoined(c.id)));

const sidebarCommunities = computed(() =>
  communityStore.communities.slice(0, 8)
)

// ── Chat list ─────────────────────────────────────────────────────────────────

function getRoomId(a: string, b: string) {
  return [a, b].sort().join(':');
}

let chatListUnsub: (() => void) | null = null;

/**
 * Build the DM conversation list reactively from signed `dm` nodes in GenosDB.
 * Messages stay end-to-end encrypted; the sidebar only needs sender, timestamp
 * and unread state, so no decryption is required here.
 */
async function loadChatList() {
  if (!currentUserId) {
    const u = await UserService.getCurrentUser();
    currentUserId = u?.id ?? '';
  }
  if (chatListUnsub) return;

  const rebuild = async () => {
    const { results } = await db.map({ query: { type: 'dm' } });
    const convos = new Map<string, typeof chatList.value[number]>();
    for (const node of results) {
      const m: any = node.value;
      if (m.senderId !== currentUserId && m.recipientId !== currentUserId) continue;
      const other = m.senderId === currentUserId ? m.recipientId : m.senderId;
      let c = convos.get(other);
      if (!c) {
        c = { userId: other, name: formatAddress(other), lastMessage: '', lastMessageTime: 0, unreadCount: 0, publicKey: '' };
        convos.set(other, c);
      }
      if (m.timestamp > c.lastMessageTime) {
        c.lastMessageTime = m.timestamp;
        c.lastMessage = m.senderId === currentUserId ? 'You: [Encrypted]' : '[Encrypted message]';
      }
      if (m.recipientId === currentUserId && !m.readAt) c.unreadCount++;
    }
    chatList.value = [...convos.values()].sort((a, b) => b.lastMessageTime - a.lastMessageTime);
    // Resolve display names lazily from each peer's profile.
    for (const c of chatList.value) {
      UserService.getUser(c.userId).then((u) => {
        if (!u) return;
        const e = chatList.value.find((x) => x.userId === c.userId);
        if (e) { e.name = u.displayName || u.username || formatAddress(c.userId); e.publicKey = u.publicKey || ''; }
      });
    }
  };

  const { unsubscribe } = await db.map({ query: { type: 'dm' } }, () => { void rebuild(); });
  chatListUnsub = unsubscribe;
  await rebuild();
}

async function initBackgroundChat() {
  const WS_URL = config.relay.websocket;
  bgChatService = new ChatService(WS_URL, currentUserId);
  bgChatService.onConnectionChange = () => {};

  bgChatService.onMessage = (msg) => {
    const entry = chatList.value.find(c => c.userId === msg.from);

    if (entry) {
      entry.lastMessage     = '[Encrypted message]';
      entry.lastMessageTime = msg.timestamp;
      if (activeTab.value !== 'chat') entry.unreadCount++;
      chatList.value = [...chatList.value].sort((a, b) => b.lastMessageTime - a.lastMessageTime);
    } else {
      chatList.value.unshift({
        userId: msg.from, name: msg.from,
        lastMessage: '[Encrypted message]',
        lastMessageTime: msg.timestamp,
        unreadCount: activeTab.value === 'chat' ? 0 : 1,
        publicKey: '',
      });
      UserService.getUser(msg.from).then((u) => {
        const e = chatList.value.find(c => c.userId === msg.from);
        if (e && u) {
          e.name      = u.displayName || u.username || msg.from;
          e.publicKey = u.publicKey || '';
        }
      });
    }

    if (activeTab.value !== 'chat') {
      const senderName = chatList.value.find(c => c.userId === msg.from)?.name || 'Someone';
      toastController.create({
        message:  `💬 New message from ${senderName}`,
        duration: 3000,
        position: 'top',
        buttons:  [{ text: 'View', handler: () => { activeTab.value = 'chat'; } }],
      }).then(t => t.present());
    }
  };

  await bgChatService.init();
}

function ensureBackgroundChatInitialized(): Promise<void> {
  if (bgChatInitPromise) return bgChatInitPromise;
  bgChatInitPromise = (async () => {
    try {
      if (!currentUserId) {
        const currentUser = await UserService.getCurrentUser();
        if (!currentUser) throw new Error('Chat requires an active identity');
        currentUserId = currentUser.id;
      }
      syncDebug('background-chat-init-start');
      await initBackgroundChat();
      syncDebug('background-chat-init-complete');
    } catch (error) {
      bgChatInitPromise = null;
      throw error;
    }
  })();
  return bgChatInitPromise;
}

function ensureChatInitialized(): Promise<void> {
  if (chatInitPromise) return chatInitPromise;
  chatInitPromise = (async () => {
    try {
      if (!currentUserId) {
        const currentUser = await UserService.getCurrentUser();
        if (!currentUser) throw new Error('Chat requires an active identity');
        currentUserId = currentUser.id;
      }
      syncDebug('chat-tab-init-start');
      await Promise.allSettled([
        ensureBackgroundChatInitialized(),
        loadChatList(),
      ]);
      syncDebug('chat-tab-init-complete');
    } catch (error) {
      chatInitPromise = null;
      throw error;
    }
  })();
  return chatInitPromise;
}

// ── Chat navigation ───────────────────────────────────────────────────────────

function openChat(chat: typeof chatList.value[number]) {
  const entry = chatList.value.find(c => c.userId === chat.userId);
  if (entry) entry.unreadCount = 0;
  router.push({ name: 'Chat', params: { userId: chat.userId }, query: { name: chat.name, publicKey: chat.publicKey } });
}

function startChatWithUser(user: typeof userSearchResults.value[number]) {
  router.push({ name: 'Chat', params: { userId: user.id }, query: { name: user.name, publicKey: user.publicKey } });
}

function formatChatTime(timestamp: number): string {
  if (!timestamp) return '';
  const diff = Date.now() - timestamp;
  if (diff < 60000)     return 'Just now';
  if (diff < 3600000)   return `${Math.floor(diff / 60000)}m`;
  if (diff < 86400000)  return `${Math.floor(diff / 3600000)}h`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d`;
  return new Date(timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function clearUserSearch() {
  userSearchQuery.value   = '';
  userSearchResults.value = [];
}

async function handleUserSearch() {
  const query = userSearchQuery.value.trim();
  if (query.length < 2) { userSearchResults.value = []; return; }
  searchingUsers.value = true;
  try {
    const users = await UserService.searchUsers(query);
    userSearchResults.value = users.slice(0, 10).map(u => ({
      id: u.id,
      name: u.displayName || u.username || 'Anonymous',
      username: u.username || u.id,
      publicKey: u.publicKey || '',
    }));
  } catch (err) {
    console.error('User search error:', err);
  } finally {
    searchingUsers.value = false;
  }
}

// ── Scroll ────────────────────────────────────────────────────────────────────

function handleScroll(event: CustomEvent) {
  const scrollTop = event.detail.scrollTop;
  if (scrollTop > lastScrollTop && scrollTop > scrollThreshold) {
    isTabBarHidden.value = true; isHeaderHidden.value = true;
  } else if (scrollTop < lastScrollTop) {
    isTabBarHidden.value = false; isHeaderHidden.value = false;
  }
  lastScrollTop = scrollTop;
}

// ── New content flush ─────────────────────────────────────────────────────────

const newContentCount = computed(() => postStore.newPostCount + pollStore.newPollCount);

function flushNewContent() {
  postStore.flushNewPosts();
  pollStore.flushNewPolls();
}

// ── Feed / voting ─────────────────────────────────────────────────────────────

async function onInfiniteScroll(event: any) {
  if (FEED_DEBUG) {
    feedDebug('infinite-scroll-start', {
      visibleCountBefore: postStore.visibleCount,
      totalItems: postStore.sortedPosts.length + pollStore.sortedPolls.filter(p => !p.isPrivate).length,
      combinedFeedLength: combinedFeed.value.length,
    });
  }
  postStore.loadMorePosts();
  await new Promise(r => setTimeout(r, 100));
  event.target.complete();
  if (FEED_DEBUG) {
    feedDebug('infinite-scroll-complete', {
      visibleCountAfter: postStore.visibleCount,
      hasMore: hasMore.value,
      combinedFeedLength: combinedFeed.value.length,
    });
  }
}

function hasUpvoted(postId: string): boolean {
  voteVersion.value; // reactive dependency
  return upvotedCache.value.has(postId);
}
function hasDownvoted(postId: string): boolean {
  voteVersion.value;
  return downvotedCache.value.has(postId);
}

async function handleUpvote(post: Post) {
  try {
    if (hasUpvoted(post.id)) {
      upvotedCache.value.delete(post.id);
      localStorage.setItem('upvoted-posts', JSON.stringify([...upvotedCache.value]));
      voteVersion.value++;
      await postStore.removeUpvote(post.id);
      (await toastController.create({ message: 'Upvote removed', duration: 1500 })).present();
    } else {
      if (downvotedCache.value.has(post.id)) {
        downvotedCache.value.delete(post.id);
        localStorage.setItem('downvoted-posts', JSON.stringify([...downvotedCache.value]));
        await postStore.removeDownvote(post.id);
      }
      upvotedCache.value.add(post.id);
      localStorage.setItem('upvoted-posts', JSON.stringify([...upvotedCache.value]));
      voteVersion.value++;
      await postStore.upvotePost(post.id);
      (await toastController.create({ message: 'Upvoted', duration: 1500 })).present();
    }
  } catch {
    voteVersion.value++;
    (await toastController.create({ message: 'Failed to upvote', duration: 2000 })).present();
  }
}

async function handleDownvote(post: Post) {
  try {
    if (hasDownvoted(post.id)) {
      downvotedCache.value.delete(post.id);
      localStorage.setItem('downvoted-posts', JSON.stringify([...downvotedCache.value]));
      voteVersion.value++;
      await postStore.removeDownvote(post.id);
      (await toastController.create({ message: 'Downvote removed', duration: 1500 })).present();
    } else {
      if (upvotedCache.value.has(post.id)) {
        upvotedCache.value.delete(post.id);
        localStorage.setItem('upvoted-posts', JSON.stringify([...upvotedCache.value]));
        await postStore.removeUpvote(post.id);
      }
      downvotedCache.value.add(post.id);
      localStorage.setItem('downvoted-posts', JSON.stringify([...downvotedCache.value]));
      voteVersion.value++;
      await postStore.downvotePost(post.id);
      (await toastController.create({ message: 'Downvoted', duration: 1500 })).present();
    }
  } catch {
    voteVersion.value++;
    (await toastController.create({ message: 'Failed to downvote', duration: 2000 })).present();
  }
}

function getCommunityName(communityId: string): string {
  return communityStore.communities.find(c => c.id === communityId)?.displayName || communityId;
}
function navigateToPost(post: Post) { router.push(`/community/${post.communityId}/post/${post.id}`); }
function navigateToPoll(poll: Poll) { router.push(`/community/${poll.communityId}/poll/${poll.id}`); }

// ── Community subscriptions ───────────────────────────────────────────────────

const subscribedFromHome = new Set<string>();

const GUN_SUBSCRIPTION_TIMEOUT_MS = 8_000;
const EMPTY_FEED_RECOVERY_TIMEOUT_MS = 4_000;

async function subscribeNewCommunities(communities: typeof communityStore.communities) {
  const newOnes = communities.filter(c => !subscribedFromHome.has(c.id));
  if (newOnes.length === 0) return;
  if (FEED_DEBUG) {
    feedDebug('subscribe-new-communities-start', {
      newCount: newOnes.length,
      communityIds: newOnes.map(c => c.id),
      alreadySubscribed: subscribedFromHome.size,
    });
  }
  newOnes.forEach(c => subscribedFromHome.add(c.id));
  const isFirstBatch = subscribedFromHome.size === newOnes.length;

  // Only show loading spinner if we have NO warmup data yet
  const didSetLoading = isFirstBatch && combinedFeed.value.length === 0;
  if (didSetLoading) isLoadingPosts.value = true;

  // Gun subscriptions may hang if relay is down — cap wait
  const subPromises = newOnes.flatMap(c => [
    postStore.loadPostsForCommunity(c.id),
    pollStore.loadPollsForCommunity(c.id),
  ]);
  let timerId: ReturnType<typeof setTimeout>;
  let timedOut = false;
  const timeout = new Promise<void>(r => {
    timerId = setTimeout(() => {
      timedOut = true;
      r();
    }, GUN_SUBSCRIPTION_TIMEOUT_MS);
  });

  try {
    await Promise.race([Promise.all(subPromises), timeout]);
  } catch (error) {
    console.error('[HomePage] Error subscribing to communities:', error);
  } finally {
    clearTimeout(timerId!);
    if (didSetLoading) isLoadingPosts.value = false;
    if (FEED_DEBUG) {
      feedDebug('subscribe-new-communities-complete', {
        timedOut,
        subscribedFromHome: subscribedFromHome.size,
        sortedPosts: postStore.sortedPosts.length,
        publicPolls: pollStore.sortedPolls.filter(p => !p.isPrivate).length,
        visibleCount: postStore.visibleCount,
        combinedFeedLength: combinedFeed.value.length,
      });
    }
    ensureInitialFeedVisible(timedOut ? 'subscription-timeout' : 'subscription-complete');
  }
}

async function tryRecoverEmptyFeedFromGun() {
  if (combinedFeed.value.length > 0) return;
  const fallbackCommunities = communityStore.communities.slice(0, 1);
  if (fallbackCommunities.length === 0) return;
  syncDebug('home-empty-feed-recovery-start', {
    communityIds: fallbackCommunities.map(c => c.id),
  });
  const recovery = Promise.allSettled(
    fallbackCommunities.flatMap(c => [
      postStore.loadPostsForCommunity(c.id),
      pollStore.loadPollsForCommunity(c.id),
    ]),
  );
  const timeout = new Promise<void>((resolve) => {
    setTimeout(resolve, EMPTY_FEED_RECOVERY_TIMEOUT_MS);
  });
  await Promise.race([recovery, timeout]);
  syncDebug('home-empty-feed-recovery-complete', {
    combinedFeedLength: combinedFeed.value.length,
    posts: postStore.sortedPosts.length,
    polls: pollStore.sortedPolls.filter(p => !p.isPrivate).length,
  });
}

async function showPostOptions() {
  if (joinedCommunities.value.length > 0) {
    const actionSheet = await actionSheetController.create({
      header: 'Select Community',
      buttons: [
        ...joinedCommunities.value.slice(0, 10).map(c => ({ text: c.displayName, handler: () => router.push(`/community/${c.id}/create-post`) })),
        { text: 'Cancel', role: 'cancel' }
      ]
    });
    await actionSheet.present();
  } else { activeTab.value = 'communities'; }
}

async function showPollOptions() {
  if (joinedCommunities.value.length > 0) {
    const actionSheet = await actionSheetController.create({
      header: 'Select Community',
      buttons: [
        ...joinedCommunities.value.slice(0, 10).map(c => ({ text: c.displayName, handler: () => router.push(`/create-poll?communityId=${c.id}`) })),
        { text: 'Cancel', role: 'cancel' }
      ]
    });
    await actionSheet.present();
  } else { activeTab.value = 'communities'; }
}

// ── Watchers & lifecycle ──────────────────────────────────────────────────────

watch(() => communityStore.communities.length, (newLen, oldLen) => {
  if (!HOME_GUN_FEED_ENABLED) return;
  if (!warmupComplete.value) return;
  if (newLen <= oldLen) return; // only subscribe when new communities added
  subscribeNewCommunities(communityStore.communities);
});

watch(activeTab, (tab) => {
  if (tab === 'home') {
    ensureInitialFeedVisible('home-tab-selected');
    return;
  }
  if (tab === 'chat') {
    void ensureChatInitialized();
  }
});

onMounted(async () => {
  // STEP 1: Fetch posts/polls/communities from API instantly
  const warmupStartedAt = Date.now();
  if (FEED_DEBUG) {
    feedDebug('warmup-start', {
      visibleCount: postStore.visibleCount,
      feedMode: feedMode.value,
    });
  }
  // GenosDB streams the feed via reactive store subscriptions — no warmup step needed.
  if (FEED_DEBUG) {
    feedDebug('warmup-finished', {
      durationMs: Date.now() - warmupStartedAt,
      sortedPosts: postStore.sortedPosts.length,
      publicPolls: pollStore.sortedPolls.filter(p => !p.isPrivate).length,
      combinedFeedLength: combinedFeed.value.length,
      visibleCount: postStore.visibleCount,
    });
  }
  ensureInitialFeedVisible('warmup-finished');

  // Warmup loaded communities while warmupComplete was false,
  // so the length-change watcher missed them. Subscribe before arming
  // the watcher so the two mechanisms handle strictly separate phases:
  // explicit call → warmup communities; watcher → later Gun arrivals.
  if (HOME_GUN_FEED_ENABLED && communityStore.communities.length > 0) {
    subscribeNewCommunities(communityStore.communities);
  }
  if (!HOME_GUN_FEED_ENABLED) {
    syncDebug('home-gun-feed-disabled (set localStorage.interpoll_home_gun_feed=true to enable)');
  }
  warmupComplete.value = true;

  // STEP 2: Feed communities — watcher handles any NEW ones Gun delivers later
  const feedPromise = (async () => {
    await communityStore.loadCommunities()
  })();

  // STEP 3: User + chat + chain — runs now if already logged in; otherwise the
  // auth watcher below fires it right after the user passes the identity gate.
  void initUserScopedServices();

  await feedPromise;
  if (!HOME_GUN_FEED_ENABLED && combinedFeed.value.length === 0) {
    await tryRecoverEmptyFeedFromGun();
    ensureInitialFeedVisible('empty-feed-recovery');
  }
  if (FEED_DEBUG) {
    feedDebug('onMounted-feed-ready', {
      sortedPosts: postStore.sortedPosts.length,
      publicPolls: pollStore.sortedPolls.filter(p => !p.isPrivate).length,
      combinedFeedLength: combinedFeed.value.length,
      hasMore: hasMore.value,
      visibleCount: postStore.visibleCount,
    });
  }
});

onUnmounted(() => {
  bgChatService?.disconnect();
  chatListUnsub?.();
});

if (FEED_DEBUG) {
  watch(
    () => [postStore.sortedPosts.length, pollStore.sortedPolls.filter(p => !p.isPrivate).length, postStore.visibleCount, combinedFeed.value.length],
    ([postCount, pollCount, visibleCount, combinedLength], [prevPostCount, prevPollCount, prevVisibleCount, prevCombinedLength]) => {
      feedDebug('feed-count-change', {
        postCount,
        pollCount,
        visibleCount,
        combinedLength,
        prevPostCount,
        prevPollCount,
        prevVisibleCount,
        prevCombinedLength,
        hasMore: hasMore.value,
      });
    },
  );
}
</script>

<style scoped>

.main-content { padding: 20px; }

.logo-title {
  font-family: inherit;
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.03em;
  margin-left: 20px;
  letter-spacing: 0.02em;
  --color: var(--app-text);
  padding-inline-start: 0;
  background: linear-gradient(to bottom, var(--app-heading-start), var(--app-heading-end));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

ion-header {
  transition: transform var(--app-transition);
}

ion-header::after {
  display: none;
}

ion-header ion-toolbar {
  --border-width: 0;
  --box-shadow: none;
}

ion-header.header-hidden {
  transform: translateY(-100%);
}

.feed-mode-toggle {
  display: inline-flex;
  gap: 8px;
  margin: 12px 16px 8px;
  padding: 5px;
}

.mode-btn {
  border: none;
  border-radius: 999px;
  padding: 8px 15px;
  font-size: 13px;
  font-weight: 600;
  color: var(--app-text-muted);
  background: transparent;
  cursor: pointer;
  transition: all var(--app-transition);
}

.mode-btn.active {
  color: #fff;
  background: linear-gradient(180deg, var(--app-accent-bright), var(--app-accent));
  box-shadow: 0 0 0 1px rgba(var(--app-accent-rgb), 0.38), 0 8px 24px rgba(var(--app-accent-rgb), 0.28);
}

.new-content-banner {
  position: sticky;
  top: 12px;
  z-index: 10;
  width: calc(100% - 32px);
  margin: 0 16px 16px;
  background: linear-gradient(180deg, var(--app-accent-bright), var(--app-accent));
  color: white;
  text-align: center;
  padding: 10px 16px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  border-radius: 14px;
  box-shadow: 0 0 0 1px rgba(var(--app-accent-rgb), 0.35), 0 12px 32px rgba(var(--app-accent-rgb), 0.24);
  animation: slideDown 0.25s ease;
  user-select: none;
}

@keyframes slideDown {
  from { transform: translateY(-100%); opacity: 0; }
  to   { transform: translateY(0);     opacity: 1; }
}

.page-layout {
  display: flex;
  align-items: flex-start;
  gap: 20px;
  position: relative;
}

.main-content {
  flex: 1;
  min-width: 0;
}

.side-nav  { display: none; }
.right-sidebar { display: none; }

.header-util-buttons {
  display: flex;
}

.side-nav-divider {
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.08), transparent);
  margin: 8px 12px;
  border-radius: 1px;
}

.loading-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 24px;
  gap: 16px;
  color: var(--app-text-muted);
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 64px 24px;
  text-align: center;
  gap: 8px;
}

.empty-state ion-icon,
.empty-chat-icon {
  color: var(--app-text-muted);
  margin-bottom: 10px;
  font-size: 4rem;
}

.empty-state p,
.empty-chat p {
  color: var(--app-text-muted);
  margin: 0;
}

.subtitle,
.empty-hint {
  font-size: 13px;
  color: var(--app-text-subtle);
}

.communities-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 20px 14px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.tab-bar { display: flex; }

.tab-btn {
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  padding: 8px 14px;
  font-size: 14px;
  font-weight: 500;
  color: var(--app-text-muted);
  cursor: pointer;
  transition: color var(--app-transition), border-color var(--app-transition);
}

.tab-btn.active {
  color: var(--app-accent-bright);
  border-bottom-color: var(--app-accent);
  font-weight: 700;
}

.section-label {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: var(--app-text-subtle);
  margin: 20px 16px 12px;
}

.create-options { display: flex; flex-direction: column; }

.create-option-item {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px 18px;
  cursor: pointer;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  transition:
    background var(--app-transition),
    transform var(--app-transition);
}

.create-option-item:hover {
  background: rgba(255, 255, 255, 0.04);
  transform: translateY(-1px);
}

.create-option-item:active {
  background: rgba(255, 255, 255, 0.06);
}

.create-icon-wrap {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  font-size: 20px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.1);
}

.create-icon-wrap.primary   { background: rgba(var(--app-accent-rgb), 0.12); color: var(--app-accent-bright); }
.create-icon-wrap.secondary { background: rgba(139, 92, 246, 0.12); color: rgb(167, 139, 250); }
.create-icon-wrap.tertiary  { background: rgba(124, 140, 255, 0.12); color: rgb(160, 173, 255); }

.option-content      { flex: 1; }
.option-content h3   { margin: 0 0 2px; font-size: 15px; font-weight: 600; }
.option-content p    { margin: 0; font-size: 13px; color: var(--app-text-muted); }
.chevron             { font-size: 18px; color: var(--app-text-muted); }

.quick-post-section  { margin-top: 8px; }
.quick-communities   { display: flex; flex-wrap: wrap; gap: 8px; padding: 0 16px 16px; }

.nav-item {
  position: relative;
}

.nav-item .nav-badge {
  position: absolute;
  top: -4px;
  right: 18px;
  background: linear-gradient(180deg, #fb7185, #ef4444);
  color: #fff;
  border-radius: 999px;
  font-size: 9px;
  font-weight: 700;
  padding: 2px 6px;
  min-width: 16px;
  text-align: center;
  line-height: 1.4;
  box-shadow: 0 8px 18px rgba(239, 68, 68, 0.32);
}

.nav-badge {
  background: linear-gradient(180deg, #fb7185, #ef4444);
  color: #fff;
  border-radius: 999px;
  font-size: 10px;
  padding: 2px 6px;
  margin-left: 4px;
  min-width: 16px;
  text-align: center;
  box-shadow: 0 8px 18px rgba(239, 68, 68, 0.24);
}

.nav-badge--desktop {
  top: -4px;
  right: 0;
}

.nav-badge--mobile {
  top: 0;
  right: 20px;
}

.bottom-nav-footer {
  display: block;
  background: transparent;
  box-shadow: none;
}

.bottom-nav {
  display: flex;
  justify-content: space-around;
  align-items: center;
  background: color-mix(in srgb, var(--app-bg-elevated) 78%, transparent);
  backdrop-filter: blur(22px) saturate(1.18);
  -webkit-backdrop-filter: blur(22px) saturate(1.18);
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  box-shadow: 0 -18px 40px rgba(0, 0, 0, 0.38), inset 0 1px 0 rgba(255, 255, 255, 0.06);
  padding: 8px 0 calc(8px + env(safe-area-inset-bottom));
  transition: transform var(--app-transition);
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
  color: var(--app-text-muted);
  transition: color var(--app-transition);
  flex: 1;
  max-width: 120px;
}
.nav-item ion-icon  { font-size: 22px; }
.nav-item span      { font-size: 11px; font-weight: 500; }
.nav-item.active    { color: var(--app-accent-bright); }
.nav-item.active span { font-weight: 700; }

.tab-intro { padding: 16px 16px 8px; }
.tab-intro h2 {
  margin: 0 0 4px;
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.02em;
}
.tab-intro p  { margin: 0; color: var(--app-text-muted); font-size: 14px; }

.user-search-box {
  margin: 0 16px 12px;
  padding: 6px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(255, 255, 255, 0.03);
}
.user-search-box ion-searchbar {
  --border-radius: 20px;
  border-radius: 20px;
}

.user-search-results {
  margin: 0 16px 16px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.03);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  overflow: hidden;
}

.search-results-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  font-size: 13px;
  font-weight: 600;
  color: var(--app-text-muted);
}

.clear-search-btn {
  background: none;
  border: none;
  color: var(--app-accent-bright);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.user-result-item {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 16px;
  cursor: pointer;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  transition: background var(--app-transition);
}
.user-result-item:hover { background: rgba(255, 255, 255, 0.04); }

.user-avatar {
  width: 46px;
  height: 46px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.08);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.user-avatar ion-icon { font-size: 46px; color: var(--app-text-muted); }

.user-info    { flex: 1; min-width: 0; }
.user-name    { font-weight: 600; font-size: 15px; margin-bottom: 2px; }
.user-username { font-size: 13px; color: var(--app-text-muted); }
.chat-icon    { font-size: 22px; color: var(--app-accent-bright); flex-shrink: 0; }

.no-users-found {
  text-align: center;
  padding: 32px 16px;
  color: var(--app-text-muted);
}

.searching-users {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 32px;
  gap: 12px;
  color: var(--app-text-muted);
}

.chat-list-header {
  padding: 10px 16px;
  font-size: 13px;
  font-weight: 600;
  color: var(--app-text-muted);
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.empty-chat {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 64px 32px;
  text-align: center;
  gap: 8px;
}

.chat-item {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 16px;
  background: rgba(255, 255, 255, 0.02);
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  cursor: pointer;
  transition: background var(--app-transition);
}
.chat-item:hover { background: rgba(255, 255, 255, 0.05); }

.chat-avatar {
  width: 46px;
  height: 46px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.08);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.chat-avatar ion-icon { font-size: 46px; color: var(--app-text-muted); }

.chat-info         { flex: 1; min-width: 0; }
.chat-header-row   { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
.chat-name         { font-weight: 600; font-size: 15px; }
.chat-time         { font-size: 12px; color: var(--app-text-subtle); }
.chat-preview      { font-size: 14px; color: var(--app-text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.unread-badge {
  background: linear-gradient(180deg, var(--app-accent-bright), var(--app-accent));
  color: #fff;
  border-radius: 12px;
  padding: 2px 8px;
  font-size: 12px;
  font-weight: 600;
  min-width: 20px;
  text-align: center;
  flex-shrink: 0;
  box-shadow: 0 8px 24px rgba(var(--app-accent-rgb), 0.28);
}

@media (min-width: 768px) {
  .logo-title { margin-left: 10%; }
  .bottom-nav-footer { display: none; }

  .header-util-buttons { display: none; }

  ion-header ion-toolbar {
    max-width: 100%;
    padding-inline-start: 32px;
    padding-inline-end: 32px;
  }

  .page-layout { gap: 24px; }

  .side-nav {
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: 200px;
    flex-shrink: 0;
    position: sticky;
    top: 24px;
    padding: 16px 12px;
  }

  .side-nav-item {
    display: flex;
    align-items: center;
    gap: 12px;
    background: none;
    border: none;
    padding: 10px 14px;
    border-radius: 12px;
    font-size: 15px;
    font-weight: 500;
    color: var(--app-text-muted);
    cursor: pointer;
    transition: var(--app-transition);
    text-align: left;
    width: 100%;
    position: relative;
  }
  .side-nav-item ion-icon { font-size: 20px; flex-shrink: 0; }

  .side-nav-item:hover {
    background: rgba(255, 255, 255, 0.05);
    color: var(--app-text);
  }

  .side-nav-item.active {
    background: rgba(var(--app-accent-rgb), 0.12);
    border: 1px solid rgba(var(--app-accent-rgb), 0.24);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.12), 0 12px 24px rgba(var(--app-accent-rgb), 0.12);
    color: var(--app-accent-bright);
    font-weight: 700;
  }

  .side-nav-util {
    font-size: 14px;
    padding: 8px 14px;
  }
  .side-nav-util ion-icon {
    font-size: 18px;
  }

  .chat-tab { max-width: 700px; margin: 0 auto; }
}

.side-nav-logout {
  margin-top: 4px;
  color: var(--app-danger);
}
.side-nav-logout:hover {
  background: rgba(var(--app-danger-rgb), 0.1);
  color: var(--app-danger);
}

/* Communities tab: distribute community cards across the width instead of a
   single vertical stack. Collapses naturally via auto-fill. */
.communities-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px;
  align-items: stretch;
}

@media (min-width: 1024px) {
  .page-layout { gap: 32px; }
  .side-nav    { width: 220px; }

  .right-sidebar {
    display: flex;
    flex-direction: column;
    gap: 12px;
    width: 280px;
    flex-shrink: 0;
    position: sticky;
    top: 24px;
    padding-top: 0;
    align-self: flex-start;
  }

  .sidebar-section {
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
    letter-spacing: 0.14em;
    color: var(--app-text-subtle);
  }

  .sidebar-link {
    background: none;
    border: none;
    font-size: 12px;
    color: var(--app-accent-bright);
    cursor: pointer;
    font-weight: 600;
    padding: 0;
  }

  .sidebar-community-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 14px;
    cursor: pointer;
    transition: background var(--app-transition);
    border-top: 1px solid rgba(255, 255, 255, 0.06);
  }
  .sidebar-community-item:hover { background: rgba(255, 255, 255, 0.04); }

  .sidebar-community-avatar {
    width: 32px;
    height: 32px;
    border-radius: 8px;
    background: rgba(var(--app-accent-rgb), 0.12);
    color: var(--app-accent-bright);
    font-size: 14px;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .sidebar-community-info  { flex: 1; min-width: 0; }
  .sidebar-community-name  { display: block; font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sidebar-community-meta  { display: block; font-size: 12px; color: var(--app-text-muted); }
  .joined-check            { font-size: 16px; color: var(--app-accent-bright); flex-shrink: 0; }

  .sidebar-about           { padding: 14px; }
  .sidebar-about-title     { font-family: inherit; font-size: 20px; font-weight: 700; margin: 0 0 6px; }
  .sidebar-about-text      { font-size: 12px; color: var(--app-text-muted); line-height: 1.6; margin: 0; }
}

@media (min-width: 1280px) {
  .side-nav      { width: 240px; }
  .right-sidebar { width: 300px; }
}
</style>
