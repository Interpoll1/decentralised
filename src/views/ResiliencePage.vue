<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <button class="back-btn" @click="router.back()">
            <svg viewBox="0 0 24 24" fill="none"><path d="M15 18l-6-6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </ion-buttons>
        <ion-title>Resilience Center</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <DesktopPageShell>
      <div class="resilience-body">

        <!-- Hero card -->
        <div class="hero-card">
          <div class="hero-left">
            <div class="hero-icon-wrap">
              <ion-icon :icon="analyticsOutline"></ion-icon>
            </div>
            <div>
              <h2 class="hero-title">Network Resilience</h2>
              <p class="hero-sub">Monitor relay health, rotate servers instantly, and back up your local state. Interpoll keeps running even when individual nodes go offline.</p>
            </div>
          </div>
          <div class="quick-actions">
            <button class="qa-btn primary" :disabled="scanning" @click="scanAllRelays">
              <ion-icon :icon="analyticsOutline"></ion-icon>
              {{ scanning ? 'Scanning…' : 'Scan Relays' }}
            </button>
            <button class="qa-btn" :disabled="scanning || relays.length === 0" @click="switchToBestRelay">
              <ion-icon :icon="swapHorizontalOutline"></ion-icon>
              Best Relay
            </button>
            <button class="qa-btn" :disabled="exporting" @click="exportSnapshot">
              <ion-icon :icon="downloadOutline"></ion-icon>
              Backup
            </button>
            <button class="qa-btn" :disabled="sharing" @click="shareWithPeers">
              <ion-icon :icon="sendOutline"></ion-icon>
              Share
            </button>
            <button class="qa-btn" :disabled="probeResults.length === 0" @click="copyRelayReport">
              <ion-icon :icon="copyOutline"></ion-icon>
              Copy Report
            </button>
          </div>
        </div>

        <!-- 1. Network Status -->
        <div class="r-card">
          <div class="card-head">
            <div class="card-head-icon accent-teal"><ion-icon :icon="analyticsOutline"></ion-icon></div>
            <div class="card-head-text">
              <h3>Network Status</h3>
              <p>Live WebSocket health, peer reachability, and censorship signals across configured relays.</p>
            </div>
            <div class="card-head-badges">
              <span class="status-pill" :class="wsConnected ? 'pill-ok' : 'pill-err'">{{ wsConnected ? 'Connected' : 'Disconnected' }}</span>
              <span v-if="isTor" class="status-pill pill-dark">
                <ion-icon :icon="fingerPrintOutline"></ion-icon> Tor
              </span>
            </div>
          </div>

          <div class="status-strip">
            <div class="strip-item">
              <span class="s-dot" :class="wsConnected ? 'dot-ok' : 'dot-err'"></span>
              <span>{{ peerCount }} relay peer{{ peerCount !== 1 ? 's' : '' }}</span>
            </div>
            <div class="strip-item">
              <span class="s-dot" :class="gunConnectedCount > 0 ? 'dot-ok' : 'dot-err'"></span>
              <span>{{ gunConnectedCount }} sync peer{{ gunConnectedCount !== 1 ? 's' : '' }}</span>
            </div>
            <span v-if="lastScanAt" class="strip-time">Last scan: {{ lastScanAt }}</span>
          </div>

          <div v-if="wsRegistrationRejected" class="info-box info-warn">
            <ion-icon :icon="lockClosedOutline"></ion-icon>
            <span>Connected to the relay but peer list requires sign-in. You're syncing over {{ gunConnectedCount }} Gun peer{{ gunConnectedCount !== 1 ? 's' : '' }} — sign in to appear in the relay peer network.</span>
          </div>

          <button class="block-btn accent" :disabled="scanning" @click="scanAllRelays">
            <div v-if="scanning" class="btn-spinner"></div>
            <ion-icon v-else :icon="analyticsOutline"></ion-icon>
            {{ scanning ? 'Scanning…' : 'Scan All Relays' }}
          </button>

          <!-- Probe results -->
          <div v-if="probeResults.length" class="probe-table-wrap">
            <table class="probe-table">
              <thead>
                <tr>
                  <th>Relay</th><th>WS</th><th>Gun</th><th>API</th><th>Latency</th><th>Status</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="r in probeResults" :key="r.relayId">
                  <td>{{ relayLabelById(r.relayId) }}</td>
                  <td><span class="s-dot" :class="r.ws.reachable ? 'dot-ok' : 'dot-err'"></span></td>
                  <td><span class="s-dot" :class="r.gun.reachable ? 'dot-ok' : 'dot-err'"></span></td>
                  <td><span class="s-dot" :class="r.api.reachable ? 'dot-ok' : 'dot-err'"></span></td>
                  <td class="mono">{{ latencyDisplay(r) }}</td>
                  <td>
                    <span class="overall-pill"
                      :class="r.overall === 'online' ? 'pill-ok' : r.overall === 'degraded' ? 'pill-warn' : 'pill-err'">
                      {{ r.overall }}
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- Censorship -->
          <div v-if="censorship" class="info-box" :class="censorship.blocked.length || censorship.torRequired.length ? 'info-warn' : 'info-ok'">
            <ion-icon :icon="censorship.blocked.length ? warningOutline : censorship.torRequired.length ? lockClosedOutline : checkmarkCircleOutline"></ion-icon>
            <span v-if="censorship.blocked.length">{{ censorship.blocked.length }} relay(s) appear blocked from your network.</span>
            <span v-else-if="censorship.torRequired.length">{{ censorship.torRequired.length }} relay(s) require Tor to reach.</span>
            <span v-else>No censorship detected — all relays reachable.</span>
          </div>
        </div>

        <!-- 2. Fallback Rendezvous -->
        <div class="r-card">
          <div class="card-head">
            <div class="card-head-icon accent-violet"><ion-icon :icon="radioOutline"></ion-icon></div>
            <div class="card-head-text">
              <h3>Fallback Rendezvous</h3>
              <p>When every relay is blocked, nodes derive the same time-rotating rendezvous point and reconverge — a deterministic, signature-verified fallback for network self-healing under censorship.</p>
            </div>
            <span class="status-pill" :class="tierColor === 'success' ? 'pill-ok' : tierColor === 'warning' ? 'pill-warn' : 'pill-err'">
              {{ tierLabels[resilience.tier] }}
            </span>
          </div>

          <div class="status-strip">
            <div class="strip-item">
              <span class="s-dot" :class="resilience.blackout ? 'dot-err' : 'dot-ok'"></span>
              <span>{{ resilience.blackout ? 'Blackout detected' : 'Connectivity OK' }}</span>
            </div>
            <div class="strip-item">
              <span class="s-dot" :class="resilience.rendezvousActive ? 'dot-ok' : 'dot-idle'"></span>
              <span>Rendezvous {{ resilience.rendezvousActive ? 'active' : 'idle' }}</span>
            </div>
            <span class="strip-time">Last reconverge: {{ lastRendezvousDisplay }}</span>
          </div>

          <div class="toggle-row">
            <div>
              <div class="toggle-label">Auto-escalate on blackout</div>
              <div class="toggle-sub">Publish/subscribe to rendezvous automatically when isolated</div>
            </div>
            <label class="toggle-switch">
              <input type="checkbox" :checked="resilience.autoEnabled" @change="toggleRendezvousAuto(($event.target as HTMLInputElement).checked)" />
              <span class="toggle-track"></span>
            </label>
          </div>

          <div v-if="isDevBuild" class="toggle-row">
            <div>
              <div class="toggle-label">Dev: allow insecure endpoints</div>
              <div class="toggle-sub">Accept ws://localhost so two local profiles can reconverge</div>
            </div>
            <label class="toggle-switch">
              <input type="checkbox" :checked="insecureDiscovery" @change="toggleInsecureDiscovery(($event.target as HTMLInputElement).checked)" />
              <span class="toggle-track"></span>
            </label>
          </div>

          <div class="button-row">
            <button class="block-btn accent flex1" :disabled="rendezvousBusy" @click="triggerRendezvous">
              <div v-if="rendezvousBusy" class="btn-spinner"></div>
              {{ resilience.rendezvousActive ? 'Re-broadcast' : 'Reconnect via rendezvous' }}
            </button>
            <button v-if="resilience.rendezvousActive" class="pill-btn outline" @click="stopRendezvous">Stop</button>
          </div>

          <div v-if="resilience.reputation.length" class="mt-12">
            <p class="subsection-title"><ion-icon :icon="pulseOutline"></ion-icon> Endpoint Reputation</p>
            <table class="probe-table">
              <thead><tr><th>Endpoint</th><th title="Recency-weighted">Score</th><th>OK</th><th>Fail</th></tr></thead>
              <tbody>
                <tr v-for="rep in resilience.reputation" :key="rep.id">
                  <td class="mono truncate-cell">{{ rep.id }}</td>
                  <td>
                    <span class="overall-pill" :class="rep.score >= 0.6 ? 'pill-ok' : rep.score >= 0.3 ? 'pill-warn' : 'pill-err'">
                      {{ reputationPct(rep.score) }}%
                    </span>
                  </td>
                  <td>{{ rep.successes }}</td>
                  <td>{{ rep.failures }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-else class="helper-text mt-8">No reputation data yet — scan relays to start scoring endpoint reliability.</p>
        </div>

        <!-- 3. Relay Management -->
        <div class="r-card">
          <div class="card-head">
            <div class="card-head-icon accent-blue"><ion-icon :icon="swapHorizontalOutline"></ion-icon></div>
            <div class="card-head-text">
              <h3>Relay Management</h3>
              <p>Add fallback relays, probe individual endpoints, and switch instantly when performance drops.</p>
            </div>
          </div>

          <div class="relay-list">
            <div v-for="relay in relays" :key="relay.id" class="relay-row" :class="{ 'relay-row--active': activeRelay?.id === relay.id }">
              <div class="relay-row-left">
                <span class="s-dot" :class="relay.status === 'online' ? 'dot-ok' : relay.status === 'degraded' ? 'dot-warn' : 'dot-err'"></span>
                <div>
                  <div class="relay-name-row">
                    <span class="relay-name">{{ relay.label }}</span>
                    <span v-if="relay.isTor" class="status-pill pill-dark"><ion-icon :icon="lockClosedOutline"></ion-icon> Tor</span>
                    <span class="overall-pill" :class="statusColor(relay.status) === 'success' ? 'pill-ok' : statusColor(relay.status) === 'warning' ? 'pill-warn' : 'pill-err'">{{ relay.status }}</span>
                    <span v-if="activeRelay?.id === relay.id" class="active-tag">Active</span>
                  </div>
                  <div class="relay-url">{{ relay.ws }}</div>
                  <div class="relay-priority">Priority: {{ relay.priority }}</div>
                </div>
              </div>
              <div class="relay-row-actions">
                <button v-if="activeRelay?.id !== relay.id" class="pill-btn outline sm" @click="switchRelay(relay.id)">Switch</button>
                <button class="icon-btn" @click="probeSingle(relay)" title="Probe"><ion-icon :icon="refreshOutline"></ion-icon></button>
                <button v-if="relays.length > 1" class="icon-btn danger" @click="removeRelay(relay.id)" title="Remove"><ion-icon :icon="trashOutline"></ion-icon></button>
              </div>
            </div>
          </div>

          <div class="toggle-row mt-12">
            <div class="toggle-label">Auto-failover to next relay</div>
            <label class="toggle-switch">
              <input type="checkbox" v-model="autoFailoverEnabled" />
              <span class="toggle-track"></span>
            </label>
          </div>

          <!-- Add Relay form -->
          <div class="inset-panel mt-12">
            <p class="subsection-title">Add Relay</p>
            <div class="field-group">
              <label class="field-label">Label</label>
              <div class="field-wrap"><input class="field-native" v-model="newRelay.label" placeholder="My relay" /></div>
            </div>
            <div class="field-group">
              <label class="field-label">WebSocket URL</label>
              <div class="field-wrap"><input class="field-native mono-sm" v-model="newRelay.ws" placeholder="wss://..." /></div>
            </div>
            <div class="field-group">
              <label class="field-label">Gun URL</label>
              <div class="field-wrap"><input class="field-native mono-sm" v-model="newRelay.gun" placeholder="https://..." /></div>
            </div>
            <div class="field-group">
              <label class="field-label">API URL</label>
              <div class="field-wrap"><input class="field-native mono-sm" v-model="newRelay.api" placeholder="https://..." /></div>
            </div>
            <div class="toggle-row">
              <div class="toggle-label">Tor (.onion) relay</div>
              <label class="toggle-switch">
                <input type="checkbox" v-model="newRelay.isTor" />
                <span class="toggle-track"></span>
              </label>
            </div>
            <button class="block-btn accent mt-12" :disabled="!canAddRelay" @click="addRelay">Add Relay</button>
          </div>
        </div>

        <!-- 4. GunDB Relay Network -->
        <div class="r-card">
          <div class="card-head">
            <div class="card-head-icon accent-teal"><ion-icon :icon="serverOutline"></ion-icon></div>
            <div class="card-head-text">
              <h3>GunDB Relay Network</h3>
              <p>Gun connects to all peers simultaneously. Data syncs across all relays — the more peers, the more resilient the network.</p>
            </div>
            <span class="count-badge">{{ gunConnectedCount }}/{{ gunPeerUrls.length }} live<span v-if="gunAvgLatency != null"> · {{ gunAvgLatency }}ms</span></span>
          </div>

          <div class="gun-relay-grid">
            <div v-for="peer in gunDetailedPeers" :key="peer.url" class="gun-relay-card" :class="{ 'gun-relay-card--live': peer.connected }">
              <div class="gun-relay-header">
                <span class="s-dot" :class="peer.connected ? 'dot-ok' : 'dot-idle'"></span>
                <strong class="gun-relay-name">{{ labelForGunUrl(peer.url) }}</strong>
                <span v-if="peer.latencyMs != null" class="latency-tag">{{ peer.latencyMs }}ms</span>
                <button v-if="gunPeerUrls.length > 1" class="icon-btn danger sm" @click="removeGunPeer(peer.url)" title="Remove"><ion-icon :icon="trashOutline"></ion-icon></button>
              </div>
              <div class="gun-relay-url">{{ peer.url }}</div>
              <div class="gun-relay-status" :class="peer.connected ? 'status-ok' : 'status-idle'">
                {{ peer.connected ? '● Connected' : '○ Connecting…' }}
              </div>
            </div>
          </div>

          <div v-if="gunStartupProbeRunning" class="info-box info-info">
            <div class="btn-spinner"></div>
            <span>Probing all relays in background…</span>
          </div>

          <!-- Gun scan results -->
          <div v-if="gunScanResults.length" class="probe-table-wrap mt-12">
            <table class="probe-table">
              <thead><tr><th>Relay</th><th>Reachable</th><th>Latency</th></tr></thead>
              <tbody>
                <tr v-for="r in gunScanResults" :key="r.url">
                  <td class="mono">{{ labelForGunUrl(r.url) }}</td>
                  <td><span class="s-dot" :class="r.reachable ? 'dot-ok' : 'dot-err'"></span></td>
                  <td class="mono">{{ r.latencyMs != null ? r.latencyMs + 'ms' : '—' }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="inset-panel mt-12">
            <p class="subsection-title">Add Gun Peer</p>
            <div class="inline-add">
              <div class="field-wrap flex1">
                <select class="field-native" v-model="selectedGunPreset">
                  <option value="">— pick a preset —</option>
                  <option v-for="p in availableGunPresets" :key="p.url" :value="p.url">{{ p.label }}</option>
                </select>
              </div>
              <button class="pill-btn accent" :disabled="!selectedGunPreset" @click="addGunPeerFromPreset">Add</button>
            </div>
            <div class="inline-add mt-8">
              <div class="field-wrap flex1">
                <input class="field-native mono-sm" v-model="newGunPeerUrl" placeholder="https://your-relay.example.com/gun" @keyup.enter="addGunPeerFromInput" />
              </div>
              <button class="pill-btn accent" :disabled="!newGunPeerUrl.trim()" @click="addGunPeerFromInput">Add</button>
            </div>
          </div>

          <button class="pill-btn outline mt-12" @click="resetGunPeers">Reset to defaults</button>
        </div>

        <!-- 5. Snapshot Manager -->
        <div class="r-card">
          <div class="card-head">
            <div class="card-head-icon accent-green"><ion-icon :icon="downloadOutline"></ion-icon></div>
            <div class="card-head-text">
              <h3>Snapshot Manager</h3>
              <p>Export encrypted local state backups, import trusted snapshots, and share state for fast peer recovery.</p>
            </div>
          </div>

          <p class="subsection-title">Export</p>
          <button class="block-btn accent" :disabled="exporting" @click="exportSnapshot">
            <div v-if="exporting" class="btn-spinner"></div>
            <ion-icon v-else :icon="downloadOutline"></ion-icon>
            {{ exporting ? 'Exporting…' : 'Export Full Snapshot' }}
          </button>

          <p class="subsection-title mt-16">Import</p>
          <div class="info-box info-warn">
            <ion-icon :icon="shieldCheckmarkOutline"></ion-icon>
            <span>Only import snapshots from sources you trust. A malicious snapshot could inject harmful content into your local data.</span>
          </div>
          <input ref="fileInputRef" type="file" accept=".json" style="display:none" @change="handleFileSelect" />
          <button class="block-btn outline mt-8" :disabled="importing" @click="triggerFileInput">
            <ion-icon :icon="cloudUploadOutline"></ion-icon>
            {{ importing ? 'Importing…' : 'Import Snapshot File' }}
          </button>
          <div v-if="importProgress" class="progress-wrap mt-8">
            <div class="progress-bar"><div class="progress-fill ok" :style="{ width: importProgress.percent + '%' }"></div></div>
            <p class="helper-text">{{ importProgress.phase }} — {{ importProgress.current }}/{{ importProgress.total }}</p>
          </div>

          <p class="subsection-title mt-16">P2P Share</p>
          <button class="block-btn outline" :disabled="sharing" @click="shareWithPeers">
            <div v-if="sharing" class="btn-spinner"></div>
            <ion-icon v-else :icon="sendOutline"></ion-icon>
            {{ sharing ? 'Sharing…' : 'Share with Peers' }}
          </button>
          <div v-if="incomingOffer" class="info-box info-info mt-8">
            <ion-icon :icon="downloadOutline"></ion-icon>
            <div>
              <p class="toggle-label">Incoming Snapshot Offer</p>
              <p class="helper-text">{{ incomingOffer.meta.communityCount }} communities · {{ incomingOffer.meta.postCount }} posts · Block #{{ incomingOffer.meta.blockHeight }}</p>
              <div class="button-row mt-8">
                <button class="pill-btn accent" @click="acceptOffer">Accept</button>
                <button class="pill-btn outline" @click="rejectOffer">Reject</button>
              </div>
            </div>
          </div>
          <div v-if="transferProgress" class="progress-wrap mt-8">
            <div class="progress-bar"><div class="progress-fill blue" :style="{ width: transferProgress.percent + '%' }"></div></div>
            <p class="helper-text">{{ transferProgress.direction }} — {{ transferProgress.percent }}%</p>
          </div>
        </div>

        <!-- 6. Peer-to-Peer Mesh -->
        <div class="r-card">
          <div class="card-head">
            <div class="card-head-icon accent-violet"><ion-icon :icon="pulseOutline"></ion-icon></div>
            <div class="card-head-text">
              <h3>Peer-to-Peer Mesh</h3>
              <p>Direct browser-to-browser connections that survive relay outages using WebRTC DataChannels.</p>
            </div>
          </div>
          <P2PManualSignal />
          <div class="inset-panel mt-12">
            <p class="subsection-title">NAT Traversal (ICE / TURN)</p>
            <p class="helper-text">Using {{ iceServerCount }} ICE server{{ iceServerCount !== 1 ? 's' : '' }} ({{ turnActive ? 'incl. your TURN' : 'diverse public STUN' }}). Add a TURN server for symmetric NAT / strict firewall environments.</p>
            <div class="field-group mt-8">
              <label class="field-label">TURN URL</label>
              <div class="field-wrap"><input class="field-native mono-sm" v-model="turnUrl" placeholder="turn:turn.example.com:3478" /></div>
            </div>
            <div class="button-row mt-8">
              <div class="field-wrap flex1"><input class="field-native" v-model="turnUsername" placeholder="Username (optional)" /></div>
              <div class="field-wrap flex1"><input class="field-native" v-model="turnCredential" type="password" placeholder="Credential (optional)" /></div>
            </div>
            <div class="button-row mt-8">
              <button class="pill-btn accent" :disabled="!turnUrl.trim()" @click="saveTurn">Save TURN</button>
              <button class="pill-btn outline" @click="resetTurn">Reset to STUN</button>
            </div>
          </div>
        </div>

        <!-- 7. Advanced Tools -->
        <div class="r-card">
          <div class="card-head">
            <div class="card-head-icon accent-amber"><ion-icon :icon="terminalOutline"></ion-icon></div>
            <div class="card-head-text">
              <h3>Advanced Tools</h3>
              <p>Relay-assisted peer sync and command-line Tor peer operations.</p>
            </div>
          </div>

          <div class="toggle-row">
            <div>
              <div class="toggle-label">Peer Snapshot Sync</div>
              <div class="toggle-sub">Enable relay-mediated peer-to-peer snapshot sharing (experimental)</div>
            </div>
            <label class="toggle-switch">
              <input type="checkbox" v-model="webrtcEnabled" />
              <span class="toggle-track"></span>
            </label>
          </div>

          <div class="code-card mt-12">
            <div class="code-card-header">
              <div class="code-card-title"><ion-icon :icon="terminalOutline"></ion-icon> Tor headless peer command</div>
              <button class="pill-btn outline sm" @click="copyTorPeerCommand"><ion-icon :icon="copyOutline"></ion-icon> Copy</button>
            </div>
            <code class="code-block">node peer.js --proxy socks5h://127.0.0.1:9050</code>
            <p class="helper-text mt-8">Use only when running a dedicated relay peer through Tor.</p>
          </div>
        </div>

        <!-- 8. Guides -->
        <div class="r-card">
          <div class="card-head">
            <div class="card-head-icon accent-blue"><ion-icon :icon="hardwareChipOutline"></ion-icon></div>
            <div class="card-head-text"><h3>Guides</h3></div>
          </div>

          <div v-for="guide in guides" :key="guide.id" class="guide-item">
            <button class="guide-toggle" @click="expandedGuide = expandedGuide === guide.id ? null : guide.id">
              <div class="guide-toggle-left">
                <ion-icon :icon="guide.icon"></ion-icon>
                <span>{{ guide.title }}</span>
              </div>
              <ion-icon :icon="expandedGuide === guide.id ? chevronUpOutline : chevronDownOutline" class="guide-chevron"></ion-icon>
            </button>
            <div v-if="expandedGuide === guide.id" class="guide-content">
              <ol class="guide-steps">
                <li v-for="(step, i) in guide.steps" :key="i" v-html="step"></li>
              </ol>
            </div>
          </div>
        </div>

      </div>
      </DesktopPageShell>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import DesktopPageShell from '../components/DesktopPageShell.vue';
import {
  IonPage, IonHeader, IonToolbar, IonTitle, IonContent,
  IonCard, IonCardHeader, IonCardTitle, IonCardContent,
  IonButton, IonIcon, IonSpinner, IonToggle, IonBadge,
  IonItem, IonLabel, IonList, IonInput, IonButtons, IonFooter,
  toastController,
} from '@ionic/vue';
import {
  refreshOutline, downloadOutline, cloudUploadOutline,
  trashOutline, fingerPrintOutline, chevronDownOutline, chevronUpOutline,
  ellipse, warningOutline, lockClosedOutline, checkmarkCircleOutline,
  serverOutline, hardwareChipOutline, shieldCheckmarkOutline, analyticsOutline,
  swapHorizontalOutline, copyOutline, sendOutline, terminalOutline,
  radioOutline, pulseOutline,
} from 'ionicons/icons';
import { RelayManager } from '../services/relayManager';
import { RelayHealthService } from '../services/relayHealthService';
import { SnapshotService } from '../services/snapshotService';
import { SnapshotSyncService } from '../services/snapshotSyncService';
import { WebSocketService } from '../services/websocketService';
import { GunService } from '../services/gunService';
import { ResilienceService, type ResilienceStatus } from '../services/resilienceService';
import config from '../config';
import { GUN_RELAY_PRESETS, isValidGunUrl, labelForGunUrl, DEFAULT_GUN_PEERS } from '../services/gunRelayPresets';
import type { RelayEndpoint } from '../services/relayManager';
import type { RelayProbeResult } from '../services/relayHealthService';
import type { NetworkSnapshot } from '../services/snapshotService';
import P2PManualSignal from '../components/P2PManualSignal.vue';

const router = useRouter();

// --- State ---
const relays = ref<RelayEndpoint[]>([]);
const activeRelay = ref<RelayEndpoint | null>(null);
const wsConnected = ref(false);
const peerCount = ref(0);
const wsRegistrationRejected = ref(false);
const isTor = ref(false);

const scanning = ref(false);
const probeResults = ref<RelayProbeResult[]>([]);
const censorship = ref<{ blocked: RelayEndpoint[]; reachable: RelayEndpoint[]; torRequired: RelayEndpoint[] } | null>(null);
const lastScanAt = ref<string>('');

const autoFailoverEnabled = ref(localStorage.getItem('interpoll_auto_failover') === 'true');
const newRelay = ref({ label: '', ws: '', gun: '', api: '', isTor: false, priority: 10 });

// --- Fallback Rendezvous (resilience orchestrator) ---
const resilience = ref<ResilienceStatus>(ResilienceService.getStatus());
const rendezvousBusy = ref(false);
const tierLabels: Record<ResilienceStatus['tier'], string> = {
  relay: 'Relay (normal)',
  gossip: 'Gossip recovery',
  rendezvous: 'Rendezvous reconvergence',
  mesh: 'WebRTC mesh',
};
const tierColor = computed(() => {
  switch (resilience.value.tier) {
    case 'relay': return 'success';
    case 'gossip': return 'warning';
    default: return 'danger';
  }
});
const lastRendezvousDisplay = computed(() =>
  resilience.value.lastRendezvousAt
    ? new Date(resilience.value.lastRendezvousAt).toLocaleTimeString()
    : '—',
);

function refreshResilience() {
  resilience.value = ResilienceService.getStatus();
}

async function triggerRendezvous() {
  rendezvousBusy.value = true;
  try {
    await ResilienceService.activateRendezvous();
  } finally {
    rendezvousBusy.value = false;
    refreshResilience();
  }
}

function stopRendezvous() {
  ResilienceService.deactivateRendezvous();
  refreshResilience();
}

function toggleRendezvousAuto(value: boolean) {
  ResilienceService.setAutoEnabled(value);
  refreshResilience();
}

function reputationPct(score: number): number {
  return Math.round(score * 100);
}

// Dev-only: relax rendezvous endpoint validation for local two-profile testing.
const isDevBuild = import.meta.env.DEV;
const insecureDiscovery = ref(config.allowInsecureDiscovery);
function toggleInsecureDiscovery(value: boolean) {
  config.setAllowInsecureDiscovery(value);
  insecureDiscovery.value = config.allowInsecureDiscovery;
}

const exporting = ref(false);
const importing = ref(false);
const importProgress = ref<{ phase: string; current: number; total: number; percent: number } | null>(null);
const fileInputRef = ref<HTMLInputElement | null>(null);

const sharing = ref(false);
const incomingOffer = ref<{ peerId: string; size: number; hash: string; meta: { postCount: number; communityCount: number; blockHeight: number } } | null>(null);
const transferProgress = ref<{ direction: string; current: number; total: number; percent: number } | null>(null);

const webrtcEnabled = ref(localStorage.getItem('interpoll_webrtc_enabled') === 'true');
const expandedGuide = ref<string | null>(null);

const guides = [
  {
    id: 'tor', icon: lockClosedOutline, title: 'Using Tor Browser',
    steps: [
      'Download and install <a href="https://www.torproject.org" target="_blank" rel="noopener noreferrer">Tor Browser</a>.',
      'Open InterPoll in Tor Browser — this routes your traffic through Tor (a web app cannot do it on its own).',
      'Go to <strong>Settings → Network</strong> and enable <strong>Anonymity (Tor) Mode</strong> to disable WebRTC, which would otherwise leak your real IP via STUN.',
      'Optionally add a <code>.onion</code> relay address — Anonymity Mode will prefer it automatically.',
      'Use <strong>Check Tor status</strong> in that section to verify your connection is routing through Tor.',
    ],
  },
  {
    id: 'relay', icon: serverOutline, title: 'Self-Hosting a Relay',
    steps: [
      'Navigate to <code>gun-relay-server/</code> in the project root.',
      'Run <code>npm install</code> to install dependencies.',
      'Start with <code>npm start</code> — runs GunDB relay on port 8765 and WebSocket relay on port 8080.',
      'Configure a reverse proxy (nginx/Caddy) with TLS for production.',
      'Add your relay URL in <strong>Relay Management</strong> above.',
    ],
  },
  {
    id: 'peer', icon: hardwareChipOutline, title: 'Running a Headless Peer',
    steps: [
      'Run <code>node peer.js</code> from the project root to start a headless sync peer.',
      'The peer keeps data available for new clients even when no browsers are open.',
      'For Tor routing: <code>node peer.js --proxy socks5h://127.0.0.1:9050</code>',
      'Run as a systemd service for 24/7 uptime.',
    ],
  },
];


const cleanups: (() => void)[] = [];
const syncCleanups: (() => void)[] = [];
let importClearTimer: ReturnType<typeof setTimeout> | null = null;

// Gun multi-relay state
interface GunScanResult { url: string; reachable: boolean; latencyMs?: number }
const gunPeerUrls = ref<string[]>(config.getGunPeers());
const gunDetailedPeers = ref<Array<{ url: string; connected: boolean; latencyMs?: number }>>([]);
const gunConnectedCount = ref(0);
const gunAvgLatency = ref<number | undefined>(undefined);
const gunScanning = ref(false);
const gunScanResults = ref<GunScanResult[]>([]);
const newGunPeerUrl = ref('');
const selectedGunPreset = ref('');
const gunStartupProbeRunning = ref(false);
let gunPollInterval: ReturnType<typeof setInterval> | null = null;

// --- NAT traversal (ICE / TURN) ---
const turnUrl = ref('');
const turnUsername = ref('');
const turnCredential = ref('');
const iceServerCount = ref(config.getIceServers().length);
const turnActive = computed(() => config.getIceServers().some((s) => String(s.urls).startsWith('turn:')));

function loadTurnFromConfig() {
  const existing = config.getIceServers().find((s) => String(s.urls).startsWith('turn:'));
  if (existing) {
    turnUrl.value = String(existing.urls);
    turnUsername.value = existing.username ?? '';
    turnCredential.value = existing.credential ?? '';
  }
  iceServerCount.value = config.getIceServers().length;
}

function saveTurn() {
  const url = turnUrl.value.trim();
  if (!url) return;
  const entry: RTCIceServer = { urls: url };
  if (turnUsername.value.trim()) entry.username = turnUsername.value.trim();
  if (turnCredential.value.trim()) entry.credential = turnCredential.value.trim();
  config.setIceServers([...config.getDefaultIceServers(), entry]);
  iceServerCount.value = config.getIceServers().length;
}

function resetTurn() {
  config.resetIceServers();
  turnUrl.value = '';
  turnUsername.value = '';
  turnCredential.value = '';
  iceServerCount.value = config.getIceServers().length;
}

const availableGunPresets = computed(() =>
  GUN_RELAY_PRESETS.filter(p => !gunPeerUrls.value.includes(p.url))
);

function refreshGunStatus() {
  gunPeerUrls.value = config.getGunPeers();
  gunDetailedPeers.value = GunService.getDetailedPeerStats();
  const stats = GunService.getPeerStats();
  gunConnectedCount.value = stats.connectedCount;
  gunAvgLatency.value = stats.avgLatencyMs;
  gunStartupProbeRunning.value = GunService.presetProbeRunning;
}

async function addGunPeerFromInput() {
  const url = newGunPeerUrl.value.trim();
  if (!isValidGunUrl(url)) {
    await showToast('Invalid Gun relay URL');
    return;
  }
  const current = config.getGunPeers();
  if (current.includes(url)) {
    await showToast('Already in list');
    return;
  }
  const updated = [...current, url];
  config.setGunPeers(updated);
  GunService.addPeerDynamic(url);
  newGunPeerUrl.value = '';
  refreshGunStatus();
  await showToast(`Added ${labelForGunUrl(url)}`);
}

async function addGunPeerFromPreset() {
  const url = selectedGunPreset.value;
  if (!url) return;
  const current = config.getGunPeers();
  const updated = [...current, url];
  config.setGunPeers(updated);
  GunService.addPeerDynamic(url);
  selectedGunPreset.value = '';
  refreshGunStatus();
  await showToast(`Added ${labelForGunUrl(url)}`);
}

async function removeGunPeer(url: string) {
  const current = config.getGunPeers();
  if (current.length <= 1) {
    await showToast('Cannot remove last Gun relay');
    return;
  }
  const updated = current.filter(u => u !== url);
  config.setGunPeers(updated);
  GunService.reconnect(updated);
  refreshGunStatus();
  await showToast('Relay removed');
}

async function resetGunPeers() {
  config.resetGunPeers();
  GunService.reconnect(DEFAULT_GUN_PEERS);
  refreshGunStatus();
  await showToast('Gun peers reset to defaults');
}

async function scanGunPeers() {
  gunScanning.value = true;
  gunScanResults.value = [];

  // Reuse GunService probe (also discovers and adds live peers)
  await GunService.probePresetsAndExpand().catch(() => {});

  // Render results from the shared probe map
  const results: GunScanResult[] = [];
  for (const [url, status] of GunService.presetProbeResults) {
    const latencyMs = GunService['peerLatency']?.get?.(url);
    results.push({
      url,
      reachable: status === 'live',
      latencyMs: latencyMs ?? (status === 'dead' ? undefined : undefined),
    });
  }
  gunScanResults.value = results.sort((a, b) => {
    if (a.reachable && !b.reachable) return -1;
    if (!a.reachable && b.reachable) return 1;
    return (a.latencyMs ?? 99999) - (b.latencyMs ?? 99999);
  });

  refreshGunStatus();
  gunScanning.value = false;
  const liveCount = results.filter(r => r.reachable).length;
  await showToast(`${liveCount}/${results.length} Gun relays reachable`);
}

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

function bestRelayFromResults(results: RelayProbeResult[]): RelayProbeResult | null {
  const rank = (result: RelayProbeResult) => {
    if (result.overall === 'online') return 0;
    if (result.overall === 'degraded') return 1;
    return 2;
  };

  const sortable = [...results].sort((a, b) => {
    const rankDelta = rank(a) - rank(b);
    if (rankDelta !== 0) return rankDelta;

    const aLatency = avgLatency(a);
    const bLatency = avgLatency(b);
    const aValue = aLatency === '—' ? Number.POSITIVE_INFINITY : Number(aLatency);
    const bValue = bLatency === '—' ? Number.POSITIVE_INFINITY : Number(bLatency);
    return aValue - bValue;
  });

  return sortable.find(r => r.overall !== 'offline') ?? null;
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
  wsRegistrationRejected.value = WebSocketService.isRegistrationRejected();
  isTor.value = RelayHealthService.isTorBrowser();
}

// --- Actions ---
async function scanAllRelays() {
  scanning.value = true;
  try {
    const results = await RelayHealthService.probeAll(relays.value);
    probeResults.value = results;
    censorship.value = RelayHealthService.detectCensorship(results, relays.value);
    lastScanAt.value = new Date().toLocaleString();
    await showToast(`Scanned ${results.length} relay(s)`);
  } catch (e: unknown) {
    await showToast(e instanceof Error ? e.message : 'Scan failed');
  } finally {
    scanning.value = false;
  }
}

async function switchToBestRelay() {
  scanning.value = true;
  try {
    const results = await RelayHealthService.probeAll(relays.value);
    probeResults.value = results;
    censorship.value = RelayHealthService.detectCensorship(results, relays.value);
    lastScanAt.value = new Date().toLocaleString();
    const best = bestRelayFromResults(results);
    if (!best) {
      await showToast('No reachable relay available');
      return;
    }
    await RelayManager.switchToRelay(best.relayId);
    refreshStatus();
    await showToast(`Switched to ${relayLabelById(best.relayId)}`);
  } catch (e: unknown) {
    await showToast(e instanceof Error ? e.message : 'Could not pick relay');
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

function buildRelayReport(): string {
  if (probeResults.value.length === 0) return 'No relay scan available.';
  const lines = probeResults.value.map((result) => {
    return `${relayLabelById(result.relayId)}: ${result.overall} (WS:${result.ws.reachable ? 'up' : 'down'}, Gun:${result.gun.reachable ? 'up' : 'down'}, API:${result.api.reachable ? 'up' : 'down'}, latency:${latencyDisplay(result)})`;
  });
  const blockedCount = censorship.value?.blocked.length ?? 0;
  const torCount = censorship.value?.torRequired.length ?? 0;
  return [
    'InterPoll Relay Report',
    `Scanned: ${lastScanAt.value || 'unknown time'}`,
    ...lines,
    `Censorship signals: blocked=${blockedCount}, torRequired=${torCount}`,
  ].join('\n');
}

async function copyRelayReport() {
  try {
    await navigator.clipboard.writeText(buildRelayReport());
    await showToast('Relay report copied');
  } catch (e: unknown) {
    await showToast(e instanceof Error ? e.message : 'Copy failed');
  }
}

async function copyTorPeerCommand() {
  try {
    await navigator.clipboard.writeText('node peer.js --proxy socks5h://127.0.0.1:9050');
    await showToast('Tor command copied');
  } catch (e: unknown) {
    await showToast(e instanceof Error ? e.message : 'Copy failed');
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
  refreshGunStatus();
  refreshResilience();
  loadTurnFromConfig();

  cleanups.push(RelayManager.onRelayListChange(() => refreshStatus()));

  cleanups.push(WebSocketService.onStatusChange((status) => {
    wsConnected.value = status.connected;
    peerCount.value = status.peerCount;
    wsRegistrationRejected.value = status.registrationRejected;
    refreshResilience();
  }));

  // Poll Gun peer stats + resilience status every 4s while page is open
  gunPollInterval = setInterval(() => {
    refreshGunStatus();
    refreshResilience();
  }, 4000);

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
  if (gunPollInterval) clearInterval(gunPollInterval);
  cleanups.forEach(fn => fn());
  syncCleanups.forEach(fn => fn());
  SnapshotSyncService.cleanup();
});
</script>

<style scoped>
ion-header::after { display: none !important; }
ion-toolbar { --border-width: 0 !important; }

ion-content {
  --background:
    radial-gradient(ellipse at 15% 0%,   rgba(139, 92, 246, 0.35) 0%, transparent 50%),
    radial-gradient(ellipse at 88% 8%,   rgba(236, 72, 153, 0.22) 0%, transparent 45%),
    radial-gradient(ellipse at 50% 100%, rgba(99, 102, 241, 0.24) 0%, transparent 55%),
    radial-gradient(ellipse at 0%  55%,  rgba(79,  70, 229, 0.15) 0%, transparent 40%),
    #0d0e1c;
}

:deep(.surface-card),
:deep(.main-content),
:deep(.page-layout) {
  background: transparent !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
  box-shadow: none !important;
  border: none !important;
}

.back-btn {
  display: flex; align-items: center; justify-content: center;
  width: 36px; height: 36px; background: none; border: none;
  border-radius: 50%; color: var(--app-text-muted); cursor: pointer;
  margin-left: 4px; transition: color 160ms ease;
}
.back-btn:hover { color: var(--app-text); }
.back-btn svg { width: 22px; height: 22px; }

/* Body */
.resilience-body {
  max-width: 860px; margin: 0 auto; padding: 16px 16px 60px;
  display: flex; flex-direction: column; gap: 14px;
}

/* Hero */
.hero-card {
  border-radius: 20px; padding: 20px 22px;
  background: rgba(99, 102, 241, 0.12);
  border: 1px solid rgba(99,102,241,0.28);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  display: flex; flex-direction: column; gap: 16px;
}
.hero-left { display: flex; align-items: flex-start; gap: 14px; }
.hero-icon-wrap {
  width: 44px; height: 44px; border-radius: 12px; flex-shrink: 0;
  background: linear-gradient(135deg,#6366f1,#8b5cf6);
  display: flex; align-items: center; justify-content: center;
  font-size: 22px; color: #fff; box-shadow: 0 4px 14px rgba(99,102,241,.35);
}
.hero-title { font-size: 17px; font-weight: 800; letter-spacing: -0.025em; color: var(--app-text); margin: 0 0 4px; }
.hero-sub { font-size: 13px; color: var(--app-text-muted); line-height: 1.55; margin: 0; }
.quick-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.qa-btn {
  display: inline-flex; align-items: center; gap: 6px; padding: 8px 14px;
  border-radius: 999px; border: 1px solid rgba(255,255,255,0.1);
  background: rgba(255,255,255,0.05); color: var(--app-text-muted);
  font-size: 13px; font-weight: 600; cursor: pointer;
  transition: all 160ms ease;
}
.qa-btn.primary { background: linear-gradient(135deg,#6366f1,#8b5cf6); border-color: transparent; color: #fff; box-shadow: 0 4px 14px rgba(99,102,241,.35); }
.qa-btn:hover:not(:disabled) { background: rgba(255,255,255,0.09); color: var(--app-text); }
.qa-btn.primary:hover:not(:disabled) { opacity: .9; }
.qa-btn:disabled { opacity: .35; cursor: not-allowed; }
.qa-btn ion-icon { font-size: 15px; }

/* Cards */
.r-card {
  border-radius: 18px; padding: 18px 20px;
  background: rgba(15, 12, 32, 0.55);
  border: 1px solid rgba(139, 92, 246, 0.15);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
}

/* Card head */
.card-head { display: flex; align-items: flex-start; gap: 14px; margin-bottom: 16px; }
.card-head-icon {
  width: 40px; height: 40px; border-radius: 12px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center; font-size: 20px; color: #fff;
}
.accent-violet { background: linear-gradient(135deg,#6366f1,#8b5cf6); box-shadow: 0 4px 12px rgba(99,102,241,.3); }
.accent-blue   { background: linear-gradient(135deg,#3b82f6,#6366f1); box-shadow: 0 4px 12px rgba(59,130,246,.3); }
.accent-teal   { background: linear-gradient(135deg,#14b8a6,#3b82f6); box-shadow: 0 4px 12px rgba(20,184,166,.3); }
.accent-amber  { background: linear-gradient(135deg,#f59e0b,#ef4444); box-shadow: 0 4px 12px rgba(245,158,11,.3); }
.accent-green  { background: linear-gradient(135deg,#22c55e,#14b8a6); box-shadow: 0 4px 12px rgba(34,197,94,.3); }
.card-head-text { flex: 1; min-width: 0; }
.card-head-text h3 { margin: 0 0 3px; font-size: 15px; font-weight: 700; letter-spacing: -0.02em; color: var(--app-text); }
.card-head-text p { margin: 0; font-size: 12.5px; color: var(--app-text-muted); line-height: 1.45; }
.card-head-badges { display: flex; flex-wrap: wrap; gap: 6px; flex-shrink: 0; }

/* Status strip */
.status-strip {
  display: flex; align-items: center; flex-wrap: wrap; gap: 14px;
  padding: 10px 14px; border-radius: 12px;
  background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.07);
  margin-bottom: 14px; font-size: 13px; color: var(--app-text-muted);
}
.strip-item { display: flex; align-items: center; gap: 7px; }
.strip-time { margin-left: auto; font-size: 11.5px; color: var(--app-text-subtle); }

/* Dots */
.s-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.dot-ok   { background: #34d399; box-shadow: 0 0 7px rgba(52,211,153,.6); animation: pulse 2s infinite; }
.dot-err  { background: #ef4444; }
.dot-warn { background: #fbbf24; }
.dot-idle { background: rgba(255,255,255,0.2); }
@keyframes pulse { 0%,100% { box-shadow: 0 0 5px rgba(52,211,153,.5); } 50% { box-shadow: 0 0 12px rgba(52,211,153,.9); } }

/* Pills */
.status-pill {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 3px 9px; border-radius: 999px;
  font-size: 10.5px; font-weight: 700; letter-spacing: 0.04em;
}
.pill-ok   { background: rgba(52,211,153,.12); color: #34d399; border: 1px solid rgba(52,211,153,.25); }
.pill-err  { background: rgba(239,68,68,.12);  color: #ef4444; border: 1px solid rgba(239,68,68,.25); }
.pill-warn { background: rgba(251,191,36,.12); color: #fbbf24; border: 1px solid rgba(251,191,36,.25); }
.pill-dark { background: rgba(255,255,255,.07); color: var(--app-text-muted); border: 1px solid rgba(255,255,255,.1); }

.overall-pill { display: inline-flex; align-items: center; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 700; }

.count-badge {
  padding: 4px 10px; border-radius: 999px; white-space: nowrap;
  background: rgba(99,102,241,.12); color: #818cf8;
  border: 1px solid rgba(99,102,241,.22); font-size: 12px; font-weight: 700;
}

/* Info boxes */
.info-box {
  display: flex; align-items: flex-start; gap: 10px;
  padding: 12px 14px; border-radius: 12px;
  font-size: 13px; line-height: 1.5; margin-bottom: 12px;
}
.info-box ion-icon { font-size: 16px; flex-shrink: 0; margin-top: 1px; }
.info-ok   { background: rgba(52,211,153,.08); border: 1px solid rgba(52,211,153,.2); color: #34d399; }
.info-warn { background: rgba(251,191,36,.08); border: 1px solid rgba(251,191,36,.2); color: #fbbf24; }
.info-info { background: rgba(99,102,241,.08); border: 1px solid rgba(99,102,241,.2); color: #a5b4fc; }

/* Buttons */
.block-btn {
  width: 100%; padding: 13px; border-radius: 14px; border: none;
  font-size: 14px; font-weight: 700; cursor: pointer;
  display: flex; align-items: center; justify-content: center; gap: 8px;
  transition: opacity 160ms, transform 160ms; margin-top: 8px;
}
.block-btn.accent { background: linear-gradient(135deg,#6366f1,#8b5cf6); color: #fff; box-shadow: 0 6px 20px rgba(99,102,241,.35); }
.block-btn.outline { background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.1); color: var(--app-text-muted); }
.block-btn:hover:not(:disabled) { opacity: .88; transform: translateY(-1px); }
.block-btn:disabled { opacity: .35; cursor: not-allowed; }

.pill-btn {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 8px 16px; border-radius: 999px; border: none;
  font-size: 13px; font-weight: 700; cursor: pointer;
  transition: opacity 160ms, transform 160ms; white-space: nowrap;
}
.pill-btn.accent { background: linear-gradient(135deg,#6366f1,#8b5cf6); color: #fff; box-shadow: 0 4px 12px rgba(99,102,241,.35); }
.pill-btn.outline { background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.1); color: var(--app-text-muted); }
.pill-btn.sm { padding: 5px 11px; font-size: 11.5px; }
.pill-btn:hover:not(:disabled) { opacity: .88; transform: translateY(-1px); }
.pill-btn:disabled { opacity: .35; cursor: not-allowed; }

.icon-btn {
  width: 30px; height: 30px; border-radius: 50%; border: none;
  background: rgba(255,255,255,.06); color: var(--app-text-muted);
  display: flex; align-items: center; justify-content: center;
  font-size: 15px; cursor: pointer; transition: background 160ms;
}
.icon-btn:hover { background: rgba(255,255,255,.12); color: var(--app-text); }
.icon-btn.danger { background: rgba(239,68,68,.1); color: #ef4444; }
.icon-btn.danger:hover { background: rgba(239,68,68,.2); }
.icon-btn.sm { width: 24px; height: 24px; font-size: 12px; }

.button-row { display: flex; flex-wrap: wrap; gap: 8px; }
.flex1 { flex: 1; }
.inline-add { display: flex; align-items: center; gap: 8px; }

/* Fields */
.field-group { display: flex; flex-direction: column; gap: 6px; margin-top: 10px; }
.field-label { font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; color: var(--app-text-subtle); }
.field-wrap { border-radius: 12px; background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.09); overflow: hidden; transition: border-color 180ms, box-shadow 180ms; }
.field-wrap:focus-within { border-color: rgba(99,102,241,.5); box-shadow: 0 0 0 3px rgba(99,102,241,.1); }
.field-native { width: 100%; background: transparent; border: none; outline: none; padding: 11px 14px; font-size: 13.5px; font-family: inherit; color: var(--ion-text-color); -webkit-appearance: none; appearance: none; }
.field-native::placeholder { color: var(--app-text-subtle); }
select.field-native { background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='rgba(255,255,255,0.4)' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 12px center; padding-right: 32px; cursor: pointer; }
select.field-native option { background: #1a1a2e; color: #fff; }
.mono-sm { font-family: monospace; font-size: 12px; }

/* Inset panel */
.inset-panel { padding: 14px 16px; border-radius: 14px; background: rgba(255,255,255,.03); border: 1px solid rgba(255,255,255,.07); }

/* Toggle */
.toggle-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,.05); }
.toggle-row:last-child { border-bottom: none; }
.toggle-label { font-size: 14px; font-weight: 600; color: var(--app-text); }
.toggle-sub { font-size: 12px; color: var(--app-text-muted); margin-top: 2px; }
.toggle-switch { position: relative; width: 44px; height: 26px; flex-shrink: 0; }
.toggle-switch input { opacity: 0; width: 0; height: 0; }
.toggle-track { position: absolute; inset: 0; border-radius: 999px; background: rgba(255,255,255,.12); border: 1px solid rgba(255,255,255,.1); cursor: pointer; transition: background 200ms; }
.toggle-switch input:checked + .toggle-track { background: #6366f1; border-color: #6366f1; }
.toggle-track::after { content: ''; position: absolute; top: 3px; left: 3px; width: 18px; height: 18px; border-radius: 50%; background: #fff; box-shadow: 0 1px 4px rgba(0,0,0,.3); transition: transform 200ms; }
.toggle-switch input:checked + .toggle-track::after { transform: translateX(18px); }

/* Relay list */
.relay-list { display: flex; flex-direction: column; gap: 8px; margin-bottom: 10px; }
.relay-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 14px; border-radius: 14px; background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.08); }
.relay-row--active { border-color: rgba(52,211,153,.3); background: rgba(52,211,153,.05); }
.relay-row-left { display: flex; align-items: flex-start; gap: 10px; flex: 1; min-width: 0; }
.relay-name-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.relay-name { font-size: 14px; font-weight: 700; color: var(--app-text); }
.relay-url { font-size: 11px; font-family: monospace; color: var(--app-text-subtle); margin-top: 2px; }
.relay-priority { font-size: 11px; color: var(--app-text-subtle); }
.relay-row-actions { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
.active-tag { padding: 2px 7px; border-radius: 999px; background: rgba(52,211,153,.12); color: #34d399; font-size: 10px; font-weight: 700; border: 1px solid rgba(52,211,153,.25); }

/* Gun relay grid */
.gun-relay-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 10px; }
@media (max-width: 480px) { .gun-relay-grid { grid-template-columns: 1fr; } }
.gun-relay-card { padding: 12px 14px; border-radius: 14px; background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.08); }
.gun-relay-card--live { border-color: rgba(52,211,153,.25); background: rgba(52,211,153,.05); }
.gun-relay-header { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.gun-relay-name { flex: 1; font-size: 13px; font-weight: 700; color: var(--app-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.latency-tag { font-size: 10px; font-family: monospace; background: rgba(255,255,255,.06); color: var(--app-text-muted); padding: 2px 6px; border-radius: 5px; flex-shrink: 0; }
.gun-relay-url { font-size: 10.5px; font-family: monospace; color: var(--app-text-subtle); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 3px; }
.gun-relay-status { font-size: 11px; font-weight: 600; }
.status-ok { color: #34d399; }
.status-idle { color: var(--app-text-subtle); }

/* Probe table */
.probe-table-wrap { overflow-x: auto; border-radius: 12px; border: 1px solid rgba(255,255,255,.07); }
.probe-table { width: 100%; font-size: 12.5px; border-collapse: collapse; }
.probe-table th { padding: 8px 12px; text-align: left; font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; color: var(--app-text-subtle); background: rgba(255,255,255,.03); border-bottom: 1px solid rgba(255,255,255,.07); }
.probe-table td { padding: 8px 12px; border-bottom: 1px solid rgba(255,255,255,.04); color: var(--app-text-muted); }
.probe-table tr:last-child td { border-bottom: none; }
.mono { font-family: monospace; }
.truncate-cell { max-width: 160px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* Progress */
.progress-wrap { display: flex; flex-direction: column; gap: 6px; }
.progress-bar { height: 6px; background: rgba(255,255,255,.08); border-radius: 999px; overflow: hidden; }
.progress-fill { height: 100%; border-radius: 999px; transition: width 200ms ease; }
.progress-fill.ok   { background: linear-gradient(90deg,#34d399,#14b8a6); }
.progress-fill.blue { background: linear-gradient(90deg,#6366f1,#8b5cf6); }

/* Code card */
.code-card { border-radius: 14px; background: rgba(10,8,20,.6); border: 1px solid rgba(255,255,255,.1); padding: 14px 16px; }
.code-card-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 10px; }
.code-card-title { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 700; color: var(--app-text); }
.code-block { display: block; font-family: monospace; font-size: 12px; line-height: 1.5; word-break: break-all; color: #a5f3fc; background: rgba(0,0,0,.4); border: 1px solid rgba(255,255,255,.07); border-radius: 8px; padding: 10px 12px; }

/* Guides */
.guide-item { border-bottom: 1px solid rgba(255,255,255,.06); }
.guide-item:last-child { border-bottom: none; }
.guide-toggle { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 0; background: none; border: none; color: var(--app-text); font-size: 14px; font-weight: 700; cursor: pointer; text-align: left; }
.guide-toggle-left { display: flex; align-items: center; gap: 10px; }
.guide-toggle-left ion-icon { font-size: 18px; color: #818cf8; }
.guide-chevron { font-size: 16px; color: var(--app-text-subtle); flex-shrink: 0; }
.guide-content { padding: 0 4px 14px; }
.guide-steps { margin: 0; padding-left: 20px; display: flex; flex-direction: column; gap: 8px; }
.guide-steps li { font-size: 13.5px; color: var(--app-text-muted); line-height: 1.6; }
.guide-steps code { font-family: monospace; font-size: 12px; background: rgba(255,255,255,.07); padding: 1px 5px; border-radius: 4px; }
.guide-steps a { color: #818cf8; text-decoration: none; }
.guide-steps a:hover { text-decoration: underline; }

/* Helpers */
.subsection-title { display: flex; align-items: center; gap: 6px; font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; color: var(--app-text-subtle); margin: 0 0 10px; }
.subsection-title ion-icon { font-size: 13px; }
.helper-text { font-size: 12.5px; color: var(--app-text-muted); line-height: 1.5; margin: 0; }
.mt-8 { margin-top: 8px; }
.mt-12 { margin-top: 12px; }
.mt-16 { margin-top: 16px; }
.btn-spinner { width: 16px; height: 16px; border: 2px solid rgba(255,255,255,.3); border-top-color: #fff; border-radius: 50%; animation: spin .7s linear infinite; flex-shrink: 0; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
