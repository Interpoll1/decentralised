<template>
  <div v-if="!accepted" class="consent-overlay" role="dialog" aria-modal="true" aria-labelledby="consent-title">
    <div class="consent-banner">
      <div class="consent-icon" aria-hidden="true">⚠️</div>
      <h2 id="consent-title" class="consent-title">Before you continue</h2>
      <div class="consent-body">
        <p>
          <strong>InterPoll is fully decentralised.</strong> All posts, polls,
          and community data are stored directly on your device. There is no
          central server moderating content.
        </p>
        <p>
          Because content is user-generated and replicated peer-to-peer,
          <strong>you may encounter material that is offensive, inaccurate, or
          illegal in your jurisdiction.</strong> InterPoll cannot filter or
          remove such content before it reaches your device.
        </p>
        <p>
          By continuing you acknowledge that you understand these risks and
          accept that data will be stored locally on your device.
        </p>
      </div>
      <button ref="acceptBtn" class="consent-accept" @click="accept">
        I understand — continue
      </button>
    </div>
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
.consent-overlay {
  position: fixed;
  inset: 0;
  z-index: 99999;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.65);
  backdrop-filter: blur(4px);
  padding: 1rem;
}

.consent-banner {
  max-width: 460px;
  width: 100%;
  background: #ffffff;
  border-radius: 16px;
  padding: 2rem 1.5rem 1.5rem;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.25);
  text-align: center;
}

html.dark .consent-banner {
  background: #1e1e1e;
  color: #e0e0e0;
}

.consent-icon {
  font-size: 2.5rem;
  margin-bottom: 0.5rem;
}

.consent-title {
  margin: 0 0 1rem;
  font-size: 1.25rem;
  font-weight: 700;
}

.consent-body {
  text-align: left;
  font-size: 0.9rem;
  line-height: 1.5;
}

.consent-body p {
  margin: 0 0 0.75rem;
}

.consent-body p:last-child {
  margin-bottom: 0;
}

.consent-accept {
  margin-top: 1.25rem;
  width: 100%;
  padding: 0.75rem 1rem;
  font-size: 1rem;
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
</style>
