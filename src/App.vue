<template>
  <ion-app>
    <!-- Persistent Network Status Bar -->
    <div class="network-bar" :class="networkBarClass" @click="handleNetworkBarTap">
      <div class="network-bar-inner">
        <span class="network-dot" :class="{ connected: wsConnected && gunConnected }"></span>
        <span class="network-label">{{ networkLabel }}</span>
        <span v-if="peerCount > 0" class="network-peers">{{ peerCount }} peer{{ peerCount !== 1 ? 's' : '' }}</span>
        <span v-if="isReconnecting" class="network-reconnecting">Reconnecting...</span>
      </div>
    </div>
    <ion-router-outlet />
  </ion-app>
</template>

<script setup lang="ts">
import { IonApp, IonRouterOutlet } from '@ionic/vue';
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useChainStore } from './stores/chainStore';
import { WebSocketService } from './services/websocketService';
import { GunService } from './services/gunService';

const chainStore = useChainStore();

const wsConnected = ref(false);
const gunConnected = ref(false);
const peerCount = ref(0);
const isReconnecting = ref(false);

let statusCleanup: (() => void) | null = null;
let gunPollTimer: ReturnType<typeof setInterval> | null = null;
let visibilityHandler: (() => void) | null = null;

const networkLabel = computed(() => {
  if (wsConnected.value && gunConnected.value) return 'Connected';
  if (wsConnected.value && !gunConnected.value) return 'WSS only';
  if (!wsConnected.value && gunConnected.value) return 'Gun only';
  return 'Offline';
});

const networkBarClass = computed(() => {
  if (wsConnected.value && gunConnected.value) return 'status-connected';
  if (wsConnected.value || gunConnected.value) return 'status-partial';
  return 'status-offline';
});

function pollGunStatus() {
  const stats = GunService.getPeerStats();
  gunConnected.value = stats.isConnected;
}

function handleNetworkBarTap() {
  if (wsConnected.value && gunConnected.value) return;
  // Manual reconnect on tap
  isReconnecting.value = true;
  WebSocketService.reconnect();
  GunService.reconnect();
  setTimeout(() => {
    isReconnecting.value = false;
    pollGunStatus();
  }, 3000);
}

onMounted(async () => {
  try {
    await chainStore.initialize();
  } catch (_error) {
    // Chain initialization failed
  }

  // Listen for WSS status changes
  statusCleanup = WebSocketService.onStatusChange(({ connected, peerCount: count }) => {
    wsConnected.value = connected;
    peerCount.value = count;
  });

  // Poll Gun.js connection status every 5s
  pollGunStatus();
  gunPollTimer = setInterval(pollGunStatus, 5000);

  // iOS/Safari: reconnect when app returns to foreground
  visibilityHandler = () => {
    if (document.visibilityState === 'visible') {
      // Small delay to let the network interface wake up
      setTimeout(() => {
        if (!WebSocketService.getConnectionStatus()) {
          WebSocketService.reconnect();
        }
        const gunStats = GunService.getPeerStats();
        if (!gunStats.isConnected) {
          GunService.reconnect();
        }
        pollGunStatus();
      }, 500);
    }
  };
  document.addEventListener('visibilitychange', visibilityHandler);
});

onUnmounted(() => {
  if (statusCleanup) statusCleanup();
  if (gunPollTimer) clearInterval(gunPollTimer);
  if (visibilityHandler) {
    document.removeEventListener('visibilitychange', visibilityHandler);
  }
});
</script>

<style scoped>
.network-bar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 99999;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.3px;
  cursor: pointer;
  transition: background 0.3s ease, color 0.3s ease;
  -webkit-tap-highlight-color: transparent;
  user-select: none;
  padding-top: env(safe-area-inset-top, 0px);
  box-sizing: content-box;
}

.network-bar-inner {
  display: flex;
  align-items: center;
  gap: 6px;
}

.network-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.7;
}

.network-dot.connected {
  background: #34c759;
  opacity: 1;
  box-shadow: 0 0 6px rgba(52, 199, 89, 0.5);
}

.network-peers {
  opacity: 0.7;
  font-weight: 500;
}

.network-reconnecting {
  opacity: 0.7;
  font-weight: 500;
  animation: pulse-text 1.5s ease-in-out infinite;
}

@keyframes pulse-text {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 1; }
}

/* Status colors */
.status-connected {
  background: rgba(52, 199, 89, 0.12);
  color: #28a745;
}

.status-partial {
  background: rgba(255, 149, 0, 0.15);
  color: #e08600;
}

.status-offline {
  background: rgba(255, 59, 48, 0.15);
  color: #dc3545;
}

/* Push ion-router-outlet down to make room for the bar */
ion-app {
  --network-bar-height: calc(28px + env(safe-area-inset-top, 0px));
}
</style>

<style>
/* Global: offset all ion-header toolbars to account for network bar */
ion-header ion-toolbar:first-of-type {
  padding-top: calc(28px + env(safe-area-inset-top, 0px)) !important;
}
</style>
