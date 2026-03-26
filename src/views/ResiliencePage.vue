<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button default-href="/home"></ion-back-button>
        </ion-buttons>
        <ion-title>Resilience Tools</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">

      <!-- 1. Network Status -->
      <ion-card>
        <ion-card-header>
          <ion-card-title>Network Status</ion-card-title>
        </ion-card-header>
        <ion-card-content>
          <div class="flex items-center gap-3 mb-3">
            <ion-badge :color="wsConnected ? 'success' : 'danger'">
              {{ wsConnected ? 'Connected' : 'Disconnected' }}
            </ion-badge>
            <span class="text-sm opacity-70">{{ peerCount }} peer{{ peerCount !== 1 ? 's' : '' }}</span>
            <ion-badge v-if="isTor" color="dark" class="ml-auto">
              <ion-icon :icon="fingerPrintOutline" class="mr-1"></ion-icon> Tor Browser
            </ion-badge>
          </div>

          <ion-button expand="block" :disabled="scanning" @click="scanAllRelays">
            <ion-spinner v-if="scanning" name="crescent" class="mr-2"></ion-spinner>
            {{ scanning ? 'Scanning…' : 'Scan All Relays' }}
          </ion-button>

          <!-- Probe results table -->
          <div v-if="probeResults.length" class="mt-4 overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="text-left opacity-70">
                  <th class="pb-2">Relay</th>
                  <th class="pb-2">WS</th>
                  <th class="pb-2">Gun</th>
                  <th class="pb-2">API</th>
                  <th class="pb-2">Latency</th>
                  <th class="pb-2">Status</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="r in probeResults" :key="r.relayId" class="border-t border-gray-700/30">
                  <td class="py-2">{{ relayLabelById(r.relayId) }}</td>
                  <td><ion-icon :icon="ellipse" :color="r.ws.reachable ? 'success' : 'danger'" size="small" /></td>
                  <td><ion-icon :icon="ellipse" :color="r.gun.reachable ? 'success' : 'danger'" size="small" /></td>
                  <td><ion-icon :icon="ellipse" :color="r.api.reachable ? 'success' : 'danger'" size="small" /></td>
                  <td>{{ latencyDisplay(r) }}</td>
                  <td>
                    <div class="flex items-center gap-1">
                      <ion-icon
                        :icon="ellipse"
                        :color="r.overall === 'online' ? 'success' : r.overall === 'degraded' ? 'warning' : 'danger'"
                        size="small"
                      />
                      {{ r.overall }}
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- Censorship detection -->
          <div v-if="censorship" class="mt-3 p-3 rounded-xl text-sm glass-inset">
            <p v-if="censorship.blocked.length" class="text-red-400 flex items-center gap-1">
              <ion-icon :icon="warningOutline" /> {{ censorship.blocked.length }} relay(s) appear blocked from your network.
            </p>
            <p v-if="censorship.torRequired.length" class="text-yellow-400 flex items-center gap-1">
              <ion-icon :icon="lockClosedOutline" /> {{ censorship.torRequired.length }} relay(s) require Tor to reach.
            </p>
            <p v-if="!censorship.blocked.length && !censorship.torRequired.length" class="text-green-400 flex items-center gap-1">
              <ion-icon :icon="checkmarkCircleOutline" /> No censorship detected -- all relays reachable.
            </p>
          </div>
        </ion-card-content>
      </ion-card>

      <!-- 2. Relay Management -->
      <ion-card>
        <ion-card-header>
          <ion-card-title>Relay Management</ion-card-title>
        </ion-card-header>
        <ion-card-content>
          <ion-list>
            <ion-item
              v-for="relay in relays"
              :key="relay.id"
              :class="{ 'border-l-4 border-green-500': activeRelay?.id === relay.id }"
            >
              <ion-label>
                <h2 class="flex items-center gap-2">
                  {{ relay.label }}
                  <ion-badge v-if="relay.isTor" color="dark" class="text-xs"><ion-icon :icon="lockClosedOutline" class="mr-1" />Tor</ion-badge>
                  <ion-badge :color="statusColor(relay.status)">{{ relay.status }}</ion-badge>
                </h2>
                <p class="text-xs opacity-60">{{ relay.ws }}</p>
                <p class="text-xs opacity-50">Priority: {{ relay.priority }}</p>
              </ion-label>
              <div slot="end" class="flex gap-1">
                <ion-button
                  v-if="activeRelay?.id !== relay.id"
                  size="small"
                  fill="outline"
                  @click="switchRelay(relay.id)"
                >
                  Switch
                </ion-button>
                <ion-button size="small" fill="clear" @click="probeSingle(relay)">
                  <ion-icon :icon="refreshOutline" slot="icon-only"></ion-icon>
                </ion-button>
                <ion-button
                  v-if="relays.length > 1"
                  size="small"
                  fill="clear"
                  color="danger"
                  @click="removeRelay(relay.id)"
                >
                  <ion-icon :icon="trashOutline" slot="icon-only"></ion-icon>
                </ion-button>
              </div>
            </ion-item>
          </ion-list>

          <!-- Auto-failover toggle -->
          <ion-item lines="none" class="mt-2">
            <ion-toggle v-model="autoFailoverEnabled">
              Auto-failover to next relay
            </ion-toggle>
          </ion-item>

          <!-- Add Relay form -->
          <div class="mt-4 p-3 glass-inset">
            <h3 class="font-semibold mb-2">Add Relay</h3>
            <ion-input
              v-model="newRelay.label"
              placeholder="Label"
              class="mb-2"
              fill="outline"
            ></ion-input>
            <ion-input
              v-model="newRelay.ws"
              placeholder="WebSocket URL (wss://...)"
              class="mb-2"
              fill="outline"
            ></ion-input>
            <ion-input
              v-model="newRelay.gun"
              placeholder="Gun URL (https://...)"
              class="mb-2"
              fill="outline"
            ></ion-input>
            <ion-input
              v-model="newRelay.api"
              placeholder="API URL (https://...)"
              class="mb-2"
              fill="outline"
            ></ion-input>
            <div class="flex items-center justify-between">
              <ion-item lines="none" class="p-0">
                <ion-toggle v-model="newRelay.isTor">Tor (.onion)</ion-toggle>
              </ion-item>
              <ion-button :disabled="!canAddRelay" @click="addRelay">Add</ion-button>
            </div>
          </div>
        </ion-card-content>
      </ion-card>

      <!-- 3. Snapshot Manager -->
      <ion-card>
        <ion-card-header>
          <ion-card-title>Snapshot Manager</ion-card-title>
        </ion-card-header>
        <ion-card-content>
          <!-- Export -->
          <div class="mb-4">
            <h3 class="font-semibold mb-2">Export</h3>
            <ion-button expand="block" :disabled="exporting" @click="exportSnapshot">
              <ion-spinner v-if="exporting" name="crescent" class="mr-2"></ion-spinner>
              <ion-icon v-else :icon="downloadOutline" class="mr-2"></ion-icon>
              {{ exporting ? 'Exporting…' : 'Export Full Snapshot' }}
            </ion-button>
          </div>

          <!-- Import -->
          <div class="mb-4">
            <h3 class="font-semibold mb-2">Import</h3>
            <div class="mb-2 p-2 glass-inset text-xs opacity-70 border border-yellow-500/20">
              <ion-icon :icon="shieldCheckmarkOutline" class="mr-1 align-middle" />
              Only import snapshots from people you trust. A malicious snapshot could inject harmful content into your local data.
            </div>
            <input
              ref="fileInputRef"
              type="file"
              accept=".json"
              class="hidden"
              @change="handleFileSelect"
            />
            <ion-button expand="block" :disabled="importing" fill="outline" @click="triggerFileInput">
              <ion-icon :icon="cloudUploadOutline" class="mr-2"></ion-icon>
              {{ importing ? 'Importing...' : 'Import Snapshot File' }}
            </ion-button>
            <div v-if="importProgress" class="mt-2">
              <div class="w-full bg-gray-700 rounded-full h-2">
                <div
                  class="bg-green-500 h-2 rounded-full transition-all"
                  :style="{ width: importProgress.percent + '%' }"
                ></div>
              </div>
              <p class="text-xs opacity-60 mt-1">
                {{ importProgress.phase }} — {{ importProgress.current }}/{{ importProgress.total }}
              </p>
            </div>
          </div>

          <!-- P2P Share -->
          <div>
            <h3 class="font-semibold mb-2">P2P Share</h3>
            <ion-button expand="block" :disabled="sharing" fill="outline" @click="shareWithPeers">
              <ion-spinner v-if="sharing" name="crescent" class="mr-2"></ion-spinner>
              {{ sharing ? 'Sharing…' : 'Share with Peers' }}
            </ion-button>

            <!-- Incoming offer -->
            <div v-if="incomingOffer" class="mt-3 p-3 glass-inset border border-blue-500/30">
              <p class="font-semibold mb-1 flex items-center gap-1"><ion-icon :icon="downloadOutline" /> Incoming Snapshot Offer</p>
              <p class="text-sm opacity-70">
                {{ incomingOffer.meta.communityCount }} communities ·
                {{ incomingOffer.meta.postCount }} posts ·
                Block #{{ incomingOffer.meta.blockHeight }}
              </p>
              <div class="flex gap-2 mt-2">
                <ion-button size="small" color="success" @click="acceptOffer">Accept</ion-button>
                <ion-button size="small" color="medium" fill="outline" @click="rejectOffer">Reject</ion-button>
              </div>
            </div>

            <!-- Transfer progress -->
            <div v-if="transferProgress" class="mt-2">
              <div class="w-full bg-gray-700 rounded-full h-2">
                <div
                  class="bg-blue-500 h-2 rounded-full transition-all"
                  :style="{ width: transferProgress.percent + '%' }"
                ></div>
              </div>
              <p class="text-xs opacity-60 mt-1">
                {{ transferProgress.direction }} — {{ transferProgress.percent }}%
              </p>
            </div>
          </div>
        </ion-card-content>
      </ion-card>

      <!-- 4. Advanced Tools -->
      <ion-card>
        <ion-card-header>
          <ion-card-title>Advanced Tools</ion-card-title>
        </ion-card-header>
        <ion-card-content>
          <ion-item lines="none">
            <ion-toggle v-model="webrtcEnabled">
              Peer Snapshot Sync
            </ion-toggle>
          </ion-item>
          <p class="text-xs opacity-50 mt-1 px-4">
            Enable relay-mediated peer-to-peer snapshot sharing (experimental).
          </p>

          <div class="mt-4 p-3 glass-inset">
            <p class="text-sm">
              <strong>Tor headless peer:</strong> Run a relay peer through the Tor network:
            </p>
            <code class="block mt-1 p-2 rounded text-xs bg-black/30">
              node peer.js --proxy socks5h://127.0.0.1:9050
            </code>
          </div>
        </ion-card-content>
      </ion-card>

      <!-- 5. Guides -->
      <ion-card>
        <ion-card-header>
          <ion-card-title>Guides</ion-card-title>
        </ion-card-header>
        <ion-card-content>
          <!-- Using Tor Browser -->
          <div class="mb-3">
            <ion-item
              button
              lines="none"
              @click="expandedGuide = expandedGuide === 'tor' ? null : 'tor'"
            >
              <ion-label class="font-semibold"><ion-icon :icon="lockClosedOutline" class="mr-2 align-middle" />Using Tor Browser</ion-label>
              <ion-icon
                :icon="expandedGuide === 'tor' ? chevronUpOutline : chevronDownOutline"
                slot="end"
              ></ion-icon>
            </ion-item>
            <div v-if="expandedGuide === 'tor'" class="px-4 pb-3 text-sm opacity-80">
              <ol class="list-decimal list-inside space-y-1">
                <li>Download and install <a href="https://www.torproject.org" target="_blank" class="text-blue-400 underline">Tor Browser</a>.</li>
                <li>Open InterPoll in Tor Browser using the app URL.</li>
                <li>Go to <strong>Settings → Network</strong> and add a <code>.onion</code> relay address.</li>
                <li>The app will automatically detect Tor Browser and route traffic accordingly.</li>
                <li>Verify the Tor badge appears in the Network Status card above.</li>
              </ol>
            </div>
          </div>

          <!-- Self-Hosting a Relay -->
          <div class="mb-3">
            <ion-item
              button
              lines="none"
              @click="expandedGuide = expandedGuide === 'relay' ? null : 'relay'"
            >
              <ion-label class="font-semibold"><ion-icon :icon="serverOutline" class="mr-2 align-middle" />Self-Hosting a Relay</ion-label>
              <ion-icon
                :icon="expandedGuide === 'relay' ? chevronUpOutline : chevronDownOutline"
                slot="end"
              ></ion-icon>
            </ion-item>
            <div v-if="expandedGuide === 'relay'" class="px-4 pb-3 text-sm opacity-80">
              <ol class="list-decimal list-inside space-y-1">
                <li>Navigate to the <code>gun-relay-server/</code> directory in the project root.</li>
                <li>Run <code>npm install</code> to install dependencies.</li>
                <li>Start with <code>npm start</code> — runs GunDB relay on port 8765 and WebSocket relay on port 8080.</li>
                <li>Configure a reverse proxy (nginx/Caddy) with TLS for production.</li>
                <li>Add your relay URL in <strong>Relay Management</strong> above.</li>
              </ol>
            </div>
          </div>

          <!-- Running a Headless Peer -->
          <div>
            <ion-item
              button
              lines="none"
              @click="expandedGuide = expandedGuide === 'peer' ? null : 'peer'"
            >
              <ion-label class="font-semibold"><ion-icon :icon="hardwareChipOutline" class="mr-2 align-middle" />Running a Headless Peer</ion-label>
              <ion-icon
                :icon="expandedGuide === 'peer' ? chevronUpOutline : chevronDownOutline"
                slot="end"
              ></ion-icon>
            </ion-item>
            <div v-if="expandedGuide === 'peer'" class="px-4 pb-3 text-sm opacity-80">
              <ol class="list-decimal list-inside space-y-1">
                <li>Run <code>node peer.js</code> from the project root to start a headless sync peer.</li>
                <li>The peer keeps data available for new clients even when no browsers are open.</li>
                <li>For Tor routing: <code>node peer.js --proxy socks5h://127.0.0.1:9050</code></li>
                <li>Run as a systemd service for 24/7 uptime.</li>
              </ol>
            </div>
          </div>
        </ion-card-content>
      </ion-card>

    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import {
  IonPage, IonHeader, IonToolbar, IonTitle, IonContent,
  IonCard, IonCardHeader, IonCardTitle, IonCardContent,
  IonButton, IonIcon, IonSpinner, IonToggle, IonBadge,
  IonItem, IonLabel, IonList, IonInput, IonButtons, IonBackButton,
  toastController,
} from '@ionic/vue';
import {
  refreshOutline, downloadOutline, cloudUploadOutline,
  trashOutline, fingerPrintOutline, chevronDownOutline, chevronUpOutline,
  ellipse, warningOutline, lockClosedOutline, checkmarkCircleOutline,
  serverOutline, hardwareChipOutline, shieldCheckmarkOutline,
} from 'ionicons/icons';
import { RelayManager } from '../services/relayManager';
import { RelayHealthService } from '../services/relayHealthService';
import { SnapshotService } from '../services/snapshotService';
import { SnapshotSyncService } from '../services/snapshotSyncService';
import { WebSocketService } from '../services/websocketService';
import type { RelayEndpoint } from '../services/relayManager';
import type { RelayProbeResult } from '../services/relayHealthService';
import type { NetworkSnapshot } from '../services/snapshotService';

// --- State ---
const relays = ref<RelayEndpoint[]>([]);
const activeRelay = ref<RelayEndpoint | null>(null);
const wsConnected = ref(false);
const peerCount = ref(0);
const isTor = ref(false);

const scanning = ref(false);
const probeResults = ref<RelayProbeResult[]>([]);
const censorship = ref<{ blocked: RelayEndpoint[]; reachable: RelayEndpoint[]; torRequired: RelayEndpoint[] } | null>(null);

const autoFailoverEnabled = ref(localStorage.getItem('interpoll_auto_failover') === 'true');
const newRelay = ref({ label: '', ws: '', gun: '', api: '', isTor: false, priority: 10 });

const exporting = ref(false);
const importing = ref(false);
const importProgress = ref<{ phase: string; current: number; total: number; percent: number } | null>(null);
const fileInputRef = ref<HTMLInputElement | null>(null);

const sharing = ref(false);
const incomingOffer = ref<{ peerId: string; size: number; hash: string; meta: { postCount: number; communityCount: number; blockHeight: number } } | null>(null);
const transferProgress = ref<{ direction: string; current: number; total: number; percent: number } | null>(null);

const webrtcEnabled = ref(localStorage.getItem('interpoll_webrtc_enabled') === 'true');
const expandedGuide = ref<string | null>(null);

const cleanups: (() => void)[] = [];
const syncCleanups: (() => void)[] = [];
let importClearTimer: ReturnType<typeof setTimeout> | null = null;

// --- Computed ---
const canAddRelay = computed(() => {
  const { label, ws, gun, api } = newRelay.value;
  return label.trim()
    && /^wss?:\/\/.+/.test(ws.trim())
    && /^https?:\/\/.+/.test(gun.trim())
    && /^https?:\/\/.+/.test(api.trim());
});

// --- Helpers ---
function relayLabelById(id: string): string {
  return relays.value.find(r => r.id === id)?.label ?? id;
}

function avgLatency(r: RelayProbeResult): string {
  const vals = [r.ws, r.gun, r.api].filter(v => v.reachable).map(v => v.latencyMs);
  return vals.length ? String(Math.round(vals.reduce((a, b) => a + b, 0) / vals.length)) : '—';
}

function latencyDisplay(r: RelayProbeResult): string {
  const avg = avgLatency(r);
  return avg !== '—' ? `${avg}ms` : '—';
}

function statusColor(status: string): string {
  switch (status) {
    case 'online': return 'success';
    case 'degraded': return 'warning';
    case 'offline': return 'danger';
    default: return 'medium';
  }
}

async function showToast(message: string) {
  const toast = await toastController.create({ message, duration: 2500, position: 'bottom' });
  await toast.present();
}

function refreshStatus() {
  relays.value = RelayManager.getRelayList();
  activeRelay.value = RelayManager.getActiveRelay();
  wsConnected.value = WebSocketService.getConnectionStatus();
  peerCount.value = WebSocketService.getPeerCount();
  isTor.value = RelayHealthService.isTorBrowser();
}

// --- Actions ---
async function scanAllRelays() {
  scanning.value = true;
  try {
    const results = await RelayHealthService.probeAll(relays.value);
    probeResults.value = results;
    censorship.value = RelayHealthService.detectCensorship(results, relays.value);
    await showToast(`Scanned ${results.length} relay(s)`);
  } catch (e: unknown) {
    await showToast(e instanceof Error ? e.message : 'Scan failed');
  } finally {
    scanning.value = false;
  }
}

async function switchRelay(id: string) {
  try {
    await RelayManager.switchToRelay(id);
    refreshStatus();
    await showToast('Switched relay');
  } catch (e: unknown) {
    await showToast(e instanceof Error ? e.message : 'Switch failed');
  }
}

async function probeSingle(relay: RelayEndpoint) {
  try {
    await RelayManager.probeRelay(relay);
    refreshStatus();
    await showToast(`${relay.label}: probed`);
  } catch (e: unknown) {
    await showToast(e instanceof Error ? e.message : 'Probe failed');
  }
}

async function removeRelay(id: string) {
  if (activeRelay.value?.id === id) {
    await showToast('Cannot remove the active relay — switch first.');
    return;
  }
  RelayManager.removeRelay(id);
  refreshStatus();
}

watch(autoFailoverEnabled, (val) => {
  localStorage.setItem('interpoll_auto_failover', String(val));
});

function addRelay() {
  if (!canAddRelay.value) return;
  RelayManager.addRelay({
    label: newRelay.value.label.trim(),
    ws: newRelay.value.ws.trim(),
    gun: newRelay.value.gun.trim(),
    api: newRelay.value.api.trim(),
    isTor: newRelay.value.isTor,
    priority: newRelay.value.priority,
  });
  newRelay.value = { label: '', ws: '', gun: '', api: '', isTor: false, priority: 10 };
  refreshStatus();
}

async function exportSnapshot() {
  exporting.value = true;
  try {
    const snapshot = await SnapshotService.export();
    SnapshotService.downloadSnapshot(snapshot);
    await showToast('Snapshot exported');
  } catch (e: unknown) {
    await showToast(e instanceof Error ? e.message : 'Export failed');
  } finally {
    exporting.value = false;
  }
}

function triggerFileInput() {
  fileInputRef.value?.click();
}

async function handleFileSelect(event: Event) {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) return;
  importing.value = true;
  importProgress.value = null;
  try {
    const snapshot = await SnapshotService.parseSnapshotFile(file);
    const result = await SnapshotService.import(snapshot, (phase, current, total) => {
      importProgress.value = { phase: String(phase), current, total, percent: total > 0 ? Math.round((current / total) * 100) : 0 };
    });
    const { blocks, posts, communities, comments, users, events } = result.imported;
    await showToast(`Imported ${posts} posts, ${communities} communities, ${blocks} blocks, ${comments} comments, ${users} users, ${events} events`);
  } catch (e: unknown) {
    await showToast(e instanceof Error ? e.message : 'Import failed');
  } finally {
    importing.value = false;
    importClearTimer = setTimeout(() => { importProgress.value = null; }, 1200);
    target.value = '';
  }
}

async function shareWithPeers() {
  sharing.value = true;
  try {
    const snapshot = await SnapshotService.export();
    await SnapshotSyncService.offerSnapshot(snapshot);
    await showToast('Snapshot offered to peers');
  } catch (e: unknown) {
    await showToast(e instanceof Error ? e.message : 'Share failed');
  } finally {
    sharing.value = false;
  }
}

async function acceptOffer() {
  if (!incomingOffer.value) return;
  try {
    await SnapshotSyncService.acceptOffer(incomingOffer.value.peerId);
    incomingOffer.value = null;
  } catch (e: unknown) {
    await showToast(e instanceof Error ? e.message : 'Accept failed');
  }
}

function rejectOffer() {
  incomingOffer.value = null;
}

watch(webrtcEnabled, async (val) => {
  localStorage.setItem('interpoll_webrtc_enabled', String(val));
  if (val) {
    try { await SnapshotSyncService.initialize(); } catch { /* unavailable */ }
    registerSyncCallbacks();
  } else {
    syncCleanups.forEach(fn => fn());
    syncCleanups.length = 0;
    SnapshotSyncService.cleanup();
  }
});

function registerSyncCallbacks() {
  syncCleanups.forEach(fn => fn());
  syncCleanups.length = 0;
  syncCleanups.push(SnapshotSyncService.onOffer((offer) => {
    incomingOffer.value = offer;
  }));
  syncCleanups.push(SnapshotSyncService.onProgress((progress) => {
    transferProgress.value = progress;
  }));
  syncCleanups.push(SnapshotSyncService.onComplete(async (snapshot: NetworkSnapshot) => {
    transferProgress.value = null;
    try {
      await SnapshotService.import(snapshot, (phase, current, total) => {
        importProgress.value = {
          phase: String(phase), current, total,
          percent: total > 0 ? Math.round((current / total) * 100) : 0,
        };
      });
      importProgress.value = null;
      await showToast('Snapshot received and imported from peer');
    } catch (e: unknown) {
      importProgress.value = null;
      await showToast(e instanceof Error ? e.message : 'Import of received snapshot failed');
    }
  }));
  syncCleanups.push(SnapshotSyncService.onError((error: string) => {
    transferProgress.value = null;
    showToast(error);
  }));
}

// --- Lifecycle ---
onMounted(async () => {
  RelayManager.initialize();
  refreshStatus();

  cleanups.push(RelayManager.onRelayListChange(() => refreshStatus()));

  cleanups.push(WebSocketService.onStatusChange((status) => {
    wsConnected.value = status.connected;
    peerCount.value = status.peerCount;
  }));

  if (webrtcEnabled.value) {
    try {
      await SnapshotSyncService.initialize();
    } catch {
      // SnapshotSyncService may fail if unavailable
    }
    registerSyncCallbacks();
  }
});

onUnmounted(() => {
  if (importClearTimer) clearTimeout(importClearTimer);
  cleanups.forEach(fn => fn());
  syncCleanups.forEach(fn => fn());
  SnapshotSyncService.cleanup();
});
</script>

<style scoped>
table th,
table td {
  padding: 6px 8px;
}

code {
  font-family: 'Fira Code', 'Courier New', monospace;
}

ion-card {
  --background: rgba(var(--ion-color-step-50-rgb, 30, 30, 30), 0.55);
  backdrop-filter: blur(16px) saturate(1.4);
  -webkit-backdrop-filter: blur(16px) saturate(1.4);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 16px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.25);
}

ion-card-header {
  --background: transparent;
}

ion-card-content {
  --background: transparent;
}

ion-item {
  --background: transparent;
}

ion-list {
  --ion-item-background: transparent;
  background: transparent;
}

.glass-inset {
  background: rgba(255, 255, 255, 0.04);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 12px;
}
</style>
