<template>
  <ion-app>
    <AppLoader v-if="!appReady" />
    <ion-router-outlet v-else />
  </ion-app>
</template>

<script setup lang="ts">
import { IonApp, IonRouterOutlet } from '@ionic/vue';
import { ref, onMounted, onUnmounted } from 'vue';
import { useChainStore } from './stores/chainStore';
import { WebSocketService } from './services/websocketService';
import { GunService } from './services/gunService';
import { warmupFromDB } from './services/dbWarmup';
import AppLoader from './components/AppLoader.vue';

const chainStore = useChainStore();
const appReady = ref(false);

let visibilityHandler: (() => void) | null = null;

onMounted(async () => {
  const storedTheme = localStorage.getItem('theme');
  if (storedTheme === 'dark') {
    document.documentElement?.classList.add('dark');
    document.body?.classList.add('dark');
  }

  // Show loader until warmup is done — then reveal the app
  try {
    await warmupFromDB();
  } catch (_error) {
    // warmup failed, continue anyway
  } finally {
    appReady.value = true;
  }

  // Non-blocking after app is visible
  try {
    await chainStore.initialize();
  } catch (_error) {}

  visibilityHandler = () => {
    if (document.visibilityState === 'visible') {
      setTimeout(() => {
        if (!WebSocketService.getConnectionStatus()) WebSocketService.reconnect();
        const gunStats = GunService.getPeerStats();
        if (!gunStats.isConnected) GunService.reconnect();
      }, 500);
    }
  };
  document.addEventListener('visibilitychange', visibilityHandler);
});

onUnmounted(() => {
  if (visibilityHandler) {
    document.removeEventListener('visibilitychange', visibilityHandler);
  }
});
</script>

<style>
/* Remove the old padding offset — no full-width bar anymore */
ion-header ion-toolbar:first-of-type {
  padding-top: env(safe-area-inset-top, 0px) !important;
}
</style>
