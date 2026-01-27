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
    console.log('Chain initialized successfully');
  } catch (error) {
    console.error('Failed to initialize chain:', error);
  }
});
</script>
