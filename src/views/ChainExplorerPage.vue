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

    <ion-content>
      <div class="page-shell">
        <ion-card>
        <ion-card-header>
          <ion-card-title>Blockchain Blocks</ion-card-title>
          <ion-card-subtitle>
            Showing {{ visibleBlocks.length }} of {{ chainStore.blocks.length }} blocks
          </ion-card-subtitle>
        </ion-card-header>

        <ion-card-content>
          <div v-if="!chainStore.blocks.length" class="chain-empty">
            <p class="chain-empty-title">No blocks yet</p>
            <p class="chain-empty-sub">
              Your signed actions — votes, posts and receipts — appear here as they're recorded.
            </p>
          </div>
          <div v-else class="blocks-list">
            <div
              v-for="block in visibleBlocks"
              :key="block.index"
              class="block-item"
            >
              <div class="block-header">
                <div class="block-header-left">
                  <ion-badge color="primary">Block #{{ block.index }}</ion-badge>
                  <ion-badge
                    v-if="block.actionType"
                    :color="actionBadgeColor(block.actionType)"
                    class="action-badge"
                  >
                    {{ actionLabel(block.actionType) }}
                  </ion-badge>
                </div>
                <span class="block-timestamp">
                  {{ formatDate(block.timestamp) }}
                </span>
              </div>

              <div v-if="block.actionLabel" class="block-action-label">
                {{ block.actionLabel }}
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
                  <span class="hash-label">Data Hash:</span>
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

          <div v-if="hasMoreBlocks" class="load-more-row">
            <ion-button fill="outline" size="small" @click="loadMoreBlocks">
              Load {{ Math.min(LOAD_BATCH_SIZE, chainStore.blocks.length - visibleBlocks.length) }} more blocks
            </ion-button>
          </div>
        </ion-card-content>
      </ion-card>
      </div>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
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
  IonIcon,
  IonButton,
} from '@ionic/vue';
import {
  shieldCheckmarkOutline,
  alertCircleOutline,
  informationCircleOutline
} from 'ionicons/icons';
import { useChainStore } from '../stores/chainStore';
import { CryptoService } from '../services/cryptoService';

const chainStore = useChainStore();
const INITIAL_VISIBLE_BLOCKS = 75;
const LOAD_BATCH_SIZE = 75;
const visibleCount = ref(INITIAL_VISIBLE_BLOCKS);

const reversedBlocks = computed(() => {
  return [...chainStore.blocks].reverse();
});

const visibleBlocks = computed(() => reversedBlocks.value.slice(0, visibleCount.value));
const hasMoreBlocks = computed(() => visibleBlocks.value.length < chainStore.blocks.length);

const loadMoreBlocks = () => {
  visibleCount.value = Math.min(chainStore.blocks.length, visibleCount.value + LOAD_BATCH_SIZE);
};

watch(
  () => chainStore.blocks.length,
  (len) => {
    if (visibleCount.value > len) visibleCount.value = len;
    if (visibleCount.value === 0 && len > 0) {
      visibleCount.value = Math.min(INITIAL_VISIBLE_BLOCKS, len);
    }
  },
  { immediate: true },
);

// Verify Schnorr signatures for all blocks with pubkeys
const verificationStatus = ref<Record<number, boolean>>({});

watch(
  () => visibleBlocks.value,
  (blocks) => {
    const status = { ...verificationStatus.value };
    for (const block of blocks) {
      if (!block.pubkey || status[block.index] !== undefined) continue;
      const dataToVerify = JSON.stringify({
        index: block.index,
        voteHash: block.voteHash,
        previousHash: block.previousHash,
      });
      status[block.index] = CryptoService.verify(dataToVerify, block.signature, block.pubkey);
    }
    verificationStatus.value = status;
  },
  { immediate: true },
);

const fullHash = (hash: string) => {
  return hash || '';
};

const formatDate = (timestamp: number) => {
  return new Date(timestamp).toLocaleString();
};

const actionBadgeColor = (actionType: string) => {
  switch (actionType) {
    case 'community-create': return 'tertiary';
    case 'post-create': return 'success';
    case 'vote': return 'warning';
    default: return 'medium';
  }
};

const actionLabel = (actionType: string) => {
  switch (actionType) {
    case 'community-create': return 'Community';
    case 'post-create': return 'Post';
    case 'vote': return 'Vote';
    default: return actionType;
  }
};
</script>

<style scoped>
.chain-empty {
  text-align: center;
  padding: 32px 16px 24px;
}

.chain-empty-title {
  margin: 0 0 6px;
  font-weight: 600;
  color: var(--app-text);
}

.chain-empty-sub {
  margin: 0 auto;
  max-width: 320px;
  font-size: 13px;
  line-height: 1.5;
  color: var(--app-text-muted);
}

.blocks-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(420px, 1fr));
  gap: 12px;
  align-items: start;
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

.block-header-left {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.action-badge {
  font-size: 10px;
}

.block-action-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--ion-text-color);
  margin-bottom: 8px;
  padding: 0 2px;
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

.load-more-row {
  margin-top: 12px;
  display: flex;
  justify-content: center;
}
</style>
