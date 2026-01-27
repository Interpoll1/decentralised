<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button default-href="/home"></ion-back-button>
        </ion-buttons>
        <ion-title>Cast Your Vote</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      <!-- Loading State -->
      <div v-if="isLoading" class="flex flex-col items-center justify-center py-12">
        <ion-spinner></ion-spinner>
        <p class="mt-4 text-gray-600">Loading poll...</p>
      </div>

      <!-- Error State -->
      <div v-else-if="!pollStore.currentPoll" class="flex flex-col items-center justify-center py-12">
        <ion-icon :icon="alertCircle" size="large" color="danger"></ion-icon>
        <p class="mt-4 text-gray-600">Poll not found</p>
        <ion-button class="mt-4" @click="router.push('/home')">
          Go Back Home
        </ion-button>
      </div>

      <!-- Vote Form -->
      <VoteForm 
        v-else
        :poll="pollStore.currentPoll" 
        @vote-submitted="handleVoteSubmitted" 
      />
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
  IonSpinner,
  IonButton,
  IonIcon
} from '@ionic/vue';
import { alertCircle } from 'ionicons/icons';
import { usePollStore } from '../stores/pollStore';
import VoteForm from '../components/VoteForm.vue';

const route = useRoute();
const router = useRouter();
const pollStore = usePollStore();
const isLoading = ref(true);

onMounted(async () => {
  try {
    const pollId = route.params.pollId as string;
    await pollStore.selectPoll(pollId);
  } catch (error) {
    console.error('Error loading poll:', error);
  } finally {
    isLoading.value = false;
  }
});

const handleVoteSubmitted = (mnemonic: string) => {
  router.push(`/receipt/${mnemonic}`);
};
</script>