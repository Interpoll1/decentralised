<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button default-href="/home"></ion-back-button>
        </ion-buttons>
        <ion-title>Join Space</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content class="join-page-content">
      <div class="join-shell">

        <!-- ── Mode picker ────────────────────────── -->
        <div class="join-mode-tabs">
          <button
            class="join-mode-tab"
            :class="{ active: mode === 'link' }"
            @click="mode = 'link'"
          >
            <svg viewBox="0 0 24 24" fill="none" width="15" height="15">
              <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
              <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
            </svg>
            Invite link
          </button>
          <button
            class="join-mode-tab"
            :class="{ active: mode === 'rendezvous' }"
            @click="mode = 'rendezvous'"
          >
            <svg viewBox="0 0 24 24" fill="none" width="15" height="15">
              <path d="M12 22s8-4.5 8-11V5l-8-3-8 3v6c0 6.5 8 11 8 11z" stroke="currentColor" stroke-width="1.8"/>
              <circle cx="12" cy="12" r="2.5" stroke="currentColor" stroke-width="1.8"/>
            </svg>
            Seed phrase
          </button>
        </div>

        <!-- ── INVITE LINK MODE ───────────────────── -->
        <template v-if="mode === 'link'">
          <div class="join-card surface-card">
            <div class="join-card-icon join-card-icon--link">
              <svg viewBox="0 0 24 24" fill="none" width="22" height="22">
                <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
                <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
              </svg>
            </div>
            <h2 class="join-card-title">Join via invite link</h2>
            <p class="join-card-sub">Paste the full invite URL you received, or scan the QR code.</p>

            <div class="join-field-group">
              <label class="join-label">Invite URL</label>
              <div class="join-input-wrap">
                <input
                  v-model="inviteUrl"
                  class="join-input"
                  type="url"
                  placeholder="https://interpoll.example.com/join/community/abc…"
                  autocomplete="off"
                  @keydown.enter="joinViaLink"
                />
                <button v-if="canScanQr" class="join-scan-btn" @click="scanQr" title="Scan QR code">
                  <svg viewBox="0 0 24 24" fill="none" width="16" height="16">
                    <rect x="3" y="3" width="7" height="7" rx="1" stroke="currentColor" stroke-width="1.8"/>
                    <rect x="14" y="3" width="7" height="7" rx="1" stroke="currentColor" stroke-width="1.8"/>
                    <rect x="3" y="14" width="7" height="7" rx="1" stroke="currentColor" stroke-width="1.8"/>
                    <path d="M14 14h3v3M17 20v1M20 14v3M20 20h1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
                  </svg>
                </button>
              </div>
              <p v-if="linkError" class="join-error">{{ linkError }}</p>
            </div>

            <!-- Preview if community pre-loaded from URL param -->
            <div v-if="preloadedCommunity" class="join-preview-card">
              <div class="join-preview-avatar">{{ preloadedCommunity.displayName?.charAt(0)?.toUpperCase() }}</div>
              <div class="join-preview-info">
                <strong>{{ preloadedCommunity.displayName }}</strong>
                <span>{{ preloadedCommunity.memberCount || 0 }} members</span>
              </div>
              <div class="join-preview-lock" v-if="preloadedCommunity.isPrivate">
                <svg viewBox="0 0 24 24" fill="none" width="14" height="14">
                  <rect x="3" y="11" width="18" height="11" rx="2" stroke="currentColor" stroke-width="1.8"/>
                  <path d="M7 11V7a5 5 0 0110 0v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
                </svg>
              </div>
            </div>

            <button
              class="join-btn join-btn--primary"
              :disabled="!inviteUrl.trim() || joiningLink"
              @click="joinViaLink"
            >
              <ion-spinner v-if="joiningLink" name="crescent" style="width:16px;height:16px"></ion-spinner>
              {{ joiningLink ? 'Joining…' : 'Join space' }}
            </button>
          </div>
        </template>

        <!-- ── RENDEZVOUS SEED MODE ───────────────── -->
        <template v-else>
          <div class="join-card surface-card">
            <div class="join-card-icon join-card-icon--rendezvous">
              <svg viewBox="0 0 24 24" fill="none" width="22" height="22">
                <path d="M12 22s8-4.5 8-11V5l-8-3-8 3v6c0 6.5 8 11 8 11z" stroke="currentColor" stroke-width="1.8"/>
                <circle cx="12" cy="12" r="2.5" stroke="currentColor" stroke-width="1.8"/>
              </svg>
            </div>
            <h2 class="join-card-title">Join a dark space</h2>
            <p class="join-card-sub">
              Enter the 8-word seed phrase shared with you. The space is not listed anywhere —
              the seed is the only way to find it.
            </p>

            <!-- Word inputs -->
            <div class="join-label">Seed phrase <span class="join-label-sub">(8 words)</span></div>
            <div class="rz-word-grid">
              <div v-for="n in 8" :key="n" class="rz-word-cell">
                <span class="rz-word-num">{{ n }}</span>
                <input
                  :ref="el => { if (el) wordRefs[n-1] = el as HTMLInputElement }"
                  v-model="seedWordInputs[n-1]"
                  class="rz-word-input"
                  type="text"
                  :placeholder="'word ' + n"
                  autocomplete="off"
                  autocapitalize="off"
                  spellcheck="false"
                  @paste="n === 1 ? handlePaste($event) : undefined"
                  @keydown.enter="focusNextWord(n-1)"
                />
              </div>
            </div>

            <!-- Paste full phrase button -->
            <button class="join-paste-btn" @click="pasteFullPhrase">
              <svg viewBox="0 0 24 24" fill="none" width="13" height="13">
                <rect x="9" y="9" width="13" height="13" rx="2" stroke="currentColor" stroke-width="1.8"/>
                <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" stroke="currentColor" stroke-width="1.8"/>
              </svg>
              Paste full phrase
            </button>

            <p v-if="seedError" class="join-error">{{ seedError }}</p>

            <!-- Derived soul preview -->
            <div v-if="derivedSoul" class="rz-soul-preview">
              <div class="rz-soul-preview-header">
                <span class="rz-soul-label">Resolved soul address</span>
                <span class="rz-epoch-tag">Epoch {{ currentEpochNum }}</span>
              </div>
              <code class="rz-soul-code">{{ derivedSoul }}</code>
              <p class="rz-soul-hint">Looking for this space in the Gun mesh…</p>
            </div>

            <!-- Found space preview -->
            <div v-if="foundSpace" class="join-preview-card join-preview-card--found">
              <div class="join-preview-avatar join-preview-avatar--dark">
                <svg viewBox="0 0 24 24" fill="none" width="14" height="14">
                  <path d="M12 22s8-4.5 8-11V5l-8-3-8 3v6c0 6.5 8 11 8 11z" stroke="currentColor" stroke-width="1.8"/>
                </svg>
              </div>
              <div class="join-preview-info">
                <strong>{{ foundSpace.displayName || 'Dark space' }}</strong>
                <span>Found via rendezvous — not listed on any relay</span>
              </div>
            </div>

            <!-- Not found notice -->
            <div v-if="searchDone && !foundSpace" class="rz-not-found">
              <svg viewBox="0 0 24 24" fill="none" width="16" height="16">
                <circle cx="11" cy="11" r="8" stroke="currentColor" stroke-width="1.8"/>
                <path d="M21 21l-4.35-4.35" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
                <path d="M8 11h6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
              </svg>
              <div>
                <strong>Space not found in this epoch</strong>
                <p>The address rotates every 6 hours. If the space was recently created try again in a few minutes. Make sure the phrase is correct.</p>
              </div>
            </div>

            <button
              class="join-btn join-btn--primary"
              :disabled="seedPhrase.trim().split(/\s+/).length < 8 || joiningRendezvous"
              @click="joinViaRendezvous"
            >
              <ion-spinner v-if="joiningRendezvous" name="crescent" style="width:16px;height:16px"></ion-spinner>
              {{ joiningRendezvous ? 'Searching…' : 'Find & join space' }}
            </button>

            <p class="rz-privacy-note">
              <svg viewBox="0 0 24 24" fill="none" width="13" height="13" style="flex-shrink:0">
                <path d="M12 22s8-4.5 8-11V5l-8-3-8 3v6c0 6.5 8 11 8 11z" stroke="currentColor" stroke-width="1.8"/>
              </svg>
              Your search happens locally — no relay sees your seed phrase.
              The soul address is computed on your device and looked up directly in the Gun mesh.
            </p>
          </div>
        </template>

        <!-- Success state -->
        <transition name="join-success">
          <div v-if="joined" class="join-success-banner">
            <svg viewBox="0 0 24 24" fill="none" width="18" height="18">
              <path d="M22 11.08V12a10 10 0 11-5.93-9.14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
              <path d="M22 4L12 14.01l-3-3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <span>Joined! Redirecting…</span>
          </div>
        </transition>

      </div>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import {
  IonPage, IonHeader, IonToolbar, IonTitle, IonContent,
  IonButtons, IonBackButton, IonSpinner, toastController,
} from '@ionic/vue';
import { useRouter, useRoute } from 'vue-router';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { GunService } from '../services/gunService';
import { CommunityService } from '../services/communityService';
import { useQrScan } from '../composables/useQrScan';
import { currentEpoch, EPOCH_MS } from '../utils/rendezvous';

const router = useRouter();
const route  = useRoute();
const { isSupported: canScanQr, scan: scanQr } = useQrScan();

// ── Mode ───────────────────────────────────────────────────────────────────
type Mode = 'link' | 'rendezvous';
const mode = ref<Mode>('link');

// Auto-switch to rendezvous mode if URL has seed param
onMounted(() => {
  const seedParam = route.query.seed as string | undefined;
  if (seedParam) {
    mode.value = 'rendezvous';
    const words = decodeURIComponent(seedParam).trim().split(/\s+/);
    words.forEach((w, i) => { if (i < 8) seedWordInputs.value[i] = w; });
  }

  // Handle /join/:type/:id route params (existing invite link flow)
  const type = route.params.type as string;
  const id   = route.params.id   as string;
  if (type === 'community' && id) {
    mode.value = 'link';
    void preloadCommunity(id);
  }
  if (type === 'rendezvous' && id) {
    mode.value = 'rendezvous';
    const words = decodeURIComponent(id).trim().split(/\s+/);
    words.forEach((w, i) => { if (i < 8) seedWordInputs.value[i] = w; });
  }
});

// ── Invite link flow ───────────────────────────────────────────────────────
const inviteUrl         = ref('');
const linkError         = ref('');
const joiningLink       = ref(false);
const preloadedCommunity = ref<any>(null);

async function preloadCommunity(id: string) {
  try {
    preloadedCommunity.value = await CommunityService.getCommunity(id);
  } catch { /* non-fatal */ }
}

async function joinViaLink() {
  linkError.value = '';
  if (!inviteUrl.value.trim()) { linkError.value = 'Please enter an invite URL.'; return; }

  let communityId = '';
  try {
    const url = new URL(inviteUrl.value.trim());
    // Pattern: /join/community/:id
    const match = url.pathname.match(/\/join\/community\/([^/]+)/);
    if (match) communityId = decodeURIComponent(match[1]);
  } catch {
    linkError.value = 'Invalid URL format.';
    return;
  }

  if (!communityId) {
    // Try treating the whole input as a raw community ID
    communityId = inviteUrl.value.trim();
  }

  joiningLink.value = true;
  try {
    await CommunityService.joinCommunity(communityId);
    joined.value = true;
    setTimeout(() => router.replace(`/community/${communityId}`), 1200);
  } catch (e) {
    linkError.value = (e as Error).message || 'Failed to join space.';
  } finally {
    joiningLink.value = false;
  }
}

// ── Rendezvous seed flow ───────────────────────────────────────────────────
const seedWordInputs  = ref<string[]>(Array(8).fill(''));
const wordRefs        = ref<(HTMLInputElement | null)[]>(Array(8).fill(null));
const seedError       = ref('');
const joiningRendezvous = ref(false);
const searchDone      = ref(false);
const foundSpace      = ref<any>(null);
const joined          = ref(false);
const currentEpochNum = ref(currentEpoch());

const seedPhrase = computed(() => seedWordInputs.value.join(' ').trim());
const derivedSoul = computed(() => {
  const words = seedPhrase.value.split(/\s+/).filter(Boolean);
  if (words.length < 8) return '';
  return deriveSpaceSoul(seedPhrase.value, currentEpochNum.value);
});

function deriveSpaceSoul(seed: string, epoch: number): string {
  const input = `interpoll-space:${seed}:${epoch}`;
  return bytesToHex(sha256(new TextEncoder().encode(input))).slice(0, 32);
}

function focusNextWord(index: number) {
  const next = wordRefs.value[index + 1];
  next?.focus();
}

function handlePaste(event: ClipboardEvent) {
  const text = event.clipboardData?.getData('text') ?? '';
  const words = text.trim().split(/\s+/);
  if (words.length >= 2) {
    event.preventDefault();
    words.slice(0, 8).forEach((w, i) => { seedWordInputs.value[i] = w; });
  }
}

async function pasteFullPhrase() {
  try {
    const text  = await navigator.clipboard.readText();
    const words = text.trim().split(/\s+/);
    if (words.length >= 2) {
      words.slice(0, 8).forEach((w, i) => { seedWordInputs.value[i] = w; });
    }
  } catch { /* permission denied — silent */ }
}

async function joinViaRendezvous() {
  seedError.value = '';
  searchDone.value = false;
  foundSpace.value = null;

  const words = seedPhrase.value.split(/\s+/).filter(Boolean);
  if (words.length < 8) {
    seedError.value = 'Please enter all 8 words of the seed phrase.';
    return;
  }

  joiningRendezvous.value = true;

  try {
    // Try current epoch and up to 2 previous epochs (handles rotation boundary)
    const epochsToTry = [
      currentEpochNum.value,
      currentEpochNum.value - 1,
      currentEpochNum.value - 2,
    ];

    let space: any = null;

    for (const epoch of epochsToTry) {
      const soul = deriveSpaceSoul(seedPhrase.value, epoch);

      // Gun lookup with 6-second timeout
      space = await new Promise<any>((resolve) => {
        const timeout = setTimeout(() => resolve(null), 6000);
        GunService.gun
          ?.get(`interpoll-rendezvous:${soul}`)
          .get('community')
          .once((data: any) => {
            clearTimeout(timeout);
            resolve(data && data.id ? data : null);
          });
      });

      if (space) break;
    }

    searchDone.value = true;

    if (!space) {
      joiningRendezvous.value = false;
      return;
    }

    foundSpace.value = space;

    // Join by community ID extracted from Gun data
    await CommunityService.joinCommunity(space.id, {
      rendezvousSeed: seedPhrase.value,
      soul:           derivedSoul.value,
    });

    joined.value = true;
    setTimeout(() => router.replace(`/community/${space.id}`), 1200);

  } catch (e) {
    seedError.value = (e as Error).message || 'Failed to join space.';
  } finally {
    joiningRendezvous.value = false;
  }
}
</script>

<style scoped>
.join-page-content { --background: var(--app-bg-base); }

.join-shell {
  max-width: 520px;
  margin: 0 auto;
  padding: 20px 16px 48px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* ── Mode tabs ───────────────────────────────────── */
.join-mode-tabs {
  display: flex;
  gap: 6px;
  background: rgba(0,0,0,0.06);
  border-radius: 12px;
  padding: 4px;
  border: 1px solid var(--app-border);
}
.join-mode-tab {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 9px 12px;
  border-radius: 9px;
  border: none;
  background: none;
  font-size: 14px;
  font-weight: 600;
  color: var(--app-text-muted);
  cursor: pointer;
  transition: all 0.15s;
}
.join-mode-tab.active {
  background: var(--app-surface);
  color: var(--app-text);
  box-shadow: 0 1px 4px rgba(0,0,0,0.18);
}
.join-mode-tab svg { flex-shrink: 0; }

/* ── Cards ───────────────────────────────────────── */
.join-card {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 20px 18px;
  border-radius: 16px;
}

.join-card-icon {
  width: 48px; height: 48px;
  border-radius: 14px;
  display: flex; align-items: center; justify-content: center;
}
.join-card-icon--link        { background: rgba(var(--app-accent-rgb),0.12); color: var(--app-accent-bright); border: 1px solid rgba(var(--app-accent-rgb),0.22); }
.join-card-icon--rendezvous  { background: rgba(52,211,153,0.1); color: var(--app-success, #34d399); border: 1px solid rgba(52,211,153,0.2); }

.join-card-title { margin: 0; font-size: 20px; font-weight: 800; color: var(--app-text); letter-spacing: -0.025em; }
.join-card-sub   { margin: 0; font-size: 13.5px; color: var(--app-text-muted); line-height: 1.55; }

/* ── Fields ──────────────────────────────────────── */
.join-label { font-size: 12px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--app-text-subtle); }
.join-label-sub { font-size: 11px; font-weight: 500; letter-spacing: 0; text-transform: none; color: var(--app-text-muted); margin-left: 4px; }

.join-field-group { display: flex; flex-direction: column; gap: 6px; }

.join-input-wrap { display: flex; gap: 6px; }
.join-input {
  flex: 1;
  padding: 11px 14px;
  background: var(--app-surface);
  border: 1px solid var(--app-border);
  border-radius: 10px;
  color: var(--app-text);
  font-size: 13.5px;
  font-family: inherit;
  outline: none;
  transition: border-color 0.15s;
}
.join-input:focus { border-color: rgba(var(--app-accent-rgb),0.5); }
.join-scan-btn {
  width: 44px; height: 44px; border-radius: 10px;
  background: var(--app-surface); border: 1px solid var(--app-border);
  color: var(--app-text-muted); cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0; transition: all 0.15s;
}
.join-scan-btn:hover { border-color: rgba(var(--app-accent-rgb),0.4); color: var(--app-accent-bright); }
.join-error { margin: 0; font-size: 12.5px; color: var(--app-danger, #f87171); }

/* ── Preview card ────────────────────────────────── */
.join-preview-card {
  display: flex; align-items: center; gap: 12px;
  padding: 12px 14px; border-radius: 12px;
  background: rgba(0,0,0,0.06);
  border: 1px solid var(--app-border);
}
.join-preview-card--found {
  background: rgba(52,211,153,0.07);
  border-color: rgba(52,211,153,0.2);
}
.join-preview-avatar {
  width: 36px; height: 36px; border-radius: 10px;
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  color: #fff; font-size: 14px; font-weight: 800;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.join-preview-avatar--dark { background: rgba(52,211,153,0.15); color: var(--app-success, #34d399); }
.join-preview-info { flex: 1; display: flex; flex-direction: column; gap: 2px; }
.join-preview-info strong { font-size: 14px; font-weight: 700; color: var(--app-text); }
.join-preview-info span   { font-size: 11.5px; color: var(--app-text-muted); }
.join-preview-lock { color: var(--app-text-subtle); }

/* ── Rendezvous word grid ────────────────────────── */
.rz-word-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
}
@media (max-width: 400px) { .rz-word-grid { grid-template-columns: repeat(2, 1fr); } }

.rz-word-cell {
  display: flex;
  align-items: center;
  gap: 5px;
  background: rgba(0,0,0,0.1);
  border: 1px solid var(--app-border);
  border-radius: 8px;
  padding: 6px 8px;
  transition: border-color 0.15s;
}
.rz-word-cell:focus-within { border-color: rgba(var(--app-accent-rgb),0.5); }
.rz-word-num { font-size: 9px; font-weight: 700; color: var(--app-text-subtle); min-width: 10px; }
.rz-word-input {
  flex: 1; background: none; border: none;
  font-size: 12px; font-weight: 600;
  font-family: var(--font-mono, monospace);
  color: var(--app-text); outline: none; min-width: 0;
}
.rz-word-input::placeholder { color: var(--app-text-subtle); font-weight: 400; }

.join-paste-btn {
  display: flex; align-items: center; gap: 6px;
  background: none; border: none;
  color: var(--app-text-muted); font-size: 12.5px; font-weight: 600;
  cursor: pointer; padding: 0;
  transition: color 0.15s;
}
.join-paste-btn:hover { color: var(--app-accent-bright); }

/* ── Soul preview ────────────────────────────────── */
.rz-soul-preview {
  display: flex; flex-direction: column; gap: 6px;
  padding: 10px 12px; border-radius: 10px;
  background: rgba(0,0,0,0.12);
  border: 1px solid rgba(255,255,255,0.06);
}
.rz-soul-preview-header { display: flex; align-items: center; justify-content: space-between; }
.rz-soul-label {
  font-size: 10px; font-weight: 700; letter-spacing: 0.12em;
  text-transform: uppercase; color: var(--app-text-subtle);
}
.rz-epoch-tag {
  font-size: 10px; font-weight: 700;
  color: var(--app-accent-bright, #a5b4fc);
  background: rgba(var(--app-accent-rgb),0.1);
  padding: 2px 7px; border-radius: 5px;
}
.rz-soul-code {
  font-family: var(--font-mono, monospace); font-size: 11px;
  color: var(--app-text-muted); word-break: break-all; line-height: 1.4;
}
.rz-soul-hint { margin: 0; font-size: 11px; color: var(--app-text-subtle); }

/* ── Not found ───────────────────────────────────── */
.rz-not-found {
  display: flex; align-items: flex-start; gap: 10px;
  padding: 12px 14px; border-radius: 10px;
  background: rgba(248,113,113,0.07);
  border: 1px solid rgba(248,113,113,0.18);
  color: var(--app-danger, #f87171);
  font-size: 13px;
}
.rz-not-found svg { flex-shrink: 0; margin-top: 2px; }
.rz-not-found div { display: flex; flex-direction: column; gap: 4px; }
.rz-not-found strong { font-size: 13px; font-weight: 700; }
.rz-not-found p { margin: 0; font-size: 12px; color: var(--app-text-muted); line-height: 1.5; }

/* ── Privacy note ────────────────────────────────── */
.rz-privacy-note {
  display: flex; align-items: flex-start; gap: 7px;
  font-size: 12px; color: var(--app-text-subtle); line-height: 1.5; margin: 0;
}
.rz-privacy-note svg { flex-shrink: 0; margin-top: 1px; color: var(--app-success, #34d399); }

/* ── Buttons ─────────────────────────────────────── */
.join-btn {
  display: flex; align-items: center; justify-content: center; gap: 8px;
  width: 100%; padding: 13px;
  border-radius: 12px; border: none;
  font-size: 15px; font-weight: 700; cursor: pointer;
  transition: all 0.15s;
}
.join-btn--primary {
  background: linear-gradient(180deg, var(--app-accent-bright, #a5b4fc), var(--app-accent, #5e6ad2));
  color: #fff;
  box-shadow: 0 8px 20px rgba(var(--app-accent-rgb),0.28);
}
.join-btn--primary:hover:not(:disabled) { opacity: 0.92; }
.join-btn--primary:disabled { opacity: 0.4; cursor: not-allowed; }

/* ── Success banner ──────────────────────────────── */
.join-success-banner {
  display: flex; align-items: center; gap: 10px;
  padding: 14px 18px; border-radius: 12px;
  background: rgba(52,211,153,0.1);
  border: 1px solid rgba(52,211,153,0.25);
  color: var(--app-success, #34d399);
  font-size: 14px; font-weight: 700;
}
.join-success-enter-active { transition: all 0.22s ease; }
.join-success-leave-active { transition: all 0.16s ease; }
.join-success-enter-from, .join-success-leave-to { opacity: 0; transform: translateY(-6px); }
</style>
