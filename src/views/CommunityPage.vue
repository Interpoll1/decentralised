<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button default-href="/home"></ion-back-button>
        </ion-buttons>
        <ion-title>{{ displayCommunity?.displayName || 'Community' }}</ion-title>
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
            <h1>
              {{ displayCommunity?.displayName }}
              <EncryptedBadge v-if="community?.isEncrypted" :hint="community?.encryptionHint" />
            </h1>
            <p class="community-id">{{ community.id }}</p>
          </div>
          <ion-button
            :color="isJoined ? 'medium' : 'primary'"
            shape="round"
            size="small"
            :disabled="isJoining"
            @click="toggleJoin"
          >
            <ion-spinner v-if="isJoining" slot="start" name="crescent"></ion-spinner>
            <ion-icon v-else slot="start" :icon="isJoined ? checkmarkCircleOutline : addCircleOutline"></ion-icon>
            {{ isJoining ? 'Joining...' : isJoined ? 'Joined' : 'Join' }}
          </ion-button>
        </div>

        <p class="description" :class="{ expanded: descriptionExpanded }">{{ displayCommunity?.description }}</p>
        <button
          v-if="showDescriptionToggle"
          class="description-toggle"
          type="button"
          @click="descriptionExpanded = !descriptionExpanded"
        >
          {{ descriptionExpanded ? 'Show less' : 'Read more' }}
        </button>
        <ConsentBanner />

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

        <div class="button-row" v-if="isJoined && hasAccess">
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
          <ion-button
            v-if="community?.isEncrypted"
            size="small"
            color="tertiary"
            @click="shareInviteLink"
          >
            <ion-icon slot="start" :icon="shareSocialOutline"></ion-icon>
            Share Invite
          </ion-button>
        </div>

        <div v-if="showDeviceAdminPanel" class="device-admin-panel">
          <div class="device-admin-header">
            <h3>Device Access Management</h3>
            <ion-button
              size="small"
              fill="clear"
              @click="refreshDeviceAdminState"
              :disabled="isDevicePanelLoading"
            >
              {{ isDevicePanelLoading ? 'Refreshing…' : 'Refresh' }}
            </ion-button>
          </div>
          <p class="device-admin-subtitle">
            Approve pending devices and remove compromised devices to rotate future community keys.
          </p>

          <div class="device-admin-block">
            <h4>Pending device requests</h4>
            <p v-if="pendingDeviceRequests.length === 0" class="device-empty">No pending requests.</p>
            <div v-else class="device-list">
              <div v-for="request in pendingDeviceRequests" :key="request.devicePublicKey" class="device-item">
                <div class="device-item-meta">
                  <code>{{ abbreviateKey(request.devicePublicKey) }}</code>
                  <span>{{ request.method }} · {{ formatRequestTime(request.requestedAt) }}</span>
                </div>
                <ion-button
                  size="small"
                  @click="approvePendingDevice(request)"
                  :disabled="Boolean(deviceActionInFlight)"
                >
                  {{ deviceActionInFlight === `approve:${request.devicePublicKey}` ? 'Approving…' : 'Approve' }}
                </ion-button>
              </div>
            </div>
          </div>

          <div class="device-admin-block">
            <h4>Approved devices</h4>
            <p v-if="approvedDeviceEntries.length === 0" class="device-empty">No approved devices found.</p>
            <div v-else class="device-list">
              <div v-for="entry in approvedDeviceEntries" :key="entry.devicePublicKey" class="device-item">
                <div class="device-item-meta">
                  <code>{{ abbreviateKey(entry.devicePublicKey) }}</code>
                  <span>key v{{ entry.keyVersion }} · approved {{ formatRequestTime(entry.updatedAt) }}</span>
                </div>
                <ion-button
                  size="small"
                  color="danger"
                  fill="outline"
                  @click="removeApprovedDevice(entry.devicePublicKey)"
                  :disabled="entry.devicePublicKey === currentDevicePublicKey || approvedDeviceEntries.length <= 1 || Boolean(deviceActionInFlight)"
                >
                  {{ deviceActionInFlight === `remove:${entry.devicePublicKey}` ? 'Removing…' : 'Remove' }}
                </ion-button>
              </div>
            </div>
          </div>
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

      <!-- Encrypted community hint (shown inline, does not block content feed) -->
      <div v-if="!showBlockingLoader && community?.isEncrypted && !hasAccess" class="locked-hint">
        <ion-icon :icon="lockClosedOutline" size="small"></ion-icon>
        <span>This community is encrypted.</span>
        <span v-if="community?.encryptionHint" class="encryption-hint">{{ community.encryptionHint }}</span>
        <ion-button size="small" fill="outline" @click="$router.push(`/join/community/${communityId}`)">
          <ion-icon slot="start" :icon="keyOutline"></ion-icon>
          Unlock
        </ion-button>
      </div>

      <!-- Loading -->
      <div v-if="showBlockingLoader" class="loading-container">
        <ion-spinner></ion-spinner>
        <p>Loading content...</p>
      </div>

      <div v-else-if="showInlineSyncStatus" class="sync-status">
        <ion-spinner name="dots"></ion-spinner>
        <div class="sync-status-copy">
          <strong>Showing what is ready.</strong>
          <span>{{ syncStatusText }}</span>
        </div>
      </div>

      <!-- Content Feed -->
      <div v-if="displayedContent.length > 0" class="content-feed">
        <template v-for="item in displayedContent" :key="`${item.type}-${item.data.id}`">
          <PostCard
            v-if="item.type === 'post'"
            :post="item.data"
            :community-name="displayCommunity?.displayName"
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

      <div v-else-if="showPartialSyncStatus" class="partial-loading-state">
        <ion-spinner name="dots"></ion-spinner>
        <p>{{ partialLoadText }}</p>
      </div>

      <!-- Empty State -->
      <div v-else-if="!showProgressiveSyncState && !hasVisibleContent" class="empty-state">
        <ion-icon :icon="documentTextOutline" size="large"></ion-icon>
        <p v-if="contentFilter === 'posts'">No posts yet</p>
        <p v-else-if="contentFilter === 'polls'">No polls yet</p>
        <p v-else>No content yet</p>
        <ion-button
          v-if="isJoined && hasAccess"
          @click="contentFilter === 'polls' ? $router.push(`/create-poll?communityId=${communityId}`) : $router.push(`/community/${communityId}/create-post`)"
        >
          Create the first {{ contentFilter === 'polls' ? 'poll' : 'post' }}!
        </ion-button>
        <ion-button v-else-if="!isJoined" @click="toggleJoin">
          Join to create content
        </ion-button>
      </div>

      <div v-else-if="showHydratingContentState" class="partial-loading-state">
        <ion-spinner name="dots"></ion-spinner>
        <p>Content is loading. It will appear here as soon as it finishes decrypting.</p>
      </div>

       <!-- Rules Section -->
      <div v-if="hasAccess && displayCommunity?.rules?.length > 0" class="rules-section">
        <h3>Community Rules</h3>
        <ol class="rules-list">
          <li v-for="(rule, index) in displayCommunity.rules" :key="index">{{ rule }}</li>
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
}

.description-toggle {
  display: none;
  margin: -4px 0 12px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--ion-color-primary);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
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

@media (max-width: 768px) {
  .description {
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .description.expanded {
    display: block;
    overflow: visible;
  }

  .description-toggle {
    display: inline-flex;
    align-items: center;
  }
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

.sync-status,
.partial-loading-state {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 12px 16px;
  padding: 12px 14px;
  border-radius: 12px;
  background: rgba(var(--ion-color-primary-rgb), 0.08);
  border: 1px solid rgba(var(--ion-color-primary-rgb), 0.14);
  color: var(--ion-color-step-700);
}

.sync-status-copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 13px;
}

.sync-status-copy strong {
  color: var(--ion-text-color);
}

.sync-status-copy span,
.partial-loading-state p {
  color: var(--ion-color-step-600);
  margin: 0;
  line-height: 1.4;
}

/* ── Locked Hint (inline banner for encrypted communities) ─── */
.locked-hint {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  margin: 0 12px 12px;
  background: rgba(var(--ion-color-warning-rgb), 0.12);
  border-radius: 10px;
  font-size: 13px;
  color: var(--ion-color-warning-shade);
  flex-wrap: wrap;
}

.locked-hint ion-icon {
  font-size: 18px;
  color: var(--ion-color-warning);
  flex-shrink: 0;
}

.locked-hint .encryption-hint {
  font-style: italic;
}

/* ── Device Admin ─────────────────────────────────── */
.device-admin-panel {
  margin: 0 0 14px;
  padding: 12px;
  border-radius: 12px;
  border: 1px solid rgba(var(--ion-color-tertiary-rgb), 0.2);
  background: rgba(var(--ion-color-tertiary-rgb), 0.06);
}

.device-admin-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.device-admin-header h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}

.device-admin-subtitle {
  margin: 6px 0 12px;
  font-size: 12px;
  color: var(--ion-color-medium);
  line-height: 1.4;
}

.device-admin-block + .device-admin-block {
  margin-top: 12px;
}

.device-admin-block h4 {
  margin: 0 0 8px;
  font-size: 13px;
  font-weight: 600;
}

.device-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.device-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 10px;
  background: rgba(var(--ion-text-color-rgb), 0.03);
  border: 1px solid rgba(var(--ion-text-color-rgb), 0.08);
}

.device-item-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.device-item-meta code {
  font-size: 11px;
  word-break: break-all;
}

.device-item-meta span {
  font-size: 12px;
  color: var(--ion-color-medium);
}

.device-empty {
  margin: 0;
  font-size: 12px;
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
import { ref, computed, watchEffect, watch, onUnmounted } from 'vue';
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
  alertController,
  toastController,
  onIonViewWillEnter,
  onIonViewDidLeave
} from '@ionic/vue';
import {
  homeOutline,
  peopleOutline,
  documentTextOutline,
  checkmarkCircleOutline,
  addCircleOutline,
  createOutline,
  statsChartOutline,
  lockClosedOutline,
  shareSocialOutline,
  keyOutline
} from 'ionicons/icons';
import { useCommunityStore } from '../stores/communityStore';
import { usePostStore } from '../stores/postStore';
import { usePollStore } from '../stores/pollStore';
import { useUserStore } from '../stores/userStore';
import { UserService } from '../services/userService';
import { KeyService } from '../services/keyService';
import PostCard from '../components/PostCard.vue';
import PollCard from '../components/PollCard.vue';
import EncryptedBadge from '../components/EncryptedBadge.vue';
import ConsentBanner from '../components/ConsentBanner.vue';
import { Post, PostService } from '../services/postService';
import { Poll, PollService } from '../services/pollService';
import {
  CommunityService,
  type Community,
  type BackendDeviceApprovalRequestSummary,
  type BackendCommunityKeyRingEntrySummary,
} from '../services/communityService';
import { KeyVaultService } from '../services/keyVaultService';
import { EncryptionService } from '../services/encryptionService';
import { InviteLinkService } from '../services/inviteLinkService';
import { ModerationService, moderationVersion } from '../services/moderationService';
import { useFeedPreferences } from '../composables/useFeedPreferences';
import { rankFeedItems } from '../utils/feedRanking';

const route = useRoute();
const router = useRouter();
const communityStore = useCommunityStore();
const postStore = usePostStore();
const pollStore = usePollStore();
const userStore = useUserStore();
const { preferences: feedPreferences } = useFeedPreferences();

const communityId = computed(() => route.params.communityId as string);
const community = computed(() => communityStore.currentCommunity);
const isJoined = computed(() => communityStore.isJoined(communityId.value));

const isLoading = ref(true);
const isJoining = ref(false);
const contentFilter = ref<'all' | 'posts' | 'polls'>('all');
const currentUserId = ref('');
const currentDevicePublicKey = ref('');
const voteVersion = ref(0);
const upvotedPostIds = ref<Set<string>>(new Set());
const downvotedPostIds = ref<Set<string>>(new Set());
const descriptionExpanded = ref(false);
type LoadStatus = 'idle' | 'loading' | 'loaded' | 'timed-out' | 'error';
const postLoadStatus = ref<LoadStatus>('idle');
const pollLoadStatus = ref<LoadStatus>('idle');
const isBackgroundSyncing = ref(false);
const BACKGROUND_SYNC_IDLE_MS = 15000;
let backgroundSyncIdleTimer: ReturnType<typeof setTimeout> | null = null;

const hasAccess = ref(true);
const decryptedMeta = ref<Community | null>(null);
const displayCommunity = computed(() => decryptedMeta.value || community.value);
const decryptedPosts = ref<Post[]>([]);
const decryptedPolls = ref<Poll[]>([]);
const pendingDeviceRequests = ref<BackendDeviceApprovalRequestSummary[]>([]);
const approvedDeviceEntries = ref<BackendCommunityKeyRingEntrySummary[]>([]);
const isDevicePanelLoading = ref(false);
const deviceActionInFlight = ref<string | null>(null);
const deviceRefreshGeneration = ref(0);
const isCommunityAdmin = computed(() => (
  Boolean(community.value && currentUserId.value && community.value.creatorId === currentUserId.value)
));
const showDeviceAdminPanel = computed(() => (
  Boolean(community.value?.isEncrypted && isJoined.value && hasAccess.value && isCommunityAdmin.value)
));

const currentModSettings = computed(() => {
  moderationVersion.value;
  return ModerationService.getSettings();
});
const joinedCommunityIds = computed(() => new Set(Array.from(communityStore.joinedCommunities)));

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

const totalLoadedContentCount = computed(() => decryptedPosts.value.length + decryptedPolls.value.length);

const showProgressiveSyncState = computed(() => isLoading.value || isBackgroundSyncing.value);

const showBlockingLoader = computed(() => isLoading.value && !isBackgroundSyncing.value && totalLoadedContentCount.value === 0);

const hasVisibleContent = computed(() => displayedContent.value.length > 0);

const showHydratingContentState = computed(() => {
  return !showProgressiveSyncState.value && totalContentCount.value > 0 && displayedContent.value.length === 0;
});

const showPartialSyncStatus = computed(() => {
  return (showProgressiveSyncState.value && !hasVisibleContent.value) || showHydratingContentState.value;
});

const showInlineSyncStatus = computed(() => {
  return showProgressiveSyncState.value && hasVisibleContent.value;
});

const syncStatusText = computed(() => {
  const segments: string[] = [];

  if (decryptedPosts.value.length > 0) {
    segments.push(`${decryptedPosts.value.length} post${decryptedPosts.value.length === 1 ? '' : 's'} loaded`);
  }

  if (decryptedPolls.value.length > 0) {
    segments.push(`${decryptedPolls.value.length} poll${decryptedPolls.value.length === 1 ? '' : 's'} loaded`);
  }

  if (postLoadStatus.value === 'loading') {
    segments.push('posts still syncing');
  } else if (postLoadStatus.value === 'timed-out') {
    segments.push('posts continuing in background');
  }

  if (pollLoadStatus.value === 'loading') {
    segments.push('polls still syncing');
  } else if (pollLoadStatus.value === 'timed-out') {
    segments.push('polls continuing in background');
  }

  return segments.join(' · ');
});

const partialLoadText = computed(() => {
  if (contentFilter.value === 'posts') {
    return 'Posts are still syncing. Loaded content will appear here as soon as it arrives.';
  }
  if (contentFilter.value === 'polls') {
    return 'Polls are still syncing. Loaded content will appear here as soon as it arrives.';
  }
  return 'Loaded content will appear here progressively while the rest syncs.';
});

function clearBackgroundSyncIdleTimer() {
  if (backgroundSyncIdleTimer) {
    clearTimeout(backgroundSyncIdleTimer);
    backgroundSyncIdleTimer = null;
  }
}

function keepBackgroundSyncVisible() {
  isBackgroundSyncing.value = true;
  clearBackgroundSyncIdleTimer();
  backgroundSyncIdleTimer = setTimeout(() => {
    if (!isLoading.value && (postLoadStatus.value === 'timed-out' || pollLoadStatus.value === 'timed-out')) {
      isBackgroundSyncing.value = false;
    }
  }, BACKGROUND_SYNC_IDLE_MS);
}

const showDescriptionToggle = computed(() => {
  const description = displayCommunity.value?.description ?? '';
  return description.length > 140;
});

function promotePollVisibility(
  items: Array<{ type: 'post' | 'poll'; data: any; createdAt: number; flagged: boolean }>,
): Array<{ type: 'post' | 'poll'; data: any; createdAt: number; flagged: boolean }> {
  if (contentFilter.value !== 'all') return items;
  const firstWindowSize = 6;
  if (!items.some((item) => item.type === 'poll')) return items;
  if (items.slice(0, firstWindowSize).some((item) => item.type === 'poll')) return items;

  const firstPollIndex = items.findIndex((item) => item.type === 'poll');
  if (firstPollIndex <= 0) return items;

  const reordered = [...items];
  const [pollItem] = reordered.splice(firstPollIndex, 1);
  const insertAt = Math.min(2, reordered.length);
  reordered.splice(insertAt, 0, pollItem);
  return reordered;
}

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

// Decrypt posts/polls reactively when community is encrypted and user has access
let postDecryptGen = 0;
watch([communityPosts, () => hasAccess.value], async ([posts]) => {
  if (!community.value?.isEncrypted || !hasAccess.value) {
    decryptedPosts.value = posts;
    return;
  }
  const gen = ++postDecryptGen;
  const result = await Promise.all(posts.map(p => PostService.decryptPost(p)));
  if (gen === postDecryptGen) decryptedPosts.value = result;
}, { immediate: true });

let pollDecryptGen = 0;
watch([communityPolls, () => hasAccess.value], async ([polls]) => {
  if (!community.value?.isEncrypted || !hasAccess.value) {
    decryptedPolls.value = polls;
    return;
  }
  const gen = ++pollDecryptGen;
  const result = await Promise.all(polls.map(p => PollService.decryptPoll(p)));
  if (gen === pollDecryptGen) decryptedPolls.value = result;
}, { immediate: true });

// Combined and filtered content
const displayedContent = computed(() => {
  moderationVersion.value; // reactive dependency on moderation settings
  const items: Array<{type: 'post' | 'poll', data: any, createdAt: number, flagged: boolean}> = [];
  const settings = ModerationService.getSettings();
  const allowPosts = contentFilter.value === 'all' || contentFilter.value === 'posts';
  const allowPolls = contentFilter.value === 'all' || contentFilter.value === 'polls';
  
  if (allowPosts) {
    decryptedPosts.value.forEach(post => {
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
  
  if (allowPolls) {
    decryptedPolls.value.forEach(poll => {
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

  if (feedPreferences.value.mode === 'latest') {
    return promotePollVisibility(items.sort((a, b) => b.createdAt - a.createdAt));
  }

  const rankInput = items.map((item) => {
    if (item.type === 'post') {
      const post = item.data as Post;
      return {
        id: `post:${post.id}`,
        type: 'post' as const,
        createdAt: post.createdAt,
        communityId: post.communityId,
        title: post.title || '',
        content: post.content || '',
        engagementScore: Math.max(0, post.score) + post.commentCount * 0.7 + post.upvotes * 0.25,
      };
    }

    const poll = item.data as Poll;
    const options = Array.isArray(poll.options) ? poll.options : [];
    const optionText = options.map((option) => option?.text ?? '').join(' ');
    return {
      id: `poll:${poll.id}`,
      type: 'poll' as const,
      createdAt: poll.createdAt,
      communityId: poll.communityId,
      title: poll.question || '',
      content: `${poll.description || ''} ${optionText}`.trim(),
      engagementScore: Math.max(0, poll.totalVotes) + (poll.isExpired ? 0 : 2),
    };
  });

  const rankingPrefs = {
    ...feedPreferences.value,
    mutedCommunities: [],
    showPosts: true,
    showPolls: true,
  };
  const ranked = rankFeedItems(rankInput, rankingPrefs, joinedCommunityIds.value);
  const itemById = new Map(items.map((item) => [`${item.type}:${item.data.id}`, item]));

  return promotePollVisibility(
    ranked
    .map((entry) => itemById.get(entry.id))
    .filter((entry): entry is {type: 'post' | 'poll', data: any, createdAt: number, flagged: boolean} => Boolean(entry)),
  );
});

function loadVoteSetsFromStorage(): void {
  try {
    const upvoted = JSON.parse(localStorage.getItem('upvoted-posts') || '[]');
    const downvoted = JSON.parse(localStorage.getItem('downvoted-posts') || '[]');
    upvotedPostIds.value = new Set(Array.isArray(upvoted) ? upvoted.filter((id) => typeof id === 'string') : []);
    downvotedPostIds.value = new Set(Array.isArray(downvoted) ? downvoted.filter((id) => typeof id === 'string') : []);
  } catch {
    upvotedPostIds.value = new Set();
    downvotedPostIds.value = new Set();
  }
}

function persistVoteSets(): void {
  localStorage.setItem('upvoted-posts', JSON.stringify(Array.from(upvotedPostIds.value)));
  localStorage.setItem('downvoted-posts', JSON.stringify(Array.from(downvotedPostIds.value)));
}

function hasUpvoted(postId: string): boolean {
  voteVersion.value; // reactive dependency to trigger re-render on vote changes
  return upvotedPostIds.value.has(postId);
}

function hasDownvoted(postId: string): boolean {
  voteVersion.value; // reactive dependency to trigger re-render on vote changes
  return downvotedPostIds.value.has(postId);
}

async function handleUpvote(post: Post) {
  const previousUpvoted = new Set(upvotedPostIds.value);
  const previousDownvoted = new Set(downvotedPostIds.value);
  try {
    if (hasUpvoted(post.id)) {
      upvotedPostIds.value.delete(post.id);
      persistVoteSets();
      voteVersion.value++;

      await postStore.removeUpvote(post.id);

      const toast = await toastController.create({
        message: 'Upvote removed',
        duration: 1500,
      });
      await toast.present();
    } else {
      const hadDownvote = downvotedPostIds.value.has(post.id);
      downvotedPostIds.value.delete(post.id);
      upvotedPostIds.value.add(post.id);
      persistVoteSets();
      voteVersion.value++;

      // Clear existing downvote in store if needed
      if (hadDownvote) {
        await postStore.removeDownvote(post.id);
      }
      await postStore.upvotePost(post.id);

      const toast = await toastController.create({
        message: 'Upvoted',
        duration: 1500,
      });
      await toast.present();
    }
  } catch (error) {
    upvotedPostIds.value = previousUpvoted;
    downvotedPostIds.value = previousDownvoted;
    persistVoteSets();
    voteVersion.value++;
    console.error('Error upvoting:', error);
    const toast = await toastController.create({
      message: 'Failed to upvote',
      duration: 2000,
    });
    await toast.present();
  }
}

async function handleDownvote(post: Post) {
  const previousUpvoted = new Set(upvotedPostIds.value);
  const previousDownvoted = new Set(downvotedPostIds.value);
  try {
    if (hasDownvoted(post.id)) {
      downvotedPostIds.value.delete(post.id);
      persistVoteSets();
      voteVersion.value++;

      await postStore.removeDownvote(post.id);

      const toast = await toastController.create({
        message: 'Downvote removed',
        duration: 1500,
      });
      await toast.present();
    } else {
      const hadUpvote = upvotedPostIds.value.has(post.id);
      upvotedPostIds.value.delete(post.id);
      downvotedPostIds.value.add(post.id);
      persistVoteSets();
      voteVersion.value++;

      // Clear existing upvote in store if needed
      if (hadUpvote) {
        await postStore.removeUpvote(post.id);
      }
      await postStore.downvotePost(post.id);

      const toast = await toastController.create({
        message: 'Downvoted',
        duration: 1500,
      });
      await toast.present();
    }
  } catch (error) {
    upvotedPostIds.value = previousUpvoted;
    downvotedPostIds.value = previousDownvoted;
    persistVoteSets();
    voteVersion.value++;
    console.error('Error downvoting:', error);
    const toast = await toastController.create({
      message: 'Failed to downvote',
      duration: 2000,
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

function abbreviateKey(key: string): string {
  if (!key || key.length <= 28) return key;
  return `${key.slice(0, 14)}…${key.slice(-10)}`;
}

function formatRequestTime(timestamp: number): string {
  if (!Number.isFinite(timestamp)) return 'unknown time';
  return new Date(timestamp).toLocaleString();
}

async function refreshDeviceAdminState(): Promise<void> {
  const generation = ++deviceRefreshGeneration.value;
  if (!showDeviceAdminPanel.value) {
    pendingDeviceRequests.value = [];
    approvedDeviceEntries.value = [];
    return;
  }
  isDevicePanelLoading.value = true;
  try {
    const [requests, keyRingEntries] = await Promise.all([
      CommunityService.listPendingDeviceRequests(communityId.value),
      CommunityService.listCommunityKeyRing(communityId.value),
    ]);
    if (generation !== deviceRefreshGeneration.value) return;
    pendingDeviceRequests.value = requests;
    approvedDeviceEntries.value = keyRingEntries;
  } catch (error) {
    if (generation !== deviceRefreshGeneration.value) return;
    console.error('Failed to load device admin state:', error);
    const toast = await toastController.create({
      message: 'Failed to load device approvals',
      duration: 2200,
      color: 'danger',
    });
    await toast.present();
  } finally {
    if (generation === deviceRefreshGeneration.value) {
      isDevicePanelLoading.value = false;
    }
  }
}

async function approvePendingDevice(request: BackendDeviceApprovalRequestSummary): Promise<void> {
  const devicePublicKey = request.devicePublicKey;
  if (deviceActionInFlight.value) return;
  deviceActionInFlight.value = `approve:${devicePublicKey}`;
  try {
    await CommunityService.approveDeviceRequest(communityId.value, devicePublicKey, request);
    const toast = await toastController.create({
      message: 'Device approved',
      duration: 1800,
      color: 'success',
    });
    await toast.present();
    await refreshDeviceAdminState();
  } catch (error) {
    console.error('Failed to approve device:', error);
    const toast = await toastController.create({
      message: error instanceof Error ? error.message : 'Device approval failed',
      duration: 2400,
      color: 'danger',
    });
    await toast.present();
  } finally {
    deviceActionInFlight.value = null;
  }
}

async function removeApprovedDevice(devicePublicKey: string): Promise<void> {
  if (deviceActionInFlight.value) return;
  const alert = await alertController.create({
    header: 'Remove this device?',
    message: 'This rotates the community key for all remaining devices. Removed devices lose access to future encrypted content.',
    buttons: [
      { text: 'Cancel', role: 'cancel' },
      {
        text: 'Remove device',
        role: 'destructive',
        handler: async () => {
          deviceActionInFlight.value = `remove:${devicePublicKey}`;
          try {
            await CommunityService.removeDeviceAndRotateKey(communityId.value, devicePublicKey);
            const toast = await toastController.create({
              message: 'Device removed and key rotated',
              duration: 2200,
              color: 'success',
            });
            await toast.present();
            await refreshDeviceAdminState();
          } catch (error) {
            console.error('Failed to remove device:', error);
            const toast = await toastController.create({
              message: error instanceof Error ? error.message : 'Failed to remove device',
              duration: 2600,
              color: 'danger',
            });
            await toast.present();
          } finally {
            deviceActionInFlight.value = null;
          }
        },
      },
    ],
  });
  await alert.present();
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
  } else if (community.value?.isEncrypted && !hasAccess.value) {
    router.push(`/join/community/${communityId.value}`);
  } else {
    isJoining.value = true;
    try {
      await communityStore.joinCommunity(communityId.value);
    } catch (error) {
      console.error('Error joining community:', error);
      const toast = await toastController.create({
        message: 'Failed to join community',
        duration: 2000,
      });
      await toast.present();
    } finally {
      isJoining.value = false;
    }
  }
}

async function shareInviteLink() {
  try {
    const storedKey = await KeyVaultService.getKey(communityId.value);
    if (!storedKey) {
      const toast = await toastController.create({
        message: 'Encryption key not found. Rejoin the community to share invites.',
        duration: 3000,
      });
      await toast.present();
      return;
    }
    const aesKey = await EncryptionService.importKey(storedKey.key);
    const base64Url = await EncryptionService.exportKeyAsBase64Url(aesKey);
    const link = InviteLinkService.generateInviteLink(communityId.value, 'community', base64Url);
    await InviteLinkService.copyToClipboard(link);
    const toast = await toastController.create({
      message: 'Invite link copied to clipboard!',
      duration: 2000,
    });
    await toast.present();
  } catch (error) {
    console.error('Failed to generate invite link:', error);
    const toast = await toastController.create({
      message: 'Failed to generate invite link',
      duration: 2000,
    });
    await toast.present();
  }
}

let loadGeneration = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
const COMMUNITY_STORE_BOOTSTRAP_TIMEOUT_MS = 2500;
function isCommunityDebugEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem('interpoll_community_debug') === 'true';
  } catch {
    return false;
  }
}
const COMMUNITY_DEBUG = isCommunityDebugEnabled();

function communityDebug(step: string, payload: Record<string, unknown> = {}) {
  if (!COMMUNITY_DEBUG) return;
  console.log('[CommunityDebug]', step, {
    communityId: communityId.value,
    generation: loadGeneration,
    timestamp: Date.now(),
    ...payload,
  });
}

function scheduleRetryIfEmpty() {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  const shouldRetry =
    postLoadStatus.value === 'timed-out' ||
    pollLoadStatus.value === 'timed-out';
  if (
    !isLoading.value &&
    shouldRetry &&
    !hasVisibleContent.value &&
    !isBackgroundSyncing.value &&
    hasAccess.value
  ) {
    const gen = loadGeneration;
    retryTimer = setTimeout(async () => {
      retryTimer = null;
      if (
        gen === loadGeneration &&
        (postLoadStatus.value === 'timed-out' || pollLoadStatus.value === 'timed-out') &&
        !hasVisibleContent.value &&
        !isLoading.value
      ) {
        await loadCommunityContent();
      }
    }, 3000);
  }
}

function shouldRecoverOnFocus(): boolean {
  return (
    !hasVisibleContent.value &&
    !isLoading.value &&
    hasAccess.value &&
    (postLoadStatus.value === 'timed-out' || pollLoadStatus.value === 'timed-out')
  );
}

function recoverLoadOnFocus() {
  if (!shouldRecoverOnFocus()) return;
  communityDebug('focus-recovery-triggered', {
    postLoadStatus: postLoadStatus.value,
    pollLoadStatus: pollLoadStatus.value,
    totalLoadedContentCount: totalLoadedContentCount.value,
  });
  void loadCommunityContent();
}

function handleVisibilityChange() {
  if (document.visibilityState !== 'visible') return;
  recoverLoadOnFocus();
}

function syncDecryptedFromCurrentStoreState() {
  if (!community.value?.isEncrypted) {
    decryptedPosts.value = communityPosts.value;
    decryptedPolls.value = communityPolls.value;
    return;
  }

  if (!hasAccess.value) {
    decryptedPosts.value = communityPosts.value;
    decryptedPolls.value = communityPolls.value;
    return;
  }

  // For encrypted communities with access, seed placeholders only once.
  // Avoid overwriting already-decrypted watcher output.
  if (decryptedPosts.value.length === 0) {
    decryptedPosts.value = communityPosts.value;
  }
  if (decryptedPolls.value.length === 0) {
    decryptedPolls.value = communityPolls.value;
  }
}

function waitForInitialContent(promise: Promise<void>, timeoutMs: number): Promise<'loaded' | 'timed-out'> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve('timed-out'), timeoutMs);
    promise
      .then(() => {
        clearTimeout(timer);
        resolve('loaded');
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

async function trackInitialLoad(
  loadPromise: Promise<void>,
  statusRef: typeof postLoadStatus,
  gen: number,
): Promise<'loaded' | 'timed-out' | 'error'> {
  try {
    const result = await waitForInitialContent(loadPromise, 7000);
    if (gen === loadGeneration) {
      statusRef.value = result === 'loaded' ? 'loaded' : 'timed-out';
    }
    return result;
  } catch (error) {
    if (gen === loadGeneration) {
      statusRef.value = 'error';
    }
    console.error('Community content stream failed:', error);
    return 'error';
  }
}

async function loadCommunityContent() {
  const gen = ++loadGeneration;
  communityDebug('load-start', {
    routeCommunityId: communityId.value,
    knownCommunities: communityStore.communities.length,
  });
  isLoading.value = true;
  descriptionExpanded.value = false;
  postLoadStatus.value = 'loading';
  pollLoadStatus.value = 'loading';
  decryptedMeta.value = null;
  decryptedPosts.value = [];
  decryptedPolls.value = [];
  hasAccess.value = true;

  try {
    // Load current user for private poll filtering
    try {
      const [user, deviceKeys] = await Promise.all([
        UserService.getCurrentUser(),
        KeyService.getKeyPair(),
      ]);
      currentUserId.value = user.id;
      currentDevicePublicKey.value = deviceKeys.publicKey;
    } catch {
      // Not critical
    }

    if (gen !== loadGeneration) return;

    // On direct reload of a community route, HomePage warmup never ran.
    // Bootstrap community subscriptions briefly so selects/feeds have data sources.
    const bootstrapResult = await Promise.race<'loaded' | 'timed-out'>([
      communityStore.loadCommunities().then(() => 'loaded'),
      new Promise<'timed-out'>((resolve) => setTimeout(() => resolve('timed-out'), COMMUNITY_STORE_BOOTSTRAP_TIMEOUT_MS)),
    ]);
    communityDebug('community-store-bootstrap', {
      result: bootstrapResult,
      knownCommunities: communityStore.communities.length,
    });

    if (gen !== loadGeneration) return;

    // Select the community
    await communityStore.selectCommunity(communityId.value);
    communityDebug('community-selected', {
      selectedCommunityId: community.value?.id ?? null,
      isEncrypted: Boolean(community.value?.isEncrypted),
    });

    if (gen !== loadGeneration) return;

    // Check encryption access
    if (community.value?.isEncrypted) {
      const canAccess = await KeyVaultService.hasKey(communityId.value);
      hasAccess.value = canAccess;
      if (canAccess) {
        const decrypted = await CommunityService.decryptCommunityMeta(community.value);
        if (decrypted) decryptedMeta.value = decrypted;
      }
    } else {
      hasAccess.value = true;
    }
    syncDecryptedFromCurrentStoreState();

    if (gen !== loadGeneration) return;

    // Always load posts/polls — encrypted content loads as placeholders
    // and gets decrypted reactively if user has the key
    const loadStates = await Promise.all([
      trackInitialLoad(postStore.loadPostsForCommunity(communityId.value), postLoadStatus, gen),
      trackInitialLoad(pollStore.loadPollsForCommunity(communityId.value), pollLoadStatus, gen),
    ]);
    syncDecryptedFromCurrentStoreState();
    communityDebug('content-load-complete', {
      loadStates,
      postLoadStatus: postLoadStatus.value,
      pollLoadStatus: pollLoadStatus.value,
      totalContentCount: totalContentCount.value,
      totalLoadedContentCount: totalLoadedContentCount.value,
      displayedCount: displayedContent.value.length,
      hasAccess: hasAccess.value,
    });

    if (gen === loadGeneration && loadStates.includes('timed-out')) {
      const toast = await toastController.create({
        message: 'Content is still syncing in the background.',
        duration: 2500,
      });
      await toast.present();
    }

    if (gen === loadGeneration && loadStates.includes('error')) {
      const toast = await toastController.create({
        message: 'Some content failed to load. The page will keep retrying in the background.',
        duration: 2800,
      });
      await toast.present();
    }

  } catch (error) {
    communityDebug('load-error', {
      error: error instanceof Error ? error.message : String(error),
    });
    console.error('Error loading community content:', error);
    const toast = await toastController.create({
      message: 'Failed to load community content',
      duration: 2500,
    });
    await toast.present();
  } finally {
    communityDebug('load-finished', {
      isCurrentGeneration: gen === loadGeneration,
      isLoading: isLoading.value,
      postLoadStatus: postLoadStatus.value,
      pollLoadStatus: pollLoadStatus.value,
    });
    if (gen === loadGeneration) isLoading.value = false;
  }
}

// Re-load when Ionic enters (or re-enters) the page — covers first mount and cache re-entry
onIonViewWillEnter(async () => {
  loadVoteSetsFromStorage();
  window.addEventListener('focus', recoverLoadOnFocus);
  document.addEventListener('visibilitychange', handleVisibilityChange);
  const isCurrentCommunity = community.value?.id === communityId.value;
  if (!isCurrentCommunity || totalContentCount.value === 0) {
    await loadCommunityContent();
  }
  scheduleRetryIfEmpty();
  await refreshDeviceAdminState();
});

onIonViewDidLeave(() => {
  window.removeEventListener('focus', recoverLoadOnFocus);
  document.removeEventListener('visibilitychange', handleVisibilityChange);
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
});

watch(communityId, async (newId, oldId) => {
  if (newId && newId !== oldId) {
    await loadCommunityContent();
    scheduleRetryIfEmpty();
    await refreshDeviceAdminState();
  }
});

watch(showDeviceAdminPanel, async (visible) => {
  if (visible) {
    await refreshDeviceAdminState();
    return;
  }
  pendingDeviceRequests.value = [];
  approvedDeviceEntries.value = [];
});

watch([postLoadStatus, pollLoadStatus], ([nextPostStatus, nextPollStatus]) => {
  if (nextPostStatus === 'timed-out' || nextPollStatus === 'timed-out') {
    keepBackgroundSyncVisible();
    return;
  }

  if (!isLoading.value) {
    isBackgroundSyncing.value = false;
    clearBackgroundSyncIdleTimer();
  }
});

watch(totalLoadedContentCount, (nextCount, previousCount) => {
  if (!isBackgroundSyncing.value || nextCount === previousCount) return;
  keepBackgroundSyncVisible();
});

watch(isBackgroundSyncing, (syncing, wasSyncing) => {
  if (wasSyncing && !syncing) {
    scheduleRetryIfEmpty();
  }
});

onUnmounted(() => {
  window.removeEventListener('focus', recoverLoadOnFocus);
  document.removeEventListener('visibilitychange', handleVisibilityChange);
  clearBackgroundSyncIdleTimer();
  if (retryTimer) clearTimeout(retryTimer);
});
</script>
