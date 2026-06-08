<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button default-href="/home"></ion-back-button>
        </ion-buttons>
        <ion-title>Network</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      <ion-card>
        <ion-card-header>
          <ion-card-title>P2P Network</ion-card-title>
        </ion-card-header>
        <ion-card-content>
          <p class="net-desc">
            InterPoll syncs peer-to-peer over GenosDB. Peers are discovered through
            decentralized Nostr signaling — there are no relay servers to configure
            or rotate. Connections form and heal automatically.
          </p>

          <div class="net-status">
            <ion-icon
              :icon="isConnected ? cloudDoneOutline : cloudOfflineOutline"
              :color="isConnected ? 'success' : 'medium'"
              class="net-status-icon"
            />
            <div>
              <p class="net-status-label">{{ isConnected ? 'Connected' : 'Connecting…' }}</p>
              <p class="net-status-sub">{{ peerCount }} peer{{ peerCount === 1 ? '' : 's' }} in this room</p>
            </div>
          </div>

          <ion-list v-if="peers.length" lines="full" class="net-peers">
            <ion-item v-for="peer in peers" :key="peer">
              <ion-icon :icon="personCircleOutline" slot="start" color="primary" />
              <ion-label class="net-peer-id">{{ peer }}</ion-label>
            </ion-item>
          </ion-list>
        </ion-card-content>
      </ion-card>

      <ion-card>
        <ion-card-header>
          <ion-card-title>Cellular Mesh</ion-card-title>
        </ion-card-header>
        <ion-card-content>
          <p class="net-desc">
            At scale, GenosRTC organises peers into a Cellular Mesh — cells with
            bridge nodes — reducing connections from O(N²) to O(N) so large
            communities stay fast without any central infrastructure.
          </p>
        </ion-card-content>
      </ion-card>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import {
  IonPage, IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton, IonContent,
  IonCard, IonCardHeader, IonCardTitle, IonCardContent, IonList, IonItem, IonLabel, IonIcon,
} from '@ionic/vue';
import { cloudDoneOutline, cloudOfflineOutline, personCircleOutline } from 'ionicons/icons';
import { getNetworkStats, getPeers } from '../services/gdbServices';

const isConnected = ref(false);
const peerCount = ref(0);
const peers = ref<string[]>([]);
let timer: ReturnType<typeof setInterval> | null = null;

function refresh() {
  const stats = getNetworkStats();
  isConnected.value = stats.isConnected;
  peerCount.value = stats.peerCount;
  peers.value = getPeers();
}

onMounted(() => {
  refresh();
  timer = setInterval(refresh, 3000);
});

onUnmounted(() => {
  if (timer) clearInterval(timer);
});
</script>

<style scoped>
.net-desc {
  font-size: 0.9rem;
  line-height: 1.5;
  color: var(--app-text-muted);
  margin: 0 0 16px;
}

.net-status {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px;
  border: 1px solid var(--app-border-strong);
  border-radius: var(--app-radius-md);
  background: var(--app-surface);
}

.net-status-icon {
  font-size: 32px;
}

.net-status-label {
  margin: 0;
  font-weight: 600;
  color: var(--app-text);
}

.net-status-sub {
  margin: 2px 0 0;
  font-size: 0.85rem;
  color: var(--app-text-subtle);
}

.net-peers {
  margin-top: 12px;
}

.net-peer-id {
  font-family: ui-monospace, monospace;
  font-size: 0.8rem;
}
</style>
