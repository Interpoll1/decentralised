<template>
  <div id="name-recovery" class="nr">
    <div class="nr-head">
      <h3>Name recovery</h3>
      <p>Get your username back if you lose this device or key.</p>
    </div>

    <template v-if="username">
      <p v-if="loading" class="nr-muted">Checking <b>{{ username }}</b>…</p>

      <template v-else-if="st">
        <!-- someone is trying to take the name -->
        <div v-if="st.pendingAgainstMe" class="nr-alert">
          <strong>A recovery was requested for {{ st.username }}.</strong>
          <span>It moves to another key in {{ st.pendingAgainstMe.days }} {{ st.pendingAgainstMe.days === 1 ? 'day' : 'days' }} unless you cancel. If this isn't you, cancel now.</span>
          <button class="nr-btn nr-btn--danger" :disabled="busy" @click="cancelPending">Cancel recovery</button>
        </div>

        <!-- we requested it -->
        <div v-else-if="st.pendingForMe" class="nr-info">
          Recovery in progress: <b>{{ st.username }}</b> moves to this device in {{ st.pendingForMe.days }}
          {{ st.pendingForMe.days === 1 ? 'day' : 'days' }}.
        </div>

        <div v-if="st.conflict" class="nr-info nr-info--warn">
          Another key published a competing claim for <b>{{ st.username }}</b>. This device ignored it and kept the holder it already knew.
        </div>

        <!-- legacy unsigned claim -->
        <div v-if="st.legacyUnsigned" class="nr-row">
          <div><strong>Secure this name</strong><span>It was claimed before signed claims existed. Signing it protects it from takeover and makes it recoverable.</span></div>
          <button class="nr-btn nr-btn--primary" :disabled="busy" @click="secureLegacy">Sign my claim</button>
        </div>

        <div v-else-if="!st.isHolder && !st.pendingForMe && st.resolved.owner" class="nr-info">
          <b>{{ st.username }}</b> is held by a different key than this device's.
        </div>

        <template v-if="st.isHolder">
          <!-- recovery key -->
          <div class="nr-row">
            <div>
              <strong>Recovery key</strong>
              <span v-if="st.hasRecovery">Set. The name can be recovered with your name recovery phrase after a {{ lockDays }}-day waiting period.</span>
              <span v-else>Not set. If you lose this device, <b>{{ st.username }}</b> cannot be recovered.</span>
            </div>
            <button v-if="!st.hasRecovery || confirmReplace" class="nr-btn nr-btn--primary" :disabled="busy" @click="setupRecovery">
              {{ st.hasRecovery ? 'Replace recovery key' : 'Set up recovery' }}
            </button>
            <button v-else class="nr-btn" @click="confirmReplace = true">Replace…</button>
          </div>

          <!-- phrase shown once -->
          <div v-if="newPhrase.length" class="nr-phrase-box">
            <p><b>Your name recovery phrase.</b> This is shown once and is different from your identity phrase. Store it offline — it can take {{ st.resolved.username }} from you if someone else gets it.</p>
            <div class="nr-words"><span v-for="(w, i) in newPhrase" :key="i"><i>{{ i + 1 }}</i>{{ w }}</span></div>
            <div class="nr-actions">
              <button class="nr-btn" @click="copyPhrase">{{ copied ? 'Copied' : 'Copy' }}</button>
              <button class="nr-btn" @click="downloadPhrase">Download .txt</button>
            </div>
            <label class="nr-check"><input v-model="phraseAck" type="checkbox" /> <span>I saved my name recovery phrase</span></label>
            <button class="nr-btn nr-btn--primary" :disabled="!phraseAck" @click="newPhrase = []">Done</button>
          </div>

          <!-- verified name -->
          <div v-if="isVerified" class="nr-row">
            <div><strong>Verified certificate</strong><span>Renew or restore your verified badge on this key. Takes about 15 seconds.</span></div>
            <button class="nr-btn" :disabled="busy" @click="reissue">{{ reissuing ? `Working… ${nonce}` : 'Re-verify' }}</button>
          </div>

          <!-- key rotation -->
          <div class="nr-row">
            <div>
              <strong>Rotate key</strong>
              <span v-if="pendingKey && pendingKey.effectiveAt > now">New key ready in {{ hoursLeft }} h. Keep this browser until then.</span>
              <span v-else-if="pendingKey">New key is ready. Switch this device to it.</span>
              <span v-else>Use this if your key may be compromised. Announces a new key; it takes over after 24 hours.</span>
            </div>
            <button v-if="pendingKey && pendingKey.effectiveAt <= now" class="nr-btn nr-btn--primary" :disabled="busy" @click="activateKey">Switch to new key</button>
            <button v-else-if="!pendingKey" class="nr-btn" :disabled="busy" @click="rotateKey">Rotate key</button>
          </div>
        </template>
      </template>
      <p v-else class="nr-muted">Could not check this name right now.</p>
    </template>
    <p v-else class="nr-muted">Claim a username first, then you can set up recovery for it.</p>

    <p v-if="message" class="nr-ok">{{ message }}</p>
    <p v-if="error" class="nr-error">{{ error }}</p>

    <details class="nr-recover">
      <summary>I lost my key — recover a name</summary>
      <RecoverNameForm @started="onStarted" />
    </details>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import RecoverNameForm from './RecoverNameForm.vue';
import { NameRecoveryService, type NameStatus } from '../services/nameRecoveryService';
import { UserService } from '../services/userService';

const username = ref('');
const isVerified = ref(false);
const st = ref<NameStatus | null>(null);
const loading = ref(true);
const busy = ref(false);
const error = ref('');
const message = ref('');
const newPhrase = ref<string[]>([]);
const phraseAck = ref(false);
const copied = ref(false);
const confirmReplace = ref(false);
const reissuing = ref(false);
const nonce = ref(0);
const pendingKey = ref<{ publicKey: string; effectiveAt: number } | null>(null);
const now = ref(Date.now());

const lockDays = computed(() => Math.round((st.value?.resolved.recovery?.timelockMs ?? 0) / 86_400_000));
const hoursLeft = computed(() => Math.max(1, Math.ceil(((pendingKey.value?.effectiveAt ?? 0) - now.value) / 3_600_000)));

async function refresh() {
  loading.value = true;
  try {
    const me = await UserService.getCurrentUser();
    username.value = me.customUsername || '';
    isVerified.value = me.trustLevel === 'verified' || me.identityTrustLevel === 'trusted-issuer';
    if (username.value) {
      st.value = await NameRecoveryService.status(username.value);
      pendingKey.value = await NameRecoveryService.pendingRotationKey(username.value);
    }
  } catch { st.value = null; }
  now.value = Date.now();
  loading.value = false;
}

async function run(fn: () => Promise<void>) {
  busy.value = true; error.value = ''; message.value = '';
  try { await fn(); } catch (e: any) { error.value = e?.message || 'Something went wrong.'; }
  finally { busy.value = false; }
}

const setupRecovery = () => run(async () => {
  const { phrase } = await NameRecoveryService.setupRecovery(username.value);
  newPhrase.value = phrase.split(' ');
  phraseAck.value = false; confirmReplace.value = false;
  await refresh();
});
const cancelPending = () => run(async () => {
  const ok = await NameRecoveryService.cancelPending(username.value);
  message.value = ok ? 'Recovery cancelled.' : 'Could not cancel — try again.';
  await refresh();
});
const secureLegacy = () => run(async () => {
  const ok = await NameRecoveryService.secureLegacyName(username.value);
  message.value = ok ? 'Name secured.' : 'Could not sign the claim — check your connection.';
  await refresh();
});
const reissue = () => run(async () => {
  reissuing.value = true; nonce.value = 0;
  try { await NameRecoveryService.reissueVerified(username.value, n => { nonce.value = n; }); message.value = 'Verified certificate renewed.'; }
  finally { reissuing.value = false; }
});
const rotateKey = () => run(async () => {
  const r = await NameRecoveryService.startKeyRotation(username.value);
  message.value = `Rotation announced. Switch to the new key after ${new Date(r.effectiveAt).toLocaleString()}.`;
  await refresh();
});
const activateKey = () => run(async () => {
  await NameRecoveryService.activateRotatedKey(username.value);
  window.location.href = '/home';
});

async function copyPhrase() {
  try { await navigator.clipboard.writeText(newPhrase.value.join(' ')); copied.value = true; setTimeout(() => (copied.value = false), 2000); }
  catch { error.value = 'Clipboard is blocked — use Download instead.'; }
}
function downloadPhrase() {
  const blob = new Blob([`Interpoll NAME recovery phrase for "${username.value}"\n\n${newPhrase.value.join(' ')}\n\nKeep this offline. It can move your username to a new key.\n`], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `interpoll-name-recovery-${username.value}.txt`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function onStarted() { message.value = 'Recovery started — see the status above once it is visible on the network.'; void refresh(); }

onMounted(async () => {
  await refresh();
  if (window.location.hash === '#name-recovery') document.getElementById('name-recovery')?.scrollIntoView({ block: 'start' });
});
</script>

<style scoped>
.nr { display: flex; flex-direction: column; gap: 12px; font-family: 'Inter', system-ui, sans-serif; color: #fff; }
.nr-head h3 { margin: 0; font-size: 16px; font-weight: 500; }
.nr-head p { margin: 2px 0 0; font-size: 13px; color: #8c948c; }
.nr-muted { margin: 0; font-size: 13.5px; color: #8c948c; }
.nr-row { display: flex; justify-content: space-between; align-items: center; gap: 14px; padding: 12px; border: 1px solid #161a16; border-radius: 7px; }
.nr-row > div { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.nr-row strong { font-weight: 500; font-size: 14.5px; }
.nr-row span { font-size: 13px; line-height: 1.45; color: #b4bbb4; }
.nr-alert { display: flex; flex-direction: column; gap: 6px; padding: 12px; border: 1px solid #ff6b6b; border-radius: 7px; font-size: 13.5px; }
.nr-alert strong { color: #ff8a8a; font-weight: 500; }
.nr-info--warn { border-color: #ffd84a; color: #ffe27a; }
.nr-info { padding: 10px 12px; border: 1px solid #1d3a28; border-radius: 7px; font-size: 13.5px; color: #c9d1c9; }
.nr-btn { flex-shrink: 0; font: inherit; font-size: 13.5px; font-weight: 500; padding: 8px 14px; border-radius: 6px; cursor: pointer; color: #fff; background: #000; border: 1px solid #1d231d; align-self: flex-start; }
.nr-btn:hover { border-color: #3dff7a; }
.nr-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.nr-btn--primary { background: #3dff7a; border-color: #3dff7a; color: #000; }
.nr-btn--danger { background: #ff6b6b; border-color: #ff6b6b; color: #000; }
.nr-phrase-box { display: flex; flex-direction: column; gap: 10px; padding: 12px; border: 1px solid #ffd84a; border-radius: 7px; }
.nr-phrase-box p { margin: 0; font-size: 13.5px; line-height: 1.5; color: #e6e6e6; }
.nr-words { display: grid; grid-template-columns: repeat(auto-fill, minmax(112px, 1fr)); gap: 8px; }
.nr-words span { padding: 7px 9px; border: 1px solid #1d231d; border-radius: 5px; font: 13px var(--font-mono, monospace); color: #fff; }
.nr-words i { font-style: normal; color: #8c948c; margin-right: 8px; }
.nr-actions { display: flex; gap: 8px; }
.nr-check { display: flex; align-items: center; gap: 8px; font-size: 13.5px; }
.nr-check input { accent-color: #3dff7a; }
.nr-ok { margin: 0; font-size: 13.5px; color: #3dff7a; }
.nr-error { margin: 0; font-size: 13.5px; color: #ff8a8a; }
.nr-recover { border: 1px solid #161a16; border-radius: 7px; padding: 10px 12px; }
.nr-recover summary { cursor: pointer; font-size: 14px; color: #b4bbb4; }
.nr-recover[open] summary { margin-bottom: 12px; }
@media (max-width: 600px) { .nr-row { flex-direction: column; align-items: stretch; } }
</style>
