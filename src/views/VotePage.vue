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
      <div v-else-if="pollStore.currentPoll">
        <div v-if="pollStore.currentPoll.isPrivate" class="mb-4 space-y-2">
          <ion-item>
            <ion-label position="stacked">Invite Code</ion-label>
            <ion-input
              v-model="inviteCode"
              placeholder="Enter your unique invite code"
            ></ion-input>
          </ion-item>
        </div>

        <VoteForm
          :poll="pollStore.currentPoll"
          :invite-code="inviteCode"
          :requires-invite-code="pollStore.currentPoll.isPrivate"
          @vote-submitted="handleVoteSubmitted"
        />
      </div>
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
  IonIcon,
  IonItem,
  IonLabel,
  IonInput
} from '@ionic/vue';
import { alertCircle } from 'ionicons/icons';
import { usePollStore } from '../stores/pollStore';
import VoteForm from '../components/VoteForm.vue';
import { useChainStore } from '../stores/chainStore';

const route = useRoute();
const router = useRouter();
const pollStore = usePollStore();
const chainStore = useChainStore();
const isLoading = ref(true);
const inviteCode = ref<string>('');

onMounted(async () => {
  try {
    await chainStore.initialize();
    const pollId = route.params.pollId as string;
    await pollStore.selectPoll(pollId);

    const initialCode = route.query.code as string | undefined;
    if (initialCode) {
      inviteCode.value = initialCode;
    }
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