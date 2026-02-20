<template>
  <ion-app>
    <!-- Minimal connection dot — expands on hover -->
    <div
      class="network-dot-wrapper"
      :class="networkDotClass"
      @click="handleNetworkDotTap"
    >
      <span class="dot" :class="{ connected: wsConnected && gunConnected }"></span>
      <div class="network-expanded">
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

const networkDotClass = computed(() => {
  if (wsConnected.value && gunConnected.value) return 'dot-connected';
  if (wsConnected.value || gunConnected.value) return 'dot-partial';
  return 'dot-offline';
});

function pollGunStatus() {
  const stats = GunService.getPeerStats();
  gunConnected.value = stats.isConnected;
}

function handleNetworkDotTap() {
  if (wsConnected.value && gunConnected.value) return;
  isReconnecting.value = true;
  WebSocketService.reconnect();
  GunService.reconnect();
  setTimeout(() => {
    isReconnecting.value = false;
    pollGunStatus();
  }, 3000);
}

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

  // Listen for WSS status changes
  statusCleanup = WebSocketService.onStatusChange(({ connected, peerCount: count }) => {
    wsConnected.value = connected;
    peerCount.value = count;
  });

  // Poll Gun.js connection status every 7s
  pollGunStatus();
  gunPollTimer = setInterval(pollGunStatus, 7000);

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
/* ─── Expandable dot ─────────────────────────────────────────── */
.network-dot-wrapper {
  position: fixed;
  bottom: calc(70px + env(safe-area-inset-bottom, 0px));
  left: 12px;
  z-index: 99999;
  display: flex;
  align-items: center;
  gap: 0;
  border-radius: 20px;
  padding: 5px;
  cursor: pointer;
  transition: all 0.3s cubic-bezier(0.23, 1, 0.32, 1);
  -webkit-tap-highlight-color: transparent;
  user-select: none;
  overflow: hidden;
  max-width: 20px;  /* collapsed: just the dot */
  opacity: 1;
}

.network-dot-wrapper:hover {
  max-width: 260px;
  padding: 5px 12px 5px 7px;
  gap: 6px;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}

/* Dot itself */
.dot {
  width: 10px;
  height: 10px;
  min-width: 10px;
  border-radius: 50%;
  background: currentColor;
  transition: background 0.8s ease, box-shadow 0.8s ease, color 0.8s ease;
  flex-shrink: 0;
}

.dot.connected {
  background: #00e639;
  box-shadow: 0 0 8px rgba(0, 230, 57, 0.6);
  animation: dot-flash-green 1.2s ease-out;
}

/* Subtle glow on color change */
@keyframes dot-flash-green {
  0% { box-shadow: 0 0 12px 3px rgba(0, 230, 57, 0.7); }
  100% { box-shadow: 0 0 8px rgba(0, 230, 57, 0.6); }
}

/* Expanded content — hidden until hover */
.network-expanded {
  display: flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
  overflow: hidden;
  opacity: 0;
  transition: opacity 0.2s ease 0.1s;
}

.network-dot-wrapper:hover .network-expanded {
  opacity: 1;
}

.network-label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.3px;
}

.network-peers {
  font-size: 11px;
  opacity: 0.7;
  font-weight: 500;
}

.network-reconnecting {
  font-size: 11px;
  opacity: 0.7;
  font-weight: 500;
  animation: pulse-text 1.5s ease-in-out infinite;
}

@keyframes pulse-text {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 1; }
}

/* Status color variants — max brightness, always-on glow */
.dot-connected {
  color: #00e639;
  transition: color 0.8s ease;
}
.dot-connected:hover {
  background: rgba(0, 230, 57, 0.15);
}

.dot-partial {
  color: #ffaa00;
  transition: color 0.8s ease;
}
.dot-partial .dot {
  background: #ffaa00;
  box-shadow: 0 0 8px rgba(255, 170, 0, 0.6);
  animation: dot-flash-orange 1.2s ease-out;
}
.dot-partial:hover {
  background: rgba(255, 170, 0, 0.15);
}

.dot-offline {
  color: #ff1a1a;
  transition: color 0.8s ease;
}
.dot-offline .dot {
  background: #ff1a1a;
  box-shadow: 0 0 8px rgba(255, 26, 26, 0.6);
  animation: dot-flash-red 1.2s ease-out;
}
.dot-offline:hover {
  background: rgba(255, 26, 26, 0.15);
}

@keyframes dot-flash-orange {
  0% { box-shadow: 0 0 12px 3px rgba(255, 170, 0, 0.7); }
  100% { box-shadow: 0 0 8px rgba(255, 170, 0, 0.6); }
}

@keyframes dot-flash-red {
  0% { box-shadow: 0 0 12px 3px rgba(255, 26, 26, 0.7); }
  100% { box-shadow: 0 0 8px rgba(255, 26, 26, 0.6); }
}
</style>

<style>
/* Remove the old padding offset — no full-width bar anymore */
ion-header ion-toolbar:first-of-type {
  padding-top: env(safe-area-inset-top, 0px) !important;
}
</style>
