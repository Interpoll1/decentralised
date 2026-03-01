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
        <div class="avatar-container" @click="selectAvatar">
          <img v-if="avatarPreview || userProfile?.avatarThumbnail" :src="avatarPreview || userProfile?.avatarThumbnail" class="avatar-image" />
          <div v-else class="avatar-placeholder">
            <ion-icon :icon="personCircleOutline"></ion-icon>
          </div>
          <div class="avatar-edit-badge">
            <ion-icon :icon="cameraOutline"></ion-icon>
          </div>
        </div>
        <h1>{{ userProfile?.customUsername || userProfile?.displayName || userProfile?.username }}</h1>
        <p class="username">u/{{ userProfile?.customUsername || userProfile?.username }}</p>
        <p v-if="userProfile?.showRealName" class="anonymity-badge named">
          <ion-icon :icon="eyeOutline"></ion-icon> Username visible on posts
        </p>
        <p v-else class="anonymity-badge anonymous">
          <ion-icon :icon="eyeOffOutline"></ion-icon> Posting anonymously
        </p>

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

      <input
        ref="avatarInput"
        type="file"
        accept="image/*"
        style="display: none"
        @change="handleAvatarSelect"
      />

      <div class="divider"></div>

      <!-- Edit Profile -->
      <div class="section">
        <p class="section-title">Edit Profile</p>
        <ion-item lines="full">
          <ion-input
            v-model="customUsername"
            label="Custom Username"
            label-placement="floating"
            placeholder="Choose a username"
            :maxlength="30"
          ></ion-input>
        </ion-item>
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
        <ion-item lines="full">
          <ion-toggle v-model="showRealName" justify="space-between">
            Show username on posts
          </ion-toggle>
        </ion-item>
        <p class="toggle-help">
          {{ showRealName
            ? 'Your custom username will appear on new posts and comments.'
            : 'You will appear as a random pseudonym on each post (default).' }}
        </p>
        <div class="section-action">
          <ion-button size="small" @click="saveProfile" :disabled="isSaving">
            <ion-spinner v-if="isSaving" name="crescent" slot="start" style="width:16px;height:16px;"></ion-spinner>
            <ion-icon v-else slot="start" :icon="saveOutline"></ion-icon>
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

.avatar-container {
  position: relative;
  display: inline-block;
  cursor: pointer;
  margin-bottom: 12px;
}

.avatar-image {
  width: 80px;
  height: 80px;
  border-radius: 50%;
  object-fit: cover;
  border: 3px solid rgba(var(--ion-color-primary-rgb), 0.2);
}

.avatar-placeholder {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 80px;
  height: 80px;
  border-radius: 50%;
  background: rgba(var(--ion-color-primary-rgb), 0.1);
}

.avatar-placeholder ion-icon {
  font-size: 56px;
  color: var(--ion-color-primary);
}

.avatar-edit-badge {
  position: absolute;
  bottom: 0;
  right: 0;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--ion-color-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px solid var(--ion-background-color);
}

.avatar-edit-badge ion-icon {
  font-size: 14px;
  color: white;
}

.profile-header h1 {
  margin: 0 0 4px;
  font-size: 22px;
  font-weight: 700;
}

.username {
  margin: 0 0 8px;
  font-size: 14px;
  color: var(--ion-color-medium);
}

.anonymity-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  padding: 4px 10px;
  border-radius: 12px;
  margin: 0 0 16px;
}

.anonymity-badge.anonymous {
  background: rgba(var(--ion-color-success-rgb), 0.1);
  color: var(--ion-color-success);
}

.anonymity-badge.named {
  background: rgba(var(--ion-color-primary-rgb), 0.1);
  color: var(--ion-color-primary);
}

.anonymity-badge ion-icon {
  font-size: 14px;
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

.toggle-help {
  font-size: 12px;
  color: var(--ion-color-medium);
  margin: 4px 16px 0;
  line-height: 1.4;
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
  IonButtons, IonBackButton, IonButton, IonItem, IonLabel,
  IonInput, IonTextarea, IonIcon, IonToggle, IonSpinner,
  toastController
} from '@ionic/vue';
import {
  personCircleOutline, settingsOutline, saveOutline, copyOutline,
  documentTextOutline, chatbubbleOutline, trophyOutline, peopleOutline,
  cameraOutline, eyeOutline, eyeOffOutline
} from 'ionicons/icons';
import { UserService } from '../services/userService';
import type { UserProfile } from '../services/userService';
import { VoteTrackerService } from '../services/voteTrackerService';
import { IPFSService } from '../services/ipfsService';
import { useCommunityStore } from '../stores/communityStore';

const communityStore = useCommunityStore();

const userProfile = ref<UserProfile | null>(null);
const displayName = ref('');
const customUsername = ref('');
const bio = ref('');
const showRealName = ref(false);
const deviceId = ref('');
const isSaving = ref(false);
const avatarPreview = ref<string | null>(null);
const avatarFile = ref<File | null>(null);
const avatarInput = ref<HTMLInputElement | null>(null);

const fullDeviceId = computed(() => deviceId.value || '');

const joinedCommunitiesCount = computed(() => communityStore.joinedCommunities?.size || 0);

function formatDate(timestamp?: number): string {
  if (!timestamp) return 'Unknown';
  return new Date(timestamp).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric'
  });
}

function selectAvatar() {
  avatarInput.value?.click();
}

async function handleAvatarSelect(event: Event) {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) return;

  if (file.size > 10 * 1024 * 1024) {
    const toast = await toastController.create({ message: 'Image too large (max 10 MB)', duration: 3000, color: 'danger' });
    await toast.present();
    return;
  }

  avatarFile.value = file;
  const reader = new FileReader();
  reader.onload = (e) => { avatarPreview.value = e.target?.result as string; };
  reader.readAsDataURL(file);
}

async function loadProfile() {
  try {
    userProfile.value = await UserService.getCurrentUser(true);
    displayName.value = userProfile.value.displayName || userProfile.value.username;
    customUsername.value = userProfile.value.customUsername || '';
    bio.value = userProfile.value.bio || '';
    showRealName.value = userProfile.value.showRealName || false;
    deviceId.value = await VoteTrackerService.getDeviceId();
  } catch (error) {
    console.error('Error loading profile:', error);
  }
}

async function saveProfile() {
  try {
    if (!userProfile.value) return;
    isSaving.value = true;

    const updates: Partial<UserProfile> = {
      displayName: displayName.value,
      customUsername: customUsername.value.trim() || undefined,
      bio: bio.value,
      showRealName: showRealName.value,
    };

    // Upload avatar if changed
    if (avatarFile.value) {
      const result = await IPFSService.uploadImage(avatarFile.value);
      updates.avatarIPFS = result.cid;
      updates.avatarThumbnail = result.thumbnail;
      avatarFile.value = null;
    }

    await UserService.updateProfile(updates);
    const toast = await toastController.create({ message: 'Profile updated', duration: 2000, color: 'success' });
    await toast.present();
    await loadProfile();
  } catch {
    const toast = await toastController.create({ message: 'Failed to update profile', duration: 2000, color: 'danger' });
    await toast.present();
  } finally {
    isSaving.value = false;
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

