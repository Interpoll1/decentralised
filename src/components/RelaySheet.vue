<template>
  <teleport to="body">
    <transition name="sheet-backdrop">
      <div v-if="modelValue" class="rs-backdrop" @click.self="close" aria-modal="true" role="dialog" aria-label="Relay settings">

        <transition name="sheet-slide">
          <div v-if="modelValue" class="rs-sheet">

            <!-- Handle bar (mobile) -->
            <div class="rs-handle" aria-hidden="true"></div>

            <!-- Header -->
            <div class="rs-header">
              <div class="rs-title-row">
                <div class="rs-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" width="18" height="18">
                    <circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.8"/>
                    <path d="M12 2a10 10 0 100 20A10 10 0 0012 2z" stroke="currentColor" stroke-width="1.8"/>
                    <path d="M2 12h20M12 2c-3 3-4.5 6.5-4.5 10S9 19 12 22c3-3 4.5-6.5 4.5-10S15 5 12 2z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
                  </svg>
                </div>
                <div>
                  <p class="rs-title">Network</p>
                  <p class="rs-subtitle">{{ activeRelay?.label || 'No relay selected' }}</p>
                </div>
              </div>
              <button class="rs-close" @click="close" aria-label="Close">
                <svg viewBox="0 0 24 24" fill="none" width="18" height="18">
                  <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                </svg>
              </button>
            </div>

            <!-- Quick toggles -->
            <div class="rs-quick-row">
              <button class="rs-toggle-pill" :class="{ active: anonymityOn }" @click="toggleAnonymity">
                <svg viewBox="0 0 24 24" fill="none" width="16" height="16">
                  <path d="M12 22s8-4.5 8-11V5l-8-3-8 3v6c0 6.5 8 11 8 11z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
                </svg>
                <span>Anonymity</span>
                <span class="rs-toggle-state">{{ anonymityOn ? 'ON' : 'OFF' }}</span>
              </button>

              <button class="rs-toggle-pill" :class="{ active: myRelayOn }" @click="toggleMyRelay">
                <svg viewBox="0 0 24 24" fill="none" width="16" height="16">
                  <rect x="3" y="11" width="18" height="11" rx="2" stroke="currentColor" stroke-width="1.8"/>
                  <path d="M7 11V7a5 5 0 0110 0v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
                </svg>
                <span>My Relay</span>
                <span class="rs-toggle-state">{{ myRelayOn ? 'ON' : 'OFF' }}</span>
              </button>
            </div>

            <!-- Relay list -->
            <p class="rs-section-label">Relay servers</p>
            <div class="rs-relay-list">
              <button
                v-for="relay in relays"
                :key="relay.id"
                class="rs-relay-row"
                :class="{
                  'rs-relay-row--active': relay.id === activeRelayId,
                  'rs-relay-row--tor':    relay.isTor,
                  'rs-relay-row--mine':   relay.source === 'configured' && relay.trusted,
                  'rs-relay-row--discovered': relay.source === 'discovered',
                }"
                @click="switchRelay(relay.id)"
              >
                <span class="rs-relay-type-icon" aria-hidden="true">
                  <svg v-if="relay.isTor" viewBox="0 0 24 24" fill="none" width="14" height="14">
                    <path d="M12 22s8-4.5 8-11V5l-8-3-8 3v6c0 6.5 8 11 8 11z" stroke="currentColor" stroke-width="1.8"/>
                  </svg>
                  <svg v-else-if="relay.source === 'discovered'" viewBox="0 0 24 24" fill="none" width="14" height="14">
                    <circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="1.8"/>
                    <path d="M21 21l-4-4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
                  </svg>
                  <svg v-else viewBox="0 0 24 24" fill="none" width="14" height="14">
                    <circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.8"/>
                    <path d="M12 2a10 10 0 100 20A10 10 0 0012 2z" stroke="currentColor" stroke-width="1.8"/>
                  </svg>
                </span>

                <span class="rs-relay-info">
                  <span class="rs-relay-name">{{ shortenUrl(relay.ws) }}</span>
                  <span class="rs-relay-tags">
                    <span v-if="relay.isTor"              class="rs-tag rs-tag--onion">Onion</span>
                    <span v-if="relay.source==='discovered'" class="rs-tag rs-tag--disc">Discovered</span>
                    <span v-if="relay.trusted"             class="rs-tag rs-tag--trusted">Trusted</span>
                  </span>
                </span>

                <span class="rs-relay-status-dot" :class="statusDot(relay)" aria-hidden="true"></span>
                <span v-if="relay.id === activeRelayId" class="rs-relay-check" aria-label="Active">
                  <svg viewBox="0 0 24 24" fill="none" width="16" height="16">
                    <path d="M20 6L9 17l-5-5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                </span>
              </button>

              <button class="rs-add-relay" @click="goNetwork">
                <svg viewBox="0 0 24 24" fill="none" width="14" height="14">
                  <path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                </svg>
                Add relay
              </button>
            </div>

            <!-- Footer link -->
            <button class="rs-full-settings" @click="goNetwork">
              Full network settings →
            </button>

          </div>
        </transition>
      </div>
    </transition>
  </teleport>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { RelayManager, type RelayEndpoint } from '../services/relayManager';
import config from '../config';

const props  = defineProps<{ modelValue: boolean }>();
const emit   = defineEmits<{ 'update:modelValue': [boolean]; }>();
const router = useRouter();

const relays        = ref<RelayEndpoint[]>(RelayManager.getRelayList());
const activeRelayId = ref<string | null>(RelayManager.getActiveRelay()?.id ?? null);
const activeRelay   = computed(() => relays.value.find(r => r.id === activeRelayId.value) ?? null);
const anonymityOn   = ref(config.anonymityMode);
const myRelayOn     = ref(false);

let cleanupRelay: (() => void) | null = null;

function refresh() {
  relays.value        = RelayManager.getRelayList();
  activeRelayId.value = RelayManager.getActiveRelay()?.id ?? null;
  anonymityOn.value   = config.anonymityMode;
}

function close() { emit('update:modelValue', false); }

function shortenUrl(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch { return url.slice(0, 30); }
}

function statusDot(relay: RelayEndpoint): string {
  if (relay.status === 'online')   return 'sdot--online';
  if (relay.status === 'offline')  return 'sdot--offline';
  if (relay.status === 'degraded') return 'sdot--degraded';
  return 'sdot--unknown';
}

async function switchRelay(id: string) {
  try {
    await RelayManager.switchToRelay(id);
    refresh();
  } catch (e) {
    console.warn('[RelaySheet] switchToRelay failed', e);
  }
}

function toggleAnonymity() {
  config.setAnonymityMode(!config.anonymityMode);
  anonymityOn.value = config.anonymityMode;
}

function toggleMyRelay() {
  myRelayOn.value = !myRelayOn.value;
  // BrowserRelayService integration point — toggle omitted here to keep
  // this component dependency-free; SettingsPage/NetworkPage handles the full flow.
}

function goNetwork() {
  close();
  router.push('/network');
}

onMounted(() => {
  cleanupRelay = RelayManager.onChange(refresh);
});
onUnmounted(() => {
  cleanupRelay?.();
});
</script>

<style scoped>
/* ── Backdrop ──────────────────────────────────────────────────────── */
.rs-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  z-index: 9000;
  display: flex;
  align-items: flex-end;
  backdrop-filter: blur(4px);
}

@media (min-width: 768px) {
  .rs-backdrop {
    align-items: center;
    justify-content: center;
  }
}

/* ── Sheet ─────────────────────────────────────────────────────────── */
.rs-sheet {
  background: var(--app-bg-elevated);
  border-top-left-radius: 20px;
  border-top-right-radius: 20px;
  border: 1px solid var(--app-border);
  box-shadow: var(--app-shadow-lg);
  width: 100%;
  max-height: 80vh;
  overflow-y: auto;
  padding: 0 0 env(safe-area-inset-bottom);
}

@media (min-width: 768px) {
  .rs-sheet {
    border-radius: 20px;
    max-width: 420px;
    max-height: 90vh;
  }
}

/* handle */
.rs-handle {
  width: 36px;
  height: 4px;
  background: var(--app-border-strong);
  border-radius: 2px;
  margin: 12px auto 4px;
}
@media (min-width: 768px) { .rs-handle { display: none; } }

/* ── Header ────────────────────────────────────────────────────────── */
.rs-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px 12px;
  border-bottom: 1px solid var(--app-border);
}
.rs-title-row {
  display: flex;
  align-items: center;
  gap: 12px;
}
.rs-icon {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(var(--app-accent-rgb), 0.12);
  color: var(--app-accent-bright);
  border: 1px solid rgba(var(--app-accent-rgb), 0.22);
}
.rs-title    { margin: 0; font-size: 15px; font-weight: 700; color: var(--app-text); }
.rs-subtitle { margin: 0; font-size: 12px; color: var(--app-text-subtle); }

.rs-close {
  background: none;
  border: none;
  color: var(--app-text-muted);
  cursor: pointer;
  padding: 6px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.rs-close:hover { background: rgba(255,255,255,0.08); }

/* ── Quick toggles ─────────────────────────────────────────────────── */
.rs-quick-row {
  display: flex;
  gap: 8px;
  padding: 14px 18px;
}
.rs-toggle-pill {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 10px 12px;
  border-radius: 12px;
  background: rgba(0,0,0,0.04);
  border: 1px solid var(--app-border);
  color: var(--app-text-muted);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: var(--app-transition);
}
.rs-toggle-pill.active {
  background: rgba(var(--app-accent-rgb), 0.12);
  border-color: rgba(var(--app-accent-rgb), 0.28);
  color: var(--app-accent-bright);
}
.rs-toggle-state {
  margin-left: auto;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.08em;
  opacity: 0.7;
}

/* ── Relay list ────────────────────────────────────────────────────── */
.rs-section-label {
  margin: 0 18px 6px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--app-text-subtle);
}
.rs-relay-list {
  padding: 0 12px 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.rs-relay-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 12px;
  background: none;
  border: 1px solid transparent;
  cursor: pointer;
  transition: var(--app-transition);
  text-align: left;
  width: 100%;
}
.rs-relay-row:hover { background: rgba(255,255,255,0.06); border-color: var(--app-border); }
.rs-relay-row--active {
  background: rgba(var(--app-accent-rgb), 0.1);
  border-color: rgba(var(--app-accent-rgb), 0.24);
}
.rs-relay-row--tor { color: var(--app-success); }

.rs-relay-type-icon { color: var(--app-text-subtle); flex-shrink: 0; }
.rs-relay-row--active .rs-relay-type-icon { color: var(--app-accent-bright); }

.rs-relay-info {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  flex: 1;
}
.rs-relay-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--app-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.rs-relay-tags { display: flex; gap: 4px; flex-wrap: wrap; }

/* type tags */
.rs-tag {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  padding: 1px 5px;
  border-radius: 4px;
}
.rs-tag--onion   { background: rgba(52,211,153,0.15); color: var(--app-success); }
.rs-tag--disc    { background: rgba(251,191,36,0.13); color: var(--app-warning); }
.rs-tag--trusted { background: rgba(var(--app-accent-rgb),0.13); color: var(--app-accent-bright); }

/* status dot */
.rs-relay-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.sdot--online   { background: var(--app-success); }
.sdot--offline  { background: var(--app-danger); }
.sdot--degraded { background: var(--app-warning); }
.sdot--unknown  { background: var(--app-text-subtle); opacity: 0.5; }

.rs-relay-check { color: var(--app-accent-bright); flex-shrink: 0; }

.rs-add-relay {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 10px;
  background: none;
  border: 1px dashed var(--app-border-strong);
  color: var(--app-text-muted);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  margin-top: 4px;
  transition: var(--app-transition);
}
.rs-add-relay:hover { border-color: rgba(var(--app-accent-rgb),0.4); color: var(--app-accent-bright); }

/* ── Footer ────────────────────────────────────────────────────────── */
.rs-full-settings {
  display: block;
  width: 100%;
  padding: 14px 18px;
  background: none;
  border: none;
  border-top: 1px solid var(--app-border);
  color: var(--app-accent-bright);
  font-size: 13px;
  font-weight: 600;
  text-align: center;
  cursor: pointer;
  transition: var(--app-transition);
}
.rs-full-settings:hover { background: rgba(var(--app-accent-rgb), 0.06); }

/* ── Transitions ───────────────────────────────────────────────────── */
.sheet-backdrop-enter-active, .sheet-backdrop-leave-active { transition: opacity 220ms ease; }
.sheet-backdrop-enter-from, .sheet-backdrop-leave-to { opacity: 0; }

.sheet-slide-enter-active { transition: transform 300ms cubic-bezier(0.16,1,0.3,1), opacity 220ms ease; }
.sheet-slide-leave-active { transition: transform 220ms cubic-bezier(0.4,0,1,1), opacity 160ms ease; }
.sheet-slide-enter-from   { transform: translateY(100%); opacity: 0.8; }
.sheet-slide-leave-to     { transform: translateY(100%); opacity: 0; }

@media (min-width: 768px) {
  .sheet-slide-enter-from { transform: scale(0.94) translateY(8px); }
  .sheet-slide-leave-to   { transform: scale(0.94) translateY(8px); }
}
</style>
