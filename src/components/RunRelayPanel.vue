<template>
  <!--
    RunRelayPanel.vue — User-friendly relay setup
    
    Three paths depending on technical level:
      1. Browser relay  — zero setup, works while tab is open
      2. Home server    — Raspberry Pi or spare PC, one install script
      3. VPS / cloud    — full Docker setup for permanent hosting
    
    Add this to Settings → Network, below the existing NetworkSettingsPanel.
  -->
  <div class="relay-panel">
    <h3 class="panel-title">Run a Relay Node</h3>
    <p class="panel-desc">
      Every relay you run makes the network more resilient. Choose the option
      that fits your setup — even a browser tab helps.
    </p>

    <!-- ── Path selector ─────────────────────────────────────────────── -->
    <div class="path-cards">
      <button
        v-for="path in paths"
        :key="path.id"
        class="path-card"
        :class="{ selected: selectedPath === path.id }"
        @click="selectedPath = path.id"
      >
        <span class="path-icon">{{ path.icon }}</span>
        <span class="path-label">{{ path.label }}</span>
        <span class="path-diff" :class="`diff-${path.difficulty}`">
          {{ path.difficulty }}
        </span>
      </button>
    </div>

    <!-- ══════════════════════════════════════════════════════════════════
         PATH 1: Browser relay (no setup)
    ══════════════════════════════════════════════════════════════════ -->
    <section v-if="selectedPath === 'browser'" class="path-section">
      <div class="what-box">
        <strong>What this does:</strong> Your open browser tab acts as a Gun
        relay peer. Other users who add your URL can sync data through your tab.
        The relay stops when you close this tab.
      </div>

      <!-- Active state -->
      <div v-if="browserRelay.active" class="relay-active-card">
        <div class="active-header">
          <span class="green-dot" />
          <strong>Browser relay is running</strong>
          <span class="uptime">{{ uptimeLabel }}</span>
        </div>

        <div v-if="browserRelay.publicUrl" class="url-row">
          <code class="relay-url">{{ browserRelay.publicUrl }}</code>
          <button class="btn-copy" @click="copyUrl" :title="copied ? 'Copied!' : 'Copy URL'">
            {{ copied ? '✓' : '⎘' }}
          </button>
        </div>

        <p class="hint">
          Share this URL with others. They add it in
          <strong>Settings → Network → Relay Peers → Add Peer</strong>.
        </p>

        <div v-if="browserRelay.error" class="warn-box">{{ browserRelay.error }}</div>

        <div class="stats-row">
          <div class="stat">
            <div class="stat-num">{{ browserRelay.peersServed }}</div>
            <div class="stat-lbl">Peers served</div>
          </div>
          <div class="stat">
            <div class="stat-num">{{ uptimeMinutes }}m</div>
            <div class="stat-lbl">Uptime</div>
          </div>
        </div>

        <button class="btn-stop" @click="stopBrowserRelay">Stop relay</button>
      </div>

      <!-- Inactive state -->
      <div v-else class="relay-inactive-card">
        <ul class="feature-list">
          <li>✅ Zero setup — works right now</li>
          <li>✅ No server or domain needed</li>
          <li>✅ Encrypted traffic stays encrypted</li>
          <li>⚠️ Only works while this tab is open</li>
          <li>⚠️ Limited to ~20 concurrent peers</li>
          <li>⚠️ Your IP is shared with the tunnel bridge service</li>
        </ul>

        <button class="btn-start" :disabled="starting" @click="startBrowserRelay">
          {{ starting ? 'Starting…' : 'Start Browser Relay' }}
        </button>
        <p v-if="startError" class="err-msg">{{ startError }}</p>
      </div>
    </section>

    <!-- ══════════════════════════════════════════════════════════════════
         PATH 2: Home server (Raspberry Pi / spare PC)
    ══════════════════════════════════════════════════════════════════ -->
    <section v-if="selectedPath === 'home'" class="path-section">
      <div class="what-box">
        <strong>What this does:</strong> Runs a permanent relay on hardware
        you already own — a Raspberry Pi, an old PC, or any Linux machine.
        Always on, no monthly cost, works even when this app is closed.
      </div>

      <div class="steps">
        <div class="step">
          <div class="step-num">1</div>
          <div class="step-body">
            <strong>Open a terminal on your Pi / PC</strong>
            <p>Any Linux machine works (Ubuntu, Raspberry Pi OS, Debian).</p>
          </div>
        </div>

        <div class="step">
          <div class="step-num">2</div>
          <div class="step-body">
            <strong>Run the one-line installer</strong>
            <div class="code-block">
              <code>curl -fsSL {{ installScriptUrl }} | bash</code>
              <button class="btn-copy-small" @click="copyInstallScript">
                {{ copiedInstall ? '✓' : '⎘' }}
              </button>
            </div>
            <p class="hint">
              This installs Node.js (if not present), downloads the relay, and
              starts it as a system service that auto-restarts on reboot.
            </p>
          </div>
        </div>

        <div class="step">
          <div class="step-num">3</div>
          <div class="step-body">
            <strong>Find your relay URL</strong>
            <p>
              The installer prints your relay URL when it finishes. It looks like:
            </p>
            <code class="inline-code">http://192.168.x.x:8765/gun</code>
            <p class="hint">
              This URL works for anyone on your local network. For internet access,
              see the optional port forwarding step below.
            </p>
          </div>
        </div>

        <div class="step">
          <div class="step-num">4</div>
          <div class="step-body">
            <strong>Add the URL in the app</strong>
            <p>
              Go to <strong>Settings → Network → Relay Peers → Add Peer</strong>
              and paste your relay URL.
            </p>
            <div class="add-inline">
              <input
                v-model="homeRelayUrl"
                class="url-input"
                placeholder="http://192.168.1.x:8765/gun"
              />
              <button class="btn-primary-sm" :disabled="!homeRelayUrl" @click="addHomeRelay">
                Add
              </button>
            </div>
            <p v-if="homeAdded" class="success-msg">✓ Relay added</p>
          </div>
        </div>

        <details class="optional-step">
          <summary>Optional: make it reachable from the internet</summary>
          <div class="step-body">
            <p>
              By default your relay only works on your home network. To let
              anyone reach it, you need to forward port <code>8765</code> in
              your router settings to your Pi's local IP.
            </p>
            <p>
              Then add a free subdomain via
              <a href="https://www.duckdns.org" target="_blank">DuckDNS</a>
              (e.g. <code>myhome.duckdns.org</code>) pointing to your home IP.
            </p>
            <p>
              Your public relay URL would then be:
              <code>http://myhome.duckdns.org:8765/gun</code>
            </p>
            <p class="warn-inline">
              ⚠️ Port forwarding exposes your home network. Only do this if you
              understand the security implications.
            </p>
          </div>
        </details>
      </div>
    </section>

    <!-- ══════════════════════════════════════════════════════════════════
         PATH 3: VPS / Cloud server
    ══════════════════════════════════════════════════════════════════ -->
    <section v-if="selectedPath === 'vps'" class="path-section">
      <div class="what-box">
        <strong>What this does:</strong> Runs a permanent, internet-facing relay
        on a rented server. Cheapest option is ~$5/month (DigitalOcean, Hetzner,
        Vultr). Supports your full community, always reachable.
      </div>

      <!-- Provider shortcuts -->
      <div class="provider-row">
        <span class="provider-label">Recommended providers:</span>
        <a
          v-for="p in providers"
          :key="p.name"
          :href="p.url"
          target="_blank"
          class="provider-chip"
        >{{ p.name }} {{ p.price }}</a>
      </div>

      <div class="steps">
        <div class="step">
          <div class="step-num">1</div>
          <div class="step-body">
            <strong>Create a $5/month Ubuntu 24 server</strong>
            <p>Any provider works. You'll get an IP address when it's ready.</p>
          </div>
        </div>

        <div class="step">
          <div class="step-num">2</div>
          <div class="step-body">
            <strong>Point a domain at your server</strong>
            <p>
              Add an A record: <code>relay.yourdomain.com → your-server-ip</code>
              <br />
              Free option: use <a href="https://www.duckdns.org" target="_blank">DuckDNS</a>
              for a free subdomain.
            </p>
          </div>
        </div>

        <div class="step">
          <div class="step-num">3</div>
          <div class="step-body">
            <strong>SSH into your server and run</strong>
            <div class="code-block">
              <code>{{ vpsInstallCmd }}</code>
              <button class="btn-copy-small" @click="copyVpsCmd">
                {{ copiedVps ? '✓' : '⎘' }}
              </button>
            </div>
            <p class="hint">
              Replace <code>relay.yourdomain.com</code> with your actual domain.
              The script installs Docker, Caddy (auto-TLS), and starts the relay.
            </p>
          </div>
        </div>

        <div class="step">
          <div class="step-num">4</div>
          <div class="step-body">
            <strong>Your relay is live at</strong>
            <div class="add-inline">
              <input
                v-model="vpsRelayUrl"
                class="url-input"
                placeholder="https://relay.yourdomain.com/gun"
              />
              <button class="btn-primary-sm" :disabled="!vpsRelayUrl" @click="addVpsRelay">
                Add
              </button>
            </div>
            <p v-if="vpsAdded" class="success-msg">✓ Relay added</p>
          </div>
        </div>
      </div>

      <details class="optional-step">
        <summary>Full Docker Compose setup (advanced)</summary>
        <p>
          See <strong>community-relay/README.md</strong> in the app repository
          for the full docker-compose.yml, Caddyfile, and moderation middleware
          configuration.
        </p>
      </details>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { BrowserRelayService } from '@/services/browserRelayService';
import { GunService } from '@/services/gunService';
import config from '@/config';

// ── Path selector ──────────────────────────────────────────────────────────────
const paths = [
  { id: 'browser', icon: '🌐', label: 'Browser tab',   difficulty: 'Easy' },
  { id: 'home',    icon: '🏠', label: 'Home server',   difficulty: 'Medium' },
  { id: 'vps',     icon: '☁️',  label: 'Cloud server',  difficulty: 'Technical' },
];
const selectedPath = ref<'browser' | 'home' | 'vps'>('browser');

// ── Browser relay ──────────────────────────────────────────────────────────────
const browserRelay = ref(BrowserRelayService.getState());
const starting = ref(false);
const startError = ref('');
const copied = ref(false);

let relayUnsub: (() => void) | null = null;
let uptimeTimer: ReturnType<typeof setInterval> | null = null;
const uptimeSeconds = ref(0);

const uptimeMinutes = computed(() => Math.floor(uptimeSeconds.value / 60));
const uptimeLabel = computed(() => {
  const m = uptimeMinutes.value;
  if (m < 1) return 'just started';
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
});

async function startBrowserRelay() {
  starting.value = true;
  startError.value = '';
  try {
    await BrowserRelayService.start();
  } catch (e: any) {
    startError.value = e.message || 'Could not start relay';
  } finally {
    starting.value = false;
  }
}

function stopBrowserRelay() {
  BrowserRelayService.stop();
}

function copyUrl() {
  const url = browserRelay.value.publicUrl;
  if (!url) return;
  navigator.clipboard.writeText(url).then(() => {
    copied.value = true;
    setTimeout(() => { copied.value = false; }, 2_000);
  });
}

// ── Home server path ───────────────────────────────────────────────────────────
const homeRelayUrl = ref('');
const homeAdded = ref(false);
const copiedInstall = ref(false);
const installScriptUrl = `${config.relay.api}/install-relay.sh`;

function copyInstallScript() {
  navigator.clipboard.writeText(`curl -fsSL ${installScriptUrl} | bash`).then(() => {
    copiedInstall.value = true;
    setTimeout(() => { copiedInstall.value = false; }, 2_000);
  });
}

function addHomeRelay() {
  if (!homeRelayUrl.value) return;
  GunService.addPeer(homeRelayUrl.value.trim());
  homeAdded.value = true;
  setTimeout(() => { homeAdded.value = false; }, 3_000);
}

// ── VPS path ───────────────────────────────────────────────────────────────────
const vpsRelayUrl = ref('');
const vpsAdded = ref(false);
const copiedVps = ref(false);

const vpsInstallCmd = `curl -fsSL ${config.relay.api}/install-relay-vps.sh | bash -s relay.yourdomain.com`;

function copyVpsCmd() {
  navigator.clipboard.writeText(vpsInstallCmd).then(() => {
    copiedVps.value = true;
    setTimeout(() => { copiedVps.value = false; }, 2_000);
  });
}

function addVpsRelay() {
  if (!vpsRelayUrl.value) return;
  GunService.addPeer(vpsRelayUrl.value.trim());
  vpsAdded.value = true;
  setTimeout(() => { vpsAdded.value = false; }, 3_000);
}

const providers = [
  { name: 'Hetzner',       price: '~€4/mo', url: 'https://www.hetzner.com/cloud' },
  { name: 'DigitalOcean',  price: '~$6/mo', url: 'https://www.digitalocean.com/pricing' },
  { name: 'Vultr',         price: '~$6/mo', url: 'https://www.vultr.com/pricing' },
];

// ── Lifecycle ──────────────────────────────────────────────────────────────────
onMounted(() => {
  relayUnsub = BrowserRelayService.onChange((state) => {
    browserRelay.value = state;
  });

  uptimeTimer = setInterval(() => {
    if (browserRelay.value.startedAt) {
      uptimeSeconds.value = Math.floor((Date.now() - browserRelay.value.startedAt) / 1_000);
    }
  }, 1_000);

  // Restore relay if it was running before page reload
  BrowserRelayService.restoreIfNeeded();
});

onUnmounted(() => {
  if (relayUnsub) relayUnsub();
  if (uptimeTimer) clearInterval(uptimeTimer);
});
</script>

<style scoped>
.relay-panel { padding: 1rem; max-width: 600px; }
.panel-title { font-size: 1.05rem; font-weight: 600; margin-bottom: 0.35rem; }
.panel-desc  { font-size: 0.85rem; color: var(--ion-color-medium, #888); margin-bottom: 1rem; }

/* Path cards */
.path-cards { display: flex; gap: 0.5rem; margin-bottom: 1.25rem; }
.path-card {
  flex: 1; display: flex; flex-direction: column; align-items: center; gap: 0.25rem;
  padding: 0.75rem 0.5rem; border: 1px solid var(--ion-border-color, #ddd);
  border-radius: 8px; cursor: pointer; background: none; transition: border-color 0.15s;
}
.path-card.selected { border-color: var(--ion-color-primary, #3b82f6); background: var(--ion-color-primary-tint, #eff6ff); }
.path-icon  { font-size: 1.4rem; }
.path-label { font-size: 0.78rem; font-weight: 500; }
.path-diff  { font-size: 0.7rem; padding: 1px 6px; border-radius: 999px; }
.diff-Easy       { background: #dcfce7; color: #166534; }
.diff-Medium     { background: #fef9c3; color: #713f12; }
.diff-Technical  { background: #fee2e2; color: #991b1b; }

/* Sections */
.path-section { animation: fadein 0.15s ease; }
@keyframes fadein { from { opacity: 0; } to { opacity: 1; } }

.what-box { background: #f8fafc; border-left: 3px solid var(--ion-color-primary, #3b82f6); padding: 0.6rem 0.75rem; border-radius: 0 6px 6px 0; font-size: 0.83rem; margin-bottom: 1rem; }

/* Browser relay active card */
.relay-active-card { border: 1px solid #22c55e; border-radius: 8px; padding: 0.9rem; }
.active-header { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.75rem; }
.green-dot { width: 10px; height: 10px; border-radius: 50%; background: #22c55e; animation: pulse 2s infinite; flex-shrink: 0; }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
.uptime { margin-left: auto; font-size: 0.78rem; color: var(--ion-color-medium, #888); }
.url-row { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem; background: #f1f5f9; border-radius: 6px; padding: 0.4rem 0.6rem; }
.relay-url { flex: 1; font-size: 0.78rem; word-break: break-all; font-family: var(--font-mono); }
.btn-copy { background: none; border: none; cursor: pointer; font-size: 1rem; }
.stats-row { display: flex; gap: 1rem; margin: 0.75rem 0; }
.stat { text-align: center; }
.stat-num { font-size: 1.2rem; font-weight: 700; }
.stat-lbl { font-size: 0.72rem; color: var(--ion-color-medium, #888); }

/* Browser relay inactive card */
.relay-inactive-card { border: 1px solid var(--ion-border-color, #ddd); border-radius: 8px; padding: 0.9rem; }
.feature-list { list-style: none; padding: 0; margin: 0 0 1rem; font-size: 0.83rem; line-height: 1.7; }

/* Steps */
.steps { display: flex; flex-direction: column; gap: 1rem; }
.step { display: flex; gap: 0.75rem; }
.step-num { width: 24px; height: 24px; border-radius: 50%; background: var(--ion-color-primary, #3b82f6); color: white; font-size: 0.78rem; font-weight: 700; display: flex; align-items: center; justify-content: center; flex-shrink: 0; margin-top: 2px; }
.step-body { flex: 1; font-size: 0.83rem; }
.step-body strong { display: block; margin-bottom: 0.25rem; }
.step-body p { margin: 0.25rem 0; color: var(--ion-color-medium, #666); }

/* Code blocks */
.code-block { display: flex; align-items: center; gap: 0.4rem; background: #1e293b; border-radius: 6px; padding: 0.5rem 0.75rem; margin: 0.35rem 0; }
.code-block code { flex: 1; color: #e2e8f0; font-size: 0.78rem; font-family: var(--font-mono); word-break: break-all; }
.btn-copy-small { background: none; border: none; cursor: pointer; color: #94a3b8; font-size: 0.9rem; }
.inline-code { background: #f1f5f9; padding: 2px 6px; border-radius: 4px; font-size: 0.78rem; font-family: var(--font-mono); }

/* Add inline */
.add-inline { display: flex; gap: 0.4rem; margin: 0.35rem 0; }
.url-input { flex: 1; padding: 0.35rem 0.6rem; border: 1px solid var(--ion-border-color, #ccc); border-radius: 6px; font-size: 0.82rem; }

/* Buttons */
.btn-start { width: 100%; padding: 0.6rem; background: var(--ion-color-primary, #3b82f6); color: white; border: none; border-radius: 8px; cursor: pointer; font-size: 0.88rem; font-weight: 500; }
.btn-start:disabled { opacity: 0.4; cursor: not-allowed; }
.btn-stop { width: 100%; padding: 0.5rem; background: none; border: 1px solid #ef4444; color: #ef4444; border-radius: 8px; cursor: pointer; font-size: 0.85rem; margin-top: 0.75rem; }
.btn-primary-sm { padding: 0.35rem 0.75rem; background: var(--ion-color-primary, #3b82f6); color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 0.82rem; }
.btn-primary-sm:disabled { opacity: 0.4; cursor: not-allowed; }

/* Provider chips */
.provider-row { display: flex; flex-wrap: wrap; align-items: center; gap: 0.4rem; margin-bottom: 0.75rem; }
.provider-label { font-size: 0.8rem; color: var(--ion-color-medium, #888); }
.provider-chip { font-size: 0.78rem; padding: 2px 10px; border: 1px solid var(--ion-border-color, #ddd); border-radius: 999px; text-decoration: none; color: inherit; }
.provider-chip:hover { border-color: var(--ion-color-primary, #3b82f6); }

/* Optional step */
.optional-step { margin-top: 1rem; font-size: 0.83rem; }
.optional-step summary { cursor: pointer; color: var(--ion-color-primary, #3b82f6); }

/* Misc */
.hint { font-size: 0.78rem; color: var(--ion-color-medium, #888); margin: 0.25rem 0; }
.warn-box { background: #fefce8; border: 1px solid #fde047; border-radius: 6px; padding: 0.45rem 0.65rem; font-size: 0.8rem; color: #713f12; margin-top: 0.5rem; }
.warn-inline { color: #92400e; font-size: 0.8rem; }
.err-msg { color: #ef4444; font-size: 0.78rem; margin-top: 0.25rem; }
.success-msg { color: #16a34a; font-size: 0.78rem; margin-top: 0.25rem; }
</style>
