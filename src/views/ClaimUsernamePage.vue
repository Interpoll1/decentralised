<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button default-href="/settings"></ion-back-button>
        </ion-buttons>
        <ion-title>Set Username</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <div class="page-shell page-shell--form">

      <!-- ── Step 1: Choose username ── -->
      <section class="step" v-if="step === 'input'">
        <div class="step-header">
          <ion-icon :icon="personOutline" class="step-icon" />
          <h2>Choose a username</h2>
          <p class="step-desc">
            Usernames can be claimed without verification, but a
            <strong>trust issuer</strong> endorsement makes your identity
            provably yours and raises your rate limits.
          </p>
        </div>

        <ion-item class="username-field">
          <ion-label position="stacked">Username</ion-label>
          <ion-input
            v-model="username"
            placeholder="e.g. alice"
            :maxlength="32"
            autocomplete="off"
            @ion-input="onUsernameInput"
          />
        </ion-item>

        <p class="field-hint" :class="{ error: usernameError }">
          {{ usernameError || '3–32 chars, letters / numbers / _ . -' }}
        </p>

        <!-- Trust issuer selector -->
        <div class="issuer-section">
          <div class="issuer-header">
            <span>Trust issuer <span class="optional">(optional)</span></span>
            <ion-button
              fill="clear"
              size="small"
              class="custom-issuer-toggle"
              @click="showCustomIssuerMenu = !showCustomIssuerMenu"
            >
              {{ showCustomIssuerMenu ? 'Hide custom' : 'Add custom' }}
            </ion-button>
            <ion-icon
              :icon="helpCircleOutline"
              class="help-icon"
              @click="showTrustInfo = true"
            />
          </div>

          <div v-if="showCustomIssuerMenu" class="custom-issuer-menu">
            <ion-item class="custom-field">
              <ion-label position="stacked">Issuer endpoint</ion-label>
              <ion-input
                v-model="customIssuerEndpoint"
                placeholder="https://interpoll.endless.sbs/trust"
                autocomplete="off"
              />
            </ion-item>
            <ion-item class="custom-field">
              <ion-label position="stacked">Issuer contact (optional)</ion-label>
              <ion-input
                v-model="customIssuerContact"
                placeholder="viktor@endless.sbs"
                autocomplete="off"
              />
            </ion-item>
            <ion-button
              size="small"
              :disabled="addingCustomIssuer || !customIssuerEndpoint.trim()"
              @click="addCustomIssuer"
            >
              {{ addingCustomIssuer ? 'Adding…' : 'Save custom issuer' }}
            </ion-button>
            <p v-if="customIssuerError" class="field-hint error">{{ customIssuerError }}</p>
          </div>

          <div v-if="loadingIssuers" class="loading-row">
            <ion-spinner name="dots" /> Loading issuers…
          </div>

          <div v-else-if="issuers.length === 0" class="no-issuers">
            No trust issuers configured. Username will be unverified.
          </div>

          <div v-else class="issuer-list">
            <div
              class="issuer-item"
              :class="{ selected: selectedIssuer === null }"
              @click="selectedIssuer = null"
            >
              <div class="issuer-name">
                <ion-icon :icon="warningOutline" class="unverified-icon" />
                No issuer — unverified
              </div>
              <p class="issuer-desc">Lower rate limits. Username is first-come, first-served with no cryptographic proof.</p>
            </div>

            <div
              v-for="issuer in issuers"
              :key="issuerKey(issuer)"
              class="issuer-item"
              :class="{ selected: selectedIssuer && issuerKey(selectedIssuer) === issuerKey(issuer) }"
              @click="selectedIssuer = issuer"
            >
              <div class="issuer-name">
                <ion-icon :icon="shieldCheckmarkOutline" class="verified-icon" />
                {{ issuer.contact }}
              </div>
              <p class="issuer-desc">
                Verified by <strong>{{ issuer.domain }}</strong>.
                Requires ~15 s PoW. Unlocks full rate limits.
              </p>
            </div>
          </div>
        </div>

        <ion-button
          expand="block"
          class="cta-button"
          :disabled="!canProceed"
          @click="proceed"
        >
          {{ selectedIssuer ? 'Continue to verification' : 'Claim unverified username' }}
        </ion-button>
      </section>

      <!-- ── Step 2: PoW solving ── -->
      <section class="step center" v-else-if="step === 'pow'">
        <div class="pow-anim">
          <ion-spinner name="crescent" class="pow-spinner" />
        </div>
        <h2>Solving challenge…</h2>
        <p class="step-desc">
          Your device is proving work to <strong>{{ selectedIssuer?.contact }}</strong>.
          This takes ~15 seconds and verifies you're human.
        </p>
        <p class="pow-progress">Nonce: {{ powNonce.toLocaleString() }}</p>
        <p v-if="powError" class="error-text">{{ powError }}</p>
      </section>

      <!-- ── Step 3: Done ── -->
      <section class="step center" v-else-if="step === 'done'">

        <!-- Verified outcome -->
        <template v-if="claimedVerified">
          <ion-icon :icon="shieldCheckmarkOutline" class="done-icon done-verified" />
          <h2>Verified!</h2>
          <p class="step-desc">
            <strong>{{ username }}</strong> is cryptographically verified by
            <strong>{{ selectedIssuer?.contact }}</strong>.
            Other users will see a green shield next to your name.
          </p>
        </template>

        <!-- Unverified outcome - be explicit -->
        <template v-else>
          <ion-icon :icon="warningOutline" class="done-icon done-unverified" />
          <h2>Username claimed <span class="unverified-label">(unverified)</span></h2>
          <p class="step-desc">
            <strong>{{ username }}</strong> is saved, but marked
            <strong>unverified</strong> — other users will see an amber ⚠ badge.
            No trust issuer endorsed this claim.
          </p>
          <p class="step-desc hint">
            To get a green ✓ shield and higher rate limits, add a trust issuer
            and re-claim with verification.
          </p>
        </template>

        <!-- Preview what others see -->
        <div class="badge-preview">
          <span class="preview-label">How others see you:</span>
          <UserIdentityBadge :username="username" :preloadedTrust="previewTrust" />
        </div>

        <ion-button expand="block" @click="$router.back()">Done</ion-button>
      </section>

      </div>
    </ion-content>

    <!-- Trust info alert -->
    <ion-alert
      :is-open="showTrustInfo"
      header="What is a trust issuer?"
      message="A trust issuer is an authority (like viktor@endless.sbs) that endorses your username with a cryptographic certificate. Verification requires solving a ~15-second Proof-of-Work challenge — this deters spam while keeping registration open. Verified users get higher rate limits and a green shield badge."
      :buttons="[{ text: 'Got it', role: 'cancel' }]"
      @didDismiss="showTrustInfo = false"
    />
  </ion-page>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import {
  IonPage, IonHeader, IonToolbar, IonButtons, IonBackButton,
  IonTitle, IonContent, IonItem, IonLabel, IonInput,
  IonButton, IonIcon, IonSpinner, IonAlert, toastController,
} from '@ionic/vue';
import {
  personOutline, shieldCheckmarkOutline, warningOutline,
  helpCircleOutline,
} from 'ionicons/icons';
import { TrustService, type TrustCertificate, type TrustIssuer, type VerifiedUsername } from '@/services/trustService';
import { UserService } from '@/services/userService';
import { useUserStore } from '@/stores/userStore';
import UserIdentityBadge from '@/components/UserIdentityBadge.vue';

type Step = 'input' | 'pow' | 'done';

const router = useRouter();
const userStore = useUserStore();

const step = ref<Step>('input');
const username = ref('');
const usernameError = ref('');
const issuers = ref<TrustIssuer[]>([]);
const loadingIssuers = ref(true);
const selectedIssuer = ref<TrustIssuer | null>(null);
const showTrustInfo = ref(false);
const powNonce = ref(0);
const powError = ref('');
const claimedVerified = ref(false);
const claimedCertificate = ref<TrustCertificate | null>(null);
const showCustomIssuerMenu = ref(false);
const customIssuerEndpoint = ref('https://interpoll.endless.sbs/trust');
const customIssuerContact = ref('viktor@endless.sbs');
const addingCustomIssuer = ref(false);
const customIssuerError = ref('');

// Pre-built trust record for the done-screen badge preview (no GenosDB roundtrip needed)
const previewTrust = computed<VerifiedUsername>(() => ({
  username: username.value,
  level: claimedVerified.value ? 'verified' : 'none',
  certificate: claimedVerified.value ? claimedCertificate.value || undefined : undefined,
  issuer: claimedVerified.value ? selectedIssuer.value || undefined : undefined,
}));

onMounted(async () => {
  try {
    issuers.value = await TrustService.getIssuers();
    const defaultIssuer = issuers.value.find((issuer) =>
      issuer.endpoint === 'https://interpoll.endless.sbs/trust' || issuer.domain === 'endless.sbs'
    );
    if (defaultIssuer) selectedIssuer.value = defaultIssuer;
  } catch (e) {
    issuers.value = [];
    customIssuerError.value = e instanceof Error ? e.message : 'Failed to load trust issuers';
  } finally {
    loadingIssuers.value = false;
  }

  // Pre-fill current username
  try {
    const user = await UserService.getCurrentUser();
    if (user.customUsername) username.value = user.customUsername;
  } catch { /* ignore */ }
});

function issuerKey(issuer: TrustIssuer): string {
  return `${issuer.domain}|${issuer.endpoint}`;
}

async function addCustomIssuer() {
  if (!customIssuerEndpoint.value.trim()) {
    customIssuerError.value = 'Issuer endpoint is required.';
    return;
  }
  addingCustomIssuer.value = true;
  customIssuerError.value = '';
  try {
    const issuer = await TrustService.addCustomIssuer({
      endpoint: customIssuerEndpoint.value,
      contact: customIssuerContact.value || undefined,
    });
    issuers.value = await TrustService.getIssuers();
    const selected = issuers.value.find((entry) => issuerKey(entry) === issuerKey(issuer));
    if (selected) selectedIssuer.value = selected;
    showCustomIssuerMenu.value = false;
    const toast = await toastController.create({
      message: `Added issuer ${issuer.domain}`,
      duration: 1800,
      color: 'success',
    });
    await toast.present();
  } catch (e) {
    customIssuerError.value = e instanceof Error ? e.message : 'Failed to add issuer';
  } finally {
    addingCustomIssuer.value = false;
  }
}

function onUsernameInput() {
  if (!username.value) { usernameError.value = ''; return; }
  usernameError.value = TrustService.isValidUsername(username.value)
    ? ''
    : 'Only letters, numbers, _ . - (3–32 chars)';
}

const canProceed = computed(() =>
  !loadingIssuers.value &&
  username.value.length >= 3 &&
  !usernameError.value
);

async function proceed() {
  if (!canProceed.value) return;
  const normalizedUsername = username.value.trim();
  if (!TrustService.isValidUsername(normalizedUsername)) {
    usernameError.value = 'Only letters, numbers, _ . - (3–32 chars)';
    return;
  }
  username.value = normalizedUsername;

  if (!selectedIssuer.value) {
    // Unverified claim
    const ok = await TrustService.claimUnverifiedUsername(normalizedUsername);
    if (!ok) {
      usernameError.value = 'Username already taken by another user.';
      return;
    }
    const updated = await UserService.updateProfile({
      customUsername: normalizedUsername,
      trustLevel: 'none',
      identityUsername: normalizedUsername,
      identityIssuer: '',
      identityTrustLevel: 'unverified',
    });
    userStore.profiles[updated.id] = updated;
    claimedVerified.value = false;
    claimedCertificate.value = null;
    step.value = 'done';
    return;
  }

  // Verified claim — start PoW
  step.value = 'pow';
  powNonce.value = 0;
  powError.value = '';

  try {
    const cert = await TrustService.solveAndClaimVerifiedUsername(
      selectedIssuer.value,
      normalizedUsername,
      (n) => { powNonce.value = n; },
    );
    const updated = await UserService.updateProfile({
      customUsername: normalizedUsername,
      trustLevel: 'verified',
      identityUsername: `${normalizedUsername}@${selectedIssuer.value.domain}`,
      identityIssuer: selectedIssuer.value.domain,
      identityTrustLevel: 'trusted-issuer',
    });
    userStore.profiles[updated.id] = updated;
    claimedVerified.value = true;
    claimedCertificate.value = cert;
    step.value = 'done';
  } catch (e) {
    powError.value = e instanceof Error ? e.message : 'Verification failed';
    claimedCertificate.value = null;
    const toast = await toastController.create({
      message: powError.value,
      duration: 4000,
      color: 'danger',
    });
    await toast.present();
    step.value = 'input';
  }
}
</script>

<style scoped>
.step {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding-bottom: 32px;
}

.step.center {
  align-items: center;
  text-align: center;
  padding-top: 48px;
}

.step-header {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-bottom: 8px;
}

.step-icon {
  font-size: 40px;
  color: var(--ion-color-primary);
}

.step-desc {
  font-size: 0.9rem;
  color: var(--ion-color-medium);
  line-height: 1.5;
  margin: 0;
}

.username-field {
  --border-radius: 8px;
}

.field-hint {
  font-size: 0.78rem;
  color: var(--ion-color-medium);
  margin: 4px 16px 0;
}
.field-hint.error { color: var(--ion-color-danger); }

/* ── Issuers ── */
.issuer-section {
  margin-top: 8px;
}

.issuer-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
  font-size: 0.9rem;
  margin-bottom: 10px;
}

.optional {
  font-weight: 400;
  font-size: 0.78rem;
  color: var(--ion-color-medium);
}

.help-icon {
  color: var(--ion-color-medium);
  font-size: 18px;
  cursor: pointer;
}

.custom-issuer-toggle {
  margin-left: auto;
  --padding-start: 8px;
  --padding-end: 8px;
  font-size: 0.75rem;
}

.custom-issuer-menu {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border: 1px solid rgba(var(--ion-color-medium-rgb), 0.25);
  border-radius: 10px;
  margin-bottom: 10px;
}

.custom-field {
  --inner-padding-end: 0;
}

.issuer-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.issuer-item {
  border: 1.5px solid var(--ion-color-light-shade);
  border-radius: 10px;
  padding: 12px 14px;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}

.issuer-item.selected {
  border-color: var(--ion-color-primary);
  background: rgba(var(--ion-color-primary-rgb), 0.06);
}

.issuer-name {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
  font-size: 0.9rem;
}

.verified-icon { color: #10b981; }
.unverified-icon { color: #f59e0b; }

.issuer-desc {
  font-size: 0.78rem;
  color: var(--ion-color-medium);
  margin: 4px 0 0;
  line-height: 1.4;
}

.loading-row, .no-issuers {
  font-size: 0.85rem;
  color: var(--ion-color-medium);
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 0;
}

/* ── PoW ── */
.pow-anim { margin-bottom: 8px; }
.pow-spinner { width: 56px; height: 56px; }
.pow-progress {
  font-size: 0.8rem;
  color: var(--ion-color-medium);
  font-variant-numeric: tabular-nums;
}
.error-text { color: var(--ion-color-danger); font-size: 0.85rem; }

/* ── Done ── */
.done-icon {
  font-size: 64px;
  margin-bottom: 8px;
}
.done-verified { color: #10b981; }
.done-unverified { color: #f59e0b; }

.unverified-label {
  font-size: 0.75em;
  color: #f59e0b;
  font-weight: 500;
}

.hint {
  font-size: 0.8rem;
  opacity: 0.75;
}

.badge-preview {
  display: flex;
  align-items: center;
  gap: 8px;
  background: rgba(128,128,128,0.08);
  border: 1px solid rgba(128,128,128,0.15);
  border-radius: 10px;
  padding: 10px 14px;
  margin: 4px 0;
}

.preview-label {
  font-size: 0.78rem;
  color: var(--ion-color-medium);
  white-space: nowrap;
}

.cta-button { margin-top: 8px; }
</style>
