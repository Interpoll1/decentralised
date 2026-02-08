<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button default-href="/home"></ion-back-button>
        </ion-buttons>
        <ion-title>Create Poll</ion-title>
        <ion-buttons slot="end">
          <ion-button @click="createPoll" :disabled="!isValid">
            Post
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>
    <ion-content>
      <!-- Community Selection -->
      <ion-card>
        <ion-card-header>
          <ion-card-title>Community</ion-card-title>
        </ion-card-header>
        <ion-card-content>
          <ion-item button @click="showCommunityPicker">
            <ion-label>
              <h3>{{ selectedCommunity ? selectedCommunity.displayName : 'Select a community' }}</h3>
              <p v-if="selectedCommunity">{{ selectedCommunity.id }}</p>
            </ion-label>
            <ion-icon :icon="chevronDownOutline" slot="end"></ion-icon>
          </ion-item>
        </ion-card-content>
      </ion-card>

      <!-- Poll Question -->
      <ion-card>
        <ion-card-header>
          <ion-card-title>Poll Question</ion-card-title>
        </ion-card-header>
        <ion-card-content>
          <ion-item>
            <ion-label position="stacked">Question *</ion-label>
            <ion-input 
              v-model="question" 
              placeholder="What would you like to ask?"
              :counter="true"
              maxlength="200"
            ></ion-input>
          </ion-item>
        </ion-card-content>
      </ion-card>

      <!-- Poll Options -->
      <ion-card>
        <ion-card-header>
          <ion-card-title>Poll Options</ion-card-title>
        </ion-card-header>
        <ion-card-content>
          <ion-list>
            <ion-item v-for="(option, index) in options" :key="index">
              <ion-label position="stacked">Option {{ index + 1 }} *</ion-label>
              <ion-input 
                v-model="options[index]" 
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
        </ion-card-content>
      </ion-card>

      <!-- Poll Settings -->
      <ion-card>
        <ion-card-header>
          <ion-card-title>Poll Settings</ion-card-title>
        </ion-card-header>
        <ion-card-content>
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
              <ion-toggle v-model="requireLogin">
                Require login to vote (Google/Microsoft)
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
        </ion-card-content>
      </ion-card>

      <!-- Additional Details (Optional) -->
      <ion-card>
        <ion-card-header>
          <ion-card-title>Additional Details (Optional)</ion-card-title>
        </ion-card-header>
        <ion-card-content>
          <ion-item>
            <ion-label position="stacked">Description</ion-label>
            <ion-textarea 
              v-model="description" 
              placeholder="Add more context to your poll..."
              rows="4"
              maxlength="500"
              :counter="true"
            ></ion-textarea>
          </ion-item>
        </ion-card-content>
      </ion-card>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonButtons,
  IonBackButton,
  IonButton,
  IonCard,
  IonCardHeader,
  IonCardTitle,
  IonCardContent,
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

const router = useRouter();
const communityStore = useCommunityStore();
const pollStore = usePollStore();

const selectedCommunity = ref<Community | null>(null);
const question = ref('');
const options = ref(['', '']);
const duration = ref('7');
const allowMultipleChoices = ref(false);
const showResultsBeforeVoting = ref(false);
const description = ref('');
const requireLogin = ref(false);
const isPrivate = ref(false);
const inviteCodeCount = ref(20);

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
    options.value.filter(opt => opt.trim().length > 0).length >= 2
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
    options.value.push('');
  }
}

function removeOption(index: number) {
  if (options.value.length > 2) {
    options.value.splice(index, 1);
  }
}

async function createPoll() {
  if (!isValid.value) return;

  try {
    // Filter out empty options
    const validOptions = options.value.filter(opt => opt.trim().length > 0);

    // Create poll using pollStore
    const poll = await pollStore.createPoll({
      communityId: selectedCommunity.value!.id,
      question: question.value.trim(),
      description: description.value.trim(),
      options: validOptions,
      durationDays: parseInt(duration.value),
      allowMultipleChoices: allowMultipleChoices.value,
      showResultsBeforeVoting: showResultsBeforeVoting.value,
      requireLogin: requireLogin.value,
      isPrivate: isPrivate.value,
      inviteCodeCount: inviteCodeCount.value
    });

    // If private, copy a ready-to-share invite link and show codes
    if (isPrivate.value && (poll as any).inviteCodes?.length) {
      const codes = (poll as any).inviteCodes as string[];
      const baseUrl = window.location.origin;
      const sampleLink = `${baseUrl}/vote/${poll.id}?code=${codes[0]}`;

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
      const linksList = codes.map((c) => `${baseUrl}/vote/${poll.id}?code=${c}`).join('\n');

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
    console.error('Error creating poll:', error);
    
    const toast = await toastController.create({
      message: 'Failed to create poll',
      duration: 2000,
      color: 'danger'
    });
    await toast.present();
  }
}

onMounted(() => {
  // If user came from a specific community, pre-select it
  const routeCommunityId = router.currentRoute.value.query.communityId as string;
  if (routeCommunityId) {
    const community = communityStore.communities.find(c => c.id === routeCommunityId);
    if (community) {
      selectedCommunity.value = community;
    }
  }
});
</script>

<style scoped>
ion-card {
  margin: 16px 12px;
}

ion-item ion-button {
  margin: 0;
}
</style>