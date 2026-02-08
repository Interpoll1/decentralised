<template>
  <ion-card class="glass-card" :key="`chain-status-${chainStore.chainHead?.index || 0}`">
    <ion-card-header>
      <ion-card-title class="flex items-center justify-between">
        <span class="text-lg font-bold">Chain Status</span>
        <ion-badge 
          :color="chainStore.isWebSocketConnected ? 'success' : 'warning'"
          class="px-3 py-1 rounded-full text-[10px] uppercase tracking-wider"
          :key="`ws-${chainStore.isWebSocketConnected}`"
        >
          {{ chainStore.isWebSocketConnected ? 'Online' : 'Offline' }}
        </ion-badge>
      </ion-card-title>
    </ion-card-header>
    <ion-card-content>
      <div class="space-y-3">
        <div class="flex justify-between items-center">
          <span class="text-sm font-medium opacity-80">Network Mode:</span>
          <ion-badge color="primary">
            Hybrid P2P (WebSocket + Broadcast)
          </ion-badge>
        </div>

        <div class="flex justify-between items-center">
          <span class="text-sm font-medium opacity-80">WebSocket Status:</span>
          <div class="flex items-center gap-2">
            <div 
              class="w-2 h-2 rounded-full"
              :class="chainStore.isWebSocketConnected ? 'bg-green-500 animate-pulse' : 'bg-red-500'"
            ></div>
            <span class="text-xs font-semibold">
              {{ chainStore.isWebSocketConnected ? 'Online' : 'Local Only' }}
            </span>
          </div>
        </div>

        <div class="flex justify-between items-center">
          <span class="text-sm font-medium opacity-80">Chain Height:</span>
          <ion-badge :color="chainStore.chainValid ? 'success' : 'danger'">
            {{ chainStore.latestBlock?.index ?? 0 }} blocks
          </ion-badge>
        </div>

        <div class="flex justify-between items-center">
          <span class="text-sm font-medium opacity-80">Chain Valid:</span>
          <ion-icon 
            :icon="chainStore.chainValid ? checkmarkCircle : closeCircle"
            :color="chainStore.chainValid ? 'success' : 'danger'"
            size="large"
          ></ion-icon>
        </div>

        <div class="flex flex-col gap-1" v-if="chainStore.chainHead">
          <span class="text-sm font-medium opacity-80">Latest Hash:</span>
          <code class="text-[10px] font-mono opacity-70 bg-black/10 dark:bg-white/10 px-2 py-1 rounded break-all leading-relaxed select-all">
            {{ chainStore.chainHead.hash }}
          </code>
        </div>

        <div class="rounded p-3 mt-3 border border-primary/10 bg-primary/5">
          <p class="text-xs text-primary font-semibold">
            Hybrid P2P Network<br/>
            <span class="opacity-70 font-normal">Cross-Device &middot; Cross-Browser &middot; Persistent Storage</span>
          </p>
        </div>

        <ion-button 
          expand="block" 
          size="small"
          @click="handleValidateChain"
          :disabled="chainStore.isValidating"
          class="font-bold ion-margin-top shadow-sm"
        >
          <ion-icon slot="start" :icon="shield"></ion-icon>
          {{ chainStore.isValidating ? 'Validating...' : 'Validate Chain' }}
        </ion-button>

        <p class="text-[10px] text-center opacity-40 mt-4 mb-1 uppercase tracking-tight">Danger Zone</p>
        <ion-button
          expand="block"
          size="small"
          color="danger"
          fill="outline"
          @click="handleResetChain"
          class="opacity-80 hover:opacity-100 font-semibold"
        >
          <ion-icon slot="start" :icon="warningOutline"></ion-icon>
          Reset Local Chain
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
  IonIcon,
  alertController,
  toastController,
} from '@ionic/vue';
import { checkmarkCircle, closeCircle, shield, warningOutline } from 'ionicons/icons';
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

const handleResetChain = async () => {
  const alert = await alertController.create({
    header: 'Reset Local Chain',
    message:
      'This will clear all local blocks, votes, and receipts, then create a fresh genesis block. This cannot be undone.',
    buttons: [
      { text: 'Cancel', role: 'cancel' },
      {
        text: 'Reset',
        role: 'destructive',
        handler: async () => {
          await chainStore.resetChain();

          const toast = await toastController.create({
            message: 'Chain reset locally',
            duration: 2000,
            color: 'success',
          });
          await toast.present();
        },
      },
    ],
  });

  await alert.present();
};
</script>