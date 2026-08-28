<template>
  <div class="rsp-shell">

    <!-- Toggle row -->
    <div class="rsp-toggle-row" @click="expanded = !expanded">
      <div class="rsp-toggle-left">
        <div class="rsp-toggle-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" width="16" height="16">
            <path d="M12 22s8-4.5 8-11V5l-8-3-8 3v6c0 6.5 8 11 8 11z" stroke="currentColor" stroke-width="1.8"/>
            <circle cx="12" cy="12" r="2.5" stroke="currentColor" stroke-width="1.8"/>
          </svg>
        </div>
        <div>
          <strong class="rsp-toggle-title">Dark mode (rendezvous address)</strong>
          <p class="rsp-toggle-sub">Not listed anywhere — only findable via seed phrase</p>
        </div>
      </div>
      <label class="rsp-switch" @click.stop>
        <input type="checkbox" v-model="darkMode" @change="onDarkModeToggle" />
        <span class="rsp-track"></span>
      </label>
    </div>

    <!-- Expanded panel -->
    <transition name="rsp-expand">
      <div v-if="darkMode && expanded" class="rsp-panel">

        <!-- How it works -->
        <div class="rsp-info">
          <p>
            Instead of a URL, this space is published to a <strong>rotating Gun soul address</strong> derived from a secret seed.
            The address changes every 6 hours via a deterministic algorithm — the same technique used by resilient peer-to-peer networks to survive censorship.
          </p>
          <p>
            Anyone who knows the seed can find the space by deriving the current address. Nobody else can discover it — not search engines, not relay indexes, not the relay operator.
          </p>
        </div>

        <!-- Seed display -->
        <div class="rsp-seed-section">
          <div class="rsp-seed-header">
            <span class="rsp-seed-label">Space seed phrase</span>
            <div class="rsp-seed-actions">
              <button class="rsp-action-btn" @click="regenerateSeed" title="Generate new seed">
                <svg viewBox="0 0 24 24" fill="none" width="13" height="13">
                  <path d="M1 4v6h6M23 20v-6h-6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                  <path d="M20.49 9A9 9 0 005.64 5.64L1 10M23 14l-4.64 4.36A9 9 0 013.51 15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                Regenerate
              </button>
              <button class="rsp-action-btn" @click="copySeed" :class="{ 'rsp-action-btn--ok': seedCopied }">
                <svg v-if="!seedCopied" viewBox="0 0 24 24" fill="none" width="13" height="13">
                  <rect x="9" y="9" width="13" height="13" rx="2" stroke="currentColor" stroke-width="1.8"/>
                  <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" stroke="currentColor" stroke-width="1.8"/>
                </svg>
                <svg v-else viewBox="0 0 24 24" fill="none" width="13" height="13">
                  <path d="M20 6L9 17l-5-5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                {{ seedCopied ? 'Copied!' : 'Copy' }}
              </button>
            </div>
          </div>

          <div class="rsp-seed-words">
            <div v-for="(word, i) in seedWords" :key="i" class="rsp-seed-word">
              <span class="rsp-word-num">{{ i + 1 }}</span>
              <span class="rsp-word-text">{{ word }}</span>
            </div>
          </div>
        </div>

        <!-- Current epoch soul -->
        <div class="rsp-soul-section">
          <div class="rsp-soul-header">
            <span class="rsp-seed-label">Current Gun soul</span>
            <span class="rsp-epoch-badge">Rotates in {{ timeToNextEpoch }}</span>
          </div>
          <div class="rsp-soul-row">
            <code class="rsp-soul-addr">{{ currentSoul }}</code>
            <button class="rsp-action-btn" @click="copySoul">
              <svg viewBox="0 0 24 24" fill="none" width="13" height="13">
                <rect x="9" y="9" width="13" height="13" rx="2" stroke="currentColor" stroke-width="1.8"/>
                <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" stroke="currentColor" stroke-width="1.8"/>
              </svg>
            </button>
          </div>
          <p class="rsp-soul-hint">This address rotates automatically. Members only need the seed — not this address — to rejoin after rotation.</p>
        </div>

        <!-- Share options -->
        <div class="rsp-share-section">
          <span class="rsp-seed-label">Share this space</span>
          <div class="rsp-share-row">
            <button class="rsp-share-btn" @click="shareViaNativeShare">
              <svg viewBox="0 0 24 24" fill="none" width="15" height="15">
                <path d="M21 12l-7-7v4C7 10 4 15 3 21c2.5-3.5 6-5.1 11-5.1V20l7-8z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>
              </svg>
              Share seed
            </button>
            <button class="rsp-share-btn" @click="copyJoinUrl">
              <svg viewBox="0 0 24 24" fill="none" width="15" height="15">
                <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
                <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
              </svg>
              Copy join link
            </button>
          </div>
        </div>

        <!-- Warning -->
        <div class="rsp-warn">
          <svg viewBox="0 0 24 24" fill="none" width="14" height="14" style="flex-shrink:0">
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0zM12 9v4M12 17h.01" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
          </svg>
          <span>
            Save this seed phrase. It cannot be recovered — there is no central server that stores it.
            Losing the seed means permanently losing access to this space and all its content.
          </span>
        </div>

      </div>
    </transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { toastController } from '@ionic/vue';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { RENDEZVOUS_SECRET, EPOCH_MS, currentEpoch, rendezvousSoul } from '../utils/rendezvous';

// ── props / emits ─────────────────────────────────────────────────────────
defineProps<{ communityName?: string }>();
const emit = defineEmits<{
  'update:darkMode':    [boolean];
  'update:seedPhrase':  [string];
  'update:currentSoul': [string];
}>();

// ── State ─────────────────────────────────────────────────────────────────
const darkMode   = ref(false);
const expanded   = ref(true);
const seedCopied = ref(false);

// Generate a random 8-word mnemonic-style seed from the BIP39 wordlist subset
// (we use a lightweight 256-word subset so we don't need to load the full bip39 lib)
const WORD_SAMPLE = [
  'alpine','anchor','arrow','astra','atlas','azure','beacon','birch','blade','blaze',
  'bloom','brine','brook','cedar','chrome','cipher','citrus','cliff','cloud','cobra',
  'coral','crest','crisp','delta','dense','drift','echo','ember','epoch','ether',
  'fable','falcon','field','fjord','flare','flash','fleet','flint','flood','flume',
  'forge','forte','frost','gale','ghost','glyph','gnome','grace','grain','grove',
  'guide','gulch','haven','helix','heron','hoard','holly','hydra','hyena','inkwell',
  'inner','ionic','jade','joule','karma','kelp','knoll','latch','lemon','lever',
  'linen','locus','lotus','lunar','lyric','manor','maple','march','marsh','mast',
  'mesa','metro','mirage','mist','mocha','morse','mosaic','nerve','nexus','noble',
  'noire','north','novel','nymph','oaken','oasis','ocean','olive','onyx','optic',
  'orbit','otter','oyster','panel','parcel','parch','patch','pearl','phase','pilot',
  'pilot','pine','pixel','pixel','plain','plume','polar','pond','prime','prism',
  'pulse','quartz','queue','quota','rally','raven','realm','relay','ridge','rivet',
  'rogue','roost','rover','ruby','runic','rustic','sable','sahel','sand','scale',
  'scout','sepal','serene','shade','shard','sheen','shore','silk','slate','smoke',
  'solar','sonic','spark','spire','spoke','spring','stark','static','steel','stern',
  'stone','storm','straw','stripe','surge','swift','talon','taper','taunt','terra',
  'thane','thorn','thrice','tidal','tiger','tinge','token','topaz','torch','totem',
  'trace','trident','trove','tuft','tulip','ultra','umbra','unity','upland','upper',
  'vapor','vault','verse','viola','viper','vista','vivid','vocal','vortex','walnut',
  'wave','weave','wedge','wheat','whirl','wick','wisp','wisp','woods','wraith',
  'xenon','yield','zeal','zenith','zephyr','zinc','zone','zoom',
];

function randomWord(): string {
  return WORD_SAMPLE[Math.floor(Math.random() * WORD_SAMPLE.length)];
}

function generateSeed(): string[] {
  return Array.from({ length: 8 }, () => randomWord());
}

// Derive a rendezvous soul from a custom seed (different from the network DGA)
function deriveSpaceSoul(seed: string, epoch: number): string {
  const input = `interpoll-space:${seed}:${epoch}`;
  return bytesToHex(sha256(new TextEncoder().encode(input))).slice(0, 32);
}

function epochCountdown(epoch: number): string {
  const nextEpochMs = (epoch + 1) * EPOCH_MS;
  const diff = nextEpochMs - Date.now();
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

const seedWords    = ref<string[]>(generateSeed());
const seedPhrase   = computed(() => seedWords.value.join(' '));
const epoch        = ref(currentEpoch());
const currentSoul  = computed(() => deriveSpaceSoul(seedPhrase.value, epoch.value));
const timeToNextEpoch = ref(epochCountdown(epoch.value));

let epochTimer: ReturnType<typeof setInterval> | null = null;

function refreshEpoch() {
  const now = currentEpoch();
  if (now !== epoch.value) epoch.value = now;
  timeToNextEpoch.value = epochCountdown(epoch.value);
}

onMounted(() => {
  epochTimer = setInterval(refreshEpoch, 30_000);
});
onUnmounted(() => {
  if (epochTimer) clearInterval(epochTimer);
});

// ── Methods ───────────────────────────────────────────────────────────────
function onDarkModeToggle() {
  emit('update:darkMode', darkMode.value);
  if (darkMode.value) {
    emit('update:seedPhrase', seedPhrase.value);
    emit('update:currentSoul', currentSoul.value);
  }
}

function regenerateSeed() {
  seedWords.value = generateSeed();
  emit('update:seedPhrase', seedPhrase.value);
  emit('update:currentSoul', currentSoul.value);
}

async function copySeed() {
  await navigator.clipboard.writeText(seedPhrase.value).catch(() => {});
  seedCopied.value = true;
  setTimeout(() => { seedCopied.value = false; }, 2000);
}

async function copySoul() {
  await navigator.clipboard.writeText(currentSoul.value).catch(() => {});
  const t = await toastController.create({ message: 'Soul address copied', duration: 1800, position: 'bottom' });
  await t.present();
}

async function copyJoinUrl() {
  const url = `${window.location.origin}/join/rendezvous/${encodeURIComponent(seedPhrase.value)}`;
  await navigator.clipboard.writeText(url).catch(() => {});
  const t = await toastController.create({ message: 'Join link copied', duration: 1800, position: 'bottom' });
  await t.present();
}

async function shareViaNativeShare() {
  const text = [
    'Join my dark space on Interpoll.',
    `Seed phrase: ${seedPhrase.value}`,
    `Paste at: ${window.location.origin}/join/rendezvous/`,
    'This space is not listed anywhere — keep the seed safe.',
  ].join('\n');
  try {
    if (navigator.share) { await navigator.share({ text }); return; }
  } catch { /* fall through */ }
  await navigator.clipboard.writeText(text).catch(() => {});
  const t = await toastController.create({ message: 'Seed share text copied', duration: 1800, position: 'bottom' });
  await t.present();
}
</script>

<style scoped>
/* ── Shell ──────────────────────────────────────── */
.rsp-shell {
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.07);
  overflow: hidden;
}

/* ── Toggle row ─────────────────────────────────── */
.rsp-toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
  background: rgba(0, 0, 0, 0.15);
  cursor: pointer;
}
.rsp-toggle-left { display: flex; align-items: center; gap: 12px; }
.rsp-toggle-icon {
  width: 34px; height: 34px; border-radius: 9px;
  background: rgba(var(--app-accent-rgb, 94 106 210), 0.1);
  border: 1px solid rgba(var(--app-accent-rgb, 94 106 210), 0.2);
  color: var(--app-accent-bright, #a5b4fc);
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.rsp-toggle-title { font-size: 14px; font-weight: 700; color: var(--app-text); display: block; margin-bottom: 2px; }
.rsp-toggle-sub   { margin: 0; font-size: 12px; color: var(--app-text-muted); }

/* toggle switch */
.rsp-switch { flex-shrink: 0; }
.rsp-switch input { display: none; }
.rsp-track {
  display: block; width: 44px; height: 24px; border-radius: 12px;
  background: rgba(255,255,255,0.12); cursor: pointer; position: relative;
  transition: background 0.2s;
}
.rsp-track::after {
  content: ''; position: absolute; top: 3px; left: 3px;
  width: 18px; height: 18px; border-radius: 50%; background: #fff;
  box-shadow: 0 1px 4px rgba(0,0,0,0.3); transition: transform 0.2s;
}
.rsp-switch input:checked + .rsp-track { background: var(--app-accent, #5e6ad2); }
.rsp-switch input:checked + .rsp-track::after { transform: translateX(20px); }

/* ── Panel ──────────────────────────────────────── */
.rsp-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 16px;
  background: rgba(0, 0, 0, 0.1);
  border-top: 1px solid rgba(255,255,255,0.05);
}

.rsp-info {
  font-size: 13px;
  color: var(--app-text-muted);
  line-height: 1.55;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.rsp-info p { margin: 0; }
.rsp-info strong { color: var(--app-text); }

/* ── Seed ───────────────────────────────────────── */
.rsp-seed-section, .rsp-soul-section, .rsp-share-section {
  display: flex; flex-direction: column; gap: 10px;
}

.rsp-seed-header, .rsp-soul-header {
  display: flex; align-items: center; justify-content: space-between;
}
.rsp-seed-label {
  font-size: 10px; font-weight: 700; letter-spacing: 0.14em;
  text-transform: uppercase; color: var(--app-text-subtle);
}
.rsp-seed-actions { display: flex; gap: 6px; }

.rsp-action-btn {
  display: flex; align-items: center; gap: 5px;
  padding: 5px 10px; border-radius: 7px;
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.09);
  color: var(--app-text-muted); font-size: 11px; font-weight: 600;
  cursor: pointer; transition: all 0.15s;
}
.rsp-action-btn:hover { background: rgba(255,255,255,0.09); color: var(--app-text); }
.rsp-action-btn--ok { color: var(--app-success, #34d399); border-color: rgba(52,211,153,0.25); }

.rsp-seed-words {
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 5px;
}
@media (max-width: 400px) { .rsp-seed-words { grid-template-columns: repeat(2, 1fr); } }

.rsp-seed-word {
  display: flex; align-items: center; gap: 5px;
  background: rgba(0,0,0,0.25);
  border: 0.5px solid rgba(255,255,255,0.08);
  border-radius: 7px; padding: 6px 8px;
}
.rsp-word-num  { font-size: 9px; font-weight: 700; color: var(--app-text-subtle); min-width: 12px; }
.rsp-word-text { font-size: 12px; font-weight: 600; font-family: var(--font-mono, monospace); color: var(--app-text); }

/* ── Soul ───────────────────────────────────────── */
.rsp-epoch-badge {
  font-size: 11px; font-weight: 600;
  color: var(--app-accent-bright, #a5b4fc);
  background: rgba(var(--app-accent-rgb, 94 106 210), 0.1);
  border: 0.5px solid rgba(var(--app-accent-rgb, 94 106 210), 0.2);
  padding: 2px 8px; border-radius: 6px;
}

.rsp-soul-row {
  display: flex; align-items: center; gap: 8px;
  background: rgba(0,0,0,0.25); border: 0.5px solid rgba(255,255,255,0.06);
  border-radius: 8px; padding: 8px 10px;
}
.rsp-soul-addr {
  flex: 1; font-family: var(--font-mono, monospace); font-size: 11px;
  color: var(--app-text-muted); word-break: break-all;
}
.rsp-soul-hint { font-size: 11px; color: var(--app-text-subtle); margin: 0; line-height: 1.4; }

/* ── Share ──────────────────────────────────────── */
.rsp-share-row { display: flex; gap: 8px; }
.rsp-share-btn {
  flex: 1; display: flex; align-items: center; justify-content: center; gap: 7px;
  padding: 10px; border-radius: 10px;
  background: rgba(var(--app-accent-rgb, 94 106 210), 0.1);
  border: 1px solid rgba(var(--app-accent-rgb, 94 106 210), 0.22);
  color: var(--app-accent-bright, #a5b4fc); font-size: 13px; font-weight: 700;
  cursor: pointer; transition: all 0.15s;
}
.rsp-share-btn:hover { background: rgba(var(--app-accent-rgb, 94 106 210), 0.18); }

/* ── Warning ────────────────────────────────────── */
.rsp-warn {
  display: flex; align-items: flex-start; gap: 8px;
  padding: 10px 12px; border-radius: 9px;
  background: rgba(251,191,36,0.07);
  border: 0.5px solid rgba(251,191,36,0.18);
  font-size: 12px; color: var(--app-text-muted); line-height: 1.5;
  color: #fbbf24;
}

/* ── Transitions ────────────────────────────────── */
.rsp-expand-enter-active { transition: all 0.24s ease; }
.rsp-expand-leave-active { transition: all 0.18s ease; }
.rsp-expand-enter-from, .rsp-expand-leave-to { opacity: 0; transform: translateY(-6px); }
</style>
