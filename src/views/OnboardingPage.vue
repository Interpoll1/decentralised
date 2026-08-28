<template>
  <ion-page class="onboarding-page">
    <ion-content class="onboarding-content" :scroll-events="false">
      <div class="ob-shell">

        <!-- Progress pips -->
        <div class="ob-pips" :aria-label="`Step ${step + 1} of 3`">
          <span v-for="n in 3" :key="n" class="ob-pip" :class="{ active: step >= n - 1, done: step > n - 1 }"></span>
        </div>

        <!-- ── STEP 0: Relay picker ──────────────────────────────────── -->
        <transition name="ob-fade" mode="out-in">
        <div v-if="step === 0" key="relay" class="ob-step">
          <div class="ob-hero-icon" aria-hidden="true">
            <svg viewBox="0 0 48 48" fill="none" width="48" height="48">
              <circle cx="24" cy="24" r="22" stroke="currentColor" stroke-width="2" opacity="0.2"/>
              <circle cx="24" cy="24" r="14" stroke="currentColor" stroke-width="2" opacity="0.4"/>
              <circle cx="24" cy="24" r="6" fill="currentColor"/>
              <path d="M24 2v44M2 24h44" stroke="currentColor" stroke-width="1.5" opacity="0.3"/>
            </svg>
          </div>
          <h1 class="ob-heading">How do you want to connect?</h1>
          <p class="ob-sub">Choose a relay to browse content from. You can add more later.</p>

          <div class="ob-option-list">
            <button class="ob-option" :class="{ active: relayChoice === 'default' }" @click="relayChoice = 'default'">
              <span class="ob-option-icon ob-option-icon--public">
                <svg viewBox="0 0 24 24" fill="none" width="20" height="20">
                  <circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.8"/>
                  <path d="M12 2a10 10 0 100 20A10 10 0 0012 2z" stroke="currentColor" stroke-width="1.8"/>
                  <path d="M2 12h20M12 2c-3 3-4.5 6.5-4.5 10S9 19 12 22c3-3 4.5-6.5 4.5-10S15 5 12 2z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
                </svg>
              </span>
              <div class="ob-option-body">
                <strong>InterPoll public relay</strong>
                <span>interpoll2.endless.sbs — open, censorship-resistant</span>
              </div>
              <span class="ob-option-check" v-if="relayChoice === 'default'">✓</span>
            </button>

            <button class="ob-option" :class="{ active: relayChoice === 'community' }" @click="relayChoice = 'community'">
              <span class="ob-option-icon ob-option-icon--community">
                <svg viewBox="0 0 24 24" fill="none" width="20" height="20">
                  <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
                  <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
                </svg>
              </span>
              <div class="ob-option-body">
                <strong>Community relay</strong>
                <span>Paste a relay URL or scan a QR code</span>
              </div>
              <span class="ob-option-check" v-if="relayChoice === 'community'">✓</span>
            </button>

            <div v-if="relayChoice === 'community'" class="ob-community-url-row">
              <input
                v-model="customRelayUrl"
                class="ob-input"
                type="url"
                placeholder="https://your-relay.example.com"
                autocomplete="off"
                @keydown.enter="validateAndNext"
              />
              <p v-if="urlError" class="ob-error">{{ urlError }}</p>
            </div>

            <button class="ob-option" :class="{ active: relayChoice === 'private' }" @click="relayChoice = 'private'">
              <span class="ob-option-icon ob-option-icon--private">
                <svg viewBox="0 0 24 24" fill="none" width="20" height="20">
                  <rect x="3" y="11" width="18" height="11" rx="2" stroke="currentColor" stroke-width="1.8"/>
                  <path d="M7 11V7a5 5 0 0110 0v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
                </svg>
              </span>
              <div class="ob-option-body">
                <strong>Private only</strong>
                <span>No central relay — P2P and local peers only</span>
              </div>
              <span class="ob-option-check" v-if="relayChoice === 'private'">✓</span>
            </button>
          </div>
        </div>

        <!-- ── STEP 1: Community picker ─────────────────────────────── -->
        <div v-else-if="step === 1" key="communities" class="ob-step">
          <div class="ob-hero-icon" aria-hidden="true">
            <svg viewBox="0 0 48 48" fill="none" width="48" height="48">
              <circle cx="16" cy="18" r="7" stroke="currentColor" stroke-width="2"/>
              <circle cx="32" cy="18" r="7" stroke="currentColor" stroke-width="2" opacity="0.6"/>
              <path d="M4 40c0-7 5.4-12 12-12h8c6.6 0 12 5 12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
              <path d="M32 28c4 0 8 3 8 9" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity="0.5"/>
            </svg>
          </div>
          <h1 class="ob-heading">Pick spaces to follow</h1>
          <p class="ob-sub">Your feed shows posts only from spaces you join. You can explore more anytime.</p>

          <!-- Loading -->
          <div v-if="loadingCommunities" class="ob-loading">
            <div class="ob-spinner"></div>
            <span>Loading spaces from relay…</span>
          </div>

          <!-- Load error with retry -->
          <div v-else-if="communityLoadError" class="ob-load-error">
            <svg viewBox="0 0 24 24" fill="none" width="20" height="20">
              <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.8"/>
              <path d="M12 8v4m0 4h.01" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
            </svg>
            <div>
              <p>{{ communityLoadError }}</p>
              <button class="ob-retry-btn" @click="loadCommunities">Retry</button>
            </div>
          </div>

          <!-- Empty — relay returned nothing -->
          <div v-else-if="previewCommunities.length === 0" class="ob-empty">
            <svg viewBox="0 0 48 48" fill="none" width="40" height="40">
              <circle cx="24" cy="24" r="20" stroke="currentColor" stroke-width="1.5" opacity="0.3"/>
              <path d="M16 24h16M24 16v16" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" opacity="0.4"/>
            </svg>
            <p>No public spaces found on this relay yet.</p>
            <p class="ob-empty-sub">You can explore and join spaces after setup.</p>
          </div>

          <!-- Community grid -->
          <div v-else class="ob-community-grid">
            <button
              v-for="c in previewCommunities"
              :key="c.id"
              class="ob-community-chip"
              :class="{ active: selectedCommunityIds.has(c.id) }"
              @click="toggleCommunity(c.id)"
            >
              <span class="ob-community-avatar" :class="avatarTone(c)">
                {{ (c.displayName || c.name || '?').charAt(0).toUpperCase() }}
              </span>
              <span class="ob-community-name">{{ c.displayName || c.name }}</span>
              <span v-if="c.memberCount" class="ob-community-count">{{ formatCount(c.memberCount) }}</span>
              <span v-if="selectedCommunityIds.has(c.id)" class="ob-chip-check">✓</span>
            </button>
          </div>

          <!-- Selection count -->
          <p v-if="selectedCommunityIds.size > 0" class="ob-selection-count">
            {{ selectedCommunityIds.size }} space{{ selectedCommunityIds.size !== 1 ? 's' : '' }} selected
          </p>
        </div>

        <!-- ── STEP 2: Identity ──────────────────────────────────────── -->
        <div v-else key="identity" class="ob-step">
          <div class="ob-hero-icon" aria-hidden="true">
            <svg viewBox="0 0 48 48" fill="none" width="48" height="48">
              <circle cx="24" cy="18" r="9" stroke="currentColor" stroke-width="2"/>
              <path d="M8 42c0-9 7.2-16 16-16s16 7 16 16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
          </div>
          <h1 class="ob-heading">Your identity</h1>
          <p class="ob-sub">InterPoll uses cryptographic keys — no email or phone needed. Your key is stored locally only.</p>

          <div class="ob-identity-card">
            <div class="ob-identity-row">
              <div class="ob-identity-key-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" width="18" height="18">
                  <circle cx="8" cy="15" r="4" stroke="currentColor" stroke-width="1.8"/>
                  <path d="M12 15h8M18 12v6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
                </svg>
              </div>
              <div class="ob-identity-info">
                <span class="ob-identity-label">Anonymous keypair</span>
                <span class="ob-identity-value">{{ shortPubkey || 'Generating…' }}</span>
              </div>
              <span class="ob-identity-badge">Local only</span>
            </div>
          </div>

          <div class="ob-info-row">
            <svg viewBox="0 0 24 24" fill="none" width="16" height="16" style="flex-shrink:0">
              <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.8"/>
              <path d="M12 8v4m0 4h.01" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
            </svg>
            Anonymous browsing works without any account. You can claim a username in Settings later.
          </div>
        </div>
        </transition>

        <!-- ── Navigation ─────────────────────────────────────────────── -->
        <div class="ob-nav">
          <button v-if="step > 0" class="ob-btn-secondary" @click="step--">Back</button>
          <span v-else></span>

          <div class="ob-nav-right">
            <button v-if="step < 2" class="ob-btn-ghost" @click="skip">Skip</button>
            <button class="ob-btn-primary" :disabled="saving" @click="validateAndNext">
              {{ step === 2 ? (saving ? 'Starting…' : 'Enter Interpoll') : 'Continue' }}
            </button>
          </div>
        </div>

      </div>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { IonPage, IonContent } from '@ionic/vue';
import { useRouter } from 'vue-router';
import { RelayManager } from '../services/relayManager';
import { useCommunityStore } from '../stores/communityStore';
import type { Community } from '../services/communityService';
import config from '../config';

const ONBOARDING_KEY = 'interpoll_onboarding_complete';

const router         = useRouter();
const communityStore = useCommunityStore();

// ── State ─────────────────────────────────────────────────────────────────
const step               = ref(0);
const relayChoice        = ref<'default' | 'community' | 'private'>('default');
const customRelayUrl     = ref('');
const urlError           = ref('');
const saving             = ref(false);
const loadingCommunities = ref(false);
const communityLoadError = ref('');
const previewCommunities = ref<Community[]>([]);
const selectedCommunityIds = ref(new Set<string>());
const shortPubkey        = ref('');

// ── Community loading — fetches from relay REST API directly ──────────────
async function loadCommunities() {
  loadingCommunities.value  = true;
  communityLoadError.value  = '';
  previewCommunities.value  = [];

  try {
    // Derive the correct API base URL from config (same logic as communityStore)
    let apiBase = config.relay?.api ?? '';
    try {
      const u = new URL(apiBase);
      apiBase = u.origin;
    } catch {
      apiBase = apiBase.replace(/\/$/, '');
    }

    const url = `${apiBase}/api/communities`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });

    if (!res.ok) throw new Error(`Relay returned ${res.status}`);

    const json = await res.json() as { communities?: any[] };
    const all  = json?.communities ?? [];

    // Filter to public only, take first 16
    previewCommunities.value = all
      .filter((c: any) => !c.isPrivate && (c.displayName || c.name))
      .slice(0, 16)
      .map((c: any): Community => ({
        id:          String(c.id),
        name:        String(c.name || c.id),
        displayName: String(c.displayName || c.name || c.id),
        description: c.description ?? '',
        isPrivate:   !!c.isPrivate,
        memberCount: Number(c.memberCount ?? 0),
        category:    c.category ?? undefined,
        nsfw:        !!c.nsfw,
        rules:       [],
      }));

  } catch (e: any) {
    // If fetch failed, try reading from communityStore if already loaded
    if (communityStore.communities.length > 0) {
      previewCommunities.value = communityStore.communities
        .filter((c: Community) => !c.isPrivate)
        .slice(0, 16);
    } else {
      communityLoadError.value = e?.name === 'TimeoutError'
        ? 'Relay took too long to respond. Check your connection.'
        : `Could not load spaces: ${e?.message ?? 'unknown error'}`;
    }
  } finally {
    loadingCommunities.value = false;
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────
function toggleCommunity(id: string) {
  const next = new Set(selectedCommunityIds.value);
  if (next.has(id)) { next.delete(id); } else { next.add(id); }
  selectedCommunityIds.value = next;
}

function avatarTone(c: Community): string {
  const cat = String(c.category || '').toLowerCase();
  if (cat.includes('tech') || cat.includes('program')) return 'tone-tech';
  if (cat.includes('politic'))                          return 'tone-politics';
  if (cat.includes('sci'))                              return 'tone-science';
  if (cat.includes('gam'))                              return 'tone-gaming';
  if (cat.includes('sport'))                            return 'tone-sports';
  if (cat.includes('music'))                            return 'tone-music';
  return 'tone-general';
}

function formatCount(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(n);
}

// ── Navigation ─────────────────────────────────────────────────────────────
async function validateAndNext() {
  urlError.value = '';

  // Step 0: validate relay choice
  if (step.value === 0) {
    if (relayChoice.value === 'community') {
      if (!customRelayUrl.value.trim()) {
        urlError.value = 'Please enter a relay URL.';
        return;
      }
      try { new URL(customRelayUrl.value.trim()); }
      catch { urlError.value = 'Invalid URL — must start with https://'; return; }

      try {
        const base = customRelayUrl.value.trim().replace(/\/gun\/?$/, '').replace(/\/api\/?$/, '');
        RelayManager.addRelay({
          label:   new URL(base).hostname,
          ws:      base,
          gun:     `${base}/gun`,
          api:     `${base}/api`,
          priority: 0,
          isTor:   base.includes('.onion'),
          source:  'configured',
          trusted: true,
        });
      } catch (e) {
        urlError.value = `Could not add relay: ${(e as Error).message}`;
        return;
      }
    } else if (relayChoice.value === 'private') {
      config.setAnonymityMode?.(true);
    }

    // Load communities before showing step 1
    await loadCommunities();
    step.value = 1;
    return;
  }

  // Step 1: join selected communities via store
  if (step.value === 1) {
    if (selectedCommunityIds.value.size > 0) {
      await Promise.allSettled(
        [...selectedCommunityIds.value].map(id =>
          communityStore.joinCommunity(id).catch(() => { /* non-fatal */ })
        )
      );
    }
    step.value = 2;
    return;
  }

  // Step 2: finish
  await finish();
}

async function finish() {
  saving.value = true;
  try {
    localStorage.setItem(ONBOARDING_KEY, 'true');
    await router.replace('/home');
  } finally {
    saving.value = false;
  }
}

function skip() {
  if (step.value === 0) {
    // Still load communities in background before skipping to step 1
    void loadCommunities();
    step.value = 1;
    return;
  }
  if (step.value === 1) { step.value = 2; return; }
  localStorage.setItem(ONBOARDING_KEY, 'true');
  void router.replace('/home');
}

onMounted(async () => {
  try {
    const { KeyService } = await import('../services/keyService');
    const pubkey = await KeyService.getPublicKey?.();
    if (pubkey) shortPubkey.value = pubkey.slice(0, 8) + '…' + pubkey.slice(-6);
  } catch { /* non-fatal */ }
});
</script>

<style scoped>
.onboarding-page, .onboarding-content { --background: var(--app-bg-base); height: 100%; }

.ob-shell {
  min-height: 100%;
  display: flex;
  flex-direction: column;
  max-width: 480px;
  margin: 0 auto;
  padding: 28px 20px env(safe-area-inset-bottom, 24px);
  box-sizing: border-box;
}

/* Pips */
.ob-pips { display: flex; gap: 6px; margin-bottom: 36px; justify-content: center; }
.ob-pip {
  width: 28px; height: 4px; border-radius: 2px;
  background: var(--app-border-strong);
  transition: background 0.25s;
}
.ob-pip.active  { background: rgba(var(--app-accent-rgb), 0.6); }
.ob-pip.done    { background: var(--app-accent-bright); }

/* Step */
.ob-step { flex: 1; display: flex; flex-direction: column; gap: 18px; }
.ob-hero-icon { color: var(--app-accent-bright); display: flex; justify-content: center; margin-bottom: 4px; }
.ob-heading { margin: 0; font-size: 26px; font-weight: 800; color: var(--app-text); line-height: 1.2; letter-spacing: -0.03em; text-align: center; }
.ob-sub { margin: 0; font-size: 15px; color: var(--app-text-muted); line-height: 1.6; text-align: center; }

/* Options */
.ob-option-list { display: flex; flex-direction: column; gap: 10px; }
.ob-option {
  display: flex; align-items: center; gap: 14px;
  padding: 14px 16px;
  background: var(--app-surface); border: 1px solid var(--app-border);
  border-radius: 14px; cursor: pointer; text-align: left;
  transition: all 0.15s; width: 100%;
}
.ob-option:hover { border-color: rgba(var(--app-accent-rgb), 0.3); }
.ob-option.active {
  border-color: rgba(var(--app-accent-rgb), 0.5);
  background: rgba(var(--app-accent-rgb), 0.08);
  box-shadow: 0 0 0 1px rgba(var(--app-accent-rgb), 0.18);
}
.ob-option-icon {
  width: 40px; height: 40px; border-radius: 12px;
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.ob-option-icon--public    { background: rgba(var(--app-accent-rgb), 0.15); color: var(--app-accent-bright); }
.ob-option-icon--community { background: rgba(52, 211, 153, 0.15); color: var(--app-success, #34d399); }
.ob-option-icon--private   { background: rgba(251, 191, 36, 0.15); color: #fbbf24; }
.ob-option-body { display: flex; flex-direction: column; gap: 3px; flex: 1; min-width: 0; }
.ob-option-body strong { font-size: 14px; font-weight: 700; color: var(--app-text); }
.ob-option-body span   { font-size: 12px; color: var(--app-text-muted); }
.ob-option-check { color: var(--app-accent-bright); font-size: 16px; font-weight: 800; }

.ob-community-url-row { padding: 4px 4px 0; display: flex; flex-direction: column; gap: 6px; }
.ob-input {
  width: 100%; padding: 12px 14px; border-radius: 12px;
  border: 1px solid var(--app-border); background: var(--app-surface);
  color: var(--app-text); font-size: 14px; font-family: inherit;
  outline: none; box-sizing: border-box; transition: border-color 0.15s;
}
.ob-input:focus { border-color: rgba(var(--app-accent-rgb), 0.5); }
.ob-error { margin: 0; font-size: 12px; color: var(--app-danger, #f87171); }

/* Loading */
.ob-loading {
  display: flex; align-items: center; gap: 12px;
  justify-content: center; padding: 32px 20px;
  color: var(--app-text-muted); font-size: 14px;
}
.ob-spinner {
  width: 20px; height: 20px;
  border: 2px solid var(--app-border-strong);
  border-top-color: var(--app-accent-bright);
  border-radius: 50%;
  animation: ob-spin 0.8s linear infinite;
  flex-shrink: 0;
}
@keyframes ob-spin { to { transform: rotate(360deg); } }

/* Error + retry */
.ob-load-error {
  display: flex; align-items: flex-start; gap: 12px;
  padding: 16px; border-radius: 12px;
  background: rgba(248, 113, 113, 0.07);
  border: 1px solid rgba(248, 113, 113, 0.18);
  color: var(--app-danger, #f87171);
}
.ob-load-error svg { flex-shrink: 0; margin-top: 2px; }
.ob-load-error p { margin: 0 0 8px; font-size: 13px; color: var(--app-text-muted); }
.ob-retry-btn {
  background: none; border: 1px solid rgba(248, 113, 113, 0.3);
  color: var(--app-danger, #f87171); font-size: 12px; font-weight: 700;
  padding: 5px 12px; border-radius: 7px; cursor: pointer;
}

/* Empty */
.ob-empty {
  display: flex; flex-direction: column; align-items: center; gap: 10px;
  padding: 28px 16px; text-align: center;
  color: var(--app-text-subtle);
}
.ob-empty p { margin: 0; font-size: 14px; color: var(--app-text-muted); }
.ob-empty-sub { font-size: 12px !important; color: var(--app-text-subtle) !important; }

/* Community grid */
.ob-community-grid { display: flex; flex-wrap: wrap; gap: 8px; }
.ob-community-chip {
  display: flex; align-items: center; gap: 7px;
  padding: 7px 12px 7px 7px;
  background: var(--app-surface); border: 1px solid var(--app-border);
  border-radius: 999px; cursor: pointer;
  font-size: 13px; font-weight: 600; color: var(--app-text);
  transition: all 0.15s;
}
.ob-community-chip.active {
  border-color: rgba(var(--app-accent-rgb), 0.5);
  background: rgba(var(--app-accent-rgb), 0.1);
  color: var(--app-accent-bright);
}
.ob-community-chip:hover { border-color: rgba(var(--app-accent-rgb), 0.3); }
.ob-community-avatar {
  width: 26px; height: 26px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 12px; font-weight: 800; flex-shrink: 0;
}
.tone-tech      { background: rgba(167, 139, 250, 0.2); color: #a78bfa; }
.tone-politics  { background: rgba(251, 113, 133, 0.2); color: #fb7185; }
.tone-science   { background: rgba(56,  189, 248, 0.2); color: #38bdf8; }
.tone-gaming    { background: rgba(74,  222, 128, 0.2); color: #4ade80; }
.tone-sports    { background: rgba(45,  212, 191, 0.2); color: #2dd4bf; }
.tone-music     { background: rgba(192, 132, 252, 0.2); color: #c084fc; }
.tone-general   { background: rgba(var(--app-accent-rgb), 0.15); color: var(--app-accent-bright); }

.ob-community-count { font-size: 11px; color: var(--app-text-subtle); }
.ob-chip-check { font-size: 12px; font-weight: 800; }
.ob-selection-count { margin: 0; font-size: 13px; color: var(--app-text-muted); text-align: center; }

/* Identity */
.ob-identity-card {
  background: var(--app-surface); border: 1px solid var(--app-border);
  border-radius: 14px; padding: 16px;
}
.ob-identity-row { display: flex; align-items: center; gap: 12px; }
.ob-identity-key-icon {
  width: 38px; height: 38px; border-radius: 10px;
  background: rgba(var(--app-accent-rgb), 0.12);
  display: flex; align-items: center; justify-content: center;
  color: var(--app-accent-bright); flex-shrink: 0;
}
.ob-identity-info { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
.ob-identity-label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: var(--app-text-subtle); }
.ob-identity-value { font-size: 13px; font-weight: 600; color: var(--app-text); font-family: monospace; }
.ob-identity-badge {
  font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em;
  padding: 3px 7px; border-radius: 6px;
  background: rgba(52, 211, 153, 0.13); color: var(--app-success, #34d399);
}
.ob-info-row {
  display: flex; align-items: flex-start; gap: 10px;
  font-size: 13px; color: var(--app-text-muted); line-height: 1.55;
  padding: 12px 14px; background: rgba(0,0,0,0.03);
  border-radius: 12px; border: 1px solid var(--app-border);
}

/* Nav */
.ob-nav {
  display: flex; align-items: center; justify-content: space-between;
  margin-top: 28px; padding-top: 16px;
  border-top: 1px solid var(--app-border); gap: 12px;
}
.ob-nav-right { display: flex; align-items: center; gap: 10px; }
.ob-btn-primary {
  padding: 12px 24px;
  background: linear-gradient(180deg, var(--app-accent-bright), var(--app-accent));
  color: #fff; border: none; border-radius: 12px;
  font-size: 15px; font-weight: 700; cursor: pointer;
  transition: opacity 0.15s;
  box-shadow: 0 8px 20px rgba(var(--app-accent-rgb), 0.28);
}
.ob-btn-primary:hover { opacity: 0.9; }
.ob-btn-primary:disabled { opacity: 0.45; cursor: not-allowed; }
.ob-btn-secondary {
  padding: 12px 20px; background: rgba(0,0,0,0.05);
  border: 1px solid var(--app-border); color: var(--app-text);
  border-radius: 12px; font-size: 14px; font-weight: 600; cursor: pointer;
  transition: background 0.15s;
}
.ob-btn-secondary:hover { background: rgba(0,0,0,0.08); }
.ob-btn-ghost {
  background: none; border: none; color: var(--app-text-muted);
  font-size: 14px; font-weight: 500; cursor: pointer; padding: 4px 8px;
}
.ob-btn-ghost:hover { color: var(--app-text); }

/* Transition */
.ob-fade-enter-active, .ob-fade-leave-active { transition: opacity 180ms ease, transform 200ms ease; }
.ob-fade-enter-from { opacity: 0; transform: translateX(14px); }
.ob-fade-leave-to   { opacity: 0; transform: translateX(-14px); }
</style>
