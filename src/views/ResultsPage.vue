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
      <ion-card v-if="results">
        <ion-card-header>
          <ion-card-title>{{ results.poll.title }}</ion-card-title>
          <ion-card-subtitle>
            Total Votes: {{ results.totalVotes }}
          </ion-card-subtitle>
        </ion-card-header>

        <ion-card-content>
          <div class="space-y-4">
            <div v-for="(count, option) in results.results" :key="option">
              <div class="flex justify-between mb-1">
                <span class="text-sm font-medium">{{ option }}</span>
                <span class="text-sm text-gray-600">{{ count }} votes</span>
              </div>
              <div class="w-full bg-gray-200 rounded-full h-3">
                <div
                  class="bg-blue-600 h-3 rounded-full transition-all"
                  :style="{ width: `${getPercentage(count)}%` }"
                ></div>
              </div>
              <p class="text-xs text-gray-500 mt-1">
                {{ getPercentage(count).toFixed(1) }}%
              </p>
            </div>
          </div>

          <ion-button
            expand="block"
            class="mt-6"
            @click="router.push(`/vote/${route.params.pollId}`)"
          >
            Vote in This Poll
          </ion-button>
        </ion-card-content>
      </ion-card>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
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
  IonButton
} from '@ionic/vue';
import { usePollStore } from '../stores/pollStore';

const route = useRoute();
const router = useRouter();
const pollStore = usePollStore();

const results = ref<any>(null);

onMounted(async () => {
  const pollId = route.params.pollId as string;
  results.value = await pollStore.getResults(pollId);
});

const getPercentage = (count: number) => {
  if (!results.value || results.value.totalVotes === 0) return 0;
  return (count / results.value.totalVotes) * 100;
};
</script>