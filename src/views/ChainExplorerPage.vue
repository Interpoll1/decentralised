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
          <div class="blocks-list">
            <div
              v-for="block in reversedBlocks"
              :key="block.index"
              class="block-item"
            >
              <div class="block-header">
                <ion-badge color="primary">Block #{{ block.index }}</ion-badge>
                <span class="block-timestamp">
                  {{ formatDate(block.timestamp) }}
                </span>
              </div>

              <div class="block-hashes">
                <div class="hash-row">
                  <span class="hash-label">Previous Hash:</span>
                  <code class="hash-value">
                    {{ fullHash(block.previousHash) }}
                  </code>
                </div>

                <div class="hash-row">
                  <span class="hash-label">Current Hash:</span>
                  <code class="hash-value">
                    {{ fullHash(block.currentHash) }}
                  </code>
                </div>

                <div class="hash-row">
                  <span class="hash-label">Vote Hash:</span>
                  <code class="hash-value">
                    {{ fullHash(block.voteHash) }}
                  </code>
                </div>
              </div>

              <div class="block-validity">
                <ion-icon
                  :icon="checkmarkCircle"
                  color="success"
                  v-if="block.index > 0"
                ></ion-icon>
                <span class="validity-label">
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

const fullHash = (hash: string) => {
  return hash || '';
};

const formatDate = (timestamp: number) => {
  return new Date(timestamp).toLocaleString();
};
</script>

<style scoped>
.blocks-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.block-item {
  border: 1px solid var(--glass-border);
  border-top-color: var(--glass-border-top);
  border-radius: 14px;
  padding: 12px;
  background: rgba(var(--ion-card-background-rgb), 0.20);
  backdrop-filter: blur(14px) saturate(1.4);
  -webkit-backdrop-filter: blur(14px) saturate(1.4);
  box-shadow: var(--glass-highlight);
}

.block-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 8px;
}

.block-timestamp {
  font-size: 12px;
  color: var(--ion-color-medium);
}

.block-hashes {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
}

.hash-row {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.hash-label {
  color: var(--ion-color-medium);
}

.hash-value {
  display: block;
  background: rgba(var(--ion-card-background-rgb), 0.18);
  backdrop-filter: blur(12px) saturate(1.3);
  -webkit-backdrop-filter: blur(12px) saturate(1.3);
  border: 1px solid var(--glass-border);
  border-top-color: var(--glass-border-top);
  color: var(--ion-text-color);
  padding: 4px 8px;
  border-radius: 12px;
  margin-top: 2px;
  word-break: break-all;
  font-size: 12px;
  box-shadow: var(--glass-highlight);
}

.block-validity {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
}

.validity-label {
  font-size: 12px;
  color: var(--ion-color-medium);
}
</style>