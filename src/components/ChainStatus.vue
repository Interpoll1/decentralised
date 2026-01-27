<template>
  <ion-card :key="`chain-status-${chainStore.chainHead?.index || 0}`">
    <ion-card-header>
      <ion-card-title class="flex items-center justify-between">
        <span>Chain Status</span>
        <ion-badge 
          :color="chainStore.isWebSocketConnected ? 'success' : 'warning'"
          :key="`ws-${chainStore.isWebSocketConnected}`"
        >
          {{ chainStore.isWebSocketConnected ? 'Connected' : 'Offline' }}
        </ion-badge>
      </ion-card-title>
    </ion-card-header>
    <ion-card-content>
      <div class="space-y-3">
        <div class="flex justify-between items-center">
          <span class="text-sm text-gray-600">Network Mode:</span>
          <ion-badge color="primary">
            Hybrid P2P (WebSocket + Broadcast)
          </ion-badge>
        </div>

        <div class="flex justify-between items-center">
          <span class="text-sm text-gray-600">WebSocket Status:</span>
          <div class="flex items-center gap-2">
            <div 
              class="w-2 h-2 rounded-full"
              :class="chainStore.isWebSocketConnected ? 'bg-green-500 animate-pulse' : 'bg-red-500'"
            ></div>
            <span class="text-xs">
              {{ chainStore.isWebSocketConnected ? 'Online' : 'Local Only' }}
            </span>
          </div>
        </div>

        <div class="flex justify-between items-center">
          <span class="text-sm text-gray-600">Chain Height:</span>
          <ion-badge :color="chainStore.chainValid ? 'success' : 'danger'">
            {{ chainStore.latestBlock?.index ?? 0 }} blocks
          </ion-badge>
        </div>

        <div class="flex justify-between items-center">
          <span class="text-sm text-gray-600">Chain Valid:</span>
          <ion-icon 
            :icon="chainStore.chainValid ? checkmarkCircle : closeCircle"
            :color="chainStore.chainValid ? 'success' : 'danger'"
            size="large"
          ></ion-icon>
        </div>

        <div class="flex justify-between items-center" v-if="chainStore.chainHead">
          <span class="text-sm text-gray-600">Latest Hash:</span>
          <code class="text-xs bg-gray-100 px-2 py-1 rounded">
            {{ truncateHash(chainStore.chainHead.hash) }}
          </code>
        </div>

        <div class="bg-blue-50 border border-blue-200 rounded p-2 mt-3">
          <p class="text-xs text-blue-800">
            🌐 <strong>Hybrid P2P Network</strong><br/>
            Cross-Device • Cross-Browser • Persistent Storage
          </p>
        </div>

        <ion-button 
          expand="block" 
          size="small"
          @click="handleValidateChain"
          :disabled="chainStore.isValidating"
        >
          <ion-icon slot="start" :icon="shield"></ion-icon>
          {{ chainStore.isValidating ? 'Validating...' : 'Validate Chain' }}
        </ion-button>
      </div>
    </ion-card-content>
  </ion-card>
</template>

<script setup lang="ts">
import { nextTick } from 'vue';
import { 
  IonCard, 
  IonCardHeader, 
  IonCardTitle, 
  IonCardContent,
  IonBadge,
  IonButton,
  IonIcon
} from '@ionic/vue';
import { checkmarkCircle, closeCircle, shield } from 'ionicons/icons';
import { useChainStore } from '../stores/chainStore';

const chainStore = useChainStore();

const truncateHash = (hash?: string) => {
  if (!hash) return 'N/A';
  return `${hash.substring(0, 8)}...${hash.substring(hash.length - 8)}`;
};

const handleValidateChain = async () => {
  await chainStore.validateChain();
  await nextTick();
};
</script>