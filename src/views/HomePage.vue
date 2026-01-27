<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-title>Communities</ion-title>
        <ion-buttons slot="end">
          <ion-button @click="$router.push('/profile')">
            <ion-icon :icon="personCircleOutline"></ion-icon>
          </ion-button>
          <ion-button @click="$router.push('/settings')">
            <ion-icon :icon="settingsOutline"></ion-icon>
          </ion-button>
          <ion-button @click="$router.push('/chain-explorer')">
            <ion-icon :icon="cube"></ion-icon>
          </ion-button>
        </ion-buttons>
      </ion-toolbar>

      <!-- Tab Bar -->
      <ion-toolbar>
        <ion-segment v-model="activeTab">
          <ion-segment-button value="home">
            <ion-label>Home</ion-label>
          </ion-segment-button>
          <ion-segment-button value="joined">
            <ion-label>Joined</ion-label>
          </ion-segment-button>
          <ion-segment-button value="all">
            <ion-label>All</ion-label>
          </ion-segment-button>
        </ion-segment>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <!-- Chain Status Card -->
      <ChainStatus />

      <!-- P2P Status Card -->
      <ion-card class="status-card">
        <ion-card-content>
          <div class="status-row">
            <div class="status-item">
              <ion-icon :icon="cloudOutline"></ion-icon>
              <div>
                <strong>Image Storage</strong>
                <p>{{ imageStatus }}</p>
              </div>
            </div>
            <div class="status-item">
              <ion-icon :icon="peopleOutline"></ion-icon>
              <div>
                <strong>GunDB Sync</strong>
                <p>{{ gunStatus }}</p>
              </div>
            </div>
          </div>
        </ion-card-content>
      </ion-card>

      <!-- Create Community Button -->
      <div class="ion-padding">
        <ion-button expand="block" @click="$router.push('/create-community')">
          <ion-icon slot="start" :icon="addCircleOutline"></ion-icon>
          Create Community
        </ion-button>
      </div>

      <!-- Loading -->
      <div v-if="communityStore.isLoading" class="loading-container">
        <ion-spinner></ion-spinner>
        <p>Loading communities...</p>
      </div>

      <!-- Communities List -->
      <div v-else-if="displayedCommunities.length > 0" class="communities-list ion-padding">
        <CommunityCard 
          v-for="community in displayedCommunities" 
          :key="community.id"
          :community="community"
          @click="$router.push(`/community/${community.id}`)"
        />
      </div>

      <!-- Empty State -->
      <div v-else class="empty-state">
        <ion-icon :icon="earthOutline" size="large"></ion-icon>
        <p>No communities yet</p>
        <ion-button @click="$router.push('/create-community')">
          Create the first one!
        </ion-button>
      </div>
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
  IonButton,
  IonIcon,
  IonCard,
  IonCardContent,
  IonSegment,
  IonSegmentButton,
  IonLabel,
  IonSpinner
} from '@ionic/vue';
import { 
  cube, 
  personCircleOutline, 
  settingsOutline,
  addCircleOutline,
  earthOutline,
  cloudOutline,
  peopleOutline
} from 'ionicons/icons';
import { useChainStore } from '../stores/chainStore';
import { useCommunityStore } from '../stores/communityStore';
import ChainStatus from '../components/ChainStatus.vue';
import CommunityCard from '../components/CommunityCard.vue';

const chainStore = useChainStore();
const communityStore = useCommunityStore();

const activeTab = ref('home');
const imageStatus = ref('Ready');
const gunStatus = ref('Initializing...');

const displayedCommunities = computed(() => {
  if (activeTab.value === 'joined') {
    return communityStore.communities.filter(c => 
      communityStore.isJoined(c.id)
    );
  }
  return communityStore.communities;
});

onMounted(async () => {
  // Initialize chain
  await chainStore.initialize();
  
  // Load communities
  await communityStore.loadCommunities();

  // Update P2P status
  imageStatus.value = 'Active (GunDB)';
  gunStatus.value = 'Connected';
});
</script>

<style scoped>
.status-card {
  margin: 8px 16px;
}

.status-row {
  display: flex;
  gap: 24px;
}

.status-item {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
}

.status-item ion-icon {
  font-size: 32px;
  color: var(--ion-color-primary);
}

.status-item strong {
  display: block;
  font-size: 14px;
}

.status-item p {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--ion-color-medium);
}

.communities-list {
  display: grid;
  gap: 12px;
}

.loading-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px;
  gap: 16px;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px;
  gap: 16px;
  color: var(--ion-color-medium);
}

.empty-state ion-icon {
  font-size: 64px;
  opacity: 0.5;
}
</style>