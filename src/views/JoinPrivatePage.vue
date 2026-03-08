<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button default-href="/home"></ion-back-button>
        </ion-buttons>
        <ion-title>Join {{ typeLabel }}</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      <!-- Loading state (auto-joining via invite link) -->
      <div v-if="loading" class="join-loading">
        <ion-spinner name="crescent"></ion-spinner>
        <p>Joining {{ typeLabel }}...</p>
      </div>

      <!-- Success state -->
      <div v-else-if="success" class="join-success">
        <ion-icon :icon="checkmarkCircleOutline" class="success-icon"></ion-icon>
        <h2>Joined successfully!</h2>
        <p>You now have access to this {{ typeLabel }}.</p>
        <ion-button expand="block" @click="navigateToTarget">
          Open {{ typeLabel }}
          <ion-icon slot="end" :icon="arrowForwardOutline"></ion-icon>
        </ion-button>
      </div>

      <!-- Error state -->
      <div v-else-if="error" class="join-error">
        <ion-icon :icon="alertCircleOutline" class="error-icon"></ion-icon>
        <h2>Failed to join</h2>
        <p>{{ error }}</p>
        <ion-button expand="block" fill="outline" @click="resetForm">
          Try Again
        </ion-button>
      </div>

      <!-- Password input form (when no key in URL) -->
      <div v-else class="join-form">
        <div class="form-header">
          <ion-icon :icon="lockClosedOutline" class="lock-icon"></ion-icon>
          <h2>This {{ typeLabel }} is encrypted</h2>
          <p>Enter the password to decrypt and access this {{ typeLabel }}.</p>
        </div>

        <ion-item>
          <ion-input
            v-model="password"
            type="password"
            label="Password"
            label-placement="stacked"
            placeholder="Enter password"
            @keyup.enter="joinWithPassword"
          ></ion-input>
        </ion-item>

        <ion-button
          expand="block"
          :disabled="!password.trim() || joining"
          @click="joinWithPassword"
          class="join-button"
        >
          <ion-spinner v-if="joining" name="crescent" slot="start"></ion-spinner>
          {{ joining ? 'Joining...' : 'Join' }}
        </ion-button>
      </div>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonButtons,
  IonBackButton,
  IonButton,
  IonIcon,
  IonSpinner,
  IonItem,
  IonInput,
} from '@ionic/vue';
import {
  checkmarkCircleOutline,
  arrowForwardOutline,
  alertCircleOutline,
  lockClosedOutline,
} from 'ionicons/icons';
import { InviteLinkService } from '@/services/inviteLinkService';
import { CommunityService } from '@/services/communityService';
import { KeyVaultService } from '@/services/keyVaultService';
import config from '@/config';

const SUPPORTED_TYPES = ['community', 'server'] as const;

const router = useRouter();
const route = useRoute();

// Check hash synchronously so we show the spinner from the very first frame
const hashKey = InviteLinkService.getKeyFromCurrentUrl();
const loading = ref(!!hashKey);
const joining = ref(false);
const success = ref(false);
const error = ref('');
const password = ref('');

const targetType = computed(() => route.params.type as string);
const targetId = computed(() => route.params.id as string);

const typeLabel = computed(() => {
  switch (targetType.value) {
    case 'community': return 'Community';
    case 'chatroom': return 'Chat Room';
    case 'server': return 'Server';
    default: return 'Group';
  }
});

function navigateToTarget() {
  switch (targetType.value) {
    case 'community':
      router.replace(`/community/${targetId.value}`);
      break;
    case 'chatroom':
      router.replace('/home');
      break;
    case 'server':
      router.replace('/home');
      break;
    default:
      router.replace('/home');
  }
}

function resetForm() {
  error.value = '';
  password.value = '';
  joining.value = false;

  // Re-attempt invite-link join if hash key is still available
  if (hashKey) {
    joinWithKey(hashKey);
  }
}

async function dispatchJoin(keyOrPassword: string, method: 'invite' | 'password') {
  const type = targetType.value;
  if (type === 'server' && !config.isServerEncrypted()) {
    throw new Error('This server does not use encryption.');
  }
  if (type === 'community' || type === 'server') {
    await CommunityService.joinPrivateCommunity(targetId.value, keyOrPassword, method);
  } else {
    throw new Error(`Unsupported type: ${type}`);
  }
}

async function joinWithKey(base64urlKey: string) {
  loading.value = true;
  try {
    await dispatchJoin(base64urlKey, 'invite');
    success.value = true;
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : 'Failed to join with invite link';
  } finally {
    loading.value = false;
  }
}

async function joinWithPassword() {
  if (!password.value.trim() || joining.value) return;
  joining.value = true;
  error.value = '';
  try {
    await dispatchJoin(password.value, 'password');
    success.value = true;
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : 'Wrong password or community not found';
  } finally {
    joining.value = false;
  }
}

onMounted(async () => {
  // Reject unsupported types early
  if (!SUPPORTED_TYPES.includes(targetType.value as typeof SUPPORTED_TYPES[number])) {
    error.value = `Joining a ${typeLabel.value} via this page is not yet supported.`;
    loading.value = false;
    return;
  }

  // Already have a key → redirect immediately
  if (await KeyVaultService.hasKey(targetId.value)) {
    navigateToTarget();
    return;
  }

  // Invite key detected synchronously at init → auto-join
  if (hashKey) {
    await joinWithKey(hashKey);
  } else {
    loading.value = false;
  }
});
</script>

<style scoped>
.join-loading,
.join-success,
.join-error,
.join-form {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 60vh;
  text-align: center;
  gap: 8px;
}

.join-loading p {
  color: var(--ion-color-medium);
  font-size: 16px;
  margin-top: 12px;
}

/* ── Success & Error shared ────────────────────────── */

.join-success h2,
.join-error h2 {
  margin: 0 0 4px;
  font-size: 22px;
  font-weight: 700;
}

.join-success p,
.join-error p {
  color: var(--ion-color-medium);
  margin-bottom: 24px;
  max-width: 360px;
}

.join-success ion-button,
.join-error ion-button {
  width: 100%;
  max-width: 360px;
}

/* ── Success ───────────────────────────────────────── */

.success-icon,
.error-icon {
  font-size: 64px;
  margin-bottom: 8px;
}

.success-icon {
  color: var(--ion-color-success);
}

.error-icon {
  color: var(--ion-color-danger);
}

/* ── Password form ─────────────────────────────────── */

.form-header {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-bottom: 24px;
}

.lock-icon {
  font-size: 48px;
  color: var(--ion-color-primary);
  margin-bottom: 12px;
}

.form-header h2 {
  margin: 0 0 4px;
  font-size: 22px;
  font-weight: 700;
}

.form-header p {
  color: var(--ion-color-medium);
  max-width: 340px;
}

.join-form ion-item {
  width: 100%;
  max-width: 400px;
  --background: rgba(var(--ion-card-background-rgb), 0.20);
  --border-color: var(--glass-border);
  border-radius: 12px;
  margin-bottom: 16px;
}

.join-button {
  width: 100%;
  max-width: 400px;
  margin-top: 4px;
}
</style>
