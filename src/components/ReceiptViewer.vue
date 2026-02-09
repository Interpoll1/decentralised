<template>
  <ion-card v-if="receipt">
    <ion-card-header>
      <ion-card-title class="flex items-center gap-2">
        <ion-icon :icon="documentText" color="primary"></ion-icon>
        Vote Receipt
      </ion-card-title>
    </ion-card-header>

    <ion-card-content>
      <div class="space-y-4">
        <div>
          <p class="text-xs text-gray-500 mb-1">Block Index</p>
          <ion-badge color="primary" class="text-base">
            #{{ receipt.blockIndex }}
          </ion-badge>
        </div>

        <div>
          <p class="text-xs text-gray-500 mb-1">Vote Hash</p>
          <code class="receipt-hash">
            {{ receipt.voteHash }}
          </code>
        </div>

        <div>
          <p class="text-xs text-gray-500 mb-1">Chain Head Hash</p>
          <code class="receipt-hash">
            {{ receipt.chainHeadHash }}
          </code>
        </div>

        <div>
          <p class="text-xs text-gray-500 mb-1">Timestamp</p>
          <p class="text-sm">{{ formatDate(receipt.timestamp) }}</p>
        </div>

        <div class="mnemonic-box">
          <p class="text-xs font-semibold mb-2">
            Your 12-Word Recovery Phrase
          </p>
          <div class="grid grid-cols-3 gap-2">
            <div
              v-for="(word, index) in mnemonicWords"
              :key="index"
              class="mnemonic-word"
            >
              <span class="opacity-50">{{ index + 1 }}.</span>
              <span class="font-mono font-semibold ml-1">{{ word }}</span>
            </div>
          </div>
          <p class="text-xs opacity-70 mt-2">
            Save these words securely. You'll need them to verify your vote.
          </p>
        </div>

        <div class="flex gap-2">
          <ion-button expand="block" @click="copyMnemonic">
            <ion-icon slot="start" :icon="copy"></ion-icon>
            Copy Words
          </ion-button>
          
          <ion-button expand="block" fill="outline" @click="shareReceipt">
            <ion-icon slot="start" :icon="shareSocial"></ion-icon>
            Share
          </ion-button>
        </div>
      </div>
    </ion-card-content>
  </ion-card>

  <ion-card v-else>
    <ion-card-content>
      <p class="text-center text-gray-500">No receipt found</p>
    </ion-card-content>
  </ion-card>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import {
  IonCard,
  IonCardHeader,
  IonCardTitle,
  IonCardContent,
  IonBadge,
  IonButton,
  IonIcon,
  toastController
} from '@ionic/vue';
import { documentText, copy, shareSocial } from 'ionicons/icons';
import { Receipt } from '../types/chain';

const props = defineProps<{
  receipt: Receipt | null;
}>();

const mnemonicWords = computed(() => {
  return props.receipt?.mnemonic.split(' ') || [];
});

const formatDate = (timestamp: number) => {
  return new Date(timestamp).toLocaleString();
};

const copyMnemonic = async () => {
  if (!props.receipt) return;

  try {
    await navigator.clipboard.writeText(props.receipt.mnemonic);
    
    const toast = await toastController.create({
      message: 'Recovery phrase copied to clipboard',
      duration: 2000,
      color: 'success',
      position: 'bottom'
    });
    
    await toast.present();
  } catch (error) {
    console.error('Failed to copy:', error);
    
    const toast = await toastController.create({
      message: 'Failed to copy to clipboard',
      duration: 2000,
      color: 'danger',
      position: 'bottom'
    });
    
    await toast.present();
  }
};

const shareReceipt = async () => {
  if (!props.receipt) return;

  const text = `My Vote Receipt\nBlock: #${props.receipt.blockIndex}\nRecovery Phrase: ${props.receipt.mnemonic}`;

  try {
    if (navigator.share) {
      await navigator.share({ text });
    } else {
      await copyMnemonic();
    }
  } catch (error) {
    console.error('Failed to share:', error);
  }
};
</script>

<style scoped>
.receipt-hash {
  display: block;
  font-size: 12px;
  background: rgba(var(--ion-card-background-rgb), 0.18);
  backdrop-filter: blur(12px) saturate(1.4);
  -webkit-backdrop-filter: blur(12px) saturate(1.4);
  border: 1px solid var(--glass-border);
  border-top-color: var(--glass-border-top);
  padding: 8px 10px;
  border-radius: 12px;
  word-break: break-all;
  font-family: monospace;
  box-shadow: var(--glass-highlight);
}

.mnemonic-box {
  padding: 16px;
  background: rgba(var(--ion-color-warning-rgb), 0.05);
  border: 1px solid rgba(var(--ion-color-warning-rgb), 0.12);
  border-top-color: rgba(var(--ion-color-warning-rgb), 0.20);
  border-radius: 16px;
  backdrop-filter: blur(14px) saturate(1.5);
  -webkit-backdrop-filter: blur(14px) saturate(1.5);
  color: var(--ion-color-warning);
  box-shadow: var(--glass-inner-glow);
}

.mnemonic-word {
  background: rgba(var(--ion-card-background-rgb), 0.22);
  backdrop-filter: blur(10px) saturate(1.3);
  -webkit-backdrop-filter: blur(10px) saturate(1.3);
  border: 1px solid var(--glass-border);
  border-top-color: var(--glass-border-top);
  padding: 6px 8px;
  border-radius: 12px;
  font-size: 12px;
  text-align: center;
  color: var(--ion-text-color);
  box-shadow: var(--glass-highlight);
}
</style>