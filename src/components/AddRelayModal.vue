<template>
  <teleport to="body">
    <transition name="arm-backdrop">
      <div v-if="modelValue" class="arm-backdrop" @click.self="close" role="dialog" aria-modal="true" aria-label="Add relay">
        <transition name="arm-sheet">
          <div v-if="modelValue" class="arm-sheet">

            <!-- Handle (mobile) -->
            <div class="arm-handle" aria-hidden="true"></div>

            <!-- Header -->
            <div class="arm-header">
              <div class="arm-header-left">
                <div class="arm-header-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" width="18" height="18">
                    <circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.8"/>
                    <path d="M12 2a10 10 0 100 20A10 10 0 0012 2z" stroke="currentColor" stroke-width="1.8"/>
                    <path d="M2 12h20M12 2c-3 3-4.5 6.5-4.5 10S9 19 12 22c3-3 4.5-6.5 4.5-10S15 5 12 2z" stroke="currentColor" stroke-width="1.8"/>
                  </svg>
                </div>
                <div>
                  <p class="arm-title">Add relay</p>
                  <p class="arm-subtitle">Connect to another relay server or peer</p>
                </div>
              </div>
              <button class="arm-close" @click="close" aria-label="Close">
                <svg viewBox="0 0 24 24" fill="none" width="18" height="18">
                  <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                </svg>
              </button>
            </div>

            <!-- URL input -->
            <div class="arm-section">
              <label class="arm-label" for="arm-url-input">Relay URL</label>
              <div class="arm-input-row">
                <input
                  id="arm-url-input"
                  ref="urlInputEl"
                  v-model="urlInput"
                  class="arm-input"
                  type="url"
                  placeholder="https://relay.example.com"
                  autocomplete="off"
                  autocapitalize="none"
                  spellcheck="false"
                  :disabled="connecting"
                  @keydown.enter="connect"
                  @input="clearError"
                />
                <!-- QR scan button (shown if camera available) -->
                <button
                  v-if="canScan"
                  class="arm-qr-btn"
                  :disabled="connecting"
                  @click="scanQr"
                  title="Scan relay QR code"
                  aria-label="Scan QR code"
                >
                  <svg viewBox="0 0 24 24" fill="none" width="18" height="18">
                    <rect x="3" y="3" width="7" height="7" rx="1" stroke="currentColor" stroke-width="1.8"/>
                    <rect x="14" y="3" width="7" height="7" rx="1" stroke="currentColor" stroke-width="1.8"/>
                    <rect x="3" y="14" width="7" height="7" rx="1" stroke="currentColor" stroke-width="1.8"/>
                    <path d="M14 14h3v3M17 20v1M20 14v3M20 20h1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
                  </svg>
                </button>
                <!-- Paste from clipboard -->
                <button class="arm-paste-btn" :disabled="connecting" @click="pasteFromClipboard" title="Paste URL" aria-label="Paste from clipboard">
                  <svg viewBox="0 0 24 24" fill="none" width="18" height="18">
                    <rect x="9" y="9" width="13" height="13" rx="2" stroke="currentColor" stroke-width="1.8"/>
                    <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" stroke="currentColor" stroke-width="1.8"/>
                  </svg>
                </button>
              </div>
              <p v-if="inputError" class="arm-error" role="alert">{{ inputError }}</p>
              <p class="arm-hint">Enter the base URL of the relay. The Gun and API endpoints will be inferred automatically.</p>
            </div>

            <!-- Probe status while connecting -->
            <div v-if="probing" class="arm-probe-row">
              <div class="arm-probe-spinner"></div>
              <span>Checking relay…</span>
            </div>

            <!-- Connect button -->
            <button
              class="arm-connect-btn"
              :disabled="!urlInput.trim() || connecting"
              @click="connect"
            >
              <svg v-if="!connecting" viewBox="0 0 24 24" fill="none" width="16" height="16">
                <path d="M5 12h14M12 5l7 7-7 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              <div v-else class="arm-btn-spinner"></div>
              {{ connecting ? 'Connecting…' : 'Connect to relay' }}
            </button>

            <!-- ── Presets ──────────────────────────────────────────── -->
            <div class="arm-section">
              <p class="arm-label">Known public relays</p>
              <div class="arm-preset-list">
                <button
                  v-for="p in PRESETS"
                  :key="p.url"
                  class="arm-preset"
                  :class="{ 'arm-preset--active': isConnected(p.url) }"
                  :disabled="connecting || isConnected(p.url)"
                  @click="usePreset(p)"
                >
                  <div class="arm-preset-left">
                    <span class="arm-preset-dot" :class="isConnected(p.url) ? 'dot-on' : 'dot-off'"></span>
                    <div class="arm-preset-info">
                      <strong>{{ p.label }}</strong>
                      <span>{{ p.description }}</span>
                    </div>
                  </div>
                  <span v-if="isConnected(p.url)" class="arm-preset-tag arm-preset-tag--connected">Connected</span>
                  <span v-else class="arm-preset-tag">Add</span>
                </button>
              </div>
            </div>

            <!-- ── Discovered peers ────────────────────────────────── -->
            <div v-if="discoveredRelays.length > 0" class="arm-section">
              <p class="arm-label">Discovered from peers</p>
              <div class="arm-discovered-list">
                <button
                  v-for="r in discoveredRelays"
                  :key="r.ws"
                  class="arm-preset arm-preset--discovered"
                  :class="{ 'arm-preset--active': isConnected(r.ws) }"
                  :disabled="connecting || isConnected(r.ws)"
                  @click="usePreset({ url: r.ws, label: shortenUrl(r.ws), description: 'Discovered from mesh' })"
                >
                  <div class="arm-preset-left">
                    <span class="arm-preset-dot" :class="isConnected(r.ws) ? 'dot-on' : 'dot-off'"></span>
                    <div class="arm-preset-info">
                      <strong>{{ shortenUrl(r.ws) }}</strong>
                      <span>{{ r.ws }}</span>
                    </div>
                  </div>
                  <span class="arm-preset-tag arm-preset-tag--disc">Discovered</span>
                </button>
              </div>
            </div>

            <!-- Success banner -->
            <transition name="arm-banner">
              <div v-if="successMessage" class="arm-success" role="status">
                <svg viewBox="0 0 24 24" fill="none" width="16" height="16">
                  <path d="M22 11.08V12a10 10 0 11-5.93-9.14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
                  <path d="M22 4L12 14.01l-3-3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                {{ successMessage }}
              </div>
            </transition>

          </div>
        </transition>
      </div>
    </transition>
  </teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted } from 'vue';
import { toastController } from '@ionic/vue';
import { RelayManager, type RelayEndpoint } from '../services/relayManager';
import { useQrScan } from '../composables/useQrScan';

const props  = defineProps<{ modelValue: boolean; prefillUrl?: string }>();
const emit   = defineEmits<{
  'update:modelValue': [boolean];
  connected: [relay: RelayEndpoint];
}>();

const { isSupported: canScan, scan: doScan } = useQrScan();

// ── State ──────────────────────────────────────────────────────────────────
const urlInput      = ref('');
const inputError    = ref('');
const probing       = ref(false);
const connecting    = ref(false);
const successMessage = ref('');
const urlInputEl    = ref<HTMLInputElement | null>(null);
const discoveredRelays = ref<RelayEndpoint[]>([]);

// ── Presets ────────────────────────────────────────────────────────────────
const PRESETS = [
  {
    url:         'https://interpoll2.endless.sbs',
    label:       'InterPoll public relay',
    description: 'interpoll2.endless.sbs — the default open relay',
  },
  // Add more known community relays here as they are established
];

// ── Watchers ───────────────────────────────────────────────────────────────
watch(() => props.modelValue, async (open) => {
  if (!open) return;
  urlInput.value       = props.prefillUrl ?? '';
  inputError.value     = '';
  successMessage.value = '';
  probing.value        = false;
  connecting.value     = false;
  await nextTick();
  urlInputEl.value?.focus();
  loadDiscovered();
});

watch(() => props.prefillUrl, (url) => {
  if (url) urlInput.value = url;
});

// ── Helpers ────────────────────────────────────────────────────────────────
function close() { emit('update:modelValue', false); }
function clearError() { inputError.value = ''; }

function shortenUrl(url: string): string {
  try { return new URL(url).hostname; }
  catch { return url.slice(0, 30); }
}

function isConnected(url: string): boolean {
  const relays = RelayManager.getRelayList();
  const host = (() => { try { return new URL(url).hostname; } catch { return url; } })();
  return relays.some(r => {
    try { return new URL(r.ws).hostname === host; } catch { return r.ws === url; }
  });
}

function loadDiscovered() {
  try {
    const all = RelayManager.getRelayList();
    discoveredRelays.value = all.filter(r => r.source === 'discovered').slice(0, 5);
  } catch { /* non-fatal */ }
}

// ── QR scan ────────────────────────────────────────────────────────────────
async function scanQr() {
  try {
    const result = await doScan();
    if (result) {
      urlInput.value = result.startsWith('http') ? result : `https://${result}`;
      clearError();
    }
  } catch { /* user cancelled */ }
}

// ── Clipboard ──────────────────────────────────────────────────────────────
async function pasteFromClipboard() {
  try {
    const text = await navigator.clipboard.readText();
    if (text.startsWith('http')) {
      urlInput.value = text.trim();
      clearError();
    }
  } catch { /* permission denied */ }
}

// ── Preset ─────────────────────────────────────────────────────────────────
async function usePreset(p: { url: string; label: string; description: string }) {
  urlInput.value = p.url;
  await connect();
}

// ── Connect ────────────────────────────────────────────────────────────────
async function connect() {
  inputError.value = '';
  const raw = urlInput.value.trim();
  if (!raw) { inputError.value = 'Please enter a relay URL.'; return; }

  let base = raw;
  try {
    const u = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
    base = u.origin;
  } catch {
    inputError.value = 'Invalid URL — must start with https://';
    return;
  }

  if (isConnected(base)) {
    inputError.value = 'This relay is already connected.';
    return;
  }

  // Probe the relay
  probing.value = true;
  let reachable = false;
  try {
    const res = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(5000) });
    reachable = res.ok;
  } catch {
    // Try bare root as fallback
    try {
      await fetch(base, { method: 'HEAD', signal: AbortSignal.timeout(4000) });
      reachable = true;
    } catch { /* unreachable */ }
  }
  probing.value = false;

  if (!reachable) {
    // Warn but don't block — relay might not have /api/health yet
    const toast = await toastController.create({
      message:  'Could not reach this relay. Adding anyway — it may connect later.',
      duration: 3500,
      position: 'bottom',
      color:    'warning',
    });
    await toast.present();
  }

  connecting.value = true;
  try {
    const relay = RelayManager.addRelay({
      label:   shortenUrl(base),
      ws:      base,
      gun:     `${base}/gun`,
      api:     `${base}/api`,
      priority: 1,
      isTor:   base.includes('.onion'),
      source:  'configured',
      trusted: true,
    });

    successMessage.value = `Connected to ${shortenUrl(base)}`;
    emit('connected', relay);

    setTimeout(close, 1400);
  } catch (e) {
    inputError.value = (e as Error).message || 'Failed to add relay.';
  } finally {
    connecting.value = false;
  }
}
</script>

<style scoped>
/* ── Backdrop ──── */
.arm-backdrop {
  position: fixed; inset: 0; z-index: 9100;
  background: rgba(0,0,0,0.48);
  display: flex; align-items: flex-end;
  backdrop-filter: blur(4px);
}
@media (min-width: 640px) {
  .arm-backdrop { align-items: center; justify-content: center; }
}

/* ── Sheet ──── */
.arm-sheet {
  background: var(--app-bg-elevated, #15151f);
  border: 1px solid rgba(255,255,255,0.08);
  border-top-left-radius: 20px;
  border-top-right-radius: 20px;
  width: 100%;
  max-height: 90vh;
  overflow-y: auto;
  padding-bottom: env(safe-area-inset-bottom, 16px);
  display: flex; flex-direction: column; gap: 0;
}
@media (min-width: 640px) {
  .arm-sheet {
    border-radius: 20px;
    max-width: 480px;
    max-height: 88vh;
  }
}

.arm-handle {
  width: 36px; height: 4px; border-radius: 2px;
  background: rgba(255,255,255,0.12);
  margin: 12px auto 4px;
}
@media (min-width: 640px) { .arm-handle { display: none; } }

/* ── Header ──── */
.arm-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 18px 12px;
  border-bottom: 1px solid rgba(255,255,255,0.07);
  gap: 10px;
}
.arm-header-left { display: flex; align-items: center; gap: 12px; }
.arm-header-icon {
  width: 36px; height: 36px; border-radius: 10px;
  background: rgba(var(--app-accent-rgb, 94 106 210), 0.12);
  color: var(--app-accent-bright, #a5b4fc);
  border: 1px solid rgba(var(--app-accent-rgb, 94 106 210), 0.22);
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.arm-title    { margin: 0; font-size: 15px; font-weight: 700; color: var(--app-text); }
.arm-subtitle { margin: 0; font-size: 12px; color: var(--app-text-muted); }
.arm-close {
  background: none; border: none; color: var(--app-text-muted);
  cursor: pointer; padding: 6px; border-radius: 8px;
  display: flex; align-items: center;
}
.arm-close:hover { background: rgba(255,255,255,0.07); }

/* ── Sections ──── */
.arm-section { padding: 16px 18px; display: flex; flex-direction: column; gap: 8px; }

.arm-label {
  font-size: 11px; font-weight: 700; letter-spacing: 0.12em;
  text-transform: uppercase; color: var(--app-text-subtle);
  margin: 0;
}

/* ── URL input row ──── */
.arm-input-row {
  display: flex; gap: 6px; align-items: center;
}
.arm-input {
  flex: 1; padding: 11px 14px;
  background: rgba(0,0,0,0.18);
  border: 1px solid rgba(255,255,255,0.09);
  border-radius: 10px;
  color: var(--app-text); font-size: 14px;
  font-family: inherit; outline: none;
  transition: border-color 0.15s;
}
.arm-input:focus { border-color: rgba(var(--app-accent-rgb, 94 106 210), 0.5); }
.arm-input:disabled { opacity: 0.5; }
.arm-input::placeholder { color: var(--app-text-subtle); }

.arm-qr-btn, .arm-paste-btn {
  width: 44px; height: 44px; border-radius: 10px; flex-shrink: 0;
  background: rgba(0,0,0,0.18); border: 1px solid rgba(255,255,255,0.09);
  color: var(--app-text-muted); cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: all 0.15s;
}
.arm-qr-btn:hover, .arm-paste-btn:hover {
  border-color: rgba(var(--app-accent-rgb, 94 106 210), 0.35);
  color: var(--app-accent-bright, #a5b4fc);
}
.arm-qr-btn:disabled, .arm-paste-btn:disabled { opacity: 0.4; cursor: not-allowed; }

.arm-error { margin: 0; font-size: 12.5px; color: var(--app-danger, #f87171); }
.arm-hint  { margin: 0; font-size: 11.5px; color: var(--app-text-subtle); line-height: 1.45; }

/* ── Probe ──── */
.arm-probe-row {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 18px; font-size: 13px; color: var(--app-text-muted);
}
.arm-probe-spinner {
  width: 16px; height: 16px; border-radius: 50%;
  border: 2px solid rgba(255,255,255,0.1);
  border-top-color: var(--app-accent-bright, #a5b4fc);
  animation: arm-spin 0.7s linear infinite; flex-shrink: 0;
}
@keyframes arm-spin { to { transform: rotate(360deg); } }

/* ── Connect button ──── */
.arm-connect-btn {
  display: flex; align-items: center; justify-content: center; gap: 8px;
  width: calc(100% - 36px); margin: 0 18px 4px;
  padding: 13px; border-radius: 12px; border: none;
  background: linear-gradient(180deg, var(--app-accent-bright, #a5b4fc), var(--app-accent, #5e6ad2));
  color: #fff; font-size: 15px; font-weight: 700; cursor: pointer;
  box-shadow: 0 8px 20px rgba(var(--app-accent-rgb, 94 106 210), 0.28);
  transition: opacity 0.15s;
}
.arm-connect-btn:hover:not(:disabled) { opacity: 0.9; }
.arm-connect-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.arm-btn-spinner {
  width: 18px; height: 18px; border-radius: 50%;
  border: 2px solid rgba(255,255,255,0.3);
  border-top-color: #fff;
  animation: arm-spin 0.7s linear infinite;
}

/* ── Presets ──── */
.arm-preset-list,
.arm-discovered-list { display: flex; flex-direction: column; gap: 4px; }
.arm-preset {
  display: flex; align-items: center; justify-content: space-between;
  padding: 11px 14px; border-radius: 12px;
  background: rgba(0,0,0,0.08); border: 1px solid rgba(255,255,255,0.06);
  cursor: pointer; text-align: left; width: 100%;
  gap: 10px; transition: all 0.15s;
}
.arm-preset:hover:not(:disabled) {
  border-color: rgba(var(--app-accent-rgb, 94 106 210), 0.28);
  background: rgba(var(--app-accent-rgb, 94 106 210), 0.06);
}
.arm-preset--active {
  border-color: rgba(52, 211, 153, 0.2);
  background: rgba(52, 211, 153, 0.05);
}
.arm-preset--discovered {
  border-style: dashed;
}
.arm-preset:disabled { cursor: not-allowed; opacity: 0.8; }

.arm-preset-left { display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0; }
.arm-preset-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.dot-on  { background: var(--app-success, #34d399); box-shadow: 0 0 5px rgba(52,211,153,0.4); }
.dot-off { background: rgba(255,255,255,0.15); }

.arm-preset-info { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.arm-preset-info strong { font-size: 13.5px; font-weight: 700; color: var(--app-text); }
.arm-preset-info span   { font-size: 11px; color: var(--app-text-subtle); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.arm-preset-tag {
  font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em;
  padding: 3px 8px; border-radius: 6px; flex-shrink: 0;
  background: rgba(var(--app-accent-rgb, 94 106 210), 0.12);
  color: var(--app-accent-bright, #a5b4fc);
}
.arm-preset-tag--connected { background: rgba(52,211,153,0.12); color: var(--app-success, #34d399); }
.arm-preset-tag--disc      { background: rgba(251,191,36,0.1); color: #fbbf24; }

/* ── Success ──── */
.arm-success {
  display: flex; align-items: center; gap: 10px;
  padding: 12px 18px; font-size: 13.5px; font-weight: 600;
  color: var(--app-success, #34d399);
  background: rgba(52,211,153,0.08);
  border-top: 1px solid rgba(52,211,153,0.14);
}

/* ── Transitions ──── */
.arm-backdrop-enter-active, .arm-backdrop-leave-active { transition: opacity 200ms ease; }
.arm-backdrop-enter-from, .arm-backdrop-leave-to { opacity: 0; }
.arm-sheet-enter-active { transition: transform 300ms cubic-bezier(0.16,1,0.3,1), opacity 200ms ease; }
.arm-sheet-leave-active { transition: transform 200ms ease, opacity 160ms ease; }
.arm-sheet-enter-from, .arm-sheet-leave-to { transform: translateY(100%); opacity: 0.8; }
@media (min-width: 640px) {
  .arm-sheet-enter-from, .arm-sheet-leave-to { transform: scale(0.95) translateY(8px); }
}
.arm-banner-enter-active { transition: all 0.2s ease; }
.arm-banner-leave-active { transition: all 0.15s ease; }
.arm-banner-enter-from, .arm-banner-leave-to { opacity: 0; transform: translateY(-4px); }
</style>
