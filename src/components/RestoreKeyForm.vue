<template>
  <form class="rk" @submit.prevent="submit">
    <label class="rk-label" for="rk-phrase">Recovery phrase (24 words)</label>
    <textarea
      id="rk-phrase" v-model="phrase" class="rk-input" rows="4" spellcheck="false"
      autocomplete="off" autocapitalize="off" placeholder="word1 word2 word3 …"
    />
    <p class="rk-count" :class="{ ok: wordCount === 24 }">{{ wordCount }} / 24 words</p>
    <p v-if="warnReplace" class="rk-warn">
      This replaces the identity on this device. If you haven't saved the current phrase, that identity is lost.
    </p>
    <label v-if="warnReplace" class="rk-check">
      <input v-model="confirmed" type="checkbox" /> <span>I understand</span>
    </label>
    <p v-if="error" class="rk-error">{{ error }}</p>
    <button class="rk-btn" type="submit" :disabled="busy || wordCount !== 24 || (warnReplace && !confirmed)">
      {{ busy ? 'Restoring…' : 'Restore identity' }}
    </button>
  </form>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { IdentityRestoreService } from '../services/identityRestoreService';

withDefaults(defineProps<{ warnReplace?: boolean }>(), { warnReplace: true });
const emit = defineEmits<{ (e: 'restored', publicKey: string): void }>();

const phrase = ref('');
const confirmed = ref(false);
const busy = ref(false);
const error = ref('');
const wordCount = computed(() => phrase.value.trim().split(/\s+/).filter(Boolean).length);

async function submit() {
  error.value = IdentityRestoreService.validate(phrase.value) ?? '';
  if (error.value) return;
  busy.value = true;
  try {
    const { publicKey } = await IdentityRestoreService.restore(phrase.value);
    phrase.value = '';
    emit('restored', publicKey);
  } catch (e: any) {
    error.value = e?.message || 'Could not restore the identity.';
  } finally { busy.value = false; }
}
</script>

<style scoped>
.rk { display: flex; flex-direction: column; gap: 10px; font-family: 'Inter', system-ui, sans-serif; }
.rk-label { font-size: 13.5px; color: #a3aaa3; }
.rk-input { width: 100%; box-sizing: border-box; resize: vertical; padding: 10px 12px; font: 13.5px var(--font-mono, monospace); color: #fff; background: #050605; border: 1px solid #2a312a; border-radius: 6px; outline: none; }
.rk-input:focus { border-color: #3dff7a; }
.rk-count { margin: 0; font-size: 12.5px; color: #6b736b; }
.rk-count.ok { color: #3dff7a; }
.rk-warn { margin: 0; font-size: 13px; color: #ffd84a; line-height: 1.45; }
.rk-check { display: flex; align-items: center; gap: 8px; font-size: 13.5px; color: #c9d1c9; }
.rk-check input { accent-color: #3dff7a; }
.rk-error { margin: 0; font-size: 13.5px; color: #ff8a8a; }
.rk-btn { align-self: flex-start; font: inherit; font-size: 14px; font-weight: 500; padding: 9px 16px; border-radius: 6px; cursor: pointer; background: #3dff7a; color: #000; border: 1px solid #3dff7a; }
.rk-btn:disabled { opacity: 0.35; cursor: not-allowed; }
</style>
