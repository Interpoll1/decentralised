<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button :default-href="`/community/${poll?.communityId || '/home'}`"></ion-back-button>
        </ion-buttons>
        <ion-title>Poll</ion-title>
        <ion-buttons slot="end" v-if="poll && isAuthor && poll.isPrivate">
          <ion-button @click="loadInviteCodes">
            <ion-icon :icon="shareOutline"></ion-icon>
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <!-- Loading -->
      <div v-if="isLoading" class="loading-container">
        <ion-spinner></ion-spinner>
        <p>Loading poll...</p>
      </div>

      <!-- Poll Not Found -->
      <div v-else-if="!poll" class="empty-state">
        <ion-icon :icon="alertCircleOutline" size="large"></ion-icon>
        <p>Poll not found</p>
        <ion-button @click="$router.push('/home')">Go Home</ion-button>
      </div>

      <!-- Poll Content -->
      <div v-else>
        <!-- Poll Header -->
        <div class="section">
          <div class="poll-meta">
            <ion-chip>
              <ion-icon :icon="statsChartOutline"></ion-icon>
              <ion-label>Poll</ion-label>
            </ion-chip>
            <ion-chip v-if="poll.isPrivate" color="warning">
              <ion-icon :icon="lockClosedOutline"></ion-icon>
              <ion-label>Private</ion-label>
            </ion-chip>
            <ion-chip v-if="poll.isExpired" color="danger">
              <ion-label>Ended</ion-label>
            </ion-chip>
            <ion-chip v-else color="success">
              <ion-icon :icon="timeOutline"></ion-icon>
              <ion-label>{{ getTimeRemaining() }}</ion-label>
            </ion-chip>
          </div>
          <h1 class="poll-title">{{ poll.question }}</h1>
          <p class="poll-author">
            Posted by u/{{ poll.authorName }} • {{ formatTime(poll.createdAt) }}
          </p>
          <p v-if="poll.description" class="poll-description">{{ poll.description }}</p>
          <div class="separator"></div>
        </div>

        <!-- Poll Stats -->
        <div class="section">
          <div class="stats-grid">
            <div class="stat-item">
              <ion-icon :icon="peopleOutline" color="primary"></ion-icon>
              <div>
                <strong>{{ actualTotalVotes }}</strong>
                <span>Total Votes</span>
              </div>
            </div>
            <div class="stat-item">
              <ion-icon :icon="timeOutline" color="secondary"></ion-icon>
              <div>
                <strong>{{ poll.isExpired ? 'Ended' : getTimeRemaining() }}</strong>
                <span>Time Left</span>
              </div>
            </div>
          </div>
          <div class="separator"></div>
        </div>

        <!-- Invite Code Management (author of private poll) -->
        <div v-if="poll.isPrivate && isAuthor" class="section">
          <div class="section-header">
            <h3 class="section-title">Invite Links</h3>
            <ion-badge color="warning">{{ inviteCodes.length }} codes</ion-badge>
          </div>
          <p class="section-subtitle">Share these unique links — each can only be used once</p>

          <div v-if="inviteCodes.length === 0" class="empty-codes">
            <ion-spinner v-if="isLoadingCodes"></ion-spinner>
            <p v-else>No invite codes found</p>
          </div>

          <div v-else class="invite-code-list">
            <div
              v-for="entry in inviteCodes"
              :key="entry.code"
              class="invite-code-item"
              :class="{ used: entry.used }"
            >
              <div class="code-info">
                <code class="code-value">{{ entry.code }}</code>
                <ion-badge :color="entry.used ? 'medium' : 'success'" class="code-status">
                  {{ entry.used ? 'Used' : 'Available' }}
                </ion-badge>
              </div>
              <ion-button
                v-if="!entry.used"
                size="small"
                fill="clear"
                @click="copyInviteLink(entry.code)"
              >
                <ion-icon :icon="copyOutline"></ion-icon>
              </ion-button>
            </div>
          </div>

          <ion-button expand="block" fill="outline" @click="copyAllLinks" class="mt-3">
            <ion-icon slot="start" :icon="copyOutline"></ion-icon>
            Copy All Available Links
          </ion-button>
          <div class="separator"></div>
        </div>

        <!-- Private poll notice (non-author visitor) -->
        <div v-if="poll.isPrivate && !isAuthor && !hasVoted && !poll.isExpired" class="section">
          <div class="private-notice">
            <ion-icon :icon="lockClosedOutline" color="warning"></ion-icon>
            <div>
              <h3>Private Poll</h3>
              <p>This poll requires an invite code to vote. Use the unique link you were given.</p>
              <ion-button
                size="small"
                fill="outline"
                @click="router.push(`/vote/${poll!.id}`)"
                class="mt-2"
              >
                Enter Invite Code
              </ion-button>
            </div>
          </div>
          <div class="separator"></div>
        </div>

        <!-- Voting Card (public polls only) -->
        <div v-if="!poll.isPrivate && !hasVoted && !poll.isExpired" class="section">
          <h3 class="section-title">Cast Your Vote</h3>
          <p v-if="poll.allowMultipleChoices" class="section-subtitle">
            You can select multiple options
          </p>

          <!-- Multiple Choice (Checkboxes) -->
          <ion-list v-if="poll.allowMultipleChoices && poll.options && poll.options.length > 0">
            <ion-item v-for="(option, index) in poll.options" :key="`option-${index}-${option.id}`">
              <ion-checkbox
                v-model="selectedOptions"
                :value="option.id"
                slot="start"
              ></ion-checkbox>
              <ion-label>
                <h3>{{ option.text }}</h3>
              </ion-label>
            </ion-item>
          </ion-list>

          <!-- Single Choice (Radio Buttons) -->
          <ion-radio-group v-else-if="!poll.allowMultipleChoices && poll.options && poll.options.length > 0" v-model="selectedOption">
            <ion-list>
              <ion-item v-for="(option, index) in poll.options" :key="`option-${index}-${option.id}`">
                <ion-radio
                  :value="option.id"
                  slot="start"
                ></ion-radio>
                <ion-label>
                  <h3>{{ option.text }}</h3>
                </ion-label>
              </ion-item>
            </ion-list>
          </ion-radio-group>

          <div v-else class="empty-options">
            <p>No options available for this poll</p>
          </div>

          <ion-button
            expand="block"
            @click="submitVote"
            :disabled="!canSubmitVote || isSubmitting"
            class="vote-button"
          >
            <ion-spinner v-if="isSubmitting" name="crescent" slot="start"></ion-spinner>
            <ion-icon v-else slot="start" :icon="checkmarkCircleOutline"></ion-icon>
            {{ isSubmitting ? 'Submitting...' : 'Submit Vote' }}
          </ion-button>
          <div class="separator"></div>
        </div>

        <!-- Already Voted Message -->
        <div v-else-if="hasVoted && !poll.isExpired" class="section">
          <div class="voted-message">
            <ion-icon :icon="checkmarkCircleOutline" color="success"></ion-icon>
            <p>You've already voted in this poll!</p>
          </div>
          <div class="separator"></div>
        </div>

        <!-- Poll Results -->
        <div class="section">
          <h3 class="section-title">Results</h3>

          <div v-if="!poll.showResultsBeforeVoting && !hasVoted && !poll.isExpired" class="results-hidden">
            <ion-icon :icon="eyeOffOutline" size="large"></ion-icon>
            <p>Results are hidden until you vote</p>
          </div>

          <div v-else class="poll-results">
            <div
              v-for="option in sortedOptions"
              :key="option.id"
              class="result-item"
            >
              <div class="result-header">
                <span class="option-text">{{ option.text }}</span>
                <span class="option-percent">{{ getOptionPercent(option) }}%</span>
              </div>
              <div class="result-bar">
                <div
                  class="result-fill"
                  :style="{ width: `${getOptionPercent(option)}%` }"
                ></div>
              </div>
              <div class="result-votes">
                {{ option.votes }} vote{{ option.votes !== 1 ? 's' : '' }}
              </div>
            </div>
          </div>
        </div>
      </div>
    </ion-content>
  </ion-page>
</template>

<style scoped>
.loading-container,
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 64px 24px;
  text-align: center;
}

.loading-container p {
  margin-top: 16px;
  color: var(--ion-color-medium);
}

.empty-state ion-icon {
  color: var(--ion-color-medium);
  margin-bottom: 16px;
}

/* Section Layout */
.section {
  padding: 16px;
  background: transparent;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.section-title {
  font-size: 18px;
  font-weight: 600;
  margin: 0 0 4px 0;
  color: var(--ion-text-color);
}

.section-subtitle {
  font-size: 13px;
  color: var(--ion-color-medium);
  margin: 0 0 12px 0;
}

.separator {
  height: 1px;
  background: rgba(var(--ion-text-color-rgb), 0.08);
  margin: 16px 0;
}

.mt-2 { margin-top: 8px; }
.mt-3 { margin-top: 12px; }

/* Poll Header */
.poll-meta {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.poll-title {
  font-size: 24px;
  font-weight: 700;
  margin: 0 0 8px 0;
  line-height: 1.3;
  color: var(--ion-text-color);
}

.poll-author {
  font-size: 13px;
  color: var(--ion-color-medium);
  margin: 0 0 12px 0;
}

.poll-description {
  margin: 0;
  line-height: 1.6;
  color: var(--ion-text-color);
}

/* Stats */
.stats-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.stat-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  background: rgba(var(--ion-text-color-rgb), 0.03);
  border: 1px solid rgba(var(--ion-text-color-rgb), 0.08);
  border-radius: 12px;
}

.stat-item ion-icon {
  font-size: 20px; /* Reduced from 32px */
}

.stat-item strong {
  display: block;
  font-size: 18px; /* Reduced from 20px */
  font-weight: 600;
}

.stat-item span {
  display: block;
  font-size: 11px; /* Reduced from 12px */
  color: var(--ion-color-medium);
}

/* Voting */
.vote-button {
  margin-top: 16px;
}

.empty-options {
  padding: 24px;
  text-align: center;
  color: var(--ion-color-medium);
}

.voted-message {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 24px 0;
  text-align: center;
}

.voted-message ion-icon {
  font-size: 64px;
  margin-bottom: 16px;
}

.voted-message p {
  margin: 0;
  font-size: 16px;
  font-weight: 500;
}

/* Results */
.results-hidden {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 32px 0;
  text-align: center;
}

.results-hidden ion-icon {
  color: var(--ion-color-medium);
  margin-bottom: 16px;
}

.results-hidden p {
  margin: 0;
  color: var(--ion-color-medium);
}

.poll-results {
  padding: 8px 0;
}

.result-item {
  margin-bottom: 16px; /* Reduced from 20px */
}

.result-header {
  display: flex;
  justify-content: space-between;
  margin-bottom: 6px; /* Reduced from 8px */
}

.option-text {
  font-weight: 500;
  font-size: 15px;
}

.option-percent {
  font-weight: 600;
  font-size: 15px;
  color: var(--ion-color-primary);
}

.result-bar {
  height: 8px; /* Reduced from 32px */
  background: rgba(var(--ion-text-color-rgb), 0.05);
  border: 1px solid rgba(var(--ion-text-color-rgb), 0.08);
  border-radius: 8px;
  overflow: hidden;
  margin-bottom: 4px;
}

.result-fill {
  height: 100%;
  background: var(--ion-color-primary);
  transition: width 0.5s ease;
  border-radius: 8px;
}

.result-votes {
  font-size: 12px; /* Reduced from 13px */
  color: var(--ion-color-medium);
}

/* Invite Codes */
.invite-code-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 12px;
}

.invite-code-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: rgba(var(--ion-text-color-rgb), 0.03);
  border: 1px solid rgba(var(--ion-text-color-rgb), 0.08);
  border-radius: 8px;
}

.invite-code-item.used {
  opacity: 0.5;
}

.code-info {
  display: flex;
  align-items: center;
  gap: 8px;
}

.code-value {
  font-size: 13px;
  font-family: monospace;
  font-weight: 600;
  letter-spacing: 0.5px;
}

.code-status {
  font-size: 10px;
}

.empty-codes {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 24px 0;
  color: var(--ion-color-medium);
}

/* Private Poll Notice */
.private-notice {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  padding: 16px;
  background: rgba(var(--ion-color-warning-rgb), 0.05);
  border: 1px solid rgba(var(--ion-color-warning-rgb), 0.2);
  border-radius: 12px;
}

.private-notice ion-icon {
  font-size: 32px;
  flex-shrink: 0;
}

.private-notice h3 {
  margin: 0 0 4px 0;
  font-size: 16px;
  font-weight: 600;
}

.private-notice p {
  margin: 0;
  font-size: 14px;
  color: var(--ion-color-medium);
  line-height: 1.5;
}
</style>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonButtons,
  IonBackButton,
  IonCard,
  IonCardHeader,
  IonCardTitle,
  IonCardSubtitle,
  IonCardContent,
  IonList,
  IonItem,
  IonLabel,
  IonCheckbox,
  IonRadio,
  IonRadioGroup,
  IonButton,
  IonIcon,
  IonChip,
  IonBadge,
  IonSpinner,
  toastController
} from '@ionic/vue';
import {
  statsChartOutline,
  timeOutline,
  peopleOutline,
  checkmarkCircleOutline,
  alertCircleOutline,
  eyeOffOutline,
  lockClosedOutline,
  shareOutline,
  copyOutline
} from 'ionicons/icons';
import { usePollStore } from '../stores/pollStore';
import { useChainStore } from '../stores/chainStore';
import { PollService, Poll } from '../services/pollService';
import { UserService } from '../services/userService';
import { VoteTrackerService } from '../services/voteTrackerService';
import { AuditService } from '../services/auditService';
import type { Vote } from '../types/chain';

const route = useRoute();
const router = useRouter();
const pollStore = usePollStore();
const chainStore = useChainStore();

const poll = ref<Poll | null>(null);
const isLoading = ref(true);
const isSubmitting = ref(false);
const selectedOption = ref<string>('');
const selectedOptions = ref<string[]>([]);
const hasVoted = ref(false);
const currentUserId = ref('');
const inviteCodes = ref<{ code: string; used: boolean }[]>([]);
const isLoadingCodes = ref(false);

const isAuthor = computed(() => {
  if (!poll.value || !currentUserId.value) return false;
  return poll.value.authorId === currentUserId.value;
});

const canSubmitVote = computed(() => {
  if (poll.value?.allowMultipleChoices) {
    return selectedOptions.value.length > 0;
  }
  return selectedOption.value !== '';
});

const sortedOptions = computed(() => {
  if (!poll.value) return [];
  return [...poll.value.options].sort((a, b) => b.votes - a.votes);
});

const actualTotalVotes = computed(() => {
  if (!poll.value || !poll.value.options) return 0;
  return poll.value.options.reduce((sum, option) => sum + (option.votes || 0), 0);
});

function formatTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;

  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;

  return new Date(timestamp).toLocaleDateString();
}

function getTimeRemaining(): string {
  if (!poll.value || poll.value.isExpired) {
    return 'Ended';
  }

  const now = Date.now();
  const remaining = poll.value.expiresAt - now;

  const days = Math.floor(remaining / 86400000);
  const hours = Math.floor((remaining % 86400000) / 3600000);
  const minutes = Math.floor((remaining % 3600000) / 60000);

  if (days > 0) return `${days}d ${hours}h left`;
  if (hours > 0) return `${hours}h ${minutes}m left`;
  if (minutes > 0) return `${minutes}m left`;
  return 'Ending soon';
}

function getOptionPercent(option: { votes: number }): number {
  const total = actualTotalVotes.value;
  if (total === 0) return 0;
  return Math.round((option.votes / total) * 100);
}

async function submitVote() {
  if (!poll.value || !canSubmitVote.value) return;

  isSubmitting.value = true;

  try {
    const deviceId = await VoteTrackerService.getDeviceId();

    // Check local vote tracker
    if (await VoteTrackerService.hasVoted(poll.value.id)) {
      const toast = await toastController.create({
        message: 'You have already voted on this poll',
        duration: 3000,
        color: 'danger'
      });
      await toast.present();
      hasVoted.value = true;
      return;
    }

    // Check backend authorization
    const allowedByBackend = await AuditService.authorizeVote(poll.value.id, deviceId);
    if (!allowedByBackend) {
      const toast = await toastController.create({
        message: 'This device has already voted on this poll',
        duration: 3000,
        color: 'danger'
      });
      await toast.present();
      hasVoted.value = true;
      return;
    }

    const optionIds = poll.value.allowMultipleChoices
      ? selectedOptions.value
      : [selectedOption.value];

    // Initialize chain if needed
    await chainStore.initialize();

    // Find option text for the blockchain record
    const choiceText = optionIds
      .map(id => poll.value!.options.find(o => o.id === id)?.text || id)
      .join(', ');

    // Record on blockchain
    const vote: Vote = {
      pollId: poll.value.id,
      choice: choiceText,
      timestamp: Date.now(),
      deviceId
    };
    const receipt = await chainStore.addVote(vote);

    // Update Gun poll option counts
    try {
      const user = await UserService.getCurrentUser();
      await PollService.voteOnPoll(poll.value.id, optionIds, user.id);
    } catch (gunErr) {
      console.warn('Gun poll count update failed:', gunErr);
    }

    // Record device vote
    await VoteTrackerService.recordVote(poll.value.id, receipt.blockIndex);

    hasVoted.value = true;

    // Track locally
    const votedPolls = JSON.parse(localStorage.getItem('voted-polls') || '[]');
    votedPolls.push(poll.value.id);
    localStorage.setItem('voted-polls', JSON.stringify(votedPolls));

    const toast = await toastController.create({
      message: 'Vote submitted successfully',
      duration: 2000,
      color: 'success'
    });
    await toast.present();

    // Reload poll to get updated counts
    await loadPoll();
  } catch (error) {
    console.error('Error submitting vote:', error);
    const toast = await toastController.create({
      message: 'Failed to submit vote',
      duration: 2000,
      color: 'danger'
    });
    await toast.present();
  } finally {
    isSubmitting.value = false;
  }
}

async function loadPoll() {
  const pollId = route.params.pollId as string;

  // Check local vote state
  const votedPolls = JSON.parse(localStorage.getItem('voted-polls') || '[]');
  const votedLocally = votedPolls.includes(pollId);
  const votedByDevice = await VoteTrackerService.hasVoted(pollId);
  hasVoted.value = votedLocally || votedByDevice;

  // Fetch from Gun via pollStore (not just local store)
  await pollStore.selectPoll(pollId);
  poll.value = pollStore.currentPoll;

  // Load current user for author check
  try {
    const user = await UserService.getCurrentUser();
    currentUserId.value = user.id;
  } catch {
    // Not critical
  }

  // Load invite codes if author of private poll
  if (poll.value?.isPrivate && isAuthor.value) {
    await loadInviteCodes();
  }

  isLoading.value = false;
}

async function loadInviteCodes() {
  if (!poll.value) return;
  isLoadingCodes.value = true;
  try {
    inviteCodes.value = await PollService.getInviteCodes(poll.value.id);
  } catch (err) {
    console.warn('Failed to load invite codes:', err);
  } finally {
    isLoadingCodes.value = false;
  }
}

async function copyInviteLink(code: string) {
  if (!poll.value) return;
  const baseUrl = window.location.origin;
  const link = `${baseUrl}/vote/${poll.value.id}?code=${code}`;

  try {
    await navigator.clipboard.writeText(link);
    const toast = await toastController.create({
      message: 'Invite link copied',
      duration: 1500,
      color: 'success'
    });
    await toast.present();
  } catch {
    const toast = await toastController.create({
      message: link,
      duration: 4000,
      color: 'medium'
    });
    await toast.present();
  }
}

async function copyAllLinks() {
  if (!poll.value) return;
  const baseUrl = window.location.origin;
  const availableCodes = inviteCodes.value.filter(c => !c.used);

  if (availableCodes.length === 0) {
    const toast = await toastController.create({
      message: 'No available codes left',
      duration: 2000,
      color: 'warning'
    });
    await toast.present();
    return;
  }

  const links = availableCodes
    .map(c => `${baseUrl}/vote/${poll.value!.id}?code=${c.code}`)
    .join('\n');

  try {
    await navigator.clipboard.writeText(links);
    const toast = await toastController.create({
      message: `${availableCodes.length} invite links copied`,
      duration: 2000,
      color: 'success'
    });
    await toast.present();
  } catch {
    const toast = await toastController.create({
      message: 'Failed to copy links',
      duration: 2000,
      color: 'danger'
    });
    await toast.present();
  }
}

onMounted(async () => {
  await chainStore.initialize();
  await loadPoll();
});
</script>

