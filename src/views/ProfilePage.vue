<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button default-href="/home"></ion-back-button>
        </ion-buttons>
        <ion-title>Profile</ion-title>
        <ion-buttons slot="end">
          <ion-button @click="$router.push('/settings')">
            <ion-icon :icon="settingsOutline"></ion-icon>
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <!-- Profile Header -->
      <div class="profile-header">
        <div class="avatar-placeholder">
          <ion-icon :icon="personCircleOutline"></ion-icon>
        </div>
        <h1>{{ userProfile?.displayName || userProfile?.username }}</h1>
        <p class="username">u/{{ userProfile?.username }}</p>

        <div class="stats-row">
          <div class="stat">
            <strong>{{ userProfile?.karma || 0 }}</strong>
            <span>Karma</span>
          </div>
          <div class="stat">
            <strong>{{ userProfile?.postCount || 0 }}</strong>
            <span>Posts</span>
          </div>
          <div class="stat">
            <strong>{{ userProfile?.commentCount || 0 }}</strong>
            <span>Comments</span>
          </div>
          <div class="stat">
            <strong>{{ joinedCommunitiesCount }}</strong>
            <span>Communities</span>
          </div>
        </div>
      </div>

      <div class="divider"></div>

      <!-- Edit Profile -->
      <div class="section">
        <p class="section-title">Edit Profile</p>
        <ion-item lines="full">
          <ion-input
            v-model="displayName"
            label="Display Name"
            label-placement="floating"
            placeholder="Enter your display name"
          ></ion-input>
        </ion-item>
        <ion-item lines="full">
          <ion-textarea
            v-model="bio"
            label="Bio"
            label-placement="floating"
            placeholder="Tell us about yourself..."
            :rows="3"
            :auto-grow="true"
          ></ion-textarea>
        </ion-item>
        <div class="section-action">
          <ion-button size="small" @click="saveProfile">
            <ion-icon slot="start" :icon="saveOutline"></ion-icon>
            Save Profile
          </ion-button>
        </div>
      </div>

      <div class="divider"></div>

      <!-- Account Info -->
      <div class="section">
        <p class="section-title">Account Information</p>
        <ion-item lines="full">
          <ion-label>
            <p class="item-label">Device ID</p>
            <p class="device-id">{{ fullDeviceId }}</p>
          </ion-label>
          <ion-button slot="end" fill="clear" @click="copyDeviceId">
            <ion-icon :icon="copyOutline"></ion-icon>
          </ion-button>
        </ion-item>
        <ion-item lines="full">
          <ion-label>
            <p class="item-label">Member Since</p>
            <p>{{ formatDate(userProfile?.createdAt) }}</p>
          </ion-label>
        </ion-item>
        <ion-item lines="none">
          <ion-label>
            <p class="item-label">Total Karma</p>
            <p>{{ userProfile?.karma || 0 }} points</p>
          </ion-label>
        </ion-item>
      </div>

      <div class="divider"></div>

      <!-- Activity -->
      <div class="section">
        <p class="section-title">Activity</p>
        <div class="activity-grid">
          <div class="activity-item">
            <ion-icon :icon="documentTextOutline" color="primary"></ion-icon>
            <div>
              <strong>{{ userProfile?.postCount || 0 }}</strong>
              <span>Posts</span>
            </div>
          </div>
          <div class="activity-item">
            <ion-icon :icon="chatbubbleOutline" color="secondary"></ion-icon>
            <div>
              <strong>{{ userProfile?.commentCount || 0 }}</strong>
              <span>Comments</span>
            </div>
          </div>
          <div class="activity-item">
            <ion-icon :icon="trophyOutline" color="warning"></ion-icon>
            <div>
              <strong>{{ userProfile?.karma || 0 }}</strong>
              <span>Karma</span>
            </div>
          </div>
          <div class="activity-item">
            <ion-icon :icon="peopleOutline" color="tertiary"></ion-icon>
            <div>
              <strong>{{ joinedCommunitiesCount }}</strong>
              <span>Communities</span>
            </div>
          </div>
        </div>
      </div>

    </ion-content>
  </ion-page>
</template>

<style scoped>
/* ── Profile Header ───────────────────────────────── */
.profile-header {
  text-align: center;
  padding: 28px 24px 20px;
}

.avatar-placeholder {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 80px;
  height: 80px;
  border-radius: 50%;
  background: rgba(var(--ion-color-primary-rgb), 0.1);
  margin-bottom: 12px;
}

.avatar-placeholder ion-icon {
  font-size: 56px;
  color: var(--ion-color-primary);
}

.profile-header h1 {
  margin: 0 0 4px;
  font-size: 22px;
  font-weight: 700;
}

.username {
  margin: 0 0 20px;
  font-size: 14px;
  color: var(--ion-color-medium);
}

.stats-row {
  display: flex;
  justify-content: center;
  gap: 24px;
}

.stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.stat strong {
  font-size: 20px;
  font-weight: 700;
}

.stat span {
  font-size: 12px;
  color: var(--ion-color-medium);
}

/* ── Divider ──────────────────────────────────────── */
.divider {
  height: 8px;
  background: rgba(var(--ion-text-color-rgb), 0.04);
  border-top: 1px solid rgba(var(--ion-text-color-rgb), 0.07);
  border-bottom: 1px solid rgba(var(--ion-text-color-rgb), 0.07);
}

/* ── Sections ─────────────────────────────────────── */
.section {
  padding: 16px 0;
}

.section-title {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--ion-color-medium);
  margin: 0 16px 8px;
}

.section-action {
  padding: 12px 16px 4px;
}

.item-label {
  font-size: 12px;
  color: var(--ion-color-medium);
  margin-bottom: 2px;
}

.device-id {
  font-family: monospace;
  font-size: 12px;
  word-break: break-all;
}

/* ── Activity Grid ────────────────────────────────── */
.activity-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1px;
  background: rgba(var(--ion-text-color-rgb), 0.07);
  border-top: 1px solid rgba(var(--ion-text-color-rgb), 0.07);
}

.activity-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  background: var(--ion-background-color);
}

.activity-item ion-icon {
  font-size: 28px;
  flex-shrink: 0;
}

.activity-item strong {
  display: block;
  font-size: 18px;
  font-weight: 700;
}

.activity-item span {
  display: block;
  font-size: 12px;
  color: var(--ion-color-medium);
}
</style>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import {
  IonPage, IonHeader, IonToolbar, IonTitle, IonContent,
  IonButtons, IonBackButton, IonButton, IonCard, IonCardHeader,
  IonCardTitle, IonCardContent, IonList, IonItem, IonLabel,
  IonInput, IonTextarea, IonIcon, toastController
} from '@ionic/vue';
import {
  personCircleOutline, settingsOutline, saveOutline, copyOutline,
  documentTextOutline, chatbubbleOutline, trophyOutline, peopleOutline
} from 'ionicons/icons';
import { UserService, UserProfile } from '../services/userService';
import { VoteTrackerService } from '../services/voteTrackerService';
import { useCommunityStore } from '../stores/communityStore';

const communityStore = useCommunityStore();

const userProfile = ref<UserProfile | null>(null);
const displayName = ref('');
const bio = ref('');
const deviceId = ref('');

const fullDeviceId = computed(() => deviceId.value || '');

const joinedCommunitiesCount = computed(() => communityStore.joinedCommunities?.size || 0);

function formatDate(timestamp?: number): string {
  if (!timestamp) return 'Unknown';
  return new Date(timestamp).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric'
  });
}

async function loadProfile() {
  try {
    userProfile.value = await UserService.getCurrentUser(true); // add true
    displayName.value = userProfile.value.displayName || userProfile.value.username;
    bio.value = userProfile.value.bio || '';
    deviceId.value = await VoteTrackerService.getDeviceId();
  } catch (error) {
    console.error('Error loading profile:', error);
  }
}

async function saveProfile() {
  try {
    if (!userProfile.value) return;
    await UserService.updateProfile({ displayName: displayName.value, bio: bio.value });
    const toast = await toastController.create({ message: 'Profile updated', duration: 2000, color: 'success' });
    await toast.present();
    await loadProfile();
  } catch {
    const toast = await toastController.create({ message: 'Failed to update profile', duration: 2000, color: 'danger' });
    await toast.present();
  }
}

async function copyDeviceId() {
  try {
    await navigator.clipboard.writeText(deviceId.value);
    const toast = await toastController.create({ message: 'Device ID copied', duration: 1500, color: 'success' });
    await toast.present();
  } catch {
    console.error('Error copying device ID');
  }
}

onMounted(async () => {
  await loadProfile();
});
</script>

