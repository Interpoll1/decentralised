<template>
  <ion-page>
    <ion-header :class="{ 'header-hidden': isHeaderHidden }">
      <ion-toolbar>
        <ion-title class="logo-title">{{ APP_NAME }}</ion-title>
        <!-- These buttons are hidden on desktop (768px+) and moved to side-nav -->
        <ion-buttons slot="end" class="header-util-buttons">
          <ion-button v-if="canScanQr" @click="scanQr()" aria-label="Scan QR code">
            <ion-icon :icon="qrCodeOutline"></ion-icon>
          </ion-button>
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
          <div class="side-nav-brand" @click="activeTab = 'home'">
            <span class="side-nav-brand-mark" aria-hidden="true">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                <path d="M12 3L4 7.5V16.5L12 21L20 16.5V7.5L12 3Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
                <path d="M12 8V16M8.5 10.5L12 12.5L15.5 10.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </span>
            <span class="side-nav-brand-name">{{ APP_NAME }}</span>
          </div>

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

          <div class="side-nav-divider"></div>

          <p class="side-nav-section-label">Categories</p>
          <button
            v-for="cat in feedCategories"
            :key="cat.id"
            class="side-nav-item side-nav-util side-nav-category"
            :class="{ active: selectedCategory === cat.id }"
            @click="selectCategory(cat.id)"
          >
            <ion-icon :icon="cat.icon" :class="cat.tone"></ion-icon>
            <span>{{ cat.label }}</span>
          </button>
          <button class="side-nav-item side-nav-util side-nav-category" style="opacity:0.6" @click="showMoreCategories = !showMoreCategories">
            <ion-icon :icon="ellipsisHorizontalOutline"></ion-icon>
            <span>{{ showMoreCategories ? 'Show less' : 'Show more' }}</span>
          </button>

          <div class="side-nav-divider"></div>

          <button v-if="canScanQr" class="side-nav-item side-nav-util" @click="scanQr()">
            <ion-icon :icon="qrCodeOutline"></ion-icon>
            <span>Scan QR</span>
          </button>
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

            <div class="feed-toolbar">
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
            </div>

            <div class="feed-category-tabs">
              <button
                class="feed-cat-tab"
                :class="{ active: selectedCategory === 'all' }"
                @click="selectCategory('all')"
              >
                All
              </button>
              <button
                v-for="cat in feedCategories"
                :key="'tab-' + cat.id"
                class="feed-cat-tab"
                :class="{ active: selectedCategory === cat.id }"
                @click="selectCategory(cat.id)"
              >
                {{ cat.label }}
              </button>
              <button class="feed-cat-tab feed-cat-more" type="button" aria-label="More categories" @click="showMoreCategories = !showMoreCategories">
                <ion-icon :icon="chevronDownOutline" :style="showMoreCategories ? 'transform:rotate(180deg)' : ''"></ion-icon>
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
                    :has-upvoted="hasUpvotedPoll(item.data.id)"
                    :has-downvoted="hasDownvotedPoll(item.data.id)"
                    :show-moderation-action="ModerationService.canSubmitHashesFromHome()"
                    moderation-action-title="Send this poll text to the moderation API"
                    @click="navigateToPoll(item.data)"
                    @vote="navigateToPoll(item.data)"
                    @upvote="handleUpvotePoll(item.data)"
                    @downvote="handleDownvotePoll(item.data)"
                    @moderation-submit="handleModerationSubmitPoll(item.data)"
                  />
                </template>

              <ion-infinite-scroll :disabled="!hasMore" @ionInfinite="onInfiniteScroll">
                <ion-infinite-scroll-content loading-spinner="bubbles" />
              </ion-infinite-scroll>
            </div>

            <!-- an active category filter that matches nothing is a different
                 situation from an empty instance, and needs a different way out. -->
            <div v-else-if="selectedCategory !== 'all'" class="empty-state empty-state--home">
              <ion-icon :icon="documentTextOutline" size="large"></ion-icon>
              <p>Nothing in {{ selectedCategoryLabel }} yet</p>
              <p class="subtitle">A post or poll lands here when its community is set to {{ selectedCategoryLabel }}.</p>
              <div class="empty-state__actions">
                <ion-button @click="selectCategory('all')">
                  <ion-icon slot="start" :icon="documentTextOutline"></ion-icon>
                  Show all categories
                </ion-button>
              </div>
            </div>

            <div v-else class="empty-state empty-state--home">
              <ion-icon :icon="documentTextOutline" size="large"></ion-icon>
              <p>No content yet</p>
              <p class="subtitle">Content syncs from peers and can take 5–10 seconds on first visit. In the meantime:</p>
              <div class="empty-state__actions">
                <ion-button @click="activeTab = 'communities'">
                  <ion-icon slot="start" :icon="peopleOutline"></ion-icon>
                  Browse communities
                </ion-button>
                <ion-button fill="outline" @click="activeTab = 'create'">
                  <ion-icon slot="start" :icon="addCircleOutline"></ion-icon>
                  Create the first poll
                </ion-button>
              </div>
            </div>
          </div>
          <!-- COMMUNITIES TAB (lazy-loaded) -->
          <CommunitiesTab
            v-else-if="activeTab === 'communities'"
            :communityFilter="communityFilter"
            @update:communityFilter="communityFilter = $event"
          />

          <!-- CREATE TAB (lazy-loaded) -->
          <CreateTab
            v-else-if="activeTab === 'create'"
            @showPostOptions="showPostOptions"
            @showPollOptions="showPollOptions"
          />

          <!-- CHAT TAB (lazy-loaded) -->
          <ChatTab
            v-if="activeTab === 'chat'"
            :chatList="chatList"
            :totalUnread="totalUnread"
            :userSearchResults="userSearchResults"
            :searchingUsers="searchingUsers"
            @searchUsers="handleUserSearch"
            @clearUserSearch="clearUserSearch"
            @startChat="startChatWithUser"
            @openChat="openChat"
          />

        </main>

        <aside class="right-sidebar">
          <div class="sidebar-section surface-card">
            <div class="sidebar-header">
              <span>Communities</span>
              <button class="sidebar-link" @click="activeTab = 'communities'">See all</button>
            </div>

            <button class="sidebar-create-cta" @click="$router.push('/create-community')">
              <ion-icon :icon="addOutline"></ion-icon>
              Create Community
            </button>

            <div class="sidebar-communities">
              <div
                v-for="community in sidebarCommunities.slice(0, 5)"
                :key="community.id"
                class="sidebar-community-item"
                @click="$router.push(`/community/${community.id}`)"
              >
                <div
                  class="sidebar-community-avatar"
                  :class="communityAvatarTone(community)"
                >
                  <ion-icon v-if="community.isPrivate" :icon="lockClosedOutline"></ion-icon>
                  <template v-else>{{ community.displayName?.charAt(0)?.toUpperCase() }}</template>
                </div>
                <div class="sidebar-community-info">
                  <span class="sidebar-community-name">
                    <span class="sidebar-community-name-text">{{ community.displayName }}</span>
                    <span
                      v-if="communityBadge(community)"
                      class="community-tag"
                      :class="'tag-' + communityBadge(community)?.tone"
                    >{{ communityBadge(community)?.label }}</span>
                  </span>
                  <span class="sidebar-community-meta">{{ community.memberCount || 0 }} members</span>
                </div>
                <span class="sidebar-member-count">{{ community.memberCount || 0 }}</span>
              </div>
            </div>
          </div>

          <div v-if="trendingCategories.length > 0" class="sidebar-section surface-card">
            <div class="sidebar-header">
              <span>Categories</span>
            </div>
            <div class="trending-list">
              <button

              
                
                v-for="row in trendingCategories.slice(0, 6)"
                :key="row.id"
                class="trending-row"
                :class="{ active: selectedCategory === row.id }"
                :aria-label="`${row.label}, ${row.posts} ${row.posts === 1 ? 'item' : 'items'}`"
                @click="selectCategory(row.id)"
              >
                <span class="trending-left">
                  <ion-icon :icon="row.icon" :class="row.tone"></ion-icon>
                  <span>{{ row.label }}</span>
                </span>
                <span class="trending-meta tabular">{{ row.posts }}</span>
                <ion-icon :icon="chevronForwardOutline" class="trending-chevron"></ion-icon>
              </button>
            </div>
          </div>

          <div class="sidebar-section sidebar-about surface-card">
            <div class="sidebar-about-row">
              <div>
                <p class="sidebar-about-title">{{ APP_NAME }}</p>
                <p class="sidebar-about-text">A peer-to-peer community platform built on GunDB. Posts and votes sync across all peers.</p>
              </div>
              <div class="sidebar-about-graph" aria-hidden="true">
                <svg width="56" height="48" viewBox="0 0 56 48" fill="none">
                  <circle cx="28" cy="24" r="7" fill="url(#g1)"/>
                  <circle cx="10" cy="12" r="4" fill="#7c8cff" opacity="0.85"/>
                  <circle cx="46" cy="14" r="4" fill="#a78bfa" opacity="0.85"/>
                  <circle cx="12" cy="38" r="3.5" fill="#7c8cff" opacity="0.7"/>
                  <circle cx="44" cy="36" r="3.5" fill="#a78bfa" opacity="0.7"/>
                  <circle cx="28" cy="6" r="3" fill="#5e6ad2" opacity="0.8"/>
                  <line x1="28" y1="24" x2="10" y2="12" stroke="#7c8cff" stroke-width="1.2" opacity="0.5"/>
                  <line x1="28" y1="24" x2="46" y2="14" stroke="#a78bfa" stroke-width="1.2" opacity="0.5"/>
                  <line x1="28" y1="24" x2="12" y2="38" stroke="#7c8cff" stroke-width="1.2" opacity="0.4"/>
                  <line x1="28" y1="24" x2="44" y2="36" stroke="#a78bfa" stroke-width="1.2" opacity="0.4"/>
                  <line x1="28" y1="24" x2="28" y2="6" stroke="#5e6ad2" stroke-width="1.2" opacity="0.45"/>
                  <defs>
                    <radialGradient id="g1" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(28 24) rotate(90) scale(7)">
                      <stop stop-color="#a78bfa"/>
                      <stop offset="1" stop-color="#5e6ad2"/>
                    </radialGradient>
                  </defs>
                </svg>
              </div>
            </div>
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
              placeholder="https://example.com/moderation"
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
import { ref, computed, onMounted, onUnmounted, watch, nextTick, defineAsyncComponent } from 'vue';
import { APP_NAME } from '../branding';
import {
  IonPage, IonHeader, IonToolbar, IonTitle, IonContent, IonBadge,
  IonButtons, IonButton, IonIcon, IonSegment, IonSegmentButton, IonFooter, IonModal,
  IonLabel, IonSpinner, IonChip, IonSearchbar,
  IonInfiniteScroll, IonInfiniteScrollContent,
  actionSheetController, toastController
} from '@ionic/vue';
import {
  cube, personCircleOutline, settingsOutline, addCircleOutline, addOutline,
  earthOutline, peopleOutline, home, homeOutline, documentTextOutline,
  chevronForwardOutline, chevronDownOutline, people, addCircle, statsChartOutline,
  searchOutline, chatbubble, chatbubbleOutline,
  shieldOutline, shieldCheckmarkOutline, sparklesOutline, eyeOffOutline, linkOutline,
  codeSlashOutline, gameControllerOutline, flaskOutline, businessOutline,
  logoBitcoin, trophyOutline, ellipsisHorizontalOutline, lockClosedOutline,
  qrCodeOutline, tvOutline, happyOutline, chatbubblesOutline, cashOutline,
  heartOutline, schoolOutline, locationOutline, ellipseOutline
} from 'ionicons/icons';
import { useQrScan } from '../composables/useQrScan';
import { useRoute, useRouter } from 'vue-router';
import { useChainStore } from '../stores/chainStore';
import { useCommunityStore } from '../stores/communityStore';
import type { Community } from '../services/communityService';
import { usePostStore } from '../stores/postStore';
import { usePollStore } from '../stores/pollStore';
import CommunityCard from '../components/CommunityCard.vue';

// ── Lazy-loaded tab components ────────────────────────────────────────────────
const CommunitiesTab = defineAsyncComponent(() => import('../components/CommunitiesTab.vue'));
const CreateTab      = defineAsyncComponent(() => import('../components/CreateTab.vue'));
const ChatTab        = defineAsyncComponent(() => import('../components/ChatTab.vue'));

// ── Lazy-loaded feed cards (not needed until feed renders) ────────────────────
// PostCard and PollCard are large components with their own icon sets.
// Using defineAsyncComponent means their JS is parsed after the shell renders.
const PostCard = defineAsyncComponent(() => import('../components/PostCard.vue'));
const PollCard = defineAsyncComponent(() => import('../components/PollCard.vue'));

import { Post } from '../services/postService';
import { Poll } from '../services/pollService';
import { GunService } from '../services/gunService';
import { UserService } from '../services/userService';
import { warmupFromDB } from '../services/dbWarmup';
import { ModerationService, moderationVersion } from '../services/moderationService';
import config from '../config';

// ── Lazy composables — imported statically but only initialised on demand ─────
import { useChat }       from '../composables/useChat';
import { useModeration } from '../composables/useModeration';
import { useTutorial }   from '../composables/useTutorial';

const router = useRouter();
const route  = useRoute();
const { isSupported: canScanQr, scan: scanQr } = useQrScan();
const chainStore     = useChainStore();
const communityStore = useCommunityStore();
const postStore      = usePostStore();
const pollStore      = usePollStore();

const FEED_DEBUG      = localStorage.getItem('interpoll_feed_debug') === 'true';
const SYNC_DEBUG      = localStorage.getItem('interpoll_sync_debug') === 'true';
const HOME_GUN_FEED_ENABLED         = localStorage.getItem('interpoll_home_gun_feed') !== 'false';
const HOME_GUN_FEED_MAX_COMMUNITIES = 8;
const FEED_INITIAL_RENDER_TARGET    = 50;

function feedDebug(label: string, data?: Record<string, unknown>) {
  if (!FEED_DEBUG) return;
  if (data) console.log(`[FeedDebug] ${label}`, data); else console.log(`[FeedDebug] ${label}`);
}
function syncDebug(label: string, data?: Record<string, unknown>) {
  if (!SYNC_DEBUG) return;
  if (data) console.log(`[SyncDebug] ${label}`, data); else console.log(`[SyncDebug] ${label}`);
}

const HOME_TABS = ['home', 'communities', 'chat', 'create'] as const;
type HomeTab = typeof HOME_TABS[number];
function tabFromRoute(): HomeTab {
  const raw   = route.query.tab;
  const value = Array.isArray(raw) ? raw[0] : raw;
  return HOME_TABS.includes(value as HomeTab) ? (value as HomeTab) : 'home';
}

const activeTab       = ref<string>(tabFromRoute());
const communityFilter = ref('all');
const isLoadingPosts  = ref(false);
const voteVersion     = ref(0);
const isHeaderHidden  = ref(false);
const isTabBarHidden  = ref(false);
const warmupComplete  = ref(false);
const showMoreCategories = ref(false);

// URL ↔ tab sync
watch(activeTab, (tab) => {
  if (route.name !== 'Home' || tab === tabFromRoute()) return;
  void router.push({ query: { ...route.query, tab: tab === 'home' ? undefined : tab } });
});
watch(() => route.query.tab, () => {
  if (route.name !== 'Home') return;
  const tab = tabFromRoute();
  if (activeTab.value !== tab) activeTab.value = tab;
});

// ── Composables initialised up-front (lightweight) ────────────────────────────
const tutorial   = useTutorial();
const moderation = useModeration();
const {
  tutorialVisible, tutorialStep, currentTutorialStep, TUTORIAL_STEPS: tutorialSteps,
  skipTutorial, previousTutorialStep, nextTutorialStep,
} = tutorial;
const {
  moderationOnboardingOpen, moderationChoice, moderationCustomApiUrl,
  moderationCustomApiInput, moderationCustomApiError, moderationSaving,
  openModerationOnboarding, closeModerationOnboarding,
  skipModerationOnboarding, handleModerationModalDismiss, confirmModerationOnboarding,
  maybeShowOnboarding,
} = moderation;

// ── Chat — initialised lazily on first tab visit ──────────────────────────────
const gunListeners: Array<() => void> = [];
let currentUserId = '';
let chatComposable: ReturnType<typeof useChat> | null = null;

// Proxy refs that ChatTab binds to — populated once chat composable loads
const chatList          = ref<any[]>([]);
const totalUnread       = ref(0);
const userSearchResults = ref<any[]>([]);
const searchingUsers    = ref(false);
const userSearchQuery   = ref('');

function ensureChat() {
  if (!chatComposable && currentUserId) {
    chatComposable = useChat(currentUserId, gunListeners);
    // Bind refs so ChatTab stays reactive
    watch(chatComposable.chatList,          v => { chatList.value    = v; });
    watch(chatComposable.totalUnread,       v => { totalUnread.value = v; });
    watch(chatComposable.userSearchResults, v => { userSearchResults.value = v; });
    watch(chatComposable.searchingUsers,    v => { searchingUsers.value    = v; });
  }
  return chatComposable;
}

async function ensureChatInitialized() {
  const c = ensureChat();
  if (c) await c.ensureChatInitialized(activeTab);
}
async function ensureBackgroundChatInitialized() {
  const c = ensureChat();
  if (c) await c.ensureChatInitialized(activeTab);
}
function openChat(chat: any)             { ensureChat()?.openChat(chat); }
function startChatWithUser(user: any)    { ensureChat()?.startChatWithUser(user); }
function clearUserSearch()               { ensureChat()?.clearUserSearch(); userSearchQuery.value = ''; }
async function handleUserSearch()        { await ensureChat()?.handleUserSearch(); }
async function loadChatList()            { await ensureChat()?.loadChatList(); }
async function processPendingChatInvites(userId: string) {
  await ensureChat()?.processPendingChatInvites(userId);
}

// ── Feed mode & categories ────────────────────────────────────────────────────
const feedMode = ref<'for-you' | 'latest'>('for-you');
function setFeedMode(mode: 'for-you' | 'latest') { feedMode.value = mode; }

const CATEGORY_IDS = ['technology', 'gaming', 'science', 'politics', 'crypto', 'sports', 'all'] as const;
function categoryFromRoute(): string {
  const raw   = route.query.category;
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === 'string' ? value : 'all';
}
const selectedCategory = ref<string>(categoryFromRoute());

watch(selectedCategory, (cat) => {
  if (cat !== 'all') {
    void pollStore.loadAllCommunityPolls?.();
  }
});
watch(() => route.query.category, () => {
  const cat = categoryFromRoute();
  if (selectedCategory.value !== cat) selectedCategory.value = cat;
});

const VISIBLE_CATEGORIES = [
  { id: 'entertainment', label: 'Entertainment', icon: tvOutline },
  { id: 'other',         label: 'Other',         icon: ellipseOutline },
  { id: 'technology',    label: 'Technology',    icon: codeSlashOutline },
  { id: 'humour',        label: 'Humour',        icon: happyOutline },
  { id: 'opinion',       label: 'Opinion',       icon: chatbubblesOutline },
  { id: 'politics',      label: 'Politics',      icon: businessOutline },
  { id: 'health',        label: 'Health',        icon: heartOutline },
  { id: 'sports',        label: 'Sports',        icon: trophyOutline },
  { id: 'gaming',        label: 'Gaming',        icon: gameControllerOutline },
  { id: 'science',       label: 'Science',       icon: flaskOutline },
  { id: 'education',     label: 'Education',     icon: schoolOutline },
  { id: 'local',         label: 'Local',         icon: locationOutline },
  { id: 'finance',       label: 'Finance',       icon: cashOutline },
  { id: 'crypto',        label: 'Crypto',        icon: logoBitcoin },
  { id: 'world-news',    label: 'World News',    icon: earthOutline },
  { id: 'environment',   label: 'Environment',   icon: earthOutline },
];
const feedCategories = computed(() =>
  showMoreCategories.value ? VISIBLE_CATEGORIES : VISIBLE_CATEGORIES.slice(0, 6)
);

/**
 * Counts every loaded post and poll by its community's category. These used to
 * be hard-coded ("1.2k", "964", …), which meant the sidebar advertised traffic
 * the instance did not have and never moved. Categories with nothing in them
 * are dropped rather than shown as zero — an empty row is a dead end.
 */
const categoryCounts = computed<Record<string, number>>(() => {
  const counts: Record<string, number> = {}
  for (const item of allFeedItems.value) {
    const cat = categoryOf(item)
    if (cat) counts[cat] = (counts[cat] || 0) + 1
  }
  return counts
})

const trendingCategories = computed(() =>
  feedCategories.value
    .map(cat => ({ ...cat, posts: categoryCounts.value[cat.id] || 0 }))
    .filter(cat => cat.posts > 0)
    .sort((a, b) => b.posts - a.posts)
)

const selectedCategoryLabel = computed(() =>
  feedCategories.value.find(c => c.id === selectedCategory.value)?.label ?? selectedCategory.value
)

function selectCategory(id: string) {
  selectedCategory.value = id;
  void router.push({ query: { ...route.query, category: id === 'all' ? undefined : id } });
}

// ── Feed ──────────────────────────────────────────────────────────────────────
/**
 * A post/poll's category is its community's category — posts and polls carry
 * no category of their own. Matching is exact against the community's
 * `category` field (set from a fixed list in CreateCommunityPage) or one of
 * its tags. The previous version joined the community name, display name and
 * tags into one string and substring-matched, so "Crypto" also caught a
 * community called "Cryptography Reading Group" and "Science" caught
 * "Data Science Memes" regardless of their actual category.
 */
function categoryOf(item: { data: any }): string | null {
  const community = communityStore.communities.find((c: any) => c.id === item.data.communityId)
  if (!community) return null
  const explicit = String(community.category || '').trim().toLowerCase()
  if (explicit) return explicit
  const tag = (community.tags || [])
    .map((t: any) => String(t).trim().toLowerCase())
    .find((t: string) => (CATEGORY_IDS as readonly string[]).includes(t))
  return tag || null
}

function itemMatchesCategory(item: { type: string; data: any }): boolean {
  if (selectedCategory.value === 'all') return true
  return categoryOf(item) === selectedCategory.value.toLowerCase()
}

function isValidModerationApiUrl(url: string): boolean {
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

const sessionSeed = Math.floor(Math.random() * 10000)

function seededRandom(index: number): number {
  let x = Math.sin(index + 1) * 10000;
  return x - Math.floor(x);
}
function hashStringToInt(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}

/** Every visible post and poll, before any category filter is applied.
 *  Split out from combinedFeed so the sidebar can count categories across the
 *  whole feed rather than across whatever the current filter left behind. */
const allFeedItems = computed(() => {
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

  return items
})

const combinedFeed = computed(() => {
  selectedCategory.value;
  const filtered = allFeedItems.value.filter(itemMatchesCategory)

  if (feedMode.value === 'latest') {
    filtered.sort((a, b) => b.createdAt - a.createdAt);
    return filtered.slice(0, postStore.visibleCount);
  }
  const now    = Date.now();
  const maxAge = 30 * 24 * 60 * 60 * 1000;
  const weighted = filtered.map(item => {
    const id    = `${item.type}-${item.data.id}`;
    const score = item.type === 'post' ? (item.data.score ?? 0) : (item.data.totalVotes ?? 0);
    const seed  = hashStringToInt(id);
    const rand  = seededRandom(seed);
    if (rand < 0.2) return { item, weight: seededRandom(seed + 1) };
    const age      = Math.max(0, 1 - (now - item.createdAt) / maxAge);
    const engBoost = score < 5 ? 0.15 : 0;
    const oldBoost = (now - item.createdAt) > 7 * 24 * 60 * 60 * 1000 ? seededRandom(seed + 999) * 0.2 : 0;
    const weight   = age * 0.4 + Math.min(score / 20, 1) * 0.25 + seededRandom(seed) * 0.15 + engBoost + oldBoost;
    return { item, weight };
  });
  weighted.sort((a, b) => b.weight - a.weight);
  return weighted.map(w => w.item).slice(0, postStore.visibleCount);
});

const hasMore = computed(() => postStore.hasMorePosts || pollStore.hasMorePolls);
const newContentCount = computed(() => postStore.newPostCount + pollStore.newPollCount);

function getPollModerationText(poll: Poll): string {
  return [poll.question, poll.description, ...(poll.options || []).map((o: any) => o.text)].filter(Boolean).join(' ');
}
function getPostModerationText(post: Post): string {
  return [post.title, post.content].filter(Boolean).join(' ');
}

function ensureInitialFeedVisible(reason: string) {
  if (combinedFeed.value.length > 0) return;
  if (FEED_DEBUG) feedDebug('ensure-initial-feed-visible', { reason });
  postStore.resetVisibleCount?.();
  pollStore.resetVisibleCount?.();
}

// ── Voting ────────────────────────────────────────────────────────────────────
function hasUpvoted(postId: string): boolean   { voteVersion.value; return postStore.myVote(postId) === 'up'; }
function hasDownvoted(postId: string): boolean  { voteVersion.value; return postStore.myVote(postId) === 'down'; }

// ── Scroll ────────────────────────────────────────────────────────────────────
let lastScrollTop    = 0;
const scrollThreshold = 50;
function handleScroll(event: CustomEvent) {
  const scrollTop = event.detail.scrollTop;
  if (scrollTop > lastScrollTop && scrollTop > scrollThreshold) {
    isTabBarHidden.value = true; isHeaderHidden.value = true;
  } else if (scrollTop < lastScrollTop) {
    isTabBarHidden.value = false; isHeaderHidden.value = false;
  }
  lastScrollTop = scrollTop;
}

function flushNewContent() {
  postStore.flushNewPosts?.();
  pollStore.flushNewPolls?.();
}

async function onInfiniteScroll(event: any) {
  postStore.loadMorePosts?.();
  pollStore.loadMorePolls?.();
  setTimeout(() => event.target.complete(), 500);
}

// ── Create actions ────────────────────────────────────────────────────────────
async function showPostOptions() {
  const actionSheet = await actionSheetController.create({
    header: 'Create a post in...',
    buttons: communityStore.communities
      .filter((c: any) => c.isJoined)
      .slice(0, 8)
      .map((c: any) => ({
        text: c.displayName,
        handler: () => { router.push(`/community/${c.id}/create-post`); },
      }))
      .concat([{ text: 'Cancel', role: 'cancel' }]),
  });
  await actionSheet.present();
}
async function showPollOptions() {
  const actionSheet = await actionSheetController.create({
    header: 'Create a poll in...',
    buttons: communityStore.communities
      .filter((c: any) => c.isJoined)
      .slice(0, 8)
      .map((c: any) => ({
        text: c.displayName,
        handler: () => { router.push(`/community/${c.id}/create-poll`); },
      }))
      .concat([{ text: 'Cancel', role: 'cancel' }]),
  });
  await actionSheet.present();
}

async function presentVoteToast(message: string, expectedVersion: number) {
  const toast = await toastController.create({ message, duration: 1500 });
  // Skip if a newer vote action has since superseded this one, to avoid a stale toast.
  if (voteVersion.value === expectedVersion) {
    toast.present();
  }
}

/**
 * One toggle, one write. Switching sides is no longer a remove-then-add pair of
 * writes to the same node — `toggleVote` replaces this user's vote in place, so
 * the second write can no longer race ahead of the first.
 */
async function handlePostVote(post: Post, direction: 'up' | 'down') {
  const wasActive = postStore.myVote(post.id) === direction;
  voteVersion.value++;
  const version = voteVersion.value;
  try {
    await postStore.toggleVote(post.id, direction);
    const labels = { up: 'Upvote', down: 'Downvote' };
    await presentVoteToast(wasActive ? `${labels[direction]} removed` : `${labels[direction]}d`, version);
  } catch {
    (await toastController.create({
      message: direction === 'up' ? 'Failed to upvote' : 'Failed to downvote',
      duration: 2000,
    })).present();
  }
}

const handleUpvote = (post: Post) => handlePostVote(post, 'up');
const handleDownvote = (post: Post) => handlePostVote(post, 'down');

function hasUpvotedPoll(pollId: string): boolean {
  voteVersion.value;
  return pollStore.myContentVote(pollId) === 'up';
}
function hasDownvotedPoll(pollId: string): boolean {
  voteVersion.value;
  return pollStore.myContentVote(pollId) === 'down';
}

/**
 * One toggle, one write — the same shape as `handlePostVote`.
 *
 * This used to decide vote-vs-unvote from two localStorage sets the view kept
 * itself, while the service decided the same question from the graph; when they
 * disagreed the click inverted. Switching sides also issued two writes to the
 * same node, the second racing the first. `voteOnPollContent` now toggles.
 */
async function handlePollVote(poll: Poll, direction: 'up' | 'down') {
  const wasActive = pollStore.myContentVote(poll.id) === direction;
  voteVersion.value++;
  const version = voteVersion.value;
  try {
    await pollStore.voteOnPollContent(poll.id, direction);
    const labels = { up: 'Upvote', down: 'Downvote' };
    await presentVoteToast(wasActive ? `${labels[direction]} removed` : `${labels[direction]}d`, version);
  } catch {
    voteVersion.value++;
    (await toastController.create({
      message: direction === 'up' ? 'Failed to upvote poll' : 'Failed to downvote poll',
      duration: 2000,
    })).present();
  }
}

const handleUpvotePoll = (poll: Poll) => handlePollVote(poll, 'up');
const handleDownvotePoll = (poll: Poll) => handlePollVote(poll, 'down');

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

  // Gun subscriptions may hang if relay is down — cap wait.
  //
  // Hydrate a couple of communities at a time rather than firing all
  // HOME_GUN_FEED_MAX_COMMUNITIES at once: each community's initial load issues
  // its own batched run of individual Gun gets, and eight of those overlapping is
  // what produced Gun's "syncing 1K+ records a second" warning at startup. The
  // feed only renders ten items, so the first pair finishing is enough to paint.
  const HYDRATION_CONCURRENCY = 2;
  const hydrateAll = async () => {
    for (let i = 0; i < newOnes.length; i += HYDRATION_CONCURRENCY) {
      const slice = newOnes.slice(i, i + HYDRATION_CONCURRENCY);
      await Promise.all(slice.flatMap(c => [
        postStore.loadPostsForCommunity(c.id),
        pollStore.loadPollsForCommunity(c.id),
      ]));
    }
  };
  let timerId: ReturnType<typeof setTimeout>;
  let timedOut = false;
  const timeout = new Promise<void>(r => {
    timerId = setTimeout(() => {
      timedOut = true;
      r();
    }, GUN_SUBSCRIPTION_TIMEOUT_MS);
  });

  try {
    await Promise.race([hydrateAll(), timeout]);
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
  await new Promise<void>(resolve => setTimeout(resolve, EMPTY_FEED_RECOVERY_TIMEOUT_MS));
  ensureInitialFeedVisible('empty-feed-gun-recovery');
}

function communityBadge(community: Community | null | undefined) {
  if (!community) return null;
  if ((community as any).isPrivate) return { label: 'Private', tone: 'private' };
  const cat = String((community as any).category || (community as any).tags?.[0] || '').toLowerCase();
  if (cat.includes('nsfw') || (community as any).nsfw) return { label: 'NSFW', tone: 'nsfw' };
  if (cat.includes('politic')) return { label: 'Politics', tone: 'politics' };
  if (cat.includes('tech') || cat.includes('programming')) return { label: 'Tech', tone: 'tech' };
  if (cat) return { label: cat.charAt(0).toUpperCase() + cat.slice(1), tone: 'general' };
  return { label: 'General', tone: 'general' };
}
function communityAvatarTone(community: Community | null | undefined): string {
  const badge = communityBadge(community);
  return badge ? `tone-${badge.tone}` : 'tone-general';
}

// Right sidebar — always live from the store, no lazy loading
const sidebarCommunities = computed(() => communityStore.communities);

// ── Watchers & lifecycle ──────────────────────────────────────────────────────
watch(() => communityStore.communities.length, (newLen, oldLen) => {
  if (!HOME_GUN_FEED_ENABLED || !warmupComplete.value || newLen <= oldLen) return;
  subscribeNewCommunities(communityStore.communities);
});

watch(activeTab, (tab) => {
  if (tab === 'home') { ensureInitialFeedVisible('home-tab-selected'); return; }
  if (tab === 'chat') { void ensureChatInitialized(); }
});

onMounted(async () => {
  maybeShowOnboarding();

  const warmupStartedAt = Date.now();
  await warmupFromDB();
  if (FEED_DEBUG) feedDebug('warmup-finished', { durationMs: Date.now() - warmupStartedAt, combinedFeedLength: combinedFeed.value.length });
  ensureInitialFeedVisible('warmup-finished');

  if (HOME_GUN_FEED_ENABLED && communityStore.communities.length > 0) {
    subscribeNewCommunities(communityStore.communities);
  }
  warmupComplete.value = true;

  const feedPromise = communityStore.loadCommunities();

  // User + chat + chain — parallel, never block feed
  void (async () => {
    try {
      const currentUser = await UserService.getCurrentUser();
      currentUserId = currentUser.id;
      await processPendingChatInvites(currentUserId);
      await Promise.allSettled([
        chainStore.initialize(),
        ensureBackgroundChatInitialized(),
      ]);
      if (activeTab.value === 'chat') await ensureChatInitialized();
    } catch (err) {
      console.warn('Heavy init error (non-critical):', err);
    }
  })();

  await feedPromise;
  if (combinedFeed.value.length === 0) {
    await tryRecoverEmptyFeedFromGun();
    ensureInitialFeedVisible('empty-feed-recovery');
  }
});

// Derive live vote tallies for the posts actually on screen. The counters
// carried on a post node are an advisory mirror that peers re-echo from stale
// snapshots, so a feed rendering them alone shows counts that drift.
watch(
  () => combinedFeed.value.filter(item => item.type === 'post').map(item => item.data.id as string),
  (postIds) => postStore.syncFeedVoteSubscriptions(postIds),
  { immediate: true },
);
watch(
  () => combinedFeed.value.filter(item => item.type === 'poll').map(item => item.data.id as string),
  (pollIds) => pollStore.syncFeedVoteSubscriptions(pollIds),
  { immediate: true },
);

onUnmounted(() => {
  ensureChat()?.teardown();
  postStore.stopFeedVoteSubscriptions();
  pollStore.stopFeedVoteSubscriptions();
  gunListeners.forEach(off => off());
});
</script>


<style scoped src="../styles/HomePage.css"></style>
