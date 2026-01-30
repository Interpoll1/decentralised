<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button :default-href="`/community/${poll?.communityId || '/home'}`"></ion-back-button>
        </ion-buttons>
        <ion-title>Poll</ion-title>
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
        <ion-card>
          <ion-card-header>
            <div class="poll-meta">
              <ion-chip>
                <ion-icon :icon="statsChartOutline"></ion-icon>
                <ion-label>Poll</ion-label>
              </ion-chip>
              <ion-chip v-if="poll.isExpired" color="danger">
                <ion-label>Ended</ion-label>
              </ion-chip>
              <ion-chip v-else color="success">
                <ion-icon :icon="timeOutline"></ion-icon>
                <ion-label>{{ getTimeRemaining() }}</ion-label>
              </ion-chip>
            </div>
            <ion-card-title>{{ poll.question }}</ion-card-title>
            <ion-card-subtitle>
              Posted by u/{{ poll.authorName }} • {{ formatTime(poll.createdAt) }}
            </ion-card-subtitle>
          </ion-card-header>

          <ion-card-content v-if="poll.description">
            <p class="poll-description">{{ poll.description }}</p>
          </ion-card-content>
        </ion-card>

        <!-- Poll Stats -->
        <ion-card>
          <ion-card-content>
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
          </ion-card-content>
        </ion-card>

        <!-- Voting Card -->
        <ion-card v-if="!hasVoted && !poll.isExpired">
          <ion-card-header>
            <ion-card-title>Cast Your Vote</ion-card-title>
            <ion-card-subtitle v-if="poll.allowMultipleChoices">
              You can select multiple options
            </ion-card-subtitle>
          </ion-card-header>

          <ion-card-content>
            <!-- Debug Info -->
            <div v-if="!poll.options || poll.options.length === 0" style="color: red; padding: 12px; background: #fee; border-radius: 8px; margin-bottom: 16px;">
              No poll options loaded. Options count: {{ poll.options?.length || 0 }}
            </div>
            
            <!-- Show actual array for debugging -->


            <!-- Multiple Choice (Checkboxes) -->
            <ion-list v-if="poll.allowMultipleChoices && poll.options && poll.options.length > 0">
              <ion-item v-for="(option, index) in poll.options" :key="`option-${index}-${option.id}`">
                <ion-checkbox
                  v-model="selectedOptions"
                  :value="option.id"
                  slot="start"
                ></ion-checkbox>
                <ion-label>
                  <h3>{{ option.text || `[Empty] Option ${index + 1}` }}</h3>
                  <p v-if="!option.text" style="color: red; font-size: 11px;">
                    ID: {{ option.id }} | Votes: {{ option.votes }}
                  </p>
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
                    <h3>{{ option.text || `[Empty] Option ${index + 1}` }}</h3>
                    <p v-if="!option.text" style="color: red; font-size: 11px;">
                      ID: {{ option.id }} | Votes: {{ option.votes }}
                    </p>
                  </ion-label>
                </ion-item>
              </ion-list>
            </ion-radio-group>

            <div v-else style="padding: 24px; text-align: center; color: var(--ion-color-medium);">
              <p>No options available for this poll</p>
            </div>

            <ion-button 
              expand="block" 
              @click="submitVote"
              :disabled="!canVote"
              class="vote-button"
            >
              <ion-icon slot="start" :icon="checkmarkCircleOutline"></ion-icon>
              Submit Vote
            </ion-button>

            <p v-if="poll.showResultsBeforeVoting" class="hint">
              You can see results before voting
            </p>
          </ion-card-content>
        </ion-card>

        <!-- Already Voted Message -->
        <ion-card v-else-if="hasVoted && !poll.isExpired">
          <ion-card-content>
            <div class="voted-message">
              <ion-icon :icon="checkmarkCircleOutline" color="success"></ion-icon>
              <p>You've already voted in this poll!</p>
            </div>
          </ion-card-content>
        </ion-card>

        <!-- Poll Results -->
        <ion-card>
          <ion-card-header>
            <ion-card-title>Results</ion-card-title>
          </ion-card-header>

          <ion-card-content>
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
          </ion-card-content>
        </ion-card>
      </div>
    </ion-content>
  </ion-page>
</template>

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
  IonSpinner,
  toastController
} from '@ionic/vue';
import {
  statsChartOutline,
  timeOutline,
  peopleOutline,
  checkmarkCircleOutline,
  alertCircleOutline,
  eyeOffOutline
} from 'ionicons/icons';
import { usePollStore } from '../stores/pollStore';
import { Poll } from '../services/pollService';

const route = useRoute();
const router = useRouter();
const pollStore = usePollStore();

const poll = ref<Poll | null>(null);
const isLoading = ref(true);
const selectedOption = ref<string>('');
const selectedOptions = ref<string[]>([]);
const hasVoted = ref(false);

const canVote = computed(() => {
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
  
  if (days > 0) {
    return `${days}d ${hours}h left`;
  } else if (hours > 0) {
    return `${hours}h ${minutes}m left`;
  } else if (minutes > 0) {
    return `${minutes}m left`;
  } else {
    return 'Ending soon';
  }
}

function getOptionPercent(option: { votes: number }): number {
  const total = actualTotalVotes.value;
  
  if (total === 0) return 0;
  
  const percentage = (option.votes / total) * 100;
  return Math.round(percentage);
}

async function submitVote() {
  if (!poll.value || !canVote.value) return;

  try {
    const optionIds = poll.value.allowMultipleChoices 
      ? selectedOptions.value 
      : [selectedOption.value];

    await pollStore.voteOnPoll(poll.value.id, optionIds);

    hasVoted.value = true;

    const votedPolls = JSON.parse(localStorage.getItem('voted-polls') || '[]');
    votedPolls.push(poll.value.id);
    localStorage.setItem('voted-polls', JSON.stringify(votedPolls));

    const toast = await toastController.create({
      message: 'Vote submitted successfully',
      duration: 2000,
      color: 'success'
    });
    await toast.present();

    await loadPoll();
  } catch (error) {
    const toast = await toastController.create({
      message: 'Failed to submit vote',
      duration: 2000,
      color: 'danger'
    });
    await toast.present();
  }
}

async function loadPoll() {
  const pollId = route.params.pollId as string;
  
  const votedPolls = JSON.parse(localStorage.getItem('voted-polls') || '[]');
  hasVoted.value = votedPolls.includes(pollId);

  const foundPoll = pollStore.polls.find(p => p.id === pollId);
  
  if (foundPoll) {
    poll.value = foundPoll;
  }

  isLoading.value = false;
}

onMounted(async () => {
  await loadPoll();
});
</script>


<style scoped>
.loading-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 16px;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 16px;
  padding: 24px;
  text-align: center;
}

.poll-meta {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.poll-description {
  margin: 0;
  line-height: 1.5;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
}

.stat-item {
  display: flex;
  align-items: center;
  gap: 12px;
}

.stat-item ion-icon {
  font-size: 32px;
}

.stat-item div {
  display: flex;
  flex-direction: column;
}

.stat-item strong {
  font-size: 20px;
  font-weight: 600;
}

.stat-item span {
  font-size: 12px;
  color: var(--ion-color-medium);
}

.vote-button {
  margin-top: 16px;
}

.hint {
  text-align: center;
  font-size: 12px;
  color: var(--ion-color-medium);
  margin-top: 8px;
}

.voted-message {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 24px;
  text-align: center;
}

.voted-message ion-icon {
  font-size: 64px;
}

.results-hidden {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 24px;
  text-align: center;
  color: var(--ion-color-medium);
}

.results-hidden ion-icon {
  font-size: 64px;
}

.poll-results {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.result-item {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.result-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.option-text {
  font-weight: 500;
}

.option-percent {
  font-weight: 600;
  color: var(--ion-color-primary);
}

.result-bar {
  height: 8px;
  background: var(--ion-color-light);
  border-radius: 4px;
  overflow: hidden;
}

.result-fill {
  height: 100%;
  background: var(--ion-color-primary);
  border-radius: 4px;
  transition: width 0.3s ease;
}

.result-votes {
  font-size: 12px;
  color: var(--ion-color-medium);
}
</style>
<style scoped>
.loading-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 64px 24px;
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

ion-card {
  margin: 16px 12px;
}

.poll-meta {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.poll-description {
  margin: 0;
  line-height: 1.6;
}

.stats-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

.stat-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  background: var(--ion-color-light);
  border-radius: 8px;
}

.stat-item ion-icon {
  font-size: 32px;
}

.stat-item strong {
  display: block;
  font-size: 20px;
  font-weight: 600;
}

.stat-item span {
  display: block;
  font-size: 12px;
  color: var(--ion-color-medium);
}

.vote-button {
  margin-top: 16px;
}

.hint {
  margin: 12px 0 0 0;
  font-size: 13px;
  color: var(--ion-color-medium);
  text-align: center;
}

.voted-message {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 24px;
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

.results-hidden {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 32px;
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
  margin-bottom: 20px;
}

.result-header {
  display: flex;
  justify-content: space-between;
  margin-bottom: 8px;
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
  height: 32px;
  background: var(--ion-color-light);
  border-radius: 8px;
  overflow: hidden;
  margin-bottom: 4px;
}

.result-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--ion-color-primary), var(--ion-color-primary-shade));
  transition: width 0.5s;
}

.result-votes {
  font-size: 13px;
  color: var(--ion-color-medium);
}
</style>