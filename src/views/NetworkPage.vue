<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button default-href="/home"></ion-back-button>
        </ion-buttons>
        <ion-title>Network</ion-title>
        <ion-buttons slot="end">
          <ion-button fill="clear" @click="refreshAll" :disabled="probing">
            <ion-icon :icon="refreshOutline"></ion-icon>
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content class="net-page-content">
      <div class="np-shell">

        <!-- ── Connection summary ─────────────────────────── -->
        <div class="np-summary surface-card">
          <div class="np-summary-row">
            <div class="np-summary-stat">
              <span class="np-stat-val" :class="gunPeers > 0 ? 'stat-ok' : 'stat-warn'">{{ gunPeers }}</span>
              <span class="np-stat-label">Gun peers</span>
            </div>
            <div class="np-summary-stat">
              <span class="np-stat-val" :class="activeRelay?.status === 'online' ? 'stat-ok' : 'stat-warn'">
                {{ activeRelay?.status === 'online' ? '●' : activeRelay?.status === 'offline' ? '✕' : '○' }}
              </span>
              <span class="np-stat-label">Relay</span>
            </div>
            <div class="np-summary-stat">
              <span class="np-stat-val" :class="anonymityOn ? 'stat-ok' : 'stat-muted'">
                {{ anonymityOn ? 'ON' : 'OFF' }}
              </span>
              <span class="np-stat-label">Anonymity</span>
            </div>
            <div class="np-summary-stat">
              <span class="np-stat-val stat-muted">{{ rtcPeerCount }}</span>
              <span class="np-stat-label">P2P peers</span>
            </div>
          </div>
        </div>

        <!-- ── Anonymity mode ─────────────────────────────── -->
        <section class="np-section surface-card">
          <div class="np-section-header">
            <div class="np-section-icon np-icon--shield">
              <svg viewBox="0 0 24 24" fill="none" width="18" height="18">
                <path d="M12 22s8-4.5 8-11V5l-8-3-8 3v6c0 6.5 8 11 8 11z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
              </svg>
            </div>
            <div>
              <h3 class="np-section-title">Anonymity mode</h3>
              <p class="np-section-sub">Disables WebRTC (prevents IP leaks) — use inside Tor Browser for full protection.</p>
            </div>
            <button
              class="np-toggle"
              :class="{ active: anonymityOn }"
              role="switch"
              :aria-checked="anonymityOn"
              @click="toggleAnonymity"
            >
              <span class="np-toggle-knob"></span>
            </button>
          </div>
        </section>

        <!-- ── Active relay ───────────────────────────────── -->
        <section class="np-section surface-card">
          <h3 class="np-section-title np-section-title--plain">Active relay</h3>
          <div v-if="activeRelay" class="np-active-relay">
            <div class="np-relay-card np-relay-card--active">
              <div class="np-relay-type-badge" :class="relayTypeBadgeClass(activeRelay)">
                {{ relayTypeLabel(activeRelay) }}
              </div>
              <p class="np-relay-name">{{ shortenUrl(activeRelay.ws) }}</p>
              <p class="np-relay-url-full">{{ activeRelay.ws }}</p>
              <div class="np-relay-meta-row">
                <span class="np-relay-status-pill" :class="statusPillClass(activeRelay.status)">
                  {{ activeRelay.status }}
                </span>
                <span v-if="activeRelay.latencyMs" class="np-relay-latency">{{ activeRelay.latencyMs }}ms</span>
              </div>
            </div>
          </div>
          <div v-else class="np-empty-note">No active relay — add one below.</div>
        </section>

        <!-- ── All relays ─────────────────────────────────── -->
        <section class="np-section surface-card">
          <div class="np-section-header-plain">
            <h3 class="np-section-title np-section-title--plain">Relay servers</h3>
            <button class="np-btn-add" @click="showAddRelay = !showAddRelay">
              {{ showAddRelay ? 'Cancel' : '+ Add relay' }}
            </button>
          </div>

          <!-- Add relay form -->
          <div v-if="showAddRelay" class="np-add-form">
            <input
              v-model="newRelayUrl"
              class="np-input"
              type="url"
              placeholder="https://your-relay.example.com"
              autocomplete="off"
              @keydown.enter="addRelay"
            />
            <p class="np-hint">Enter the base URL of the relay. Gun endpoint at /gun, API at /api will be inferred.</p>
            <p v-if="addError" class="np-error">{{ addError }}</p>
            <button class="np-btn-primary" :disabled="!newRelayUrl.trim()" @click="addRelay">Connect</button>
          </div>

          <!-- Relay cards -->
          <div class="np-relay-list">
            <div
              v-for="relay in relays"
              :key="relay.id"
              class="np-relay-item"
              :class="{ 'np-relay-item--active': relay.id === activeRelay?.id }"
            >
              <div class="np-relay-item-left">
                <span class="np-relay-dot" :class="dotClass(relay.status)"></span>
                <div class="np-relay-item-info">
                  <span class="np-relay-item-name">{{ shortenUrl(relay.ws) }}</span>
                  <span class="np-relay-item-tags">
                    <span class="np-tag np-tag--type" :class="'np-tag--' + relayTypeLabel(relay).toLowerCase()">
                      {{ relayTypeLabel(relay) }}
                    </span>
                    <span v-if="relay.latencyMs" class="np-tag np-tag--latency">{{ relay.latencyMs }}ms</span>
                  </span>
                </div>
              </div>

              <div class="np-relay-item-actions">
                <button
                  v-if="relay.id !== activeRelay?.id"
                  class="np-btn-sm np-btn-sm--primary"
                  :disabled="switching === relay.id"
                  @click="switchTo(relay.id)"
                >
                  {{ switching === relay.id ? '…' : 'Use' }}
                </button>
                <span v-else class="np-active-label">Active</span>
                <button
                  v-if="relays.length > 1"
                  class="np-btn-sm np-btn-sm--ghost"
                  @click="removeRelay(relay.id)"
                  aria-label="Remove relay"
                >✕</button>
              </div>
            </div>
          </div>
        </section>

        <!-- ── Gun peers ──────────────────────────────────── -->
        <section class="np-section surface-card">
          <h3 class="np-section-title np-section-title--plain">Gun mesh peers</h3>
          <p class="np-section-hint">Gun is the decentralised sync layer. Peers share data directly.</p>

          <div class="np-peer-list">
            <div v-for="peer in peerHealth" :key="peer.url" class="np-peer-row">
              <span class="np-peer-dot" :class="peer.connected ? 'dot--online' : 'dot--offline'"></span>
              <span class="np-peer-url">{{ trimPeerUrl(peer.url) }}</span>
              <span class="np-peer-meta">
                <span v-if="peer.connected" class="np-peer-tag np-peer-tag--live">live</span>
                <span v-else-if="peer.failures > 2" class="np-peer-tag np-peer-tag--fail">{{ peer.failures }}✗</span>
                <span v-else class="np-peer-tag np-peer-tag--idle">idle</span>
              </span>
            </div>
            <div v-if="!peerHealth.length" class="np-empty-note">No Gun peers yet.</div>
          </div>

          <!-- Add Gun peer -->
          <div class="np-add-peer-row">
            <input
              v-model="newGunPeer"
              class="np-input"
              type="url"
              placeholder="https://community-relay.example.com/gun"
              autocomplete="off"
              @keydown.enter="addGunPeer"
            />
            <button class="np-btn-primary" :disabled="!newGunPeer.trim()" @click="addGunPeer">Add peer</button>
          </div>
          <p v-if="gunPeerError" class="np-error">{{ gunPeerError }}</p>
        </section>

        <!-- ── Transport strategy ─────────────────────────── -->
        <section class="np-section surface-card">
          <h3 class="np-section-title np-section-title--plain">Transport strategy</h3>

          <div class="np-toggle-row">
            <div class="np-toggle-info">
              <strong>Auto-failover</strong>
              <p>Switch to another relay automatically if the active one drops.</p>
            </div>
            <button
              class="np-toggle"
              :class="{ active: transport.autoSwitch }"
              role="switch"
              :aria-checked="transport.autoSwitch"
              @click="setTransport({ autoSwitch: !transport.autoSwitch })"
            ></button>
          </div>

          <div class="np-toggle-row">
            <div class="np-toggle-info">
              <strong>Prefer decentralised</strong>
              <p>Prioritise peer-discovered relays over configured servers.</p>
            </div>
            <button
              class="np-toggle"
              :class="{ active: transport.preferDecentralized }"
              role="switch"
              :aria-checked="transport.preferDecentralized"
              @click="setTransport({ preferDecentralized: !transport.preferDecentralized })"
            ></button>
          </div>

          <div class="np-toggle-row">
            <div class="np-toggle-info">
              <strong>Allow discovered auto-switch</strong>
              <p>Let the app switch to relays found via peer discovery.</p>
            </div>
            <button
              class="np-toggle"
              :class="{ active: transport.allowDiscoveredAutoSwitch }"
              role="switch"
              :aria-checked="transport.allowDiscoveredAutoSwitch"
              @click="setTransport({ allowDiscoveredAutoSwitch: !transport.allowDiscoveredAutoSwitch })"
            ></button>
          </div>
        </section>

        <!-- ── Advanced: Wire filter ──────────────────────── -->
        <section class="np-section surface-card">
          <h3 class="np-section-title np-section-title--plain">Wire filter mode</h3>
          <p class="np-section-hint">Controls how out-of-namespace Gun messages are handled over the P2P bridge.</p>
          <div class="np-radio-group">
            <label v-for="mode in ['off','log','enforce']" :key="mode" class="np-radio-row">
              <input type="radio" name="wirefilter" :value="mode" v-model="wireFilter" @change="saveWireFilter" />
              <div>
                <strong>{{ mode }}</strong>
                <span>{{ wireFilterDesc[mode] }}</span>
              </div>
            </label>
          </div>
        </section>

        <!-- ── Resilience / chain links ───────────────────── -->
        <div class="np-link-row">
          <button class="np-nav-link" @click="router.push('/resilience')">
            Resilience Center →
          </button>
          <button class="np-nav-link" @click="router.push('/chain-explorer')">
            Chain Explorer →
          </button>
        </div>

      </div>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import {
  IonPage, IonHeader, IonToolbar, IonTitle, IonContent,
  IonButtons, IonButton, IonIcon, IonBackButton,
} from '@ionic/vue';
import { refreshOutline } from 'ionicons/icons';
import { useRouter } from 'vue-router';
import { RelayManager, type RelayEndpoint, type TransportStrategySettings } from '../services/relayManager';
import { GunService } from '../services/gunService';
import config from '../config';

const router = useRouter();

const relays        = ref<RelayEndpoint[]>(RelayManager.getRelayList());
const activeRelay   = ref<RelayEndpoint | null>(RelayManager.getActiveRelay());
const transport     = ref<TransportStrategySettings>(RelayManager.getTransportSettings());
const anonymityOn   = ref(config.anonymityMode);
const gunPeers      = ref(0);
const peerHealth    = ref<any[]>([]);
const rtcPeerCount  = ref(0);
const switching     = ref<string | null>(null);
const probing       = ref(false);
const showAddRelay  = ref(false);
const newRelayUrl   = ref('');
const addError      = ref('');
const newGunPeer    = ref('');
const gunPeerError  = ref('');
const wireFilter    = ref<'off'|'log'|'enforce'>(
  (localStorage.getItem('interpoll_wire_filter_mode') as any) || 'log'
);

const wireFilterDesc: Record<string, string> = {
  off:     'No filtering — legacy behaviour.',
  log:     'Log out-of-namespace messages without dropping them. Default.',
  enforce: 'Drop any message outside the Gun namespace. Most secure.',
};

let cleanupRelay: (() => void) | null = null;
let peerTimer:    ReturnType<typeof setInterval> | null = null;

function refresh() {
  relays.value      = RelayManager.getRelayList();
  activeRelay.value = RelayManager.getActiveRelay();
  transport.value   = RelayManager.getTransportSettings();
  anonymityOn.value = config.anonymityMode;
}

function pollPeers() {
  try {
    const health = GunService.getPeerHealthReport();
    peerHealth.value  = health;
    gunPeers.value    = health.filter(p => p.connected).length;
  } catch { /* non-fatal */ }
}

function shortenUrl(url: string): string {
  try { return new URL(url).hostname; }
  catch { return url.slice(0, 40); }
}
function trimPeerUrl(url: string): string {
  try { const u = new URL(url); return u.hostname + u.pathname; }
  catch { return url.slice(0, 40); }
}

function dotClass(status: string): string {
  if (status === 'online')   return 'dot--online';
  if (status === 'offline')  return 'dot--offline';
  if (status === 'degraded') return 'dot--degraded';
  return 'dot--unknown';
}

function statusPillClass(status: string): string {
  return 'pill--' + (status || 'unknown');
}

function relayTypeLabel(relay: RelayEndpoint): string {
  if (relay.isTor)                      return 'Onion';
  if (relay.source === 'discovered')    return 'Discovered';
  if (relay.trusted)                    return 'Trusted';
  return 'Custom';
}

function relayTypeBadgeClass(relay: RelayEndpoint): string {
  if (relay.isTor)                   return 'badge--onion';
  if (relay.source === 'discovered') return 'badge--disc';
  if (relay.trusted)                 return 'badge--trusted';
  return 'badge--custom';
}

function toggleAnonymity() {
  config.setAnonymityMode(!config.anonymityMode);
  anonymityOn.value = config.anonymityMode;
}

async function switchTo(id: string) {
  switching.value = id;
  try { await RelayManager.switchToRelay(id); refresh(); }
  catch (e) { console.warn('[NetworkPage] switch failed', e); }
  finally { switching.value = null; }
}

function removeRelay(id: string) {
  RelayManager.removeRelay(id);
  refresh();
}

function addRelay() {
  addError.value = '';
  const raw = newRelayUrl.value.trim();
  if (!raw) return;
  try { new URL(raw); }
  catch { addError.value = 'Invalid URL.'; return; }
  try {
    const base = raw.replace(/\/gun\/?$/, '').replace(/\/api\/?$/, '');
    RelayManager.addRelay({
      label:    shortenUrl(base),
      ws:       base,
      gun:      `${base}/gun`,
      api:      `${base}/api`,
      priority: 1,
      isTor:    raw.includes('.onion'),
      source:   'configured',
      trusted:  true,
    });
    newRelayUrl.value = '';
    showAddRelay.value = false;
    refresh();
  } catch (e) {
    addError.value = (e as Error).message;
  }
}

function addGunPeer() {
  gunPeerError.value = '';
  const url = newGunPeer.value.trim();
  if (!url) return;
  try {
    config.addGunPeer?.(url);
    newGunPeer.value = '';
    pollPeers();
  } catch (e) {
    gunPeerError.value = (e as Error).message;
  }
}

function setTransport(partial: Partial<TransportStrategySettings>) {
  RelayManager.setTransportSettings(partial);
  transport.value = RelayManager.getTransportSettings();
}

function saveWireFilter() {
  localStorage.setItem('interpoll_wire_filter_mode', wireFilter.value);
}

async function refreshAll() {
  probing.value = true;
  try { await RelayManager.probeAll?.(); }
  catch { /* non-fatal */ }
  refresh();
  pollPeers();
  probing.value = false;
}

onMounted(() => {
  cleanupRelay = RelayManager.onChange(refresh);
  peerTimer    = setInterval(pollPeers, 3000);
  pollPeers();
});
onUnmounted(() => {
  cleanupRelay?.();
  if (peerTimer) clearInterval(peerTimer);
});
</script>

<style scoped>
.net-page-content { --background: var(--app-bg-base); }

.np-shell {
  max-width: 680px;
  margin: 0 auto;
  padding: 16px 14px 40px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

/* ── summary ── */
.np-summary {
  padding: 16px;
  border-radius: var(--app-radius-md);
}
.np-summary-row {
  display: flex;
  gap: 0;
}
.np-summary-stat {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 8px 0;
  border-right: 1px solid var(--app-border);
}
.np-summary-stat:last-child { border-right: none; }
.np-stat-val   { font-size: 22px; font-weight: 800; letter-spacing: -0.02em; }
.np-stat-label { font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.12em; color: var(--app-text-subtle); }
.stat-ok   { color: var(--app-success); }
.stat-warn { color: var(--app-warning); }
.stat-muted { color: var(--app-text-muted); }

/* ── sections ── */
.surface-card {
  background: var(--app-surface);
  border: 1px solid var(--app-border);
  border-radius: var(--app-radius-md);
  padding: 16px;
}

.np-section { display: flex; flex-direction: column; gap: 12px; }

.np-section-header {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}
.np-section-header-plain {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.np-section-icon {
  width: 38px;
  height: 38px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.np-icon--shield { background: rgba(var(--app-accent-rgb), 0.12); color: var(--app-accent-bright); }

.np-section-title {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  color: var(--app-text);
}
.np-section-title--plain { font-size: 14px; }
.np-section-sub, .np-section-hint {
  margin: 0;
  font-size: 12px;
  color: var(--app-text-muted);
  line-height: 1.5;
}

/* ── toggle switch ── */
.np-toggle {
  width: 48px;
  height: 26px;
  border-radius: 13px;
  background: rgba(255, 255, 255, 0.1);
  border: 1.5px solid rgba(255, 255, 255, 0.16);
  position: relative;
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.22s ease, border-color 0.22s ease;
  outline: none;
  padding: 0;
}
.np-toggle:focus-visible {
  box-shadow: 0 0 0 3px rgba(var(--app-accent-rgb), 0.35);
}
.np-toggle.active {
  background: var(--app-accent, #5e6ad2);
  border-color: transparent;
  box-shadow: 0 0 0 1px rgba(var(--app-accent-rgb), 0.4),
              0 4px 12px rgba(var(--app-accent-rgb), 0.3);
}
.np-toggle-knob {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 18px;
  height: 18px;
  background: #ffffff;
  border-radius: 50%;
  transition: transform 0.22s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: 0 1px 6px rgba(0, 0, 0, 0.35), 0 0 0 0.5px rgba(0,0,0,0.1);
  pointer-events: none;
}
.np-toggle.active .np-toggle-knob { transform: translateX(22px); }

.np-toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 0;
  border-top: 1px solid var(--app-border);
}
.np-toggle-row:first-of-type { border-top: none; }
.np-toggle-info { flex: 1; }
.np-toggle-info strong { font-size: 14px; font-weight: 600; color: var(--app-text); display: block; margin-bottom: 2px; }
.np-toggle-info p { margin: 0; font-size: 12px; color: var(--app-text-muted); }

/* ── active relay card ── */
.np-relay-card--active {
  background: rgba(var(--app-accent-rgb), 0.07);
  border: 1px solid rgba(var(--app-accent-rgb), 0.22);
  border-radius: 12px;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.np-relay-type-badge {
  font-size: 10px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  padding: 2px 7px;
  border-radius: 6px;
  align-self: flex-start;
}
.badge--trusted { background: rgba(var(--app-accent-rgb),0.15); color: var(--app-accent-bright); }
.badge--onion   { background: rgba(52,211,153,0.15); color: var(--app-success); }
.badge--disc    { background: rgba(251,191,36,0.13); color: var(--app-warning); }
.badge--custom  { background: rgba(0,0,0,0.06); color: var(--app-text-muted); }

.np-relay-name { margin: 0; font-size: 16px; font-weight: 700; color: var(--app-text); }
.np-relay-url-full { margin: 0; font-size: 11px; color: var(--app-text-subtle); font-family: monospace; word-break: break-all; }
.np-relay-meta-row { display: flex; align-items: center; gap: 8px; }
.np-relay-status-pill {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  padding: 2px 8px;
  border-radius: 6px;
}
.pill--online  { background: rgba(52,211,153,0.15); color: var(--app-success); }
.pill--offline { background: rgba(248,113,113,0.15); color: var(--app-danger); }
.pill--degraded{ background: rgba(251,191,36,0.15); color: var(--app-warning); }
.pill--unknown { background: rgba(0,0,0,0.06); color: var(--app-text-muted); }
.np-relay-latency { font-size: 12px; color: var(--app-text-subtle); }

/* ── relay list ── */
.np-relay-list { display: flex; flex-direction: column; gap: 6px; }
.np-relay-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--app-border);
  background: rgba(0,0,0,0.02);
  gap: 10px;
}
.np-relay-item--active {
  border-color: rgba(var(--app-accent-rgb), 0.3);
  background: rgba(var(--app-accent-rgb), 0.06);
}
.np-relay-item-left { display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0; }
.np-relay-item-info { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.np-relay-item-name { font-size: 13px; font-weight: 600; color: var(--app-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.np-relay-item-tags { display: flex; gap: 4px; }
.np-relay-item-actions { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }

.np-tag {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  padding: 1px 5px;
  border-radius: 4px;
}
.np-tag--type     { background: rgba(0,0,0,0.06); color: var(--app-text-subtle); }
.np-tag--latency  { background: rgba(var(--app-accent-rgb),0.1); color: var(--app-accent-bright); }
.np-tag--onion    { background: rgba(52,211,153,0.15); color: var(--app-success); }
.np-tag--trusted  { background: rgba(var(--app-accent-rgb),0.12); color: var(--app-accent-bright); }
.np-tag--discovered { background: rgba(251,191,36,0.12); color: var(--app-warning); }

.np-active-label { font-size: 12px; font-weight: 700; color: var(--app-accent-bright); }

/* ── peer list ── */
.np-peer-list { display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px; }
.np-peer-row { display: flex; align-items: center; gap: 10px; padding: 7px 0; border-bottom: 1px solid var(--app-border); }
.np-peer-row:last-child { border-bottom: none; }
.np-peer-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.np-peer-url { font-size: 12px; color: var(--app-text); font-family: monospace; flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.np-peer-meta { display: flex; gap: 4px; flex-shrink: 0; }
.np-peer-tag {
  font-size: 10px;
  font-weight: 700;
  padding: 1px 5px;
  border-radius: 4px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
.np-peer-tag--live { background: rgba(52,211,153,0.15); color: var(--app-success); }
.np-peer-tag--fail { background: rgba(248,113,113,0.12); color: var(--app-danger); }
.np-peer-tag--idle { background: rgba(0,0,0,0.06); color: var(--app-text-subtle); }

.dot--online   { background: var(--app-success); box-shadow: 0 0 4px rgba(52,211,153,0.5); }
.dot--offline  { background: var(--app-danger); }
.dot--degraded { background: var(--app-warning); }
.dot--unknown  { background: var(--app-text-subtle); opacity: 0.5; }

/* ── add peer row ── */
.np-add-peer-row { display: flex; gap: 8px; align-items: flex-start; }
.np-add-form { display: flex; flex-direction: column; gap: 8px; }
.np-input {
  flex: 1;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--app-border);
  background: var(--app-surface);
  color: var(--app-text);
  font-size: 13px;
  font-family: inherit;
  outline: none;
  transition: border-color 0.15s;
}
.np-input:focus { border-color: rgba(var(--app-accent-rgb), 0.5); }
.np-hint  { margin: 0; font-size: 12px; color: var(--app-text-subtle); }
.np-error { margin: 0; font-size: 12px; color: var(--app-danger); }
.np-empty-note { font-size: 13px; color: var(--app-text-muted); padding: 8px 0; }

/* ── buttons ── */
.np-btn-add {
  font-size: 13px;
  font-weight: 600;
  color: var(--app-accent-bright);
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
}
.np-btn-primary {
  padding: 9px 18px;
  background: rgba(var(--app-accent-rgb), 0.14);
  border: 1px solid rgba(var(--app-accent-rgb), 0.28);
  color: var(--app-accent-bright);
  border-radius: 10px;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  transition: var(--app-transition);
  white-space: nowrap;
}
.np-btn-primary:hover:not(:disabled) { background: rgba(var(--app-accent-rgb), 0.22); }
.np-btn-primary:disabled { opacity: 0.4; cursor: not-allowed; }

.np-btn-sm {
  padding: 5px 12px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  transition: var(--app-transition);
  border: none;
}
.np-btn-sm--primary {
  background: rgba(var(--app-accent-rgb), 0.12);
  color: var(--app-accent-bright);
}
.np-btn-sm--primary:hover:not(:disabled) { background: rgba(var(--app-accent-rgb), 0.22); }
.np-btn-sm--ghost {
  background: none;
  color: var(--app-text-muted);
}
.np-btn-sm--ghost:hover { color: var(--app-danger); background: rgba(248,113,113,0.08); }

/* ── radio group ── */
.np-radio-group { display: flex; flex-direction: column; gap: 4px; }
.np-radio-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 0;
  border-top: 1px solid var(--app-border);
  cursor: pointer;
}
.np-radio-row:first-child { border-top: none; }
.np-radio-row input { margin-top: 3px; accent-color: var(--app-accent); }
.np-radio-row div { display: flex; flex-direction: column; gap: 2px; }
.np-radio-row strong { font-size: 13px; font-weight: 600; color: var(--app-text); }
.np-radio-row span { font-size: 12px; color: var(--app-text-muted); }

/* ── link row ── */
.np-link-row { display: flex; gap: 10px; }
.np-nav-link {
  flex: 1;
  padding: 12px;
  background: var(--app-surface);
  border: 1px solid var(--app-border);
  border-radius: var(--app-radius-md);
  color: var(--app-accent-bright);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  text-align: center;
  transition: var(--app-transition);
}
.np-nav-link:hover { background: rgba(var(--app-accent-rgb), 0.07); }
</style>