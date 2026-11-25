<template>
  <div v-if="spec" class="forecast-panel section">
    <div class="fp-head">
      <h3 class="section-title">Forecast</h3>
      <span class="fp-topic">#{{ spec.topic }}</span>
      <span v-if="resolution" class="fp-status" :class="resolution.status">
        {{ resolution.status === 'void' ? 'Voided' : 'Resolved' }}
      </span>
      <span v-else class="fp-status open">Resolves {{ formatDate(spec.resolvesAt) }}</span>
    </div>

    <div class="fp-rules">
      <div><strong>Resolution source:</strong> {{ spec.resolutionSource }}</div>
      <div><strong>Criteria:</strong> {{ spec.resolutionCriteria }}</div>
    </div>

    <!-- Community probability -->
    <div class="fp-block">
      <div class="fp-label">Community probability · {{ forecasterCount }} forecaster{{ forecasterCount === 1 ? '' : 's' }}</div>
      <div v-for="opt in poll.options" :key="opt.id" class="fp-row">
        <div class="fp-row-head">
          <span>
            {{ opt.text }}
            <strong v-if="resolution?.winningOptionId === opt.id" class="fp-winner">✓ outcome</strong>
          </span>
          <span>{{ pct(community[opt.id]) }}%</span>
        </div>
        <div class="fp-bar"><div class="fp-fill" :style="{ width: pct(community[opt.id]) + '%' }"></div></div>
      </div>
    </div>

    <!-- History chart -->
    <div v-if="history.length > 1" class="fp-block">
      <div class="fp-label">How opinion moved ({{ leadOption?.text }})</div>
      <svg class="fp-chart" viewBox="0 0 300 80" preserveAspectRatio="none" role="img"
           :aria-label="`Probability history for ${leadOption?.text}`">
        <line x1="0" y1="40" x2="300" y2="40" class="fp-mid" />
        <polyline :points="chartPoints" class="fp-line" />
      </svg>
    </div>

    <!-- Submit / revise -->
    <div v-if="!resolution && currentUserId" class="fp-block">
      <div class="fp-label">{{ myLatest ? 'Revise your forecast' : 'Make a forecast' }}</div>
      <div class="fp-options">
        <button v-for="opt in poll.options" :key="opt.id" type="button"
                class="fp-opt" :class="{ active: selectedOption === opt.id }"
                @click="selectedOption = opt.id">{{ opt.text }}</button>
      </div>
      <label class="fp-conf">
        Confidence: <strong>{{ confidence }}%</strong>
        <input v-model.number="confidence" type="range" :min="MIN_CONFIDENCE" :max="MAX_CONFIDENCE" step="1" />
      </label>
      <input v-model="note" class="fp-input" maxlength="280" placeholder="Why? (optional, e.g. what evidence changed your mind)" />
      <button class="fp-submit" type="button" :disabled="!selectedOption || busy" @click="submit">
        {{ busy ? 'Signing…' : myLatest ? 'Update forecast' : 'Submit forecast' }}
      </button>
      <p class="fp-hint">No money, no stakes — your signed forecast builds your public accuracy record.</p>
    </div>

    <!-- My receipts -->
    <div v-if="myEntries.length" class="fp-block">
      <div class="fp-label">Your prediction receipts</div>
      <ul class="fp-receipts">
        <li v-for="e in [...myEntries].reverse()" :key="e.createdAt">
          <span>{{ optionText(e.optionId) }} · {{ e.confidence }}%</span>
          <span class="fp-muted">{{ formatDateTime(e.createdAt) }}</span>
          <code class="fp-sig" :title="e.signature">sig {{ e.signature?.slice(0, 12) }}…</code>
          <div v-if="e.note" class="fp-muted">“{{ e.note }}”</div>
        </li>
      </ul>
    </div>

    <!-- Resolution -->
    <div v-if="resolution" class="fp-block fp-resolution">
      <div class="fp-label">Resolution · {{ formatDateTime(resolution.resolvedAt) }}</div>
      <p v-if="resolution.status === 'resolved'">Outcome: <strong>{{ optionText(resolution.winningOptionId!) }}</strong></p>
      <p v-else>This question was voided and does not affect anyone's score.</p>
      <p v-if="resolution.note">{{ resolution.note }}</p>
      <a v-if="safeEvidenceUrl" :href="safeEvidenceUrl" target="_blank" rel="noopener noreferrer nofollow">Evidence ↗</a>
      <p v-if="myScore" class="fp-score">
        Your final forecast was {{ myScore.correct ? 'correct' : 'incorrect' }} · Brier {{ myScore.brier.toFixed(3) }}
        <span v-if="myScore.daysAheadOfCrowd > 0"> · {{ myScore.daysAheadOfCrowd }} days ahead of the crowd</span>
      </p>
    </div>
    <div v-else-if="isAuthor" class="fp-block">
      <div class="fp-label">Resolve (author only)</div>
      <select v-model="resolveOption" class="fp-input">
        <option value="">Choose the outcome…</option>
        <option v-for="opt in poll.options" :key="opt.id" :value="opt.id">{{ opt.text }}</option>
        <option value="__void">Void (question became unanswerable)</option>
      </select>
      <input v-model="evidenceUrl" class="fp-input" placeholder="Evidence link from the declared source" />
      <input v-model="resolveNote" class="fp-input" placeholder="Short explanation" />
      <button class="fp-submit" type="button" :disabled="!resolveOption || busy" @click="doResolve">Publish resolution</button>
    </div>

    <p v-if="error" class="fp-error">{{ error }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import type { Poll } from '../types/poll';
import { ForecastService } from '../services/forecastService';
import {
  MAX_CONFIDENCE, MIN_CONFIDENCE, communityProbability, probabilityHistory, scoreUser,
  type ForecastEntry, type ForecastResolution, type ForecastSpec,
} from '../utils/forecastScoring';

const props = defineProps<{ poll: Poll; currentUserId: string }>();

const spec = ref<ForecastSpec | null>(null);
const entries = ref<ForecastEntry[]>([]);
const resolution = ref<ForecastResolution | null>(null);
const selectedOption = ref('');
const confidence = ref(70);
const note = ref('');
const busy = ref(false);
const error = ref('');
const resolveOption = ref('');
const evidenceUrl = ref('');
const resolveNote = ref('');

const optionIds = computed(() => props.poll.options.map((o) => o.id));
const community = computed(() => communityProbability(entries.value, optionIds.value));
const history = computed(() => probabilityHistory(entries.value, optionIds.value));
const forecasterCount = computed(() => new Set(entries.value.map((e) => e.userId)).size);
const myEntries = computed(() => entries.value.filter((e) => e.userId === props.currentUserId));
const myLatest = computed(() => myEntries.value[myEntries.value.length - 1] ?? null);
const isAuthor = computed(() => !!props.currentUserId && props.poll.authorId === props.currentUserId);
const leadOption = computed(() => {
  const id = resolution.value?.winningOptionId
    ?? [...optionIds.value].sort((a, b) => (community.value[b] ?? 0) - (community.value[a] ?? 0))[0];
  return props.poll.options.find((o) => o.id === id);
});
const chartPoints = computed(() => {
  const pts = history.value;
  if (pts.length < 2 || !leadOption.value) return '';
  const t0 = pts[0].at, span = Math.max(1, pts[pts.length - 1].at - t0);
  return pts.map((p) => `${((p.at - t0) / span) * 300},${80 - (p.probabilities[leadOption.value!.id] ?? 0) * 80}`).join(' ');
});
const myScore = computed(() => {
  if (!spec.value || !resolution.value) return null;
  return scoreUser(props.currentUserId, [{ spec: spec.value, optionIds: optionIds.value, resolution: resolution.value, entries: entries.value }])[0] ?? null;
});
const safeEvidenceUrl = computed(() => {
  const url = resolution.value?.evidenceUrl;
  return url && /^https?:\/\//i.test(url) ? url : '';
});

const pct = (v?: number) => Math.round((v ?? 0) * 100);
const optionText = (id: string) => props.poll.options.find((o) => o.id === id)?.text ?? id;
const formatDate = (ms: number) => new Date(ms).toLocaleDateString();
const formatDateTime = (ms: number) => new Date(ms).toLocaleString();

async function load() {
  spec.value = await ForecastService.loadSpec(props.poll.id);
  if (!spec.value) return;
  const [e, r] = await Promise.all([
    ForecastService.loadEntries(props.poll.id, optionIds.value),
    ForecastService.loadResolution(spec.value),
  ]);
  entries.value = e;
  resolution.value = r;
  if (myLatest.value) {
    selectedOption.value = myLatest.value.optionId;
    confidence.value = myLatest.value.confidence;
  }
}

async function submit() {
  if (!selectedOption.value) return;
  busy.value = true; error.value = '';
  try {
    const entry = await ForecastService.submitForecast({
      pollId: props.poll.id, userId: props.currentUserId,
      optionId: selectedOption.value, confidence: confidence.value, note: note.value,
    });
    entries.value = [...entries.value, entry];
    note.value = '';
  } catch (err: any) {
    error.value = err?.message || 'Could not save forecast.';
  } finally { busy.value = false; }
}

async function doResolve() {
  if (!spec.value || !resolveOption.value) return;
  busy.value = true; error.value = '';
  try {
    const isVoid = resolveOption.value === '__void';
    resolution.value = await ForecastService.resolve(spec.value, {
      status: isVoid ? 'void' : 'resolved',
      winningOptionId: isVoid ? undefined : resolveOption.value,
      evidenceUrl: evidenceUrl.value, note: resolveNote.value, resolverId: props.currentUserId,
    });
  } catch (err: any) {
    error.value = err?.message || 'Could not publish resolution.';
  } finally { busy.value = false; }
}

onMounted(load);
watch(() => props.poll.id, load);
watch(() => props.currentUserId, () => { if (spec.value && myLatest.value) selectedOption.value = myLatest.value.optionId; });
</script>

<style scoped>
.forecast-panel { display: flex; flex-direction: column; gap: 14px; }
.fp-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.fp-head .section-title { margin: 0; }
.fp-topic { font-size: 12px; color: var(--ion-color-medium); }
.fp-status { margin-left: auto; font-size: 12px; padding: 2px 8px; border-radius: 999px; background: var(--ion-color-light); }
.fp-status.resolved { background: rgba(var(--ion-color-success-rgb), .15); color: var(--ion-color-success); }
.fp-status.void { background: rgba(var(--ion-color-medium-rgb), .15); }
.fp-rules { font-size: 13px; display: grid; gap: 4px; padding: 10px; border-radius: 10px; background: var(--ion-color-step-50, rgba(127,127,127,.06)); }
.fp-block { display: flex; flex-direction: column; gap: 8px; }
.fp-label { font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: var(--ion-color-medium); }
.fp-row-head { display: flex; justify-content: space-between; font-size: 14px; }
.fp-winner { color: var(--ion-color-success); font-size: 12px; margin-left: 6px; }
.fp-bar { height: 8px; border-radius: 4px; background: var(--ion-color-step-100, rgba(127,127,127,.15)); overflow: hidden; }
.fp-fill { height: 100%; background: var(--ion-color-primary); transition: width .3s; }
.fp-chart { width: 100%; height: 80px; }
.fp-mid { stroke: var(--ion-color-medium); stroke-dasharray: 3 3; stroke-width: .5; }
.fp-line { fill: none; stroke: var(--ion-color-primary); stroke-width: 2; vector-effect: non-scaling-stroke; }
.fp-options { display: flex; flex-wrap: wrap; gap: 6px; }
.fp-opt { padding: 6px 12px; border-radius: 999px; border: 1px solid var(--ion-color-medium); background: transparent; color: inherit; cursor: pointer; }
.fp-opt.active { background: var(--ion-color-primary); border-color: var(--ion-color-primary); color: var(--ion-color-primary-contrast); }
.fp-conf { display: flex; flex-direction: column; gap: 4px; font-size: 14px; }
.fp-conf input { width: 100%; }
.fp-input { width: 100%; padding: 8px 10px; border-radius: 8px; border: 1px solid var(--ion-color-step-200, rgba(127,127,127,.3)); background: transparent; color: inherit; font: inherit; }
.fp-submit { align-self: flex-start; padding: 8px 16px; border-radius: 8px; border: 0; background: var(--ion-color-primary); color: var(--ion-color-primary-contrast); cursor: pointer; font-weight: 600; }
.fp-submit:disabled { opacity: .5; cursor: default; }
.fp-hint, .fp-muted { font-size: 12px; color: var(--ion-color-medium); margin: 0; }
.fp-receipts { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; font-size: 14px; }
.fp-receipts li { display: flex; flex-wrap: wrap; gap: 8px; align-items: baseline; }
.fp-sig { font-size: 11px; opacity: .7; }
.fp-resolution p { margin: 0; }
.fp-score { font-weight: 600; }
.fp-error { color: var(--ion-color-danger); font-size: 13px; margin: 0; }
</style>
