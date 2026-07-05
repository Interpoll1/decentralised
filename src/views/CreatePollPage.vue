<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button default-href="/home"></ion-back-button>
        </ion-buttons>
        <ion-title>Create Poll</ion-title>
        <ion-buttons slot="end">
          <ion-button @click="createPoll" :disabled="!isValid || isSubmitting">
            {{ isSubmitting ? 'Posting…' : 'Post' }}
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>
    <ion-content>
      <div v-if="isSubmittingSlow" class="submit-slow-banner">
        Still publishing to the network — this can take a few extra seconds on a slow relay.
      </div>
      <!-- Community Selection -->
      <ion-item button @click="showCommunityPicker">
        <ion-label>
          <h3>{{ selectedCommunity ? selectedCommunity.displayName : 'Select a community' }}</h3>
          <p v-if="selectedCommunity">{{ selectedCommunity.id }}</p>
        </ion-label>
        <ion-icon :icon="chevronDownOutline" slot="end"></ion-icon>
      </ion-item>

      <!-- Poll Question -->
      <ion-item>
        <ion-label position="stacked">Question *</ion-label>
        <ion-input 
          v-model="question" 
          placeholder="What would you like to ask?"
          :counter="true"
          maxlength="200"
        ></ion-input>
      </ion-item>

      <!-- Poll Options -->
      <ion-list>
        <ion-item v-for="(option, index) in options" :key="option.id">
          <ion-label position="stacked">Option {{ index + 1 }} *</ion-label>
          <ion-input 
            v-model="options[index].text" 
            :placeholder="`Option ${index + 1}`"
            maxlength="100"
          >
            <ion-button 
              v-if="options.length > 2" 
              slot="end" 
              fill="clear" 
              color="danger"
              @click="removeOption(index)"
            >
              <ion-icon :icon="closeCircleOutline"></ion-icon>
            </ion-button>
          </ion-input>
        </ion-item>
      </ion-list>

      <ion-button 
        expand="block" 
        fill="outline" 
        @click="addOption"
        :disabled="options.length >= 10"
      >
        <ion-icon slot="start" :icon="addCircleOutline"></ion-icon>
        Add Option ({{ options.length }}/10)
      </ion-button>

      <!-- Poll Settings -->
      <ion-list>
        <ion-item>
          <ion-label>Poll Duration</ion-label>
          <ion-select v-model="duration">
            <ion-select-option value="1">1 Day</ion-select-option>
            <ion-select-option value="3">3 Days</ion-select-option>
            <ion-select-option value="7">7 Days</ion-select-option>
            <ion-select-option value="14">14 Days</ion-select-option>
            <ion-select-option value="30">30 Days</ion-select-option>
          </ion-select>
        </ion-item>

        <ion-item>
          <ion-toggle v-model="allowMultipleChoices">
            Allow multiple choices
          </ion-toggle>
        </ion-item>

        <ion-item>
          <ion-toggle v-model="showResultsBeforeVoting">
            Show results before voting
          </ion-toggle>
        </ion-item>
        <ion-item>
          <ion-toggle v-model="isPrivate">
            Make this poll private (invite-only)
          </ion-toggle>
        </ion-item>
        <ion-item v-if="isPrivate">
          <ion-label class="text-xs text-gray-500">
            Only people with a unique invite code can vote.
            Each code can be used once.
          </ion-label>
        </ion-item>
        <ion-item v-if="isPrivate">
          <ion-label position="stacked">Number of invite codes</ion-label>
          <ion-input
            type="number"
            v-model.number="inviteCodeCount"
            min="1"
            max="200"
            placeholder="20"
          ></ion-input>
        </ion-item>
      </ion-list>

      <!-- Additional Details (Optional) -->
      <ion-item>
        <ion-label position="stacked">Description (Optional)</ion-label>
        <ion-textarea 
          v-model="description" 
          placeholder="Add more context to your poll..."
          rows="4"
          maxlength="500"
          :counter="true"
        ></ion-textarea>
      </ion-item>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonButtons,
  IonBackButton,
  IonButton,
  IonList,
  IonItem,
  IonLabel,
  IonInput,
  IonTextarea,
  IonSelect,
  IonSelectOption,
  IonToggle,
  IonIcon,
  actionSheetController,
  alertController,
  toastController
} from '@ionic/vue';
import {
  chevronDownOutline,
  addCircleOutline,
  closeCircleOutline
} from 'ionicons/icons';
import { useCommunityStore } from '../stores/communityStore';
import { usePollStore } from '../stores/pollStore';
import { Community } from '../services/communityService';
import { checkContent, checkOption } from '../utils/contentGuard';

const POLL_DEBUG_KEY = 'interpoll_poll_debug';
type PollDebugCategory = 'create' | 'writes' | 'index' | 'ui' | 'all';

function getPollDebugCategories(): Set<string> {
  try {
    const raw = window.localStorage.getItem(POLL_DEBUG_KEY);
    if (!raw) return new Set();
    const normalized = raw.trim().toLowerCase();
    if (normalized === 'true') return new Set(['all']);
    return new Set(
      normalized
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean),
    );
  } catch {
    return new Set();
  }
}

function isPollDebugEnabled(category: PollDebugCategory): boolean {
  const categories = getPollDebugCategories();
  return categories.has('all') || categories.has(category);
}

function logPollDebug(category: PollDebugCategory, message: string, meta?: Record<string, unknown>) {
  if (!isPollDebugEnabled(category)) return;
  const prefix = `[PollCreateDebug:${category}]`;
  if (meta) {
    console.log(prefix, message, meta);
    return;
  }
  console.log(prefix, message);
}

const router = useRouter();
const route = useRoute();
const communityStore = useCommunityStore();
const pollStore = usePollStore();
type PollOptionDraft = { id: string; text: string };

function createOptionDraft(): PollOptionDraft {
  return { id: `opt-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`, text: '' };
}

const selectedCommunity = ref<Community | null>(null);
const question = ref('');
const options = ref<PollOptionDraft[]>([createOptionDraft(), createOptionDraft()]);
const duration = ref('7');
const allowMultipleChoices = ref(false);
const showResultsBeforeVoting = ref(false);
const description = ref('');
const isPrivate = ref(false);
const inviteCodeCount = ref(20);
const isSubmitting = ref(false);
const isSubmittingSlow = ref(false);
let submitSlowTimer: ReturnType<typeof setTimeout> | null = null;

watch(isSubmitting, (submitting) => {
  if (submitSlowTimer) {
    clearTimeout(submitSlowTimer);
    submitSlowTimer = null;
  }
  isSubmittingSlow.value = false;
  if (submitting) {
    submitSlowTimer = setTimeout(() => {
      isSubmittingSlow.value = true;
    }, 3000);
  }
});

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const isValid = computed(() => {
  return (
    selectedCommunity.value !== null &&
    question.value.trim().length > 0 &&
    options.value.filter(opt => opt.text.trim().length > 0).length >= 2
  );
});

async function showCommunityPicker() {
  const joinedCommunities = communityStore.communities.filter(c => 
    communityStore.isJoined(c.id)
  );

  if (joinedCommunities.length === 0) {
    const toast = await toastController.create({
      message: 'Please join a community first',
      duration: 2000,
      color: 'warning'
    });
    await toast.present();
    return;
  }

  const actionSheet = await actionSheetController.create({
    header: 'Select Community',
    buttons: [
      ...joinedCommunities.map(community => ({
        text: community.displayName,
        handler: () => {
          selectedCommunity.value = community;
        }
      })),
      {
        text: 'Cancel',
        role: 'cancel'
      }
    ]
  });

  await actionSheet.present();
}

function addOption() {
  if (options.value.length < 10) {
    options.value.push(createOptionDraft());
  }
}

function removeOption(index: number) {
  if (options.value.length > 2) {
    options.value.splice(index, 1);
  }
}

async function createPoll() {
  const submitStartedAt = performance.now();
  if (isSubmitting.value) return;
  if (!isValid.value) {
    logPollDebug('ui', 'Submit blocked: invalid form', {
      hasCommunity: selectedCommunity.value !== null,
      questionLength: question.value.trim().length,
      validOptionCount: options.value.filter(opt => opt.text.trim().length > 0).length,
    });
    const toast = await toastController.create({
      message: 'Please select a community, add a question, and provide at least two options.',
      duration: 2500,
      color: 'warning',
    });
    await toast.present();
    return;
  }

  try {
    isSubmitting.value = true;

    // Spam check — question
    const qCheck = checkContent(question.value.trim(), 'title');
    if (!qCheck.ok) {
      const toast = await toastController.create({ message: `Question: ${qCheck.reason}`, duration: 2500, color: 'warning' });
      await toast.present();
      isSubmitting.value = false;
      return;
    }

    // Spam check — each option
    const validOptions = options.value.map(opt => opt.text.trim()).filter(opt => opt.length > 0);
    for (const opt of validOptions) {
      const oCheck = checkOption(opt);
      if (!oCheck.ok) {
        const toast = await toastController.create({ message: `Option "${opt.slice(0, 20)}": ${oCheck.reason}`, duration: 2500, color: 'warning' });
        await toast.present();
        isSubmitting.value = false;
        return;
      }
    }
    logPollDebug('ui', 'Prepared poll payload', {
      validOptionsCount: validOptions.length,
      hasDescription: Boolean(description.value.trim()),
      inviteCodeCount: inviteCodeCount.value,
    });

    // Create poll using pollStore
    const poll = await pollStore.createPoll({
      communityId: selectedCommunity.value!.id,
      question: question.value.trim(),
      description: description.value.trim(),
      options: validOptions,
      durationDays: parseInt(duration.value),
      allowMultipleChoices: allowMultipleChoices.value,
      showResultsBeforeVoting: showResultsBeforeVoting.value,
      requireLogin: false,
      isPrivate: isPrivate.value,
      inviteCodeCount: inviteCodeCount.value
    });
    logPollDebug('ui', 'pollStore.createPoll resolved', {
      pollId: poll.id,
      durationMs: Math.round(performance.now() - submitStartedAt),
    });

    // If private, copy a ready-to-share invite link and show codes
    if (isPrivate.value && (poll as any).inviteCodes?.length) {
      const codes = (poll as any).inviteCodes as string[];
      const buildVoteLink = (code: string) => {
        const routeLocation = router.resolve({
          path: `/vote/${poll.id}`,
          query: { code, communityId: poll.communityId },
        });
        return `${window.location.origin}${routeLocation.href}`;
      };
      const sampleLink = buildVoteLink(codes[0]);

      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(sampleLink);
        }
        const toast = await toastController.create({
          message: 'Private poll link copied to clipboard',
          duration: 2500,
          color: 'success'
        });
        await toast.present();
      } catch (e) {
        const toast = await toastController.create({
          message: `Private poll link: ${sampleLink}`,
          duration: 4000,
          color: 'medium'
        });
        await toast.present();
      }

      // Show full code list with statuses and copy-all option
      const codesList = `<pre style="text-align:left;white-space:pre-wrap;margin:0">${codes
        .map((c) => `${escapeHtml(c)} — unused`)
        .join('\n')}</pre>`;
      const linksList = codes.map((code) => buildVoteLink(code)).join('\n');

      const alert = await alertController.create({
        header: 'Invite Codes',
        message: codesList,
        buttons: [
          {
            text: 'Copy all links',
            handler: async () => {
              if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(linksList);
              }
            },
          },
          {
            text: 'Close',
            role: 'cancel',
          },
        ],
      });

      await alert.present();
    } else {
      const toast = await toastController.create({
        message: 'Poll created successfully',
        duration: 2000,
        color: 'success'
      });
      await toast.present();
    }

    // Navigate to poll detail for private polls (so author can manage invite codes),
    // or community page for public polls
    if (isPrivate.value) {
      router.push(`/community/${selectedCommunity.value?.id}/poll/${poll.id}`);
    } else {
      router.push(`/community/${selectedCommunity.value?.id}`);
    }
  } catch (error) {
    logPollDebug('ui', 'Submit failed', {
      error: error instanceof Error ? error.message : String(error),
      durationMs: Math.round(performance.now() - submitStartedAt),
    });
    console.error('Error creating poll:', error);
    
    const toast = await toastController.create({
      message: 'Failed to create poll',
      duration: 2000,
      color: 'danger'
    });
    await toast.present();
  } finally {
    logPollDebug('ui', 'Submit finished', {
      isSubmittingBeforeReset: isSubmitting.value,
      durationMs: Math.round(performance.now() - submitStartedAt),
    });
    isSubmitting.value = false;
  }
}

watch(
  [() => route.query.communityId, () => communityStore.communities.length],
  ([routeCommunityId]) => {
    const communityId = typeof routeCommunityId === 'string' ? routeCommunityId : '';
    if (!communityId) {
      selectedCommunity.value = null;
      return;
    }

    const community = communityStore.communities.find(c => c.id === communityId) || null;
    selectedCommunity.value = community;
  },
  { immediate: true },
);
</script>

<style scoped>
.submit-slow-banner {
  margin: 8px 16px;
  padding: 10px 12px;
  border-radius: 10px;
  font-size: 13px;
  color: var(--app-warning);
  background: rgba(251, 191, 36, 0.12);
  border: 1px solid rgba(251, 191, 36, 0.3);
}
</style>
