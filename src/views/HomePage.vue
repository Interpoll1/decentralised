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

            <span v-if="totalUnread > 0" class="nav-badge" style="position:absolute; top:0px; right:0px; z-index:9999; background:red; color:white;">
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
          <button class="side-nav-item side-nav-util" @click="$router.push('/chain-explorer')">
            <ion-icon :icon="cube"></ion-icon>
            <span>Chain Explorer</span>
          </button>
          <button v-if="betaFeatures.resilience" class="side-nav-item side-nav-util" @click="$router.push('/resilience')">
            <ion-icon :icon="shieldOutline"></ion-icon>
            <span>Resilience <ion-badge color="warning" style="font-size: 9px; vertical-align: super; margin-left: 4px;">BETA</ion-badge></span>
          </button>
        </nav>

        <!-- ── MAIN CONTENT ────────────────────────────── -->
        <main class="main-content">

          <!-- HOME TAB -->
          <div v-if="activeTab === 'home'" class="home-tab">
            <div class="feed-mode-toggle">
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
                <ion-icon :icon="chatbubbleOutline" style="font-size: 4rem; color: var(--ion-color-medium);"></ion-icon>
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
      <button class="nav-item" :class="{ active: activeTab === 'chat' }" @click="activeTab = 'chat'">
        <ion-icon :icon="activeTab === 'chat' ? chatbubble : chatbubbleOutline"></ion-icon>
        <span>Chat</span>
        <span v-if="totalUnread > 0" class="nav-badge" style="position:absolute; top:0px; right:20px; z-index:9999; background:red; color:white;">
          {{ totalUnread > 99 ? '99+' : totalUnread }}
        </span>
      </button>
      <button class="nav-item" :class="{ active: activeTab === 'create' }" @click="activeTab = 'create'">
        <ion-icon :icon="activeTab === 'create' ? addCircle : addCircleOutline"></ion-icon>
        <span>Create</span>
      </button>
    </div>

  </ion-page>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import {
  IonPage, IonHeader, IonToolbar, IonTitle, IonContent,IonBadge,  
  IonButtons, IonButton, IonIcon, IonSegment, IonSegmentButton,
  IonLabel, IonSpinner, IonChip, IonSearchbar,
  IonInfiniteScroll, IonInfiniteScrollContent,
  actionSheetController, toastController
} from '@ionic/vue';
import {
  cube, personCircleOutline, settingsOutline, addCircleOutline,
  earthOutline, peopleOutline, home, homeOutline, documentTextOutline,
  chevronForwardOutline, people, addCircle, statsChartOutline,
  checkmarkCircleOutline, searchOutline, chatbubble, chatbubbleOutline,
  shieldOutline
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
import { GunService } from '../services/gunService';
import { UserService } from '../services/userService';
import ChatService from '../services/chatService';
import { warmupFromDB } from '../services/dbWarmup';
import { betaFeatures } from '../utils/betaFeatures';
import config from '../config';

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

const joinedCommunities = computed(() => communityStore.communities.filter(c => communityStore.isJoined(c.id)));

const sidebarCommunities = computed(() =>
  communityStore.communities.slice(0, 8)
)

// ── Chat list ─────────────────────────────────────────────────────────────────

function getRoomId(a: string, b: string) {
  return [a, b].sort().join(':');
}

const unreadDebounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

function recomputeUnread(roomId: string, otherUserId: string) {
  // Debounce per room — only compute after 500ms of no new messages
  const existing = unreadDebounceTimers.get(roomId);
  if (existing) clearTimeout(existing);
  unreadDebounceTimers.set(roomId, setTimeout(() => {
    const gun = GunService.getGun();
    let unread = 0;
    gun.get('chats').get(roomId).map().once((msg: any) => {
      if (msg && msg.recipientId === currentUserId && !msg.readAt) unread++;
    });
    setTimeout(() => {
      const entry = chatList.value.find(c => c.userId === otherUserId);
      if (entry) entry.unreadCount = unread;
      chatList.value = [...chatList.value].sort((a, b) => b.lastMessageTime - a.lastMessageTime);
    }, 300);
  }, 500));
}

function subscribeToRoom(otherUserId: string, otherName: string, otherPublicKey: string) {
  const gun    = GunService.getGun();
  const roomId = getRoomId(currentUserId, otherUserId);

  if (!chatList.value.find(c => c.userId === otherUserId)) {
    chatList.value.push({
      userId: otherUserId, name: otherName,
      lastMessage: '', lastMessageTime: 0,
      unreadCount: 0, publicKey: otherPublicKey,
    });
  }

  const listener = gun.get('chats').get(roomId).map().on((msg: any) => {
    if (!msg || !msg.senderId || !msg.timestamp) return;
    const entry = chatList.value.find(c => c.userId === otherUserId);
    if (!entry) return;
    if (msg.timestamp > entry.lastMessageTime) {
      entry.lastMessageTime = msg.timestamp;
      entry.lastMessage     = msg.senderId === currentUserId ? 'You: [Encrypted]' : '[Encrypted message]';
    }
    recomputeUnread(roomId, otherUserId);
  });

  gunListeners.push(() => listener?.off?.());
}

async function loadChatList() {
  const gun = GunService.getGun();
  gun.get('chats').once((rooms: any) => {
    if (!rooms) return;
    Object.keys(rooms)
      .filter(k => k !== '_' && k.includes(currentUserId))
      .forEach((roomId) => {
        const otherUserId = roomId.split(':').find(id => id !== currentUserId);
        if (!otherUserId) return;
        gun.get('users').get(otherUserId).once((userData: any) => {
          subscribeToRoom(
            otherUserId,
            userData?.displayName || userData?.username || otherUserId,
            userData?.publicKey || '',
          );
        });
      });
  });
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
      const gun = GunService.getGun();
      gun.get('users').get(msg.from).once((userData: any) => {
        const e = chatList.value.find(c => c.userId === msg.from);
        if (e && userData) {
          e.name      = userData.displayName || userData.username || msg.from;
          e.publicKey = userData.publicKey || '';
        }
      });
      subscribeToRoom(msg.from, msg.from, '');
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
    const gun     = GunService.getGun();
    const results: typeof userSearchResults.value = [];
    const seen    = new Set<string>();
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => resolve(), 1000);
      gun.get('users').once((users: any) => {
        if (!users) { resolve(); return; }
        const userKeys = Object.keys(users).filter(k => k !== '_');
        let processed  = 0;
        userKeys.forEach(userId => {
          gun.get('users').get(userId).once((userData: any) => {
            processed++;
            if (userData && userData.id && !seen.has(userData.id)) {
              const name     = userData.displayName || userData.username || '';
              const username = userData.username || '';
              if (name.toLowerCase().includes(query.toLowerCase()) ||
                  username.toLowerCase().includes(query.toLowerCase())) {
                seen.add(userData.id);
                results.push({ id: userData.id, name: userData.displayName || userData.username || 'Anonymous', username: userData.username || userData.id, publicKey: userData.publicKey || '' });
              }
            }
            if (processed === userKeys.length) { clearTimeout(timeout); resolve(); }
          });
        });
      });
    });
    userSearchResults.value = results.slice(0, 10);
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
  postStore.loadMorePosts();
  await new Promise(r => setTimeout(r, 100));
  event.target.complete();
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

async function subscribeNewCommunities(communities: typeof communityStore.communities) {
  const newOnes = communities.filter(c => !subscribedFromHome.has(c.id));
  if (newOnes.length === 0) return;
  newOnes.forEach(c => subscribedFromHome.add(c.id));
  if (subscribedFromHome.size === newOnes.length) isLoadingPosts.value = true;
  try {
    await Promise.all(newOnes.flatMap(c => [postStore.loadPostsForCommunity(c.id), pollStore.loadPollsForCommunity(c.id)]));
  } catch (error) { console.error('[HomePage] Error subscribing to communities:', error); }
  finally { isLoadingPosts.value = false; }
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
  if (!warmupComplete.value) return;
  if (newLen <= oldLen) return; // only subscribe when new communities added
  subscribeNewCommunities(communityStore.communities);
});

watch(activeTab, (tab) => {
  if (tab === 'home') {
    postStore.visibleCount = 10;
    pollStore.visibleCount = 10;
  }
});

onMounted(async () => {
  // STEP 1: Fetch posts/polls/communities from API instantly
  await warmupFromDB();

  // Warmup loaded communities while warmupComplete was false,
  // so the length-change watcher missed them. Subscribe before arming
  // the watcher so the two mechanisms handle strictly separate phases:
  // explicit call → warmup communities; watcher → later Gun arrivals.
  if (communityStore.communities.length > 0) {
    subscribeNewCommunities(communityStore.communities);
  }
  warmupComplete.value = true;

  // STEP 2: Feed communities — watcher handles any NEW ones Gun delivers later
  const feedPromise = (async () => {
    await communityStore.loadCommunities()
  })();

  // STEP 3: User + chat + chain — all parallel, never block feed
  ;(async () => {
    try {
      const currentUser = await UserService.getCurrentUser();
      currentUserId = currentUser.id;
      // All three in parallel — if chat fails, chain still works
      await Promise.allSettled([
        chainStore.initialize(),
        loadChatList(),
        initBackgroundChat(),
      ]);
    } catch (err) {
      console.warn('Heavy init error (non-critical):', err);
    }
  })();

  await feedPromise;
});

onUnmounted(() => {
  bgChatService?.disconnect();
  gunListeners.forEach(off => off());
  unreadDebounceTimers.forEach(t => clearTimeout(t));
  unreadDebounceTimers.clear();
});
</script>

<style scoped>

@import url('https://fonts.googleapis.com/css2?family=Grand+Hotel&display=swap');

.logo-title {
  font-family: 'Grand Hotel', cursive;
  font-size: 32px;
  margin-left: 20px;
  letter-spacing: 0.5px;
  padding-inline-start: 0;
  --color: var(--ion-text-color);
}

ion-header {
  transition: transform 0.3s ease;
}
ion-header::after {
  display: none;
}
ion-header ion-toolbar {
  --border-width: 0;
  --box-shadow: none;
  border-bottom: 1px solid var(--glass-border-bottom);
}
ion-header.header-hidden {
  transform: translateY(-100%);
}

.feed-mode-toggle {
  display: inline-flex;
  gap: 6px;
  margin: 12px 16px 8px;
  padding: 4px;
  border-radius: 999px;
  border: 1px solid var(--glass-border);
  background: rgba(var(--ion-card-background-rgb), 0.22);
  backdrop-filter: blur(10px) saturate(1.3);
  -webkit-backdrop-filter: blur(10px) saturate(1.3);
}

.mode-btn {
  border: none;
  border-radius: 999px;
  padding: 6px 14px;
  font-size: 13px;
  font-weight: 600;
  color: var(--ion-color-medium);
  background: transparent;
  cursor: pointer;
  transition: all 0.15s ease;
}

.mode-btn.active {
  color: #fff;
  background: var(--ion-color-primary);
}

.new-content-banner {
  position: sticky;
  top: 0;
  z-index: 10;
  background: var(--ion-color-primary);
  color: white;
  text-align: center;
  padding: 10px 16px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  border-radius: 0 0 12px 12px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.2);
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
  max-width: 1200px;
  margin: 0 auto;
  position: relative;
}

.main-content {
  flex: 1;
  min-width: 0;
}

.side-nav  { display: none; }
.right-sidebar { display: none; }

/* Header utility buttons: visible on mobile, hidden on desktop */
.header-util-buttons {
  display: flex;
}

/* ── Side nav divider ── */
.side-nav-divider {
  height: 1px;
  background: var(--glass-border-bottom);
  margin: 8px 12px;
  border-radius: 1px;
}

/* ── Loading / Empty ── */
.loading-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 24px;
  gap: 16px;
  color: var(--ion-color-medium);
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 64px 24px;
  text-align: center;
  gap: 6px;
}
.empty-state ion-icon { color: var(--ion-color-medium); margin-bottom: 10px; }
.empty-state p        { color: var(--ion-color-medium); margin: 0; }
.subtitle             { font-size: 13px; }

/* ── Communities toolbar ── */
.communities-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--glass-border-bottom);
}

.tab-bar { display: flex; }

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

/* ── Create Tab ── */
.section-label {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--ion-color-medium);
  margin: 20px 16px 10px;
}

.create-options { display: flex; flex-direction: column; }

.create-option-item {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 16px;
  cursor: pointer;
  border-bottom: 1px solid var(--glass-border-bottom);
  transition: background 0.15s;
}
.create-option-item:active { background: rgba(var(--ion-text-color-rgb), 0.04); }

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
.create-icon-wrap.primary   { background: rgba(var(--ion-color-primary-rgb),   0.12); color: var(--ion-color-primary); }
.create-icon-wrap.secondary { background: rgba(var(--ion-color-secondary-rgb), 0.12); color: var(--ion-color-secondary); }
.create-icon-wrap.tertiary  { background: rgba(var(--ion-color-tertiary-rgb),  0.12); color: var(--ion-color-tertiary); }

.option-content      { flex: 1; }
.option-content h3   { margin: 0 0 2px; font-size: 15px; font-weight: 600; }
.option-content p    { margin: 0; font-size: 13px; color: var(--ion-color-medium); }
.chevron             { font-size: 18px; color: var(--ion-color-medium); }

.quick-post-section  { margin-top: 8px; }
.quick-communities   { display: flex; flex-wrap: wrap; gap: 8px; padding: 0 16px 16px; }

.nav-item {
  position: relative;
}
.nav-item .nav-badge {
  position: absolute;
  top: -2px;
  right: 18px;
  background: var(--ion-color-danger);
  color: #fff;
  border-radius: 10px;
  font-size: 9px;
  font-weight: 700;
  padding: 1px 5px;
  min-width: 16px;
  text-align: center;
  line-height: 1.4;
}

/* ── Nav Badge ── */
.nav-badge {
  background: var(--ion-color-danger);
  color: #fff;
  border-radius: 10px;
  font-size: 10px;
  padding: 1px 5px;
  margin-left: 4px;
  min-width: 16px;
  text-align: center;
}

/* ── Bottom Spacing ── */
.bottom-spacing { height: 80px; }

/* ── Mobile Bottom Nav ── */
.bottom-nav {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  display: flex;
  justify-content: space-around;
  align-items: center;
  background: rgba(var(--ion-background-color-rgb), 0.60);
  backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturation));
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturation));
  border-top: 1px solid var(--glass-border);
  box-shadow: inset 0 1px 0 var(--glass-border-top);
  padding: 8px 0 calc(8px + env(safe-area-inset-bottom));
  z-index: 1000;
  transition: transform 0.3s ease;
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
.nav-item ion-icon  { font-size: 22px; }
.nav-item span      { font-size: 11px; font-weight: 500; }
.nav-item.active    { color: var(--ion-color-primary); }
.nav-item.active span { font-weight: 700; }

/* ── Chat Tab ── */
.tab-intro { padding: 16px 16px 8px; }
.tab-intro h2 { margin: 0 0 4px; font-size: 22px; font-weight: 700; }
.tab-intro p  { margin: 0; color: var(--ion-color-medium); font-size: 14px; }

.user-search-box {
  padding: 8px 8px;
  border-radius: 999px;
  border-bottom: 1px solid var(--glass-border-bottom);
}
.user-search-box ion-searchbar {
  --border-radius: 20px;
  border-radius: 20px;
}

.user-search-results {
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}

.search-results-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 16px;
  border-bottom: 1px solid var(--glass-border-bottom);
  font-size: 13px;
  font-weight: 600;
  color: var(--ion-color-medium);
}

.clear-search-btn {
  background: none;
  border: none;
  color: var(--ion-color-primary);
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
  border-bottom: 1px solid var(--glass-border-bottom);
  transition: background 0.15s;
}
.user-result-item:hover { background: rgba(var(--ion-card-background-rgb), 0.35); }

.user-avatar {
  width: 46px;
  height: 46px;
  border-radius: 50%;
  background: rgba(var(--ion-card-background-rgb), 0.28);
  border: 1px solid var(--glass-border);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.user-avatar ion-icon { font-size: 46px; color: var(--ion-color-medium); }

.user-info    { flex: 1; min-width: 0; }
.user-name    { font-weight: 600; font-size: 15px; margin-bottom: 2px; }
.user-username { font-size: 13px; color: var(--ion-color-medium); }
.chat-icon    { font-size: 22px; color: var(--ion-color-primary); flex-shrink: 0; }

.no-users-found {
  text-align: center;
  padding: 32px 16px;
  color: var(--ion-color-medium);
}

.searching-users {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 32px;
  gap: 12px;
  color: var(--ion-color-medium);
}
.user-search-box{
  border-radius: 999px;
}
html.dark .user-search-box ion-searchbar {
  --background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.10);
}
.chat-list-header {
  padding: 10px 16px;
  font-size: 13px;
  font-weight: 600;
  color: var(--ion-color-medium);
  border-bottom: 1px solid var(--glass-border-bottom);
}

.empty-chat {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 64px 32px;
  text-align: center;
  gap: 8px;
}
.empty-chat p    { margin: 0; color: var(--ion-color-medium); }
.empty-hint      { font-size: 13px; }

.chat-item {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 16px;
  background: rgba(var(--ion-card-background-rgb), 0.18);
  border-bottom: 1px solid var(--glass-border-bottom);
  cursor: pointer;
  transition: background 0.15s;
}
.chat-item:hover { background: rgba(var(--ion-card-background-rgb), 0.35); }

.chat-avatar {
  width: 46px;
  height: 46px;
  border-radius: 50%;
  background: rgba(var(--ion-card-background-rgb), 0.28);
  border: 1px solid var(--glass-border);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.chat-avatar ion-icon { font-size: 46px; color: var(--ion-color-medium); }

.chat-info         { flex: 1; min-width: 0; }
.chat-header-row   { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
.chat-name         { font-weight: 600; font-size: 15px; }
.chat-time         { font-size: 12px; color: var(--ion-color-medium); }
.chat-preview      { font-size: 14px; color: var(--ion-color-medium); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.unread-badge {
  background: var(--ion-color-primary);
  color: #fff;
  border-radius: 12px;
  padding: 2px 8px;
  font-size: 12px;
  font-weight: 600;
  min-width: 20px;
  text-align: center;
  flex-shrink: 0;
}

/* ══════════════════════════════════════════════════
   Tablet (768px+)
   ══════════════════════════════════════════════════ */
@media (min-width: 768px) {
  .logo-title { margin-left: 10%; }
  .bottom-nav     { display: none; }
  .bottom-spacing { height: 24px; }

  /* Hide header utility buttons — they live in the side-nav now */
  .header-util-buttons { display: none; }

  ion-header ion-toolbar {
    max-width: 100%;
    padding-inline-start: 32px;
    padding-inline-end: 32px;
  }

  .page-layout { padding: 0 16px; gap: 24px; }

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
    border-radius: 12px;
    font-size: 15px;
    font-weight: 500;
    color: var(--ion-color-medium);
    cursor: pointer;
    transition: var(--liquid-transition);
    text-align: left;
    width: 100%;
    position: relative;
  }
  .side-nav-item ion-icon { font-size: 20px; flex-shrink: 0; }

  .side-nav-item:hover {
    background: rgba(var(--ion-text-color-rgb), 0.06);
    color: var(--ion-text-color);
  }

  .side-nav-item.active {
    background: rgba(var(--ion-color-primary-rgb), 0.12);
    backdrop-filter: blur(12px) saturate(1.4);
    -webkit-backdrop-filter: blur(12px) saturate(1.4);
    border: 1px solid rgba(var(--ion-color-primary-rgb), 0.20);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.20);
    color: var(--ion-color-primary);
    font-weight: 700;
  }

  /* Utility nav items: slightly smaller / more muted than primary nav */
  .side-nav-util {
    font-size: 14px;
    padding: 8px 14px;
  }
  .side-nav-util ion-icon {
    font-size: 18px;
  }

  .chat-tab { max-width: 700px; margin: 0 auto; }
}

/* ══════════════════════════════════════════════════
   Desktop (1024px+)
   ══════════════════════════════════════════════════ */
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
    top: 16px;
    padding-top: 16px;
    align-self: flex-start;
  }

  .sidebar-section {
    background: rgba(var(--ion-card-background-rgb), 0.28);
    backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturation));
    -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturation));
    border: 1px solid var(--glass-border);
    border-top-color: var(--glass-border-top);
    border-bottom-color: var(--glass-border-bottom);
    border-radius: 16px;
    box-shadow: var(--glass-shadow), var(--glass-highlight), var(--glass-inner-glow);
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

  .sidebar-create-btn { margin: 0 10px 10px; }

  .sidebar-community-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 14px;
    cursor: pointer;
    transition: background 0.15s;
    border-top: 1px solid var(--glass-border-bottom);
  }
  .sidebar-community-item:hover { background: rgba(var(--ion-card-background-rgb), 0.35); }

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

  .sidebar-community-info  { flex: 1; min-width: 0; }
  .sidebar-community-name  { display: block; font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sidebar-community-meta  { display: block; font-size: 12px; color: var(--ion-color-medium); }
  .joined-check            { font-size: 16px; color: var(--ion-color-primary); flex-shrink: 0; }

  .sidebar-about           { padding: 14px; }
  .sidebar-about-title     { font-family: 'Grand Hotel', cursive; font-size: 20px; margin: 0 0 6px; }
  .sidebar-about-text      { font-size: 12px; color: var(--ion-color-medium); line-height: 1.5; margin: 0; }
}

/* ══════════════════════════════════════════════════
   Large Desktop (1280px+)
   ══════════════════════════════════════════════════ */
@media (min-width: 1280px) {
  .side-nav      { width: 240px; }
  .right-sidebar { width: 300px; }
}
</style>
