<template>
  <div class="relay-indicator" :class="{ 'relay-indicator--compact': compact }" @click="$emit('open')">

    <!-- compact mode: just the status dot (used in mobile header + bottom nav) -->
    <template v-if="compact">
      <span class="relay-dot" :class="dotClass" aria-label="Relay status"></span>
    </template>

    <!-- full mode: dot + name + meta -->
    <template v-else>
      <span class="relay-dot" :class="dotClass" aria-hidden="true"></span>
      <span class="relay-label">
        <span class="relay-name">{{ relayName }}</span>
        <span class="relay-meta" :class="metaClass">{{ metaLabel }}</span>
      </span>
    </template>

  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { RelayManager } from '../services/relayManager';
import { GunService } from '../services/gunService';

defineProps<{ compact?: boolean }>();
defineEmits<{ open: [] }>();

const activeRelay = ref(RelayManager.getActiveRelay());
const gunPeers    = ref(0);
const probeStatus = ref<'unknown' | 'online' | 'offline'>('unknown');

let cleanupRelay: (() => void) | null = null;
let peerTimer:    ReturnType<typeof setInterval> | null = null;
let probeTimer:   ReturnType<typeof setInterval> | null = null;

// ── Derived status — uses Gun peer count + HTTP probe ──────────────────────
const effectiveStatus = computed(() => {
  const relayStatus = activeRelay.value?.status;
  // If relay reports online, trust it
  if (relayStatus === 'online')   return 'online';
  if (relayStatus === 'offline')  return 'offline';
  if (relayStatus === 'degraded') return 'degraded';
  // Fall back to our own probe result
  if (probeStatus.value === 'online')  return 'online';
  if (probeStatus.value === 'offline') return 'offline';
  // If we have Gun peers, we're effectively connected
  if (gunPeers.value > 0) return 'online';
  return 'unknown';
});

const relayName = computed(() => {
  const r = activeRelay.value;
  if (!r) return 'No relay';
  try { return new URL(r.ws).hostname.replace(/^www\./, ''); }
  catch { return (r.label || r.ws).slice(0, 22); }
});

const metaLabel = computed(() => {
  switch (effectiveStatus.value) {
    case 'online':   return `${gunPeers.value > 0 ? gunPeers.value + ' peers' : 'connected'}`;
    case 'offline':  return 'disconnected';
    case 'degraded': return 'degraded';
    default:         return 'connecting…';
  }
});

const metaClass = computed(() => {
  if (effectiveStatus.value === 'online')  return 'relay-meta--ok';
  if (effectiveStatus.value === 'offline') return 'relay-meta--err';
  return '';
});

const dotClass = computed(() => {
  switch (effectiveStatus.value) {
    case 'online':   return 'dot--online';
    case 'offline':  return 'dot--offline';
    case 'degraded': return 'dot--degraded';
    default:         return 'dot--unknown';
  }
});

// ── Peer health poll ───────────────────────────────────────────────────────
function pollPeers() {
  try {
    const health = GunService.getPeerHealthReport?.() ?? [];
    gunPeers.value = health.filter((p: any) => p.connected).length;
  } catch { /* non-fatal */ }
}

// ── HTTP probe — lightweight /api/health ping ──────────────────────────────
async function probeRelay() {
  const r = activeRelay.value;
  if (!r) return;
  let apiBase = '';
  try {
    apiBase = r.api || r.ws.replace(/\/gun\/?$/, '');
    const res = await fetch(`${apiBase}/api/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(4000),
    });
    probeStatus.value = res.ok ? 'online' : 'offline';
  } catch {
    // If health endpoint doesn't exist, try the bare root
    try {
      await fetch(apiBase || r.ws, { method: 'HEAD', signal: AbortSignal.timeout(3000) });
      probeStatus.value = 'online';
    } catch {
      probeStatus.value = 'offline';
    }
  }
}

function refresh() {
  activeRelay.value = RelayManager.getActiveRelay();
  probeStatus.value = 'unknown';
  void probeRelay();
}

onMounted(() => {
  cleanupRelay = RelayManager.onChange?.(refresh) ?? null;
  pollPeers();
  void probeRelay();
  peerTimer  = setInterval(pollPeers, 4000);
  probeTimer = setInterval(probeRelay, 20_000); // probe every 20s
});

onUnmounted(() => {
  cleanupRelay?.();
  if (peerTimer)  clearInterval(peerTimer);
  if (probeTimer) clearInterval(probeTimer);
});
</script>

<style scoped>
.relay-indicator {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 10px;
  cursor: pointer;
  background: rgba(0,0,0,0.06);
  border: 1px solid var(--app-border);
  transition: var(--app-transition, all 0.15s ease);
  user-select: none;
  width: 100%;
  box-sizing: border-box;
}
.relay-indicator:hover {
  background: rgba(var(--app-accent-rgb),0.07);
  border-color: rgba(var(--app-accent-rgb),0.22);
}

/* compact — just the dot, no background */
.relay-indicator--compact {
  padding: 0;
  background: none;
  border: none;
  width: auto;
  display: inline-flex;
}

.relay-label {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
  flex: 1;
}
.relay-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--app-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.relay-meta {
  font-size: 10px;
  color: var(--app-text-subtle);
  white-space: nowrap;
}
.relay-meta--ok  { color: var(--app-success, #34d399); }
.relay-meta--err { color: var(--app-danger,  #f87171); }

/* dots */
.relay-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  transition: background-color 0.4s ease;
}
.dot--online {
  background: var(--app-success, #34d399);
  box-shadow: 0 0 6px rgba(52,211,153,0.55);
  animation: dot-pulse 2.4s ease-in-out infinite;
}
@keyframes dot-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(52,211,153,0.4); }
  50%       { box-shadow: 0 0 0 5px rgba(52,211,153,0); }
}
.dot--offline  { background: var(--app-danger, #f87171); }
.dot--degraded { background: var(--app-warning, #fbbf24); }
.dot--unknown  {
  background: rgba(255,255,255,0.2);
  animation: dot-blink 1.6s ease-in-out infinite;
}
@keyframes dot-blink {
  0%, 100% { opacity: 0.3; }
  50%       { opacity: 0.8; }
}
</style>
