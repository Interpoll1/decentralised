<template>
  <div class="pig" :class="[`pig--n${shown.length}`, { 'pig--full': full }]">
    <template v-for="(cid, i) in shown" :key="cid">
      <div class="pig-cell" @click.stop>
        <img
          v-if="srcs[i]"
          :src="srcs[i]"
          :alt="`${alt} (${i + 1}/${cids.length})`"
          class="pig-img"
          loading="lazy"
        />
        <div v-else class="pig-skeleton" />
        <span v-if="!full && i === shown.length - 1 && extra > 0" class="pig-more">+{{ extra }}</span>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';

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

async function load() {
  const list = shown.value;
  srcs.value = list.map((_, i) => (i === 0 && props.primarySrc ? props.primarySrc : null));
  const { IPFSService } = await import('../services/ipfsService');
  list.forEach(async (cid, i) => {
    try {
      // Detail view wants full-res (local IndexedDB first); feed only needs the synced thumbnail.
      const data = props.full
        ? await IPFSService.downloadImage(cid)
        : (i === 0 && props.primarySrc) || await IPFSService.getThumbnail(cid);
      if (data && shown.value[i] === cid) srcs.value[i] = data;
    } catch { /* leave skeleton */ }
  });
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
.pig-cell { position: relative; background: rgba(255, 255, 255, 0.04); min-height: 0; }
.pig:not(.pig--n1) .pig-cell { aspect-ratio: 1; }
.pig--n3 .pig-cell:first-child { aspect-ratio: auto; }
.pig-img { width: 100%; height: 100%; display: block; object-fit: cover; }
.pig--n1 .pig-img { height: auto; max-height: 520px; object-fit: contain; }
.pig-skeleton { width: 100%; height: 100%; min-height: 120px; animation: pig-pulse 1.4s ease-in-out infinite; background: rgba(255, 255, 255, 0.05); }
.pig-more {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  background: rgba(0, 0, 0, 0.55); color: #fff; font-size: 28px; font-weight: 700;
}
@keyframes pig-pulse { 0%, 100% { opacity: 0.6; } 50% { opacity: 1; } }
</style>
