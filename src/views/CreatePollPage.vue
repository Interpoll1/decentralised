<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <button class="back-btn" @click="router.back()">
            <svg viewBox="0 0 24 24" fill="none"><path d="M15 18l-6-6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </ion-buttons>
        <ion-title>Create Poll</ion-title>
        <ion-buttons slot="end">
          <button class="submit-btn" @click="createPoll" :disabled="!isValid || isSubmitting">
            <div v-if="isSubmitting" class="btn-spinner"></div>
            {{ isSubmitting ? 'Posting…' : 'Post' }}
          </button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <DesktopPageShell>
      <div class="create-page">

        <div v-if="isSubmittingSlow" class="slow-banner">
          <ion-icon :icon="timeOutline"></ion-icon>
          Still publishing to the network — this can take a few extra seconds on a slow relay.
        </div>

        <div class="create-hero">
          <p class="hero-label">New poll</p>
          <h1 class="hero-title">Ask your community</h1>
          <p class="hero-sub">Create a structured question with up to 10 options, optional vote verification, and privacy controls.</p>
        </div>

        <div class="form-card">

          <!-- Community picker -->
          <div class="field-group">
            <label class="field-label">Community</label>
            <button class="community-picker" @click="showCommunityPicker">
              <span class="picker-avatar-wrap" v-if="selectedCommunity">
                <span class="picker-mini-avatar" :class="avatarTone(selectedCommunity.id)">
                  {{ (selectedCommunity.displayName || selectedCommunity.name || 'C').charAt(0).toUpperCase() }}
                </span>
              </span>
              <span :class="selectedCommunity ? 'picker-selected' : 'picker-placeholder'">
                {{ selectedCommunity ? selectedCommunity.displayName : 'Select a community' }}
              </span>
              <ion-icon :icon="chevronDownOutline"></ion-icon>
            </button>
            <p v-if="selectedCommunity" class="field-sub">{{ selectedCommunity.id }}</p>
          </div>

          <CommunityPickerModal
            v-model="pickerOpen"
            :communities="joinedCommunities"
            :selected="selectedCommunity"
            title="Post poll to…"
            @pick="c => selectedCommunity = c"
          />

          <!-- Question -->
          <div class="field-group">
            <label class="field-label">Question <span class="required">*</span></label>
            <div class="field-wrap">
              <input class="field-native" v-model="question" placeholder="What would you like to ask?" :maxlength="200" />
            </div>
            <p class="field-count">{{ question.length }}/200</p>
          </div>

          <!-- Description -->
          <div class="field-group">
            <label class="field-label">Description <span class="optional">optional</span></label>
            <div class="field-wrap">
              <textarea class="field-native" v-model="description" placeholder="Add more context to your poll…" rows="3" :maxlength="500"></textarea>
            </div>
            <p class="field-count">{{ description.length }}/500</p>
          </div>

        </div>

        <!-- Options card -->
        <div class="form-card">
          <div class="card-section-label">
            <ion-icon :icon="listOutline"></ion-icon>
            Poll Options
            <span class="count-chip">{{ options.length }}/10</span>
          </div>

          <div class="options-list">
            <div v-for="(option, index) in options" :key="option.id" class="option-row">
              <span class="option-num">{{ index + 1 }}</span>
              <div class="field-wrap flex1">
                <input class="field-native" v-model="options[index].text" :placeholder="`Option ${index + 1}`" :maxlength="100" />
              </div>
              <button v-if="options.length > 2" class="icon-btn danger" @click="removeOption(index)" title="Remove">
                <ion-icon :icon="closeCircleOutline"></ion-icon>
              </button>
            </div>
          </div>

          <button class="add-option-btn" @click="addOption" :disabled="options.length >= 10">
            <svg viewBox="0 0 24 24" fill="none" width="15" height="15"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>
            Add Option
          </button>
        </div>

        <!-- Settings card -->
        <div class="form-card">
          <div class="card-section-label">
            <ion-icon :icon="settingsOutline"></ion-icon>
            Settings
          </div>

          <!-- Duration -->
          <div class="field-group">
            <label class="field-label">Duration</label>
            <div class="field-wrap select-wrap">
              <select class="field-native" v-model="duration">
                <option value="1">1 Day</option>
                <option value="3">3 Days</option>
                <option value="7">7 Days</option>
                <option value="14">14 Days</option>
                <option value="30">30 Days</option>
              </select>
              <svg class="select-chevron" viewBox="0 0 24 24" fill="none">
                <path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </div>
          </div>

          <!-- Toggles -->
          <div class="toggle-row">
            <div>
              <div class="toggle-label">Allow multiple choices</div>
              <div class="toggle-sub">Voters can select more than one option</div>
            </div>
            <label class="toggle-switch">
              <input type="checkbox" v-model="allowMultipleChoices" />
              <span class="toggle-track"></span>
            </label>
          </div>

          <div class="toggle-row">
            <div>
              <div class="toggle-label">Show results before voting</div>
              <div class="toggle-sub">Voters see the current results before casting a vote</div>
            </div>
            <label class="toggle-switch">
              <input type="checkbox" v-model="showResultsBeforeVoting" />
              <span class="toggle-track"></span>
            </label>
          </div>

          <div class="toggle-row">
            <div>
              <div class="toggle-label">Private poll</div>
              <div class="toggle-sub">Only people with an invite code can vote</div>
            </div>
            <label class="toggle-switch">
              <input type="checkbox" v-model="isPrivate" />
              <span class="toggle-track"></span>
            </label>
          </div>

          <div v-if="isPrivate" class="info-box">
            <ion-icon :icon="lockClosedOutline"></ion-icon>
            <p>Each invite code can be used once. You will receive the codes after creating the poll.</p>
          </div>

          <div v-if="isPrivate" class="field-group">
            <label class="field-label">Number of invite codes</label>
            <div class="field-wrap">
              <input class="field-native" type="number" v-model.number="inviteCodeCount" min="1" max="200" placeholder="20" />
            </div>
          </div>
        </div>

        <!-- Verification card -->
        <div class="form-card">
          <div class="card-section-label">
            <ion-icon :icon="shieldCheckmarkOutline"></ion-icon>
            Vote Verification
          </div>

          <div class="field-group">
            <label class="field-label">Verification tier</label>
            <div class="field-wrap select-wrap">
              <select class="field-native" v-model="requiredTier">
                <option value="open">Open — anyone (no verification)</option>
                <option value="pow">Proof-of-work — costs each voter some CPU</option>
                <option value="relay">Relay-attested — one device / login</option>
                <option value="issuer">Verified identity — issuer-certified</option>
              </select>
              <svg class="select-chevron" viewBox="0 0 24 24" fill="none">
                <path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </div>
          </div>

          <div v-if="requiredTier !== 'open'" class="toggle-row">
            <div>
              <div class="toggle-label">Exclude unverified votes from main result</div>
              <div class="toggle-sub">Unverified votes are still counted in a separate "Open" tally</div>
            </div>
            <label class="toggle-switch">
              <input type="checkbox" v-model="gateSubTierVotes" />
              <span class="toggle-track"></span>
            </label>
          </div>

          <div v-if="requiredTier !== 'open'" class="info-box">
            <ion-icon :icon="informationCircleOutline"></ion-icon>
            <p>Anyone can still vote without verifying — those votes appear in a separate "Open" result{{ gateSubTierVotes ? ', kept out of the main "Verified" tally' : ' alongside the "Verified" tally' }}.</p>
          </div>
        </div>

      </div>
      </DesktopPageShell>
    </ion-content>
  </ion-page>
</template>

<style scoped>
ion-header::after { display: none !important; }
ion-toolbar { --border-width: 0 !important; }
ion-content { --background: transparent; }

:deep(.surface-card), :deep(.main-content), :deep(.page-layout) {
  background: transparent !important; box-shadow: none !important; border: none !important;
}

.back-btn {
  display: flex; align-items: center; justify-content: center;
  width: 36px; height: 36px; background: none; border: none;
  border-radius: 50%; color: var(--app-text-muted); cursor: pointer;
  margin-left: 4px; transition: color 160ms ease;
}
.back-btn:hover { color: var(--app-text); }
.back-btn svg { width: 22px; height: 22px; }

.submit-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 7px 18px; border-radius: 999px; border: none;
  background: linear-gradient(135deg,#6366f1,#8b5cf6); color: #fff;
  font-size: 13.5px; font-weight: 700; cursor: pointer;
  box-shadow: 0 4px 14px rgba(99,102,241,.38);
  transition: opacity 160ms, transform 160ms; margin-right: 8px;
}
.submit-btn:hover:not(:disabled) { opacity: .9; transform: translateY(-1px); }
.submit-btn:disabled { opacity: .38; cursor: not-allowed; }

.btn-spinner { width: 15px; height: 15px; border: 2px solid rgba(255,255,255,.3); border-top-color: #fff; border-radius: 50%; animation: spin .7s linear infinite; flex-shrink: 0; }
@keyframes spin { to { transform: rotate(360deg); } }

.create-page { max-width: 720px; margin: 0 auto; padding: 20px 16px 60px; display: flex; flex-direction: column; gap: 16px; }

.slow-banner { display: flex; align-items: center; gap: 10px; padding: 11px 14px; border-radius: 12px; background: rgba(251,191,36,.1); border: 1px solid rgba(251,191,36,.28); color: #fbbf24; font-size: 13px; line-height: 1.5; }
.slow-banner ion-icon { font-size: 16px; flex-shrink: 0; }

.create-hero { padding-top: 4px; }
.hero-label { font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .1em; color: #818cf8; margin: 0 0 8px; }
.hero-title {
  margin: 0 0 8px; font-size: 26px; font-weight: 800; letter-spacing: -.03em; line-height: 1.2;
  background: linear-gradient(135deg, var(--app-text) 60%, rgba(167,139,250,.85));
  -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent;
}
.hero-sub { margin: 0; font-size: 13.5px; color: var(--app-text-muted); line-height: 1.6; }

.form-card { border-radius: 20px; background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.09); padding: 20px 22px; display: flex; flex-direction: column; gap: 16px; }

.card-section-label { display: flex; align-items: center; gap: 8px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; color: var(--app-text-subtle); }
.card-section-label ion-icon { font-size: 15px; }
.count-chip { margin-left: auto; padding: 2px 8px; border-radius: 999px; background: rgba(99,102,241,.12); color: #818cf8; border: 1px solid rgba(99,102,241,.22); font-size: 11px; font-weight: 700; }

.field-group { display: flex; flex-direction: column; gap: 6px; }
.field-label { font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; color: var(--app-text-subtle); }
.field-sub { font-size: 11.5px; color: var(--app-text-subtle); margin: 0; }
.required { color: #ef4444; }
.optional { font-weight: 400; text-transform: none; letter-spacing: 0; font-size: 11px; color: var(--app-text-subtle); }
.field-wrap { border-radius: 12px; background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.09); overflow: hidden; transition: border-color 180ms, box-shadow 180ms; position: relative; }
.field-wrap.flex1 { flex: 1; }
.field-wrap:focus-within { border-color: rgba(99,102,241,.5); box-shadow: 0 0 0 3px rgba(99,102,241,.1); }
.field-native { width: 100%; background: transparent; border: none; outline: none; padding: 12px 14px; font-size: 14px; font-family: inherit; color: var(--ion-text-color); -webkit-appearance: none; appearance: none; resize: none; }
.field-native::placeholder { color: var(--app-text-subtle); }
.select-wrap { display: flex; align-items: center; }
.select-wrap .field-native { padding-right: 36px; cursor: pointer; }
.select-chevron { position: absolute; right: 12px; top: 50%; transform: translateY(-50%); width: 16px; height: 16px; color: var(--app-text-subtle); pointer-events: none; }
.field-native option { background: #1a1a2e; color: #fff; }
.field-count { font-size: 11px; color: var(--app-text-subtle); text-align: right; margin: 0; }

.community-picker { width: 100%; display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-radius: 12px; background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.09); cursor: pointer; transition: border-color 180ms, box-shadow 180ms; }
.community-picker:hover { border-color: rgba(99,102,241,.4); }
.community-picker ion-icon { color: var(--app-text-subtle); font-size: 16px; flex-shrink: 0; margin-left: auto; }
.picker-avatar-wrap { flex-shrink: 0; }
.picker-mini-avatar { width: 28px; height: 28px; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 800; color: #fff; }
.tone-violet { background: linear-gradient(135deg,#6366f1,#8b5cf6); }
.tone-blue   { background: linear-gradient(135deg,#3b82f6,#6366f1); }
.tone-teal   { background: linear-gradient(135deg,#14b8a6,#3b82f6); }
.tone-amber  { background: linear-gradient(135deg,#f59e0b,#ef4444); }
.tone-rose   { background: linear-gradient(135deg,#ec4899,#8b5cf6); }
.picker-selected { font-size: 14px; font-weight: 600; color: var(--app-text); flex: 1; text-align: left; }
.picker-placeholder { font-size: 14px; color: var(--app-text-subtle); flex: 1; text-align: left; }

.options-list { display: flex; flex-direction: column; gap: 8px; }
.option-row { display: flex; align-items: center; gap: 10px; }
.option-num { width: 24px; height: 24px; border-radius: 50%; background: rgba(99,102,241,.12); color: #818cf8; font-size: 11px; font-weight: 800; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.add-option-btn { display: inline-flex; align-items: center; gap: 7px; padding: 9px 16px; border-radius: 999px; border: 1px dashed rgba(99,102,241,.35); background: rgba(99,102,241,.06); color: #818cf8; font-size: 13px; font-weight: 700; cursor: pointer; transition: all 160ms; width: fit-content; }
.add-option-btn:hover:not(:disabled) { background: rgba(99,102,241,.12); border-color: rgba(99,102,241,.5); }
.add-option-btn:disabled { opacity: .35; cursor: not-allowed; }

.icon-btn { width: 32px; height: 32px; border-radius: 50%; border: none; background: rgba(255,255,255,.06); color: var(--app-text-muted); display: flex; align-items: center; justify-content: center; font-size: 16px; cursor: pointer; flex-shrink: 0; transition: background 160ms; }
.icon-btn.danger { background: rgba(239,68,68,.1); color: #ef4444; }
.icon-btn.danger:hover { background: rgba(239,68,68,.2); }

.toggle-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,.05); }
.toggle-row:last-child { border-bottom: none; }
.toggle-label { font-size: 13.5px; font-weight: 600; color: var(--app-text); }
.toggle-sub { font-size: 12px; color: var(--app-text-muted); margin-top: 2px; }
.toggle-switch { position: relative; width: 44px; height: 26px; flex-shrink: 0; }
.toggle-switch input { opacity: 0; width: 0; height: 0; }
.toggle-track { position: absolute; inset: 0; border-radius: 999px; background: rgba(255,255,255,.12); border: 1px solid rgba(255,255,255,.1); cursor: pointer; transition: background 200ms; }
.toggle-switch input:checked + .toggle-track { background: #6366f1; border-color: #6366f1; }
.toggle-track::after { content: ''; position: absolute; top: 3px; left: 3px; width: 18px; height: 18px; border-radius: 50%; background: #fff; box-shadow: 0 1px 4px rgba(0,0,0,.3); transition: transform 200ms; }
.toggle-switch input:checked + .toggle-track::after { transform: translateX(18px); }

.info-box { display: flex; align-items: flex-start; gap: 10px; padding: 12px 14px; border-radius: 12px; background: rgba(99,102,241,.07); border: 1px solid rgba(99,102,241,.18); color: #a5b4fc; font-size: 13px; line-height: 1.5; }
.info-box ion-icon { font-size: 16px; flex-shrink: 0; margin-top: 1px; }
.info-box p { margin: 0; }

@media (max-width: 576px) {
  .form-card { padding: 16px; }
  .hero-title { font-size: 22px; }
  .create-page { padding: 16px 12px 60px; }
}
</style>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import DesktopPageShell from '../components/DesktopPageShell.vue';
import { useRoute, useRouter } from 'vue-router';

// Accept communityId from both /community/:id/create-poll route params
// and legacy ?communityId query usage
const props = defineProps<{ communityId?: string }>();
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonButtons,
  IonButton,
  IonIcon,
  alertController,
  toastController
} from '@ionic/vue';
import CommunityPickerModal from '../components/CommunityPickerModal.vue';
import { chevronDownOutline, addCircleOutline, closeCircleOutline, timeOutline, listOutline, settingsOutline, shieldCheckmarkOutline, lockClosedOutline, informationCircleOutline } from 'ionicons/icons';
import { useCommunityStore } from '../stores/communityStore';
import { usePollStore } from '../stores/pollStore';
import { Community } from '../services/communityService';
import { checkContent, checkOption } from '../utils/contentGuard';

const TONES = ['tone-violet', 'tone-blue', 'tone-teal', 'tone-amber', 'tone-rose'];
function avatarTone(id: string) {
  const code = id.split('').reduce((a, ch) => a + ch.charCodeAt(0), 0);
  return TONES[code % TONES.length];
}

const POLL_DEBUG_KEY = 'interpoll_poll_debug';
type PollDebugCategory = 'create' | 'writes' | 'index' | 'ui' | 'all';

function getPollDebugCategories(): Set<string> {
  try {
    const raw = window.localStorage.getItem(POLL_DEBUG_KEY);
    if (!raw) return new Set();
    const normalized = raw.trim().toLowerCase();
    if (normalized === 'true') return new Set(['all']);
    return new Set(
      normalized
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean),
    );
  } catch {
    return new Set();
  }
}

function isPollDebugEnabled(category: PollDebugCategory): boolean {
  const categories = getPollDebugCategories();
  return categories.has('all') || categories.has(category);
}

function logPollDebug(category: PollDebugCategory, message: string, meta?: Record<string, unknown>) {
  if (!isPollDebugEnabled(category)) return;
  const prefix = `[PollCreateDebug:${category}]`;
  if (meta) {
    console.log(prefix, message, meta);
    return;
  }
  console.log(prefix, message);
}

const router = useRouter();
const route = useRoute();
const communityStore = useCommunityStore();
const pollStore = usePollStore();
type PollOptionDraft = { id: string; text: string };

function createOptionDraft(): PollOptionDraft {
  return { id: `opt-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`, text: '' };
}

const selectedCommunity = ref<Community | null>(null);
const pickerOpen = ref(false);
const question = ref('');
const options = ref<PollOptionDraft[]>([createOptionDraft(), createOptionDraft()]);
const duration = ref('7');
const allowMultipleChoices = ref(false);
const showResultsBeforeVoting = ref(false);
const description = ref('');
const isPrivate = ref(false);
const inviteCodeCount = ref(20);
// Sybil-resistance policy: which tier a vote must reach to count as "Verified",
// and whether sub-tier votes are excluded from the main tally (gate) or shown
// in a separate "Open" track (separate).
const requiredTier = ref<'open' | 'pow' | 'relay' | 'issuer'>('open');
const gateSubTierVotes = ref(false);
const isSubmitting = ref(false);
const isSubmittingSlow = ref(false);
let submitSlowTimer: ReturnType<typeof setTimeout> | null = null;

watch(isSubmitting, (submitting) => {
  if (submitSlowTimer) {
    clearTimeout(submitSlowTimer);
    submitSlowTimer = null;
  }
  isSubmittingSlow.value = false;
  if (submitting) {
    submitSlowTimer = setTimeout(() => {
      isSubmittingSlow.value = true;
    }, 3000);
  }
});

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const isValid = computed(() => {
  return (
    selectedCommunity.value !== null &&
    question.value.trim().length > 0 &&
    options.value.filter(opt => opt.text.trim().length > 0).length >= 2
  );
});

const joinedCommunities = computed(() => {
  const joined = communityStore.communities.filter(c => communityStore.isJoined(c.id));
  return joined.length > 0 ? joined : communityStore.communities;
});

async function showCommunityPicker() {
  if (communityStore.communities.length === 0) {
    const toast = await toastController.create({
      message: 'Loading communities, please wait…',
      duration: 2000,
      color: 'medium',
    });
    await toast.present();
    return;
  }
  pickerOpen.value = true;
}

function addOption() {
  if (options.value.length < 10) {
    options.value.push(createOptionDraft());
  }
}

function resetForm() {
  question.value = '';
  options.value = [createOptionDraft(), createOptionDraft()];
  duration.value = '7';
  allowMultipleChoices.value = false;
  showResultsBeforeVoting.value = false;
  description.value = '';
  isPrivate.value = false;
  inviteCodeCount.value = 20;
}

function removeOption(index: number) {
  if (options.value.length > 2) {
    options.value.splice(index, 1);
  }
}

async function createPoll() {
  const submitStartedAt = performance.now();
  if (isSubmitting.value) return;
  if (!isValid.value) {
    logPollDebug('ui', 'Submit blocked: invalid form', {
      hasCommunity: selectedCommunity.value !== null,
      questionLength: question.value.trim().length,
      validOptionCount: options.value.filter(opt => opt.text.trim().length > 0).length,
    });
    const toast = await toastController.create({
      message: 'Please select a community, add a question, and provide at least two options.',
      duration: 2500,
      color: 'warning',
    });
    await toast.present();
    return;
  }

  try {
    isSubmitting.value = true;
    // Auto-join community if user selected from fallback list (not yet joined)
    if (selectedCommunity.value && !communityStore.isJoined(selectedCommunity.value)) {
      await communityStore.joinCommunity(selectedCommunity.value);
    }

    // Spam check — question
    const qCheck = checkContent(question.value.trim(), 'title');
    if (!qCheck.ok) {
      const toast = await toastController.create({ message: `Question: ${qCheck.reason}`, duration: 2500, color: 'warning' });
      await toast.present();
      isSubmitting.value = false;
      return;
    }

    // Spam check — each option
    const validOptions = options.value.map(opt => opt.text.trim()).filter(opt => opt.length > 0);
    for (const opt of validOptions) {
      const oCheck = checkOption(opt);
      if (!oCheck.ok) {
        const toast = await toastController.create({ message: `Option "${opt.slice(0, 20)}": ${oCheck.reason}`, duration: 2500, color: 'warning' });
        await toast.present();
        isSubmitting.value = false;
        return;
      }
    }
    logPollDebug('ui', 'Prepared poll payload', {
      validOptionsCount: validOptions.length,
      hasDescription: Boolean(description.value.trim()),
      inviteCodeCount: inviteCodeCount.value,
    });

    // Create poll using pollStore
    const poll = await pollStore.createPoll({
      communityId: selectedCommunity.value!.id,
      question: question.value.trim(),
      description: description.value.trim(),
      options: validOptions,
      durationDays: parseInt(duration.value),
      allowMultipleChoices: allowMultipleChoices.value,
      showResultsBeforeVoting: showResultsBeforeVoting.value,
      requireLogin: false,
      isPrivate: isPrivate.value,
      inviteCodeCount: inviteCodeCount.value,
      voteTrustPolicy: requiredTier.value === 'open'
        ? undefined
        : { requiredTier: requiredTier.value, mode: gateSubTierVotes.value ? 'gate' : 'separate' },
    });
    logPollDebug('ui', 'pollStore.createPoll resolved', {
      pollId: poll.id,
      durationMs: Math.round(performance.now() - submitStartedAt),
    });

    // If private, copy a ready-to-share invite link and show codes
    if (isPrivate.value && (poll as any).inviteCodes?.length) {
      const codes = (poll as any).inviteCodes as string[];
      const buildVoteLink = (code: string) => {
        const routeLocation = router.resolve({
          path: `/vote/${poll.id}`,
          query: { code, communityId: poll.communityId },
        });
        return `${window.location.origin}${routeLocation.href}`;
      };
      const sampleLink = buildVoteLink(codes[0]);

      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(sampleLink);
        }
        const toast = await toastController.create({
          message: 'Private poll link copied to clipboard',
          duration: 2500,
          color: 'success'
        });
        await toast.present();
      } catch (e) {
        const toast = await toastController.create({
          message: `Private poll link: ${sampleLink}`,
          duration: 4000,
          color: 'medium'
        });
        await toast.present();
      }

      // Show full code list with statuses and copy-all option
      const codesList = `<pre style="text-align:left;white-space:pre-wrap;margin:0">${codes
        .map((c) => `${escapeHtml(c)} — unused`)
        .join('\n')}</pre>`;
      const linksList = codes.map((code) => buildVoteLink(code)).join('\n');

      const alert = await alertController.create({
        header: 'Invite Codes',
        message: codesList,
        buttons: [
          {
            text: 'Copy all links',
            handler: async () => {
              if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(linksList);
              }
            },
          },
          {
            text: 'Close',
            role: 'cancel',
          },
        ],
      });

      await alert.present();
    } else if (poll.relayConfirmed === false) {
      const toast = await toastController.create({
        message: 'Poll saved — the relay hasn\'t confirmed it yet, so publishing will keep retrying in the background.',
        duration: 4000,
        color: 'warning'
      });
      await toast.present();
    } else {
      const toast = await toastController.create({
        message: 'Poll created successfully',
        duration: 2000,
        color: 'success'
      });
      await toast.present();
    }

    const communityId = selectedCommunity.value?.id;
    resetForm();

    // Navigate to poll detail for private polls (so author can manage invite codes),
    // or community page for public polls. Replace so Back doesn't return to a
    // consumed form where a second tap would create a duplicate poll.
    if (poll.isPrivate) {
      await router.replace(`/community/${communityId}/poll/${poll.id}`);
    } else {
      await router.replace(`/community/${communityId}`);
    }
  } catch (error) {
    logPollDebug('ui', 'Submit failed', {
      error: error instanceof Error ? error.message : String(error),
      durationMs: Math.round(performance.now() - submitStartedAt),
    });
    console.error('Error creating poll:', error);
    
    const toast = await toastController.create({
      message: 'Failed to create poll',
      duration: 2000,
      color: 'danger'
    });
    await toast.present();
  } finally {
    logPollDebug('ui', 'Submit finished', {
      isSubmittingBeforeReset: isSubmitting.value,
      durationMs: Math.round(performance.now() - submitStartedAt),
    });
    isSubmitting.value = false;
  }
}

watch(
  [() => props.communityId, () => route.query.communityId, () => communityStore.communities.length],
  ([paramId, queryId]) => {
    // Prefer route param (/community/:id/create-poll), fall back to ?communityId query
    const communityId = (typeof paramId === 'string' && paramId)
      || (typeof queryId === 'string' && queryId)
      || '';
    if (!communityId) {
      selectedCommunity.value = null;
      return;
    }
    const community = communityStore.communities.find(c => c.id === communityId) || null;
    selectedCommunity.value = community;
  },
  { immediate: true },
);

// Ensure communities load when navigating directly to this page —
// the watcher above re-fires automatically when .length changes.
onMounted(async () => {
  if (communityStore.communities.length === 0) {
    await communityStore.loadCommunities();
  }
  if (joinedCommunities.value.length === 0 && communityStore.communities.length > 0) {
    await communityStore.syncJoinedFromRelay?.().catch(() => {});
  }
});
</script>