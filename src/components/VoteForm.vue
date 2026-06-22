<template>
  <ion-card>
    <!-- Already Voted Warning -->
    <div v-if="hasAlreadyVoted" class="voted-warning">
      <div class="flex">
        <ion-icon :icon="warningOutline" class="text-yellow-400 text-2xl mr-3"></ion-icon>
        <div>
          <h3 class="text-sm font-medium">Already Voted</h3>
          <p class="mt-1 text-sm opacity-80">
            You've already voted on this poll with your identity.
            Each identity can vote once to keep results fair.
          </p>
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
          <strong>One vote per identity:</strong> your vote is a node signed by your
          wallet and counted in real time across peers. You can't vote twice.
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
import { ref, onMounted, computed, watch } from 'vue';
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
import { usePollStore } from '../stores/pollStore';
import { PollService, Poll, PollOption } from '../services/pollService';

interface Props {
  poll: Poll;
  inviteCode?: string | null;
  requiresInviteCode?: boolean;
}

const props = defineProps<Props>();
const emit = defineEmits(['vote-submitted']);

const pollStore = usePollStore();
const selectedOption = ref('');
const isSubmitting = ref(false);
const hasAlreadyVoted = ref(false);

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const displayTitle = computed(() => props.poll.question || '');
const displayDescription = computed(() => props.poll.description || '');

onMounted(async () => {
  hasAlreadyVoted.value = await PollService.hasVoted(props.poll.id);
});

watch(
  () => props.poll.id,
  async (pollId) => {
    selectedOption.value = '';
    isSubmitting.value = false;
    hasAlreadyVoted.value = await PollService.hasVoted(pollId);
  },
);

const submitVote = async () => {
  if (!selectedOption.value || isSubmitting.value) return;

  isSubmitting.value = true;
  const inviteCode = (props.inviteCode || '').trim();
  let inviteReservationId: string | null = null;
  let voted = false;

  try {
    await PollService.flushPendingInviteCodeFinalizations();

    // Private poll: require a valid, unused invite code
    if (props.requiresInviteCode && !inviteCode) {
      await (await toastController.create({
        message: 'An invite code is required to vote in this poll',
        duration: 3000,
        color: 'danger',
      })).present();
      return;
    }

    // One vote per identity — the vote node id is deterministic, so this is exact.
    if (await PollService.hasVoted(props.poll.id)) {
      await (await toastController.create({
        message: 'You have already voted on this poll',
        duration: 3000,
        color: 'danger',
      })).present();
      hasAlreadyVoted.value = true;
      return;
    }

    if (props.requiresInviteCode && inviteCode) {
      inviteReservationId = await PollService.consumeInviteCode(props.poll.id, inviteCode);
    }

    // Cast the vote natively: a signed, ACL-owned `vote` node in GenosDB.
    await pollStore.voteOnPoll(props.poll.id, [selectedOption.value]);
    voted = true;
    hasAlreadyVoted.value = true;
    emit('vote-submitted');

    // Finalize the invite-code reservation in the background (best-effort).
    if (props.requiresInviteCode && inviteCode && inviteReservationId) {
      const pollId = props.poll.id;
      const code = inviteCode;
      const reservationId = inviteReservationId;
      void (async () => {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          try {
            await PollService.finalizeInviteCode(pollId, code, reservationId);
            return;
          } catch (finalizeError) {
            if (attempt === 2) {
              console.error('Failed to finalize invite code after vote:', finalizeError);
              PollService.queueInviteCodeFinalization(pollId, code, reservationId);
            } else {
              await wait(300 * (attempt + 1));
            }
          }
        }
      })();
    }

    await (await toastController.create({
      message: 'Vote recorded. Results update live across peers.',
      duration: 3000,
      color: 'success',
    })).present();
  } catch (error) {
    let releaseFailed = false;
    if (props.requiresInviteCode && inviteCode && inviteReservationId && !voted) {
      try {
        await PollService.releaseInviteCode(props.poll.id, inviteCode, inviteReservationId);
      } catch (releaseError) {
        releaseFailed = true;
        console.error('Failed to release invite code reservation:', releaseError);
      }
    }
    console.error('Error submitting vote:', error);
    await (await toastController.create({
      message: releaseFailed
        ? 'Failed to submit vote and release the invite code reservation. Please contact the poll owner.'
        : 'Failed to submit vote',
      duration: releaseFailed ? 5000 : 3000,
      color: 'danger',
    })).present();
  } finally {
    isSubmitting.value = false;
  }
};

// ─── Option Helpers ─────────────────────────────────────────────────────────

function getOptionLabel(option: PollOption | string, index: number): string {
  return typeof option === 'string' ? option : (option.text || `Option ${index + 1}`);
}

function getOptionValue(option: PollOption | string): string {
  return typeof option === 'string' ? option : (option.id || option.text || '');
}

function getOptionKey(option: PollOption | string, index: number): string {
  return typeof option === 'string' ? `${index}-${option}` : (option.id || `${index}`);
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
