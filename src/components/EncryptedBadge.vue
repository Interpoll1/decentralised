<template>
  <span class="encrypted-badge" role="status" :aria-label="resolvedHint" :title="resolvedHint">
    <ion-icon :icon="lockClosedOutline"></ion-icon>
    <span v-if="showLabel" class="badge-label">{{ resolvedHint }}</span>
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { IonIcon } from '@ionic/vue';
import { lockClosedOutline } from 'ionicons/icons';

const props = defineProps<{
  hint?: string;
  showLabel?: boolean;
}>();

const resolvedHint = computed(() => props.hint ?? 'Encrypted');
</script>

<style scoped>
.encrypted-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  background: rgba(var(--ion-color-warning-rgb), 0.10);
  border: 1px solid rgba(var(--ion-color-warning-rgb), 0.20);
  color: var(--ion-color-warning-shade);
  border-radius: 12px;
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
}

.encrypted-badge ion-icon {
  font-size: 12px;
}

.badge-label {
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
