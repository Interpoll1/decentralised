<template>
  <div id="name-recovery" class="nr">
    <div class="nr-head">
      <h3>{{ $ui("Name recovery") }}</h3>
      <p>{{ $ui("Get your username back if you lose this device or key.") }}</p>
    </div>

    <template v-if="username">
      <p v-if="loading" class="nr-muted">{{ $ui("Checking") }} <b>{{ username }}</b>…</p>

      <template v-else-if="st">
        <!-- someone is trying to take the name -->
        <div v-if="st.pendingAgainstMe" class="nr-alert">
          <strong>{{ $ui("A recovery was requested for") }} {{ st.username }}.</strong>
          <span>{{ $ui("It moves to another key in") }} {{ st.pendingAgainstMe.days }} {{ st.pendingAgainstMe.days === 1 ? 'day' : 'days' }} {{ $ui("unless you cancel. If this isn't you, cancel now.") }}</span>
          <button class="nr-btn nr-btn--danger" :disabled="busy" @click="cancelPending">{{ $ui("Cancel recovery") }}</button>
        </div>

        <!-- we requested it -->
        <div v-else-if="st.pendingForMe" class="nr-info"> {{ $ui("Recovery in progress:") }} <b>{{ st.username }}</b> {{ $ui("moves to this device in") }} {{ st.pendingForMe.days }}
          {{ st.pendingForMe.days === 1 ? 'day' : 'days' }}.
        </div>

        <div v-if="st.conflict" class="nr-info nr-info--warn"> {{ $ui("Another key published a competing claim for") }} <b>{{ st.username }}</b>{{ $ui(". This device ignored it and kept the holder it already knew.") }} </div>

        <!-- legacy unsigned claim -->
        <div v-if="st.legacyUnsigned" class="nr-row">
          <div><strong>{{ $ui("Secure this name") }}</strong><span>{{ $ui("It was claimed before signed claims existed. Signing it protects it from takeover and makes it recoverable.") }}</span></div>
          <button class="nr-btn nr-btn--primary" :disabled="busy" @click="secureLegacy">{{ $ui("Sign my claim") }}</button>
        </div>

        <div v-else-if="!st.isHolder && !st.pendingForMe && st.resolved.owner" class="nr-info">
          <b>{{ st.username }}</b> {{ $ui("is held by a different key than this device's.") }} </div>

        <template v-if="st.isHolder">
          <!-- recovery key -->
          <div class="nr-row">
            <div>
              <strong>{{ $ui("Recovery key") }}</strong>
              <span v-if="st.hasRecovery">{{ $ui("Set. The name can be recovered with your name recovery phrase after a") }} {{ lockDays }}{{ $ui("-day waiting period.") }}</span>
              <span v-else>{{ $ui("Not set. If you lose this device,") }} <b>{{ st.username }}</b> {{ $ui("cannot be recovered.") }}</span>
            </div>
            <button v-if="!st.hasRecovery || confirmReplace" class="nr-btn nr-btn--primary" :disabled="busy" @click="setupRecovery">
              {{ st.hasRecovery ? $ui("Replace recovery key") : $ui("Set up recovery") }}
            </button>
            <button v-else class="nr-btn" @click="confirmReplace = true">{{ $ui("Replace…") }}</button>
          </div>

          <!-- phrase shown once -->
          <div v-if="newPhrase.length" class="nr-phrase-box">
            <p><b>{{ $ui("Your name recovery phrase.") }}</b> {{ $ui("This is shown once and is different from your identity phrase. Store it offline — it can take") }} {{ st.resolved.username }} {{ $ui("from you if someone else gets it.") }}</p>
            <div class="nr-words"><span v-for="(w, i) in newPhrase" :key="i"><i>{{ i + 1 }}</i>{{ w }}</span></div>
            <div class="nr-actions">
              <button class="nr-btn" @click="copyPhrase">{{ copied ? $ui("Copied") : $ui("Copy") }}</button>
              <button class="nr-btn" @click="downloadPhrase">{{ $ui("Download .txt") }}</button>
            </div>
            <label class="nr-check"><input v-model="phraseAck" type="checkbox" /> <span>{{ $ui("I saved my name recovery phrase") }}</span></label>
            <button class="nr-btn nr-btn--primary" :disabled="!phraseAck" @click="newPhrase = []">{{ $ui("Done") }}</button>
          </div>

          <!-- verified name -->
          <div v-if="isVerified" class="nr-row">
            <div><strong>{{ $ui("Verified certificate") }}</strong><span>{{ $ui("Renew or restore your verified badge on this key. Takes about 15 seconds.") }}</span></div>
            <button class="nr-btn" :disabled="busy" @click="reissue">{{ reissuing ? `Working… ${nonce}` : $ui("Re-verify") }}</button>
          </div>

          <!-- key rotation -->
          <div class="nr-row">
            <div>
              <strong>{{ $ui("Rotate key") }}</strong>
              <span v-if="pendingKey && pendingKey.effectiveAt > now">{{ $ui("New key ready in") }} {{ hoursLeft }} {{ $ui("h. Keep this browser until then.") }}</span>
              <span v-else-if="pendingKey">{{ $ui("New key is ready. Switch this device to it.") }}</span>
              <span v-else>{{ $ui("Use this if your key may be compromised. Announces a new key; it takes over after 24 hours.") }}</span>
            </div>
            <button v-if="pendingKey && pendingKey.effectiveAt <= now" class="nr-btn nr-btn--primary" :disabled="busy" @click="activateKey">{{ $ui("Switch to new key") }}</button>
            <button v-else-if="!pendingKey" class="nr-btn" :disabled="busy" @click="rotateKey">{{ $ui("Rotate key") }}</button>
          </div>
        </template>
      </template>
      <p v-else class="nr-muted">{{ $ui("Could not check this name right now.") }}</p>
    </template>
    <p v-else class="nr-muted">{{ $ui("Claim a username first, then you can set up recovery for it.") }}</p>

    <p v-if="message" class="nr-ok">{{ message }}</p>
    <p v-if="error" class="nr-error">{{ error }}</p>

    <details class="nr-recover">
      <summary>{{ $ui("I lost my key — recover a name") }}</summary>
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
  const blob = new Blob([`Echo NAME recovery phrase for "${username.value}"\n\n${newPhrase.value.join(' ')}\n\nKeep this offline. It can move your username to a new key.\n`], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `echo-name-recovery-${username.value}.txt`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function onStarted() { message.value = 'Recovery started — see the status above once it is visible on the network.'; void refresh(); }

onMounted(async () => {
  await refresh();
  if (window.location.hash === '#name-recovery') document.getElementById('name-recovery')?.scrollIntoView({ block: 'start' });
});
</script>

<style scoped>
.nr { display: flex; flex-direction: column; gap: 12px; font-family: 'Inter', system-ui, sans-serif; color: var(--app-text); }
.nr-head h3 { margin: 0; font-size: 16px; font-weight: 500; }
.nr-head p { margin: 2px 0 0; font-size: 13px; color: var(--app-text-muted); }
.nr-muted { margin: 0; font-size: 13.5px; color: var(--app-text-muted); }
.nr-row { display: flex; justify-content: space-between; align-items: center; gap: 14px; padding: 12px; border: 1px solid var(--app-border); border-radius: 7px; }
.nr-row > div { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.nr-row strong { font-weight: 500; font-size: 14.5px; }
.nr-row span { font-size: 13px; line-height: 1.45; color: var(--app-text-muted); }
.nr-alert { display: flex; flex-direction: column; gap: 6px; padding: 12px; border: 1px solid #ff6b6b; border-radius: 7px; font-size: 13.5px; }
.nr-alert strong { color: var(--app-danger); font-weight: 500; }
.nr-info--warn { border-color: var(--app-warning); color: #ffe27a; }
.nr-info { padding: 10px 12px; border: 1px solid #1d3a28; border-radius: 7px; font-size: 13.5px; color: var(--app-text-muted); }
.nr-btn { flex-shrink: 0; font: inherit; font-size: 13.5px; font-weight: 500; padding: 8px 14px; border-radius: 6px; cursor: pointer; color: var(--app-text); background: var(--app-surface); border: 1px solid var(--app-border); align-self: flex-start; }
.nr-btn:hover { border-color: var(--app-accent); }
.nr-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.nr-btn--primary { background: var(--app-accent); border-color: var(--app-accent); color: var(--app-on-accent); }
.nr-btn--danger { background: #ff6b6b; border-color: #ff6b6b; color: var(--app-surface); }
.nr-phrase-box { display: flex; flex-direction: column; gap: 10px; padding: 12px; border: 1px solid var(--app-warning); border-radius: 7px; }
.nr-phrase-box p { margin: 0; font-size: 13.5px; line-height: 1.5; color: #e6e6e6; }
.nr-words { display: grid; grid-template-columns: repeat(auto-fill, minmax(112px, 1fr)); gap: 8px; }
.nr-words span { padding: 7px 9px; border: 1px solid var(--app-border); border-radius: 5px; font: 13px var(--font-mono, monospace); color: var(--app-text); }
.nr-words i { font-style: normal; color: var(--app-text-muted); margin-right: 8px; }
.nr-actions { display: flex; gap: 8px; }
.nr-check { display: flex; align-items: center; gap: 8px; font-size: 13.5px; }
.nr-check input { accent-color: var(--app-accent); }
.nr-ok { margin: 0; font-size: 13.5px; color: var(--app-accent); }
.nr-error { margin: 0; font-size: 13.5px; color: var(--app-danger); }
.nr-recover { border: 1px solid var(--app-border); border-radius: 7px; padding: 10px 12px; }
.nr-recover summary { cursor: pointer; font-size: 14px; color: var(--app-text-muted); }
.nr-recover[open] summary { margin-bottom: 12px; }
@media (max-width: 600px) { .nr-row { flex-direction: column; align-items: stretch; } }
</style>
