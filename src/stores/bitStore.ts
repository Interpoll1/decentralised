// src/stores/bitStore.ts
// Bit the frog: first-boot tour state + "claim your username" reminders.
// Device-local UI state only (localStorage) — never replicated.
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { UserService } from '../services/userService';

const TOUR_KEY   = 'interpoll_bit_tour_v1';
const NAV_STEP_KEY = 'interpoll_bit_navswap_v1';
const REMIND_KEY = 'interpoll_bit_remind_v1';
const REMIND_RECOVERY_KEY = 'interpoll_bit_remind_recovery_v1';
const PENDING_GAP_MS = 3 * 60 * 60 * 1000; // re-show a pending-recovery warning at most every 3 h

/** Escalating quiet periods after each dismissal: 10m, 30m, 2h, 6h, then daily. */
const BACKOFF_MS = [10, 30, 120, 360, 1440].map(m => m * 60_000);
const FIRST_REMINDER_MS = 90_000;

export interface TourStep {
  id: string;
  /** data-tour attribute of the element to spotlight; absent/hidden → centred bubble. */
  target?: string;
  title: string;
  body: string;
  /** Used instead of `target` on phones, where the desktop element doesn't exist. */
  mobileTarget?: string;
  /** When true the user must click the highlighted element (Next is still offered as a fallback). */
  clickToAdvance?: boolean;
  mood?: 'idle' | 'happy' | 'wave' | 'alert';
}

export const BASE_TOUR_STEPS: TourStep[] = [
  { id: 'hi', title: 'Hi, I\'m Bit', mood: 'wave',
    body: 'Two minutes, no tab-by-tab walkthrough — I\'ll only point out the things people usually miss. Nothing here is run by a company: your posts and votes live on peers, signed by a key only you hold.' },
  { id: 'scopes', target: 'feed-scopes', title: 'Choose what you see', mood: 'idle',
    body: 'My Spaces, This Relay, Explore and Nearby change where posts come from. Explore is the widest; Nearby only shows people around you (and only if you opt in).' },
  { id: 'search', target: 'search', title: 'Search finds spaces too', mood: 'happy',
    body: 'Posts, polls and spaces by name. On a computer, just click the bar — results open right away as you type.' },
  { id: 'relay', target: 'relay', mobileTarget: 'network', title: 'Check your connection', mood: 'idle',
    body: 'The little dot shows whether your relay is reachable. Open it to see peers, switch relays or add your own — handy when something won\'t load.' },
  { id: 'map', target: 'orbit', title: 'See who\'s around', mood: 'happy',
    body: 'Orbit\'s Map shows people, meetups and spaces near you, down to the whole world. It\'s opt-in: you pick how rough your area is, and nothing is shared until you turn it on.' },
  { id: 'username', target: 'profile', mobileTarget: 'settings', title: 'Pick a username', mood: 'alert',
    body: 'Until you do, people see a random name like "swift-bridge-vulture". Claiming one takes ten seconds — find it in your profile menu.' },
];

/** Bottom bar only exists on phones (< 768px), so this step is mobile-only. */
const NAV_STEP: TourStep = {
  id: 'navswap', target: 'bottom-nav', title: 'Make the tabs yours', mood: 'happy',
  body: 'Tap a tab to open it. To reorder, hold a tab and drag it onto another — they swap places. The first tab is where the app opens.',
};
const isNarrow = () => typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches;
function navStepSeen(): boolean { try { return localStorage.getItem(NAV_STEP_KEY) !== null; } catch { return true; } }
function markNavStepSeen() { try { localStorage.setItem(NAV_STEP_KEY, '1'); } catch { /* ignore */ } }

const BACKUP_STEP: TourStep = {
  id: 'backup', target: 'settings', title: 'Back up your key', mood: 'alert',
  body: 'Your recovery phrase is the only way back into this identity. Open Settings → Cryptographic Identity → Recovery phrase and save it somewhere safe.',
};
const PHRASE_SAVED_KEY = 'interpoll_phrase_saved';
export function phraseSaved(): boolean { try { return localStorage.getItem(PHRASE_SAVED_KEY) === 'true'; } catch { return false; } }
/** Tour steps for this device: if the setup wizard never saved a phrase, nudge toward Settings before the username step. */
export function buildTourSteps(): TourStep[] {
  const steps = BASE_TOUR_STEPS.map(st => (isNarrow() && st.mobileTarget ? { ...st, target: st.mobileTarget } : st));
  if (isNarrow()) steps.splice(1, 0, NAV_STEP);   // 2nd, phones only
  if (phraseSaved()) return steps;
  steps.splice(steps.length - 1, 0, BACKUP_STEP);
  return steps;
}

export type ReminderKind = 'username' | 'recovery' | 'pending';

export const REMINDER_LINES = [
  'Psst — you still don\'t have a username. Want to claim one?',
  'People can\'t find you by name yet. Claim a username?',
  'Your name is still a random one. Pick your own, it takes ten seconds.',
  'Ribbit! A username makes your posts easier to recognise.',
];

interface RemindState { dismissals: number; lastShown: number; }

function readJSON<T>(key: string, fallback: T): T {
  try { const raw = localStorage.getItem(key); return raw ? { ...fallback, ...JSON.parse(raw) } : fallback; } catch { return fallback; }
}

export const useBitStore = defineStore('bit', () => {
  const tourDone     = ref(localStorage.getItem(TOUR_KEY) === 'done');
  const tourActive   = ref(false);
  const tourStepIdx  = ref(0);
  const hasUsername  = ref<boolean | null>(null);   // null = not checked yet
  const reminderOpen = ref(false);
  const reminderLine = ref(REMINDER_LINES[0]);
  const remind       = ref<RemindState>(readJSON<RemindState>(REMIND_KEY, { dismissals: 0, lastShown: 0 }));
  const sessionStart = Date.now();

  // Name recovery (IPP-10): what the network says about this device's username.
  const reminderKind = ref<ReminderKind>('username');
  const nameInfo = ref<{ username: string; isHolder: boolean; hasRecovery: boolean; legacyUnsigned: boolean; pendingDays: number | null } | null>(null);
  const remindRecovery = ref<RemindState>(readJSON<RemindState>(REMIND_RECOVERY_KEY, { dismissals: 0, lastShown: 0 }));
  let pendingShownAt = 0;
  function saveRecoveryRemind() { try { localStorage.setItem(REMIND_RECOVERY_KEY, JSON.stringify(remindRecovery.value)); } catch { /* private mode */ } }

  const steps = ref<TourStep[]>(buildTourSteps());
  const currentStep = computed(() => steps.value[tourStepIdx.value]);
  const isLastStep  = computed(() => tourStepIdx.value === steps.value.length - 1);

  function saveRemind() { try { localStorage.setItem(REMIND_KEY, JSON.stringify(remind.value)); } catch { /* private mode */ } }

  async function refreshUsername(): Promise<boolean> {
    try {
      const me = await UserService.getCurrentUser();
      hasUsername.value = !!(me && me.customUsername);
    } catch { /* leave as-is; try again next tick */ }
    return hasUsername.value === true;
  }

  function startTour() { steps.value = buildTourSteps(); tourStepIdx.value = 0; tourActive.value = true; reminderOpen.value = false; }
  /** Established mobile accounts get the bottom-bar step once; new accounts get it inside the full tour. */
  function shouldOfferNavTour() { return isNarrow() && !navStepSeen(); }
  function startNavTour() {
    steps.value = [NAV_STEP]; tourStepIdx.value = 0; tourActive.value = true; reminderOpen.value = false;
  }
  function finishTour() {
    if (steps.value.some(s => s.id === 'navswap') && tourStepIdx.value >= steps.value.findIndex(s => s.id === 'navswap')) markNavStepSeen();
    tourActive.value = false; tourDone.value = true;
    try { localStorage.setItem(TOUR_KEY, 'done'); } catch { /* ignore */ }
    // Give the user a breather before the first reminder.
    remind.value.lastShown = Date.now(); saveRemind();
  }
  function nextStep() { if (isLastStep.value) finishTour(); else tourStepIdx.value++; }
  function prevStep() { if (tourStepIdx.value > 0) tourStepIdx.value--; }
  function replayTour() { try { localStorage.removeItem(TOUR_KEY); } catch { /* ignore */ } tourDone.value = false; startTour(); }

  async function refreshNameInfo(): Promise<void> {
    try {
      const me = await UserService.getCurrentUser();
      if (!me?.customUsername) { nameInfo.value = null; return; }
      const { NameRecoveryService } = await import('../services/nameRecoveryService');
      const st = await NameRecoveryService.status(me.customUsername);
      nameInfo.value = {
        username: st.username, isHolder: st.isHolder, hasRecovery: st.hasRecovery,
        legacyUnsigned: st.legacyUnsigned, pendingDays: st.pendingAgainstMe ? st.pendingAgainstMe.days : null,
      };
    } catch { /* offline — keep the last known info */ }
  }

  function backoff(r: RemindState): number { return BACKOFF_MS[Math.min(r.dismissals, BACKOFF_MS.length - 1)]; }

  /** Which reminder, if any, should pop up right now? Pure timing check; the caller adds route/UI guards. */
  function dueKind(now = Date.now()): ReminderKind | null {
    if (!tourDone.value || tourActive.value || reminderOpen.value) return null;
    if (now - sessionStart < FIRST_REMINDER_MS) return null;
    const n = nameInfo.value;
    // 1. Someone is trying to move your name: most urgent, ignores the normal backoff.
    if (n && n.isHolder && n.pendingDays !== null && now - pendingShownAt >= PENDING_GAP_MS) return 'pending';
    // 2. No username yet.
    if (hasUsername.value === false && now - remind.value.lastShown >= backoff(remind.value)) return 'username';
    // 3. Has a username but no way back if the device is lost.
    if (n && n.isHolder && !n.hasRecovery && !n.legacyUnsigned && now - remindRecovery.value.lastShown >= backoff(remindRecovery.value)) return 'recovery';
    return null;
  }
  function reminderDue(now = Date.now()): boolean { return dueKind(now) !== null; }

  function showReminder(kind: ReminderKind = 'username') {
    reminderKind.value = kind;
    const n = nameInfo.value;
    if (kind === 'pending') {
      const d = n?.pendingDays ?? 0;
      reminderLine.value = `Heads up: someone started recovering "${n?.username}" onto another key. It moves in ${d} ${d === 1 ? 'day' : 'days'} unless you cancel. Is that you?`;
      pendingShownAt = Date.now();
    } else if (kind === 'recovery') {
      reminderLine.value = `"${n?.username}" has no recovery key. If you lose this device, the name is gone for good. Set one up?`;
      remindRecovery.value.lastShown = Date.now(); saveRecoveryRemind();
    } else {
      reminderLine.value = REMINDER_LINES[remind.value.dismissals % REMINDER_LINES.length];
      remind.value.lastShown = Date.now(); saveRemind();
    }
    reminderOpen.value = true;
  }
  function snoozeReminder() {
    reminderOpen.value = false;
    if (reminderKind.value === 'recovery') { remindRecovery.value.dismissals++; remindRecovery.value.lastShown = Date.now(); saveRecoveryRemind(); }
    else if (reminderKind.value === 'username') { remind.value.dismissals++; remind.value.lastShown = Date.now(); saveRemind(); }
    else pendingShownAt = Date.now();
  }
  function acceptReminder() {
    reminderOpen.value = false;
    if (reminderKind.value === 'recovery') { remindRecovery.value.lastShown = Date.now(); saveRecoveryRemind(); }
    else if (reminderKind.value === 'username') { remind.value.lastShown = Date.now(); saveRemind(); }
    else pendingShownAt = Date.now();
  }

  return {
    steps, tourDone, tourActive, tourStepIdx, currentStep, isLastStep,
    hasUsername, reminderOpen, reminderLine, reminderKind, nameInfo,
    refreshUsername, refreshNameInfo, startTour, startNavTour, shouldOfferNavTour, finishTour, nextStep, prevStep, replayTour,
    reminderDue, dueKind, showReminder, snoozeReminder, acceptReminder,
  };
});