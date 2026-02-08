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
        <div class="avatar-container">
          <div v-if="userProfile?.avatarThumbnail || userProfile?.avatarIPFS" class="avatar">
            <img :src="userProfile.avatarThumbnail || getIPFSUrl(userProfile.avatarIPFS)" :alt="userProfile.username" />
          </div>
          <div v-else class="avatar-placeholder">
            <ion-icon :icon="personCircleOutline" size="large"></ion-icon>
          </div>
          <ion-button size="small" fill="clear" @click="showAvatarPicker">
            <ion-icon slot="icon-only" :icon="cameraOutline"></ion-icon>
          </ion-button>
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
        </div>
      </div>

      <!-- Edit Profile Form -->
      <ion-card>
        <ion-card-header>
          <ion-card-title>Edit Profile</ion-card-title>
        </ion-card-header>
        
        <ion-card-content>
          <ion-list>
            <ion-item>
              <ion-label position="stacked">Display Name</ion-label>
              <ion-input 
                v-model="displayName" 
                placeholder="Enter your display name"
                @ionBlur="updateProfile"
              ></ion-input>
            </ion-item>

            <ion-item>
              <ion-label position="stacked">Bio</ion-label>
              <ion-textarea 
                v-model="bio" 
                placeholder="Tell us about yourself..."
                rows="4"
                @ionBlur="updateProfile"
              ></ion-textarea>
            </ion-item>
          </ion-list>

          <ion-button expand="block" @click="saveProfile" class="mt-3">
            <ion-icon slot="start" :icon="saveOutline"></ion-icon>
            Save Profile
          </ion-button>
        </ion-card-content>
      </ion-card>

      <!-- Account Info -->
      <ion-card>
        <ion-card-header>
          <ion-card-title>Account Information</ion-card-title>
        </ion-card-header>
        
        <ion-card-content>
          <ion-list>
            <ion-item>
              <ion-label>
                <h3>Device ID</h3>
                <p class="device-id">{{ truncatedDeviceId }}</p>
              </ion-label>
              <ion-button slot="end" fill="clear" @click="copyDeviceId">
                <ion-icon :icon="copyOutline"></ion-icon>
              </ion-button>
            </ion-item>

            <ion-item>
              <ion-label>
                <h3>Member Since</h3>
                <p>{{ formatDate(userProfile?.createdAt) }}</p>
              </ion-label>
            </ion-item>

            <ion-item>
              <ion-label>
                <h3>Total Karma</h3>
                <p>{{ userProfile?.karma || 0 }} points</p>
              </ion-label>
            </ion-item>
          </ion-list>
        </ion-card-content>
      </ion-card>

      <!-- Activity Stats -->
      <ion-card>
        <ion-card-header>
          <ion-card-title>Activity</ion-card-title>
        </ion-card-header>
        
        <ion-card-content>
          <div class="activity-grid">
            <div class="activity-item">
              <ion-icon :icon="documentTextOutline" color="primary"></ion-icon>
              <div>
                <strong>{{ userProfile?.postCount || 0 }}</strong>
                <span>Posts Created</span>
              </div>
            </div>
            <div class="activity-item">
              <ion-icon :icon="chatbubbleOutline" color="secondary"></ion-icon>
              <div>
                <strong>{{ userProfile?.commentCount || 0 }}</strong>
                <span>Comments Made</span>
              </div>
            </div>
            <div class="activity-item">
              <ion-icon :icon="trophyOutline" color="warning"></ion-icon>
              <div>
                <strong>{{ userProfile?.karma || 0 }}</strong>
                <span>Total Karma</span>
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
        </ion-card-content>
      </ion-card>

      <!-- Hidden file input for avatar -->
      <input 
        ref="avatarInput" 
        type="file" 
        accept="image/*" 
        style="display: none"
        @change="handleAvatarChange"
      />
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
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
  IonIcon,
  toastController
} from '@ionic/vue';
import {
  personCircleOutline,
  settingsOutline,
  cameraOutline,
  saveOutline,
  copyOutline,
  documentTextOutline,
  chatbubbleOutline,
  trophyOutline,
  peopleOutline
} from 'ionicons/icons';
import { UserService, UserProfile } from '../services/userService';
import { VoteTrackerService } from '../services/voteTrackerService';
import { IPFSService } from '../services/ipfsService';
import { useCommunityStore } from '../stores/communityStore';

const communityStore = useCommunityStore();

const userProfile = ref<UserProfile | null>(null);
const displayName = ref('');
const bio = ref('');
const deviceId = ref('');
const avatarInput = ref<HTMLInputElement | null>(null);

const truncatedDeviceId = computed(() => {
  if (!deviceId.value) return '';
  return deviceId.value.substring(0, 16) + '...';
});

const joinedCommunitiesCount = computed(() => {
  return communityStore.joinedCommunities?.size || 0;
});

function getIPFSUrl(cid?: string): string {
  if (!cid) return '';
  return `https://ipfs.io/ipfs/${cid}`;
}

function formatDate(timestamp?: number): string {
  if (!timestamp) return 'Unknown';
  return new Date(timestamp).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
}

async function loadProfile() {
  try {
    userProfile.value = await UserService.getCurrentUser();
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

    await UserService.updateProfile({
      displayName: displayName.value,
      bio: bio.value
    });

    const toast = await toastController.create({
      message: 'Profile updated successfully',
      duration: 2000,
      color: 'success'
    });
    await toast.present();

    // Reload profile
    await loadProfile();
  } catch (error) {
    console.error('Error saving profile:', error);
    
    const toast = await toastController.create({
      message: 'Failed to update profile',
      duration: 2000,
      color: 'danger'
    });
    await toast.present();
  }
}

async function updateProfile() {
  // Auto-save on blur
  await saveProfile();
}

function showAvatarPicker() {
  avatarInput.value?.click();
}

async function handleAvatarChange(event: Event) {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  
  if (!file) return;

  try {
    // Show loading toast
    const loadingToast = await toastController.create({
      message: 'Uploading avatar...',
      duration: 0
    });
    await loadingToast.present();

    // Upload to IPFS
    const imageData = await IPFSService.uploadImage(file);

    // Update profile
    await UserService.updateProfile({
      avatarIPFS: imageData.cid,
      avatarThumbnail: imageData.thumbnail
    });

    await loadingToast.dismiss();

    const toast = await toastController.create({
      message: 'Avatar updated successfully',
      duration: 2000,
      color: 'success'
    });
    await toast.present();

    // Reload profile
    await loadProfile();
  } catch (error) {
    console.error('Error uploading avatar:', error);
    
    const toast = await toastController.create({
      message: 'Failed to upload avatar',
      duration: 2000,
      color: 'danger'
    });
    await toast.present();
  }
}

async function copyDeviceId() {
  try {
    await navigator.clipboard.writeText(deviceId.value);
    
    const toast = await toastController.create({
      message: 'Device ID copied to clipboard',
      duration: 1500,
      color: 'success'
    });
    await toast.present();
  } catch (error) {
    console.error('Error copying device ID:', error);
  }
}

onMounted(async () => {
  await loadProfile();
});
</script>

<style scoped>
.profile-header {
  text-align: center;
  padding: 32px 24px;
  background: linear-gradient(135deg, var(--ion-color-primary) 0%, var(--ion-color-primary-shade) 100%);
  color: white;
}

.avatar-container {
  position: relative;
  display: inline-block;
  margin-bottom: 16px;
}

.avatar,
.avatar-placeholder {
  width: 120px;
  height: 120px;
  border-radius: 50%;
  border: 4px solid rgba(255, 255, 255, 0.3);
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(var(--ion-card-background-rgb), 0.3);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
}

.avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.avatar-placeholder {
  background: rgba(255, 255, 255, 0.2);
}

.avatar-placeholder ion-icon {
  font-size: 64px;
  color: white;
}

.avatar-container ion-button {
  position: absolute;
  bottom: 0;
  right: 0;
  --background: var(--ion-color-primary);
  --color: white;
  --border-radius: 50%;
  width: 40px;
  height: 40px;
}

.profile-header h1 {
  margin: 0 0 4px 0;
  font-size: 28px;
  font-weight: 600;
}

.username {
  margin: 0 0 24px 0;
  opacity: 0.9;
  font-size: 16px;
}

.stats-row {
  display: flex;
  justify-content: center;
  gap: 32px;
  margin-top: 24px;
}

.stat {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.stat strong {
  font-size: 24px;
  font-weight: 600;
  display: block;
}

.stat span {
  font-size: 13px;
  opacity: 0.9;
}

.device-id {
  font-family: monospace;
  font-size: 12px;
  color: var(--ion-color-medium);
}

.activity-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

.activity-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  border-radius: 14px;
  background: rgba(var(--ion-card-background-rgb), 0.3);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border: 1px solid var(--glass-border);
  box-shadow: var(--glass-highlight);
}

.activity-item ion-icon {
  font-size: 32px;
}

.activity-item strong {
  display: block;
  font-size: 20px;
  font-weight: 600;
}

.activity-item span {
  display: block;
  font-size: 12px;
  color: var(--ion-color-medium);
}

.mt-3 {
  margin-top: 16px;
}

ion-card {
  margin: 16px 12px;
}

@media (max-width: 576px) {
  .stats-row {
    gap: 24px;
  }

  .stat strong {
    font-size: 20px;
  }

  .activity-grid {
    grid-template-columns: 1fr;
  }
}
</style>