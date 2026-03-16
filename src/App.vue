<template>
  <ion-app>
    <ion-router-outlet />
    <ConsentBanner />
  </ion-app>
</template>

<script setup lang="ts">
import { IonApp, IonRouterOutlet } from '@ionic/vue';
import { onMounted, onUnmounted } from 'vue';
import { useChainStore } from './stores/chainStore';
import { WebSocketService } from './services/websocketService';
import { GunService } from './services/gunService';
import ConsentBanner from './components/ConsentBanner.vue';

const chainStore = useChainStore();

let visibilityHandler: (() => void) | null = null;

onMounted(async () => {
  // Restore dark mode from localStorage on app startup
  const storedTheme = localStorage.getItem('theme');
  if (storedTheme === 'dark') {
    document.documentElement?.classList.add('dark');
    document.body?.classList.add('dark');
  }

  try {
    await chainStore.initialize();
  } catch (_error) {
    // Chain initialization failed
  }

  // iOS/Safari: reconnect when app returns to foreground
  visibilityHandler = () => {
    if (document.visibilityState === 'visible') {
      setTimeout(() => {
        if (!WebSocketService.getConnectionStatus()) {
          WebSocketService.reconnect();
        }
        const gunStats = GunService.getPeerStats();
        if (!gunStats.isConnected) {
          GunService.reconnect();
        }
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
