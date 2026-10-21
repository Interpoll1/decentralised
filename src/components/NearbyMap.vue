<template>
  <Teleport to="body" :disabled="!full">
  <div class="nm-wrap" :class="{ 'nm-wrap--full': full }">
    <div
      ref="el" class="nm" role="application" aria-label="Map of people, meetups and spaces nearby"
      @pointerdown="onDown" @pointermove="onMove" @pointerup="onUp" @pointercancel="onUp" @wheel.prevent="onWheel" @dblclick.prevent="zoom(1)"
    >
      <!-- Tiles (OpenStreetMap). Without them a plain grid is drawn. -->
      <div v-if="tiles && !tilesFailed" class="nm-tiles">
        <img v-for="t in tileList" :key="t.k" :src="t.url" alt="" draggable="false" :style="t.style" @error="onTileError" />
      </div>
      <template v-else>
        <div class="nm-grid" :style="gridStyle"></div>
        <canvas ref="cv" class="nm-dots"></canvas>
      </template>
      <div class="nm-vignette"></div>

      <svg class="nm-svg" :viewBox="`0 0 ${W} ${H}`" aria-hidden="true">
        <path v-for="a in arcs" :key="a.id" :d="a.d" class="nm-arc" />
        <circle v-if="ring" :cx="me.x" :cy="me.y" :r="ring" class="nm-ring" />
        <circle v-if="me.areaR > 3" :cx="me.x" :cy="me.y" :r="me.areaR" class="nm-area nm-area--me" />
        <circle v-for="c in clusters.filter(c => c.areaR > 5)" :key="'a' + c.id" :cx="c.x" :cy="c.y" :r="c.areaR" class="nm-area" />
      </svg>

      <span v-if="meShown" class="nm-me" :style="{ left: me.x + 'px', top: me.y + 'px' }"><i></i><b>You</b></span>

      <button
        v-for="c in clusters" :key="c.id" class="nm-pin" :class="[`nm-pin--${c.kind}`, { sel: selected?.id === c.id }]"
        :style="{ left: c.x + 'px', top: c.y + 'px' }" :aria-label="c.label" @pointerdown.stop @click.stop="select(c)"
      >{{ c.items.length > 1 ? c.items.length : c.glyph }}</button>

      <div v-if="stats?.length" class="nm-stats" @pointerdown.stop>
        <span v-for="t in stats" :key="t.label"><i :style="{ background: t.color }"></i><b>{{ t.n }}{{ t.of != null ? '/' + t.of : '' }}</b> {{ t.label }}</span>
      </div>
      <div class="nm-ctl" @pointerdown.stop>
        <button aria-label="Zoom in" :disabled="z >= maxZoom" @click="zoom(1)">+</button>
        <button aria-label="Zoom out" :disabled="z <= minZoom" @click="zoom(-1)">−</button>
        <button aria-label="Re-centre" @click="reset">⌖</button>
        <button :aria-label="full ? 'Exit full screen' : 'Full screen'" @click="full = !full">{{ full ? '✕' : '⛶' }}</button>
      </div>
      <div class="nm-attr">
        <template v-if="tiles && !tilesFailed">© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a></template>
        <template v-else>Dot map · no tiles loaded</template>
      </div>
    </div>

    <label class="nm-opt"><input type="checkbox" :checked="tiles" @change="$emit('tiles', ($event.target as HTMLInputElement).checked)" /> Street map tiles <small>(loaded from OpenStreetMap — it can see the area you view). Off = private dot map.</small></label>

    <div v-if="selected" class="nm-sheet">
      <div v-for="it in selected.items" :key="it.key" class="nm-row">
        <span class="nm-row__info">
          <b>{{ it.title }}</b>
          <small>{{ it.sub }}</small>
        </span>
        <button v-if="it.kind === 'person'" class="nm-btn" @click="$emit('message', it.id)">Message</button>
        <button v-else-if="it.kind === 'meetup'" class="nm-btn" @click="$emit('message', it.id)">Message host</button>
        <button v-else class="nm-btn" @click="$emit('openSpace', it.id)">Open</button>
        <button v-if="it.kind === 'person'" class="nm-x" aria-label="Hide this person" @click="$emit('hide', it.id, it.title)">✕</button>
      </div>
      <button class="nm-close" @click="selected = null">Close</button>
    </div>
  </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { NearbyMeetup, NearbyPerson, NearbySpace } from '../services/nearbyService';
import { landGrid, MASK_STEP } from '../utils/worldMask';
import { cellFor, distanceLabel, haversineKm } from '../utils/geoCells';

const props = defineProps<{
  me: { lat: number; lon: number } | null;
  myPrec: number;
  radiusKm: number;
  people: NearbyPerson[];
  meetups: NearbyMeetup[];
  spaces: NearbySpace[];
  tiles: boolean;
  stats?: Array<{ label: string; n: number; color: string; of?: number }>;
}>();
defineEmits<{
  (e: 'message', id: string): void;
  (e: 'hide', id: string, name: string): void;
  (e: 'openSpace', id: string): void;
  (e: 'tiles', v: boolean): void;
}>();

const TILE = 256;
const el = ref<HTMLElement | null>(null);
const W = ref(640);
const H = ref(380);
const z = ref(4);
const center = ref({ lat: 0, lon: 0 });
const tilesFailed = ref(false);
const full = ref(false);
const cv = ref<HTMLCanvasElement | null>(null);
let failures = 0;

// ── Web-Mercator maths ──────────────────────────────────────────────────────
const clampLat = (lat: number) => Math.max(-85.05, Math.min(85.05, lat));
function toWorld(lat: number, lon: number, zz: number) {
  const n = TILE * 2 ** zz;
  const s = Math.sin((clampLat(lat) * Math.PI) / 180);
  return { x: ((lon + 180) / 360) * n, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n };
}
function fromWorld(x: number, y: number, zz: number) {
  const n = TILE * 2 ** zz;
  const lon = (x / n) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
  return { lat, lon };
}
const metersPerPx = (lat: number, zz: number) => (156543.03392 * Math.cos((clampLat(lat) * Math.PI) / 180)) / 2 ** zz;

/** Don't zoom closer than the area people are published at — the map shouldn't imply more precision than exists. */
const maxZoom = computed(() => {
  const lat = props.me?.lat ?? 0;
  const z = Math.log2((40075 * Math.max(0.2, Math.cos((clampLat(lat) * Math.PI) / 180))) / (Math.max(1, props.myPrec) * 2));
  return Math.max(3, Math.min(16, Math.floor(z)));
});

/** The map is centred on the published area's centre, never on the exact position. */
const home = computed(() => {
  if (!props.me) return { lat: 20, lon: 0 };
  const c = cellFor(props.me.lat, props.me.lon, props.myPrec);
  return { lat: c.lat, lon: c.lon };
});

const minZoom = computed(() => Math.max(1, Math.ceil(Math.log2(Math.max(W.value, H.value) / TILE))));
/** Keep the view inside the world: no repeated copies sideways, no empty bands above/below. */
function clampCenter() {
  const n = TILE * 2 ** z.value;
  const c = toWorld(center.value.lat, center.value.lon, z.value);
  const x = Math.max(W.value / 2, Math.min(n - W.value / 2, c.x));
  const y = Math.max(H.value / 2, Math.min(n - H.value / 2, c.y));
  if (x !== c.x || y !== c.y) center.value = fromWorld(x, y, z.value);
}
function fitZoom(): number {
  const span = (props.radiusKm >= 20000 ? 40000 : props.radiusKm * 2.3) * 1000; // metres across the view
  const px = Math.min(W.value, H.value) * 0.92;
  const zz = Math.log2((px * 156543.03392 * Math.cos((clampLat(home.value.lat) * Math.PI) / 180)) / span);
  return Math.max(minZoom.value, Math.min(maxZoom.value, Math.floor(zz)));
}
function reset() { center.value = { ...home.value }; z.value = fitZoom(); clampCenter(); }

const origin = computed(() => {
  const c = toWorld(center.value.lat, center.value.lon, z.value);
  return { x: c.x - W.value / 2, y: c.y - H.value / 2 };
});
const toScreen = (lat: number, lon: number) => {
  const p = toWorld(lat, lon, z.value);
  const n = TILE * 2 ** z.value;
  let x = p.x - origin.value.x;
  // wrap so markers near the date line show on the nearest copy of the world
  if (x < -n / 2 + W.value / 2 - W.value) x += n; else if (x > n / 2 + W.value) x -= n;
  return { x, y: p.y - origin.value.y };
};

// ── Tiles ───────────────────────────────────────────────────────────────────
const tileList = computed(() => {
  const zz = z.value; const n = 2 ** zz;
  const x0 = Math.floor(origin.value.x / TILE), x1 = Math.floor((origin.value.x + W.value) / TILE);
  const y0 = Math.max(0, Math.floor(origin.value.y / TILE)), y1 = Math.min(n - 1, Math.floor((origin.value.y + H.value) / TILE));
  const out: Array<{ k: string; url: string; style: Record<string, string> }> = [];
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
    const wx = ((tx % n) + n) % n;
    out.push({
      k: `${zz}/${tx}/${ty}`, url: `https://tile.openstreetmap.org/${zz}/${wx}/${ty}.png`,
      style: { transform: `translate(${tx * TILE - origin.value.x}px, ${ty * TILE - origin.value.y}px)` },
    });
  }
  return out;
});
function onTileError() { if (++failures >= 4) tilesFailed.value = true; }
watch(() => props.tiles, () => { failures = 0; tilesFailed.value = false; });

const gridStyle = computed(() => ({ backgroundSize: '64px 64px', backgroundPosition: `${-origin.value.x % 64}px ${-origin.value.y % 64}px` }));

// ── Markers ─────────────────────────────────────────────────────────────────
interface Item { key: string; kind: 'person' | 'meetup' | 'space'; id: string; title: string; sub: string }
interface Cluster { id: string; kind: 'person' | 'meetup' | 'space'; x: number; y: number; areaR: number; glyph: string; label: string; items: Item[] }

const me = computed(() => {
  if (!props.me) return { x: -99, y: -99, areaR: 0 };
  const c = home.value; const s = toScreen(c.lat, c.lon);
  return { ...s, areaR: (props.myPrec * 500) / metersPerPx(c.lat, z.value) };
});
const meShown = computed(() => !!props.me);
const ring = computed(() => {
  if (!props.me || props.radiusKm >= 20000) return 0;
  const r = (props.radiusKm * 1000) / metersPerPx(home.value.lat, z.value);
  return r > 8 && r < 4000 ? r : 0;
});

const clusters = computed<Cluster[]>(() => {
  const list: Cluster[] = [];
  const from = props.me ?? home.value;
  const add = (kind: Item['kind'], glyph: string, lat: number, lon: number, prec: number, item: Item) => {
    const s = toScreen(lat, lon);
    if (s.x < -40 || s.x > W.value + 40 || s.y < -40 || s.y > H.value + 40) return;
    const hit = list.find(c => c.kind === kind && Math.hypot(c.x - s.x, c.y - s.y) < 26);
    if (hit) { hit.items.push(item); hit.label = `${hit.items.length} ${kind === 'person' ? 'people' : kind === 'meetup' ? 'meetups' : 'spaces'}`; return; }
    list.push({ id: `${kind}:${item.key}`, kind, x: s.x, y: s.y, areaR: (prec * 500) / metersPerPx(lat, z.value), glyph, label: item.title, items: [item] });
  };
  for (const p of props.people) add('person', (p.name || '?').charAt(0).toUpperCase(), p.lat, p.lon, p.prec, {
    key: p.id, kind: 'person', id: p.id, title: p.name, sub: `${distanceLabel(haversineKm(from, p), p.prec)}${p.src === 'manual' ? ' · chosen city' : ''}`,
  });
  for (const m of props.meetups) add('meetup', '◆', m.lat, m.lon, m.prec, {
    key: m.hostId + m.id, kind: 'meetup', id: m.hostId, title: m.title, sub: `${new Date(m.when).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })} · ${m.place || 'Place TBA'}`,
  });
  for (const s of props.spaces) add('space', '#', s.lat, s.lon, s.prec, {
    key: s.id, kind: 'space', id: s.id, title: s.name, sub: s.desc || 'Local space',
  });
  return list;
});

const arcs = computed(() => {
  if (!props.me || !meShown.value) return [];
  return clusters.value.slice(0, 14).filter(c => Math.hypot(c.x - me.value.x, c.y - me.value.y) > 24).map(c => {
    const mx = (c.x + me.value.x) / 2, my = (c.y + me.value.y) / 2 - Math.hypot(c.x - me.value.x, c.y - me.value.y) * 0.22;
    return { id: c.id, d: `M${me.value.x},${me.value.y} Q${mx},${my} ${c.x},${c.y}` };
  });
});

// ── Dot-matrix land (private default: no network) ───────────────────────────
let raf = 0;
function drawDots() {
  raf = 0;
  const c = cv.value; if (!c) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  c.width = W.value * dpr; c.height = H.value * dpr;
  const g = c.getContext('2d'); if (!g) return;
  g.scale(dpr, dpr);
  const { w, h, data } = landGrid();
  const sp = 9; const n = TILE * 2 ** z.value;
  const ox = origin.value.x, oy = origin.value.y;
  for (let y = (-oy % sp + sp) % sp; y < H.value; y += sp) {
    const wy = y + oy; if (wy < 0 || wy > n) continue;
    const lat = fromWorld(0, wy, z.value).lat;
    if (lat < -58) continue; // Antarctica only adds noise in Mercator
    const r = Math.floor((90 - lat) / MASK_STEP);
    for (let x = (-ox % sp + sp) % sp; x < W.value; x += sp) {
      const lon = (((x + ox) / n) * 360 - 180 + 540) % 360 - 180;
      const col = Math.floor((lon + 180) / MASK_STEP);
      const land = r >= 0 && r < h && data[r * w + Math.min(w - 1, col)] === 1;
      g.fillStyle = land ? 'rgba(94,234,176,0.55)' : 'rgba(255,255,255,0.07)';
      g.beginPath(); g.arc(x, y, land ? 1.9 : 0.9, 0, 6.283); g.fill();
    }
  }
}
function scheduleDots() { if (!raf) raf = requestAnimationFrame(drawDots); }
watch(() => [origin.value.x, origin.value.y, z.value, W.value, H.value, props.tiles, tilesFailed.value], scheduleDots, { flush: 'post' });
watch(full, async () => { await nextTick(); if (el.value) { W.value = el.value.clientWidth; H.value = el.value.clientHeight; } reset(); scheduleDots(); });
function onKey(e: KeyboardEvent) { if (e.key === 'Escape' && full.value) full.value = false; }

const selected = ref<Cluster | null>(null);
function select(c: Cluster) { selected.value = c; }
watch(() => [props.people, props.meetups, props.spaces], () => {
  if (selected.value) selected.value = clusters.value.find(c => c.id === selected.value!.id) ?? null;
});

// ── Interaction ─────────────────────────────────────────────────────────────
let drag: { x: number; y: number; cx: number; cy: number } | null = null;
function onDown(e: PointerEvent) {
  (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  const c = toWorld(center.value.lat, center.value.lon, z.value);
  drag = { x: e.clientX, y: e.clientY, cx: c.x, cy: c.y };
}
function onMove(e: PointerEvent) {
  if (!drag) return;
  const n = TILE * 2 ** z.value;
  const y = Math.max(0, Math.min(n, drag.cy - (e.clientY - drag.y)));
  center.value = fromWorld(drag.cx - (e.clientX - drag.x), y, z.value);
  clampCenter();
}
function onUp() { drag = null; }
function zoom(d: number) { z.value = Math.max(minZoom.value, Math.min(maxZoom.value, z.value + d)); clampCenter(); }
let wheelAt = 0;
function onWheel(e: WheelEvent) { const t = Date.now(); if (t - wheelAt < 180) return; wheelAt = t; zoom(e.deltaY < 0 ? 1 : -1); }

let ro: ResizeObserver | null = null;
onMounted(() => {
  const measure = () => { if (el.value) { W.value = el.value.clientWidth || 640; H.value = el.value.clientHeight || 380; } };
  measure(); reset(); scheduleDots(); window.addEventListener('keydown', onKey);
  if (typeof ResizeObserver !== 'undefined' && el.value) { ro = new ResizeObserver(() => { measure(); if (z.value < minZoom.value) z.value = minZoom.value; clampCenter(); }); ro.observe(el.value); }
});
onBeforeUnmount(() => { ro?.disconnect(); window.removeEventListener('keydown', onKey); if (raf) cancelAnimationFrame(raf); });
watch(() => [props.me?.lat, props.me?.lon, props.radiusKm, props.myPrec], () => reset());
</script>

<style scoped>
.nm-wrap { display: flex; flex-direction: column; gap: 8px; }
.nm {
  position: relative; height: clamp(300px, 52vh, 460px); border-radius: 14px; overflow: hidden; touch-action: none; user-select: none; cursor: grab;
  background: #0c0f0d; border: 1px solid var(--app-border);
}
.nm:active { cursor: grabbing; }
.nm-tiles { position: absolute; inset: 0; filter: invert(1) hue-rotate(180deg) brightness(0.82) contrast(0.92) saturate(0.55); }
.nm-tiles img { position: absolute; left: 0; top: 0; width: 256px; height: 256px; max-width: none; will-change: transform; pointer-events: none; }
.nm-grid { position: absolute; inset: 0; background-image: linear-gradient(rgba(255,255,255,.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.05) 1px, transparent 1px); }
.nm-dots { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.nm-vignette { position: absolute; inset: 0; pointer-events: none; background: radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,.55) 100%); }
.nm-arc { fill: none; stroke: rgba(96,165,250,.55); stroke-width: 1.2; stroke-dasharray: 4 6; animation: nm-flow 1.6s linear infinite; }
@keyframes nm-flow { to { stroke-dashoffset: -20; } }
.nm-pin::after { content: ''; position: absolute; inset: -6px; border-radius: inherit; border: 2px solid currentColor; opacity: 0; animation: nm-pulse 2.4s ease-out infinite; color: var(--app-accent); }
.nm-pin--meetup::after { color: #fbbf24; } .nm-pin--space::after { color: #a78bfa; }
@keyframes nm-pulse { 0% { transform: scale(.7); opacity: .7; } 100% { transform: scale(1.6); opacity: 0; } }
.nm-wrap--full { position: fixed; inset: 0; z-index: 3000; padding: 12px; background: #070a09; }
.nm-wrap--full .nm { height: auto; flex: 1; min-height: 0; border-radius: 12px; }
.nm-svg { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.nm-ring { fill: rgba(var(--app-accent-rgb), .04); stroke: rgba(var(--app-accent-rgb), .45); stroke-width: 1.5; stroke-dasharray: 6 5; }
.nm-area { fill: rgba(var(--app-accent-rgb), .10); stroke: rgba(var(--app-accent-rgb), .35); stroke-width: 1; }
.nm-area--me { fill: rgba(96, 165, 250, .12); stroke: rgba(96, 165, 250, .55); }

.nm-me { position: absolute; transform: translate(-50%, -50%); pointer-events: none; display: flex; flex-direction: column; align-items: center; gap: 2px; }
.nm-me i { width: 14px; height: 14px; border-radius: 50%; background: #60a5fa; border: 2px solid #fff; box-shadow: 0 0 0 6px rgba(96,165,250,.25); }
.nm-me b { font-size: 10px; font-weight: 700; padding: 1px 6px; border-radius: 6px; background: rgba(0,0,0,.7); color: #fff; margin-top: 4px; }

.nm-pin {
  position: absolute; transform: translate(-50%, -50%); min-width: 30px; height: 30px; padding: 0 6px; border-radius: 50%; cursor: pointer;
  display: grid; place-items: center; font: inherit; font-size: 12px; font-weight: 800; color: #04120a;
  background: var(--app-accent); border: 2px solid #04120a; box-shadow: 0 2px 10px rgba(0,0,0,.5);
}
.nm-pin.sel { box-shadow: 0 0 0 4px rgba(var(--app-accent-rgb), .35), 0 2px 10px rgba(0,0,0,.5); }
.nm-pin--meetup { background: #fbbf24; border-radius: 8px; }
.nm-pin--space { background: #a78bfa; border-radius: 8px; }

.nm-stats { position: absolute; right: 12px; bottom: 12px; display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px; max-width: 80%; pointer-events: none; }
.nm-stats span { display: inline-flex; align-items: center; gap: 6px; padding: 5px 10px; border-radius: 999px; font-size: 11.5px; color: #cbd5d1; background: rgba(8,11,10,.72); border: 1px solid rgba(255,255,255,.12); backdrop-filter: blur(6px); }
.nm-stats i { width: 7px; height: 7px; border-radius: 50%; box-shadow: 0 0 8px currentColor; }
.nm-stats b { color: #fff; font-weight: 700; }
.nm-ctl { position: absolute; right: 10px; top: 10px; display: flex; flex-direction: column; gap: 4px; }
.nm-ctl button { width: 32px; height: 32px; border-radius: 8px; cursor: pointer; font-size: 16px; font-weight: 700; background: rgba(12,15,13,.85); border: 1px solid var(--app-border-strong); color: var(--app-text); }
.nm-ctl button:disabled { opacity: .35; cursor: default; }
.nm-attr { position: absolute; left: 8px; bottom: 6px; font-size: 10px; padding: 2px 6px; border-radius: 6px; background: rgba(0,0,0,.65); color: #cbd5d1; }
.nm-attr a { color: inherit; }

.nm-opt { display: flex; gap: 8px; align-items: flex-start; font-size: 12px; color: var(--app-text-muted); line-height: 1.4; }
.nm-opt input { margin-top: 2px; accent-color: var(--app-accent); }
.nm-opt small { color: var(--app-text-subtle); }

.nm-sheet { padding: 10px; border-radius: 12px; background: var(--app-bg-elevated); border: 1px solid var(--app-border); display: flex; flex-direction: column; gap: 4px; }
.nm-row { display: flex; align-items: center; gap: 10px; padding: 6px 4px; }
.nm-row__info { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.nm-row__info b { font-size: 13.5px; color: var(--app-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.nm-row__info small { font-size: 11.5px; color: var(--app-text-muted); }
.nm-btn { padding: 7px 12px; border-radius: 9px; cursor: pointer; font: inherit; font-size: 12.5px; font-weight: 650; background: rgba(255,255,255,.06); border: 1px solid var(--app-border); color: var(--app-text); }
.nm-x { width: 26px; height: 26px; border: none; border-radius: 8px; cursor: pointer; background: none; color: var(--app-text-subtle); }
.nm-close { align-self: flex-end; border: none; background: none; cursor: pointer; font: inherit; font-size: 12px; color: var(--app-text-subtle); }
</style>
