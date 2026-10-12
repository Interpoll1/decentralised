<template>
  <form class="rn" @submit.prevent="submit">
    <p class="rn-note">
      Lost your key? Enter your username and the <b>name recovery phrase</b> you saved when you set up recovery
      (not your identity phrase). The name moves to this device after a waiting period, and the current holder can cancel it.
    </p>
    <label class="rn-label" for="rn-name">Username</label>
    <input id="rn-name" v-model="username" class="rn-input" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="your-name" />
    <label class="rn-label" for="rn-phrase">Name recovery phrase (24 words)</label>
    <textarea id="rn-phrase" v-model="phrase" class="rn-input" rows="3" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="word1 word2 word3 …" />
    <p class="rn-count" :class="{ ok: wordCount === 24 }">{{ wordCount }} / 24 words</p>
    <p v-if="error" class="rn-error">{{ error }}</p>
    <p v-if="done" class="rn-ok">
      Recovery started. {{ done.days }} {{ done.days === 1 ? 'day' : 'days' }} until <b>{{ username.trim().toLowerCase() }}</b> moves to this device.
      The current holder can cancel it until then.
    </p>
    <button class="rn-btn" type="submit" :disabled="busy || !username.trim() || wordCount !== 24 || !!done">
      {{ busy ? 'Starting…' : 'Start recovery' }}
    </button>
  </form>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { NameRecoveryService } from '../services/nameRecoveryService';

const emit = defineEmits<{ (e: 'started', info: { username: string; days: number }): void }>();

const username = ref('');
const phrase = ref('');
const busy = ref(false);
const error = ref('');
const done = ref<{ days: number } | null>(null);
const wordCount = computed(() => phrase.value.trim().split(/\s+/).filter(Boolean).length);

async function submit() {
  error.value = '';
  busy.value = true;
  try {
    const st = await NameRecoveryService.requestRecovery(username.value, phrase.value);
    const days = st.pendingForMe?.days ?? 14;
    done.value = { days };
    phrase.value = '';
    emit('started', { username: st.username, days });
  } catch (e: any) {
    error.value = e?.message || 'Could not start the recovery.';
  } finally { busy.value = false; }
}
</script>

<style scoped>
.rn { display: flex; flex-direction: column; gap: 10px; font-family: 'Inter', system-ui, sans-serif; }
.rn-note { margin: 0; font-size: 13.5px; line-height: 1.5; color: #b4bbb4; }
.rn-label { font-size: 13.5px; color: #b4bbb4; }
.rn-input { width: 100%; box-sizing: border-box; padding: 10px 12px; font: 14px var(--font-mono, monospace); color: #fff; background: #000; border: 1px solid #1d231d; border-radius: 6px; outline: none; resize: vertical; }
.rn-input:focus { border-color: #3dff7a; }
.rn-count { margin: 0; font-size: 12.5px; color: #8c948c; }
.rn-count.ok { color: #3dff7a; }
.rn-error { margin: 0; font-size: 13.5px; color: #ff8a8a; }
.rn-ok { margin: 0; font-size: 13.5px; line-height: 1.5; color: #3dff7a; }
.rn-btn { align-self: flex-start; font: inherit; font-size: 14px; font-weight: 500; padding: 9px 16px; border-radius: 6px; cursor: pointer; background: #3dff7a; color: #000; border: 1px solid #3dff7a; }
.rn-btn:disabled { opacity: 0.35; cursor: not-allowed; }
</style>
