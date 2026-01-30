<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button default-href="/home"></ion-back-button>
        </ion-buttons>
        <ion-title>Settings</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <!-- Storage Usage -->
      <ion-card>
        <ion-card-header>
          <ion-card-title>Storage Usage</ion-card-title>
          <ion-card-subtitle>Manage local device storage</ion-card-subtitle>
        </ion-card-header>

        <ion-card-content>
          <div class="storage-stats">
            <div class="stat-row">
              <span>Used Storage</span>
              <strong>{{ storageStats.used.toFixed(1) }} MB</strong>
            </div>
            <div class="stat-row">
              <span>Available</span>
              <strong>{{ storageStats.quota.toFixed(0) }} MB</strong>
            </div>
            <div class="stat-row">
              <span>Pinned Images</span>
              <strong>{{ storageStats.pinnedItems }}</strong>
            </div>
          </div>

          <div class="progress-bar">
            <div 
              class="progress-fill" 
              :style="{ width: `${storagePercent}%` }"
              :class="{ warning: storagePercent > 80, danger: storagePercent > 95 }"
            ></div>
          </div>
          <p class="progress-text">{{ storagePercent.toFixed(1) }}% used</p>

          <ion-button 
            expand="block" 
            fill="outline"
            @click="refreshStorageStats"
            class="mt-3"
          >
            <ion-icon slot="start" :icon="refreshOutline"></ion-icon>
            Refresh Stats
          </ion-button>
        </ion-card-content>
      </ion-card>

      <!-- Pinning Policy -->
      <ion-card>
        <ion-card-header>
          <ion-card-title>Storage Policy</ion-card-title>
          <ion-card-subtitle>Control what gets stored locally</ion-card-subtitle>
        </ion-card-header>

        <ion-card-content>
          <ion-list>
            <ion-item>
              <ion-toggle v-model="policy.myPosts" @ionChange="savePolicy">
                Always store my posts
              </ion-toggle>
            </ion-item>

            <ion-item>
              <ion-toggle v-model="policy.myUpvotes" @ionChange="savePolicy">
                Store posts I upvoted
              </ion-toggle>
            </ion-item>

            <ion-item>
              <ion-toggle v-model="policy.myCommunities" @ionChange="savePolicy">
                Store my communities
              </ion-toggle>
            </ion-item>

            <ion-item>
              <ion-toggle v-model="policy.popularPosts" @ionChange="savePolicy">
                Cache popular posts (100+ upvotes)
              </ion-toggle>
            </ion-item>

            <ion-item>
              <ion-toggle v-model="policy.autoPruneOldContent" @ionChange="savePolicy">
                Auto-delete old cached content
              </ion-toggle>
            </ion-item>

            <ion-item>
              <ion-label>Keep recent posts</ion-label>
              <ion-select v-model="policy.recentPosts" @ionChange="savePolicy">
                <ion-select-option :value="20">Last 20</ion-select-option>
                <ion-select-option :value="50">Last 50</ion-select-option>
                <ion-select-option :value="100">Last 100</ion-select-option>
                <ion-select-option :value="200">Last 200</ion-select-option>
              </ion-select>
            </ion-item>

            <ion-item>
              <ion-label>Max storage (MB)</ion-label>
              <ion-select v-model="policy.maxStorageMB" @ionChange="savePolicy">
                <ion-select-option :value="50">50 MB</ion-select-option>
                <ion-select-option :value="100">100 MB</ion-select-option>
                <ion-select-option :value="250">250 MB</ion-select-option>
                <ion-select-option :value="500">500 MB</ion-select-option>
                <ion-select-option :value="1000">1 GB</ion-select-option>
              </ion-select>
            </ion-item>
          </ion-list>
        </ion-card-content>
      </ion-card>

      <!-- Appearance -->
      <ion-card>
        <ion-card-header>
          <ion-card-title>Appearance</ion-card-title>
          <ion-card-subtitle>Theme and display options</ion-card-subtitle>
        </ion-card-header>

        <ion-card-content>
          <ion-list>
            <ion-item>
              <ion-toggle v-model="isDarkMode" @ionChange="toggleDarkMode">
                Enable dark mode
              </ion-toggle>
            </ion-item>
          </ion-list>
        </ion-card-content>
      </ion-card>

      <!-- Content Filters -->
      <ion-card>
        <ion-card-header>
          <ion-card-title>Content Filters</ion-card-title>
          <ion-card-subtitle>Hide low-reputation users</ion-card-subtitle>
        </ion-card-header>

        <ion-card-content>
          <ion-list>
            <ion-item>
              <ion-label>Minimum user karma</ion-label>
              <ion-select v-model="minUserKarma" @ionChange="saveFilterSettings">
                <ion-select-option :value="-1000">Show everyone</ion-select-option>
                <ion-select-option :value="-10">Hide below -10</ion-select-option>
                <ion-select-option :value="0">Hide below 0</ion-select-option>
                <ion-select-option :value="10">Hide below 10</ion-select-option>
                <ion-select-option :value="50">Hide below 50</ion-select-option>
                <ion-select-option :value="100">Hide below 100</ion-select-option>
              </ion-select>
            </ion-item>
          </ion-list>
          <p class="helper-text">
            Posts and comments from users whose karma is below this value will be hidden in your feed on this device.
          </p>
        </ion-card-content>
      </ion-card>

      <!-- Data Management -->
      <ion-card>
        <ion-card-header>
          <ion-card-title>Data Management</ion-card-title>
          <ion-card-subtitle>Export, import, or clear data</ion-card-subtitle>
        </ion-card-header>

        <ion-card-content>
          <ion-button expand="block" fill="outline" @click="exportData">
            <ion-icon slot="start" :icon="downloadOutline"></ion-icon>
            Export All Data
          </ion-button>

          <ion-button expand="block" fill="outline" @click="importData" class="mt-2">
            <ion-icon slot="start" :icon="cloudUploadOutline"></ion-icon>
            Import Data
          </ion-button>

          <ion-button 
            expand="block" 
            fill="outline"
            @click="pruneOldContent"
            class="mt-2"
          >
            <ion-icon slot="start" :icon="trashOutline"></ion-icon>
            Clean Up Old Content
          </ion-button>

          <ion-button 
            expand="block" 
            color="danger" 
            fill="outline"
            @click="confirmClearAll"
            class="mt-2"
          >
            <ion-icon slot="start" :icon="warningOutline"></ion-icon>
            Clear All Data
          </ion-button>

          <input 
            ref="importFileInput" 
            type="file" 
            accept=".json" 
            style="display: none"
            @change="handleImportFile"
          />
        </ion-card-content>
      </ion-card>

      <!-- User Info -->
      <ion-card>
        <ion-card-header>
          <ion-card-title>Account</ion-card-title>
        </ion-card-header>

        <ion-card-content>
          <div class="user-info">
            <div class="info-row">
              <span>Device ID</span>
              <code>{{ truncatedDeviceId }}</code>
            </div>
            <div class="info-row">
              <span>Username</span>
              <strong>{{ userProfile?.username }}</strong>
            </div>
            <div class="info-row">
              <span>Karma</span>
              <ion-badge color="primary">{{ userProfile?.karma || 0 }}</ion-badge>
            </div>
            <div class="info-row" v-if="cloudUser">
              <span>Cloud login</span>
              <strong>{{ cloudUser?.email || cloudUser?.name }}</strong>
            </div>
            <div class="info-row" v-if="cloudUser">
              <span>Provider</span>
              <ion-badge color="secondary">{{ cloudUser?.provider }}</ion-badge>
            </div>
          </div>

          <ion-button expand="block" fill="outline" @click="$router.push('/profile')">
            <ion-icon slot="start" :icon="personCircleOutline"></ion-icon>
            Edit Profile
          </ion-button>

          <ion-button expand="block" class="mt-2" fill="outline" color="dark" @click="loginWithGoogle">
            <ion-icon slot="start" :icon="logoGoogle"></ion-icon>
            Sign in with Google
          </ion-button>

          <ion-button expand="block" class="mt-2" fill="outline" color="tertiary" @click="loginWithMicrosoft">
            <ion-icon slot="start" :icon="logoMicrosoft"></ion-icon>
            Sign in with Microsoft
          </ion-button>
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
  IonCard,
  IonCardHeader,
  IonCardTitle,
  IonCardSubtitle,
  IonCardContent,
  IonList,
  IonItem,
  IonLabel,
  IonToggle,
  IonSelect,
  IonSelectOption,
  IonButton,
  IonIcon,
  IonBadge,
  alertController,
  toastController
} from '@ionic/vue';
import {
  refreshOutline,
  downloadOutline,
  cloudUploadOutline,
  trashOutline,
  warningOutline,
  personCircleOutline,
  logoGoogle,
  logoMicrosoft
} from 'ionicons/icons';
import { PinningService } from '../services/pinningService';
import { StorageManager } from '../services/storageManager';
import { UserService } from '../services/userService';
import { VoteTrackerService } from '../services/voteTrackerService';
import { AuditService, type CloudUser } from '../services/auditService';

const router = useRouter();
const importFileInput = ref<HTMLInputElement | null>(null);

const storageStats = ref({
  used: 0,
  quota: 0,
  pinnedItems: 0
});

const policy = ref({
  myPosts: true,
  myUpvotes: true,
  myCommunities: true,
  popularPosts: true,
  recentPosts: 50,
  maxStorageMB: 100,
  autoPruneOldContent: true
});

const isDarkMode = ref(false);
const minUserKarma = ref<number>(-1000);

const userProfile = ref<any>(null);
const deviceId = ref('');
const cloudUser = ref<CloudUser | null>(null);

const storagePercent = computed(() => {
  if (storageStats.value.quota === 0) return 0;
  return (storageStats.value.used / storageStats.value.quota) * 100;
});

const truncatedDeviceId = computed(() => {
  return deviceId.value.substring(0, 16) + '...';
});

onMounted(async () => {
  await refreshStorageStats();
  await loadPolicy();
  userProfile.value = await UserService.getCurrentUser();
  deviceId.value = await VoteTrackerService.getDeviceId();
  cloudUser.value = await AuditService.getCloudUser();

  const storedTheme = localStorage.getItem('theme');
  if (storedTheme === 'dark') {
    isDarkMode.value = true;
    document.body.classList.add('dark');
  }

  const storedMinKarma = localStorage.getItem('minUserKarma');
  if (storedMinKarma !== null) {
    minUserKarma.value = Number(storedMinKarma) || -1000;
  }
});

const refreshStorageStats = async () => {
  storageStats.value = await PinningService.getStorageStats();
};

const loadPolicy = async () => {
  policy.value = await PinningService.getPolicy();
};

const savePolicy = async () => {
  await PinningService.setPolicy(policy.value);
  
  const toast = await toastController.create({
    message: 'Policy saved',
    duration: 1500,
    color: 'success'
  });
  await toast.present();
};

const toggleDarkMode = () => {
  if (isDarkMode.value) {
    document.body.classList.add('dark');
    localStorage.setItem('theme', 'dark');
  } else {
    document.body.classList.remove('dark');
    localStorage.setItem('theme', 'light');
  }
};

const saveFilterSettings = async () => {
  localStorage.setItem('minUserKarma', String(minUserKarma.value));

  const toast = await toastController.create({
    message: 'Content filter updated',
    duration: 1500,
    color: 'success'
  });
  await toast.present();
};

const exportData = async () => {
  try {
    const data = await StorageManager.exportAllData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `voting-chain-backup-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);

    const toast = await toastController.create({
      message: 'Data exported successfully',
      duration: 2000,
      color: 'success'
    });
    await toast.present();
  } catch (error) {
    console.error('Export error:', error);
    
    const toast = await toastController.create({
      message: 'Export failed',
      duration: 2000,
      color: 'danger'
    });
    await toast.present();
  }
};

const importData = () => {
  importFileInput.value?.click();
};

const handleImportFile = async (event: Event) => {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  
  if (!file) return;

  try {
    const text = await file.text();
    const data = JSON.parse(text);
    
    await StorageManager.importData(data);

    const toast = await toastController.create({
      message: 'Data imported successfully',
      duration: 2000,
      color: 'success'
    });
    await toast.present();

    // Refresh
    await refreshStorageStats();
  } catch (error) {
    console.error('Import error:', error);
    
    const toast = await toastController.create({
      message: 'Import failed',
      duration: 2000,
      color: 'danger'
    });
    await toast.present();
  }
};

const pruneOldContent = async () => {
  const alert = await alertController.create({
    header: 'Clean Up Storage',
    message: 'This will remove old cached content. Your posts and important data will be kept.',
    buttons: [
      { text: 'Cancel', role: 'cancel' },
      {
        text: 'Clean Up',
        handler: async () => {
          const result = await StorageManager.pruneOldData();
          
          const toast = await toastController.create({
            message: `Cleaned up ${result.pollsDeleted} items`,
            duration: 2000,
            color: 'success'
          });
          await toast.present();

          await refreshStorageStats();
        }
      }
    ]
  });

  await alert.present();
};

const confirmClearAll = async () => {
  const alert = await alertController.create({
    header: 'Clear All Data',
    message: 'This will delete EVERYTHING from local storage. This cannot be undone!',
    buttons: [
      { text: 'Cancel', role: 'cancel' },
      {
        text: 'Clear All',
        role: 'destructive',
        handler: async () => {
          await StorageManager.clearAll();
          
          const toast = await toastController.create({
            message: 'All data cleared',
            duration: 2000,
            color: 'success'
          });
          await toast.present();

          // Refresh and go home
          await refreshStorageStats();
          router.push('/home');
        }
      }
    ]
  });

  await alert.present();
};

const loginWithGoogle = () => {
  window.open('http://localhost:8080/auth/google/start', '_blank', 'noopener,noreferrer');
};

const loginWithMicrosoft = () => {
  window.open('http://localhost:8080/auth/microsoft/start', '_blank', 'noopener,noreferrer');
};
</script>

<style scoped>
.storage-stats {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 16px;
}

.stat-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.stat-row span {
  color: var(--ion-color-medium);
  font-size: 14px;
}

.stat-row strong {
  font-size: 16px;
}

.progress-bar {
  width: 100%;
  height: 8px;
  background: var(--ion-color-light);
  border-radius: 4px;
  overflow: hidden;
  margin-top: 16px;
}

.progress-fill {
  height: 100%;
  background: var(--ion-color-primary);
  transition: width 0.3s;
}

.progress-fill.warning {
  background: var(--ion-color-warning);
}

.progress-fill.danger {
  background: var(--ion-color-danger);
}

.progress-text {
  text-align: center;
  font-size: 12px;
  color: var(--ion-color-medium);
  margin-top: 4px;
}

.user-info {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 16px;
}

.info-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.info-row span {
  color: var(--ion-color-medium);
  font-size: 14px;
}

.info-row code {
  font-size: 12px;
  background: var(--ion-color-light);
  padding: 4px 8px;
  border-radius: 4px;
}

.mt-2 {
  margin-top: 8px;
}

.mt-3 {
  margin-top: 12px;
}
</style>