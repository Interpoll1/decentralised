<template>
  <div v-if="!accepted" class="consent-inline" role="note" aria-labelledby="consent-title">
    <div class="consent-copy">
      <p id="consent-title" class="consent-title">Decentralized network notice</p>
      <p class="consent-body">
        InterPoll stores data locally and syncs peer-to-peer, so content may be unmoderated and subject to your local laws.
      </p>
    </div>
    <button ref="acceptBtn" class="consent-accept" @click="accept">Got it</button>
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick, watch } from 'vue';

const STORAGE_KEY = 'interpoll_consent_accepted';

function readConsent(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeConsent(): void {
  try {
    localStorage.setItem(STORAGE_KEY, '1');
  } catch {
    // user will see the banner again next visit
  }
}

const accepted = ref(readConsent());
const acceptBtn = ref<HTMLButtonElement | null>(null);

watch(accepted, (val) => {
  if (!val) {
    nextTick(() => acceptBtn.value?.focus());
  }
}, { immediate: true });

function accept() {
  writeConsent();
  accepted.value = true;
}
</script>

<style scoped>
.consent-inline {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: 8px 0 12px;
  padding: 10px 12px;
  border-radius: 12px;
  background: rgba(var(--ion-color-warning-rgb), 0.1);
  border: 1px solid rgba(var(--ion-color-warning-rgb), 0.18);
}

.consent-title {
  margin: 0 0 4px;
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.consent-body {
  margin: 0;
  font-size: 13px;
  line-height: 1.45;
  color: var(--ion-color-step-600);
}

.consent-accept {
  flex-shrink: 0;
  padding: 0.55rem 0.85rem;
  font-size: 0.85rem;
  font-weight: 600;
  color: #fff;
  background: var(--ion-color-primary, #3880ff);
  border: none;
  border-radius: 10px;
  cursor: pointer;
  transition: background 0.15s;
}

.consent-accept:hover {
  background: var(--ion-color-primary-shade, #3171e0);
}

.consent-accept:active {
  transform: scale(0.98);
}

@media (min-width: 769px) {
  .consent-inline {
    display: none;
  }
}
</style>
