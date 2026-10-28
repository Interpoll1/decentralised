<template>
  <ion-page class="bs-page">
    <ion-content class="bs-content" :scroll-events="false">
      <div class="bs-shell">
        <!-- Bit + his line for this step -->
        <header class="bs-bit">
          <div ref="bitWrap" class="bs-bit-wrap" :class="{ jumping }"><BitMascot :size="88" :mood="current.mood" :animated="!jumping" /></div>
          <div class="bs-bubble" :key="step">
            <p class="bs-bubble__text">{{ current.line }}</p>
          </div>
        </header>

        <div class="bs-dots" role="progressbar" :aria-valuenow="step + 1" :aria-valuemax="STEPS.length">
          <span v-for="(s, i) in STEPS" :key="s.id" class="bs-dot" :class="{ on: i <= step }" />
        </div>

        <!-- 0 · welcome -->
          <section v-if="step === 0" key="welcome" class="bs-step">
            <h1 class="bs-title">Let's set you up</h1>
            <ul class="bs-list">
              <li><b>Spaces</b> — pick communities for your feed</li>
              <li><b>Private key</b> — the only thing that proves you're you</li>
              <li><b>Relay</b> — choose how you connect to the network</li>
            </ul>
            <p class="bs-note">About a minute. No email, no phone, no account.</p>
            <button v-if="!restoring && !recoveringName" class="bs-link bs-restore-link" @click="restoring = true">I already have a recovery phrase</button>
            <button v-if="!restoring && !recoveringName" class="bs-link bs-restore-link" @click="recoveringName = true">I lost my key — recover my username</button>
            <div v-if="recoveringName" class="bs-restore">
              <RecoverNameForm />
              <button class="bs-link" @click="recoveringName = false">Close</button>
            </div>
            <div v-else class="bs-restore">
              <RestoreKeyForm :warn-replace="false" @restored="onRestored" />
              <button class="bs-link" @click="restoring = false">Cancel</button>
            </div>
          </section>

          <!-- 1 · spaces -->
          <section v-else-if="step === 1" key="spaces" class="bs-step">
            <h1 class="bs-title">Pick spaces to follow</h1>
            <p class="bs-sub">Your feed shows posts from spaces you join. You can change this any time.</p>
            <p v-if="loadingSpaces" class="bs-note">Loading spaces…</p>
            <p v-else-if="spacesError" class="bs-error">{{ spacesError }} <button class="bs-link" @click="loadSpaces">Retry</button></p>
            <div v-else class="bs-grid">
              <button
                v-for="c in spaces" :key="c.id" class="bs-card" :class="{ on: picked.has(c.id) }"
                :aria-pressed="picked.has(c.id)" @click="togglePick(c.id)"
              >
                <span class="bs-card__avatar">{{ (c.displayName || c.name).charAt(0).toUpperCase() }}</span>
                <span class="bs-card__body">
                  <strong>{{ c.displayName || c.name }}</strong>
                  <small>{{ c.memberCount }} {{ c.memberCount === 1 ? 'member' : 'members' }}</small>
                </span>
                <span class="bs-card__check" aria-hidden="true">{{ picked.has(c.id) ? '✓' : '' }}</span>
              </button>
            </div>
          </section>

          <!-- 2 · private key -->
          <section v-else-if="step === 2" key="key" class="bs-step">
            <h1 class="bs-title">Your private key</h1>
            <p class="bs-sub">It was created on this device. Nobody — including us — can recover it for you. Save the 24-word phrase somewhere safe.</p>
            <div class="bs-key">
              <div class="bs-key__row">
                <span class="bs-key__label">Public ID</span>
                <code>{{ shortPubkey || '…' }}</code>
              </div>
              <div class="bs-phrase" :class="{ hidden: !showPhrase }">
                <template v-if="showPhrase"><span v-for="(w, i) in words" :key="i"><i>{{ i + 1 }}</i>{{ w }}</span></template>
                <button v-else class="bs-btn" @click="revealPhrase">Show recovery phrase</button>
              </div>
              <div v-if="showPhrase" class="bs-key__actions">
                <button class="bs-btn" @click="copyPhrase">{{ copied ? 'Copied' : 'Copy' }}</button>
                <button class="bs-btn" @click="downloadPhrase">Download .txt</button>
              </div>
            </div>
            <label class="bs-check">
              <input type="checkbox" v-model="savedKey" />
              <span>I saved my recovery phrase</span>
            </label>
          </section>

          <!-- 3 · relay -->
          <section v-else-if="step === 3" key="relay" class="bs-step">
            <h1 class="bs-title">How do you want to connect?</h1>
            <div class="bs-options">
              <button class="bs-option" :class="{ on: relayChoice === 'default' }" @click="relayChoice = 'default'">
                <strong>Interpoll public relay</strong><small>interpoll.endless.social — open, works out of the box</small>
              </button>
              <button class="bs-option" :class="{ on: relayChoice === 'community' }" @click="relayChoice = 'community'">
                <strong>A relay I trust</strong><small>Paste the address of a community or self-hosted relay</small>
              </button>
              <button class="bs-option" :class="{ on: relayChoice === 'private' }" @click="relayChoice = 'private'">
                <strong>Private mode</strong><small>Route through Tor-friendly settings; slower, harder to trace</small>
              </button>
            </div>
            <input
              v-if="relayChoice === 'community'" v-model="customRelayUrl" class="bs-input"
              type="url" inputmode="url" placeholder="https://relay.example.com" autocomplete="off"
            />
            <p v-if="relayError" class="bs-error">{{ relayError }}</p>
          </section>

          <!-- 4 · feed filter -->
          <section v-else-if="step === 4" key="filter" class="bs-step">
            <h1 class="bs-title">Want your feed a little calmer?</h1>
            <p class="bs-sub">I can quietly hide posts a moderation service has already flagged. It only checks a hash of the post text — never your username or profile. You can change this later in Settings → General.</p>
            <div class="bs-options">
              <button class="bs-option" :class="{ on: filterChoice === 'default' }" @click="filterChoice = 'default'">
                <strong>Use the built-in filter <em class="bs-tag">Recommended</em></strong><small>Best for most people. One tap, no setup.</small>
              </button>
              <button class="bs-option" :class="{ on: filterChoice === 'custom' }" @click="filterChoice = 'custom'">
                <strong>I have my own moderation service</strong><small>Paste its address and I'll use that instead.</small>
              </button>
              <button class="bs-option" :class="{ on: filterChoice === 'none' }" @click="filterChoice = 'none'">
                <strong>No thanks, show everything</strong><small>Nothing is hidden.</small>
              </button>
            </div>
            <input v-if="filterChoice === 'custom'" v-model="filterUrl" class="bs-input" type="url" inputmode="url" placeholder="https://moderation.example.com" autocomplete="off" />
            <p v-if="filterError" class="bs-error">{{ filterError }}</p>
          </section>

          <!-- 5 · done -->
          <section v-else key="done" class="bs-step">
            <h1 class="bs-title">You're all set</h1>
            <ul class="bs-list">
              <li>{{ picked.size }} {{ picked.size === 1 ? 'space' : 'spaces' }} joined</li>
              <li>{{ savedKey ? 'Recovery phrase saved' : 'Recovery phrase not saved — you can back it up in Settings' }}</li>
              <li>Connected via {{ relayLabel }}</li>
              <li>{{ filterChoice === 'none' ? 'Feed filter off' : 'Feed filter on' }}</li>
            </ul>
            <p class="bs-note">Next I'll show you around the app.</p>
          </section>

        <nav class="bs-nav">
          <button v-if="step > 0 && step < STEPS.length - 1" class="bs-btn" @click="step--">Back</button>
          <span class="bs-spacer" />
          <button v-if="canSkip" class="bs-btn bs-btn--ghost" @click="skipStep">Skip</button>
          <button class="bs-btn bs-btn--primary" :disabled="busy || !canContinue" @click="next">{{ nextLabel }}</button>
        </nav>
      </div>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { IonPage, IonContent } from '@ionic/vue';
import { useRouter } from 'vue-router';
import BitMascot, { type BitMood } from '../components/BitMascot.vue';
import { RelayManager } from '../services/relayManager';
import { useCommunityStore } from '../stores/communityStore';
import type { Community } from '../services/communityService';
import config from '../config';
import { ModerationService, MODERATION_API_DEFAULT_BASE_URL } from '../services/moderationService';
import RestoreKeyForm from '../components/RestoreKeyForm.vue';
import RecoverNameForm from '../components/RecoverNameForm.vue';

const ONBOARDING_KEY = 'interpoll_onboarding_complete';
const MODERATION_KEY = 'interpoll_moderation_onboarding_complete';

const STEPS: { id: string; mood: BitMood; line: string }[] = [
  { id: 'welcome', mood: 'wave',  line: "Hi, I'm Bit! Let's get you ready — three quick things." },
  { id: 'spaces',  mood: 'happy', line: 'Spaces are communities. Pick a few that sound fun.' },
  { id: 'key',     mood: 'alert', line: "This part matters: your key is your identity. Don't lose it!" },
  { id: 'relay',   mood: 'idle',  line: 'A relay is how you reach the network. The default is fine.' },
  { id: 'filter', mood: 'alert', line: 'One last question: want me to hide posts a moderation service already flagged?' },
  { id: 'done',    mood: 'happy', line: 'Ribbit! You are ready. Want a quick tour?' },
];

const router = useRouter();
const communityStore = useCommunityStore();

const restoring = ref(false);
const recoveringName = ref(false);
// After restoring a key the page reloads; pick up at the spaces step.
const resumed = sessionStorage.getItem("interpoll_setup_resume");
sessionStorage.removeItem("interpoll_setup_resume");
const step = ref(resumed === "1" ? 1 : 0);
function onRestored() { sessionStorage.setItem("interpoll_setup_resume", "1"); window.location.reload(); }
const busy = ref(false);
const current = computed(() => STEPS[step.value]);

// ── spaces ──
const spaces = ref<Community[]>([]);
const picked = ref(new Set<string>());
const loadingSpaces = ref(false);
const spacesError = ref('');

async function loadSpaces() {
  loadingSpaces.value = true; spacesError.value = ''; spaces.value = [];
  try {
    let base = config.relay?.api ?? '';
    try { base = new URL(base).origin; } catch { base = base.replace(/\/$/, ''); }
    const res = await fetch(`${base}/api/communities`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`Relay returned ${res.status}`);
    const json = (await res.json()) as { communities?: any[] };
    spaces.value = (json?.communities ?? [])
      .filter((c: any) => !c.isPrivate && (c.displayName || c.name))
      .slice(0, 16)
      .map((c: any): Community => ({
        id: String(c.id), name: String(c.name || c.id), displayName: String(c.displayName || c.name || c.id),
        description: c.description ?? '', isPrivate: false, memberCount: Number(c.memberCount ?? 0),
        category: c.category ?? undefined, nsfw: !!c.nsfw, rules: [],
        creatorId: String(c.creatorId ?? ""), createdAt: Number(c.createdAt ?? 0),
      }));
    if (!spaces.value.length) spacesError.value = 'No public spaces found yet.';
  } catch (e: any) {
    spacesError.value = e?.name === 'TimeoutError' ? 'The relay took too long to answer.' : `Could not load spaces: ${e?.message ?? 'unknown error'}`;
  } finally { loadingSpaces.value = false; }
}
function togglePick(id: string) {
  const next = new Set(picked.value);
  if (next.has(id)) next.delete(id); else next.add(id);
  picked.value = next;
}

// ── key ──
const shortPubkey = ref('');
const words = ref<string[]>([]);
const showPhrase = ref(false);
const savedKey = ref(false);
const copied = ref(false);

async function revealPhrase() {
  try {
    const { KeyService } = await import('../services/keyService');
    words.value = (await KeyService.exportMnemonic()).trim().split(/\s+/);
    showPhrase.value = true;
  } catch { words.value = []; showPhrase.value = false; }
}
async function copyPhrase() {
  try { await navigator.clipboard.writeText(words.value.join(' ')); copied.value = true; setTimeout(() => (copied.value = false), 2000); } catch { /* clipboard blocked */ }
}
function downloadPhrase() {
  const blob = new Blob([`Interpoll recovery phrase\n\n${words.value.join(' ')}\n\nKeep this private. Anyone with it can act as you.\n`], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'interpoll-recovery-phrase.txt'; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ── relay ──
const relayChoice = ref<'default' | 'community' | 'private'>('default');
const customRelayUrl = ref('');
const relayError = ref('');
const relayLabel = computed(() =>
  relayChoice.value === 'community' && customRelayUrl.value ? customRelayUrl.value
  : relayChoice.value === 'private' ? 'private mode' : 'the public relay');

function applyRelay(): boolean {
  relayError.value = '';
  if (relayChoice.value === 'community') {
    try {
      const base = customRelayUrl.value.trim().replace(/\/gun\/?$/, '').replace(/\/api\/?$/, '').replace(/\/$/, '');
      const host = new URL(base).hostname;
      RelayManager.addRelay({
        label: host, ws: base, gun: `${base}/gun`, api: `${base}/api`, priority: 0,
        isTor: base.includes('.onion'), source: 'configured', trusted: true,
      });
    } catch { relayError.value = 'Enter a full address, like https://relay.example.com'; return false; }
  } else if (relayChoice.value === 'private') {
    config.setAnonymityMode?.(true);
  }
  return true;
}

// ── feed filter ──
const filterChoice = ref<'default' | 'custom' | 'none'>('default');
const filterUrl = ref('');
const filterError = ref('');
function applyFilter(): boolean {
  filterError.value = '';
  if (filterChoice.value === 'none') {
    ModerationService.saveSettings({ moderateHomeFeed: false });
    localStorage.setItem(MODERATION_KEY, 'skipped');
    return true;
  }
  if (filterChoice.value === 'custom') {
    const url = filterUrl.value.trim();
    let okUrl = false;
    try { const u = new URL(url); okUrl = u.protocol === 'http:' || u.protocol === 'https:'; } catch { /* invalid */ }
    if (!okUrl) { filterError.value = 'Enter a full address, like https://moderation.example.com'; return false; }
    ModerationService.saveSettings({ moderateHomeFeed: true, moderationProvider: 'custom', moderationApiBaseUrl: url });
  } else {
    ModerationService.saveSettings({ moderateHomeFeed: true, moderationProvider: 'interpoll', moderationApiBaseUrl: MODERATION_API_DEFAULT_BASE_URL });
  }
  localStorage.setItem(MODERATION_KEY, 'true');
  return true;
}

// ── navigation ──
const canContinue = computed(() =>
  step.value === 2 ? savedKey.value
  : step.value === 3 ? (relayChoice.value !== 'community' || customRelayUrl.value.trim().length > 0)
  : step.value === 4 ? (filterChoice.value !== 'custom' || filterUrl.value.trim().length > 0)
  : true);
const canSkip = computed(() => step.value === 1 || step.value === 2);
const nextLabel = computed(() => (step.value === 0 ? "Let's go" : step.value === STEPS.length - 1 ? 'Show me around' : 'Continue'));

async function next() {
  busy.value = true;
  try {
    if (step.value === 1) {
      await Promise.allSettled(Array.from(picked.value).map(id => communityStore.joinCommunity(id)));
    }
    if (step.value === 2 && savedKey.value) { try { localStorage.setItem('interpoll_phrase_saved', 'true'); } catch { /* private mode */ } }
    if (step.value === 3 && !applyRelay()) return;
    if (step.value === 4 && !applyFilter()) return;
    if (step.value === STEPS.length - 1) return finish();
    step.value++;
  } finally { busy.value = false; }
}
function skipStep() { step.value++; }
const bitWrap = ref<HTMLElement | null>(null);
const jumping = ref(false);
async function finish() {
  localStorage.setItem(ONBOARDING_KEY, 'true');
  // Bit leaps off the page; the tour on the next screen catches him mid-air.
  const r = bitWrap.value?.getBoundingClientRect();
  if (r && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    try { sessionStorage.setItem('interpoll_bit_flight', JSON.stringify({ x: r.left, y: r.top, w: r.width })); } catch { /* optional */ }
    jumping.value = true;
    await new Promise(res => setTimeout(res, 320));
  }
  await router.replace('/home');
}

onMounted(async () => {
  void loadSpaces();
  try {
    const { KeyService } = await import('../services/keyService');
    const pk = await KeyService.getPublicKeyHex();
    if (pk) shortPubkey.value = `${pk.slice(0, 8)}…${pk.slice(-6)}`;
  } catch { /* shown as … */ }
});
</script>

<style scoped>
.bs-page, .bs-content { --background: #000; }
.bs-shell {
  min-height: 100%; box-sizing: border-box; display: flex; flex-direction: column; gap: 20px;
  max-width: 640px; margin: 0 auto; padding: 32px 20px calc(24px + env(safe-area-inset-bottom));
  color: #fff; font-family: 'Inter', system-ui, sans-serif;
}
.bs-bit { display: flex; align-items: center; gap: 16px; }
.bs-bit-wrap.jumping { animation: bs-leap 320ms cubic-bezier(.3,0,.6,1) forwards; }
@keyframes bs-leap { 0% { transform: translateY(0); } 55% { transform: translateY(-34px); } 100% { transform: translateY(-14px); } }
.bs-bubble { position: relative; flex: 1; border: 1px solid #3dff7a; border-radius: 8px; padding: 12px 14px; background: #050605; }
.bs-bubble::before { content: ''; position: absolute; left: -7px; top: 50%; width: 12px; height: 12px; margin-top: -6px; background: #050605; border-left: 1px solid #3dff7a; border-bottom: 1px solid #3dff7a; transform: rotate(45deg); }
.bs-bubble__text { margin: 0; font-size: 15px; line-height: 1.45; }
.bs-dots { display: flex; gap: 6px; }
.bs-dot { flex: 1; height: 3px; border-radius: 2px; background: #1d231d; }
.bs-dot.on { background: #3dff7a; }
.bs-step { flex: 1; display: flex; flex-direction: column; gap: 14px; }
.bs-title { margin: 8px 0 0; font-size: 28px; font-weight: 500; letter-spacing: 0.005em; }
.bs-sub, .bs-note { margin: 0; color: #a3aaa3; font-size: 14.5px; line-height: 1.55; }
.bs-note { color: #6b736b; font-size: 13.5px; }
.bs-error { margin: 0; color: #ff8a8a; font-size: 14px; }
.bs-list { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 10px; }
.bs-list li { padding: 12px 14px; border: 1px solid #161a16; border-radius: 7px; background: #050605; color: #c9d1c9; font-size: 14.5px; }
.bs-list b { color: #3dff7a; font-weight: 500; }

.bs-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 10px; }
.bs-card { display: flex; align-items: center; gap: 12px; padding: 12px; text-align: left; font: inherit; color: inherit; cursor: pointer; background: #050605; border: 1px solid #161a16; border-radius: 7px; }
.bs-card:hover { border-color: #2a312a; }
.bs-card.on { border-color: #3dff7a; }
.bs-card__avatar { width: 36px; height: 36px; flex-shrink: 0; display: grid; place-items: center; background: #1b1c1e; border-radius: 6px; font-weight: 500; }
.bs-card__body { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.bs-card__body strong { font-weight: 500; font-size: 14.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bs-card__body small { color: #6b736b; font-size: 12.5px; }
.bs-card__check { width: 18px; color: #3dff7a; }

.bs-key { display: flex; flex-direction: column; gap: 12px; padding: 14px; border: 1px solid #161a16; border-radius: 7px; background: #050605; }
.bs-key__row { display: flex; justify-content: space-between; align-items: center; gap: 10px; font-size: 13.5px; }
.bs-key__label { color: #6b736b; }
.bs-key code { font-family: var(--font-mono, monospace); color: #c9d1c9; }
.bs-phrase { display: grid; grid-template-columns: repeat(auto-fill, minmax(112px, 1fr)); gap: 8px; }
.bs-phrase.hidden { display: flex; }
.bs-phrase span { padding: 8px 10px; border: 1px solid #1d231d; border-radius: 5px; font-family: var(--font-mono, monospace); font-size: 13px; }
.bs-phrase i { font-style: normal; color: #6b736b; margin-right: 8px; }
.bs-key__actions { display: flex; gap: 8px; }
.bs-check { display: flex; align-items: center; gap: 10px; font-size: 14.5px; cursor: pointer; }
.bs-check input { width: 18px; height: 18px; accent-color: #3dff7a; }

.bs-options { display: flex; flex-direction: column; gap: 10px; }
.bs-option { display: flex; flex-direction: column; gap: 3px; padding: 14px; text-align: left; font: inherit; color: inherit; cursor: pointer; background: #050605; border: 1px solid #161a16; border-radius: 7px; }
.bs-option.on { border-color: #3dff7a; }
.bs-option strong { font-weight: 500; font-size: 15px; }
.bs-option small { color: #6b736b; font-size: 13px; }
.bs-input { padding: 11px 12px; font: inherit; color: #fff; background: #050605; border: 1px solid #2a312a; border-radius: 6px; outline: none; }
.bs-input:focus { border-color: #3dff7a; }

.bs-nav { display: flex; align-items: center; gap: 8px; padding-top: 8px; }
.bs-spacer { flex: 1; }
.bs-btn { font: inherit; font-size: 14px; font-weight: 500; padding: 10px 16px; border-radius: 6px; cursor: pointer; color: #fff; background: transparent; border: 1px solid #2a312a; }
.bs-btn:hover { border-color: #3dff7a; }
.bs-btn--ghost { border-color: transparent; color: #6b736b; }
.bs-btn--primary { background: #3dff7a; border-color: #3dff7a; color: #000; }
.bs-btn--primary:disabled { opacity: 0.35; cursor: not-allowed; }
.bs-restore-link { align-self: flex-start; padding: 0; }
.bs-restore { display: flex; flex-direction: column; gap: 10px; padding: 14px; border: 1px solid #161a16; border-radius: 7px; background: #050605; }
.bs-tag { font-style: normal; font-weight: 400; font-size: 11.5px; margin-left: 8px; padding: 2px 7px; border-radius: 5px; background: #1b1c1e; color: #3dff7a; }
.bs-link { background: none; border: 0; color: #3dff7a; text-decoration: underline; cursor: pointer; font: inherit; }

@keyframes bs-in { from { opacity: 0; } to { opacity: 1; } }
.bs-step { animation: bs-in 160ms ease; }
@media (prefers-reduced-motion: reduce) { .bs-step { animation: none; } }
</style>
