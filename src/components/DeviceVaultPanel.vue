<template>
  <div class="dv">
    <!-- ── BACKUP (Settings) ─────────────────────────────────────────── -->
    <template v-if="mode === 'backup'">
      <div class="dv-head">
        <span class="dv-label">{{ $ui("Survive a cache wipe") }}</span>
        <span class="dv-state" :class="{ ok: anchored }">{{ anchored ? $ui("Anchored to this device") : $ui("Only in browser storage") }}</span>
      </div>
      <p class="dv-note">{{ $ui("Clearing site data deletes your key. Anchor it outside the browser so it comes back with one tap.") }}</p>
      <p class="dv-note small">{{ $ui("Browser eviction protection:") }} <b>{{ persisted ? $ui("on") : $ui("off") }}</b></p>

      <div v-if="passkeyOk" class="dv-block">
        <strong>{{ $ui("Passkey") }}</strong>
        <p class="dv-note">{{ $ui("Face ID, fingerprint, Windows Hello or a security key. The vault is encrypted with a secret only your authenticator can produce, then replicated to relays.") }}</p>
        <p v-if="anchor" class="dv-note small">{{ $ui("Last synced") }} {{ new Date(anchor.lastSyncedAt).toLocaleString() }}</p>
        <div class="dv-actions">
          <button v-if="!anchor" class="dv-btn primary" :disabled="busy" @click="run(enroll)">{{ $ui("Create passkey") }}</button>
          <button v-else class="dv-btn" :disabled="busy" @click="run(resync)">{{ $ui("Sync now") }}</button>
        </div>
      </div>

      <div class="dv-block">
        <strong>{{ $ui("Device file") }}</strong>
        <p class="dv-note">{{ $ui("An encrypted file saved on your disk. Works offline and in every browser.") }}</p>
        <input v-model="passphrase" class="dv-input" type="password" autocomplete="new-password" :placeholder="$ui('Passphrase (8+ characters)')" />
        <div class="dv-actions">
          <button class="dv-btn" :disabled="busy || passphrase.length < 8" @click="run(saveFile)">{{ $ui("Save vault file") }}</button>
          <button v-if="fileLinked" class="dv-btn" :disabled="busy || passphrase.length < 8" @click="run(updateFile)">{{ $ui("Update linked file") }}</button>
        </div>
      </div>
    </template>

    <!-- ── RESTORE (onboarding / settings) ───────────────────────────── -->
    <template v-else>
      <button v-if="passkeyOk" class="dv-btn primary" :disabled="busy" @click="run(restorePasskey)">{{ busy ? $ui("Waiting for passkey…") : $ui("Restore with passkey") }}</button>
      <div class="dv-block">
        <strong>{{ $ui("Restore from vault file") }}</strong>
        <input ref="fileEl" class="dv-input" type="file" accept=".echovault,application/json" @change="pick" />
        <input v-model="passphrase" class="dv-input" type="password" autocomplete="current-password" :placeholder="$ui('Passphrase')" />
        <button class="dv-btn" :disabled="busy || !file || !passphrase" @click="run(restoreFile)">{{ $ui("Restore from file") }}</button>
      </div>
    </template>

    <p v-if="message" class="dv-msg">{{ message }}</p>
    <p v-if="error" class="dv-error">{{ error }}</p>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, computed } from 'vue';
import { DeviceVaultService } from '../services/deviceVaultService';

const props = withDefaults(defineProps<{ mode?: 'backup' | 'restore' }>(), { mode: 'backup' });
const emit = defineEmits<{ (e: 'restored', publicKey: string): void }>();

const passkeyOk = DeviceVaultService.passkeySupported();
const busy = ref(false);
const error = ref('');
const message = ref('');
const passphrase = ref('');
const persisted = ref(false);
const fileLinked = ref(false);
const anchor = ref<Awaited<ReturnType<typeof DeviceVaultService.getAnchor>>>(null);
const file = ref<File | null>(null);
const anchored = computed(() => !!anchor.value || fileLinked.value);

async function refresh() {
  if (props.mode !== 'backup') return;
  persisted.value = await DeviceVaultService.requestPersistence();
  anchor.value = await DeviceVaultService.getAnchor();
  fileLinked.value = await DeviceVaultService.hasLinkedFile();
}
onMounted(refresh);

async function run(fn: () => Promise<void>) {
  busy.value = true; error.value = ''; message.value = '';
  try { await fn(); await refresh(); }
  catch (e: any) {
    // NotAllowedError = user dismissed the OS prompt; AbortError = file picker cancelled.
    if (e?.name === 'NotAllowedError' || e?.name === 'AbortError') error.value = 'Cancelled.';
    else error.value = e?.message || 'Something went wrong.';
  } finally { busy.value = false; }
}

async function enroll() {
  let name = '';
  try { const { UserService } = await import('../services/userService'); const u = await UserService.getCurrentUser(); name = UserService.getDisplayUsername(u); } catch { /* fall back */ }
  await DeviceVaultService.enrollPasskey(name);
  message.value = 'Passkey created. After a wipe, choose "Restore with passkey".';
}
async function resync() { await DeviceVaultService.resyncPasskey(); message.value = 'Vault synced.'; }
async function saveFile() {
  const how = await DeviceVaultService.saveFile(passphrase.value);
  message.value = how === 'linked' ? 'Saved and linked. Keep the passphrase — it cannot be recovered.' : 'Downloaded. Move it somewhere safe and keep the passphrase.';
  passphrase.value = '';
}
async function updateFile() { await DeviceVaultService.updateLinkedFile(passphrase.value); message.value = 'Vault file updated.'; passphrase.value = ''; }
function pick(e: Event) { file.value = (e.target as HTMLInputElement).files?.[0] ?? null; }
async function restorePasskey() { const r = await DeviceVaultService.restoreWithPasskey(); emit('restored', r.publicKey); }
async function restoreFile() {
  if (!file.value) return;
  const r = await DeviceVaultService.restoreFromFile(file.value, passphrase.value);
  passphrase.value = '';
  emit('restored', r.publicKey);
}
</script>

<style scoped>
.dv { display: flex; flex-direction: column; gap: 10px; margin-top: 8px; font-family: 'Inter', system-ui, sans-serif; }
.dv-head { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
.dv-label { font-size: 13.5px; color: var(--app-text-muted); }
.dv-state { font-size: 12.5px; color: var(--app-warning); }
.dv-state.ok { color: var(--app-accent); }
.dv-note { margin: 0; font-size: 13px; line-height: 1.5; color: var(--app-text-muted); }
.dv-note.small { font-size: 12px; }
.dv-block { display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; border: 1px solid var(--app-border); border-radius: 6px; }
.dv-block strong { font-size: 13.5px; color: var(--app-text); }
.dv-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.dv-input { width: 100%; box-sizing: border-box; padding: 8px 10px; font: inherit; font-size: 13.5px; color: var(--app-text); background: var(--app-surface); border: 1px solid var(--app-border-strong, var(--app-border)); border-radius: 6px; }
.dv-btn { font: inherit; font-size: 13.5px; font-weight: 500; padding: 8px 14px; border-radius: 6px; cursor: pointer; color: var(--app-text); background: var(--app-surface); border: 1px solid var(--app-border); align-self: flex-start; }
.dv-btn.primary { background: var(--app-accent); color: var(--app-on-accent); border-color: var(--app-accent); }
.dv-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.dv-msg { margin: 0; font-size: 13px; color: var(--app-accent); }
.dv-error { margin: 0; font-size: 13px; color: var(--app-danger); }
</style>
