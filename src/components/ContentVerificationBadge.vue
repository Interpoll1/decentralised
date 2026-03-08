<template>
  <span 
    v-if="status !== 'unsigned' || showUnsigned" 
    class="verification-badge" 
    :class="status"
    role="status"
    :aria-label="tooltipText"
    :title="tooltipText"
  >
    <ion-icon :icon="badgeIcon"></ion-icon>
    <span v-if="showLabel" class="badge-label">{{ labelText }}</span>
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { IonIcon } from '@ionic/vue';
import { 
  checkmarkCircleOutline, 
  warningOutline, 
  helpCircleOutline 
} from 'ionicons/icons';

const statusConfig = {
  verified: {
    icon: checkmarkCircleOutline,
    label: 'Verified',
    tooltip: 'Content signature verified — authentic and untampered',
  },
  unverified: {
    icon: warningOutline,
    label: 'Unverified',
    tooltip: 'Content signature invalid — may be tampered or forged',
  },
  unsigned: {
    icon: helpCircleOutline,
    label: 'Unsigned',
    tooltip: 'No content signature — posted before signing was enabled',
  },
} as const;

const props = defineProps<{
  status: 'verified' | 'unverified' | 'unsigned';
  showLabel?: boolean;
  showUnsigned?: boolean;
}>();

const config = computed(() => statusConfig[props.status]);
const badgeIcon = computed(() => config.value.icon);
const labelText = computed(() => config.value.label);
const tooltipText = computed(() => config.value.tooltip);
</script>

<style scoped>
.verification-badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 12px;
  font-weight: 500;
  cursor: default;
}

.verification-badge.verified {
  color: var(--ion-color-success);
}

.verification-badge.unverified {
  color: var(--ion-color-danger);
}

.verification-badge.unsigned {
  color: var(--ion-color-medium);
  opacity: 0.6;
}

.verification-badge ion-icon {
  font-size: 14px;
}

.badge-label {
  font-size: 11px;
}
</style>
