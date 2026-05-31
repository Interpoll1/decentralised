<template>
  <ion-app>
    <AppLoader v-if="!appReady" />
    <div v-else class="app-shell">
      <ion-router-outlet />
      <CommandPalette />
    </div>
  </ion-app>
</template>

<script setup lang="ts">
import { IonApp, IonRouterOutlet } from '@ionic/vue';
import { ref, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { useChainStore } from './stores/chainStore';
import { WebSocketService } from './services/websocketService';
import { GunService } from './services/gunService';
import { warmupFromDB } from './services/dbWarmup';
import AppLoader from './components/AppLoader.vue';
import CommandPalette from './components/CommandPalette.vue';

const chainStore = useChainStore();
const router = useRouter();
const appReady = ref(false);

let visibilityHandler: (() => void) | null = null;
let internalLinkHandler: ((event: MouseEvent) => void) | null = null;

onMounted(async () => {
  const storedTheme = localStorage.getItem('theme');
  if (storedTheme === 'dark') {
    document.documentElement?.classList.add('dark');
    document.body?.classList.add('dark');
  }

  internalLinkHandler = (event: MouseEvent) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }

    const target = event.target;
    if (!(target instanceof Element)) return;

    const anchor = target.closest('a[href]');
    if (!(anchor instanceof HTMLAnchorElement)) return;
    if (anchor.target && anchor.target !== '_self') return;
    if (anchor.hasAttribute('download')) return;

    const rawHref = anchor.getAttribute('href');
    if (!rawHref || rawHref.startsWith('#') || /^(mailto:|tel:|javascript:)/i.test(rawHref)) return;

    const url = new URL(anchor.href, window.location.origin);
    if (url.origin !== window.location.origin) return;

    const destination = `${url.pathname}${url.search}${url.hash}`;
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (destination === current) return;

    event.preventDefault();
    void router.push(destination);
  };
  document.addEventListener('click', internalLinkHandler);

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
  if (internalLinkHandler) {
    document.removeEventListener('click', internalLinkHandler);
  }
});
</script>

<style>
ion-header ion-toolbar:first-of-type {
  padding-top: env(safe-area-inset-top, 0px) !important;
}

ion-app {
  background: transparent;
}
</style>
