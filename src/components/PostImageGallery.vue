<template>
  <div class="pig" :class="[`pig--n${shown.length}`, { 'pig--full': full }]">
    <template v-for="(cid, i) in shown" :key="cid">
      <div class="pig-cell" @click.stop="openAt(i)">
        <img
          v-if="srcs[i]"
          :src="srcs[i]"
          :alt="`${alt} (${i + 1}/${cids.length})`"
          class="pig-img"
          loading="lazy"
        />
        <div v-else class="pig-skeleton" :class="{ 'pig-skeleton--failed': failed[i] }">
          <span v-if="failed[i]" class="pig-retry">Tap to retry</span>
        </div>
        <span v-if="!full && i === shown.length - 1 && extra > 0" class="pig-more">+{{ extra }}</span>
      </div>
    </template>
    <ImageLightbox :open="lbOpen" :srcs="lbSrcs" :start="lbStart" :alt="alt" @close="lbOpen = false" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import ImageLightbox from './ImageLightbox.vue';

const props = defineProps<{
  /** Ordered image cids; the first one may be pre-resolved via `primarySrc`. */
  cids: string[];
  /** Already-available src (thumbnail) for cids[0], avoids a Gun round-trip. */
  primarySrc?: string;
  alt?: string;
  /** Detail view: show every image, prefer full resolution. Feed view: cap at 4 tiles. */
  full?: boolean;
}>();

const FEED_TILES = 4;
const shown = computed(() => (props.full ? props.cids : props.cids.slice(0, FEED_TILES)));
const extra = computed(() => props.cids.length - FEED_TILES);
const srcs = ref<(string | null)[]>([]);

const lbOpen = ref(false);
const lbStart = ref(0);
// Only images that have loaded; map the tapped tile onto its slot in that list.
const lbSrcs = computed(() => srcs.value.filter((s): s is string => !!s));
function openAt(i: number) {
  if (!srcs.value[i]) {
    if (failed.value[i]) void fetchTile(shown.value[i], i, generation);
    return;
  }
  lbStart.value = srcs.value.slice(0, i).filter(Boolean).length;
  lbOpen.value = true;
}

// A single Gun read often misses on first load (the node hasn't synced yet), so retry with
// growing gaps before giving up; a failed tile can then be tapped to try again.
const RETRY_GAPS_MS = [0, 2000, 5000, 10000];
const failed = ref<boolean[]>([]);
let generation = 0;

async function fetchTile(cid: string, i: number, gen: number) {
  const { IPFSService } = await import('../services/ipfsService');
  failed.value[i] = false;
  for (const gap of RETRY_GAPS_MS) {
    if (gap) await new Promise(r => setTimeout(r, gap));
    if (gen !== generation || shown.value[i] !== cid || srcs.value[i]) return;
    try {
      // Detail view wants full-res (local IndexedDB first); feed only needs the synced thumbnail.
      const data = props.full
        ? await IPFSService.downloadImage(cid)
        : (i === 0 && props.primarySrc) || await IPFSService.getThumbnail(cid);
      if (data) { if (gen === generation && shown.value[i] === cid) srcs.value[i] = data; return; }
    } catch { /* try again */ }
  }
  if (gen === generation) failed.value[i] = true;
}

function load() {
  const list = shown.value;
  generation++;
  srcs.value = list.map((_, i) => (i === 0 && props.primarySrc ? props.primarySrc : null));
  failed.value = list.map(() => false);
  list.forEach((cid, i) => { if (!srcs.value[i]) void fetchTile(cid, i, generation); });
}

watch(() => [props.cids.join(','), props.full], load, { immediate: true });
</script>

<style scoped>
.pig { display: grid; gap: 4px; border-radius: 10px; overflow: hidden; }
.pig--n1 { grid-template-columns: 1fr; }
.pig--n2, .pig--n4 { grid-template-columns: 1fr 1fr; }
.pig--n3 { grid-template-columns: 1fr 1fr; }
.pig--n3 .pig-cell:first-child { grid-row: span 2; }
.pig--full:not(.pig--n1) { grid-template-columns: repeat(2, 1fr); }
@media (min-width: 640px) {
  .pig--full.pig--n5, .pig--full.pig--n6, .pig--full.pig--n7, .pig--full.pig--n8 { grid-template-columns: repeat(3, 1fr); }
}
.pig-cell { position: relative; background: rgba(255, 255, 255, 0.04); min-height: 0; cursor: zoom-in; }
.pig:not(.pig--n1) .pig-cell { aspect-ratio: 1; }
.pig--n3 .pig-cell:first-child { aspect-ratio: auto; }
.pig-img { width: 100%; height: 100%; display: block; object-fit: cover; }
.pig--n1 .pig-img { height: auto; max-height: 520px; object-fit: contain; }
.pig-skeleton--failed { animation: none; display: flex; align-items: center; justify-content: center; cursor: pointer; }
.pig-retry { font-size: 12.5px; color: #3dff7a; border: 1px solid #2a312a; border-radius: 5px; padding: 4px 10px; }
.pig-skeleton { width: 100%; height: 100%; min-height: 120px; animation: pig-pulse 1.4s ease-in-out infinite; background: rgba(255, 255, 255, 0.05); }
.pig-more {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  background: rgba(0, 0, 0, 0.55); color: #fff; font-size: 28px; font-weight: 700;
}
@keyframes pig-pulse { 0%, 100% { opacity: 0.6; } 50% { opacity: 1; } }
</style>
