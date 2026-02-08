<template>
  <ion-app>
    <ion-router-outlet />
  </ion-app>
</template>

<script setup lang="ts">
import { IonApp, IonRouterOutlet } from '@ionic/vue';
import { onMounted } from 'vue';
import { useChainStore } from './stores/chainStore';

const chainStore = useChainStore();

onMounted(async () => {
  try {
    await chainStore.initialize();
  } catch (_error) {
    // Chain initialization failed
  }
});
</script>
