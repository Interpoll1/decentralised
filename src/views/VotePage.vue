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
        v-else-if="canVote"
        :poll="pollStore.currentPoll" 
        @vote-submitted="handleVoteSubmitted" 
      />

      <!-- Login required to vote -->
      <div
        v-else
        class="flex flex-col items-center justify-center py-12 space-y-4 text-center"
      >
        <ion-icon :icon="alertCircle" size="large" color="warning"></ion-icon>
        <p class="text-gray-700">
          This poll requires a verified login to vote.
        </p>
        <div class="flex flex-col gap-2 w-full max-w-xs">
          <ion-button expand="block" color="dark" fill="outline" @click="loginWithGoogle">
            Sign in with Google
          </ion-button>
          <ion-button expand="block" color="tertiary" fill="outline" @click="loginWithMicrosoft">
            Sign in with Microsoft
          </ion-button>
        </div>
      </div>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
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
import { AuditService } from '../services/auditService';

const route = useRoute();
const router = useRouter();
const pollStore = usePollStore();
const isLoading = ref(true);
const isAuthenticated = ref(false);

const canVote = computed(() => {
  const poll = pollStore.currentPoll as any;
  if (!poll) return false;
  if (!poll.requireLogin) return true;
  return isAuthenticated.value;
});

onMounted(async () => {
  try {
    const pollId = route.params.pollId as string;
    await pollStore.selectPoll(pollId);

    const user = await AuditService.getCloudUser();
    isAuthenticated.value = !!user;
  } catch (error) {
    console.error('Error loading poll:', error);
  } finally {
    isLoading.value = false;
  }
});

const handleVoteSubmitted = (mnemonic: string) => {
  router.push(`/receipt/${mnemonic}`);
};

const loginWithGoogle = () => {
  window.open('http://localhost:8080/auth/google/start', '_blank', 'noopener,noreferrer');
};

const loginWithMicrosoft = () => {
  window.open('http://localhost:8080/auth/microsoft/start', '_blank', 'noopener,noreferrer');
};
</script>