<template>
  <ion-page>
    <ion-content class="ion-padding">
      <div class="callback-container">
        <ion-spinner></ion-spinner>
        <p>Signing you in...</p>
      </div>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { IonPage, IonContent, IonSpinner } from '@ionic/vue';
import { AuditService } from '../services/auditService';

const router = useRouter();

onMounted(async () => {
  // Validate the session cookie against the backend and cache the user
  await AuditService.getCloudUser();

  // Navigate back to where the user was before login
  const returnUrl = AuditService.consumeReturnUrl();
  router.replace(returnUrl);
});
</script>

<style scoped>
.callback-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 16px;
}

.callback-container p {
  color: var(--ion-color-medium);
  font-size: 16px;
}
</style>
