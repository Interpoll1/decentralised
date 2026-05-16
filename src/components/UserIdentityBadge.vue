<template>
  <!-- Loading: neutral pill while resolving -->
  <span v-if="loading" class="identity-badge loading">
    <span class="badge-username">{{ displayName || '…' }}</span>
  </span>

  <!-- Verified: green shield -->
  <span
    v-else-if="resolved.level === 'verified'"
    class="identity-badge verified"
    :title="verifiedTitle"
  >
    <ion-icon :icon="shieldCheckmarkOutline" class="badge-icon verified-icon" />
    <span class="badge-username">{{ displayName }}</span>
    <span class="badge-issuer">@{{ resolved.certificate?.issuerDomain }}</span>
  </span>

  <!-- Unverified: amber warning -->
  <span
    v-else
    class="identity-badge unverified"
    :title="unverifiedTitle"
  >
    <ion-icon :icon="warningOutline" class="badge-icon unverified-icon" />
    <span class="badge-username">{{ displayName }}</span>
    <span class="badge-label">unverified</span>
  </span>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { IonIcon } from '@ionic/vue';
import { shieldCheckmarkOutline, warningOutline } from 'ionicons/icons';
import { TrustService, type VerifiedUsername } from '@/services/trustService';
import { UserService } from '@/services/userService';

/**
 * Two usage modes:
 *
 * 1. Direct username (e.g. Settings, ClaimUsernamePage done screen):
 *    <UserIdentityBadge :username="joedoge" :preloadedTrust="..." />
 *
 * 2. Author ID lookup (e.g. PostCard, CommentCard — resolves live from Gun):
 *    <UserIdentityBadge :authorId="post.authorId" />
 *    The badge fetches the author's profile → customUsername → trust level.
 *    Falls back to pseudonym display if no customUsername is set.
 */
const props = defineProps<{
  /** Known username to display and resolve trust for. */
  username?: string;
  /** Author's device ID — badge resolves username + trust from their Gun profile. */
  authorId?: string;
  /** Pre-resolved trust record — skips GunDB lookup entirely. */
  preloadedTrust?: VerifiedUsername;
  /** Public key hex shown as fingerprint suffix when pubkeyChars > 0. */
  pubkey?: string;
  pubkeyChars?: number;
}>();

const loading = ref(true);
const displayName = ref(props.username || '');
const resolved = ref<VerifiedUsername>({
  username: props.username || '',
  level: 'none',
});

async function resolve() {
  loading.value = true;
  try {
    // Mode 1: preloaded (no lookup needed)
    if (props.preloadedTrust) {
      displayName.value = props.preloadedTrust.username;
      resolved.value = props.preloadedTrust;
      return;
    }

    // Mode 2: authorId — look up their Gun profile first
    if (props.authorId) {
      const profile = await UserService.getUser(props.authorId);
      const name = profile?.customUsername || props.username || '';
      displayName.value = name;

      if (name) {
        resolved.value = await TrustService.resolveTrust(name);
      } else {
        // No username set at all — show as anonymous/unverified
        resolved.value = { username: '', level: 'none' };
      }
      return;
    }

    // Mode 3: username prop only
    if (props.username) {
      displayName.value = props.username;
      resolved.value = await TrustService.resolveTrust(props.username);
      return;
    }

    // Nothing to resolve
    resolved.value = { username: '', level: 'none' };
  } catch {
    resolved.value = { username: displayName.value, level: 'none' };
  } finally {
    loading.value = false;
  }
}

onMounted(resolve);
watch(() => [props.username, props.authorId], resolve);

const verifiedTitle = computed(() => {
  const c = resolved.value.certificate;
  if (!c) return `Verified by ${resolved.value.issuer?.domain}`;
  const exp = new Date(c.expiresAt).toLocaleDateString();
  return `Verified by ${c.issuerDomain} · expires ${exp}\nPubkey: ${c.userPubkey.slice(0, 16)}…`;
});

const unverifiedTitle = computed(() => {
  const pk = props.pubkey ? props.pubkey.slice(0, 16) + '…' : 'unknown';
  return `Unverified identity\nPubkey: ${pk}`;
});
</script>

<style scoped>
.identity-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border-radius: 999px;
  padding: 2px 8px 2px 5px;
  font-size: 0.78rem;
  font-weight: 500;
  white-space: nowrap;
  cursor: default;
  user-select: none;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
}

.identity-badge.loading {
  background: transparent;
  border: 1px solid rgba(128,128,128,0.2);
  color: var(--ion-color-medium);
  opacity: 0.6;
}

.identity-badge.verified {
  background: rgba(16,185,129,0.12);
  border: 1px solid rgba(16,185,129,0.35);
  color: #059669;
}

.verified-icon { color: #10b981; font-size: 13px; flex-shrink: 0; }

.badge-issuer {
  font-size: 0.68rem;
  opacity: 0.7;
  margin-left: 1px;
}

.identity-badge.unverified {
  background: rgba(245,158,11,0.10);
  border: 1px solid rgba(245,158,11,0.30);
  color: #92400e;
}

@media (prefers-color-scheme: dark) {
  .identity-badge.verified {
    background: rgba(16,185,129,0.15);
    border-color: rgba(16,185,129,0.4);
    color: #34d399;
  }
  .identity-badge.unverified {
    background: rgba(245,158,11,0.15);
    border-color: rgba(245,158,11,0.35);
    color: #fbbf24;
  }
}

.unverified-icon { color: #f59e0b; font-size: 13px; flex-shrink: 0; }

.badge-label {
  font-size: 0.65rem;
  opacity: 0.75;
  text-transform: uppercase;
  letter-spacing: 0.02em;
  margin-left: 2px;
}

.badge-username { overflow: hidden; text-overflow: ellipsis; }
</style>