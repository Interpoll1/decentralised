<template>
  <div class="rp">
    <div class="rp-head">
      <span class="rp-label">Recovery phrase</span>
      <span class="rp-state" :class="{ ok: saved }">{{ saved ? 'Marked as saved' : 'Not backed up yet' }}</span>
    </div>
    <p class="rp-note">24 words that restore this identity on any device. Anyone who has them can act as you — keep them offline.</p>

    <button v-if="!words.length" class="rp-btn" :disabled="busy" @click="reveal">{{ busy ? 'Loading…' : 'Show recovery phrase' }}</button>
    <template v-else>
      <div class="rp-words"><span v-for="(w, i) in words" :key="i"><i>{{ i + 1 }}</i>{{ w }}</span></div>
      <div class="rp-actions">
        <button class="rp-btn" @click="copy">{{ copied ? 'Copied' : 'Copy' }}</button>
        <button class="rp-btn" @click="download">Download .txt</button>
        <button class="rp-btn" @click="hide">Hide</button>
      </div>
    </template>

    <label class="rp-check">
      <input type="checkbox" :checked="saved" @change="setSaved(($event.target as HTMLInputElement).checked)" />
      <span>I've saved my recovery phrase somewhere safe</span>
    </label>
    <p v-if="error" class="rp-error">{{ error }}</p>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';

const SAVED_KEY = 'interpoll_phrase_saved';
const words = ref<string[]>([]);
const busy = ref(false);
const copied = ref(false);
const error = ref('');
const saved = ref(readSaved());

function readSaved(): boolean { try { return localStorage.getItem(SAVED_KEY) === 'true'; } catch { return false; } }
function setSaved(v: boolean) {
  saved.value = v;
  try { v ? localStorage.setItem(SAVED_KEY, 'true') : localStorage.removeItem(SAVED_KEY); } catch { /* private mode */ }
}

async function reveal() {
  busy.value = true; error.value = '';
  try {
    const { KeyService } = await import('../services/keyService');
    words.value = (await KeyService.exportMnemonic()).trim().split(/\s+/);
  } catch { error.value = 'Could not read the key on this device.'; }
  finally { busy.value = false; }
}
function hide() { words.value = []; }
async function copy() {
  try { await navigator.clipboard.writeText(words.value.join(' ')); copied.value = true; setTimeout(() => (copied.value = false), 2000); }
  catch { error.value = 'Clipboard is blocked — use Download instead.'; }
}
function download() {
  const blob = new Blob([`Interpoll recovery phrase\n\n${words.value.join(' ')}\n\nKeep this private. Anyone with it can act as you.\n`], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'interpoll-recovery-phrase.txt'; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
</script>

<style scoped>
.rp { display: flex; flex-direction: column; gap: 10px; margin-top: 4px; font-family: 'Inter', system-ui, sans-serif; }
.rp-head { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
.rp-label { font-size: 13.5px; color: var(--app-text-muted); }
.rp-state { font-size: 12.5px; color: var(--app-warning); }
.rp-state.ok { color: var(--app-accent); }
.rp-note { margin: 0; font-size: 13px; line-height: 1.5; color: var(--app-text-subtle); }
.rp-words { display: grid; grid-template-columns: repeat(auto-fill, minmax(112px, 1fr)); gap: 8px; }
.rp-words span { padding: 7px 9px; border: 1px solid var(--app-border); border-radius: 5px; font: 13px var(--font-mono, monospace); }
.rp-words i { font-style: normal; color: var(--app-text-subtle); margin-right: 8px; }
.rp-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.rp-btn { font: inherit; font-size: 13.5px; font-weight: 500; padding: 8px 14px; border-radius: 6px; cursor: pointer; color: var(--app-text); background: var(--app-item-surface); border: 1px solid var(--app-border); align-self: flex-start; }
.rp-btn:hover { border-color: var(--app-accent); }
.rp-check { display: flex; align-items: center; gap: 8px; font-size: 13.5px; color: var(--app-text-muted); cursor: pointer; }
.rp-check input { accent-color: var(--app-accent); }
.rp-error { margin: 0; font-size: 13px; color: var(--app-danger); }
</style>
