<template>
  <Teleport to="body">
    <!-- ── First-boot tour: spotlight + Bit's speech bubble ─────────────── -->
    <div v-if="bit.tourActive && step" class="bc-tour" role="dialog" aria-live="polite" aria-label="Interpoll tour">
      <div v-if="rect" class="bc-ring" :style="ringStyle" />
      <div v-else class="bc-dim" />

      <div class="bc-bubble" :class="{ 'bc-bubble--center': !rect }" :style="bubbleStyle">
        <div class="bc-head">
          <span ref="bubbleBit" :key="bit.tourStepIdx" class="bc-bit" :class="{ 'bc-bit--hidden': !!flight }"><BitMascot :size="40" :mood="step.mood ?? 'idle'" :animated="false" /></span>
          <div class="bc-titles">
            <strong class="bc-title">{{ step.title }}</strong>
            <span class="bc-count">{{ bit.tourStepIdx + 1 }} / {{ bit.steps.length }}</span>
          </div>
        </div>
        <p class="bc-body">{{ step.body }}</p>
        <!-- Looping demo of hold → drag → swap (decorative; the text says the same) -->
        <div v-if="step.id === 'navswap'" class="bc-demo" aria-hidden="true">
          <div class="bc-demo-bar">
            <div class="bc-demo-tab bc-demo-tab--a" style="--i:0"><NavIcon id="home" /><span>Feed</span></div>
            <div class="bc-demo-tab" style="--i:1"><NavIcon id="orbit" /><span>Orbit</span></div>
            <div class="bc-demo-tab bc-demo-tab--b" style="--i:2"><NavIcon id="chat" /><span>Messages</span></div>
            <div class="bc-demo-tab" style="--i:3"><NavIcon id="create" /><span>Publish</span></div>
            <span class="bc-demo-finger" />
          </div>
          <span class="bc-demo-cap">Hold → drag → drop</span>
        </div>
        <p v-if="rect && step.clickToAdvance" class="bc-hint">Try it — click the highlighted item.</p>

        <div class="bc-dots" aria-hidden="true">
          <span v-for="(s, i) in bit.steps" :key="s.id" class="bc-dot" :class="{ on: i <= bit.tourStepIdx }" />
        </div>

        <div class="bc-actions">
          <button class="bc-btn bc-btn--ghost" @click="bit.finishTour()">Skip tour</button>
          <span class="bc-spacer" />
          <button v-if="bit.tourStepIdx > 0 && !bit.isLastStep" class="bc-btn" @click="bit.prevStep()">Back</button>
          <template v-if="bit.isLastStep && step.id === 'username'">
            <button class="bc-btn" @click="bit.finishTour()">Later</button>
            <button class="bc-btn bc-btn--primary" @click="claimNow(true)">Claim username</button>
          </template>
          <button v-else-if="bit.isLastStep" class="bc-btn bc-btn--primary" @click="bit.finishTour()">Got it</button>
          <button v-else class="bc-btn bc-btn--primary" @click="bit.nextStep()">
            {{ step.clickToAdvance && rect ? 'Skip this' : 'Next' }}
          </button>
        </div>
      </div>
    </div>

    <!-- Bit mid-leap from the setup wizard to the tour bubble -->
    <div v-if="flight" ref="flyEl" class="bc-fly" :style="{ left: flight.x + 'px', top: flight.y + 'px', width: flight.w + 'px' }"><BitMascot :size="flight.w" mood="happy" :animated="false" /></div>

    <!-- ── Username reminder: Bit pops up in the corner ─────────────────── -->
    <transition name="bc-pop">
      <div v-if="bit.reminderOpen && !bit.tourActive" class="bc-reminder" role="status">
        <BitMascot :size="44" :mood="bit.reminderKind === 'pending' ? 'alert' : 'wave'" />
        <div class="bc-reminder__main">
          <p class="bc-reminder__text">{{ bit.reminderLine }}</p>
          <div class="bc-actions">
            <button class="bc-btn" @click="bit.snoozeReminder()">{{ bit.reminderKind === 'pending' ? "It's me" : 'Later' }}</button>
            <button class="bc-btn bc-btn--primary" @click="claimNow(false)">{{ reminderCta }}</button>
          </div>
        </div>
      </div>
    </transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import BitMascot from './BitMascot.vue';
import NavIcon from './NavIcon.vue';
import { useBitStore } from '../stores/bitStore';

const bit    = useBitStore();
const route  = useRoute();
const router = useRouter();

const step = computed(() => bit.currentStep);

// Bit leaps in from the setup wizard: start rect handed over via sessionStorage.
const flight = ref<{ x: number; y: number; w: number } | null>(null);
const flyEl = ref<HTMLElement | null>(null);
const bubbleBit = ref<HTMLElement | null>(null);
function takeFlight() {
  try {
    const raw = sessionStorage.getItem('interpoll_bit_flight');
    sessionStorage.removeItem('interpoll_bit_flight');
    if (raw) flight.value = JSON.parse(raw);
  } catch { flight.value = null; }
}
async function playFlight() {
  if (!flight.value) return;
  await nextTick();
  await new Promise(r => setTimeout(r, 80)); // let the bubble lay out before measuring
  const to = bubbleBit.value?.getBoundingClientRect();
  const el = flyEl.value;
  if (!to || !el) { flight.value = null; return; }
  const f = flight.value;
  const dx = to.left - f.x, dy = to.top - f.y, s = to.width / f.w;
  const anim = el.animate([
    { transform: 'translate(0,0) scale(1)', offset: 0 },
    { transform: `translate(${dx * 0.5}px, ${Math.min(0, dy) - 90}px) scale(${(1 + s) / 2})`, offset: 0.5 },
    { transform: `translate(${dx}px, ${dy}px) scale(${s})`, offset: 1 },
  ], { duration: 780, easing: 'cubic-bezier(.3,.1,.3,1)', fill: 'forwards' });
  anim.onfinish = () => { flight.value = null; };
}
watch(() => bit.tourActive, async (active) => {
  if (active && flight.value) { try { await playFlight(); } catch { flight.value = null; } }
});
const rect = ref<DOMRect | null>(null);

// Pages where a popup would be rude or pointless.
const QUIET_PATHS = ['/claim-username', '/onboarding', '/auth/callback'];
const onQuietPage = () => QUIET_PATHS.some(p => route.path.startsWith(p));

function findTarget(id?: string): HTMLElement | null {
  if (!id) return null;
  for (const el of Array.from(document.querySelectorAll<HTMLElement>(`[data-tour="${id}"]`))) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && el.offsetParent !== null) return el;
  }
  return null;
}

let raf = 0;
function track() {
  const el = findTarget(step.value?.target);
  if (el) {
    const r = el.getBoundingClientRect();
    const prev = rect.value;
    if (!prev || prev.x !== r.x || prev.y !== r.y || prev.width !== r.width || prev.height !== r.height) rect.value = r;
  } else if (rect.value) rect.value = null;
  raf = requestAnimationFrame(track);
}

const PAD = 6;
const ringStyle = computed(() => {
  const r = rect.value!;
  return { left: `${r.left - PAD}px`, top: `${r.top - PAD}px`, width: `${r.width + PAD * 2}px`, height: `${r.height + PAD * 2}px` };
});

const BUBBLE_W = 320;
const bubbleStyle = computed(() => {
  const r = rect.value;
  if (!r) return {};
  const vw = window.innerWidth, vh = window.innerHeight;
  const w = Math.min(BUBBLE_W, vw - 24);
  // Prefer to the right of the target (desktop side nav); otherwise above/below it (mobile bottom nav).
  if (r.right + 16 + w <= vw) {
    const top = Math.min(Math.max(12, r.top - 8), vh - 260);
    return { left: `${r.right + 16}px`, top: `${top}px`, width: `${w}px` };
  }
  const left = Math.min(Math.max(12, r.left + r.width / 2 - w / 2), vw - w - 12);
  if (r.top > vh / 2) return { left: `${left}px`, bottom: `${vh - r.top + 16}px`, width: `${w}px` };
  return { left: `${left}px`, top: `${r.bottom + 16}px`, width: `${w}px` };
});

// Interactive: clicking the highlighted element advances the tour (the click itself is not blocked).
function onDocClick(e: MouseEvent) {
  const s = step.value;
  if (!bit.tourActive || !s?.clickToAdvance || !s.target) return;
  const t = e.target as Element | null;
  if (t?.closest(`[data-tour="${s.target}"]`)) window.setTimeout(() => bit.nextStep(), 250);
}
function onKey(e: KeyboardEvent) {
  if (bit.tourActive && e.key === 'Escape') bit.finishTour();
}

const reminderCta = computed(() => bit.reminderKind === 'pending' ? 'Review' : bit.reminderKind === 'recovery' ? 'Set up recovery' : 'Claim username');

function claimNow(fromTour: boolean) {
  if (fromTour) { bit.finishTour(); void router.push('/claim-username'); return; }
  const kind = bit.reminderKind;
  bit.acceptReminder();
  void router.push(kind === 'username' ? '/claim-username' : '/settings#name-recovery');
}

let tick: number | undefined;
let lastNameCheck = 0;
async function checkReminder() {
  if (document.hidden || onQuietPage()) return;
  await bit.refreshUsername();
  // Name status needs a network read, so refresh it on a slower cadence than the 15 s tick.
  if (bit.hasUsername && Date.now() - lastNameCheck > 5 * 60_000) { lastNameCheck = Date.now(); await bit.refreshNameInfo(); }
  const kind = bit.dueKind();
  if (kind) bit.showReminder(kind);
}

// A reminder that nobody reacts to counts as "later" so it doesn't nag.
let autoHide: number | undefined;
watch(() => bit.reminderOpen, (open) => {
  window.clearTimeout(autoHide);
  if (open) autoHide = window.setTimeout(() => bit.reminderOpen && bit.snoozeReminder(), 20_000);
});
// Landing on the claim page (or finishing it) closes any open reminder.
watch(() => route.path, () => {
  if (bit.reminderOpen && onQuietPage()) bit.acceptReminder();
  // Setup wizard finished → hand over to the tour once the feed has painted.
  if (!bit.tourDone && !bit.tourActive && route.path.startsWith('/home')) {
    takeFlight(); // Bit hangs in mid-air until the tour bubble is ready to catch him
    window.setTimeout(() => { if (!bit.tourDone && !bit.tourActive && !onQuietPage()) bit.startTour(); }, 1200);
  }
});

onMounted(() => {
  document.addEventListener('click', onDocClick, true);
  window.addEventListener('keydown', onKey);
  raf = requestAnimationFrame(track);

  void bit.refreshUsername();
  if (!bit.tourDone) takeFlight();
  if (!bit.tourDone) {
    // Wait for the feed to paint so the nav targets exist.
    window.setTimeout(() => {
      if (!bit.tourDone && !bit.tourActive && !onQuietPage()) bit.startTour();
    }, 1500);
  }
  tick = window.setInterval(checkReminder, 15_000);

  // Accounts that finished the tour before the bottom-bar step existed see just that step once.
  if (bit.tourDone) {
    window.setTimeout(() => {
      if (bit.shouldOfferNavTour() && !bit.tourActive && !onQuietPage() && findTarget('bottom-nav')) bit.startNavTour();
    }, 3000);
  }
});
onUnmounted(() => {
  document.removeEventListener('click', onDocClick, true);
  window.removeEventListener('keydown', onKey);
  cancelAnimationFrame(raf);
  window.clearInterval(tick);
  window.clearTimeout(autoHide);
});
</script>

<style scoped>
.bc-tour { position: fixed; inset: 0; z-index: 2147483600; pointer-events: none; }
.bc-dim { position: absolute; inset: 0; background: rgba(0, 0, 0, 0.78); }
.bc-ring {
  position: absolute; border-radius: 8px; border: 1px solid var(--app-accent);
  box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.78), 0 0 0 3px rgba(var(--app-accent-rgb), 0.25);
  transition: left 220ms cubic-bezier(.16, 1, .3, 1), top 220ms cubic-bezier(.16, 1, .3, 1),
              width 220ms cubic-bezier(.16, 1, .3, 1), height 220ms cubic-bezier(.16, 1, .3, 1);
  animation: bc-pulse 1.8s ease-in-out infinite;
}
@keyframes bc-pulse { 50% { box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.78), 0 0 0 7px rgba(var(--app-accent-rgb), 0.12); } }

.bc-bubble, .bc-reminder {
  position: absolute; pointer-events: auto;
  background: var(--app-bg-elevated); color: var(--app-text);
  border: 1px solid var(--app-accent); border-radius: 8px;
  padding: 14px 16px;
  font-family: inherit;
}
.bc-bubble:not(.bc-bubble--center) { transition: left 340ms cubic-bezier(.16,1,.3,1), top 340ms cubic-bezier(.16,1,.3,1), bottom 340ms cubic-bezier(.16,1,.3,1); }
.bc-bit { display: inline-flex; animation: bc-jump 420ms cubic-bezier(.3,0,.5,1); }
.bc-bit--hidden { visibility: hidden; animation: none; }
@keyframes bc-jump { 0% { transform: translateY(0); } 45% { transform: translateY(-16px); } 100% { transform: translateY(0); } }
.bc-fly { animation: bc-hang 700ms ease-in-out infinite alternate; position: fixed;
}
@keyframes bc-hang { to { margin-top: -6px; } }
.bc-fly-x { position: fixed; z-index: 2147483650; pointer-events: none; image-rendering: pixelated; }
.bc-bubble--center { left: 50%; top: 50%; transform: translate(-50%, -50%); width: min(360px, calc(100vw - 24px)); }
.bc-head { display: flex; align-items: center; gap: 12px; }
.bc-titles { display: flex; flex-direction: column; min-width: 0; }
.bc-title { font-size: 16px; font-weight: 500; line-height: 1.25; }
.bc-count { font-size: 12px; color: var(--app-text-muted); font-family: var(--font-mono, monospace); }
.bc-body { margin: 10px 0 0; font-size: 14px; line-height: 1.5; color: var(--app-text); }
.bc-hint { margin: 8px 0 0; font-size: 12.5px; color: var(--app-accent); }
.bc-dots { display: flex; gap: 4px; margin-top: 12px; }
.bc-dot { width: 14px; height: 3px; background: var(--app-border); border-radius: 2px; }
.bc-dot.on { background: var(--app-accent); }

.bc-actions { display: flex; align-items: center; gap: 8px; margin-top: 12px; }
.bc-spacer { flex: 1; }
.bc-btn {
  font: inherit; font-size: 13px; font-weight: 500; cursor: pointer;
  padding: 7px 12px; border-radius: 5px; background: transparent; color: var(--app-text);
  border: 1px solid var(--app-border-strong); box-shadow: none;
}
.bc-btn:hover { border-color: var(--app-accent); }
.bc-btn--ghost { border-color: transparent; color: var(--app-text-muted); padding-left: 0; }
.bc-btn--ghost:hover { color: var(--app-text); border-color: transparent; }
.bc-btn--primary { background: var(--app-accent); border-color: var(--app-accent); color: #fff; }
.bc-btn--primary:hover { background: var(--app-accent-bright); }

.bc-reminder {
  position: fixed; right: 20px; bottom: 20px; width: min(340px, calc(100vw - 24px));
  display: flex; gap: 12px; align-items: flex-start; z-index: 2147483500;
}
@media (max-width: 767px) { .bc-reminder { bottom: calc(84px + env(safe-area-inset-bottom)); right: 12px; } }
.bc-reminder__main { min-width: 0; }
.bc-reminder__text { margin: 0; font-size: 14px; line-height: 1.45; }
.bc-reminder .bc-actions { margin-top: 10px; }

.bc-pop-enter-active, .bc-pop-leave-active { transition: opacity 180ms ease, transform 180ms steps(4); }
.bc-pop-enter-from, .bc-pop-leave-to { opacity: 0; transform: translateY(12px); }
@media (prefers-reduced-motion: reduce) {
  .bc-ring { animation: none; transition: none; }
  .bc-bit { animation: none; }
  .bc-bubble:not(.bc-bubble--center) { transition: none; }
  .bc-pop-enter-active, .bc-pop-leave-active { transition: none; }
}

.bc-demo { margin: 10px 0 4px; }
.bc-demo-bar { position: relative; height: 52px; border-radius: 12px; background: var(--app-item-surface); border: 1px solid var(--app-border); overflow: hidden; }
.bc-demo-tab { position: absolute; top: 0; bottom: 0; left: calc(var(--i) * 25%); width: 25%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; font-size: 9px; font-weight: 600; color: var(--app-text-muted); }
.bc-demo-tab :deep(svg) { width: 20px; height: 20px; }
.bc-demo-tab--a { animation: bc-a 3.6s ease-in-out infinite; z-index: 2; color: var(--app-text); }
.bc-demo-tab--b { animation: bc-b 3.6s ease-in-out infinite; }
.bc-demo-finger { position: absolute; top: 22px; left: 12%; width: 18px; height: 18px; margin-left: -9px; border-radius: 50%; background: var(--app-text-muted); box-shadow: 0 0 0 6px rgba(255,255,255,.12); animation: bc-f 3.6s ease-in-out infinite; z-index: 3; }
@keyframes bc-a { 0%,25% { transform: translateX(0) scale(1); } 35% { transform: translateX(0) scale(1.15); } 70%,100% { transform: translateX(200%) scale(1); } }
@keyframes bc-b { 0%,35% { transform: translateX(0); } 70%,100% { transform: translateX(-200%); } }
@keyframes bc-f { 0% { left: 12%; opacity: 0; } 10% { opacity: 1; } 25%,35% { left: 12%; } 70%,90% { left: 62%; opacity: 1; } 100% { left: 62%; opacity: 0; } }
.bc-demo-cap { display: block; margin-top: 6px; text-align: center; font-size: 11px; color: var(--app-text-muted); }
@media (prefers-reduced-motion: reduce) { .bc-demo-tab--a, .bc-demo-tab--b, .bc-demo-finger { animation: none; } }

.bc-bubble, .bc-reminder { border-radius: 14px; box-sizing: border-box; }
.bc-btn { min-height: 44px; }
.bc-btn:focus-visible { outline: 2px solid var(--app-accent); outline-offset: 3px; }
.bc-demo-finger { background: var(--app-border-strong); }
</style>
