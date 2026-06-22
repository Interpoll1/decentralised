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

    <ion-content>
      <div class="page-shell page-shell--form">
      <!-- Loading State -->
      <div v-if="isLoading" class="flex flex-col items-center justify-center py-12">
        <ion-spinner></ion-spinner>
        <p class="mt-4 text-gray-600">Loading poll...</p>
      </div>

      <!-- Error State -->
      <div v-else-if="!displayPoll" class="flex flex-col items-center justify-center py-12">
        <ion-icon :icon="alertCircle" size="large" color="danger"></ion-icon>
        <p class="mt-4 text-gray-600">Poll not found</p>
        <ion-button class="mt-4" @click="router.push('/home')">
          Go Back Home
        </ion-button>
      </div>

      <!-- Vote Form -->
      <div v-else-if="displayPoll">
        <div v-if="displayPoll.isPrivate" class="mb-4 space-y-2">
          <ion-item>
            <ion-label position="stacked">Invite Code</ion-label>
            <ion-input
              v-model="inviteCode"
              placeholder="Enter your unique invite code"
            ></ion-input>
          </ion-item>
        </div>

        <VoteForm
          :poll="displayPoll"
          :invite-code="inviteCode"
          :requires-invite-code="displayPoll.isPrivate"
          @vote-submitted="handleVoteSubmitted"
        />
      </div>
      </div>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
 import { computed, ref, watch } from 'vue';
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

const route = useRoute();
const router = useRouter();
const pollStore = usePollStore();
const isLoading = ref(true);
const inviteCode = ref<string>('');
const displayPoll = computed(() => {
  const pollId = route.params.pollId as string | undefined;
  if (!pollId) return null;
  return pollStore.currentPoll?.id === pollId ? pollStore.currentPoll : null;
});

async function loadVotePage() {
  isLoading.value = true;
  try {
    const pollId = route.params.pollId as string;
    inviteCode.value = (route.query.code as string | undefined) || '';
    const communityId = typeof route.query.communityId === 'string' ? route.query.communityId : undefined;
    await pollStore.selectPoll(pollId, communityId);
  } catch (error) {
    console.error('Error loading poll:', error);
  } finally {
    isLoading.value = false;
  }
}

watch(
  [() => route.params.pollId, () => route.query.code],
  () => {
    void loadVotePage();
  },
  { immediate: true },
);

const handleVoteSubmitted = () => {
  router.push(`/results/${route.params.pollId}`);
};
</script>
