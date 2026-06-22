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
      <div class="page-shell">
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

      <!-- Loading (only blocks when there is nothing to show yet) -->
      <div v-if="showBlockingLoader" class="loading-container">
        <ion-spinner></ion-spinner>
        <p>Loading content...</p>
      </div>

      <!-- Content Feed -->
      <div v-else-if="displayedContent.length > 0" class="content-feed">
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

      <!-- Empty State -->
      <div v-else class="empty-state">
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

       <!-- Rules Section -->
      <div v-if="hasAccess && displayCommunity?.rules?.length > 0" class="rules-section">
        <h3>Community Rules</h3>
        <ol class="rules-list">
          <li v-for="(rule, index) in displayCommunity.rules" :key="index">{{ rule }}</li>
        </ol>
      </div>

      <!-- Moderators (owner only) — delegate post removal in this community -->
      <div v-if="isOwner" class="moderators-section">
        <h3>Moderators</h3>
        <p class="mod-help">Delegate post removal in this community to trusted members. A moderator can remove posts here — and only here.</p>
        <div v-if="moderators.length" class="mod-list">
          <div v-for="addr in moderators" :key="addr" class="mod-row">
            <span class="mod-addr">{{ formatAddress(addr) }}</span>
            <button class="mod-remove" type="button" @click="removeModerator(addr)">Remove</button>
          </div>
        </div>
        <p v-else class="mod-empty">No moderators yet — you moderate this community.</p>
        <div class="mod-add">
          <ion-input v-model="newModerator" placeholder="0x… member address" :clear-input="true"></ion-input>
          <ion-button size="small" :disabled="!newModerator.trim()" @click="addModerator">Add</ion-button>
        </div>
      </div>

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

/* ── Moderators ──────────────────────────────────── */
.moderators-section {
  padding: 20px 16px;
  border-top: 1px solid rgba(var(--ion-text-color-rgb), 0.08);
}

.moderators-section h3 {
  margin: 0 0 6px;
  font-size: 16px;
  font-weight: 600;
}

.mod-help {
  margin: 0 0 12px;
  font-size: 13px;
  line-height: 1.5;
  color: var(--ion-color-medium);
}

.mod-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 12px;
}

.mod-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border: 1px solid rgba(var(--ion-text-color-rgb), 0.1);
  border-radius: 10px;
}

.mod-addr {
  font-family: monospace;
  font-size: 13px;
}

.mod-remove {
  border: none;
  background: none;
  color: var(--ion-color-danger);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.mod-empty {
  margin: 0 0 12px;
  font-size: 13px;
  color: var(--ion-color-medium);
}

.mod-add {
  display: flex;
  align-items: center;
  gap: 8px;
}

.mod-add ion-input {
  flex: 1;
  --padding-start: 12px;
  --padding-end: 12px;
  border: 1px solid rgba(var(--ion-text-color-rgb), 0.12);
  border-radius: 10px;
}
</style>

<script setup lang="ts">
import { ref, computed, watchEffect, watch } from 'vue';
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
  IonInput,
  IonIcon,
  IonCard,
  IonCardHeader,
  IonCardTitle,
  IonCardContent,
  IonSegment,
  IonSegmentButton,
  IonLabel,
  IonSpinner,
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
import { db } from '../services/gdbServices';
import { formatAddress } from '../utils/address';
import { useCommunityStore } from '../stores/communityStore';
import { usePostStore } from '../stores/postStore';
import { usePollStore } from '../stores/pollStore';
import { useUserStore } from '../stores/userStore';
import { UserService } from '../services/userService';
import PostCard from '../components/PostCard.vue';
import PollCard from '../components/PollCard.vue';
import EncryptedBadge from '../components/EncryptedBadge.vue';
import ConsentBanner from '../components/ConsentBanner.vue';
import { Post, PostService } from '../services/postService';
import { Poll, PollService } from '../services/pollService';
import { CommunityService, type Community } from '../services/communityService';
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
const voteVersion = ref(0);
const descriptionExpanded = ref(false);

const hasAccess = ref(true);
const decryptedMeta = ref<Community | null>(null);
const displayCommunity = computed(() => decryptedMeta.value || community.value);
const decryptedPosts = ref<Post[]>([]);
const decryptedPolls = ref<Poll[]>([]);

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

const hasVisibleContent = computed(() => displayedContent.value.length > 0);

// Block the view with a spinner only while the first batch is loading AND there
// is nothing to show yet. Once any content is present (or loading ends), the feed
// renders and GenosDB's live subscription keeps it up to date reactively.
const showBlockingLoader = computed(() => isLoading.value && !hasVisibleContent.value);

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
      });
      await toast.present();
    }
  } catch (error) {
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
      });
      await toast.present();
    }
  } catch (error) {
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

// ── Moderators (owner-only — delegate post deletion to trusted members) ──────────
const newModerator = ref('');
const moderators = computed(() => community.value?.moderators ?? []);
const isOwner = computed(() => {
  const me = db.sm.getActiveEthAddress();
  const owner = community.value?.owner;
  return !!me && !!owner && owner.toLowerCase() === me.toLowerCase();
});

async function addModerator() {
  const addr = newModerator.value.trim();
  if (!addr) return;
  try {
    await communityStore.addModerator(communityId.value, addr);
    newModerator.value = '';
    await communityStore.selectCommunity(communityId.value);
    const toast = await toastController.create({ message: 'Moderator added', duration: 1500 });
    await toast.present();
  } catch (e) {
    const toast = await toastController.create({ message: (e as Error)?.message || 'Could not add moderator', duration: 2500, color: 'danger' });
    await toast.present();
  }
}

async function removeModerator(addr: string) {
  try {
    await communityStore.removeModerator(communityId.value, addr);
    await communityStore.selectCommunity(communityId.value);
  } catch (e) {
    const toast = await toastController.create({ message: (e as Error)?.message || 'Could not remove moderator', duration: 2500, color: 'danger' });
    await toast.present();
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
const COMMUNITY_STORE_BOOTSTRAP_TIMEOUT_MS = 2500;
const COMMUNITY_DEBUG = typeof window !== 'undefined' && localStorage.getItem('interpoll_community_debug') === 'true';

function communityDebug(step: string, payload: Record<string, unknown> = {}) {
  if (!COMMUNITY_DEBUG) return;
  console.log('[CommunityDebug]', step, {
    communityId: communityId.value,
    generation: loadGeneration,
    timestamp: Date.now(),
    ...payload,
  });
}

function recoverLoadOnFocus() {
  // Re-run the initial load if the view is still empty after regaining focus —
  // covers a live subscription that never delivered (e.g. a transient P2P drop).
  // The store guards against duplicate subscriptions, so this is cheap.
  if (hasVisibleContent.value || isLoading.value || !hasAccess.value) return;
  communityDebug('focus-recovery-triggered');
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

// Fallback so the blocking spinner can't hang on an empty/slow room: the live
// subscriptions resolve on their first batch, but stay pending on an empty room.
const INITIAL_LOAD_TIMEOUT_MS = 7000;

async function loadCommunityContent() {
  const gen = ++loadGeneration;
  communityDebug('load-start', {
    routeCommunityId: communityId.value,
    knownCommunities: communityStore.communities.length,
  });
  isLoading.value = true;
  descriptionExpanded.value = false;
  decryptedMeta.value = null;
  decryptedPosts.value = [];
  decryptedPolls.value = [];
  hasAccess.value = true;

  try {
    // Load current user for private poll filtering
    try {
      const user = await UserService.getCurrentUser();
      currentUserId.value = user.id;
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

    // Open the live post/poll subscriptions. They resolve on their first batch
    // (or stay pending on an empty room), so we race a soft timeout to release
    // the blocking spinner. After that, content keeps arriving reactively via the
    // store → communityPosts/communityPolls → decrypt watchers → displayedContent.
    await Promise.race([
      Promise.all([
        postStore.loadPostsForCommunity(communityId.value),
        pollStore.loadPollsForCommunity(communityId.value),
      ]),
      new Promise<void>((resolve) => setTimeout(resolve, INITIAL_LOAD_TIMEOUT_MS)),
    ]);
    syncDecryptedFromCurrentStoreState();
    communityDebug('content-load-complete', {
      totalContentCount: totalContentCount.value,
      displayedCount: displayedContent.value.length,
      hasAccess: hasAccess.value,
    });

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
    });
    if (gen === loadGeneration) isLoading.value = false;
  }
}

// Re-load when Ionic enters (or re-enters) the page — covers first mount and cache re-entry
onIonViewWillEnter(async () => {
  window.addEventListener('focus', recoverLoadOnFocus);
  document.addEventListener('visibilitychange', handleVisibilityChange);
  const isCurrentCommunity = community.value?.id === communityId.value;
  if (!isCurrentCommunity || totalContentCount.value === 0) {
    await loadCommunityContent();
  }
});

onIonViewDidLeave(() => {
  window.removeEventListener('focus', recoverLoadOnFocus);
  document.removeEventListener('visibilitychange', handleVisibilityChange);
});

watch(communityId, async (newId, oldId) => {
  if (newId && newId !== oldId) {
    await loadCommunityContent();
  }
});
</script>
