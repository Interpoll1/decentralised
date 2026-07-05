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
      <ion-card class="hero-card">
        <ion-card-header>
          <ion-card-title class="hero-title">
            <ion-icon :icon="analyticsOutline" class="hero-icon"></ion-icon>
            Resilience Center
          </ion-card-title>
          <p class="text-sm opacity-60 mt-1">
            Keep your connection healthy, rotate relays quickly, and protect continuity with snapshot backup tools.
          </p>
        </ion-card-header>
        <ion-card-content>
          <div class="quick-actions-grid">
            <ion-button :disabled="scanning" @click="scanAllRelays">
              <ion-icon :icon="analyticsOutline" slot="start"></ion-icon>
              Scan Relays
            </ion-button>
            <ion-button fill="outline" :disabled="scanning || relays.length === 0" @click="switchToBestRelay">
              <ion-icon :icon="swapHorizontalOutline" slot="start"></ion-icon>
              Best Relay
            </ion-button>
            <ion-button fill="outline" :disabled="exporting" @click="exportSnapshot">
              <ion-icon :icon="downloadOutline" slot="start"></ion-icon>
              Backup
            </ion-button>
            <ion-button fill="outline" :disabled="sharing" @click="shareWithPeers">
              <ion-icon :icon="sendOutline" slot="start"></ion-icon>
              Share
            </ion-button>
            <ion-button fill="clear" :disabled="probeResults.length === 0" @click="copyRelayReport">
              <ion-icon :icon="copyOutline" slot="start"></ion-icon>
              Copy Report
            </ion-button>
          </div>
        </ion-card-content>
      </ion-card>

      <!-- 1. Network Status -->
      <ion-card>
        <ion-card-header>
          <div class="card-header-row">
            <ion-card-title>Network Status</ion-card-title>
            <div class="flex items-center gap-2">
              <ion-badge :color="wsConnected ? 'success' : 'danger'">
                {{ wsConnected ? 'Connected' : 'Disconnected' }}
              </ion-badge>
              <ion-badge v-if="isTor" color="dark">
                <ion-icon :icon="fingerPrintOutline" class="mr-1"></ion-icon> Tor
              </ion-badge>
            </div>
          </div>
          <p class="card-subtitle">
            Check live WebSocket health, peer reachability, and censorship signals across your configured relays.
          </p>
        </ion-card-header>
        <ion-card-content>
          <div class="status-bar mb-3">
            <div class="status-bar-item">
              <span class="status-dot" :class="wsConnected ? 'online' : 'offline'"></span>
              <span class="text-sm">{{ peerCount }} peer{{ peerCount !== 1 ? 's' : '' }}</span>
            </div>
            <span v-if="lastScanAt" class="text-xs opacity-50">Last scan: {{ lastScanAt }}</span>
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
            <p v-if="censorship.blocked.length" class="censorship-status censorship-status--danger flex items-center gap-1">
              <ion-icon :icon="warningOutline" /> {{ censorship.blocked.length }} relay(s) appear blocked from your network.
            </p>
            <p v-if="censorship.torRequired.length" class="censorship-status censorship-status--warning flex items-center gap-1">
              <ion-icon :icon="lockClosedOutline" /> {{ censorship.torRequired.length }} relay(s) require Tor to reach.
            </p>
            <p v-if="!censorship.blocked.length && !censorship.torRequired.length" class="censorship-status censorship-status--ok flex items-center gap-1">
              <ion-icon :icon="checkmarkCircleOutline" /> No censorship detected -- all relays reachable.
            </p>
          </div>
        </ion-card-content>
      </ion-card>

      <!-- 1b. Fallback Rendezvous (resilience orchestrator) -->
      <ion-card>
        <ion-card-header>
          <div class="card-header-row">
            <ion-card-title>
              <ion-icon :icon="radioOutline" class="mr-1" /> Fallback Rendezvous
            </ion-card-title>
            <ion-badge :color="tierColor">{{ tierLabels[resilience.tier] }}</ion-badge>
          </div>
          <p class="card-subtitle">
            When every relay and known peer is blocked, nodes independently derive the same
            time-rotating rendezvous point and reconverge there — a deterministic, signature-verified
            fallback so the network heals itself under censorship.
          </p>
        </ion-card-header>
        <ion-card-content>
          <div class="status-bar mb-3">
            <div class="status-bar-item">
              <span class="status-dot" :class="resilience.blackout ? 'offline' : 'online'"></span>
              <span class="text-sm">{{ resilience.blackout ? 'Blackout detected' : 'Connectivity OK' }}</span>
            </div>
            <div class="status-bar-item">
              <span class="status-dot" :class="resilience.rendezvousActive ? 'online' : 'offline'"></span>
              <span class="text-sm">Rendezvous {{ resilience.rendezvousActive ? 'active' : 'idle' }}</span>
            </div>
            <span class="text-xs opacity-50">Last reconverge: {{ lastRendezvousDisplay }}</span>
          </div>

          <ion-item lines="none" class="rounded-xl glass-inset mb-3">
            <ion-label>
              <h2 class="text-sm">Auto-escalate on blackout</h2>
              <p class="text-xs opacity-60">Publish/subscribe to rendezvous automatically when isolated.</p>
            </ion-label>
            <ion-toggle
              slot="end"
              :checked="resilience.autoEnabled"
              @ionChange="toggleRendezvousAuto($event.detail.checked)"
            ></ion-toggle>
          </ion-item>

          <ion-item v-if="isDevBuild" lines="none" class="rounded-xl glass-inset mb-3">
            <ion-label>
              <h2 class="text-sm">Dev: allow insecure endpoints</h2>
              <p class="text-xs opacity-60">
                Accept ws://localhost in rendezvous so two local browser profiles can reconverge.
                Dev-only — ignored in production builds.
              </p>
            </ion-label>
            <ion-toggle
              slot="end"
              :checked="insecureDiscovery"
              @ionChange="toggleInsecureDiscovery($event.detail.checked)"
            ></ion-toggle>
          </ion-item>

          <div class="flex gap-2">
            <ion-button expand="block" class="flex-1" :disabled="rendezvousBusy" @click="triggerRendezvous">
              <ion-spinner v-if="rendezvousBusy" name="crescent" class="mr-2"></ion-spinner>
              {{ resilience.rendezvousActive ? 'Re-broadcast' : 'Reconnect via rendezvous' }}
            </ion-button>
            <ion-button
              v-if="resilience.rendezvousActive"
              fill="outline"
              color="medium"
              @click="stopRendezvous"
            >
              Stop
            </ion-button>
          </div>

          <!-- Endpoint reputation -->
          <div v-if="resilience.reputation.length" class="mt-4">
            <h3 class="subsection-title">
              <ion-icon :icon="pulseOutline" class="mr-1" /> Endpoint reputation
            </h3>
            <div class="overflow-x-auto">
              <table class="w-full text-sm">
                <thead>
                  <tr class="text-left opacity-70">
                    <th class="pb-2">Endpoint</th>
                    <th class="pb-2" title="Recency-weighted score — reflects recent attempts more than lifetime history">Recent score</th>
                    <th class="pb-2">OK</th>
                    <th class="pb-2">Fail</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="rep in resilience.reputation" :key="rep.id" class="border-t border-gray-700/30">
                    <td class="py-2 truncate max-w-[160px]">{{ rep.id }}</td>
                    <td>
                      <div class="flex items-center gap-1">
                        <ion-icon
                          :icon="ellipse"
                          :color="rep.score >= 0.6 ? 'success' : rep.score >= 0.3 ? 'warning' : 'danger'"
                          size="small"
                        />
                        {{ reputationPct(rep.score) }}%
                      </div>
                    </td>
                    <td>{{ rep.successes }}</td>
                    <td>{{ rep.failures }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
          <p v-else class="text-xs opacity-50 mt-3">
            No reputation data yet — scan relays to start scoring endpoint reliability.
          </p>
        </ion-card-content>
      </ion-card>

      <!-- 2. Relay Management -->
      <ion-card>
        <ion-card-header>
          <ion-card-title>Relay Management</ion-card-title>
          <p class="card-subtitle">
            Add fallback relays, probe individual endpoints, and switch instantly when performance drops.
          </p>
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
          <div class="mt-4 glass-inset p-4">
            <h3 class="subsection-title">Add Relay</h3>
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

      <!-- 3. Gun DB Relay Network -->
      <ion-card>
        <ion-card-header>
          <div class="card-header-row">
            <ion-card-title>GunDB Relay Network</ion-card-title>
            <ion-badge :color="gunConnectedCount > 0 ? 'success' : 'danger'" class="stat-badge">
              {{ gunConnectedCount }}/{{ gunPeerUrls.length }} live
              <span v-if="gunAvgLatency != null"> · {{ gunAvgLatency }}ms</span>
            </ion-badge>
          </div>
          <p class="card-subtitle">
            Gun connects to all peers simultaneously. Data syncs across all relays — the more peers, the more resilient the network.
          </p>
        </ion-card-header>
        <ion-card-content>

          <!-- Live peer grid -->
          <div class="gun-relay-grid">
            <div
              v-for="peer in gunDetailedPeers"
              :key="peer.url"
              class="gun-relay-card"
              :class="{ 'gun-relay-card--live': peer.connected }"
            >
              <div class="gun-relay-header">
                <span class="gun-relay-dot" :class="{ online: peer.connected }"></span>
                <strong class="gun-relay-name">{{ labelForGunUrl(peer.url) }}</strong>
                <span v-if="peer.latencyMs != null" class="gun-relay-latency">{{ peer.latencyMs }}ms</span>
              </div>
              <div class="gun-relay-url">{{ peer.url }}</div>
              <div class="gun-relay-status" :class="peer.connected ? 'text-green-400' : 'text-gray-500'">
                {{ peer.connected ? '● Connected' : '○ Connecting…' }}
              </div>
              <ion-button
                v-if="gunPeerUrls.length > 1"
                size="small"
                fill="clear"
                color="danger"
                class="gun-relay-remove"
                @click="removeGunPeer(peer.url)"
              >
                <ion-icon :icon="trashOutline" slot="icon-only"></ion-icon>
              </ion-button>
            </div>
          </div>

          <!-- Startup probe status -->
          <div v-if="gunStartupProbeRunning" class="mt-2 flex items-center gap-2 text-sm opacity-70">
            <ion-spinner name="dots" style="width:16px;height:16px"></ion-spinner>
            Probing all relays in background…
          </div>

          <!-- Scan all Gun peers -->
          <ion-button expand="block" :disabled="gunScanning || gunStartupProbeRunning" class="mt-3" @click="scanGunPeers">
            <ion-spinner v-if="gunScanning" name="crescent" class="mr-2"></ion-spinner>
            <ion-icon v-else :icon="analyticsOutline" slot="start"></ion-icon>
            {{ gunScanning ? 'Probing all 38 relays…' : 'Probe All Relay Presets' }}
          </ion-button>

          <!-- Gun scan results -->
          <div v-if="gunScanResults.length" class="mt-3 overflow-x-auto">
            <div class="text-xs opacity-60 mb-1">
              {{ gunScanResults.filter(r => r.reachable).length }}/{{ gunScanResults.length }} reachable
              · live peers auto-added
            </div>
            <table class="w-full text-sm">
              <thead>
                <tr class="text-left opacity-70">
                  <th class="pb-2">Peer</th>
                  <th class="pb-2">Status</th>
                  <th class="pb-2">Latency</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="r in gunScanResults" :key="r.url" class="border-t border-gray-700/30">
                  <td class="py-1 text-xs font-mono opacity-80">{{ labelForGunUrl(r.url) }}</td>
                  <td>
                    <ion-icon
                      :icon="ellipse"
                      :color="r.reachable ? 'success' : 'danger'"
                      size="small"
                    />
                  </td>
                  <td class="text-xs">{{ r.latencyMs != null ? r.latencyMs + 'ms' : '—' }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- Add from presets -->
          <div class="mt-4 glass-inset p-4">
            <h3 class="subsection-title">Add Gun Peer</h3>
            <div class="flex gap-2 mb-2">
              <select v-model="selectedGunPreset" class="gun-preset-select flex-1 text-sm">
                <option value="">— pick a preset —</option>
                <option v-for="p in availableGunPresets" :key="p.url" :value="p.url">{{ p.label }}</option>
              </select>
              <ion-button size="small" :disabled="!selectedGunPreset" @click="addGunPeerFromPreset">Add</ion-button>
            </div>
            <div class="flex gap-2">
              <ion-input
                v-model="newGunPeerUrl"
                placeholder="https://your-relay.example.com/gun"
                fill="outline"
                class="flex-1 text-xs"
                @keyup.enter="addGunPeerFromInput"
              ></ion-input>
              <ion-button size="small" :disabled="!newGunPeerUrl.trim()" @click="addGunPeerFromInput">Add</ion-button>
            </div>
          </div>

          <ion-button expand="block" fill="outline" color="medium" size="small" class="mt-3" @click="resetGunPeers">
            Reset to defaults
          </ion-button>
        </ion-card-content>
      </ion-card>

      <!-- 4. Snapshot Manager -->
      <ion-card>
        <ion-card-header>
          <ion-card-title>Snapshot Manager</ion-card-title>
          <p class="card-subtitle">
            Export encrypted local state backups, import trusted snapshots, and share state for fast peer recovery.
          </p>
        </ion-card-header>
        <ion-card-content>
          <!-- Export -->
          <div class="snapshot-section">
            <h3 class="subsection-title">
              <ion-icon :icon="downloadOutline"></ion-icon>
              Export
            </h3>
            <ion-button expand="block" :disabled="exporting" @click="exportSnapshot">
              <ion-spinner v-if="exporting" name="crescent" class="mr-2"></ion-spinner>
              <ion-icon v-else :icon="downloadOutline" slot="start"></ion-icon>
              {{ exporting ? 'Exporting…' : 'Export Full Snapshot' }}
            </ion-button>
          </div>

          <!-- Import -->
          <div class="snapshot-section">
            <h3 class="subsection-title">
              <ion-icon :icon="cloudUploadOutline"></ion-icon>
              Import
            </h3>
            <div class="warn-box mb-3">
              <ion-icon :icon="shieldCheckmarkOutline" class="mr-1 align-middle" />
              Only import snapshots from people you trust. A malicious snapshot could inject harmful content into your local data.
            </div>
            <input
              ref="fileInputRef"
              type="file"
              accept=".json"
              style="display: none"
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
          <div class="snapshot-section">
            <h3 class="subsection-title">
              <ion-icon :icon="sendOutline"></ion-icon>
              P2P Share
            </h3>
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

      <!-- 5. Peer-to-Peer Mesh -->
      <ion-card>
        <ion-card-header>
          <ion-card-title>Peer-to-Peer Mesh</ion-card-title>
          <p class="card-subtitle">Direct browser-to-browser connections that survive relay outages.</p>
        </ion-card-header>
        <ion-card-content>
          <P2PManualSignal />

          <!-- NAT traversal: diverse STUN by default + optional TURN for restrictive networks -->
          <div class="mt-4 glass-inset p-4">
            <h3 class="subsection-title">NAT Traversal (ICE / TURN)</h3>
            <p class="text-xs opacity-60 mb-3">
              Using {{ iceServerCount }} ICE server{{ iceServerCount !== 1 ? 's' : '' }} ({{ turnActive ? 'incl. your TURN' : 'diverse public STUN' }}).
              Behind a symmetric NAT or strict firewall? Add a TURN server so direct connections can still form.
            </p>
            <ion-input v-model="turnUrl" placeholder="turn:turn.example.com:3478" fill="outline" class="mb-2"></ion-input>
            <div class="flex gap-2 mb-2">
              <ion-input v-model="turnUsername" placeholder="username (optional)" fill="outline"></ion-input>
              <ion-input v-model="turnCredential" type="password" placeholder="credential (optional)" fill="outline"></ion-input>
            </div>
            <div class="flex gap-2">
              <ion-button size="small" :disabled="!turnUrl.trim()" @click="saveTurn">Save TURN</ion-button>
              <ion-button size="small" fill="outline" color="medium" @click="resetTurn">Reset to STUN</ion-button>
            </div>
          </div>
        </ion-card-content>
      </ion-card>

      <!-- 6. Advanced Tools -->
      <ion-card>
        <ion-card-header>
          <ion-card-title>Advanced Tools</ion-card-title>
          <p class="card-subtitle">Optional controls for relay-assisted peer sync and command-line Tor peer operations.</p>
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

          <div class="tor-command-card mt-4">
            <div class="tor-command-header">
              <div class="tor-command-title">
                <ion-icon :icon="terminalOutline"></ion-icon>
                <strong>Tor headless peer command</strong>
              </div>
              <ion-button size="small" fill="outline" @click="copyTorPeerCommand">
                <ion-icon :icon="copyOutline" slot="start"></ion-icon>
                Copy
              </ion-button>
            </div>
            <code class="tor-command-code">
              node peer.js --proxy socks5h://127.0.0.1:9050
            </code>
            <p class="tor-command-help">
              Use this only when you run a dedicated relay peer through Tor.
            </p>
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
                <li>Download and install <a href="https://www.torproject.org" target="_blank" rel="noopener noreferrer" class="text-blue-400 underline">Tor Browser</a>.</li>
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

// --- State ---
const relays = ref<RelayEndpoint[]>([]);
const activeRelay = ref<RelayEndpoint | null>(null);
const wsConnected = ref(false);
const peerCount = ref(0);
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
.censorship-status--danger { color: var(--app-danger); }
.censorship-status--warning { color: var(--app-warning); }
.censorship-status--ok { color: var(--app-success); }

/* ── Base resets ───────────────────────────────────────── */
ion-item  { --background: transparent; }
ion-list  { --ion-item-background: transparent; background: transparent; }

code {
  font-family: 'Fira Code', 'Courier New', monospace;
}

table th, table td {
  padding: 6px 8px;
}

/* ── Cards ─────────────────────────────────────────────── */
ion-card {
  --background: rgba(20, 20, 28, 0.72);
  backdrop-filter: blur(18px) saturate(1.5);
  -webkit-backdrop-filter: blur(18px) saturate(1.5);
  border: 1px solid rgba(255, 255, 255, 0.10);
  border-radius: 18px;
  box-shadow: 0 6px 28px rgba(0, 0, 0, 0.35), inset 0 1px 0 rgba(255,255,255,0.05);
  margin-bottom: 12px;
}

ion-card-header, ion-card-content {
  --background: transparent;
}

ion-card-header {
  padding-bottom: 8px;
}

/* Hero card gets a subtle accent border-top */
.hero-card {
  border-top: 2px solid rgba(var(--ion-color-primary-rgb), 0.55);
}

.hero-title {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 1.1rem;
  font-weight: 700;
}

.hero-icon {
  font-size: 1.3rem;
  color: var(--ion-color-primary);
}

/* ── Card header row (title + badge) ───────────────────── */
.card-header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.card-subtitle {
  font-size: 0.8rem;
  opacity: 0.55;
  margin-top: 4px;
  line-height: 1.4;
}

.stat-badge {
  font-size: 0.75rem;
  white-space: nowrap;
  flex-shrink: 0;
}

/* ── Status bar ─────────────────────────────────────────── */
.status-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 10px;
}

.status-bar-item {
  display: flex;
  align-items: center;
  gap: 8px;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--ion-color-medium);
  flex-shrink: 0;
}

.status-dot.online  { background: var(--ion-color-success); box-shadow: 0 0 6px rgba(var(--ion-color-success-rgb), 0.6); }
.status-dot.offline { background: var(--ion-color-danger); }

/* ── Quick-actions grid ─────────────────────────────────── */
.quick-actions-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 8px;
}

/* ── Glass inset panels ─────────────────────────────────── */
.glass-inset {
  background: rgba(255, 255, 255, 0.035);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-radius: 12px;
}

/* ── Sub-section title ──────────────────────────────────── */
.subsection-title {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 0.82rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  opacity: 0.55;
  margin-bottom: 10px;
}

/* ── Snapshot section dividers ──────────────────────────── */
.snapshot-section {
  padding-top: 16px;
  padding-bottom: 4px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.snapshot-section:first-child {
  padding-top: 0;
  border-top: none;
}

/* ── Warning box ────────────────────────────────────────── */
.warn-box {
  padding: 8px 10px;
  background: rgba(255, 193, 7, 0.06);
  border: 1px solid rgba(255, 193, 7, 0.18);
  border-radius: 8px;
  font-size: 0.78rem;
  opacity: 0.85;
  line-height: 1.45;
}

/* ── Gun relay grid ─────────────────────────────────────── */
.gun-relay-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-bottom: 4px;
}

@media (max-width: 480px) {
  .gun-relay-grid { grid-template-columns: 1fr; }
}

.gun-relay-card {
  position: relative;
  padding: 10px 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.03);
  transition: border-color 0.3s, background 0.3s;
}

.gun-relay-card--live {
  border-color: rgba(var(--ion-color-success-rgb), 0.3);
  background: rgba(var(--ion-color-success-rgb), 0.05);
}

.gun-relay-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}

.gun-relay-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--ion-color-medium);
  flex-shrink: 0;
}

.gun-relay-dot.online {
  background: var(--ion-color-success);
  box-shadow: 0 0 5px rgba(var(--ion-color-success-rgb), 0.6);
}

.gun-relay-name {
  font-size: 12px;
  color: var(--ion-text-color);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  min-width: 0;
}

.gun-relay-latency {
  font-size: 10px;
  font-family: monospace;
  color: var(--ion-color-medium);
  background: rgba(255, 255, 255, 0.06);
  padding: 1px 5px;
  border-radius: 5px;
  flex-shrink: 0;
}

.gun-relay-url {
  font-size: 10px;
  font-family: monospace;
  color: var(--ion-color-medium);
  opacity: 0.7;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 2px;
}

.gun-relay-status { font-size: 10px; font-weight: 600; }

.gun-relay-remove {
  position: absolute;
  top: 4px;
  right: 2px;
  --padding-start: 4px;
  --padding-end: 4px;
  height: 22px;
  font-size: 12px;
}

/* ── Gun preset select ──────────────────────────────────── */
.gun-preset-select {
  font-size: 13px;
  background: rgba(255, 255, 255, 0.05);
  color: var(--ion-text-color);
  border: 1px solid rgba(255, 255, 255, 0.12);
  padding: 8px 10px;
  border-radius: 8px;
  outline: none;
  cursor: pointer;
  appearance: none;
}

/* ── Tor command card ───────────────────────────────────── */
.tor-command-card {
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  background: rgba(12, 12, 18, 0.55);
  padding: 14px;
}

.tor-command-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 10px;
}

.tor-command-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.88rem;
}

.tor-command-code {
  display: block;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.5);
  border: 1px solid rgba(255, 255, 255, 0.07);
  padding: 10px 12px;
  font-size: 0.78rem;
  line-height: 1.4;
  word-break: break-all;
  color: #a5f3fc;
}

.tor-command-help {
  margin-top: 8px;
  font-size: 0.75rem;
  opacity: 0.55;
}
</style>
