<template>
  <div v-if="current || isOwner" class="contrib section">
    <div class="cc-head">
      <h3 class="section-title">Contributors</h3>
      <span v-if="current" class="cc-status" :class="status">{{ statusLabel }}</span>
      <span v-if="current" class="cc-muted">v{{ current.version }}</span>
    </div>

    <p v-if="!historyValid" class="cc-error">Contribution history failed verification and is not shown.</p>

    <ul v-if="current" class="cc-list">
      <li v-for="e in current.entries" :key="e.contributorId">
        <div>
          <strong>{{ e.displayName }}</strong>
          <span class="cc-role">{{ e.role }}</span>
          <span class="cc-muted">{{ (e.shareBps / 100).toFixed(e.shareBps % 100 ? 2 : 0) }}%</span>
        </div>
        <span class="cc-state" :class="states.get(e.contributorId)">{{ states.get(e.contributorId) }}</span>
      </li>
    </ul>

    <div v-if="myPendingEntry" class="cc-actions">
      <span>You're listed as <strong>{{ myPendingEntry.role }}</strong> ({{ myPendingEntry.shareBps / 100 }}%).</span>
      <button type="button" class="cc-btn" :disabled="busy" @click="respond('accepted')">Accept</button>
      <button type="button" class="cc-btn ghost" :disabled="busy" @click="respond('disputed')">Dispute</button>
    </div>

    <details v-if="isOwner" class="cc-editor" :open="!current">
      <summary>{{ current ? 'Propose a new split' : 'Credit collaborators' }}</summary>
      <p class="cc-muted">
        Each person must accept before they're credited. Changes need approval from everyone affected.
        Credits only for now — no payments.
      </p>
      <div v-for="(row, i) in draft" :key="i" class="cc-row">
        <input v-model="row.contributorId" class="cc-input" placeholder="Account ID / public key" />
        <input v-model="row.displayName" class="cc-input" placeholder="Display name" />
        <select v-model="row.role" class="cc-input">
          <option v-for="r in CONTRIBUTOR_ROLES" :key="r" :value="r">{{ r }}</option>
        </select>
        <input v-model.number="row.percent" class="cc-input cc-pct" type="number" min="0" max="100" step="0.01" />
        <button type="button" class="cc-btn ghost" @click="draft.splice(i, 1)">✕</button>
      </div>
      <div class="cc-row-actions">
        <button type="button" class="cc-btn ghost" @click="addRow()">+ Add contributor</button>
        <span :class="{ 'cc-error': draftTotal !== 100 }">Total {{ draftTotal }}%</span>
      </div>
      <ul v-if="draftErrors.length" class="cc-error">
        <li v-for="err in draftErrors" :key="err">{{ err }}</li>
      </ul>
      <button type="button" class="cc-btn" :disabled="busy || draftErrors.length > 0" @click="propose">Send for approval</button>
    </details>

    <p v-if="error" class="cc-error">{{ error }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { ContributionService } from '../services/contributionService';
import {
  CONTRIBUTOR_ROLES, acceptanceStates, percentToBps, splitStatus, validateSplit,
  type Acceptance, type ContributorRole, type SplitEntry, type SplitVersion, type WorkKind,
} from '../utils/contributionSplit';

const props = defineProps<{
  workId: string;
  workKind: WorkKind;
  ownerId: string;
  ownerName: string;
  currentUserId: string;
}>();

type DraftRow = { contributorId: string; displayName: string; role: ContributorRole; percent: number };

const current = ref<SplitVersion | null>(null);
const acceptances = ref<Acceptance[]>([]);
const historyValid = ref(true);
const busy = ref(false);
const error = ref('');
const draft = ref<DraftRow[]>([]);

const isOwner = computed(() => !!props.currentUserId && props.currentUserId === props.ownerId);
const states = computed(() => current.value ? acceptanceStates(current.value, acceptances.value) : new Map());
const status = computed(() => current.value ? splitStatus(current.value, acceptances.value) : 'draft');
const statusLabel = computed(() => ({ active: 'All accepted', draft: 'Awaiting acceptance', disputed: 'Disputed' })[status.value]);
const myPendingEntry = computed(() => {
  const e = current.value?.entries.find((x) => x.contributorId === props.currentUserId);
  return e && states.value.get(e.contributorId) === 'pending' ? e : null;
});
const draftEntries = computed<SplitEntry[]>(() => draft.value.map((r) => ({
  contributorId: r.contributorId.trim(), displayName: r.displayName.trim() || r.contributorId.trim().slice(0, 12),
  role: r.role, shareBps: percentToBps(Number(r.percent) || 0),
})));
const draftTotal = computed(() => draftEntries.value.reduce((a, e) => a + e.shareBps, 0) / 100);
const draftErrors = computed(() => validateSplit(draftEntries.value));

function addRow(row?: Partial<DraftRow>) {
  draft.value.push({ contributorId: '', displayName: '', role: 'collaborator', percent: 0, ...row });
}

function resetDraft() {
  draft.value = [];
  if (current.value) {
    for (const e of current.value.entries) addRow({ ...e, percent: e.shareBps / 100 });
  } else {
    addRow({ contributorId: props.ownerId, displayName: props.ownerName, role: 'uploader', percent: 100 });
  }
}

async function load() {
  if (!props.workId) return;
  const state = await ContributionService.load(props.workId);
  current.value = state.current;
  acceptances.value = state.acceptances;
  historyValid.value = state.historyValid;
  resetDraft();
}

async function propose() {
  busy.value = true; error.value = '';
  try {
    await ContributionService.propose({
      workId: props.workId, workKind: props.workKind, entries: draftEntries.value, proposedBy: props.currentUserId,
    });
    await load();
  } catch (err: any) { error.value = err?.message || 'Could not save split.'; }
  finally { busy.value = false; }
}

async function respond(state: 'accepted' | 'disputed') {
  if (!current.value) return;
  const reason = state === 'disputed' ? (window.prompt('What should change?') ?? '') : undefined;
  busy.value = true; error.value = '';
  try {
    const a = await ContributionService.respond(current.value, props.currentUserId, state, reason);
    acceptances.value = [...acceptances.value, a];
  } catch (err: any) { error.value = err?.message || 'Could not record your response.'; }
  finally { busy.value = false; }
}

onMounted(load);
watch(() => props.workId, load);
</script>

<style scoped>
.contrib { display: flex; flex-direction: column; gap: 10px; }
.cc-head { display: flex; align-items: center; gap: 8px; }
.cc-head .section-title { margin: 0; }
.cc-status { font-size: 12px; padding: 2px 8px; border-radius: 999px; background: var(--ion-color-light); }
.cc-status.active { color: var(--ion-color-success); }
.cc-status.disputed { color: var(--ion-color-danger); }
.cc-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.cc-list li { display: flex; justify-content: space-between; gap: 8px; font-size: 14px; }
.cc-role { margin: 0 6px; font-size: 12px; text-transform: capitalize; color: var(--ion-color-primary); }
.cc-state { font-size: 12px; text-transform: capitalize; color: var(--ion-color-medium); }
.cc-state.accepted { color: var(--ion-color-success); }
.cc-state.disputed, .cc-state.declined { color: var(--ion-color-danger); }
.cc-muted { font-size: 12px; color: var(--ion-color-medium); }
.cc-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 14px; }
.cc-editor summary { cursor: pointer; font-weight: 600; font-size: 14px; }
.cc-row { display: grid; grid-template-columns: 1.4fr 1fr 1fr 70px auto; gap: 6px; margin-top: 6px; }
@media (max-width: 560px) { .cc-row { grid-template-columns: 1fr 1fr; } }
.cc-row-actions { display: flex; justify-content: space-between; align-items: center; margin: 8px 0; font-size: 13px; }
.cc-input { width: 100%; min-width: 0; padding: 6px 8px; border-radius: 8px; border: 1px solid var(--ion-color-step-200, rgba(127,127,127,.3)); background: transparent; color: inherit; font: inherit; font-size: 13px; }
.cc-btn { padding: 6px 14px; border-radius: 8px; border: 0; background: var(--ion-color-primary); color: var(--ion-color-primary-contrast); cursor: pointer; font-weight: 600; }
.cc-btn.ghost { background: transparent; color: inherit; border: 1px solid var(--ion-color-step-200, rgba(127,127,127,.3)); }
.cc-btn:disabled { opacity: .5; cursor: default; }
.cc-error { color: var(--ion-color-danger); font-size: 13px; margin: 0; }
</style>
