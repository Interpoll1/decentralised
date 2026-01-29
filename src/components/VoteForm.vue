<template>
  <ion-card>
    <!-- Already Voted Warning -->
    <div v-if="hasAlreadyVoted" class="bg-yellow-50 border-l-4 border-yellow-400 p-4">
      <div class="flex">
        <ion-icon :icon="warningOutline" class="text-yellow-400 text-2xl mr-3"></ion-icon>
        <div>
          <h3 class="text-sm font-medium text-yellow-800">Already Voted</h3>
          <p class="mt-1 text-sm text-yellow-700">
            You've already voted on this poll from this device.
            Each device can only vote once to ensure fair results.
          </p>
          <ion-button 
            size="small" 
            fill="outline" 
            color="warning"
            class="mt-2"
            @click="viewMyReceipt"
          >
            View My Receipt
          </ion-button>
        </div>
      </div>
    </div>

    <ion-card-header v-if="!hasAlreadyVoted">
      <ion-card-title>{{ poll.title }}</ion-card-title>
      <ion-card-subtitle>{{ poll.description }}</ion-card-subtitle>
    </ion-card-header>

    <ion-card-content v-if="!hasAlreadyVoted">
      <ion-radio-group v-model="selectedOption">
        <ion-item v-for="option in poll.options" :key="option">
          <ion-radio :value="option">{{ option }}</ion-radio>
        </ion-item>
      </ion-radio-group>

      <div class="mt-4 bg-blue-50 border border-blue-200 rounded p-3">
        <p class="text-xs text-blue-800">
          <ion-icon :icon="informationCircle" class="align-middle"></ion-icon>
          <strong>One Vote Per Device:</strong> Your device fingerprint will be recorded 
          to prevent duplicate votes. You'll receive a 12-word receipt to verify your vote later.
        </p>
      </div>

      <ion-button
        expand="block"
        :disabled="!selectedOption || isSubmitting"
        @click="submitVote"
        class="mt-4"
      >
        <ion-spinner v-if="isSubmitting" name="crescent" class="mr-2"></ion-spinner>
        {{ isSubmitting ? 'Submitting...' : 'Cast Vote' }}
      </ion-button>
    </ion-card-content>
  </ion-card>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import {
  IonCard,
  IonCardHeader,
  IonCardTitle,
  IonCardSubtitle,
  IonCardContent,
  IonRadioGroup,
  IonRadio,
  IonItem,
  IonButton,
  IonIcon,
  IonSpinner,
  toastController
} from '@ionic/vue';
import { informationCircle, warningOutline } from 'ionicons/icons';
import { useChainStore } from '../stores/chainStore';
import { VoteTrackerService } from '../services/voteTrackerService';
import { Poll, Vote } from '../types/chain';
import { AuditService } from '../services/auditService';

interface Props {
  poll: Poll;
}

const props = defineProps<Props>();
const emit = defineEmits(['vote-submitted']);

const chainStore = useChainStore();
const selectedOption = ref('');
const isSubmitting = ref(false);
const hasAlreadyVoted = ref(false);
const myVoteReceipt = ref<string | null>(null);

onMounted(async () => {
  // Check if this device has already voted
  hasAlreadyVoted.value = await VoteTrackerService.hasVoted(props.poll.id);
  
  if (hasAlreadyVoted.value) {
    // Try to find the receipt
    const myVotes = await VoteTrackerService.getMyVotes();
    const thisVote = myVotes.find(v => v.pollId === props.poll.id);
    if (thisVote) {
      // Could store receipt reference in vote record for easy lookup
      console.log('Found previous vote at block:', thisVote.blockIndex);
    }
  }
});

const submitVote = async () => {
  if (!selectedOption.value) return;

  const deviceId = await VoteTrackerService.getDeviceId();

  // Double-check vote eligibility
  if (await VoteTrackerService.hasVoted(props.poll.id)) {
    const toast = await toastController.create({
      message: '❌ You have already voted on this poll',
      duration: 3000,
      color: 'danger'
    });
    await toast.present();
    hasAlreadyVoted.value = true;
    return;
  }

  // Ask backend (if available) to enforce one-vote-per-device
  const allowedByBackend = await AuditService.authorizeVote(props.poll.id, deviceId);
  if (!allowedByBackend) {
    const toast = await toastController.create({
      message: '❌ This device has already voted on this poll (server)',
      duration: 3000,
      color: 'danger'
    });
    await toast.present();
    hasAlreadyVoted.value = true;
    return;
  }

  isSubmitting.value = true;

  try {
    const vote: Vote = {
      pollId: props.poll.id,
      choice: selectedOption.value,
      timestamp: Date.now(),
      deviceId
    };

    // Add vote to blockchain
    const receipt = await chainStore.addVote(vote);

    // Record that this device voted
    await VoteTrackerService.recordVote(props.poll.id, receipt.blockIndex);

    const toast = await toastController.create({
      message: '✅ Vote submitted successfully!',
      duration: 2000,
      color: 'success'
    });
    await toast.present();

    // Emit receipt mnemonic to parent
    emit('vote-submitted', receipt.mnemonic);
  } catch (error) {
    console.error('Error submitting vote:', error);
    
    const toast = await toastController.create({
      message: '❌ Failed to submit vote',
      duration: 3000,
      color: 'danger'
    });
    await toast.present();
  } finally {
    isSubmitting.value = false;
  }
};

const viewMyReceipt = () => {
  // Navigate to receipt lookup page
  // Could auto-fill if we stored receipt reference
  window.location.href = '/receipt';
};
</script>