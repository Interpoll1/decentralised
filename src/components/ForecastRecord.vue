<template>
  <div v-if="rep && rep.forecasts > 0" class="forecast-record">
    <h3 class="fr-title">Forecasting record</h3>
    <div class="fr-stats">
      <div><strong>{{ rep.score }}</strong><span>score</span></div>
      <div><strong>{{ Math.round(rep.accuracy * 100) }}%</strong><span>accuracy</span></div>
      <div><strong>{{ rep.forecasts }}</strong><span>resolved</span></div>
      <div><strong>{{ rep.currentStreak }}</strong><span>streak</span></div>
    </div>
    <div v-if="rep.byTopic.length" class="fr-topics">
      <span v-for="t in rep.byTopic" :key="t.topic" class="fr-chip">
        {{ Math.round(t.accuracy * 100) }}% on {{ t.topic }} ({{ t.forecasts }})
      </span>
    </div>
    <div class="fr-calib" aria-label="Calibration">
      <div v-for="b in rep.calibration.filter(b => b.count)" :key="b.from" class="fr-cal-row">
        <span>Said {{ b.from }}–{{ b.to }}%</span>
        <span>right {{ Math.round(b.observed * 100) }}% ({{ b.count }})</span>
      </div>
    </div>
    <div v-if="rep.bestEarlyCallDays > 0" class="fr-muted">Best early call: {{ rep.bestEarlyCallDays }} days before the crowd</div>
    <div v-if="rep.badges.length" class="fr-topics">
      <span v-for="b in rep.badges" :key="b" class="fr-chip badge">🏅 {{ b }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { ForecastService } from '../services/forecastService';
import { buildReputation, scoreUser, type ForecasterReputation } from '../utils/forecastScoring';

const props = defineProps<{ userId: string }>();
const rep = ref<ForecasterReputation | null>(null);

async function load() {
  if (!props.userId) return;
  try {
    const questions = await ForecastService.loadResolvedQuestionsFor(props.userId);
    rep.value = buildReputation(props.userId, scoreUser(props.userId, questions));
  } catch { rep.value = null; }
}
onMounted(load);
watch(() => props.userId, load);
</script>

<style scoped>
.forecast-record { display: flex; flex-direction: column; gap: 10px; padding: 14px; border-radius: 12px; border: 1px solid var(--ion-color-step-150, rgba(127,127,127,.2)); margin: 12px 0; }
.fr-title { margin: 0; font-size: 16px; }
.fr-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; text-align: center; }
.fr-stats strong { display: block; font-size: 20px; }
.fr-stats span, .fr-muted { font-size: 12px; color: var(--ion-color-medium); }
.fr-topics { display: flex; flex-wrap: wrap; gap: 6px; }
.fr-chip { font-size: 12px; padding: 3px 8px; border-radius: 999px; background: var(--ion-color-step-50, rgba(127,127,127,.08)); }
.fr-cal-row { display: flex; justify-content: space-between; font-size: 13px; }
</style>
