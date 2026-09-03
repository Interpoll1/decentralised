<template>
  <ion-page>
    <ion-header :class="{ 'header-hidden': isHeaderHidden }">
      <ion-toolbar>
        <ion-title class="logo-title">Interpoll</ion-title>
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
          <!-- Relay status — tap to open relay sheet -->
          <ion-button class="relay-header-btn" @click="relaySheetOpen = true" aria-label="Relay status">
            <svg viewBox="0 0 24 24" fill="none" width="20" height="20" style="flex-shrink:0">
              <!-- broadcast tower -->
              <path d="M12 20v-8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
              <path d="M8.5 16.5C7 15.2 6 13.2 6 11a6 6 0 0112 0c0 2.2-1 4.2-2.5 5.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
              <path d="M5 19.5C2.8 17.5 1.5 14.4 1.5 11a10.5 10.5 0 0121 0c0 3.4-1.3 6.5-3.5 8.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
              <circle cx="12" cy="12" r="1.5" fill="currentColor"/>
            </svg>
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ambient-page" :scroll-events="true" @ionScroll="handleScroll">
      <BurstOverlay />
      <div class="hp-root page-layout ambient-page__content">

        <!-- ── LEFT NAV (desktop only) ─────────────────────────────── -->
        <AppSideNav
          :active-tab="activeTab"
          :total-unread="totalUnread"
          :active-category="selectedCategory"
          @update:active-tab="activeTab = $event"
          @select-category="selectCategory($event); activeTab = 'home'"
          @open-relay="relaySheetOpen = true"
        />

        <!-- ── MAIN CONTENT ──────────────────────────────────────────── -->
        <main class="main-content surface-card">

          <!-- FEED TAB -->
          <div v-if="activeTab === 'home'" class="home-tab">

            <!-- Tutorial card -->
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

            <!-- Feed toolbar: pill row on mobile, split tabs on desktop -->
            <div class="feed-toolbar">
              <!-- Mobile row 1: scope + mode pills -->
              <div class="feed-pills-row">
                <button class="scope-pill" :class="{ active: feedScope === 'mine' }"  @click="setScope('mine')">
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="none"><path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>
                  Mine
                </button>
                <button class="scope-pill" :class="{ active: feedScope === 'relay' }" @click="setScope('relay')">
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/><path d="M2 12h20M12 2a15.3 15.3 0 010 20M12 2a15.3 15.3 0 000 20" stroke="currentColor" stroke-width="2"/></svg>
                  Relay
                </button>
                <button class="scope-pill" :class="{ active: feedScope === 'explore' }" @click="setScope('explore')">
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="none"><circle cx="11" cy="11" r="8" stroke="currentColor" stroke-width="2"/><path d="M21 21l-4.35-4.35" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
                  Explore
                </button>
                <span class="feed-pills-divider"></span>
                <button class="scope-pill" :class="{ active: feedMode === 'for-you' }" @click="setFeedMode('for-you')">✦ For You</button>
                <button class="scope-pill" :class="{ active: feedMode === 'latest' }"  @click="setFeedMode('latest')">Latest</button>
              </div>
              <!-- Mobile row 2: category pills -->
              <div class="feed-pills-row feed-cat-pills-row">
                <button class="scope-pill" :class="{ active: selectedCategory === 'all' }" @click="selectCategory('all')">All</button>
                <button
                  v-for="cat in VISIBLE_CATEGORIES"
                  :key="'mp-' + cat.id"
                  class="scope-pill"
                  :class="{ active: selectedCategory === cat.id }"
                  @click="selectCategory(cat.id)"
                >{{ cat.label }}</button>
              </div>
            </div>

            <!-- Desktop only: split scope tabs + mode toggle -->
            <div class="feed-toolbar feed-toolbar--desktop">
              <div class="feed-toolbar-row">
                <div class="feed-scope-tabs">
                  <button class="scope-tab" :class="{ active: feedScope === 'mine' }"  @click="setScope('mine')">
                    <ion-icon :icon="bookmarkOutline"></ion-icon> My Spaces
                  </button>
                  <button class="scope-tab" :class="{ active: feedScope === 'relay' }" @click="setScope('relay')">
                    <ion-icon :icon="globeOutline"></ion-icon> This Relay
                  </button>
                  <button class="scope-tab" :class="{ active: feedScope === 'explore' }" @click="setScope('explore')">
                    <ion-icon :icon="ellipseOutline"></ion-icon> Explore
                  </button>
                </div>
                <div class="feed-mode-toggle">
                  <button class="mode-btn" :class="{ active: feedMode === 'for-you' }" @click="setFeedMode('for-you')">For You</button>
                  <button class="mode-btn" :class="{ active: feedMode === 'latest' }"  @click="setFeedMode('latest')">Latest</button>
                </div>
              </div>
            </div>

            <!-- Tag strip — desktop only (categories live in sidebar on desktop) -->
            <div class="desktop-tag-strip">
              <button
                v-for="t in trendingTagChips"
                :key="t.tag"
                class="tag-chip"
                :class="{ active: activeTagFilter === t.tag, 'tag-chip--history': isUserTag(t.tag) }"
                @click="handleTagChipClick(t.tag)"
              >
                <svg v-if="isUserTag(t.tag)" viewBox="0 0 24 24" fill="none" width="9" height="9">
                  <path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z" stroke="currentColor" stroke-width="2"/>
                </svg>
                #{{ t.tag }}
              </button>
            </div>

            <!-- Mobile-top-strip: desktop tags only — categories now in pill strip -->
            <div class="mobile-top-strip mobile-top-strip--desktop-only" :class="{ 'show-tags': mobileShowTags }">
              <div class="mobile-top-strip__tags">
                <button
                  v-for="t in trendingTagChips.slice(0, 8)"
                  :key="t.tag"
                  class="tag-chip"
                  :class="{ 'tag-chip--history': isUserTag(t.tag) }"
                  @click="handleTagChipClick(t.tag)"
                >#{{ t.tag }}</button>
              </div>
              <div class="mobile-top-strip__cats">
                <button
                  class="feed-cat-pill"
                  :class="{ active: selectedCategory === 'all' }"
                  @click="selectCategory('all')"
                >All</button>
                <button
                  v-for="cat in (showMoreCategories ? VISIBLE_CATEGORIES : VISIBLE_CATEGORIES.slice(0, 5))"
                  :key="'mob-' + cat.id"
                  class="feed-cat-pill"
                  :class="{ active: selectedCategory === cat.id }"
                  @click="selectCategory(cat.id)"
                >{{ cat.label }}</button>
                <button class="feed-cat-pill feed-cat-more" @click="showMoreCategories = !showMoreCategories">
                  <ion-icon :icon="chevronDownOutline" :style="showMoreCategories ? 'transform:rotate(180deg)' : ''"></ion-icon>
                </button>
              </div>
            </div>

            <!-- Category pills: mobile uses mobile-top-strip__cats, tablet+ uses sidebar -->

            <!-- "My Spaces" empty hint -->
            <div v-if="feedScope === 'mine' && joinedCommunityIds.size === 0" class="scope-hint surface-card">
              <ion-icon :icon="bookmarkOutline" size="large"></ion-icon>
              <p>You haven't joined any spaces yet.</p>
              <p class="subtitle">Join spaces in the <button class="inline-link" @click="activeTab = 'communities'">Spaces</button> tab — your feed will be scoped to them.</p>
            </div>

            <!-- Active tag filter pill -->
            <div v-if="activeTagFilter" class="active-tag-filter-row">
              <span class="active-tag-label">#{{ activeTagFilter }}</span>
              <button class="active-tag-clear" @click="activeTagFilter = null">✕ Clear</button>
            </div>

            <div v-if="isLoadingPosts" class="loading-container">
              <ion-spinner></ion-spinner>
              <p>Loading content…</p>
            </div>

            <div v-else-if="combinedFeed.length > 0" ref="feedListEl" class="feed-list">
              <div v-if="newContentCount > 0" class="new-content-banner" @click="flushNewContent">
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
                  :relay-label="activeRelayLabel"
                  :user-tags="recentTags"
                  @click="navigateToPost(item.data)"
                  @upvote="handleUpvote(item.data); recordEngagement(item.data.category, item.data.tags)"
                  @downvote="handleDownvote(item.data)"
                  @moderation-submit="handleModerationSubmit(item.data)"
                  @comments="navigateToPost(item.data)"
                  @tag-click="handleTagClick"
                />
                <PollCard
                  v-else-if="item.type === 'poll'"
                  :poll="item.data"
                  :community-name="getCommunityName(item.data.communityId)"
                  :has-upvoted="hasUpvotedPoll(item.data.id)"
                  :has-downvoted="hasDownvotedPoll(item.data.id)"
                  :show-moderation-action="ModerationService.canSubmitHashesFromHome()"
                  moderation-action-title="Send this poll text to the moderation API"
                  :relay-label="activeRelayLabel"
                  :user-tags="recentTags"
                  @click="navigateToPoll(item.data)"
                  @vote="navigateToPoll(item.data)"
                  @upvote="handleUpvotePoll(item.data); recordEngagement(item.data.category, item.data.tags)"
                  @downvote="handleDownvotePoll(item.data)"
                  @moderation-submit="handleModerationSubmitPoll(item.data)"
                  @tag-click="handleTagClick"
                />
              </template>

              <ion-infinite-scroll :disabled="!hasMore" @ionInfinite="onInfiniteScroll">
                <ion-infinite-scroll-content loading-spinner="bubbles" />
              </ion-infinite-scroll>
            </div>

            <div v-else class="empty-state empty-state--home">
              <ion-icon :icon="documentTextOutline" size="large"></ion-icon>
              <p>No content yet</p>
              <p class="subtitle">
                <template v-if="feedScope === 'mine'">
                  Join spaces below, or switch to <button class="inline-link" @click="setScope('relay')">This Relay</button> to browse everything.
                </template>
                <template v-else>
                  Content syncs from peers and can take 5–10 seconds on first visit.
                </template>
              </p>
              <div class="empty-state__actions">
                <ion-button @click="activeTab = 'communities'">
                  <ion-icon slot="start" :icon="peopleOutline"></ion-icon>
                  Browse Spaces
                </ion-button>
                <ion-button fill="outline" @click="activeTab = 'create'">
                  <ion-icon slot="start" :icon="addCircleOutline"></ion-icon>
                  Create the first poll
                </ion-button>
              </div>
            </div>
          </div>

          <!-- SPACES TAB (was Communities) -->
          <CommunitiesTab
            v-else-if="activeTab === 'communities'"
            :communityFilter="communityFilter"
            @update:communityFilter="communityFilter = $event"
          />

          <!-- PUBLISH TAB (was Create) -->
          <CreateTab
            v-else-if="activeTab === 'create'"
            @showPostOptions="showPostOptions"
            @showPollOptions="showPollOptions"
          />

          <!-- MESSAGES TAB (was Chat) -->
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

        <!-- ── RIGHT SIDEBAR ─────────────────────────────────────────── -->
        <AppRightSidebar />

      </div>
    </ion-content>

    <!-- Moderation onboarding modal (unchanged) -->
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
              <p>We can quietly hide posts that a moderation service has already flagged. It checks only the post text hash — not your username or profile.</p>
            </div>
          </div>
          <div class="moderation-onboarding-card__highlights">
            <div class="moderation-onboarding-card__highlight">
              <ion-icon :icon="sparklesOutline"></ion-icon>
              <span>Cleaner feed</span>
            </div>
            <div class="moderation-onboarding-card__highlight">
              <ion-icon :icon="eyeOffOutline"></ion-icon>
              <span>Hide unwanted posts before they appear</span>
            </div>
            <div class="moderation-onboarding-card__highlight">
              <ion-icon :icon="linkOutline"></ion-icon>
              <span>Switch off anytime in Settings</span>
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
            <p class="moderation-onboarding-card__hint">This should be the base address of your moderation API.</p>
            <p v-if="moderationCustomApiError" class="moderation-onboarding-card__error">{{ moderationCustomApiError }}</p>
          </div>
          <div class="moderation-onboarding-card__actions">
            <button class="moderation-onboarding-card__secondary" @click="skipModerationOnboarding">No thanks, show everything</button>
            <button class="moderation-onboarding-card__primary" :disabled="moderationSaving" @click="confirmModerationOnboarding">
              {{ moderationSaving ? 'Saving…' : moderationChoice === 'custom' ? 'Use this address' : 'Turn on feed filter' }}
            </button>
          </div>
          <p class="moderation-onboarding-card__footer">You can change this later in <strong>Settings → General</strong>.</p>
        </section>
      </div>
    </ion-modal>

    <!-- Relay sheet (slide-up) -->
    <RelaySheet v-model="relaySheetOpen" />

    <!-- Bottom Nav (mobile only) -->
    <ion-footer class="bottom-nav-footer">
      <div class="bottom-nav" :class="{ 'bottom-nav-hidden': isTabBarHidden }">

        <!-- Feed -->
        <button class="nav-item" :class="{ active: activeTab === 'home' }" @click="activeTab = 'home'">
          <span class="nav-icon-wrap">
            <svg class="nav-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
              <path v-if="activeTab==='home'" d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" fill="currentColor" stroke="none"/>
              <template v-else>
                <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>
                <path d="M9 22V12h6v10"/>
              </template>
            </svg>
          </span>
          <span class="nav-label">Feed</span>
        </button>

        <!-- Spaces -->
        <button class="nav-item" :class="{ active: activeTab === 'communities' }" @click="activeTab = 'communities'">
          <span class="nav-icon-wrap">
            <svg class="nav-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round">
              <circle :fill="activeTab==='communities' ? 'currentColor' : 'none'" cx="9" cy="8" r="3.5"/>
              <path d="M3 21v-.5A5.5 5.5 0 018.5 15h1A5.5 5.5 0 0115 20.5v.5"/>
              <path d="M16 4a3.5 3.5 0 010 7"/>
              <path d="M21 21v-.5a5.5 5.5 0 00-4-5.32"/>
            </svg>
          </span>
          <span class="nav-label">Spaces</span>
        </button>

        <!-- Messages -->
        <button class="nav-item" :class="{ active: activeTab === 'chat' }" @click="activeTab = 'chat'">
          <span class="nav-icon-wrap">
            <svg class="nav-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
              <path :fill="activeTab==='chat' ? 'currentColor' : 'none'"
                d="M20 2H4a2 2 0 00-2 2v14l4-4h14a2 2 0 002-2V4a2 2 0 00-2-2z"/>
            </svg>
            <span v-if="totalUnread > 0" class="nav-badge nav-badge--mobile">{{ totalUnread > 99 ? "99+" : totalUnread }}</span>
          </span>
          <span class="nav-label">Messages</span>
        </button>

        <!-- Publish -->
        <button class="nav-item" :class="{ active: activeTab === 'create' }" @click="activeTab = 'create'">
          <span class="nav-icon-wrap">
            <svg class="nav-svg" viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"
                :fill="activeTab==='create' ? 'currentColor' : 'none'"
                :stroke="activeTab==='create' ? 'none' : 'currentColor'"
                stroke-width="1.75"/>
              <line x1="12" y1="8" x2="12" y2="16"
                :stroke="activeTab==='create' ? 'white' : 'currentColor'"
                stroke-width="2" stroke-linecap="round"/>
              <line x1="8" y1="12" x2="16" y2="12"
                :stroke="activeTab==='create' ? 'white' : 'currentColor'"
                stroke-width="2" stroke-linecap="round"/>
            </svg>
          </span>
          <span class="nav-label">Publish</span>
        </button>

        <!-- Network -->
        <button class="nav-item" @click="$router.push('/network')">
          <span class="nav-icon-wrap">
            <RelayIndicator :compact="true" />
          </span>
          <span class="nav-label">Network</span>
        </button>

      </div>
    </ion-footer>

  </ion-page>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick, defineAsyncComponent } from 'vue';
import {
  IonPage, IonHeader, IonToolbar, IonTitle, IonContent, IonBadge,
  IonButtons, IonButton, IonIcon, IonFooter, IonModal, IonSpinner,
  IonInfiniteScroll, IonInfiniteScrollContent,
  actionSheetController, toastController,
} from '@ionic/vue';
import {
  cube, personCircleOutline, settingsOutline, addCircleOutline, addOutline,
  earthOutline, peopleOutline, home, homeOutline, documentTextOutline,
  chevronForwardOutline, chevronDownOutline, people, addCircle, statsChartOutline,
  searchOutline, chatbubble, chatbubbleOutline, bookmarkOutline, globeOutline,
  shieldCheckmarkOutline, sparklesOutline, eyeOffOutline, linkOutline,
  codeSlashOutline, gameControllerOutline, flaskOutline, businessOutline,
  logoBitcoin, trophyOutline, ellipsisHorizontalOutline, lockClosedOutline,
  qrCodeOutline, tvOutline, happyOutline, chatbubblesOutline, cashOutline,
  heartOutline, schoolOutline, locationOutline, ellipseOutline,
} from 'ionicons/icons';

// Inline telescope icon SVG path as a fallback (not in all ionicons builds)
const telescopeOutline = 'M21.03 3.03a1 1 0 00-1.42 0L16 6.64l-1.29-1.29a1 1 0 00-1.42 1.42L14.58 8l-3.29 3.29-1.29-1.3A1 1 0 008.58 11.4l1.3 1.3-5.3 5.3H3a1 1 0 000 2h18a1 1 0 000-2h-1.59l-2-2 1.3-1.3a1 1 0 00-1.42-1.41l-1.29 1.29L12.71 11l3.29-3.29 1.3 1.3a1 1 0 001.41-1.42L17.42 6.3l3.61-3.61a1 1 0 000-1.66z';

import { useQrScan } from '../composables/useQrScan';
import { useRoute, useRouter } from 'vue-router';
import { useChainStore } from '../stores/chainStore';
import { useCommunityStore } from '../stores/communityStore';
import type { Community } from '../services/communityService';
import { usePostStore } from '../stores/postStore';
import { usePollStore } from '../stores/pollStore';

// ── Lazy-loaded tab components ─────────────────────────────────────────────
const CommunitiesTab   = defineAsyncComponent(() => import('../components/CommunitiesTab.vue'));
const CreateTab        = defineAsyncComponent(() => import('../components/CreateTab.vue'));
const ChatTab          = defineAsyncComponent(() => import('../components/ChatTab.vue'));
const PostCard         = defineAsyncComponent(() => import('../components/PostCard.vue'));
const PollCard         = defineAsyncComponent(() => import('../components/PollCard.vue'));
// Heavy sidebar/overlay components — loaded async so they don't block initial paint
const RelayIndicator   = defineAsyncComponent(() => import('../components/RelayIndicator.vue'));
const AppSideNav       = defineAsyncComponent(() => import('../components/AppSideNav.vue'));
const BurstOverlay     = defineAsyncComponent(() => import('../components/BurstOverlay.vue'));
const AppRightSidebar  = defineAsyncComponent(() => import('../components/AppRightSidebar.vue'));
const RelaySheet       = defineAsyncComponent(() => import('../components/RelaySheet.vue'));

// ── New components ─────────────────────────────────────────────────────────
import { Post } from '../services/postService';
import { Poll } from '../services/pollService';
import { GunService } from '../services/gunService';
import { UserService } from '../services/userService';
import { warmupFromDB } from '../services/dbWarmup';
import { fetchVoteTallies } from '../services/relayFeedService';
import { ModerationService, moderationVersion } from '../services/moderationService';
import { RelayManager } from '../services/relayManager';
import config from '../config';

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
const HOME_GUN_FEED_ENABLED         = localStorage.getItem('interpoll_home_gun_feed') !== 'false';
const HOME_GUN_FEED_MAX_COMMUNITIES = 8;

const HOME_TABS = ['home', 'communities', 'chat', 'create'] as const;
type HomeTab = typeof HOME_TABS[number];
function tabFromRoute(): HomeTab {
  const raw   = route.query.tab;
  const value = Array.isArray(raw) ? raw[0] : raw;
  return HOME_TABS.includes(value as HomeTab) ? (value as HomeTab) : 'home';
}

const activeTab          = ref<string>(tabFromRoute());
const communityFilter    = ref('all');
const isLoadingPosts     = ref(false);
const voteVersion        = ref(0);
const isHeaderHidden     = ref(false);
const isTabBarHidden     = ref(false);
const warmupComplete     = ref(false);
const showMoreCategories = ref(false);
const relaySheetOpen     = ref(false);

// ── View tracking — feed list ref (must be in setup scope for template binding) ──
const feedListEl = ref<HTMLElement | null>(null);
let feedMutObs: MutationObserver | null = null;

// ── Feed scope: 'mine' | 'relay' | 'explore' ──────────────────────────────
type FeedScope = 'mine' | 'relay' | 'explore';
const feedScope = ref<FeedScope>(
  (route.query.scope as FeedScope)
  || (localStorage.getItem('interpoll_feed_scope') as FeedScope)
  || 'relay'
);
function setScope(s: FeedScope) {
  feedScope.value = s;
  void router.push({ query: { ...route.query, scope: s, tab: 'home' } });
}
function setScopeAndHome(s: FeedScope) {
  feedScope.value = s;
  activeTab.value = 'home';
  void router.push({ query: { ...route.query, scope: s, tab: undefined } });
}

// Sync scope from URL (e.g. when DesktopSideNav pushes ?scope=)
watch(
  () => route.query.scope,
  (s) => {
    if (s && ['mine', 'relay', 'explore'].includes(s as string)) {
      feedScope.value = s as FeedScope;
    }
  },
  { immediate: true },
);
// Persist scope to localStorage
watch(feedScope, (s) => {
  localStorage.setItem('interpoll_feed_scope', s);
});

// Set of joined community IDs for "My Spaces" filtering
const joinedCommunityIds = computed(() => {
  const ids = new Set<string>();
  communityStore.communities.forEach((c: any) => {
    if (communityStore.isJoined?.(c.id)) ids.add(c.id);
  });
  return ids;
});

// Active relay label for relay-attribution on cards
const activeRelayLabel = computed(() => {
  const r = RelayManager.getActiveRelay();
  if (!r) return '';
  try { return new URL(r.ws).hostname; }
  catch { return r.label || ''; }
});

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

// ── Composables ────────────────────────────────────────────────────────────
const tutorial   = useTutorial();
const moderation = useModeration();
const {
  tutorialVisible, tutorialStep, currentTutorialStep, TUTORIAL_STEPS: tutorialSteps,
  skipTutorial, previousTutorialStep, nextTutorialStep,
} = tutorial;
const {
  moderationOnboardingOpen, moderationChoice, moderationCustomApiUrl,
  moderationCustomApiInput, moderationCustomApiError, moderationSaving,
  skipModerationOnboarding, handleModerationModalDismiss, confirmModerationOnboarding,
  maybeShowOnboarding,
} = moderation;

// ── Chat lazy init ─────────────────────────────────────────────────────────
const gunListeners: Array<() => void> = [];
let currentUserId = '';
let chatComposable: ReturnType<typeof useChat> | null = null;

const chatList          = ref<any[]>([]);
const totalUnread       = ref(0);
const userSearchResults = ref<any[]>([]);
const searchingUsers    = ref(false);
const userSearchQuery   = ref('');

function ensureChat() {
  if (!chatComposable && currentUserId) {
    chatComposable = useChat(currentUserId, gunListeners);
    watch(chatComposable.chatList,          v => { chatList.value    = v; });
    watch(chatComposable.totalUnread,       v => { totalUnread.value = v; });
    watch(chatComposable.userSearchResults, v => { userSearchResults.value = v; });
    watch(chatComposable.searchingUsers,    v => { searchingUsers.value    = v; });
  }
  return chatComposable;
}
async function ensureChatInitialized()           { const c = ensureChat(); if (c) await c.ensureChatInitialized(activeTab); }
async function ensureBackgroundChatInitialized() { const c = ensureChat(); if (c) await c.ensureChatInitialized(activeTab); }
function openChat(chat: any)          { ensureChat()?.openChat(chat); }
function startChatWithUser(user: any) { ensureChat()?.startChatWithUser(user); }
function clearUserSearch()            { ensureChat()?.clearUserSearch(); userSearchQuery.value = ''; }
async function handleUserSearch()     { await ensureChat()?.handleUserSearch(); }
async function loadChatList()         { await ensureChat()?.loadChatList(); }
async function processPendingChatInvites(userId: string) { await ensureChat()?.processPendingChatInvites(userId); }

// ── Feed mode & categories ─────────────────────────────────────────────────
const feedMode = ref<'for-you' | 'latest'>('for-you');
function setFeedMode(mode: 'for-you' | 'latest') { feedMode.value = mode; }

function categoryFromRoute(): string {
  const raw   = route.query.category;
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === 'string' ? value : 'all';
}
const selectedCategory = ref<string>(categoryFromRoute());

watch(selectedCategory, (cat) => {
  if (cat !== 'all') void pollStore.loadAllCommunityPolls?.();
});
watch(() => route.query.category, () => {
  const cat = categoryFromRoute();
  if (selectedCategory.value !== cat) selectedCategory.value = cat;
});

import { useCategories } from '../composables/useCategories';
import { useBurst }      from '../composables/useBurst';
import { observePost, isAlreadyTracked, setOnViewConfirmed, getViewedIds } from '../services/viewTrackingService';
const { ALL_CATEGORIES, recordEngagement, recentTags, isUserTag, loadTrendingTags, topCategories } = useCategories();
const { triggerBurst } = useBurst();
const VISIBLE_CATEGORIES = ALL_CATEGORIES;
const feedCategories = computed(() =>
  showMoreCategories.value ? VISIBLE_CATEGORIES : VISIBLE_CATEGORIES.slice(0, 6)
);

const sidebarCatsOpen     = ref(true);
const sidebarCatsExpanded = ref(false);
const mobileShowTags   = ref(false);
const trendingTagChips = ref<Array<{ tag: string; count: number }>>([]);

function handleTagChipClick(tag: string) {
  activeTagFilter.value = activeTagFilter.value === tag ? null : tag;
  try { recordEngagement(undefined, [tag]); } catch { /* non-fatal */ }
}

function selectCategory(id: string) {
  selectedCategory.value = id;
  void router.push({ query: { ...route.query, category: id === 'all' ? undefined : id } });
}

// ── Tag filter ─────────────────────────────────────────────────────────────
const activeTagFilter = ref<string | null>(null);

function handleTagClick(tag: string) {
  activeTagFilter.value = activeTagFilter.value === tag ? null : tag;
  recordEngagement(undefined, [tag]);
}

function itemMatchesTag(item: { type: string; data: any }, tag: string): boolean {
  const tags = item.data.tags;
  if (!tags) return false;
  const arr = Array.isArray(tags) ? tags : String(tags).split(',').map((t: string) => t.trim());
  return arr.includes(tag);
}

// ── Feed computation with scope filtering ──────────────────────────────────
function itemMatchesScope(item: { type: string; data: any }): boolean {
  if (feedScope.value === 'relay' || feedScope.value === 'explore') return true;
  // 'mine' — show only items from joined communities
  const communityId = item.data.communityId;
  if (!communityId) return false;
  return joinedCommunityIds.value.has(communityId);
}

function itemMatchesCategory(item: { type: string; data: any }): boolean {
  if (selectedCategory.value === 'all') return true;
  const cat = selectedCategory.value.toLowerCase();
  if (item.data.category && String(item.data.category).toLowerCase() === cat) return true;
  if (item.data.tags) {
    const tags = Array.isArray(item.data.tags) ? item.data.tags : String(item.data.tags).split(',');
    if (tags.some((t: any) => String(t).toLowerCase().trim() === cat)) return true;
  }
  return false;
}

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

// Session shuffle seed — fixed at page load so the For You order is stable
// while the user scrolls, but different on each page reload.
const SESSION_SHUFFLE_SEED = Math.floor(Date.now() / 1000);
// Memoised For You weights — keyed by itemId+prefSig so unchanged items skip recomputation
const _weightCache = new Map<string, number>();

// ── Feed order stability ──────────────────────────────────────────────────────
// Gun delivers peer updates continuously — every write triggers triggerRef on
// postsMap/pollsMap which would cause combinedFeed to re-sort and visually
// reshuffle cards the user is actively reading.
// Fix: _rankedOrder caches the sorted id list. It only rebuilds when the user
// explicitly changes mode/category/scope, or when preferences change from
// engagement. New content from Gun is appended at the top; existing order is
// preserved. Gun-triggered count/tally updates do NOT reshuffle.
const _rankedOrder   = ref<string[]>([]);        // ordered list of item ids
const _rankedItems   = new Map<string, any>();   // id → feed item (kept fresh)
const _rankDirty     = ref(0);                   // increment to force a re-rank

// Explicit re-rank triggers: mode, category, scope, preferences
watch([feedMode, selectedCategory, feedScope, topCategories, recentTags],
  () => { _rankDirty.value++; _weightCache.clear(); },
  { flush: 'post' }
);

const combinedFeed = computed(() => {
  moderationVersion.value;
  selectedCategory.value;
  feedScope.value;
  feedMode.value;
  _rankDirty.value; // explicit re-rank trigger only

  const allPosts = postStore.sortedPosts
    .filter(post => !ModerationService.isPostBodyBlocked(getPostModerationText(post)));
  const allPolls = postStore.visibleCount !== undefined
    ? pollStore.sortedPolls.filter(p => !p.isPrivate && !ModerationService.isPostBodyBlocked(getPollModerationText(p)))
    : [];

  // Build current item map (always fresh so counts/votes update in-place)
  _rankedItems.clear();
  for (const post of allPosts) {
    _rankedItems.set(`post-${post.id}`, { type: 'post' as const, data: post, createdAt: post.createdAt });
  }
  for (const poll of allPolls) {
    _rankedItems.set(`poll-${poll.id}`, { type: 'poll' as const, data: poll, createdAt: poll.createdAt });
  }

  // Apply category filter
  const filtered: Array<{ type: 'post' | 'poll'; data: any; createdAt: number }> = [];
  for (const item of _rankedItems.values()) {
    if (selectedCategory.value && selectedCategory.value !== 'all') {
      if (item.data.category !== selectedCategory.value) continue;
    }
    filtered.push(item);
  }

  if (filtered.length === 0) return [];

  // Latest mode — simple date sort, stable
  if (feedMode.value === 'latest') {
    return filtered
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, postStore.visibleCount);
  }

  // ── For You ranking ────────────────────────────────────────────────────────
  // Check which filtered ids already have a stable rank order
  const filteredIds = new Set(filtered.map(i => `${i.type}-${i.data.id}`));
  const existingOrder = _rankedOrder.value.filter(id => filteredIds.has(id));
  const newIds = filtered
    .map(i => `${i.type}-${i.data.id}`)
    .filter(id => !_rankedOrder.value.includes(id));

  // Only recompute weights for items not yet in the ranked order
  // (new arrivals from Gun get scored and prepended to top)
  if (newIds.length > 0 || existingOrder.length === 0) {
    const userTopCats = topCategories.value;
    const userTags    = new Set(recentTags.value);
    const viewedIds   = getViewedIds();
    const now         = Date.now();
    const WEEK        = 7 * 24 * 60 * 60 * 1000;
    const prefSig     = userTopCats.join(',') + '|' + recentTags.value.join(',');

    const toScore = existingOrder.length === 0 ? filtered.map(i => `${i.type}-${i.data.id}`) : newIds;

    const scored = toScore.map(itemId => {
      const item = _rankedItems.get(itemId);
      if (!item) return { itemId, weight: 0 };

      const cacheKey = itemId + prefSig + (viewedIds.has(item.data.id) ? '|seen' : '');
      const cached = _weightCache.get(cacheKey);
      if (cached !== undefined) return { itemId, weight: cached };

      const category     = item.data.category as string | null | undefined;
      const tags         = item.data.tags as string[] | null | undefined;
      const score        = item.type === 'post' ? (item.data.score ?? 0) : (item.data.totalVotes ?? 0);
      const ageMs        = now - item.createdAt;
      const catRank      = category ? userTopCats.indexOf(category) : -1;
      const catScore     = catRank === 0 ? 1.0 : catRank === 1 ? 0.5 : catRank === 2 ? 0.25 : 0;
      const tagScore     = tags?.some(t => userTags.has(t)) ? 0.3 : 0;
      const engScore     = Math.min(Math.max(score, 0) / 50, 1);
      const recencyScore = Math.exp(-ageMs / (WEEK * 0.43));
      const shuffleSeed  = hashStringToInt(itemId + String(SESSION_SHUFFLE_SEED));
      const shuffleScore = seededRandom(shuffleSeed);
      const seenPenalty  = viewedIds.has(item.data.id) ? -0.6 : 0;
      const weight = catScore * 0.40 + tagScore * 0.10 + engScore * 0.25
                   + recencyScore * 0.20 + shuffleScore * 0.15 + seenPenalty;
      _weightCache.set(cacheKey, weight);
      return { itemId, weight };
    });

    scored.sort((a, b) => b.weight - a.weight);
    const newScoredIds = scored.map(s => s.itemId);

    // New items go to the top; existing stable order preserved below
    _rankedOrder.value = existingOrder.length === 0
      ? newScoredIds
      : [...newScoredIds, ...existingOrder];
  }

  // Materialise from stable order, skipping items filtered out
  const result: Array<{ type: 'post' | 'poll'; data: any; createdAt: number }> = [];
  for (const id of _rankedOrder.value) {
    if (filteredIds.has(id)) {
      const item = _rankedItems.get(id);
      if (item) result.push(item);
    }
    if (result.length >= postStore.visibleCount) break;
  }
  return result;
});

const hasMore         = computed(() => postStore.hasMorePosts || pollStore.hasMorePolls);
const newContentCount = computed(() => postStore.newPostCount + pollStore.newPollCount);

function getPollModerationText(poll: Poll): string {
  return [poll.question, poll.description, ...(poll.options || []).map((o: any) => o.text)].filter(Boolean).join(' ');
}
function getPostModerationText(post: Post): string {
  return [post.title, post.content].filter(Boolean).join(' ');
}
function ensureInitialFeedVisible(reason: string) {
  if (combinedFeed.value.length > 0) return;
  postStore.resetVisibleCount?.();
  pollStore.resetVisibleCount?.();
}

// ── Voting ─────────────────────────────────────────────────────────────────
function hasUpvoted(postId: string): boolean   { voteVersion.value; return postStore.myVote(postId) === 'up'; }
function hasDownvoted(postId: string): boolean  { voteVersion.value; return postStore.myVote(postId) === 'down'; }
function hasUpvotedPoll(pollId: string): boolean  { voteVersion.value; return pollStore.myPollContentVote(pollId) === 'up'; }
function hasDownvotedPoll(pollId: string): boolean { voteVersion.value; return pollStore.myPollContentVote(pollId) === 'down'; }

async function presentVoteToast(message: string, expectedVersion: number) {
  await nextTick();
  if (voteVersion.value !== expectedVersion) return;
  const toast = await toastController.create({ message, duration: 1500, position: 'bottom' });
  await toast.present();
}

async function handlePostVote(post: Post, direction: 'up' | 'down') {
  voteVersion.value++;
  const version = voteVersion.value;
  try {
    await postStore.toggleVote(post.id, direction);
    voteVersion.value++;
    const current = postStore.myVote(post.id);
    await presentVoteToast(current === direction ? (direction === 'up' ? 'Liked' : 'Disliked') : 'Removed', version);
  } catch {
    voteVersion.value++;
    (await toastController.create({ message: 'Failed to vote', duration: 2000 })).present();
  }
}
const handleUpvote   = (post: Post) => { triggerBurst('heart');   handlePostVote(post, 'up'); };
const handleDownvote = (post: Post) => { triggerBurst('dislike'); handlePostVote(post, 'down'); };

async function handleUpvotePoll(poll: Poll) {
  triggerBurst('heart');
  const wasActive = pollStore.myPollContentVote(poll.id) === 'up';
  voteVersion.value++;
  const version = voteVersion.value;
  try {
    await pollStore.togglePollContentVote(poll.id, 'up');
    voteVersion.value++;
    await presentVoteToast(wasActive ? 'Like removed' : 'Liked', version);
  } catch {
    voteVersion.value++;
    (await toastController.create({ message: 'Failed to upvote poll', duration: 2000 })).present();
  }
}
async function handleDownvotePoll(poll: Poll) {
  triggerBurst('dislike');
  const wasActive = pollStore.myPollContentVote(poll.id) === 'down';
  voteVersion.value++;
  const version = voteVersion.value;
  try {
    await pollStore.togglePollContentVote(poll.id, 'down');
    voteVersion.value++;
    await presentVoteToast(wasActive ? 'Dislike removed' : 'Disliked', version);
  } catch {
    voteVersion.value++;
    (await toastController.create({ message: 'Failed to downvote poll', duration: 2000 })).present();
  }
}

// ── Navigation ─────────────────────────────────────────────────────────────
function getCommunityName(communityId: string): string {
  return communityStore.communities.find((c: any) => c.id === communityId)?.displayName || communityId;
}
function navigateToPost(post: Post) {
  // Always use the flat route — /community/:id/post/:id does not exist in the router.
  // PostDetailPage reads communityId from the post object itself, so no context is lost.
  router.push(`/post/${post.id}`);
}
function navigateToPoll(poll: Poll) {
  const communityId = (poll as any).communityId || (poll as any).community_id;
  if (communityId) {
    router.push(`/community/${communityId}/poll/${poll.id}`);
  } else {
    router.push(`/poll/${poll.id}`);
  }
}

async function handleModerationSubmit(post: Post) {
  if (!ModerationService.canSubmitHashesFromHome()) return;
  await ModerationService.submitPostHash(post);
}
async function handleModerationSubmitPoll(poll: Poll) {
  if (!ModerationService.canSubmitHashesFromHome()) return;
  await ModerationService.submitPollHash(poll);
}

// ── Scroll ─────────────────────────────────────────────────────────────────
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

// ── Create actions ─────────────────────────────────────────────────────────
async function showPostOptions() {
  const joined = communityStore.communities.filter((c: any) => communityStore.isJoined(c.id));
  const list = joined.length > 0 ? joined : communityStore.communities;
  const actionSheet = await actionSheetController.create({
    header: 'Create a post in…',
    buttons: list.slice(0, 8).map((c: any) => ({
      text: c.displayName,
      handler: () => { router.push(`/community/${c.id}/create-post`); },
    })).concat([{ text: 'Cancel', role: 'cancel' }]),
  });
  await actionSheet.present();
}
async function showPollOptions() {
  const joined = communityStore.communities.filter((c: any) => communityStore.isJoined(c.id));
  const list = joined.length > 0 ? joined : communityStore.communities;
  const actionSheet = await actionSheetController.create({
    header: 'Create a poll in…',
    buttons: list.slice(0, 8).map((c: any) => ({
      text: c.displayName,
      handler: () => { router.push(`/community/${c.id}/create-poll`); },
    })).concat([{ text: 'Cancel', role: 'cancel' }]),
  });
  await actionSheet.present();
}

// ── Community subscription ─────────────────────────────────────────────────
const subscribedCommunityIds = new Set<string>();
async function subscribeNewCommunities(communities: typeof communityStore.communities) {
  const toSubscribe = communities
    .filter((c: any) => !c.isPrivate)
    .slice(0, HOME_GUN_FEED_MAX_COMMUNITIES)
    .filter((c: any) => !subscribedCommunityIds.has(c.id));
  if (toSubscribe.length === 0) return;
  for (const community of toSubscribe) {
    subscribedCommunityIds.add(community.id);
    const timeoutPromise = new Promise<void>(resolve => setTimeout(resolve, 8000));
    await Promise.race([
      Promise.all([
        postStore.loadPostsForCommunity(community.id),
        pollStore.loadPollsForCommunity(community.id),
      ]),
      timeoutPromise,
    ]);
  }
}

async function tryRecoverEmptyFeedFromGun() {
  if (combinedFeed.value.length > 0) return;
  await new Promise<void>(resolve => setTimeout(resolve, 4000));
  ensureInitialFeedVisible('empty-feed-gun-recovery');
}

// ── Community display helpers ──────────────────────────────────────────────
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

const sidebarCommunities = computed(() => communityStore.communities);

// ── Trending categories ────────────────────────────────────────────────────
import { CATEGORY_MAP } from '../composables/useCategories';
const trendingCategories = ref<Array<{ id: string; label: string; posts: string; icon: any; tone: string }>>([]);

async function loadTrendingCategories() {
  try {
    const res = await fetch(`${config.relay.api}/api/trending-categories`);
    if (!res.ok) return;
    const json = await res.json();
    trendingCategories.value = (json.categories || []).slice(0, 8).map((c: any) => {
      const def = CATEGORY_MAP.get(c.id);
      return {
        id:    c.id,
        label: def?.label ?? c.label ?? c.id,
        posts: c.posts,
        icon:  def?.icon  ?? ellipseOutline,
        tone:  'tone-' + (def?.tone ?? c.id),
      };
    });
  } catch { /* sidebar stays empty on error */ }
}

// ── Watchers & lifecycle ───────────────────────────────────────────────────
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
  void loadTrendingCategories();
  void loadTrendingTags();

  // Record engagement when a card is dwelled on — feed personalisation learns
  // from what you actually read, not just what you upvote.
  setOnViewConfirmed((id, type, el) => {
    const article = el as HTMLElement;
    const category = article.dataset.category || undefined;
    const tagsRaw  = article.dataset.tags || '';
    const tags     = tagsRaw ? tagsRaw.split(',').filter(Boolean) : [];
    if (category || tags.length) recordEngagement(category, tags);
  });

  // Load trending tag chips
  try {
    const res = await fetch(`${config.relay.api}/api/tags/trending?limit=12&window=7d`);
    if (res.ok) {
      const json = await res.json();
      trendingTagChips.value = (json.tags || []).slice(0, 12);
    }
  } catch { /* non-fatal — strip stays empty */ }

  // Mobile strip: rotate between tags and categories every 8s
  setInterval(() => { mobileShowTags.value = !mobileShowTags.value; }, 8000);

  await warmupFromDB();
  ensureInitialFeedVisible('warmup-finished');

  if (HOME_GUN_FEED_ENABLED && communityStore.communities.length > 0) {
    subscribeNewCommunities(communityStore.communities);
  }
  warmupComplete.value = true;

  const feedPromise = communityStore.loadCommunities();

  await feedPromise;
  if (combinedFeed.value.length === 0) {
    await tryRecoverEmptyFeedFromGun();
    ensureInitialFeedVisible('empty-feed-recovery');
  }

  // Single deduped hydration pass — runs once after feed is populated.
  // Collapsed from 3 separate calls (early watch + post-feedPromise + 5s timeout)
  // that all fetched the same first-30 IDs.
  void (async () => {
    try {
      const visiblePostIds = combinedFeed.value
        .filter(item => item.type === 'post').slice(0, 30)
        .map(item => item.data.id as string);
      const visiblePollIds = combinedFeed.value
        .filter(item => item.type === 'poll').slice(0, 30)
        .map(item => item.data.id as string);
      await Promise.allSettled([
        visiblePostIds.length ? postStore.hydrateCommentCounts(visiblePostIds) : Promise.resolve(),
        visiblePollIds.length
          ? fetchVoteTallies(visiblePollIds).then(tallies => {
              for (const [id, tally] of Object.entries(tallies)) {
                if (tally) pollStore.patchPollTally(id, tally);
              }
            })
          : Promise.resolve(),
      ]);
    } catch { /* non-fatal */ }
  })();

  // Heavy user-dependent init — runs in background, non-blocking
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
});

// ── View tracking via MutationObserver on the feed list ──────────────────
// feedListEl is bound via ref="feedListEl" in the template.
// Uses data-post-id / data-poll-id attributes — reliable, no Vue-internal hacks.
// nextTick() after MutationObserver fires gives async components time to stamp
// their data-* attributes before we try to read them.
//
// IMPORTANT: wireViewObservers must NEVER be called on the full root on every
// mutation — that disconnects and recreates IntersectionObservers for cards
// already being tracked, resetting their dwell timers and causing double-counts.
// Only new/untracked elements are wired; already-tracked ones are skipped.
function wireOneCard(el: Element) {
  const isPost = el.classList.contains('post-card');
  const id = isPost
    ? (el as HTMLElement).dataset.postId
    : (el as HTMLElement).dataset.pollId;
  if (id) observePost(el, id, isPost ? 'post' : 'poll');
}

function wireNewCards(root: Element) {
  root.querySelectorAll('article.post-card[data-post-id], article.poll-card[data-poll-id]').forEach(el => {
    const isPost = el.classList.contains('post-card');
    const id = isPost
      ? (el as HTMLElement).dataset.postId
      : (el as HTMLElement).dataset.pollId;
    // Skip cards already tracked — do NOT disconnect and recreate their observer
    if (id && !isAlreadyTracked(id)) wireOneCard(el);
  });
}

watch(feedListEl, (el) => {
  if (feedMutObs) { feedMutObs.disconnect(); feedMutObs = null; }
  if (!el) return;

  // Wire cards already in the DOM when the ref first connects
  nextTick(() => wireNewCards(el));

  // Watch for cards added later (infinite scroll, feed updates, async component resolution).
  // On each mutation, only scan for NEW untracked cards — never re-scan existing ones.
  feedMutObs = new MutationObserver((mutations) => {
    // Fast path: check if any added node contains a card article before doing nextTick
    const hasNewCards = mutations.some(m =>
      [...m.addedNodes].some(n =>
        n instanceof Element && (
          n.matches('article.post-card, article.poll-card') ||
          n.querySelector('article.post-card, article.poll-card')
        )
      )
    );
    if (!hasNewCards) return; // attribute mutations, text nodes etc — skip entirely
    nextTick(() => wireNewCards(el));
  });
  feedMutObs.observe(el, { childList: true, subtree: true });
});

onUnmounted(() => {
  ensureChat()?.teardown();
  gunListeners.forEach(off => off());
  if (feedMutObs) { feedMutObs.disconnect(); feedMutObs = null; }
});

// ── DEV DEBUG — window.__interpoll ────────────────────────────────────────
// Exposes stores, raw Gun, and diagnostic helpers to the browser console.
// Usage: window.__interpoll.diagnose()
if (typeof window !== 'undefined') {
  (window as any).__interpoll = {
    // Raw store refs
    get postStore()      { return postStore; },
    get pollStore()      { return pollStore; },
    get communityStore() { return communityStore; },

    // Computed snapshots
    get posts()       { return postStore.sortedPosts; },
    get polls()       { return pollStore.sortedPolls; },
    get feed()        { return combinedFeed.value; },
    get postsMap()    { return postStore.postsMap; },
    get feedScope()   { return feedScope.value; },
    get feedMode()    { return feedMode.value; },

    // Gun access
    get gun()         { return GunService.getGun(); },
    get rawGun()      { return GunService.getRawGun(); },

    // One-shot full diagnosis
    // Show full dataVersion breakdown of all entries in postsMap
    inspectVersions() {
      const entries = Array.from(postStore.postsMap.values());
      const byVersion: Record<string, number> = {};
      for (const p of entries) {
        const dv = (p as any).dataVersion ?? '(undefined)';
        byVersion[dv] = (byVersion[dv] || 0) + 1;
      }
      console.group('%c[Interpoll] postsMap dataVersion breakdown', 'color:#6366f1;font-weight:bold');
      console.table(byVersion);
      console.log('Full sample (first 5):', entries.slice(0, 5).map((p: any) => ({
        id: p.id, title: p.title?.slice(0,40), dataVersion: p.dataVersion
      })));
      console.log('GUN_NAMESPACE expected:', 'v3');
      console.groupEnd();
      return byVersion;
    },

    diagnose() {
      const posts   = postStore.sortedPosts;
      const polls   = pollStore.sortedPolls;
      const feed    = combinedFeed.value;
      const mapSize = postStore.postsMap?.size ?? 'N/A';
      console.group('%c[Interpoll Debug]', 'color:#6366f1;font-weight:bold');
      console.log('postsMap size (raw store):', mapSize);
      console.log('sortedPosts length:', posts.length);
      console.log('sortedPolls length:', polls.length);
      console.log('combinedFeed length:', feed.length);
      console.log('feedScope:', feedScope.value, '| feedMode:', feedMode.value);
      console.log('joinedCommunities:', communityStore.communities?.length ?? 0);
      if (posts.length === 0 && mapSize === 0) {
        console.warn('postsMap is EMPTY — warmup or Gun subscription never delivered posts');
      } else if (posts.length === 0 && (mapSize as number) > 0) {
        console.warn('postsMap has', mapSize, 'entries but sortedPosts=0 — matchesVersion is filtering them all out');
        const sample = Array.from(postStore.postsMap.values()).slice(0, 3);
        console.log('Sample postsMap entries (check dataVersion):', sample.map((p: any) => ({ id: p.id, dataVersion: p.dataVersion, title: p.title })));
      }
      if (feed.length > 0) {
        const postCount = feed.filter((i: any) => i.type === 'post').length;
        const pollCount = feed.filter((i: any) => i.type === 'poll').length;
        console.log(`Feed breakdown: ${postCount} posts, ${pollCount} polls`);
      }
      console.groupEnd();
      return { mapSize, sortedPosts: posts.length, sortedPolls: polls.length, feed: feed.length };
    },

    // Probe Gun node directly — call with a communityId to see what's there
    async probeGun(communityId: string) {
      const gun = GunService.getGun();
      console.group('%c[Gun Probe] ' + communityId, 'color:#f59e0b;font-weight:bold');
      await new Promise<void>(resolve => {
        gun.get('communities').get(communityId).get('posts').once((data: any) => {
          const keys = data ? Object.keys(data).filter((k: string) => k !== '_') : [];
          console.log('communities/' + communityId + '/posts keys:', keys.length, keys.slice(0, 10));
          resolve();
        });
        setTimeout(resolve, 2000);
      });
      await new Promise<void>(resolve => {
        gun.get('posts').once((data: any) => {
          const keys = data ? Object.keys(data).filter((k: string) => k !== '_') : [];
          console.log('posts (global) keys:', keys.length, keys.slice(0, 10));
          resolve();
        });
        setTimeout(resolve, 2000);
      });
      console.groupEnd();
    },

    // Check what the relay API actually returns
    async probeAPI() {
      const { default: cfg } = await import('../config');
      const base = cfg.relay.api;
      console.group('%c[API Probe]', 'color:#10b981;font-weight:bold');
      try {
        const r = await fetch(base + '/api/posts?limit=5');
        const j = await r.json();
        console.log('API /api/posts sample:', j.posts?.slice(0, 3)?.map((p: any) => ({ id: p.id, dataVersion: p.dataVersion, title: p.title })));
        console.log('Total posts returned:', j.posts?.length ?? 0);
      } catch(e) { console.error('posts API failed:', e); }
      try {
        const r = await fetch(base + '/api/polls?limit=5');
        const j = await r.json();
        console.log('API /api/polls sample:', j.polls?.slice(0, 3)?.map((p: any) => ({ id: p.id, question: p.question })));
        console.log('Total polls returned:', j.polls?.length ?? 0);
      } catch(e) { console.error('polls API failed:', e); }
      console.groupEnd();
    },
  };
  console.log('%c[Interpoll] Debug ready → window.__interpoll.diagnose()', 'color:#6366f1;font-style:italic');

  // View tracking debug shortcuts
  (window as any).__interpoll.views = {
    diagnose() {
      const vt = (window as any).__viewTracking;
      if (!vt) { console.warn('[views] not initialised yet'); return; }
      console.group('%c[View Tracking]', 'color:#34d399;font-weight:bold');
      const tok = vt.token();
      console.log('auth token:', tok ? tok.slice(0,20)+'…' : 'NULL ← flush will be skipped');
      console.log('pending views:', vt.pending());
      console.log('sent this session:', vt.sent().length);
      console.groupEnd();
      return { hasToken: !!tok, pending: vt.pending().length, sent: vt.sent().length };
    },
    forceFlush() { return (window as any).__viewTracking?.forceFlush(); },
    reset()      { return (window as any).__viewTracking?.reset(); },
  };
}

</script>

<style scoped src="../styles/HomePage.css"></style>
<style scoped>
/* ── Relay header button ──── */
.relay-header-btn {
  --padding-start: 6px;
  --padding-end: 6px;
  --color: var(--app-text);
}

/* ── Feed scope tabs ──── */
.feed-toolbar {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 4px;
}

@media (min-width: 480px) {
  .feed-toolbar {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
  }
}

.feed-scope-tabs {
  display: flex;
  gap: 4px;
  background: rgba(0,0,0,0.04);
  border-radius: 12px;
  padding: 3px;
  border: 1px solid var(--app-border);
  overflow-x: auto;
}

.scope-tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 12px;
  border-radius: 9px;
  background: none;
  border: none;
  font-size: 13px;
  font-weight: 600;
  color: var(--app-text-muted);
  cursor: pointer;
  transition: var(--app-transition);
  white-space: nowrap;
  flex-shrink: 0;
}
.scope-tab ion-icon { font-size: 15px; }
.scope-tab:hover { color: var(--app-text); }
.scope-tab.active {
  background: var(--app-surface-strong);
  color: var(--app-text);
  box-shadow: var(--app-shadow-sm);
}

/* ── Scope hint ──── */
.scope-hint {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 24px 16px;
  text-align: center;
  border-radius: var(--app-radius-md);
  margin-bottom: 12px;
}
.scope-hint p { margin: 0; font-size: 14px; color: var(--app-text-muted); }
.scope-hint .subtitle { font-size: 13px; }
.inline-link {
  background: none;
  border: none;
  color: var(--app-accent-bright);
  font-weight: 600;
  cursor: pointer;
  padding: 0;
  font-size: inherit;
}

/* ── Sidebar relay card ──── */
.sidebar-relay-card { gap: 10px; }
.sidebar-relay-pill {
  width: 100%;
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  text-align: left;
}

/* ── Active tag filter pill ──── */
.active-tag-filter-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 4px 10px;
}
.active-tag-label {
  display: inline-flex;
  align-items: center;
  padding: 4px 12px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 700;
  background: rgba(251, 191, 36, 0.1);
  border: 1px solid rgba(251, 191, 36, 0.25);
  color: #fbbf24;
}
.active-tag-clear {
  background: none;
  border: none;
  color: var(--app-text-muted);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  padding: 0;
}
.active-tag-clear:hover { color: var(--app-text); }

/* ── Side-nav scope items ──── */
.side-nav-item ion-icon[icon="bookmarkOutline"],
.side-nav-item ion-icon[icon="globeOutline"],
.side-nav-item ion-icon[icon="telescopeOutline"] {
  font-size: 18px;
}

/* ── Sidebar section toggle (Categories collapse) ──── */
.side-nav-section-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  background: none;
  border: none;
  cursor: pointer;
  padding: 4px 0 6px;
  color: var(--app-text-muted);
}
.side-nav-section-toggle:hover { color: var(--app-text); }

/* ── Sidebar category buttons ──── */
.side-nav-category {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  background: none;
  border: none;
  padding: 7px 10px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  color: var(--app-text-muted);
  cursor: pointer;
  transition: var(--app-transition);
  text-align: left;
}
.side-nav-category:hover { background: var(--app-surface-hover); color: var(--app-text); }
.side-nav-category.active { background: var(--app-surface-strong); color: var(--app-text); font-weight: 600; }
.side-nav-category ion-icon { font-size: 16px; flex-shrink: 0; }
.nav-svg-icon { flex-shrink: 0; opacity: 0.75; }
.side-nav-item.active .nav-svg-icon { opacity: 1; }

/* ── Desktop tag strip ──── */
.desktop-tag-strip {
  display: none;
  flex-wrap: wrap;
  gap: 6px;
  padding: 4px 0 8px;
}
@media (min-width: 768px) {
  .desktop-tag-strip { display: flex; }
  .mobile-top-strip { display: none; }
  /* Scope tabs always visible — not hidden on desktop anymore */
  .feed-scope-tabs  { display: flex; }
  /* Categories live in sidebar on desktop — hide centre pills */
  .feed-category-tabs-desktop-hide { display: none !important; }
}

/* ── Relay signal icon in header ──── */
.relay-header-btn svg {
  color: var(--app-text-muted);
  transition: color 0.15s;
}
.relay-header-btn:hover svg { color: var(--app-text); }

/* ── Mobile top strip (tags / categories rotator) ──── */
.mobile-top-strip {
  overflow: hidden;
  position: relative;
  height: 36px;
  margin-bottom: 6px;
}
.mobile-top-strip__tags,
.mobile-top-strip__cats {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  scrollbar-width: none;
  position: absolute;
  top: 0; left: 0; right: 0;
  transition: opacity 0.4s, transform 0.4s;
}
.mobile-top-strip__tags::-webkit-scrollbar,
.mobile-top-strip__cats::-webkit-scrollbar { display: none; }
/* Default: show cats, hide tags */
.mobile-top-strip__tags { opacity: 0; transform: translateY(-6px); pointer-events: none; }
.mobile-top-strip__cats { opacity: 1; transform: translateY(0); }
/* show-tags: swap */
.mobile-top-strip.show-tags .mobile-top-strip__tags { opacity: 1; transform: translateY(0); pointer-events: auto; }
.mobile-top-strip.show-tags .mobile-top-strip__cats { opacity: 0; transform: translateY(6px); pointer-events: none; }

/* ── Tag chip shared styles ──── */
.tag-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  border-radius: 999px;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.08);
  color: var(--app-text-muted);
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
  transition: color 0.14s, background 0.14s, border-color 0.14s;
}
.tag-chip:hover { color: var(--app-text); background: rgba(255,255,255,0.07); }
.tag-chip.active,
.tag-chip--history {
  color: #fbbf24;
  border-color: rgba(251,191,36,0.28);
  background: rgba(251,191,36,0.08);
}
.tag-chip.active:hover,
.tag-chip--history:hover { background: rgba(251,191,36,0.14); }
</style>