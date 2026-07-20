<template>
  <ion-page>
    <ion-header :class="{ 'header-hidden': isHeaderHidden }">
      <ion-toolbar>
        <ion-title class="logo-title">InterPoll</ion-title>
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
          <button class="side-nav-item side-nav-util" @click="$router.push('/chain-explorer')">
            <ion-icon :icon="cube"></ion-icon>
            <span>Chain Explorer</span>
          </button>
          <button class="side-nav-item side-nav-util" @click="$router.push('/resilience')">
            <ion-icon :icon="shieldOutline"></ion-icon>
            <span>Resilience Center</span>
          </button>
        </nav>

        <!-- ── MAIN CONTENT ────────────────────────────── -->
        <main class="main-content surface-card">

          <!-- HOME TAB -->
          <div v-if="activeTab === 'home'" class="home-tab">
            <section v-if="tutorialVisible" class="tutorial-card surface-card">
              <div class="tutorial-card__header">
                <span class="tutorial-card__eyebrow">Quick tour</span>
                <button class="tutorial-card__dismiss" @click="skipTutorial">Skip</button>
              </div>

              <div class="tutorial-card__body">
                <p class="tutorial-card__step">Step {{ tutorialStep + 1 }} of {{ tutorialSteps.length }}</p>
                <h3>{{ currentTutorialStep.title }}</h3>
                <p>{{ currentTutorialStep.body }}</p>
                <ul class="tutorial-card__list">
                  <li v-for="item in currentTutorialStep.bullets" :key="item">{{ item }}</li>
                </ul>
              </div>

              <div class="tutorial-card__actions">
                <button class="tutorial-card__secondary" @click="previousTutorialStep">Back</button>
                <button class="tutorial-card__primary" @click="nextTutorialStep">
                  {{ tutorialStep === tutorialSteps.length - 1 ? 'Finish' : 'Next' }}
                </button>
              </div>
            </section>

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
                  :show-moderation-action="ModerationService.canSubmitHashesFromHome()"
                  moderation-action-title="Send this post body hash to the moderation API"
                  @click="navigateToPost(item.data)"
                  @upvote="handleUpvote(item.data)"
                  @downvote="handleDownvote(item.data)"
                  @moderation-submit="handleModerationSubmit(item.data)"
                  @comments="navigateToPost(item.data)"
                />
                <PollCard
                  v-else-if="item.type === 'poll'"
                  :poll="item.data"
                  :community-name="getCommunityName(item.data.communityId)"
                    :show-moderation-action="ModerationService.canSubmitHashesFromHome()"
                    moderation-action-title="Send this poll text to the moderation API"
                    @click="navigateToPoll(item.data)"
                    @vote="navigateToPoll(item.data)"
                    @moderation-submit="handleModerationSubmitPoll(item.data)"
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

            <div v-else-if="displayedCommunities.length > 0" class="communities-list-scrollable">
  <ion-searchbar
    v-model="communitySearchQuery"
    placeholder="Search communities..."
    @ionInput="handleCommunitySearch"
    debounce="300"
    class="community-search-bar"
  ></ion-searchbar>
  <CommunityCard
    v-for="community in filteredCommunities"
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

          <div class="sidebar-section sidebar-about surface-card">
            <p class="sidebar-about-title">Interpoll</p>
            <p class="sidebar-about-text">A peer-to-peer community platform built on GunDB. Posts and votes sync across all peers.</p>
          </div>
        </aside>

      </div>

    </ion-content>

    <ion-modal
      :is-open="moderationOnboardingOpen"
      :backdrop-dismiss="false"
      class="moderation-onboarding-modal"
      @didDismiss="handleModerationModalDismiss"
    >
      <div class="moderation-onboarding-modal__shell">
        <section class="moderation-onboarding-card surface-card">
          <div class="moderation-onboarding-card__hero">
            <div class="moderation-onboarding-card__badge">
              <ion-icon :icon="shieldCheckmarkOutline"></ion-icon>
            </div>
            <div class="moderation-onboarding-card__hero-copy">
              <p class="moderation-onboarding-card__eyebrow">Optional feed cleanup</p>
              <h2>Want Home to feel a little calmer?</h2>
              <p>
                We can quietly hide posts that a moderation service has already flagged so your feed is easier to read.
                It checks only the post text hash — not your username or profile.
              </p>
            </div>
          </div>

          <div class="moderation-onboarding-card__highlights">
            <div class="moderation-onboarding-card__highlight">
              <ion-icon :icon="sparklesOutline"></ion-icon>
              <span>Cleaner Home feed</span>
            </div>
            <div class="moderation-onboarding-card__highlight">
              <ion-icon :icon="eyeOffOutline"></ion-icon>
              <span>Hide unwanted posts before they appear</span>
            </div>
            <div class="moderation-onboarding-card__highlight">
              <ion-icon :icon="linkOutline"></ion-icon>
              <span>You can switch it off anytime in Settings</span>
            </div>
          </div>

          <div class="moderation-onboarding-card__choices">
            <button
              class="moderation-choice moderation-choice--recommended"
              :class="{ active: moderationChoice === 'default' }"
              @click="moderationChoice = 'default'"
            >
              <span class="moderation-choice__tag">Recommended</span>
              <strong>Use the built-in filter</strong>
              <span>Best for most people. One tap, no setup.</span>
            </button>

            <button
              class="moderation-choice"
              :class="{ active: moderationChoice === 'custom' }"
              @click="moderationChoice = 'custom'"
            >
              <span class="moderation-choice__tag moderation-choice__tag--soft">Advanced</span>
              <strong>I already have my own moderation service</strong>
              <span>Paste the address below and we&apos;ll use that instead.</span>
            </button>
          </div>

          <div v-if="moderationChoice === 'custom'" class="moderation-onboarding-card__custom">
            <label for="moderation-api-url">Moderation API address</label>
            <input
              id="moderation-api-url"
              ref="moderationCustomApiInput"
              v-model="moderationCustomApiUrl"
              type="url"
              inputmode="url"
              placeholder="https://interpoll.endless.sbs/moderation"
              @input="moderationCustomApiError = ''"
            >
            <p class="moderation-onboarding-card__hint">
              This should be the base address of your moderation API.
            </p>
            <p v-if="moderationCustomApiError" class="moderation-onboarding-card__error">
              {{ moderationCustomApiError }}
            </p>
          </div>

          <div class="moderation-onboarding-card__actions">
            <button class="moderation-onboarding-card__secondary" @click="skipModerationOnboarding">
              No thanks, show everything
            </button>
            <button class="moderation-onboarding-card__primary" :disabled="moderationSaving" @click="confirmModerationOnboarding">
              {{ moderationSaving ? 'Saving…' : moderationChoice === 'custom' ? 'Use this address' : 'Turn on feed filter' }}
            </button>
          </div>

          <p class="moderation-onboarding-card__footer">
            You can change this later in <strong>Settings → General</strong>.
          </p>
        </section>
      </div>
    </ion-modal>

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
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue';
import {
  IonPage, IonHeader, IonToolbar, IonTitle, IonContent,IonBadge,  
  IonButtons, IonButton, IonIcon, IonSegment, IonSegmentButton, IonFooter, IonModal,
  IonLabel, IonSpinner, IonChip, IonSearchbar,
  IonInfiniteScroll, IonInfiniteScrollContent,
  actionSheetController, toastController
} from '@ionic/vue';
import {
  cube, personCircleOutline, settingsOutline, addCircleOutline,
  earthOutline, peopleOutline, home, homeOutline, documentTextOutline,
  chevronForwardOutline, people, addCircle, statsChartOutline,
  checkmarkCircleOutline, searchOutline, chatbubble, chatbubbleOutline,
  shieldOutline, shieldCheckmarkOutline, sparklesOutline, eyeOffOutline, linkOutline
} from 'ionicons/icons';
import { useRoute, useRouter } from 'vue-router';
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
import { ChatInviteService } from '../services/chatInviteService';
import { warmupFromDB } from '../services/dbWarmup';
import { ModerationService, moderationVersion, MODERATION_API_DEFAULT_BASE_URL } from '../services/moderationService';
import config from '../config';

const router = useRouter();
const route = useRoute();
const chainStore = useChainStore();
const communityStore = useCommunityStore();
const postStore = usePostStore();
const pollStore = usePollStore();

const FEED_DEBUG = localStorage.getItem('interpoll_feed_debug') === 'true';
const SYNC_DEBUG = localStorage.getItem('interpoll_sync_debug') === 'true';
// Home's live Gun feed is ON by default — without it, newly created polls/posts
// never reach the home feed (they only exist in Gun until the DB/API snapshot
// catches up), so they appeared only after visiting the community page.
// Opt out with localStorage.interpoll_home_gun_feed = 'false'.
const HOME_GUN_FEED_ENABLED = localStorage.getItem('interpoll_home_gun_feed') !== 'false';
// Bound the startup fan-out that motivated disabling this in the first place.
const HOME_GUN_FEED_MAX_COMMUNITIES = 8;
const FEED_INITIAL_RENDER_TARGET = 50;
const TUTORIAL_STORAGE_KEY = 'interpoll_home_tutorial_seen';
const MODERATION_ONBOARDING_KEY = 'interpoll_moderation_onboarding_complete';

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

const HOME_TABS = ['home', 'communities', 'chat', 'create'] as const;
type HomeTab = typeof HOME_TABS[number];
function tabFromRoute(): HomeTab {
  const raw = route.query.tab;
  const value = Array.isArray(raw) ? raw[0] : raw;
  return HOME_TABS.includes(value as HomeTab) ? (value as HomeTab) : 'home';
}

const activeTab = ref<string>(tabFromRoute());
const communityFilter = ref('all');

// Keep the tab reflected in the URL so refresh/back/share all restore the view.
watch(activeTab, (tab) => {
  if (route.name !== 'Home' || tab === tabFromRoute()) return;
  void router.push({ query: { ...route.query, tab: tab === 'home' ? undefined : tab } });
});
watch(() => route.query.tab, () => {
  if (route.name !== 'Home') return;
  const tab = tabFromRoute();
  if (activeTab.value !== tab) activeTab.value = tab;
});
const isLoadingPosts = ref(false);
const voteVersion = ref(0);
const isHeaderHidden = ref(false);
const isTabBarHidden = ref(false);
const warmupComplete = ref(false);
const tutorialVisible = ref(localStorage.getItem(TUTORIAL_STORAGE_KEY) !== 'true');
const tutorialStep = ref(0);
const moderationOnboardingOpen = ref(false);
const moderationChoice = ref<'default' | 'custom'>('default');
const moderationCustomApiUrl = ref('');
const moderationCustomApiInput = ref<HTMLInputElement | null>(null);
const moderationCustomApiError = ref('');
const moderationSaving = ref(false);
const tutorialSteps = [
  {
    title: 'See what\'s new in your interests',
    body: 'Your home feed shows you all the latest polls and discussions. You can sort by "For You" (topics you follow) or "Latest" (brand new posts).',
    bullets: [
      '"For You" — see posts from communities you joined',
      '"Latest" — see the newest posts from everyone',
      'Tap the notification banner to refresh and see new posts'
    ]
  },
  {
    title: 'Join communities or create your own',
    body: 'Communities are groups organized around topics. Join a few to see their posts in your feed, or start a new one.',
    bullets: [
      'Browse all communities and join ones you like',
      'Search to find a community by name',
      'Create a new community if you don\'t find what you\'re looking for'
    ]
  },
  {
    title: 'Message people directly',
    body: 'Use Chat to send direct messages to other users. You can have quick one-on-one conversations here.',
    bullets: [
      'Search for people by their name or username',
      'See your recent conversations in one place',
      'Unread messages show up as badges'
    ]
  },
  {
    title: 'Create polls, posts, and communities',
    body: 'The Create button (plus icon) is how you add things. Start a poll to ask for opinions, share a post, or launch a new community.',
    bullets: [
      'Start a poll to get feedback from others',
      'Share a post to discuss news or ideas',
      'Create a community for a topic that matters to you'
    ]
  }
];
const currentTutorialStep = computed(() => tutorialSteps[tutorialStep.value]);
let lastScrollTop = 0;
const scrollThreshold = 50;

// Add after the activeTab ref
const feedMode = ref<'for-you' | 'latest'>('for-you')
function setFeedMode(mode: 'for-you' | 'latest') {
  feedMode.value = mode
}

function isValidModerationApiUrl(url: string): boolean {
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function openModerationOnboarding() {
  if (localStorage.getItem(MODERATION_ONBOARDING_KEY) === 'true') return;
  if (moderationOnboardingOpen.value) return;
  moderationChoice.value = 'default';
  moderationCustomApiUrl.value = '';
  moderationCustomApiError.value = '';
  moderationOnboardingOpen.value = true;
}

watch(moderationChoice, async (choice) => {
  if (choice !== 'custom') return;
  moderationCustomApiError.value = '';
  await nextTick();
  moderationCustomApiInput.value?.focus();
  moderationCustomApiInput.value?.select?.();
});

function closeModerationOnboarding() {
  moderationOnboardingOpen.value = false;
}

function saveModerationChoiceEnabled(provider: 'interpoll' | 'custom', baseUrl: string) {
  ModerationService.saveSettings({
    moderateHomeFeed: true,
    moderationProvider: provider,
    moderationApiBaseUrl: baseUrl,
  });
  localStorage.setItem(MODERATION_ONBOARDING_KEY, 'true');
  closeModerationOnboarding();
}

function skipModerationOnboarding() {
  ModerationService.saveSettings({
    moderateHomeFeed: false,
    moderationProvider: 'interpoll',
    moderationApiBaseUrl: MODERATION_API_DEFAULT_BASE_URL,
  });
  localStorage.setItem(MODERATION_ONBOARDING_KEY, 'true');
  closeModerationOnboarding();
}

function handleModerationModalDismiss() {
  if (localStorage.getItem(MODERATION_ONBOARDING_KEY) === 'true') return;
  skipModerationOnboarding();
}

async function confirmModerationOnboarding() {
  if (moderationSaving.value) return;
  moderationSaving.value = true;
  moderationCustomApiError.value = '';

  try {
    if (moderationChoice.value === 'custom') {
      const customUrl = moderationCustomApiUrl.value.trim();
      if (!customUrl) {
        moderationCustomApiError.value = 'Please paste a moderation API address.';
        return;
      }
      if (!isValidModerationApiUrl(customUrl)) {
        moderationCustomApiError.value = 'That address does not look valid.';
        return;
      }
      saveModerationChoiceEnabled('custom', customUrl);
      return;
    }

    saveModerationChoiceEnabled('interpoll', MODERATION_API_DEFAULT_BASE_URL);
  } finally {
    moderationSaving.value = false;
  }
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

function handleCommunitySearch() {
  // No-op, search is reactive via v-model and computed
}

const communitySearchQuery = ref('');

const filteredCommunities = computed(() => {
  const query = communitySearchQuery.value.trim().toLowerCase();
  let list = displayedCommunities.value;
  if (!query) return list;
  return list.filter(c => c.displayName?.toLowerCase().includes(query) || c.id.toLowerCase().includes(query));
});

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
  moderationVersion.value;
  const items: Array<{ type: 'post' | 'poll'; data: any; createdAt: number }> = []

  postStore.sortedPosts
    .filter(post => !ModerationService.isPostBodyBlocked(getPostModerationText(post)))
    .forEach(post => items.push({ type: 'post', data: post, createdAt: post.createdAt }));
  pollStore.sortedPolls.forEach(poll => {
    if (poll.isPrivate) return;
    if (!ModerationService.isPostBodyBlocked(getPollModerationText(poll))) {
      items.push({ type: 'poll', data: poll, createdAt: poll.createdAt });
    }
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

function getPollModerationText(poll: Poll): string {
  return [poll.question || '', poll.description || '']
    .map(part => part.trim())
    .filter(Boolean)
    .join('\n\n');
}

function getPostModerationText(post: Post): string {
  return [post.title || '', post.content || '']
    .map(part => part.trim())
    .filter(Boolean)
    .join('\n\n');
}


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

watch(
  () => [postStore.sortedPosts.length, pollStore.sortedPolls.length, moderationVersion.value] as const,
  () => {
    if (!ModerationService.isHomeFeedModerationEnabled()) return;
    ModerationService.primeHomeFeedChecks([
      ...postStore.sortedPosts.map(getPostModerationText),
      ...pollStore.sortedPolls.filter(poll => !poll.isPrivate).map(getPollModerationText),
    ]);
  },
  { immediate: true },
);

const joinedCommunities = computed(() => communityStore.communities.filter(c => communityStore.isJoined(c.id)));

const sidebarCommunities = computed(() => communityStore.communities)

function skipTutorial() {
  localStorage.setItem(TUTORIAL_STORAGE_KEY, 'true');
  tutorialVisible.value = false;
}

function previousTutorialStep() {
  if (tutorialStep.value > 0) {
    tutorialStep.value -= 1;
  }
}

function nextTutorialStep() {
  if (tutorialStep.value < tutorialSteps.length - 1) {
    tutorialStep.value += 1;
    return;
  }
  skipTutorial();
}

// ── Chat list ─────────────────────────────────────────────────────────────────

function getRoomId(a: string, b: string) {
  return [a, b].sort().join(':');
}

const unreadDebounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
const subscribedChatRooms = new Set<string>();
let chatDiscoverySubscribed = false;

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
  if (subscribedChatRooms.has(roomId)) return;

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

  subscribedChatRooms.add(roomId);
  gunListeners.push(() => {
    listener?.off?.();
    subscribedChatRooms.delete(roomId);
  });
}

async function loadChatList() {
  const gun = GunService.getGun();
  gun.get('chats').once((rooms: any) => {
    if (!rooms) return;
    syncDebug('chat-rooms-snapshot', { roomCount: Object.keys(rooms).filter(k => k !== '_').length });
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

function ensureChatRoomDiscoverySubscription() {
  if (chatDiscoverySubscribed || !currentUserId) return;
  const gun = GunService.getGun();
  const discoveryListener = gun.get('chats').map().on((roomData: any, roomId: string) => {
    if (!roomId || roomId === '_' || typeof roomId !== 'string') return;
    if (!roomId.includes(':') || !roomId.includes(currentUserId)) return;
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
  chatDiscoverySubscribed = true;
  gunListeners.push(() => {
    discoveryListener?.off?.();
    chatDiscoverySubscribed = false;
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

function ensureBackgroundChatInitialized(): Promise<void> {
  if (bgChatInitPromise) return bgChatInitPromise;
  bgChatInitPromise = (async () => {
    try {
      if (!currentUserId) {
        const currentUser = await UserService.getCurrentUser();
        currentUserId = currentUser.id;
      }
      syncDebug('background-chat-init-start');
      await initBackgroundChat();
      await loadChatList();
      ensureChatRoomDiscoverySubscription();
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

async function processPendingChatInvites(userId: string) {
  const invites = await ChatInviteService.getPendingInvites(userId);
  if (invites.length === 0) return;

  for (const invite of invites.slice(0, 5)) {
    ChatInviteService.markInviteRead(userId, invite.id);
    const toast = await toastController.create({
      message: `💬 Chat invite from u/${invite.fromDisplayName}`,
      duration: 5000,
      position: 'top',
      buttons: [
        {
          text: 'Open',
          handler: () => {
            void router.push(invite.inviteLink);
          },
        },
      ],
    });
    await toast.present();
  }
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

async function presentVoteToast(message: string, expectedVersion: number) {
  const toast = await toastController.create({ message, duration: 1500 });
  // Skip if a newer vote action has since superseded this one, to avoid a stale toast.
  if (voteVersion.value === expectedVersion) {
    toast.present();
  }
}

async function handleUpvote(post: Post) {
  try {
    if (hasUpvoted(post.id)) {
      upvotedCache.value.delete(post.id);
      localStorage.setItem('upvoted-posts', JSON.stringify([...upvotedCache.value]));
      voteVersion.value++;
      const version = voteVersion.value;
      await postStore.removeUpvote(post.id);
      await presentVoteToast('Upvote removed', version);
    } else {
      if (downvotedCache.value.has(post.id)) {
        downvotedCache.value.delete(post.id);
        localStorage.setItem('downvoted-posts', JSON.stringify([...downvotedCache.value]));
        await postStore.removeDownvote(post.id);
      }
      upvotedCache.value.add(post.id);
      localStorage.setItem('upvoted-posts', JSON.stringify([...upvotedCache.value]));
      voteVersion.value++;
      const version = voteVersion.value;
      await postStore.upvotePost(post.id);
      await presentVoteToast('Upvoted', version);
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
      const version = voteVersion.value;
      await postStore.removeDownvote(post.id);
      await presentVoteToast('Downvote removed', version);
    } else {
      if (upvotedCache.value.has(post.id)) {
        upvotedCache.value.delete(post.id);
        localStorage.setItem('upvoted-posts', JSON.stringify([...upvotedCache.value]));
        await postStore.removeUpvote(post.id);
      }
      downvotedCache.value.add(post.id);
      localStorage.setItem('downvoted-posts', JSON.stringify([...downvotedCache.value]));
      voteVersion.value++;
      const version = voteVersion.value;
      await postStore.downvotePost(post.id);
      await presentVoteToast('Downvoted', version);
    }
  } catch {
    voteVersion.value++;
    (await toastController.create({ message: 'Failed to downvote', duration: 2000 })).present();
  }
}

function getCommunityName(communityId: string): string {
  return communityStore.communities.find(c => c.id === communityId)?.displayName || communityId;
}
async function navigateToPost(post: Post) {
  router.push(`/community/${post.communityId}/post/${post.id}`);
}

async function handleModerationSubmit(post: Post) {
  const moderationText = getPostModerationText(post);
  if (!moderationText) {
    (await toastController.create({ message: 'Post has no text to filter', duration: 1800, color: 'medium' })).present();
    return;
  }

  try {
    await ModerationService.submitPostBodyHash(moderationText);
    (await toastController.create({ message: 'Post hash sent to moderation API', duration: 1800, color: 'success' })).present();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to submit post hash';
    (await toastController.create({ message, duration: 2200, color: 'warning' })).present();
  }
}

async function handleModerationSubmitPoll(poll: Poll) {
  const moderationText = getPollModerationText(poll);
  if (!moderationText) {
    (await toastController.create({ message: 'Poll has no text to filter', duration: 1800, color: 'medium' })).present();
    return;
  }

  try {
    await ModerationService.submitPostBodyHash(moderationText);
    (await toastController.create({ message: 'Poll text sent to moderation API', duration: 1800, color: 'success' })).present();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to submit poll text';
    (await toastController.create({ message, duration: 2200, color: 'warning' })).present();
  }
}
function navigateToPoll(poll: Poll) { router.push(`/community/${poll.communityId}/poll/${poll.id}`); }

// ── Community subscriptions ───────────────────────────────────────────────────

const subscribedFromHome = new Set<string>();

const GUN_SUBSCRIPTION_TIMEOUT_MS = 8_000;
const EMPTY_FEED_RECOVERY_TIMEOUT_MS = 4_000;

async function subscribeNewCommunities(communities: typeof communityStore.communities) {
  const budget = HOME_GUN_FEED_MAX_COMMUNITIES - subscribedFromHome.size;
  if (budget <= 0) return;
  // Joined communities first — those are the ones the user expects in their feed.
  const candidates = communities.filter(c => !subscribedFromHome.has(c.id));
  const newOnes = [
    ...candidates.filter(c => communityStore.isJoined(c.id)),
    ...candidates.filter(c => !communityStore.isJoined(c.id)),
  ].slice(0, budget);
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
  void openModerationOnboarding();

  // STEP 1: Fetch posts/polls/communities from API instantly
  const warmupStartedAt = Date.now();
  if (FEED_DEBUG) {
    feedDebug('warmup-start', {
      visibleCount: postStore.visibleCount,
      feedMode: feedMode.value,
    });
  }
  await warmupFromDB();
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
  void openModerationOnboarding();

  // STEP 2: Feed communities — watcher handles any NEW ones Gun delivers later
  const feedPromise = (async () => {
    await communityStore.loadCommunities()
  })();

  // STEP 3: User + chat + chain — all parallel, never block feed
  ;(async () => {
    try {
      const currentUser = await UserService.getCurrentUser();
      currentUserId = currentUser.id;
      await processPendingChatInvites(currentUserId);
      // Keep startup sync light: defer heavy chat graph subscriptions until chat tab is opened.
      // Keep live DM notifications enabled even if chain init fails.
      await Promise.allSettled([
        chainStore.initialize(),
        ensureBackgroundChatInitialized(),
      ]);
      if (activeTab.value === 'chat') {
        await ensureChatInitialized();
      }
    } catch (err) {
      console.warn('Heavy init error (non-critical):', err);
    }
  })();

  await feedPromise;
  if (combinedFeed.value.length === 0) {
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
  gunListeners.forEach(off => off());
  unreadDebounceTimers.forEach(t => clearTimeout(t));
  unreadDebounceTimers.clear();
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

.main-content {
  padding: 16px 12px 20px;
}

.logo-title {
  font-family: inherit;
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.03em;
  margin-left: 0;
  letter-spacing: 0.02em;
  --color: var(--app-text);
  padding-inline-start: 0;
  padding-inline-end: 8px;
  max-width: calc(100% - 120px);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
  --padding-start: 12px;
  --padding-end: 12px;
  padding-inline-start: max(12px, env(safe-area-inset-left));
  padding-inline-end: max(12px, env(safe-area-inset-right));
}

.header-util-buttons ion-button {
  --padding-start: 8px;
  --padding-end: 8px;
}

ion-header.header-hidden {
  transform: translateY(-100%);
}

.tutorial-card {
  margin: 0 0 14px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  border: 1px solid rgba(var(--app-accent-rgb), 0.16);
}

.tutorial-card__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

.tutorial-card__eyebrow {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--app-accent-bright);
}

.tutorial-card__dismiss {
  border: none;
  background: none;
  color: var(--app-text-muted);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  padding: 0;
}

.tutorial-card__body {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.tutorial-card__step {
  margin: 0;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--app-text-subtle);
}

.tutorial-card__body h3 {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
}

.tutorial-card__body p {
  margin: 0;
  font-size: 14px;
  line-height: 1.6;
  color: var(--app-text-muted);
}

.tutorial-card__list {
  margin: 0;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  color: var(--app-text-muted);
  font-size: 13px;
  line-height: 1.55;
}

.tutorial-card__actions {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  margin-top: 2px;
}

.tutorial-card__secondary,
.tutorial-card__primary {
  border: none;
  border-radius: 999px;
  padding: 9px 14px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.tutorial-card__secondary {
  background: rgba(255, 255, 255, 0.06);
  color: var(--app-text);
}

.tutorial-card__primary {
  background: linear-gradient(180deg, var(--app-accent-bright), var(--app-accent));
  color: #fff;
  box-shadow: 0 10px 24px rgba(var(--app-accent-rgb), 0.24);
}

.moderation-onboarding-modal {
  --width: 100vw;
  --height: 100vh;
  --max-width: 100vw;
  --max-height: 100vh;
  --border-radius: 0;
  --background: rgba(10, 15, 28, 0.34);
}

.moderation-onboarding-modal__shell {
  width: 100%;
  min-height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  box-sizing: border-box;
}

.moderation-onboarding-card {
  width: min(620px, 100%);
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 22px;
  border-radius: 28px;
  background:
    radial-gradient(circle at top left, rgba(var(--app-accent-rgb), 0.16), transparent 34%),
    rgba(var(--ion-background-color-rgb), 0.98);
  border: 1px solid rgba(var(--ion-text-color-rgb), 0.12);
  box-shadow: 0 28px 80px rgba(15, 23, 42, 0.28);
}

:global(html.dark) .moderation-onboarding-card {
  background:
    radial-gradient(circle at top left, rgba(var(--app-accent-rgb), 0.2), transparent 34%),
    rgba(15, 23, 42, 0.98);
  border-color: rgba(148, 163, 184, 0.18);
  box-shadow: 0 28px 90px rgba(2, 6, 23, 0.56);
}

.moderation-onboarding-card__hero {
  display: flex;
  align-items: flex-start;
  gap: 14px;
}

.moderation-onboarding-card__badge {
  width: 48px;
  height: 48px;
  flex: 0 0 48px;
  display: grid;
  place-items: center;
  border-radius: 16px;
  color: #fff;
  background: linear-gradient(180deg, var(--app-accent-bright), var(--app-accent));
  box-shadow: 0 12px 26px rgba(var(--app-accent-rgb), 0.28);
}

.moderation-onboarding-card__badge ion-icon {
  font-size: 24px;
}

.moderation-onboarding-card__hero-copy {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.moderation-onboarding-card__eyebrow {
  margin: 0;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--app-accent-bright);
}

.moderation-onboarding-card__hero-copy h2 {
  margin: 0;
  font-size: 24px;
  line-height: 1.15;
}

.moderation-onboarding-card__hero-copy p {
  margin: 0;
  font-size: 14px;
  line-height: 1.6;
  color: var(--app-text-muted);
}

.moderation-onboarding-card__highlights {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.moderation-onboarding-card__highlight {
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: flex-start;
  padding: 14px;
  border-radius: 18px;
  background: rgba(var(--ion-text-color-rgb), 0.04);
  border: 1px solid rgba(var(--ion-text-color-rgb), 0.06);
}

.moderation-onboarding-card__highlight ion-icon {
  font-size: 18px;
  color: var(--app-accent-bright);
}

.moderation-onboarding-card__highlight span {
  font-size: 13px;
  line-height: 1.45;
  color: var(--app-text);
}

.moderation-onboarding-card__choices {
  display: grid;
  gap: 10px;
}

.moderation-choice {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  padding: 16px;
  border-radius: 20px;
  border: 1px solid rgba(var(--ion-text-color-rgb), 0.12);
  background: rgba(var(--ion-text-color-rgb), 0.03);
  color: var(--ion-text-color);
  text-align: left;
  cursor: pointer;
  transition: transform 0.16s ease, border-color 0.16s ease, box-shadow 0.16s ease, background 0.16s ease;
}

.moderation-choice:hover {
  transform: translateY(-1px);
  border-color: rgba(var(--app-accent-rgb), 0.32);
  box-shadow: 0 12px 26px rgba(var(--app-accent-rgb), 0.08);
}

.moderation-choice.active {
  border-color: rgba(var(--app-accent-rgb), 0.48);
  background: rgba(var(--app-accent-rgb), 0.08);
  box-shadow: 0 0 0 1px rgba(var(--app-accent-rgb), 0.16) inset;
}

.moderation-choice strong {
  font-size: 15px;
  font-weight: 700;
}

.moderation-choice span {
  font-size: 13px;
  line-height: 1.5;
  color: var(--app-text-muted);
}

.moderation-choice__tag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 999px;
  background: linear-gradient(180deg, var(--app-accent-bright), var(--app-accent));
  color: #fff !important;
  font-size: 11px !important;
  font-weight: 800 !important;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.moderation-choice__tag--soft {
  background: rgba(var(--ion-text-color-rgb), 0.1);
  color: var(--ion-text-color) !important;
}

.moderation-onboarding-card__custom {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px 16px 16px;
  border-radius: 20px;
  background: rgba(var(--ion-text-color-rgb), 0.04);
  border: 1px solid rgba(var(--ion-text-color-rgb), 0.08);
}

.moderation-onboarding-card__custom label {
  font-size: 13px;
  font-weight: 700;
}

.moderation-onboarding-card__custom input {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid rgba(var(--ion-text-color-rgb), 0.16);
  border-radius: 16px;
  padding: 13px 14px;
  font-size: 14px;
  color: var(--ion-text-color);
  background: rgba(var(--ion-background-color-rgb), 0.92);
}

.moderation-onboarding-card__custom input:focus {
  outline: none;
  border-color: rgba(var(--app-accent-rgb), 0.55);
  box-shadow: 0 0 0 3px rgba(var(--app-accent-rgb), 0.16);
}

.moderation-onboarding-card__hint {
  margin: 0;
  font-size: 12px;
  line-height: 1.45;
  color: var(--app-text-muted);
}

.moderation-onboarding-card__error {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--ion-color-danger);
}

.moderation-onboarding-card__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.moderation-onboarding-card__secondary,
.moderation-onboarding-card__primary {
  flex: 1 1 220px;
  border: none;
  border-radius: 999px;
  padding: 12px 16px;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
}

.moderation-onboarding-card__secondary {
  background: rgba(var(--ion-text-color-rgb), 0.06);
  color: var(--ion-text-color);
}

.moderation-onboarding-card__primary {
  background: linear-gradient(180deg, var(--app-accent-bright), var(--app-accent));
  color: #fff;
  box-shadow: 0 12px 30px rgba(var(--app-accent-rgb), 0.24);
}

.moderation-onboarding-card__primary:disabled {
  opacity: 0.7;
  cursor: progress;
}

.moderation-onboarding-card__footer {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--app-text-muted);
}

@media (max-width: 640px) {
  .moderation-onboarding-card {
    padding: 18px;
    border-radius: 24px;
  }

  .moderation-onboarding-card__hero {
    flex-direction: column;
  }

  .moderation-onboarding-card__highlights {
    grid-template-columns: 1fr;
  }

  .moderation-onboarding-card__secondary,
  .moderation-onboarding-card__primary {
    flex-basis: 100%;
  }
}

.feed-mode-toggle {
  display: inline-flex;
  gap: 8px;
  margin: 4px 0 12px;
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
  padding-inline: 4px;
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

.communities-list-scrollable {
  max-height: 60vh;
  overflow-y: auto;
  padding-bottom: 12px;
}

.community-search-bar {
  margin: 12px 18px 8px 18px;
}

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

  .sidebar-create-btn { margin: 0 10px 10px; }

  .sidebar-communities {
    max-height: 52vh;
    overflow-y: auto;
    padding-bottom: 4px;
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
