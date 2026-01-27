<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button default-href="/home"></ion-back-button>
        </ion-buttons>
        <ion-title>Chain Explorer</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      <ion-card>
        <ion-card-header>
          <ion-card-title>Blockchain Blocks</ion-card-title>
          <ion-card-subtitle>
            Total: {{ chainStore.blocks.length }} blocks
          </ion-card-subtitle>
        </ion-card-header>

        <ion-card-content>
          <div class="space-y-3">
            <div
              v-for="block in reversedBlocks"
              :key="block.index"
              class="border border-gray-200 rounded p-3 bg-gray-50"
            >
              <div class="flex justify-between items-start mb-2">
                <ion-badge color="primary">Block #{{ block.index }}</ion-badge>
                <span class="text-xs text-gray-500">
                  {{ formatDate(block.timestamp) }}
                </span>
              </div>

              <div class="space-y-1 text-xs">
                <div>
                  <span class="text-gray-600">Previous Hash:</span>
                  <code class="block bg-white px-2 py-1 rounded mt-1 break-all">
                    {{ truncateHash(block.previousHash) }}
                  </code>
                </div>

                <div>
                  <span class="text-gray-600">Current Hash:</span>
                  <code class="block bg-white px-2 py-1 rounded mt-1 break-all">
                    {{ truncateHash(block.currentHash) }}
                  </code>
                </div>

                <div>
                  <span class="text-gray-600">Vote Hash:</span>
                  <code class="block bg-white px-2 py-1 rounded mt-1 break-all">
                    {{ truncateHash(block.voteHash) }}
                  </code>
                </div>
              </div>

              <div class="mt-2 flex gap-2">
                <ion-icon
                  :icon="checkmarkCircle"
                  color="success"
                  v-if="block.index > 0"
                ></ion-icon>
                <span class="text-xs text-gray-600">
                  {{ block.index === 0 ? 'Genesis Block' : 'Valid' }}
                </span>
              </div>
            </div>
          </div>
        </ion-card-content>
      </ion-card>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { computed } from 'vue';
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
  IonBadge,
  IonIcon
} from '@ionic/vue';
import { checkmarkCircle } from 'ionicons/icons';
import { useChainStore } from '../stores/chainStore';

const chainStore = useChainStore();

const reversedBlocks = computed(() => {
  return [...chainStore.blocks].reverse();
});

const truncateHash = (hash: string) => {
  if (hash.length <= 20) return hash;
  return `${hash.substring(0, 10)}...${hash.substring(hash.length - 10)}`;
};

const formatDate = (timestamp: number) => {
  return new Date(timestamp).toLocaleString();
};
</script>