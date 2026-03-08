<template>
  <div class="private-toggle">
    <ion-item lines="none">
      <ion-icon :icon="lockClosedOutline" slot="start" class="toggle-icon"></ion-icon>
      <ion-label>
        <h3>Private Community</h3>
        <p>Encrypt all content — only members with the key can read</p>
      </ion-label>
      <ion-toggle v-model="isPrivate" slot="end"></ion-toggle>
    </ion-item>

    <div v-if="isPrivate" class="encryption-options">
      <ion-segment v-model="method">
        <ion-segment-button value="invite">
          <ion-label>Invite Link</ion-label>
        </ion-segment-button>
        <ion-segment-button value="password">
          <ion-label>Password</ion-label>
        </ion-segment-button>
      </ion-segment>

      <div v-if="method === 'invite'" class="method-info">
        <ion-icon :icon="linkOutline"></ion-icon>
        <p>A unique encryption key will be generated. Share the invite link to give access.</p>
      </div>

      <div v-if="method === 'password'" class="method-info">
        <ion-input
          v-model="password"
          type="password"
          label="Password"
          label-placement="stacked"
          placeholder="Min 12 characters"
          :counter="true"
          :maxlength="128"
          :minlength="MIN_PASSWORD_LENGTH"
        ></ion-input>
        <p v-if="password.length > 0 && password.length < MIN_PASSWORD_LENGTH" class="password-warning">
          Password must be at least 12 characters
        </p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { IonItem, IonLabel, IonToggle, IonSegment, IonSegmentButton, IonIcon, IonInput } from '@ionic/vue';
import { lockClosedOutline, linkOutline } from 'ionicons/icons';

export interface PrivateCommunityConfig {
  isPrivate: boolean;
  method: 'invite' | 'password';
  password?: string;
  valid: boolean;
}

const MIN_PASSWORD_LENGTH = 12;

const props = withDefaults(defineProps<{
  config?: PrivateCommunityConfig;
}>(), {
  config: () => ({ isPrivate: false, method: 'invite' as const, valid: true }),
});

const emit = defineEmits<{
  (e: 'update:config', config: PrivateCommunityConfig): void;
}>();

const isPrivate = ref(props.config.isPrivate);
const method = ref<'invite' | 'password'>(props.config.method);
const password = ref(props.config.password ?? '');

const isValid = computed(() =>
  !isPrivate.value
  || method.value === 'invite'
  || password.value.length >= MIN_PASSWORD_LENGTH,
);

function emitConfig() {
  emit('update:config', {
    isPrivate: isPrivate.value,
    method: method.value,
    password: method.value === 'password' ? password.value : undefined,
    valid: isValid.value,
  });
}

watch(() => props.config, (newConfig) => {
  if (newConfig) {
    isPrivate.value = newConfig.isPrivate;
    method.value = newConfig.method;
    password.value = newConfig.password ?? '';
  }
});

watch([isPrivate, method, password], emitConfig, { immediate: true });
</script>

<style scoped>
.private-toggle {
  border-radius: 12px;
  overflow: hidden;
  background: var(--ion-item-background, var(--ion-color-light));
  margin-bottom: 16px;
}

.toggle-icon {
  color: var(--ion-color-medium);
  font-size: 1.3rem;
}

.encryption-options {
  padding: 8px 16px 16px;
}

.method-info {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-top: 12px;
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--ion-color-light-shade, #eef0f3);
  font-size: 0.85rem;
  color: var(--ion-color-medium);
}

.method-info ion-icon {
  flex-shrink: 0;
  margin-top: 2px;
  font-size: 1.1rem;
}

.method-info p {
  margin: 0;
  line-height: 1.4;
}

.password-warning {
  color: var(--ion-color-danger);
  font-size: 0.8rem;
  margin: 6px 0 0 4px;
}
</style>
