<template>
  <!-- Display name plus a neutral Security Manager role pill (e.g. estebanrfp · guest). -->
  <span class="identity-badge" :class="{ loading }">
    <span class="badge-username">{{ displayName || '…' }}</span>
    <span v-if="!loading" class="badge-role">{{ role }}</span>
  </span>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue';
import { UserService } from '@/services/userService';
import { db } from '@/services/gdbServices';

/**
 * Two usage modes:
 *
 * 1. Direct username (e.g. Settings):
 *    <UserIdentityBadge :username="estebanrfp" />
 *    Resolves the role of the active SM identity.
 *
 * 2. Author ID lookup (e.g. an author's address):
 *    <UserIdentityBadge :authorId="post.authorId" />
 *    Resolves the author's display name (customUsername || username) and their SM role.
 */
const props = defineProps<{
  /** Known username to display. */
  username?: string;
  /** Author's Security Manager address — badge resolves name + role from their nodes. */
  authorId?: string;
}>();

const loading = ref(true);
const displayName = ref(props.username || '');
const role = ref('guest');
let unsub: (() => void) | null = null;

async function resolve() {
  loading.value = true;
  unsub?.();
  unsub = null;
  try {
    const address = props.authorId || db.sm.getActiveEthAddress();
    displayName.value = props.authorId
      ? (await UserService.getUser(props.authorId))?.customUsername || props.username || ''
      : props.username || '';

    if (!address) { role.value = 'guest'; loading.value = false; return; }

    // Realtime: subscribe to the SM role node (`user:<address>`) so a governance
    // promotion (guest -> member -> trusted) appears live, with no refresh.
    const { unsubscribe } = await db.get(`user:${address}`, (node: any) => {
      role.value = node?.value?.role || 'guest';
      loading.value = false;
    });
    unsub = unsubscribe;
  } catch {
    role.value = 'guest';
    loading.value = false;
  }
}

onMounted(resolve);
watch(() => [props.username, props.authorId], resolve);
onUnmounted(() => unsub?.());
</script>

<style scoped>
.identity-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border-radius: 999px;
  padding: 2px 4px 2px 8px;
  font-size: 0.78rem;
  font-weight: 500;
  white-space: nowrap;
  cursor: default;
  user-select: none;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--ion-text-color);
}

.identity-badge.loading {
  opacity: 0.6;
}

.badge-username {
  overflow: hidden;
  text-overflow: ellipsis;
}

.badge-role {
  flex-shrink: 0;
  border-radius: 999px;
  padding: 1px 8px;
  font-size: 0.68rem;
  font-weight: 600;
  text-transform: lowercase;
  letter-spacing: 0.02em;
  background: rgba(var(--ion-color-primary-rgb), 0.12);
  color: var(--ion-color-primary);
  border: 1px solid rgba(var(--ion-color-primary-rgb), 0.28);
}

@media (prefers-color-scheme: dark) {
  .badge-role {
    background: rgba(var(--ion-color-primary-rgb), 0.18);
    border-color: rgba(var(--ion-color-primary-rgb), 0.4);
  }
}
</style>
