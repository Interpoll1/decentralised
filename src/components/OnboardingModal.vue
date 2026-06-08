<!--
  OnboardingModal.vue — decentralized identity gate, backed by the GenosDB
  Security Manager (via authStore). Follows the SM's UX best practices:
  the security-state is the single source of truth, "Login with phrase" is always
  available (no dead end), the recovery phrase is shown read-only during
  registration with a save warning, and Passkey is offered as the recommended
  upgrade. Styled with InterPoll's own theme tokens.
-->
<template>
  <ion-modal :is-open="!auth.isLoggedIn" :backdrop-dismiss="false" class="onboarding-modal">
    <div class="onboarding">
      <div class="brand">
        <ion-icon :icon="shieldCheckmarkOutline" class="brand-icon" />
        <h1>InterPoll</h1>
        <p class="tagline">
          Your identity lives only on this device — no email, no password.
          Generate one, or recover it with your phrase.
        </p>
      </div>

      <textarea
        class="mnemonic"
        :readonly="inRegistration"
        v-model="phrase"
        :placeholder="inRegistration
          ? 'Your recovery phrase — save it before continuing.'
          : 'Enter your 12-word recovery phrase to log in, or generate a new identity.'"
      ></textarea>

      <div v-if="inRegistration" class="warning">
        <strong>Save this phrase.</strong> It is the only way to recover your account.
        Store it in a password manager.
      </div>

      <div class="actions">
        <ion-button v-if="inRegistration" expand="block" fill="outline" @click="copyPhrase">
          {{ copyLabel }}
        </ion-button>

        <ion-button v-if="!inRegistration" expand="block" @click="generate">
          Generate new identity
        </ion-button>

        <ion-button expand="block" fill="outline" @click="login">
          Login with phrase
        </ion-button>

        <ion-button v-if="auth.hasWebAuthnHardware" expand="block" fill="outline" @click="loginPasskey">
          Login with Passkey
        </ion-button>

        <ion-button v-if="inRegistration" expand="block" color="success" @click="protect">
          Protect with Passkey (recommended)
        </ion-button>
      </div>

      <p v-if="inRegistration" class="hint">Saved it? Log in with your phrase to enter.</p>
    </div>
  </ion-modal>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { IonModal, IonButton, IonIcon } from '@ionic/vue'
import { shieldCheckmarkOutline } from 'ionicons/icons'
import { storeToRefs } from 'pinia'
import { useAuthStore } from '@/stores/authStore'

const auth = useAuthStore()
const { hasVolatileIdentity, mnemonic } = storeToRefs(auth)

const phrase = ref('')
const copyLabel = ref('Copy phrase')

/** During registration the generated phrase is shown read-only for safe saving. */
const inRegistration = computed(() => hasVolatileIdentity.value)

// Surface a freshly generated phrase; clear the field once logged out and idle.
watch(mnemonic, (m) => { if (m) phrase.value = m })
watch(() => auth.isLoggedIn, (loggedIn) => { if (!loggedIn && !inRegistration.value) phrase.value = '' })

async function generate() {
  try { await auth.generateNewIdentity() }
  catch (e: any) { alert(`Could not generate identity: ${e?.message ?? e}`) }
}

async function login() {
  const p = phrase.value.trim()
  if (p.split(/\s+/).length !== 12) { alert('Please enter a valid 12-word recovery phrase.'); return }
  try { await auth.loginWithMnemonic(p) }
  catch (e: any) { alert(`Login failed: ${e?.message ?? e}`) }
}

async function loginPasskey() {
  try { await auth.loginWithWebAuthn() }
  catch (e: any) { if (e?.name !== 'NotAllowedError') alert(`Passkey login failed: ${e?.message ?? e}`) }
}

async function protect() {
  try { await auth.protectWithWebAuthn() }
  catch (e: any) { if (e?.name !== 'NotAllowedError') alert(`Could not protect with Passkey: ${e?.message ?? e}`) }
}

function copyPhrase() {
  navigator.clipboard.writeText(phrase.value)
    .then(() => { copyLabel.value = 'Copied!'; setTimeout(() => { copyLabel.value = 'Copy phrase' }, 2000) })
    .catch(() => alert('Could not copy. Please select and copy the phrase manually.'))
}
</script>

<style scoped>
.onboarding-modal::part(content) {
  --width: min(92vw, 440px);
  --height: auto;
  --border-radius: var(--app-radius-lg);
  --background: var(--app-bg-elevated);
  --box-shadow: var(--app-shadow-lg);
}

.onboarding {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 28px 24px;
}

.brand {
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.brand-icon {
  font-size: 40px;
  color: var(--app-accent);
}

.brand h1 {
  margin: 0;
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--app-text);
}

.tagline {
  margin: 0;
  font-size: 0.9rem;
  line-height: 1.45;
  color: var(--app-text-muted);
}

.mnemonic {
  width: 100%;
  min-height: 88px;
  resize: none;
  padding: 12px 14px;
  font-size: 0.95rem;
  font-family: inherit;
  line-height: 1.5;
  color: var(--app-text);
  background: var(--app-surface);
  border: 1px solid var(--app-border-strong);
  border-radius: var(--app-radius-md);
  transition: border-color var(--app-transition), box-shadow var(--app-transition);
}

.mnemonic:focus {
  outline: none;
  border-color: var(--app-border-accent);
  box-shadow: var(--app-focus-ring);
}

.mnemonic[readonly] {
  background: rgba(var(--app-accent-rgb), 0.06);
  border-color: var(--app-border-accent);
}

.warning {
  font-size: 0.82rem;
  line-height: 1.4;
  color: var(--app-text);
  background: rgba(var(--app-warning-rgb), 0.12);
  border: 1px solid rgba(var(--app-warning-rgb), 0.4);
  border-radius: var(--app-radius-sm);
  padding: 10px 12px;
}

.actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.hint {
  margin: 0;
  text-align: center;
  font-size: 0.82rem;
  color: var(--app-text-subtle);
}
</style>
