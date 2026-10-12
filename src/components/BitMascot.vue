<template>
  <svg
    class="bit"
    :class="[`bit--${mood}`, { 'bit--still': !animated }]"
    :width="size"
    :height="Math.round(size * (ROWS / COLS))"
    :viewBox="`0 0 ${COLS} ${ROWS}`"
    shape-rendering="crispEdges"
    role="img"
    aria-label="Bit, the Interpoll frog"
  >
    <rect v-for="p in pixels" :key="p.k" :x="p.x" :y="p.y" width="1" height="1" :fill="p.fill" />
  </svg>
</template>

<script setup lang="ts">
import { computed } from 'vue';

export type BitMood = 'idle' | 'happy' | 'wave' | 'sleepy' | 'alert';

const props = withDefaults(defineProps<{ size?: number; mood?: BitMood; animated?: boolean }>(), {
  size: 48,
  mood: 'idle',
  animated: true,
});

const COLS = 12;
const ROWS = 11;
const COLORS: Record<string, string> = {
  G: '#3dff7a', D: '#1f9e4b', W: '#ffffff', K: '#000000', P: '#ff8fb3', Y: '#ffd84a',
};

// Body shared by every mood; eyes (rows 1-2), mouth (rows 6-7) and the raised arm vary.
const BODY = [
  '..GG....GG..',
  '.GxxG..GxxG.',
  '.GxxG..GxxG.',
  'GGGGGGGGGGGG',
  'GGGGGGGGGGGG',
  'GPPGGGGGGPPG',
  'GGGmGGGGmGGG',
  'GGGGmmmmGGGG',
  '.GGGGGGGGGG.',
  '.GG.GGGG.GG.',
  '.DD......DD.',
];

const EYES: Record<BitMood, [string, string]> = {
  idle:   ['WW', 'KW'],
  alert:  ['WW', 'KK'],
  happy:  ['GG', 'KK'],   // ^ ^ squint: top row green, pupils as a smile line
  wave:   ['WW', 'KW'],
  sleepy: ['GG', 'KK'],
};

const pixels = computed(() => {
  const [top, bottom] = EYES[props.mood];
  const out: { k: string; x: number; y: number; fill: string }[] = [];
  const rows = BODY.map(r => r.split(''));
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      let c = rows[y][x];
      if (c === 'x') {
        const isLeft = x < 6;
        const pair = y === 1 ? top : bottom;
        c = pair[isLeft ? x - 2 : x - 8] ?? 'W';
      }
      if (c === 'm') {
        // happy: open grin (wider), sleepy: flat, others: smile
        c = props.mood === 'sleepy' ? (y === 7 ? 'K' : 'G') : 'K';
      }
      if (c === '.') continue;
      out.push({ k: `${x}-${y}`, x, y, fill: COLORS[c] ?? COLORS.G });
    }
  }
  // Waving arm: a small raised hand on the right with a spark.
  if (props.mood === 'wave') {
    out.push({ k: 'a1', x: 11, y: 2, fill: COLORS.G }, { k: 'a2', x: 11, y: 1, fill: COLORS.G });
    out.push({ k: 'sp', x: 11, y: 0, fill: COLORS.Y });
  }
  if (props.mood === 'alert') out.push({ k: 'ex', x: 5, y: 0, fill: COLORS.Y }, { k: 'ex2', x: 6, y: 0, fill: COLORS.Y });
  if (props.mood === 'sleepy') out.push({ k: 'z', x: 10, y: 0, fill: COLORS.W });
  return out;
});
</script>

<style scoped>
.bit { image-rendering: pixelated; flex-shrink: 0; display: block; }
.bit:not(.bit--still) { animation: bit-hop 1.6s steps(2) infinite; }
.bit--wave:not(.bit--still) { animation: bit-hop 0.8s steps(2) infinite; }
.bit--sleepy:not(.bit--still) { animation: bit-breathe 2.4s steps(2) infinite; }
@keyframes bit-hop { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
@keyframes bit-breathe { 0%, 100% { transform: scaleY(1); } 50% { transform: scaleY(0.96); } }
</style>
