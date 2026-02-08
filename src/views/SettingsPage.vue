<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button default-href="/home"></ion-back-button>
        </ion-buttons>
        <ion-title>Settings</ion-title>
      </ion-toolbar>

      <ion-toolbar>
        <ion-segment v-model="activeTab">
          <ion-segment-button value="general">
            <ion-label>General</ion-label>
          </ion-segment-button>
          <ion-segment-button value="network">
            <ion-label>Network</ion-label>
          </ion-segment-button>
          <ion-segment-button value="data">
            <ion-label>Data</ion-label>
          </ion-segment-button>
        </ion-segment>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <!-- GENERAL TAB -->
      <div v-if="activeTab === 'general'">
        <!-- Appearance -->
        <ion-card>
          <ion-card-header>
            <ion-card-title>Appearance</ion-card-title>
          </ion-card-header>

          <ion-card-content>
            <ion-list>
              <ion-item>
                <ion-toggle v-model="isDarkMode" @ionChange="toggleDarkMode">
                  {{ isDarkMode ? 'Dark mode' : 'Light mode' }}
                </ion-toggle>
              </ion-item>
            </ion-list>
          </ion-card-content>
        </ion-card>

        <!-- Content Filters -->
        <ion-card>
          <ion-card-header>
            <ion-card-title>Content Filters</ion-card-title>
            <ion-card-subtitle>Hide low-reputation users</ion-card-subtitle>
          </ion-card-header>

          <ion-card-content>
            <ion-list>
              <ion-item>
                <ion-label>Minimum user karma</ion-label>
                <ion-select v-model="minUserKarma" @ionChange="saveFilterSettings">
                  <ion-select-option :value="-1000">Show everyone</ion-select-option>
                  <ion-select-option :value="-10">Hide below -10</ion-select-option>
                  <ion-select-option :value="0">Hide below 0</ion-select-option>
                  <ion-select-option :value="10">Hide below 10</ion-select-option>
                  <ion-select-option :value="50">Hide below 50</ion-select-option>
                  <ion-select-option :value="100">Hide below 100</ion-select-option>
                </ion-select>
              </ion-item>
            </ion-list>
            <p class="helper-text">
              Posts and comments from users with karma below this threshold will be hidden from your feed.
            </p>
          </ion-card-content>
        </ion-card>

        <!-- Account -->
        <ion-card>
          <ion-card-header>
            <ion-card-title>Account</ion-card-title>
          </ion-card-header>

          <ion-card-content>
            <div class="info-grid">
              <div class="info-row">
                <span>Device ID</span>
                <code>{{ fullDeviceId }}</code>
              </div>
              <div class="info-row">
                <span>Username</span>
                <strong>{{ userProfile?.username }}</strong>
              </div>
              <div class="info-row">
                <span>Karma</span>
                <ion-badge color="primary">{{ userProfile?.karma || 0 }}</ion-badge>
              </div>
              <div class="info-row" v-if="cloudUser">
                <span>Cloud login</span>
                <strong>{{ cloudUser?.email || cloudUser?.name }}</strong>
              </div>
              <div class="info-row" v-if="cloudUser">
                <span>Provider</span>
                <ion-badge color="secondary">{{ cloudUser?.provider }}</ion-badge>
              </div>
            </div>

            <ion-button expand="block" fill="outline" @click="$router.push('/profile')">
              <ion-icon slot="start" :icon="personCircleOutline"></ion-icon>
              Edit Profile
            </ion-button>

            <template v-if="cloudUser">
              <ion-button expand="block" class="mt-2" fill="outline" color="danger" @click="handleLogout">
                <ion-icon slot="start" :icon="logOutOutline"></ion-icon>
                Sign Out ({{ cloudUser.provider }})
              </ion-button>
            </template>

            <template v-else>
              <ion-button expand="block" class="mt-2" fill="outline" color="dark" @click="loginWithGoogle">
                <ion-icon slot="start" :icon="logoGoogle"></ion-icon>
                Sign in with Google
              </ion-button>

              <ion-button expand="block" class="mt-2" fill="outline" color="tertiary" @click="loginWithMicrosoft">
                <ion-icon slot="start" :icon="logoMicrosoft"></ion-icon>
                Sign in with Microsoft
              </ion-button>
            </template>
          </ion-card-content>
        </ion-card>
      </div>

      <!-- NETWORK TAB -->
      <div v-if="activeTab === 'network'">
        <!-- Connection Status -->
        <ion-card>
          <ion-card-header>
            <div class="status-header">
              <ion-card-title>Connection Status</ion-card-title>
              <div class="status-indicator" :class="connectionStatusClass">
                <span class="status-dot"></span>
                {{ connectionStatusLabel }}
              </div>
            </div>
          </ion-card-header>

          <ion-card-content>
            <!-- Individual service status -->
            <div class="service-status-list">
              <div class="service-status-row">
                <div class="service-info">
                  <span class="service-dot" :class="{ online: networkStatus.wsConnected }"></span>
                  <span class="service-name">WebSocket Relay</span>
                </div>
                <span class="service-state" :class="networkStatus.wsConnected ? 'state-ok' : 'state-off'">
                  {{ networkStatus.wsConnected ? 'Connected' : 'Disconnected' }}
                </span>
              </div>
              <div class="service-status-row">
                <div class="service-info">
                  <span class="service-dot" :class="{ online: networkStatus.gunConnected }"></span>
                  <span class="service-name">GunDB Relay</span>
                </div>
                <span class="service-state" :class="networkStatus.gunConnected ? 'state-ok' : 'state-off'">
                  {{ networkStatus.gunConnected ? 'Connected' : 'Disconnected' }}
                </span>
              </div>
            </div>

            <div class="metrics-grid">
              <div class="metric-card">
                <div class="metric-value">{{ networkStatus.peerCount }}</div>
                <div class="metric-label">Active Peers</div>
              </div>
              <div class="metric-card">
                <div class="metric-value">{{ networkStatus.gunPeerCount }}</div>
                <div class="metric-label">DB Peers</div>
              </div>
              <div class="metric-card">
                <div class="metric-value">{{ networkStatus.blockHeight }}</div>
                <div class="metric-label">Block Height</div>
              </div>
              <div class="metric-card">
                <div class="metric-value" :class="networkStatus.chainValid ? 'text-success' : 'text-danger'">
                  {{ networkStatus.chainValid ? 'Valid' : 'Invalid' }}
                </div>
                <div class="metric-label">Chain Status</div>
              </div>
            </div>
          </ion-card-content>
        </ion-card>

        <!-- Relay Configuration -->
        <ion-card>
          <ion-card-header>
            <div class="status-header">
              <ion-card-title>Relay Configuration</ion-card-title>
              <ion-badge v-if="hasCustomRelay" color="warning">Custom</ion-badge>
            </div>
            <ion-card-subtitle>Change the servers your node connects to</ion-card-subtitle>
          </ion-card-header>

          <ion-card-content>
            <div class="relay-form">
              <div class="relay-field">
                <label class="relay-label">WebSocket Relay</label>
                <input
                  v-model="editRelay.websocket"
                  type="text"
                  class="relay-input"
                  placeholder="ws://localhost:8080"
                />
              </div>
              <div class="relay-field">
                <label class="relay-label">GunDB Relay</label>
                <input
                  v-model="editRelay.gun"
                  type="text"
                  class="relay-input"
                  placeholder="http://localhost:8765/gun"
                />
              </div>
              <div class="relay-field">
                <label class="relay-label">API Server</label>
                <input
                  v-model="editRelay.api"
                  type="text"
                  class="relay-input"
                  placeholder="http://localhost:8080"
                />
              </div>
            </div>

            <ion-button expand="block" @click="applyRelayConfig" class="mt-3">
              <ion-icon slot="start" :icon="swapHorizontalOutline"></ion-icon>
              Apply &amp; Reconnect
            </ion-button>

            <ion-button
              v-if="hasCustomRelay"
              expand="block"
              fill="outline"
              color="medium"
              @click="resetRelayConfig"
              class="mt-2"
            >
              Reset to Defaults
            </ion-button>
          </ion-card-content>
        </ion-card>

        <!-- Known Servers (discovered from peers) -->
        <ion-card>
          <ion-card-header>
            <div class="status-header">
              <ion-card-title>Known Servers</ion-card-title>
              <ion-badge color="primary">{{ knownServers.length }}</ion-badge>
            </div>
            <ion-card-subtitle>Servers discovered from the network</ion-card-subtitle>
          </ion-card-header>

          <ion-card-content>
            <div v-if="knownServers.length === 0" class="empty-peers">
              <ion-icon :icon="serverOutline" size="large"></ion-icon>
              <p>No servers discovered yet</p>
              <p class="helper-text">Servers shared by peers will appear here</p>
            </div>

            <div v-else class="server-list">
              <div
                v-for="server in knownServers"
                :key="server.websocket"
                class="server-item"
                :class="{ active: isActiveServer(server.websocket) }"
              >
                <div class="server-header">
                  <div class="server-url-badge">
                    <span class="server-dot" :class="{ active: isActiveServer(server.websocket) }"></span>
                    {{ shortenUrl(server.websocket) }}
                  </div>
                  <span class="server-seen">{{ formatPeerTime(server.firstSeen) }}</span>
                </div>
                <div class="server-details">
                  <div class="server-detail">
                    <span class="detail-label">WS</span>
                    <code>{{ server.websocket }}</code>
                  </div>
                  <div class="server-detail">
                    <span class="detail-label">Gun</span>
                    <code>{{ server.gun }}</code>
                  </div>
                  <div class="server-detail">
                    <span class="detail-label">API</span>
                    <code>{{ server.api }}</code>
                  </div>
                </div>
                <ion-button
                  v-if="!isActiveServer(server.websocket)"
                  expand="block"
                  size="small"
                  fill="outline"
                  @click="switchToServer(server)"
                  class="mt-2"
                >
                  <ion-icon slot="start" :icon="swapHorizontalOutline"></ion-icon>
                  Switch to this server
                </ion-button>
                <div v-else class="active-badge">Currently connected</div>
              </div>
            </div>
          </ion-card-content>
        </ion-card>

        <!-- Connected Peers -->
        <ion-card>
          <ion-card-header>
            <div class="status-header">
              <ion-card-title>Connected Peers</ion-card-title>
              <ion-button fill="clear" size="small" @click="refreshNetwork">
                <ion-icon :icon="refreshOutline"></ion-icon>
              </ion-button>
            </div>
            <ion-card-subtitle>Peers sharing relay addresses automatically</ion-card-subtitle>
          </ion-card-header>

          <ion-card-content>
            <div v-if="peerList.length === 0" class="empty-peers">
              <ion-icon :icon="globeOutline" size="large"></ion-icon>
              <p>No peers connected yet</p>
              <p class="helper-text">Peers will appear here once they join the network. Relay addresses are shared automatically on connect.</p>
            </div>

            <div v-else class="peer-list">
              <div v-for="peer in peerList" :key="peer.peerId" class="peer-item">
                <div class="peer-header">
                  <div class="peer-id-badge">
                    <span class="peer-dot"></span>
                    {{ peer.peerId }}
                  </div>
                  <span class="peer-joined">{{ formatPeerTime(peer.joinedAt) }}</span>
                </div>
                <div class="peer-details">
                  <div class="peer-detail" v-if="peer.relayUrl">
                    <span class="detail-label">Relay</span>
                    <code>{{ peer.relayUrl }}</code>
                  </div>
                  <div class="peer-detail" v-if="peer.gunPeers?.length">
                    <span class="detail-label">DB Peers</span>
                    <code v-for="gun in peer.gunPeers" :key="gun">{{ gun }}</code>
                  </div>
                </div>
              </div>
            </div>
          </ion-card-content>
        </ion-card>

        <!-- Your Peer Identity -->
        <ion-card>
          <ion-card-header>
            <ion-card-title>Your Node</ion-card-title>
          </ion-card-header>

          <ion-card-content>
            <div class="info-grid">
              <div class="info-row">
                <span>Peer ID</span>
                <code>{{ myPeerId }}</code>
              </div>
              <div class="info-row">
                <span>Device ID</span>
                <code>{{ fullDeviceId }}</code>
              </div>
            </div>
          </ion-card-content>
        </ion-card>
      </div>

      <!-- DATA TAB -->
      <div v-if="activeTab === 'data'">
        <!-- Storage Usage -->
        <ion-card>
          <ion-card-header>
            <ion-card-title>Storage Usage</ion-card-title>
            <ion-card-subtitle>Local device storage</ion-card-subtitle>
          </ion-card-header>

          <ion-card-content>
            <div class="storage-stats">
              <div class="stat-row">
                <span>Used Storage</span>
                <strong>{{ storageStats.used.toFixed(1) }} MB</strong>
              </div>
              <div class="stat-row">
                <span>Available</span>
                <strong>{{ storageStats.quota.toFixed(0) }} MB</strong>
              </div>
              <div class="stat-row">
                <span>Pinned Images</span>
                <strong>{{ storageStats.pinnedItems }}</strong>
              </div>
            </div>

            <div class="progress-bar">
              <div
                class="progress-fill"
                :style="{ width: `${storagePercent}%` }"
                :class="{ warning: storagePercent > 80, danger: storagePercent > 95 }"
              ></div>
            </div>
            <p class="progress-text">{{ storagePercent.toFixed(1) }}% used</p>

            <ion-button
              expand="block"
              fill="outline"
              @click="refreshStorageStats"
              class="mt-3"
            >
              <ion-icon slot="start" :icon="refreshOutline"></ion-icon>
              Refresh Stats
            </ion-button>
          </ion-card-content>
        </ion-card>

        <!-- Storage Policy -->
        <ion-card>
          <ion-card-header>
            <ion-card-title>Storage Policy</ion-card-title>
            <ion-card-subtitle>Control what gets stored locally</ion-card-subtitle>
          </ion-card-header>

          <ion-card-content>
            <ion-list>
              <ion-item>
                <ion-toggle v-model="policy.myPosts" @ionChange="savePolicy">
                  Always store my posts
                </ion-toggle>
              </ion-item>

              <ion-item>
                <ion-toggle v-model="policy.myUpvotes" @ionChange="savePolicy">
                  Store posts I upvoted
                </ion-toggle>
              </ion-item>

              <ion-item>
                <ion-toggle v-model="policy.myCommunities" @ionChange="savePolicy">
                  Store my communities
                </ion-toggle>
              </ion-item>

              <ion-item>
                <ion-toggle v-model="policy.popularPosts" @ionChange="savePolicy">
                  Cache popular posts (100+ upvotes)
                </ion-toggle>
              </ion-item>

              <ion-item>
                <ion-toggle v-model="policy.autoPruneOldContent" @ionChange="savePolicy">
                  Auto-delete old cached content
                </ion-toggle>
              </ion-item>

              <ion-item>
                <ion-label>Keep recent posts</ion-label>
                <ion-select v-model="policy.recentPosts" @ionChange="savePolicy">
                  <ion-select-option :value="20">Last 20</ion-select-option>
                  <ion-select-option :value="50">Last 50</ion-select-option>
                  <ion-select-option :value="100">Last 100</ion-select-option>
                  <ion-select-option :value="200">Last 200</ion-select-option>
                </ion-select>
              </ion-item>

              <ion-item>
                <ion-label>Max storage (MB)</ion-label>
                <ion-select v-model="policy.maxStorageMB" @ionChange="savePolicy">
                  <ion-select-option :value="50">50 MB</ion-select-option>
                  <ion-select-option :value="100">100 MB</ion-select-option>
                  <ion-select-option :value="250">250 MB</ion-select-option>
                  <ion-select-option :value="500">500 MB</ion-select-option>
                  <ion-select-option :value="1000">1 GB</ion-select-option>
                </ion-select>
              </ion-item>
            </ion-list>
          </ion-card-content>
        </ion-card>

        <!-- Data Management -->
        <ion-card>
          <ion-card-header>
            <ion-card-title>Data Management</ion-card-title>
            <ion-card-subtitle>Export, import, or clear data</ion-card-subtitle>
          </ion-card-header>

          <ion-card-content>
            <ion-button expand="block" fill="outline" @click="exportData">
              <ion-icon slot="start" :icon="downloadOutline"></ion-icon>
              Export All Data
            </ion-button>

            <ion-button expand="block" fill="outline" @click="importData" class="mt-2">
              <ion-icon slot="start" :icon="cloudUploadOutline"></ion-icon>
              Import Data
            </ion-button>

            <ion-button
              expand="block"
              fill="outline"
              @click="pruneOldContent"
              class="mt-2"
            >
              <ion-icon slot="start" :icon="trashOutline"></ion-icon>
              Clean Up Old Content
            </ion-button>

            <ion-button
              expand="block"
              color="danger"
              fill="outline"
              @click="confirmClearAll"
              class="mt-2"
            >
              <ion-icon slot="start" :icon="warningOutline"></ion-icon>
              Clear All Data
            </ion-button>

            <input
              ref="importFileInput"
              type="file"
              accept=".json"
              style="display: none"
              @change="handleImportFile"
            />
          </ion-card-content>
        </ion-card>
      </div>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonButtons,
  IonBackButton,
  IonCard,
  IonCardHeader,
  IonCardTitle,
  IonCardSubtitle,
  IonCardContent,
  IonList,
  IonItem,
  IonLabel,
  IonToggle,
  IonSelect,
  IonSelectOption,
  IonButton,
  IonIcon,
  IonBadge,
  IonSegment,
  IonSegmentButton,
  alertController,
  toastController
} from '@ionic/vue';
import {
  refreshOutline,
  downloadOutline,
  cloudUploadOutline,
  trashOutline,
  warningOutline,
  personCircleOutline,
  logoGoogle,
  logoMicrosoft,
  globeOutline,
  swapHorizontalOutline,
  serverOutline,
  logOutOutline
} from 'ionicons/icons';
import { PinningService } from '../services/pinningService';
import { StorageManager } from '../services/storageManager';
import { UserService } from '../services/userService';
import { VoteTrackerService } from '../services/voteTrackerService';
import { AuditService, type CloudUser } from '../services/auditService';
import { WebSocketService, type KnownServer } from '../services/websocketService';
import { GunService } from '../services/gunService';
import { useChainStore } from '../stores/chainStore';
import config from '../config';

const router = useRouter();
const chainStore = useChainStore();
const importFileInput = ref<HTMLInputElement | null>(null);
const activeTab = ref('general');

const storageStats = ref({ used: 0, quota: 0, pinnedItems: 0 });

const policy = ref({
  myPosts: true,
  myUpvotes: true,
  myCommunities: true,
  popularPosts: true,
  recentPosts: 50,
  maxStorageMB: 100,
  autoPruneOldContent: true
});

const isDarkMode = ref(false);
const minUserKarma = ref<number>(-1000);
const userProfile = ref<any>(null);
const deviceId = ref('');
const cloudUser = ref<CloudUser | null>(null);

// Network state
const networkStatus = ref({
  wsConnected: false,
  gunConnected: false,
  peerCount: 0,
  gunPeerCount: 0,
  blockHeight: 0,
  chainValid: true
});

const connectionStatusClass = computed(() => {
  if (networkStatus.value.wsConnected && networkStatus.value.gunConnected) return 'connected';
  if (networkStatus.value.wsConnected || networkStatus.value.gunConnected) return 'partial';
  return '';
});

const connectionStatusLabel = computed(() => {
  if (networkStatus.value.wsConnected && networkStatus.value.gunConnected) return 'Fully Connected';
  if (networkStatus.value.wsConnected) return 'WS Only';
  if (networkStatus.value.gunConnected) return 'Gun Only';
  return 'Disconnected';
});

const peerList = ref<Array<{ peerId: string; relayUrl: string; gunPeers: string[]; joinedAt: number }>>([]);
const myPeerId = ref('');
const knownServers = ref<KnownServer[]>([]);

// Relay editing
const editRelay = ref({
  websocket: config.relay.websocket,
  gun: config.relay.gun,
  api: config.relay.api
});

const hasCustomRelay = computed(() => {
  const overrides = config.getRelayOverrides();
  return !!(overrides.websocket || overrides.gun || overrides.api);
});

let statusCleanup: (() => void) | null = null;
let networkPollInterval: ReturnType<typeof setInterval> | null = null;

const storagePercent = computed(() => {
  if (storageStats.value.quota === 0) return 0;
  return (storageStats.value.used / storageStats.value.quota) * 100;
});

const fullDeviceId = computed(() => {
  return deviceId.value || '';
});

function isActiveServer(wsUrl: string): boolean {
  return config.relay.websocket === wsUrl;
}

function shortenUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.host;
  } catch {
    return url;
  }
}

function refreshNetwork() {
  const wsConnected = WebSocketService.getConnectionStatus();
  const gunStats = GunService.getPeerStats();
  const peerAddresses = WebSocketService.getPeerAddresses();

  networkStatus.value = {
    wsConnected,
    gunConnected: gunStats.isConnected,
    peerCount: WebSocketService.getPeerCount(),
    gunPeerCount: gunStats.peerCount,
    blockHeight: chainStore.blocks.length,
    chainValid: chainStore.chainValid
  };

  peerList.value = Array.from(peerAddresses.values());
  myPeerId.value = WebSocketService.getPeerId();
  knownServers.value = WebSocketService.getKnownServers();

  // Keep edit fields in sync with current config
  editRelay.value = {
    websocket: config.relay.websocket,
    gun: config.relay.gun,
    api: config.relay.api
  };
}

async function applyRelayConfig() {
  const ws = editRelay.value.websocket.trim();
  const gun = editRelay.value.gun.trim();
  const api = editRelay.value.api.trim();

  if (!ws || !gun || !api) {
    const toast = await toastController.create({
      message: 'All relay fields are required',
      duration: 2000,
      color: 'warning'
    });
    await toast.present();
    return;
  }

  config.setRelayOverrides({ websocket: ws, gun, api });

  // Reconnect both services
  WebSocketService.reconnect(ws);
  GunService.reconnect(gun);

  const toast = await toastController.create({
    message: 'Relay configuration updated, reconnecting...',
    duration: 2000,
    color: 'success'
  });
  await toast.present();

  // Refresh after a short delay to pick up new connection status
  setTimeout(refreshNetwork, 2000);
}

async function resetRelayConfig() {
  config.resetRelayOverrides();

  editRelay.value = {
    websocket: config.relay.websocket,
    gun: config.relay.gun,
    api: config.relay.api
  };

  WebSocketService.reconnect();
  GunService.reconnect();

  const toast = await toastController.create({
    message: 'Relay reset to defaults, reconnecting...',
    duration: 2000,
    color: 'success'
  });
  await toast.present();

  setTimeout(refreshNetwork, 2000);
}

async function switchToServer(server: KnownServer) {
  config.setRelayOverrides({
    websocket: server.websocket,
    gun: server.gun,
    api: server.api
  });

  editRelay.value = {
    websocket: server.websocket,
    gun: server.gun,
    api: server.api
  };

  WebSocketService.reconnect(server.websocket);
  GunService.reconnect(server.gun);

  const toast = await toastController.create({
    message: `Switching to ${shortenUrl(server.websocket)}...`,
    duration: 2000,
    color: 'success'
  });
  await toast.present();

  setTimeout(refreshNetwork, 2000);
}

function formatPeerTime(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

onMounted(async () => {
  await refreshStorageStats();
  await loadPolicy();
  userProfile.value = await UserService.getCurrentUser();
  deviceId.value = await VoteTrackerService.getDeviceId();

  // Show cached user immediately, then validate against backend
  cloudUser.value = AuditService.getCachedUser();
  AuditService.getCloudUser().then(user => {
    cloudUser.value = user;
  });

  const storedTheme = localStorage.getItem('theme');
  if (storedTheme === 'dark') {
    isDarkMode.value = true;
    document.body.classList.add('dark');
  }

  const storedMinKarma = localStorage.getItem('minUserKarma');
  if (storedMinKarma !== null) {
    minUserKarma.value = Number(storedMinKarma) || -1000;
  }

  // Network polling
  refreshNetwork();
  statusCleanup = WebSocketService.onStatusChange(() => refreshNetwork());
  networkPollInterval = setInterval(refreshNetwork, 5000);
});

onUnmounted(() => {
  if (statusCleanup) statusCleanup();
  if (networkPollInterval) clearInterval(networkPollInterval);
});

const refreshStorageStats = async () => {
  storageStats.value = await PinningService.getStorageStats();
};

const loadPolicy = async () => {
  policy.value = await PinningService.getPolicy();
};

const savePolicy = async () => {
  await PinningService.setPolicy(policy.value);

  const toast = await toastController.create({
    message: 'Policy saved',
    duration: 1500,
    color: 'success'
  });
  await toast.present();
};

const toggleDarkMode = () => {
  if (isDarkMode.value) {
    document.documentElement.classList.add('dark');
    document.body.classList.add('dark');
    localStorage.setItem('theme', 'dark');
  } else {
    document.documentElement.classList.remove('dark');
    document.body.classList.remove('dark');
    localStorage.setItem('theme', 'light');
  }
};

const saveFilterSettings = async () => {
  localStorage.setItem('minUserKarma', String(minUserKarma.value));

  const toast = await toastController.create({
    message: 'Content filter updated',
    duration: 1500,
    color: 'success'
  });
  await toast.present();
};

const exportData = async () => {
  try {
    const data = await StorageManager.exportAllData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `interpoll-backup-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);

    const toast = await toastController.create({
      message: 'Data exported successfully',
      duration: 2000,
      color: 'success'
    });
    await toast.present();
  } catch (_error) {
    const toast = await toastController.create({
      message: 'Export failed',
      duration: 2000,
      color: 'danger'
    });
    await toast.present();
  }
};

const importData = () => {
  importFileInput.value?.click();
};

const handleImportFile = async (event: Event) => {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];

  if (!file) return;

  try {
    const text = await file.text();
    const data = JSON.parse(text);

    await StorageManager.importData(data);

    const toast = await toastController.create({
      message: 'Data imported successfully',
      duration: 2000,
      color: 'success'
    });
    await toast.present();

    await refreshStorageStats();
  } catch (_error) {
    const toast = await toastController.create({
      message: 'Import failed',
      duration: 2000,
      color: 'danger'
    });
    await toast.present();
  }
};

const pruneOldContent = async () => {
  const alert = await alertController.create({
    header: 'Clean Up Storage',
    message: 'This will remove old cached content. Your posts and important data will be kept.',
    buttons: [
      { text: 'Cancel', role: 'cancel' },
      {
        text: 'Clean Up',
        handler: async () => {
          const result = await StorageManager.pruneOldData();

          const toast = await toastController.create({
            message: `Cleaned up ${result.pollsDeleted} items`,
            duration: 2000,
            color: 'success'
          });
          await toast.present();

          await refreshStorageStats();
        }
      }
    ]
  });

  await alert.present();
};

const confirmClearAll = async () => {
  const alert = await alertController.create({
    header: 'Clear All Data',
    message: 'This will delete EVERYTHING from local storage. This cannot be undone!',
    buttons: [
      { text: 'Cancel', role: 'cancel' },
      {
        text: 'Clear All',
        role: 'destructive',
        handler: async () => {
          await StorageManager.clearAll();

          const toast = await toastController.create({
            message: 'All data cleared',
            duration: 2000,
            color: 'success'
          });
          await toast.present();

          await refreshStorageStats();
          router.push('/home');
        }
      }
    ]
  });

  await alert.present();
};

const loginWithGoogle = () => {
  AuditService.login('google');
};

const loginWithMicrosoft = () => {
  AuditService.login('microsoft');
};

const handleLogout = async () => {
  await AuditService.logout();
  cloudUser.value = null;

  const toast = await toastController.create({
    message: 'Signed out',
    duration: 2000,
    color: 'success'
  });
  await toast.present();
};
</script>

<style scoped>
/* ── Layout ── */
.mt-2 { margin-top: 8px; }
.mt-3 { margin-top: 12px; }

.helper-text {
  font-size: 13px;
  color: var(--ion-color-medium);
  margin-top: 8px;
  line-height: 1.5;
}

/* ── Storage ── */
.storage-stats {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 16px;
}

.stat-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.stat-row span {
  color: var(--ion-color-medium);
  font-size: 14px;
}

.stat-row strong {
  font-size: 16px;
}

.progress-bar {
  width: 100%;
  height: 8px;
  background: rgba(var(--ion-card-background-rgb), 0.18);
  border: 1px solid var(--glass-border);
  border-top-color: var(--glass-border-top);
  border-radius: 8px;
  overflow: hidden;
  margin-top: 16px;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}

.progress-fill {
  height: 100%;
  background: var(--ion-color-primary);
  border-radius: 8px;
  transition: width 0.5s cubic-bezier(0.23, 1, 0.32, 1);
}

.progress-fill.warning {
  background: var(--ion-color-warning);
}

.progress-fill.danger {
  background: var(--ion-color-danger);
}

.progress-text {
  text-align: center;
  font-size: 12px;
  color: var(--ion-color-medium);
  margin-top: 4px;
}

/* ── Account / Info ── */
.info-grid {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 16px;
}

.info-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.info-row span {
  color: var(--ion-color-medium);
  font-size: 14px;
}

.info-row code {
  font-size: 12px;
  background: rgba(var(--ion-card-background-rgb), 0.18);
  backdrop-filter: blur(10px) saturate(1.3);
  -webkit-backdrop-filter: blur(10px) saturate(1.3);
  border: 1px solid var(--glass-border);
  border-top-color: var(--glass-border-top);
  padding: 4px 8px;
  border-radius: 12px;
  box-shadow: var(--glass-highlight);
}

/* ── Network Tab ── */
.status-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.status-indicator {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 500;
  color: var(--ion-color-danger);
  padding: 4px 10px;
  border-radius: 20px;
  background: rgba(var(--ion-color-danger-rgb), 0.08);
  backdrop-filter: blur(10px) saturate(1.4);
  -webkit-backdrop-filter: blur(10px) saturate(1.4);
  border: 1px solid rgba(var(--ion-color-danger-rgb), 0.12);
  box-shadow: var(--glass-highlight);
}

.status-indicator.connected {
  color: var(--ion-color-success);
  background: rgba(var(--ion-color-success-rgb), 0.08);
  border-color: rgba(var(--ion-color-success-rgb), 0.12);
}

.status-indicator.partial {
  color: var(--ion-color-warning);
  background: rgba(var(--ion-color-warning-rgb), 0.08);
  border-color: rgba(var(--ion-color-warning-rgb), 0.12);
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: currentColor;
  animation: pulse 2s infinite;
}

/* ── Service Status Rows ── */
.service-status-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 16px;
  padding: 12px;
  background: rgba(var(--ion-card-background-rgb), 0.18);
  backdrop-filter: blur(14px) saturate(1.5);
  -webkit-backdrop-filter: blur(14px) saturate(1.5);
  border: 1px solid var(--glass-border);
  border-top-color: var(--glass-border-top);
  border-radius: 16px;
  box-shadow: var(--glass-inner-glow);
}

.service-status-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.service-info {
  display: flex;
  align-items: center;
  gap: 8px;
}

.service-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--ion-color-danger);
  flex-shrink: 0;
}

.service-dot.online {
  background: var(--ion-color-success);
  animation: pulse 2s infinite;
  box-shadow: 0 0 6px rgba(var(--ion-color-success-rgb), 0.4);
}

.service-name {
  font-size: 13px;
  font-weight: 500;
}

.service-state {
  font-size: 12px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 12px;
  backdrop-filter: blur(10px) saturate(1.3);
  -webkit-backdrop-filter: blur(10px) saturate(1.3);
}

.service-state.state-ok {
  color: var(--ion-color-success);
  background: rgba(var(--ion-color-success-rgb), 0.08);
  border: 1px solid rgba(var(--ion-color-success-rgb), 0.12);
}

.service-state.state-off {
  color: var(--ion-color-danger);
  background: rgba(var(--ion-color-danger-rgb), 0.08);
  border: 1px solid rgba(var(--ion-color-danger-rgb), 0.12);
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

.metrics-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.metric-card {
  padding: 16px;
  background: rgba(var(--ion-card-background-rgb), 0.18);
  backdrop-filter: blur(14px) saturate(1.5);
  -webkit-backdrop-filter: blur(14px) saturate(1.5);
  border: 1px solid var(--glass-border);
  border-top-color: var(--glass-border-top);
  border-radius: 16px;
  text-align: center;
  box-shadow: var(--glass-highlight), var(--glass-inner-glow);
  position: relative;
  overflow: hidden;
}

.metric-card::before {
  content: '';
  position: absolute;
  inset: 0;
  background: var(--glass-specular);
  border-radius: inherit;
  pointer-events: none;
}

.metric-value {
  font-size: 24px;
  font-weight: 700;
  color: var(--ion-color-primary);
  line-height: 1.2;
  position: relative;
}

.metric-value.text-success {
  color: var(--ion-color-success);
}

.metric-value.text-danger {
  color: var(--ion-color-danger);
}

.metric-label {
  font-size: 12px;
  color: var(--ion-color-medium);
  margin-top: 4px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  position: relative;
}

/* ── Relay Config Form ── */
.relay-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.relay-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.relay-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--ion-color-medium);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.relay-input {
  font-size: 13px;
  font-family: monospace;
  background: rgba(var(--ion-card-background-rgb), 0.18);
  backdrop-filter: blur(12px) saturate(1.4);
  -webkit-backdrop-filter: blur(12px) saturate(1.4);
  color: var(--ion-text-color);
  border: 1px solid var(--glass-border);
  border-top-color: var(--glass-border-top);
  padding: 10px 12px;
  border-radius: 12px;
  outline: none;
  transition: var(--liquid-transition);
  width: 100%;
  box-sizing: border-box;
  box-shadow: var(--glass-highlight);
}

.relay-input:focus {
  border-color: rgba(var(--ion-color-primary-rgb), 0.45);
  box-shadow: 0 0 0 3px rgba(var(--ion-color-primary-rgb), 0.12), var(--glass-highlight);
}

/* ── Known Servers ── */
.server-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.server-item {
  border: 1px solid var(--glass-border);
  border-top-color: var(--glass-border-top);
  border-radius: 16px;
  padding: 12px;
  transition: var(--liquid-transition);
  background: rgba(var(--ion-card-background-rgb), 0.14);
  backdrop-filter: blur(12px) saturate(1.4);
  -webkit-backdrop-filter: blur(12px) saturate(1.4);
  box-shadow: var(--glass-highlight);
}

.server-item.active {
  border-color: rgba(var(--ion-color-success-rgb), 0.35);
  background: rgba(var(--ion-color-success-rgb), 0.04);
  box-shadow: var(--glass-highlight), 0 0 16px rgba(var(--ion-color-success-rgb), 0.06);
}

.server-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.server-url-badge {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
  font-size: 14px;
}

.server-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--ion-color-medium);
}

.server-dot.active {
  background: var(--ion-color-success);
  animation: pulse 2s infinite;
  box-shadow: 0 0 6px rgba(var(--ion-color-success-rgb), 0.4);
}

.server-seen {
  font-size: 12px;
  color: var(--ion-color-medium);
}

.server-details {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.server-detail {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.server-detail code {
  font-size: 12px;
  background: rgba(var(--ion-card-background-rgb), 0.18);
  backdrop-filter: blur(8px) saturate(1.3);
  -webkit-backdrop-filter: blur(8px) saturate(1.3);
  border: 1px solid var(--glass-border);
  border-top-color: var(--glass-border-top);
  padding: 2px 6px;
  border-radius: 8px;
  word-break: break-all;
}

.active-badge {
  margin-top: 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--ion-color-success);
  text-align: center;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

/* ── Peer List ── */
.empty-peers {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 32px 16px;
  text-align: center;
  gap: 8px;
}

.empty-peers ion-icon {
  font-size: 48px;
  color: var(--ion-color-medium);
}

.empty-peers p {
  margin: 0;
  color: var(--ion-color-medium);
}

.peer-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.peer-item {
  border: 1px solid var(--glass-border);
  border-top-color: var(--glass-border-top);
  border-radius: 16px;
  padding: 12px;
  background: rgba(var(--ion-card-background-rgb), 0.14);
  backdrop-filter: blur(12px) saturate(1.4);
  -webkit-backdrop-filter: blur(12px) saturate(1.4);
  box-shadow: var(--glass-highlight);
}

.peer-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.peer-id-badge {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
  font-size: 14px;
  font-family: monospace;
}

.peer-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--ion-color-success);
  box-shadow: 0 0 6px rgba(var(--ion-color-success-rgb), 0.4);
}

.peer-joined {
  font-size: 12px;
  color: var(--ion-color-medium);
}

.peer-details {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.peer-detail {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.detail-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--ion-color-medium);
  text-transform: uppercase;
  min-width: 60px;
  padding-top: 4px;
}

.peer-detail code {
  font-size: 12px;
  background: rgba(var(--ion-card-background-rgb), 0.18);
  backdrop-filter: blur(8px) saturate(1.3);
  -webkit-backdrop-filter: blur(8px) saturate(1.3);
  border: 1px solid var(--glass-border);
  border-top-color: var(--glass-border-top);
  padding: 4px 8px;
  border-radius: 8px;
  word-break: break-all;
}
</style>
