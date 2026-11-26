<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start"><ion-back-button default-href="/home" /></ion-buttons>
        <ion-title>Top forecasters</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content>
      <DesktopPageShell>
        <div class="lb">
          <p class="lb-muted">
            Ranked by calibrated accuracy (Brier skill) on resolved questions. No money involved.
            The top rows are re-checked against the original signed forecasts.
          </p>
          <div class="lb-filter">
            <input v-model="topicInput" class="lb-input" placeholder="Filter by topic (e.g. technology)" @keyup.enter="load" />
            <button class="lb-btn" type="button" @click="load">Show</button>
          </div>
          <p v-if="loading" class="lb-muted">Loading…</p>
          <p v-else-if="!rows.length" class="lb-muted">No forecasters yet{{ topic ? ` for #${topic}` : '' }}.</p>
          <ol v-else class="lb-list">
            <li v-for="(r, i) in rows" :key="r.userId" @click="$router.push(`/user/${r.userId}`)">
              <span class="lb-rank">{{ i + 1 }}</span>
              <span class="lb-name">{{ r.displayName || r.userId.slice(0, 10) }}
                <span v-if="r.verified" class="lb-verified" title="Recomputed from signed forecasts">✓</span>
              </span>
              <span class="lb-stat"><strong>{{ r.score }}</strong> score</span>
              <span class="lb-stat">{{ Math.round(r.accuracy * 100) }}%</span>
              <span class="lb-stat">{{ r.forecasts }} resolved</span>
            </li>
          </ol>
        </div>
      </DesktopPageShell>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { IonPage, IonHeader, IonToolbar, IonTitle, IonContent, IonButtons, IonBackButton } from '@ionic/vue';
import DesktopPageShell from '../components/DesktopPageShell.vue';
import { ForecastService, type PublishedReputation } from '../services/forecastService';
import { normalizeTopic } from '../utils/forecastScoring';

const route = useRoute();
const topicInput = ref(String(route.query.topic || ''));
const topic = ref('');
const rows = ref<(PublishedReputation & { verified: boolean })[]>([]);
const loading = ref(false);

async function load() {
  loading.value = true;
  topic.value = topicInput.value.trim() ? normalizeTopic(topicInput.value) : '';
  try { rows.value = await ForecastService.loadLeaderboard(topic.value || undefined); }
  catch { rows.value = []; }
  finally { loading.value = false; }
}
onMounted(load);
</script>

<style scoped>
.lb { padding: 16px; max-width: 720px; margin: 0 auto; display: flex; flex-direction: column; gap: 12px; }
.lb-muted { font-size: 13px; color: var(--ion-color-medium); margin: 0; }
.lb-filter { display: flex; gap: 8px; }
.lb-input { flex: 1; min-width: 0; padding: 8px 10px; border-radius: 8px; border: 1px solid var(--ion-color-step-200, rgba(127,127,127,.3)); background: transparent; color: inherit; font: inherit; }
.lb-btn { padding: 8px 14px; border-radius: 8px; border: 0; background: var(--ion-color-primary); color: var(--ion-color-primary-contrast); font-weight: 600; cursor: pointer; }
.lb-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.lb-list li { display: grid; grid-template-columns: 32px 1fr auto auto auto; gap: 10px; align-items: center; padding: 10px; border-radius: 10px; background: var(--ion-color-step-50, rgba(127,127,127,.06)); cursor: pointer; font-size: 14px; }
@media (max-width: 520px) { .lb-list li { grid-template-columns: 28px 1fr auto; } .lb-list li .lb-stat:nth-of-type(n+2) { display: none; } }
.lb-rank { font-weight: 700; color: var(--ion-color-medium); }
.lb-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lb-verified { color: var(--ion-color-success); margin-left: 4px; }
.lb-stat { font-size: 13px; color: var(--ion-color-medium); }
.lb-stat strong { color: var(--ion-text-color); }
</style>
