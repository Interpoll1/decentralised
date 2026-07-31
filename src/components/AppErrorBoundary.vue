<template>
  <slot v-if="!activeError" />
  <div v-else class="app-error" role="alert">
    <div class="app-error__card">
      <div class="app-error__icon" aria-hidden="true">⚠️</div>
      <h1 class="app-error__title">Something went wrong</h1>
      <p class="app-error__body">
        The app hit an unexpected error. Reloading usually fixes it. If it keeps
        happening, resetting local data clears cached content and starts fresh.
      </p>

      <div class="app-error__actions">
        <button class="app-error__btn app-error__btn--primary" @click="reload">
          Reload
        </button>
        <button class="app-error__btn" :disabled="resetting" @click="reset">
          {{ resetting ? 'Resetting…' : 'Reset local data' }}
        </button>
      </div>

      <details class="app-error__details">
        <summary>Technical details</summary>
        <pre class="app-error__pre">{{ detailsText }}</pre>
        <button class="app-error__btn app-error__btn--ghost" @click="copyDetails">
          {{ copied ? 'Copied' : 'Copy details' }}
        </button>
      </details>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onErrorCaptured, ref } from 'vue';
import {
  fatalError,
  getRecentErrors,
  resetLocalData,
  type AppErrorInfo,
} from '@/utils/errorReporting';

const localError = ref<AppErrorInfo | null>(null);
const resetting = ref(false);
const copied = ref(false);

const buildHash = (import.meta.env.VITE_BUILD_HASH as string) || 'dev';
const buildTime = (import.meta.env.VITE_BUILD_TIME as string) || 'unknown';

// A view thrown during render/lifecycle is caught here. Returning false stops
// the error from also reaching the global handler (avoids double-reporting).
onErrorCaptured((err) => {
  localError.value = {
    message: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
    source: 'vue:onErrorCaptured',
    time: Date.now(),
  };
  return false;
});

const activeError = computed(() => localError.value || fatalError.value);

const detailsText = computed(() => {
  const e = activeError.value;
  const recent = getRecentErrors()
    .slice(-6)
    .map((r) => `  [${r.source}] ${r.message}`)
    .join('\n');
  return [
    `build: ${buildHash} (${buildTime})`,
    `ua: ${navigator.userAgent}`,
    `source: ${e?.source ?? 'unknown'}`,
    `error: ${e?.message ?? 'unknown'}`,
    e?.stack ? `stack:\n${e.stack}` : '',
    recent ? `recent:\n${recent}` : '',
  ]
    .filter(Boolean)
    .join('\n');
});

function reload() {
  window.location.reload();
}

async function reset() {
  resetting.value = true;
  await resetLocalData();
  window.location.reload();
}

async function copyDetails() {
  try {
    await navigator.clipboard?.writeText(detailsText.value);
    copied.value = true;
    setTimeout(() => (copied.value = false), 2_000);
  } catch {
    /* clipboard unavailable — the text is selectable in the <pre> */
  }
}
</script>

<style scoped>
.app-error {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  padding-top: calc(env(safe-area-inset-top, 0px) + 24px);
  padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 24px);
  background: #141420;
  color: #e6e6ef;
  overflow-y: auto;
  z-index: 100000;
}

.app-error__card {
  width: min(100%, 460px);
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 16px;
  padding: 28px 24px;
  text-align: center;
}

.app-error__icon {
  font-size: 40px;
  line-height: 1;
  margin-bottom: 12px;
}

.app-error__title {
  font-size: 20px;
  font-weight: 600;
  margin: 0 0 8px;
}

.app-error__body {
  font-size: 14px;
  line-height: 1.5;
  color: #b7b7c8;
  margin: 0 0 20px;
}

.app-error__actions {
  display: flex;
  gap: 10px;
  justify-content: center;
  flex-wrap: wrap;
}

.app-error__btn {
  appearance: none;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(255, 255, 255, 0.06);
  color: inherit;
  font-size: 14px;
  font-weight: 500;
  padding: 10px 18px;
  border-radius: 10px;
  cursor: pointer;
  min-height: 44px;
}

.app-error__btn:disabled {
  opacity: 0.6;
  cursor: default;
}

.app-error__btn--primary {
  background: #5b5bff;
  border-color: #5b5bff;
  color: #fff;
}

.app-error__btn--ghost {
  margin-top: 10px;
  font-size: 13px;
  min-height: 36px;
  padding: 6px 14px;
}

.app-error__details {
  margin-top: 22px;
  text-align: left;
}

.app-error__details summary {
  cursor: pointer;
  font-size: 13px;
  color: #9a9ab0;
}

.app-error__pre {
  margin-top: 10px;
  max-height: 220px;
  overflow: auto;
  font-size: 11px;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
  background: rgba(0, 0, 0, 0.35);
  border-radius: 8px;
  padding: 10px;
  color: #c8c8d8;
}
</style>
