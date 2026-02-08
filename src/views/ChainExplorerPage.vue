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

                <div class="hash-row" v-if="block.pubkey">
                  <span class="hash-label">Signer:</span>
                  <code class="hash-value signer-value">
                    {{ block.pubkey }}
                  </code>
                </div>

                <div class="hash-row">
                  <span class="hash-label">Signature:</span>
                  <code class="hash-value">
                    {{ fullHash(block.signature) }}
                  </code>
                </div>
              </div>

              <div class="block-validity">
                <template v-if="block.index === 0">
                  <ion-icon :icon="shieldCheckmarkOutline" color="primary"></ion-icon>
                  <span class="validity-label">Genesis Block</span>
                </template>
                <template v-else-if="block.pubkey">
                  <ion-icon
                    :icon="verificationStatus[block.index] ? shieldCheckmarkOutline : alertCircleOutline"
                    :color="verificationStatus[block.index] ? 'success' : 'danger'"
                  ></ion-icon>
                  <span class="validity-label" :class="verificationStatus[block.index] ? 'sig-verified' : 'sig-invalid'">
                    {{ verificationStatus[block.index] ? 'Schnorr Verified' : 'Signature Invalid' }}
                  </span>
                </template>
                <template v-else>
                  <ion-icon :icon="informationCircleOutline" color="medium"></ion-icon>
                  <span class="validity-label">Legacy (no signature)</span>
                </template>
              </div>
            </div>
          </div>
        </ion-card-content>
      </ion-card>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { computed, ref, watchEffect } from 'vue';
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
import {
  shieldCheckmarkOutline,
  alertCircleOutline,
  informationCircleOutline
} from 'ionicons/icons';
import { useChainStore } from '../stores/chainStore';
import { CryptoService } from '../services/cryptoService';

const chainStore = useChainStore();

const reversedBlocks = computed(() => {
  return [...chainStore.blocks].reverse();
});

// Verify Schnorr signatures for all blocks with pubkeys
const verificationStatus = ref<Record<number, boolean>>({});

watchEffect(() => {
  const status: Record<number, boolean> = {};
  for (const block of chainStore.blocks) {
    if (block.pubkey) {
      const dataToVerify = JSON.stringify({
        index: block.index,
        voteHash: block.voteHash,
        previousHash: block.previousHash,
      });
      status[block.index] = CryptoService.verify(dataToVerify, block.signature, block.pubkey);
    }
  }
  verificationStatus.value = status;
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

.signer-value {
  border-color: rgba(var(--ion-color-primary-rgb), 0.3);
  background: rgba(var(--ion-color-primary-rgb), 0.04);
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

.sig-verified {
  color: var(--ion-color-success);
  font-weight: 600;
}

.sig-invalid {
  color: var(--ion-color-danger);
  font-weight: 600;
}
</style>
