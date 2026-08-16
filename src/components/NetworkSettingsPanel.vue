<template>
  <div class="net-settings">
    <h2 class="section-title">Network &amp; Decentralisation</h2>

    <!-- ── Connection summary bar ─────────────────────────────────────── -->
    <div class="status-bar">
      <span class="dot" :class="gunConnected ? 'online' : 'offline'" />
      <span class="status-text">
        {{ gunConnected
          ? `Gun mesh — ${gunPeerCount} peer${gunPeerCount !== 1 ? 's' : ''} connected`
          : 'Gun mesh — disconnected' }}
      </span>
      <span v-if="rtcPeers.length" class="badge-rtc">{{ rtcPeers.length }} P2P</span>
    </div>

    <!-- ── Tabs ───────────────────────────────────────────────────────── -->
    <div class="tab-row">
      <button
        v-for="t in tabs"
        :key="t.id"
        class="tab-btn"
        :class="{ active: activeTab === t.id }"
        @click="activeTab = t.id"
      >{{ t.label }}</button>
    </div>

    <!-- ══════════════════════════════════════════════════════════════════
         TAB: Relay Peers
    ══════════════════════════════════════════════════════════════════ -->
    <section v-show="activeTab === 'peers'" class="tab-content">
      <p class="hint">
        Connect to multiple Gun relay peers for resilience. Data syncs across
        all connected peers automatically — no single point of failure.
      </p>

      <!-- Tier toggles -->
      <div class="tier-row">
        <label class="toggle-row">
          <div>
            <strong>Private relay</strong>
            <p class="sub">Your VPS (interpoll2.endless.sbs) — fastest, most trusted</p>
          </div>
          <input type="checkbox" v-model="prefs.usePrivate" @change="savePrefs" />
        </label>

        <label class="toggle-row">
          <div>
            <strong>Public relays</strong>
            <p class="sub">gun-manhattan, us-east.gun.eco — open community nodes</p>
          </div>
          <input type="checkbox" v-model="prefs.usePublic" @change="savePrefs" />
        </label>
      </div>

      <!-- Peer health list -->
      <div class="peer-list">
        <div
          v-for="peer in peerHealth"
          :key="peer.url"
          class="peer-row"
        >
          <span class="peer-dot" :class="peerDotClass(peer)" />
          <span class="peer-url" :title="peer.url">{{ trimUrl(peer.url) }}</span>
          <span v-if="peer.connected" class="peer-tag online-tag">live</span>
          <span v-else-if="peer.failures > 2" class="peer-tag fail-tag">{{ peer.failures }}✗</span>
          <span v-else class="peer-tag gray-tag">idle</span>
          <button
            v-if="isUserPeer(peer.url)"
            class="btn-remove"
            title="Remove peer"
            @click="removePeer(peer.url)"
          >✕</button>
        </div>
        <p v-if="!peerHealth.length" class="no-peers">No peers configured yet.</p>
      </div>

      <!-- Add custom peer -->
      <div class="add-row">
        <input
          v-model="newPeerUrl"
          class="peer-input"
          placeholder="https://community-relay.example.com/gun"
          @keydown.enter="addPeer"
        />
        <button class="btn-primary" :disabled="!validNewPeer" @click="addPeer">
          Add
        </button>
      </div>
      <p v-if="addPeerError" class="err-msg">{{ addPeerError }}</p>

      <!-- AXE mesh toggle -->
      <label class="toggle-row mt">
        <div>
          <strong>AXE peer mesh</strong>
          <p class="sub">Lets Gun peers relay to each other — better resilience, small extra traffic</p>
        </div>
        <input type="checkbox" v-model="prefs.axeEnabled" @change="savePrefs" />
      </label>

      <!-- SW tab relay -->
      <label class="toggle-row">
        <div>
          <strong>Tab relay (ServiceWorker)</strong>
          <p class="sub">Open browser tabs relay Gun data to other tabs on this device — HTTPS only</p>
        </div>
        <input type="checkbox" v-model="prefs.swRelayEnabled" @change="savePrefs" />
      </label>

      <details class="learn-more">
        <summary>Run your own community relay</summary>
        <p>
          Anyone can host a Gun relay with a single Docker command. It syncs posts,
          polls, and community data. It cannot read encrypted content or modify votes.
          <br /><br />
          See the <strong>community-relay/README.md</strong> in the repo for a
          one-command Docker Compose setup. Share your URL above once it's running.
        </p>
      </details>
    </section>

    <!-- ══════════════════════════════════════════════════════════════════
         TAB: Direct P2P
    ══════════════════════════════════════════════════════════════════ -->
    <section v-show="activeTab === 'p2p'" class="tab-content">
      <p class="hint">
        Direct browser-to-browser connections for faster sync and snapshot transfers.
        Requires WebRTC (all modern browsers). Encrypted end-to-end by WebRTC DTLS.
      </p>

      <label class="toggle-row">
        <div>
          <strong>Enable WebRTC P2P</strong>
          <p class="sub">Form direct connections to other online users automatically</p>
        </div>
        <input type="checkbox" v-model="rtcEnabled" @change="toggleRtc" />
      </label>

      <!-- Signaling mode info -->
      <div v-if="rtcEnabled" class="info-box">
        <strong>Signaling</strong>: Uses GunDB (primary) with WS relay as fallback.
        No relay server needed once a Gun peer is reachable.
      </div>

      <!-- Connected peers -->
      <div v-if="rtcEnabled && rtcPeers.length" class="chip-row">
        <span v-for="p in rtcPeers" :key="p" class="peer-chip">{{ p.slice(0, 12) }}…</span>
      </div>
      <p v-if="rtcEnabled && !rtcPeers.length" class="hint muted">
        No direct peers yet — they appear as other users come online.
      </p>

      <!-- NAT warning -->
      <div v-if="rtcEnabled" class="warn-box">
        Users behind strict NAT (some mobile networks, corporate firewalls) may not
        be able to form direct connections. They automatically use the Gun relay instead.
        For full coverage, add a TURN server in <code>webrtcService.ts → STUN_SERVERS</code>.
      </div>
    </section>

    <!-- ══════════════════════════════════════════════════════════════════
         TAB: Search
    ══════════════════════════════════════════════════════════════════ -->
    <section v-show="activeTab === 'search'" class="tab-content">
      <p class="hint">
        Search uses a local Flexsearch index built from content synced to your device.
        The index grows as new posts arrive from peers — no server needed.
      </p>

      <div class="stat-grid">
        <div class="stat-card">
          <div class="stat-val">{{ docCount.toLocaleString() }}</div>
          <div class="stat-label">Indexed documents</div>
        </div>
        <div class="stat-card">
          <div class="stat-val" :class="lastSource === 'local' ? 'green' : 'amber'">
            {{ lastSource || '—' }}
          </div>
          <div class="stat-label">Last search source</div>
        </div>
      </div>

      <p class="hint" :class="docCount === 0 ? 'warn' : ''">
        <template v-if="docCount === 0">
          Index is empty — results will appear as Gun syncs posts to your device.
          If you just installed the app, try loading a few posts first.
        </template>
        <template v-else>
          Index is populated. New content is indexed automatically when it arrives.
        </template>
      </p>

      <button class="btn-secondary" @click="clearSearchCache">Clear result cache</button>
      <p class="hint muted">Clears the 60-second query cache. Does not remove indexed documents.</p>
    </section>

    <!-- ══════════════════════════════════════════════════════════════════
         TAB: PoW
    ══════════════════════════════════════════════════════════════════ -->
    <section v-show="activeTab === 'pow'" class="tab-content">
      <p class="hint">
        Proof-of-Work deters spam by requiring a small amount of computation
        before posting. The relay server verifies each proof.
      </p>

      <div class="stat-grid">
        <div class="stat-card">
          <div class="stat-val" :class="wsConnected ? 'green' : 'amber'">
            {{ wsConnected ? 'Server' : 'Client' }}
          </div>
          <div class="stat-label">PoW challenge source</div>
        </div>
        <div class="stat-card">
          <div class="stat-val">16 bits</div>
          <div class="stat-label">Difficulty (client mode)</div>
        </div>
      </div>

      <div class="info-box">
        <template v-if="wsConnected">
          <strong>Server mode:</strong> The relay issues a unique challenge per post.
          This is the default and most secure mode.
        </template>
        <template v-else>
          <strong>Offline mode:</strong> The relay is unreachable, so challenges are
          generated locally using a deterministic formula (contentHash + 30s window).
          The relay will verify the proof when you reconnect.
        </template>
      </div>
    </section>

    <!-- ══════════════════════════════════════════════════════════════════
         TAB: Discovery
    ══════════════════════════════════════════════════════════════════ -->
    <section v-show="activeTab === 'discovery'" class="tab-content">
      <p class="hint">
        Announce this node so others can discover it via the Gun mesh.
        Only your relay URLs and capabilities are published — no personal data.
      </p>

      <button class="btn-primary" :disabled="announcing" @click="announceNode">
        {{ announcing ? 'Announcing…' : 'Announce This Node' }}
      </button>

      <div v-if="announceResult" class="result-box" :class="announceResult.ok ? 'ok' : 'err'">
        {{ announceResult.msg }}
      </div>

      <!-- Discovered peers table -->
      <div v-if="discoveredPeers.length" class="mt">
        <h4 class="sub-heading">Discovered peers ({{ discoveredPeers.length }})</h4>
        <div v-for="peer in discoveredPeers" :key="peer.nodeId" class="disc-row">
          <span class="disc-node">{{ peer.nodeId.slice(0, 16) }}…</span>
          <span class="disc-caps">{{ peer.capabilities.join(', ') }}</span>
          <button class="btn-small" @click="addDiscoveredPeer(peer.gun)">
            + Add relay
          </button>
        </div>
      </div>
      <p v-else class="hint muted">No peers discovered yet. They appear as nodes announce themselves.</p>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { GunService, getPeerHealthReport, type PeerHealth } from '@/services/gunService';
import { WebRTCService } from '@/services/webrtcService';
import { SearchService } from '@/services/searchService';
import { DiscoveryService, type DiscoveryEntry } from '@/services/discoveryService';
import { WebSocketService } from '@/services/websocketService';
import config, {
  PRIVATE_PEERS,
  PUBLIC_PEERS,
  getPeerPreferences,
  setPeerPreferences,
  type PeerPreferences,
} from '@/config';

// ── Tabs ──────────────────────────────────────────────────────────────────────
const tabs = [
  { id: 'peers',     label: 'Relay Peers' },
  { id: 'p2p',       label: 'Direct P2P' },
  { id: 'search',    label: 'Search' },
  { id: 'pow',       label: 'Proof-of-Work' },
  { id: 'discovery', label: 'Discovery' },
];
const activeTab = ref('peers');

// ── Reactive state ────────────────────────────────────────────────────────────
const gunConnected  = ref(false);
const gunPeerCount  = ref(0);
const peerHealth    = ref<PeerHealth[]>([]);
const rtcEnabled    = ref(WebRTCService.isEnabled());
const rtcPeers      = ref<string[]>([]);
const wsConnected   = ref(false);
const docCount      = ref(0);
const lastSource    = ref<'local' | 'remote' | null>(null);
const discoveredPeers = ref<DiscoveryEntry[]>([]);

// Peer management
const prefs        = ref<PeerPreferences>(getPeerPreferences());
const newPeerUrl   = ref('');
const addPeerError = ref('');
const validNewPeer = ref(false);

// Discovery
const announcing    = ref(false);
const announceResult = ref<{ ok: boolean; msg: string } | null>(null);

// ── Helpers ───────────────────────────────────────────────────────────────────
const BUILTIN_URLS = new Set<string>([...PRIVATE_PEERS, ...PUBLIC_PEERS]);
const isUserPeer = (url: string) => !BUILTIN_URLS.has(url);

function trimUrl(url: string): string {
  try { return new URL(url).hostname; } catch { return url; }
}

function peerDotClass(peer: PeerHealth): string {
  if (peer.connected) return 'online';
  if (peer.failures > 2) return 'offline';
  return 'unknown';
}

// Validate URL as user types
function checkNewPeer() {
  try {
    const u = new URL(newPeerUrl.value);
    validNewPeer.value = ['http:', 'https:'].includes(u.protocol);
  } catch {
    validNewPeer.value = false;
  }
}
// Watch input reactively
import { watch } from 'vue';
watch(newPeerUrl, checkNewPeer);

// ── Peer management ────────────────────────────────────────────────────────────
function addPeer() {
  addPeerError.value = '';
  const url = newPeerUrl.value.trim();
  if (!url || !validNewPeer.value) return;
  if ([...peerHealth.value].some((p) => p.url === url)) {
    addPeerError.value = 'This peer is already in the list.';
    return;
  }
  try {
    GunService.addPeer(url);
    newPeerUrl.value = '';
    refresh();
  } catch (e: any) {
    addPeerError.value = e.message;
  }
}

function removePeer(url: string) {
  GunService.removePeer(url);
  refresh();
}

function savePrefs() {
  setPeerPreferences({ ...prefs.value });
  // AXE / SW relay changes take effect on next Gun reconnect
}

// ── WebRTC toggle ──────────────────────────────────────────────────────────────
function toggleRtc() {
  WebRTCService.setEnabled(rtcEnabled.value);
  refresh();
}

// ── Search ────────────────────────────────────────────────────────────────────
function clearSearchCache() {
  SearchService.cache.clear();
}

// ── Discovery ─────────────────────────────────────────────────────────────────
async function announceNode() {
  announcing.value = true;
  announceResult.value = null;
  try {
    const result = await DiscoveryService.publishLocalAnnouncement({
      nodeId: `node-${Date.now().toString(36)}`,
      websocket: config.relay.websocket,
      gun: config.relay.gun,
      api: config.relay.api,
      capabilities: ['gun', 'webrtc', 'snapshot'],
      ttlMs: 5 * 60_000,
    });
    announceResult.value = result
      ? { ok: true,  msg: 'Node announced to the mesh.' }
      : { ok: false, msg: 'Announcement failed — check relay connection.' };
  } catch (e: any) {
    announceResult.value = { ok: false, msg: e.message };
  } finally {
    announcing.value = false;
    setTimeout(() => { announceResult.value = null; }, 5_000);
  }
}

function addDiscoveredPeer(gunUrl: string) {
  GunService.addPeer(gunUrl);
  refresh();
}

// ── Status polling ────────────────────────────────────────────────────────────
function refresh() {
  const stats = GunService.getPeerStats();
  gunConnected.value = stats.isConnected;
  gunPeerCount.value = stats.peerCount;
  peerHealth.value   = getPeerHealthReport();
  rtcPeers.value     = WebRTCService.getConnectedPeers();
  wsConnected.value  = WebSocketService.getConnectionStatus?.() ?? false;
  docCount.value     = SearchService.getDocCount();
  discoveredPeers.value = DiscoveryService.getEntries();
}

let pollTimer: ReturnType<typeof setInterval> | null = null;

onMounted(async () => {
  await DiscoveryService.initialize();
  refresh();
  pollTimer = setInterval(refresh, 8_000);
});

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer);
});
</script>

<style scoped>
.net-settings { padding: 1rem; max-width: 600px; font-size: 0.9rem; }
.section-title { font-size: 1.2rem; font-weight: 600; margin-bottom: 0.75rem; }

/* Status bar */
.status-bar { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 1rem; }
.dot { width: 10px; height: 10px; border-radius: 50%; background: #aaa; flex-shrink: 0; }
.dot.online  { background: #22c55e; }
.dot.offline { background: #ef4444; }
.status-text { flex: 1; }
.badge-rtc { background: #3b82f6; color: #fff; font-size: 0.72rem; padding: 2px 7px; border-radius: 999px; }

/* Tabs */
.tab-row { display: flex; flex-wrap: wrap; gap: 0.25rem; margin-bottom: 1rem; border-bottom: 1px solid var(--ion-border-color, #ddd); padding-bottom: 0.5rem; }
.tab-btn { padding: 0.3rem 0.75rem; border: 1px solid transparent; border-radius: 6px; cursor: pointer; background: none; color: var(--ion-color-medium, #888); font-size: 0.82rem; }
.tab-btn.active { border-color: var(--ion-color-primary, #3b82f6); color: var(--ion-color-primary, #3b82f6); background: var(--ion-color-primary-tint, #dbeafe); }
.tab-content { animation: fadein 0.15s ease; }
@keyframes fadein { from { opacity: 0; } to { opacity: 1; } }

/* Tier toggles */
.tier-row { display: flex; flex-direction: column; gap: 0.5rem; margin-bottom: 0.75rem; }
.toggle-row { display: flex; justify-content: space-between; align-items: center; padding: 0.5rem 0.25rem; cursor: pointer; }
.toggle-row.mt { margin-top: 0.75rem; }
.toggle-row strong { display: block; font-size: 0.88rem; }
.sub { margin: 0; font-size: 0.78rem; color: var(--ion-color-medium, #888); }

/* Peer list */
.peer-list { margin: 0.5rem 0 0.75rem; }
.peer-row { display: flex; align-items: center; gap: 0.5rem; padding: 0.35rem 0; border-bottom: 1px solid var(--ion-border-color, #eee); }
.peer-dot { width: 8px; height: 8px; border-radius: 50%; background: #aaa; flex-shrink: 0; }
.peer-dot.online  { background: #22c55e; }
.peer-dot.offline { background: #ef4444; }
.peer-dot.unknown { background: #f59e0b; }
.peer-url { flex: 1; font-size: 0.8rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.peer-tag { font-size: 0.7rem; padding: 1px 6px; border-radius: 999px; }
.online-tag { background: #dcfce7; color: #166534; }
.fail-tag   { background: #fee2e2; color: #991b1b; }
.gray-tag   { background: #f3f4f6; color: #6b7280; }
.btn-remove { background: none; border: none; cursor: pointer; color: #ef4444; font-size: 0.9rem; padding: 0 4px; flex-shrink: 0; }
.no-peers { font-size: 0.8rem; color: var(--ion-color-medium, #888); margin: 0.5rem 0; }

/* Add peer row */
.add-row { display: flex; gap: 0.5rem; margin-top: 0.5rem; }
.peer-input { flex: 1; padding: 0.38rem 0.6rem; border: 1px solid var(--ion-border-color, #ccc); border-radius: 6px; font-size: 0.82rem; }
.err-msg { color: #ef4444; font-size: 0.78rem; margin-top: 0.25rem; }

/* Buttons */
.btn-primary { padding: 0.38rem 0.9rem; background: var(--ion-color-primary, #3b82f6); color: #fff; border: none; border-radius: 6px; cursor: pointer; font-size: 0.82rem; }
.btn-primary:disabled { opacity: 0.4; cursor: not-allowed; }
.btn-secondary { padding: 0.38rem 0.9rem; background: none; border: 1px solid var(--ion-color-primary, #3b82f6); color: var(--ion-color-primary, #3b82f6); border-radius: 6px; cursor: pointer; font-size: 0.82rem; }
.btn-small { padding: 0.2rem 0.6rem; background: none; border: 1px solid var(--ion-color-primary, #3b82f6); color: var(--ion-color-primary, #3b82f6); border-radius: 5px; cursor: pointer; font-size: 0.76rem; }

/* Info / warn boxes */
.info-box { background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 6px; padding: 0.5rem 0.75rem; margin-top: 0.75rem; font-size: 0.82rem; color: #1e40af; }
.warn-box  { background: #fefce8; border: 1px solid #fde047; border-radius: 6px; padding: 0.5rem 0.75rem; margin-top: 0.75rem; font-size: 0.82rem; color: #713f12; }

/* Stat grid */
.stat-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; margin: 0.75rem 0; }
.stat-card { border: 1px solid var(--ion-border-color, #ddd); border-radius: 8px; padding: 0.75rem; text-align: center; }
.stat-val { font-size: 1.4rem; font-weight: 700; }
.stat-label { font-size: 0.76rem; color: var(--ion-color-medium, #888); margin-top: 0.2rem; }
.green { color: #22c55e; }
.amber { color: #f59e0b; }
.warn  { color: #f59e0b; }

/* RTC chips */
.chip-row { display: flex; flex-wrap: wrap; gap: 0.35rem; margin-top: 0.5rem; }
.peer-chip { background: #dbeafe; color: #1d4ed8; font-size: 0.75rem; padding: 2px 8px; border-radius: 999px; }

/* Discovery */
.disc-row { display: flex; align-items: center; gap: 0.5rem; padding: 0.35rem 0; border-bottom: 1px solid var(--ion-border-color, #eee); }
.disc-node { font-family: monospace; font-size: 0.78rem; flex: 0 0 auto; }
.disc-caps { flex: 1; font-size: 0.76rem; color: var(--ion-color-medium, #888); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sub-heading { font-size: 0.88rem; font-weight: 600; margin: 0.75rem 0 0.4rem; }
.result-box { border-radius: 6px; padding: 0.45rem 0.7rem; font-size: 0.82rem; margin-top: 0.5rem; }
.result-box.ok  { background: #dcfce7; color: #166534; }
.result-box.err { background: #fee2e2; color: #991b1b; }

/* Learn more details */
.learn-more { margin-top: 0.75rem; font-size: 0.82rem; }
.learn-more summary { cursor: pointer; color: var(--ion-color-primary, #3b82f6); }
.learn-more p { margin: 0.5rem 0 0; color: var(--ion-color-medium, #666); line-height: 1.5; }

/* Hint text */
.hint { font-size: 0.82rem; color: var(--ion-color-medium, #888); margin: 0.25rem 0 0.75rem; line-height: 1.4; }
.hint.muted { opacity: 0.7; }
.mt { margin-top: 0.75rem; }
</style>
