<template>
  <ion-card>
    <!-- Already Voted Warning -->
    <div v-if="hasAlreadyVoted" class="voted-warning">
      <div class="flex">
        <ion-icon :icon="warningOutline" class="text-yellow-400 text-2xl mr-3"></ion-icon>
        <div>
          <h3 class="text-sm font-medium">Already Voted</h3>
          <p class="mt-1 text-sm opacity-80">
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
      <ion-card-title>{{ displayTitle }}</ion-card-title>
      <ion-card-subtitle>{{ displayDescription }}</ion-card-subtitle>
    </ion-card-header>

    <ion-card-content v-if="!hasAlreadyVoted">
      <ion-radio-group v-model="selectedOption">
        <ion-item v-for="(option, index) in poll.options" :key="getOptionKey(option, index)">
          <ion-radio :value="getOptionValue(option)">{{ getOptionLabel(option, index) }}</ion-radio>
        </ion-item>
      </ion-radio-group>

      <div class="mt-4 info-notice">
        <p class="text-xs">
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
import { ref, onMounted, computed } from 'vue';
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
import { PollService } from '../services/pollService';
import { UserService } from '../services/userService';

interface Props {
  poll: Poll;
  inviteCode?: string | null;
  requiresInviteCode?: boolean;
}

const props = defineProps<Props>();
const emit = defineEmits(['vote-submitted']);

const chainStore = useChainStore();
const selectedOption = ref('');
const isSubmitting = ref(false);
const hasAlreadyVoted = ref(false);
const myVoteReceipt = ref<string | null>(null);

const displayTitle = computed(() => {
  const anyPoll: any = props.poll as any;
  return anyPoll.title || anyPoll.question || '';
});

const displayDescription = computed(() => {
  const anyPoll: any = props.poll as any;
  return anyPoll.description || '';
});

onMounted(async () => {
  // Check if this device has already voted
  hasAlreadyVoted.value = await VoteTrackerService.hasVoted(props.poll.id);
  
  if (hasAlreadyVoted.value) {
    // Try to find the receipt
    const myVotes = await VoteTrackerService.getMyVotes();
    const thisVote = myVotes.find(v => v.pollId === props.poll.id);
    if (thisVote) {
      // Could store receipt reference in vote record for easy lookup
    }
  }
});

const submitVote = async () => {
  if (!selectedOption.value) return;

  const deviceId = await VoteTrackerService.getDeviceId();

  // Private poll: require a valid, unused invite code
  if (props.requiresInviteCode) {
    const code = (props.inviteCode || '').trim();
    if (!code) {
      const toast = await toastController.create({
        message: 'An invite code is required to vote in this poll',
        duration: 3000,
        color: 'danger'
      });
      await toast.present();
      return;
    }

    try {
      await PollService.consumeInviteCode(props.poll.id, code);
    } catch (err: any) {
      const message = err?.message || 'Invalid or already-used invite code';
      const toast = await toastController.create({
        message,
        duration: 3000,
        color: 'danger'
      });
      await toast.present();
      return;
    }
  }

  // Double-check vote eligibility
  if (await VoteTrackerService.hasVoted(props.poll.id)) {
    const toast = await toastController.create({
      message: 'You have already voted on this poll',
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
      message: 'This device has already voted on this poll (server)',
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

    // Also update Gun poll option counts so results show up everywhere
    try {
      const matchedOption = (props.poll.options as any[]).find((o: any) => {
        if (typeof o === 'string') return false;
        return o.text === selectedOption.value || o.id === selectedOption.value;
      });
      if (matchedOption?.id) {
        const user = await UserService.getCurrentUser();
        await PollService.voteOnPoll(props.poll.id, [matchedOption.id], user.id);
      }
    } catch (gunErr) {
      // Non-critical: blockchain vote succeeded, Gun count update is best-effort
      console.warn('Gun poll count update failed:', gunErr);
    }

    // Record that this device voted
    await VoteTrackerService.recordVote(props.poll.id, receipt.blockIndex);

    const toast = await toastController.create({
      message: 'Vote submitted successfully',
      duration: 2000,
      color: 'success'
    });
    await toast.present();

    // Emit receipt mnemonic to parent
    emit('vote-submitted', receipt.mnemonic);
  } catch (error) {
    console.error('Error submitting vote:', error);
    
    const toast = await toastController.create({
      message: 'Failed to submit vote',
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

// ─── Option Helpers ─────────────────────────────────────────────────────────

type RawOption = string | { id?: string; text?: string; votes?: number };

function tryParseOption(option: string): { text?: string } | null {
  try {
    const parsed = JSON.parse(option);
    if (parsed && typeof parsed === 'object') {
      return parsed;
    }
  } catch {
    // ignore
  }
  return null;
}

function getOptionLabel(option: RawOption, index: number): string {
  if (typeof option === 'string') {
    const parsed = option.trim().startsWith('{') ? tryParseOption(option) : null;
    if (parsed?.text) return parsed.text;
    return option;
  }
  return option.text || `[Option ${index + 1}]`;
}

function getOptionValue(option: RawOption): string {
  if (typeof option === 'string') {
    const parsed = option.trim().startsWith('{') ? tryParseOption(option) : null;
    if (parsed?.text) return parsed.text;
    return option;
  }
  return option.text || option.id || '';
}

function getOptionKey(option: RawOption, index: number): string {
  if (typeof option === 'string') {
    const parsed = option.trim().startsWith('{') ? tryParseOption(option) : null;
    if (parsed?.text) return `${index}-${parsed.text}`;
    return `${index}-${option}`;
  }
  return option.id || `${index}`;
}
</script>

<style scoped>
.voted-warning {
  padding: 16px;
  background: rgba(var(--ion-color-warning-rgb), 0.06);
  border-left: 4px solid var(--ion-color-warning);
  border-radius: 0 16px 16px 0;
  backdrop-filter: blur(16px) saturate(1.5);
  -webkit-backdrop-filter: blur(16px) saturate(1.5);
  border-top: 1px solid rgba(var(--ion-color-warning-rgb), 0.10);
  border-right: 1px solid rgba(var(--ion-color-warning-rgb), 0.08);
  border-bottom: 1px solid rgba(var(--ion-color-warning-rgb), 0.05);
  box-shadow: var(--glass-inner-glow);
}

.info-notice {
  padding: 12px;
  background: rgba(var(--ion-color-primary-rgb), 0.05);
  border: 1px solid rgba(var(--ion-color-primary-rgb), 0.10);
  border-top-color: rgba(var(--ion-color-primary-rgb), 0.16);
  border-radius: 14px;
  backdrop-filter: blur(12px) saturate(1.4);
  -webkit-backdrop-filter: blur(12px) saturate(1.4);
  color: var(--ion-color-primary);
  box-shadow: var(--glass-highlight);
}
</style>