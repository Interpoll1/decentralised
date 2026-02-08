<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button default-href="/home"></ion-back-button>
        </ion-buttons>
        <ion-title>Results</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      <!-- Loading -->
      <div v-if="isLoading" class="loading-container">
        <ion-spinner></ion-spinner>
        <p>Loading results...</p>
      </div>

      <ion-card v-else-if="poll">
        <ion-card-header>
          <ion-card-title>{{ poll.question }}</ion-card-title>
          <ion-card-subtitle>
            Total Votes: {{ totalVotes }}
          </ion-card-subtitle>
        </ion-card-header>

        <ion-card-content>
          <div class="poll-results">
            <div v-for="option in sortedOptions" :key="option.id" class="result-item">
              <div class="result-header">
                <span class="option-text">{{ option.text }}</span>
                <span class="option-percent">{{ getPercentage(option.votes) }}%</span>
              </div>
              <div class="result-bar">
                <div
                  class="result-fill"
                  :style="{ width: `${getPercentage(option.votes)}%` }"
                ></div>
              </div>
              <div class="result-votes">
                {{ option.votes }} vote{{ option.votes !== 1 ? 's' : '' }}
              </div>
            </div>
          </div>

          <ion-button
            expand="block"
            class="mt-3"
            @click="router.push(`/vote/${route.params.pollId}`)"
          >
            Vote in This Poll
          </ion-button>
        </ion-card-content>
      </ion-card>

      <!-- Not Found -->
      <div v-else class="empty-state">
        <p>Poll not found</p>
        <ion-button @click="$router.push('/home')">Go Home</ion-button>
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
  IonButton,
  IonSpinner
} from '@ionic/vue';
import { usePollStore } from '../stores/pollStore';
import type { Poll } from '../services/pollService';

const route = useRoute();
const router = useRouter();
const pollStore = usePollStore();

const poll = ref<Poll | null>(null);
const isLoading = ref(true);

const totalVotes = computed(() => {
  if (!poll.value || !poll.value.options) return 0;
  return poll.value.options.reduce((sum, option) => sum + (option.votes || 0), 0);
});

const sortedOptions = computed(() => {
  if (!poll.value) return [];
  return [...poll.value.options].sort((a, b) => b.votes - a.votes);
});

const getPercentage = (count: number) => {
  const total = totalVotes.value;
  if (total === 0) return 0;
  return Math.round((count / total) * 100);
};

onMounted(async () => {
  const pollId = route.params.pollId as string;
  await pollStore.selectPoll(pollId);
  poll.value = pollStore.currentPoll;
  isLoading.value = false;
});
</script>

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
  background: rgba(var(--ion-card-background-rgb), 0.20);
  backdrop-filter: blur(14px) saturate(1.4);
  -webkit-backdrop-filter: blur(14px) saturate(1.4);
  border: 1px solid var(--glass-border);
  border-top-color: var(--glass-border-top);
  border-radius: 14px;
  overflow: hidden;
  margin-bottom: 4px;
  box-shadow: var(--glass-highlight);
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

.mt-3 {
  margin-top: 12px;
}
</style>
