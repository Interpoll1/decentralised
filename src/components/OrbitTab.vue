<template>
  <Teleport to="body" :disabled="!ambient">
  <div class="orbit" :class="{ 'orbit--ambient': ambient }">
    <!-- Header -->
    <div v-if="!ambient" class="ob-head">
      <div class="ob-seg" role="tablist" aria-label="Orbit view">
        <button class="ob-seg__btn" :class="{ on: view === 'map' }" role="tab" :aria-selected="view === 'map'" @click="$emit('update:view', 'map')">Map</button>
        <button class="ob-seg__btn" :class="{ on: view === 'spaces' }" role="tab" :aria-selected="view === 'spaces'" @click="$emit('update:view', 'spaces')">Spaces</button>
      </div>
      <button v-if="view === 'map'" class="ob-ghost" @click="ambient = true" aria-label="Ambient mode">Ambient</button>
    </div>

    <!-- Spaces list (the old Spaces tab lives here) -->
    <CommunitiesTab
      v-if="view === 'spaces'"
      :communityFilter="communityFilter"
      @update:communityFilter="$emit('update:communityFilter', $event)"
    />

    <!-- Map -->
    <template v-else>
      <div v-if="!ambient" class="ob-stats" aria-live="polite">
        <span class="ob-stat"><i :style="{ background: C.relayOn }"></i>{{ relaysOnline }}/{{ relayCount }} relays</span>
        <span class="ob-stat"><i :style="{ background: C.p2p }"></i>{{ peerList.length }} peers</span>
        <span class="ob-stat"><i :style="{ background: C.dm }"></i>{{ p2pCount }} direct</span>
        <span v-if="scrubbing" class="ob-stat ob-stat--replay">Replay · {{ scrubLabel }}</span>
      </div>

      <p v-if="!ambient" class="ob-hint">You're in the middle. <b>Tap any dot</b> to open it · drag to move · pinch or +/− to zoom.</p>
      <ul v-if="!ambient" class="ob-legend" aria-label="Legend">
        <li><i :style="{ background: C.relayOn }"></i>Relay</li>
        <li><i :style="{ background: C.p2p }"></i>Peer</li>
        <li><i :style="{ background: C.space }"></i>Space</li>
        <li><i :style="{ background: C.dm }"></i>Contact</li>
      </ul>

      <div ref="stage" class="ob-stage">
        <svg
          ref="svgEl"
          class="ob-svg"
          :viewBox="`0 0 ${VW} ${VH}`"
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label="Map of your relays, peers, spaces and contacts"
          @pointerdown="onDown"
          @pointermove="onMove"
          @pointerup="onUp"
          @pointercancel="onUp"
          @wheel.prevent="onWheel"
          @click="onBgClick"
        >
          <defs>
            <radialGradient id="ob-glow"><stop offset="0" stop-color="var(--app-accent, #7dd3fc)" stop-opacity=".4" /><stop offset="1" stop-color="var(--app-accent, #7dd3fc)" stop-opacity="0" /></radialGradient>
          </defs>

          <g :transform="`translate(${tx} ${ty}) translate(${CX} ${CY}) scale(${scale}) translate(${-CX} ${-CY})`">
            <circle :cx="CX" :cy="CY" :r="RINGS[1] + 22" fill="url(#ob-glow)" />
            <circle v-for="(r, i) in RINGS" :key="'ring' + i" :cx="CX" :cy="CY" :r="r" class="ob-ring" />
            <text v-for="(r, i) in RINGS" :key="'rn' + i" :x="CX" :y="CY - r - 3" text-anchor="middle" class="ob-ringname">{{ RING_NAMES[i] }}</text>

            <!-- Links -->
            <line
              v-for="n in nodes" :key="'l' + n.id"
              class="ob-link" :class="{ 'ob-link--solid': n.solid, 'ob-link--hot': n.hot }"
              :x1="CX" :y1="CY" :x2="P(n).x" :y2="P(n).y"
            />

            <!-- Pulses -->
            <circle v-for="p in pulseDots" :key="p.id" :cx="p.x" :cy="p.y" :r="p.r" :fill="p.color" :opacity="p.o" />

            <!-- Nodes -->
            <g
              v-for="n in nodes" :key="n.id"
              class="ob-node" :class="{ 'ob-node--sel': selected?.id === n.id }"
              :transform="`translate(${P(n).x} ${P(n).y})`"
              role="button" tabindex="0" :aria-label="n.title"
              @click.stop="pick(n)" @keydown.enter.stop="pick(n)"
            >
              <circle v-if="n.glow" class="ob-halo" :r="n.r + 7" :fill="n.color" />
              <circle :r="n.r" :fill="n.color" :stroke="selected?.id === n.id ? '#fff' : 'rgba(255,255,255,.18)'" stroke-width="1.5" />
              <text v-if="n.badge" class="ob-badge" y="3.5" text-anchor="middle">{{ n.badge }}</text>
              <text v-if="showLabel(n)" class="ob-label" :y="n.r + 12" text-anchor="middle">{{ n.label }}</text>
            </g>

            <!-- You -->
            <g class="ob-you" @click.stop="pick(youNode)" role="button" tabindex="0" aria-label="You" @keydown.enter.stop="pick(youNode)">
              <circle :cx="CX" :cy="CY" r="24" class="ob-you__dot" />
              <text :x="CX" :y="CY + 4" text-anchor="middle" class="ob-you__txt">You</text>
            </g>
          </g>
        </svg>

        <!-- Zoom controls -->
        <div class="ob-zoom">
          <button aria-label="Zoom in" @click="zoomBy(1.25)">+</button>
          <button aria-label="Zoom out" @click="zoomBy(0.8)">−</button>
          <button aria-label="Reset view" @click="resetView">⟲</button>
        </div>

        <button v-if="ambient" class="ob-exit" @click="ambient = false">← Back</button>

        <!-- Legend when empty -->

        <!-- Tap sheet (inside the stage so it is always on screen) -->
      <Transition name="ob-sheet">
        <section v-if="selected" class="ob-sheet" @click.stop>
          <header class="ob-sheet__head">
            <span class="ob-sheet__dot" :style="{ background: selected.color }"></span>
            <div class="ob-sheet__titles">
              <strong>{{ selected.title }}</strong>
              <small>{{ selected.sub }}</small>
            </div>
            <button class="ob-sheet__x" aria-label="Close" @click="selected = null">✕</button>
          </header>
          <ul v-if="selected.facts?.length" class="ob-facts">
            <li v-for="f in selected.facts" :key="f[0]"><span>{{ f[0] }}</span><b>{{ f[1] }}</b></li>
          </ul>
          <div class="ob-actions">
            <button v-for="a in actionsFor(selected)" :key="a.label" class="ob-btn" :class="{ 'ob-btn--primary': a.primary }" :disabled="busy" @click="a.run()">{{ a.label }}</button>
          </div>
        </section>
      </Transition>

        <p v-if="!ambient && !nodes.length" class="ob-empty">Nothing to show yet — connect to a relay or join a space.</p>
      </div>

      <!-- Time scrub -->
      <div v-if="!ambient && history.length > 2" class="ob-scrub">
        <button class="ob-ghost" :class="{ on: !scrubbing }" @click="scrub = null">Live</button>
        <input
          type="range" min="0" :max="history.length - 1" step="1"
          :value="scrub ?? history.length - 1"
          aria-label="Replay the last few minutes"
          @input="scrub = Math.min(history.length - 1, Number(($event.target as HTMLInputElement).value)); if (scrub === history.length - 1) scrub = null"
        />
      </div>

    </template>
  </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, defineAsyncComponent } from 'vue';
import { useRouter } from 'vue-router';
import { RelayManager, type RelayEndpoint } from '../services/relayManager';
import { WebSocketService } from '../services/websocketService';
import { WebRTCService } from '../services/webrtcService';
import { PeerReputationService } from '../services/peerReputationService';
import { useCommunityStore } from '../stores/communityStore';

const CommunitiesTab = defineAsyncComponent(() => import('./CommunitiesTab.vue'));

interface ChatEntry { userId: string; name: string; nickname?: string; unreadCount: number; lastMessageTime: number }

const props = defineProps<{
  chatList: ChatEntry[];
  communityFilter: 'all' | 'joined' | 'private';
  view: 'map' | 'spaces';
}>();
defineEmits<{
  (e: 'update:communityFilter', v: 'all' | 'joined' | 'private'): void;
  (e: 'update:view', v: 'map' | 'spaces'): void;
}>();

const router = useRouter();
const communityStore = useCommunityStore();

// ── Geometry (virtual units; the SVG scales to fit) ───────────────────────
const VW = 420, VH = 420, CX = 210, CY = 210;
const RINGS = [54, 96, 136, 176];            // relays · peers · spaces · contacts
const PHASE = [-Math.PI / 2, 0.35, 1.1, 2.0];
const SPEED = [0.05, -0.034, 0.024, -0.017];  // rad/s, gentle drift
const RING_NAMES = ['Relays', 'Peers', 'Spaces', 'Contacts'];
const MAX_PEERS = 20, MAX_SPACES = 10, MAX_CONTACTS = 8;

const C = {
  relayOn: '#4ade80', relayWarn: '#fbbf24', relayOff: '#f87171', relayUnk: '#94a3b8',
  p2p: '#7dd3fc', viaRelay: '#a5b4fc', trusted: '#4ade80', neutral: '#7dd3fc', shaky: '#fbbf24',
  space: '#86efac', dm: '#f9a8d4',
};

const reduced = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// ── Live data ─────────────────────────────────────────────────────────────
const relays = ref<RelayEndpoint[]>([]);
const wsPeers = ref<string[]>([]);
const rtcPeers = ref<string[]>([]);
const wsConnected = ref(false);
const offs: Array<() => void> = [];

function readRelays() { try { relays.value = [...RelayManager.getRelayList()]; } catch { relays.value = []; } }

// ── Replay history (this session only) ────────────────────────────────────
interface Snap { t: number; relays: Array<{ id: string; label: string; status: string; latencyMs?: number; ws: string }>; peers: Array<{ id: string; p2p: boolean }> }
const history = ref<Snap[]>([]);
const scrub = ref<number | null>(null);
const scrubbing = computed(() => scrub.value !== null);

function liveSnap(): Snap {
  const p2p = new Set(rtcPeers.value);
  const ids = Array.from(new Set([...wsPeers.value, ...rtcPeers.value]));
  return {
    t: Date.now(),
    relays: relays.value.map(r => ({ id: r.id, label: r.label, status: r.status, latencyMs: r.latencyMs, ws: r.ws })),
    peers: ids.map(id => ({ id, p2p: p2p.has(id) })),
  };
}
function record() {
  const s = liveSnap();
  const last = history.value[history.value.length - 1];
  const sig = (x: Snap) => x.relays.map(r => r.id + r.status).join() + '|' + x.peers.map(p => p.id + (p.p2p ? 1 : 0)).join();
  if (last && sig(last) === sig(s) && s.t - last.t < 15_000) return;
  const next = [...history.value, s];
  history.value = next.length > 180 ? next.slice(next.length - 180) : next;
}
const view$ = computed<Snap>(() => (scrub.value !== null && history.value[scrub.value]) ? history.value[scrub.value] : liveSnap());
const scrubLabel = computed(() => {
  if (scrub.value === null || !history.value.length) return 'live';
  const secs = Math.round((Date.now() - history.value[scrub.value].t) / 1000);
  return secs < 60 ? `${secs}s ago` : `${Math.floor(secs / 60)}m ${secs % 60}s ago`;
});

// ── Node model ────────────────────────────────────────────────────────────
interface ONode {
  id: string; kind: 'relay' | 'peer' | 'space' | 'contact' | 'more' | 'you';
  ring: number; i: number; n: number;
  r: number; color: string; label: string; title: string; sub: string;
  badge?: string; glow?: boolean; solid?: boolean; hot?: boolean;
  facts?: Array<[string, string]>; ref?: any;
}

function relayColor(s: string) { return s === 'online' ? C.relayOn : s === 'degraded' ? C.relayWarn : s === 'offline' ? C.relayOff : C.relayUnk; }
function trustColor(score: number) { return score >= 0.7 ? C.trusted : score >= 0.4 ? C.neutral : C.shaky; }
function short(id: string, n = 8) { return id.length > n ? id.slice(0, n) : id; }
function host(url: string) { try { return new URL(url).host; } catch { return url; } }

const pulseHot = ref(new Set<string>());

const nodes = computed<ONode[]>(() => {
  const out: ONode[] = [];
  const snap = view$.value;

  // Ring 0 — relays
  snap.relays.forEach((r, i) => out.push({
    id: `relay:${r.id}`, kind: 'relay', ring: 0, i, n: snap.relays.length,
    r: 11, color: relayColor(r.status), label: short(r.label || host(r.ws), 9), title: r.label || host(r.ws),
    sub: `Relay · ${r.status}`, solid: true, glow: r.status === 'online',
    facts: [['Status', r.status], ['Latency', r.latencyMs != null ? `${r.latencyMs} ms` : '—'], ['Host', host(r.ws)]], ref: r,
  }));

  // Ring 1 — peers (stable order by id; direct links first when capped)
  const sorted = [...snap.peers].sort((a, b) => Number(b.p2p) - Number(a.p2p) || a.id.localeCompare(b.id));
  const shown = sorted.slice(0, MAX_PEERS).sort((a, b) => a.id.localeCompare(b.id));
  const extra = sorted.length - shown.length;
  const total = shown.length + (extra > 0 ? 1 : 0);
  shown.forEach((p, i) => {
    const score = PeerReputationService.scoreFor(p.id);
    out.push({
      id: `peer:${p.id}`, kind: 'peer', ring: 1, i, n: total,
      r: 4.5 + score * 3.5, color: trustColor(score), label: short(p.id, 6), title: `Peer ${short(p.id, 10)}`,
      sub: p.p2p ? 'Direct (WebRTC)' : 'Via relay', solid: p.p2p, hot: pulseHot.value.has(`peer:${p.id}`),
      facts: [['Link', p.p2p ? 'Direct peer-to-peer' : 'Through the relay'], ['Reputation', `${Math.round(score * 100)}%`], ['ID', short(p.id, 14)]], ref: p,
    });
  });
  if (extra > 0) out.push({
    id: 'peer:more', kind: 'more', ring: 1, i: shown.length, n: total, r: 9, color: '#475569', badge: `+${extra}`,
    label: '', title: `${extra} more peers`, sub: 'Not drawn to keep the map readable',
  });

  // Ring 2 — joined spaces
  const spaces = communityStore.communities.filter((c: any) => communityStore.isJoined(c.id)).slice(0, MAX_SPACES);
  spaces.forEach((c: any, i: number) => out.push({
    id: `space:${c.id}`, kind: 'space', ring: 2, i, n: spaces.length,
    r: 7 + Math.min(5, Math.log10(Math.max(1, c.memberCount || 1)) * 2), color: C.space,
    label: short(c.displayName || c.name || c.id, 9), title: c.displayName || c.name || c.id, sub: 'Space',
    hot: pulseHot.value.has(`space:${c.id}`), glow: pulseHot.value.has(`space:${c.id}`),
    facts: [['Members', String(c.memberCount ?? 0)], ['Posts', String(c.postCount ?? 0)]], ref: c,
  }));

  // Ring 3 — recent contacts
  const contacts = [...(props.chatList || [])].sort((a, b) => b.lastMessageTime - a.lastMessageTime).slice(0, MAX_CONTACTS);
  contacts.forEach((c, i) => {
    const name = c.nickname || c.name || short(c.userId, 8);
    out.push({
      id: `contact:${c.userId}`, kind: 'contact', ring: 3, i, n: contacts.length, r: 7, color: C.dm,
      label: short(name, 9), title: name, sub: c.unreadCount > 0 ? `${c.unreadCount} unread` : 'Contact',
      glow: c.unreadCount > 0, hot: c.unreadCount > 0, badge: c.unreadCount > 0 ? String(Math.min(99, c.unreadCount)) : undefined,
      facts: [['Unread', String(c.unreadCount || 0)]], ref: c,
    });
  });
  return out;
});

const youNode = computed<ONode>(() => ({
  id: 'you', kind: 'you', ring: 0, i: 0, n: 1, r: 24, color: 'var(--app-accent, #7dd3fc)', label: 'You', title: 'You',
  sub: wsConnected.value ? 'Connected to your relay' : 'Not connected to a relay',
  facts: [['Relays online', `${relaysOnline.value}/${relayCount.value}`], ['Peers seen', String(peerList.value.length)], ['Direct links', String(p2pCount.value)]],
}));

const peerList = computed(() => view$.value.peers);
const p2pCount = computed(() => view$.value.peers.filter(p => p.p2p).length);
const relayCount = computed(() => view$.value.relays.length);
const relaysOnline = computed(() => view$.value.relays.filter(r => r.status === 'online').length);

// ── Animation loop (drift + pulses) ───────────────────────────────────────
const tick = ref(0);                       // seconds, drives drift
const driftOn = computed(() => !reduced);
interface Pulse { id: number; node: string; t0: number; dur: number; color: string; out?: boolean }
const pulses = ref<Pulse[]>([]);
let pid = 0, raf = 0, lastFrame = 0, t0 = performance.now();

function addPulse(nodeId: string, color: string, out = false) {
  if (reduced || scrubbing.value || document.hidden) return;
  if (pulses.value.length > 24) return;
  pulses.value.push({ id: ++pid, node: nodeId, t0: performance.now(), dur: 1400, color, out });
}
function flash(nodeId: string) {
  pulseHot.value = new Set(pulseHot.value).add(nodeId);
  setTimeout(() => { const s = new Set(pulseHot.value); s.delete(nodeId); pulseHot.value = s; }, 2500);
}

function frame(now: number) {
  raf = requestAnimationFrame(frame);
  if (document.hidden || now - lastFrame < 33) return;       // ~30 fps is plenty
  lastFrame = now;
  if (driftOn.value) tick.value = (now - t0) / 1000 * (ambient.value ? 0.6 : 1);
  if (pulses.value.length) pulses.value = pulses.value.filter(p => now - p.t0 < p.dur);
  nowMs.value = now;
}
const nowMs = ref(performance.now());

function P(n: ONode) {
  const a = (n.i / Math.max(1, n.n)) * Math.PI * 2 + PHASE[n.ring] + (driftOn.value ? tick.value * SPEED[n.ring] : 0);
  const r = RINGS[n.ring];
  return { x: CX + Math.cos(a) * r, y: CY + Math.sin(a) * r };
}

const pulseDots = computed(() => {
  const now = nowMs.value;
  const out: Array<{ id: number; x: number; y: number; r: number; o: number; color: string }> = [];
  for (const p of pulses.value) {
    const n = nodes.value.find(x => x.id === p.node);
    if (!n) continue;
    const k = Math.min(1, (now - p.t0) / p.dur), e = k * k * (3 - 2 * k);
    const from = P(n);
    const a = p.out ? { x: CX, y: CY } : from, b = p.out ? from : { x: CX, y: CY };
    out.push({ id: p.id, x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e, r: 3.2 * (1 - k * 0.4), o: 1 - k * 0.8, color: p.color });
  }
  return out;
});

// ── Pulse sources (all real events) ───────────────────────────────────────
// 1. Heartbeat along the active relay's link while the socket is up.
let beat: ReturnType<typeof setInterval> | null = null;
function heartbeat() {
  if (!wsConnected.value) return;
  const active = RelayManager.getActiveRelay?.();
  const id = active ? `relay:${active.id}` : nodes.value.find(n => n.kind === 'relay' && n.color === C.relayOn)?.id;
  if (id) addPulse(id, C.relayOn);
}
// 2. A new peer appears.
watch(() => [...wsPeers.value, ...rtcPeers.value].join(','), (cur, prev) => {
  const before = new Set((prev || '').split(',').filter(Boolean));
  for (const id of cur.split(',').filter(Boolean)) if (!before.has(id)) { addPulse(`peer:${id}`, C.p2p); flash(`peer:${id}`); }
  record();
});
// 3. Unread messages arrive.
const lastUnread = new Map<string, number>();
watch(() => props.chatList.map(c => `${c.userId}:${c.unreadCount}`).join(), () => {
  for (const c of props.chatList) {
    const prev = lastUnread.get(c.userId);
    if (prev !== undefined && c.unreadCount > prev) addPulse(`contact:${c.userId}`, C.dm);
    lastUnread.set(c.userId, c.unreadCount);
  }
}, { immediate: true });
// 4. A joined space gets a new post.
const lastPosts = new Map<string, number>();
watch(() => communityStore.communities.map((c: any) => `${c.id}:${c.postCount ?? 0}`).join(), () => {
  for (const c of communityStore.communities as any[]) {
    const prev = lastPosts.get(c.id);
    if (prev !== undefined && (c.postCount ?? 0) > prev && communityStore.isJoined(c.id)) { addPulse(`space:${c.id}`, C.space); flash(`space:${c.id}`); }
    lastPosts.set(c.id, c.postCount ?? 0);
  }
}, { immediate: true });
watch(relays, record, { deep: true });

// ── Pan / zoom ────────────────────────────────────────────────────────────
const stage = ref<HTMLElement | null>(null);
const svgEl = ref<SVGSVGElement | null>(null);
const scale = ref(1), tx = ref(0), ty = ref(0);
const ptrs = new Map<number, { x: number; y: number }>();
let pinchDist = 0, dragged = false, downX = 0, downY = 0;

function unit() {
  const r = svgEl.value?.getBoundingClientRect();
  return r ? Math.min(r.width / VW, r.height / VH) || 1 : 1;
}
function clampView() {
  scale.value = Math.min(3, Math.max(0.6, scale.value));
  tx.value = Math.min(260, Math.max(-260, tx.value));
  ty.value = Math.min(320, Math.max(-320, ty.value));
}
function onDown(e: PointerEvent) {
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (ptrs.size === 1) { dragged = false; downX = e.clientX; downY = e.clientY; }
  if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinchDist = Math.hypot(a.x - b.x, a.y - b.y); }
}
function onMove(e: PointerEvent) {
  const prev = ptrs.get(e.pointerId);
  if (!prev) return;
  const cur = { x: e.clientX, y: e.clientY };
  ptrs.set(e.pointerId, cur);
  if (ptrs.size === 2) {
    const [a, b] = [...ptrs.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinchDist) scale.value *= d / pinchDist;
    pinchDist = d; dragged = true; clampView();
    return;
  }
  if (Math.hypot(cur.x - downX, cur.y - downY) > 6) dragged = true;
  if (dragged) { const k = unit(); tx.value += (cur.x - prev.x) / k; ty.value += (cur.y - prev.y) / k; clampView(); }
}
function onUp(e: PointerEvent) { ptrs.delete(e.pointerId); pinchDist = 0; }
function onWheel(e: WheelEvent) { scale.value *= e.deltaY < 0 ? 1.1 : 0.9; clampView(); }
function zoomBy(f: number) { scale.value *= f; clampView(); }
function resetView() { scale.value = 1; tx.value = 0; ty.value = 0; }

/** Semantic zoom: peer names only appear once you zoom in; everything else always has a name. */
function showLabel(n: ONode) {
  if (!n.label) return false;
  if (n.kind === 'peer') return scale.value >= 1.5;
  return scale.value >= 0.8;
}

// ── Selection + actions ───────────────────────────────────────────────────
const selected = ref<ONode | null>(null);
const busy = ref(false);
function onBgClick() { if (!dragged) selected.value = null; }
function pick(n: ONode) { if (dragged) return; selected.value = n; }

async function guard(fn: () => unknown) {
  busy.value = true;
  try { await fn(); } catch { /* the sheet simply stays; services surface their own errors */ } finally { busy.value = false; readRelays(); record(); }
}

function actionsFor(n: ONode): Array<{ label: string; primary?: boolean; run: () => void }> {
  switch (n.kind) {
    case 'relay': {
      const active = RelayManager.getActiveRelay?.()?.id === n.ref.id;
      return [
        ...(active ? [] : [{ label: 'Use this relay', primary: true, run: () => void guard(() => RelayManager.switchToRelay(n.ref.id)) }]),
        { label: 'Relay settings', run: () => void router.push('/network') },
      ];
    }
    case 'peer':
      return n.ref.p2p
        ? [{ label: 'Disconnect direct link', run: () => void guard(() => { WebRTCService.disconnectPeer(n.ref.id); rtcPeers.value = WebRTCService.getConnectedPeers(); }) }]
        : [{ label: 'Connect directly', primary: true, run: () => void guard(() => WebRTCService.connectToPeer(n.ref.id)) }];
    case 'space':
      return [{ label: 'Open space', primary: true, run: () => void router.push(`/community/${n.ref.id}`) }];
    case 'contact':
      return [{ label: 'Message', primary: true, run: () => void router.push(`/chat/${n.ref.userId}`) }];
    case 'you':
      return [{ label: 'Network details', run: () => void router.push('/network') }];
    default:
      return [];
  }
}

// ── Ambient mode ──────────────────────────────────────────────────────────
const ambient = ref(false);
watch(ambient, (on) => { if (on) { selected.value = null; scrub.value = null; resetView(); } });

function onKey(e: KeyboardEvent) {
  if (e.key !== 'Escape') return;
  if (ambient.value) ambient.value = false;
  else if (selected.value) selected.value = null;
}

// ── Lifecycle ─────────────────────────────────────────────────────────────
let sampler: ReturnType<typeof setInterval> | null = null;
onMounted(() => {
  window.addEventListener('keydown', onKey);
  readRelays();
  try { offs.push(RelayManager.onRelayListChange(() => readRelays())); } catch { /* optional */ }
  try {
    offs.push(WebSocketService.onStatusChange((s) => { wsConnected.value = s.connected; wsPeers.value = WebSocketService.getPeerIds(); }));
  } catch { /* optional */ }
  try {
    rtcPeers.value = WebRTCService.getConnectedPeers();
    offs.push(WebRTCService.onPeersChange((p) => { rtcPeers.value = [...p]; }));
  } catch { /* optional */ }
  record();
  sampler = setInterval(() => { wsPeers.value = WebSocketService.getPeerIds(); record(); }, 5000);
  beat = setInterval(heartbeat, 2600);
  raf = requestAnimationFrame(frame);
});
onUnmounted(() => {
  window.removeEventListener('keydown', onKey);
  offs.forEach(f => { try { f(); } catch { /* ignore */ } });
  if (sampler) clearInterval(sampler);
  if (beat) clearInterval(beat);
  cancelAnimationFrame(raf);
});
</script>

<style scoped>
.orbit { display: flex; flex-direction: column; gap: 10px; padding: 4px 0 12px; }
.orbit--ambient { position: fixed; inset: 0; z-index: 9000; background: var(--app-bg, #0b0c0f); padding: 0; gap: 0; }

.ob-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 0 2px; }
.ob-seg { display: inline-flex; padding: 3px; border-radius: 999px; background: rgba(255,255,255,.06); }
.ob-seg__btn { border: 0; background: transparent; color: rgba(255,255,255,.6); font: inherit; font-size: 13px; font-weight: 600; padding: 6px 16px; border-radius: 999px; cursor: pointer; }
.ob-seg__btn.on { background: rgba(255,255,255,.14); color: #fff; }
.ob-ghost { border: 1px solid rgba(255,255,255,.12); background: transparent; color: rgba(255,255,255,.75); font: inherit; font-size: 12px; padding: 5px 12px; border-radius: 999px; cursor: pointer; }
.ob-ghost.on { background: rgba(74,222,128,.14); color: #86efac; border-color: rgba(74,222,128,.35); }

.ob-stats { display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: 12px; color: rgba(255,255,255,.65); padding: 0 4px; }
.ob-stat { display: inline-flex; align-items: center; gap: 6px; }
.ob-stat i { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
.ob-stat--replay { color: #fcd34d; }

.ob-stage { position: relative; flex: none; width: 100%; height: clamp(340px, calc(100vh - 320px), 620px); border-radius: 18px; background: radial-gradient(ellipse at center, rgba(255,255,255,.035), rgba(255,255,255,0) 70%); border: 1px solid rgba(255,255,255,.06); overflow: hidden; }
.orbit--ambient .ob-stage { flex: 1; height: 100%; border: 0; border-radius: 0; }
.ob-svg { width: 100%; height: 100%; display: block; touch-action: none; user-select: none; -webkit-user-select: none; cursor: grab; }
.ob-svg:active { cursor: grabbing; }

.ob-ring { fill: none; stroke: rgba(255,255,255,.07); stroke-dasharray: 2 6; }
.ob-link { stroke: rgba(255,255,255,.09); stroke-width: 1; stroke-dasharray: 3 4; }
.ob-link--solid { stroke: rgba(125,211,252,.35); stroke-dasharray: none; }
.ob-link--hot { stroke: rgba(255,255,255,.4); }
.ob-node { cursor: pointer; outline: none; }
.ob-node:focus-visible circle:last-of-type { stroke: #fff; }
.ob-halo { opacity: .22; animation: ob-breathe 2.4s ease-in-out infinite; }
.ob-label { font-size: 8.5px; fill: rgba(255,255,255,.72); pointer-events: none; font-family: inherit; }
.ob-badge { font-size: 9px; font-weight: 800; fill: #0b0c0f; pointer-events: none; font-family: inherit; }
.ob-you { cursor: pointer; outline: none; }
.ob-you__dot { fill: var(--app-accent, #7dd3fc); }
.ob-you__txt { font-size: 11px; font-weight: 800; fill: #04141c; pointer-events: none; font-family: inherit; }

.ob-zoom { position: absolute; right: 10px; bottom: 10px; display: flex; flex-direction: column; gap: 6px; }
.ob-zoom button { width: 34px; height: 34px; border-radius: 10px; border: 1px solid rgba(255,255,255,.12); background: rgba(20,21,26,.8); color: #fff; font-size: 16px; cursor: pointer; }
.ob-exit { position: absolute; z-index: 5; top: calc(12px + env(safe-area-inset-top)); left: 12px; border: 1px solid rgba(255,255,255,.18); background: rgba(20,21,26,.7); color: #fff; border-radius: 999px; padding: 6px 14px; font: inherit; font-size: 12px; cursor: pointer; }
.ob-hint { margin: 0; padding: 0 4px; font-size: 12px; color: rgba(255,255,255,.6); }
.ob-hint b { color: #fff; font-weight: 600; }
.ob-legend { list-style: none; margin: 0; padding: 0 4px; display: flex; gap: 14px; font-size: 11px; color: rgba(255,255,255,.55); }
.ob-legend li { display: inline-flex; align-items: center; gap: 5px; }
.ob-legend i { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
.ob-ringname { font-size: 7px; letter-spacing: .12em; text-transform: uppercase; fill: rgba(255,255,255,.28); pointer-events: none; font-family: inherit; }
.ob-empty { position: absolute; inset: auto 0 18px 0; text-align: center; font-size: 12px; color: rgba(255,255,255,.5); }

.ob-scrub { display: flex; align-items: center; gap: 10px; padding: 0 4px; }
.ob-scrub input { flex: 1; accent-color: var(--app-accent, #7dd3fc); }

.ob-sheet { position: absolute; z-index: 4; left: 10px; right: 56px; bottom: calc(10px + env(safe-area-inset-bottom)); border-radius: 16px; padding: 12px 14px; background: rgba(24,25,31,.96); border: 1px solid rgba(255,255,255,.09); box-shadow: 0 10px 30px rgba(0,0,0,.4); }
.ob-sheet__head { display: flex; align-items: center; gap: 10px; }
.ob-sheet__dot { width: 12px; height: 12px; border-radius: 50%; flex: none; }
.ob-sheet__titles { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.ob-sheet__titles strong { font-size: 14px; color: #fff; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ob-sheet__titles small { font-size: 11px; color: rgba(255,255,255,.55); }
.ob-sheet__x { border: 0; background: transparent; color: rgba(255,255,255,.6); font-size: 14px; cursor: pointer; padding: 4px; }
.ob-facts { list-style: none; margin: 10px 0 0; padding: 0; display: grid; gap: 4px; }
.ob-facts li { display: flex; justify-content: space-between; font-size: 12px; color: rgba(255,255,255,.6); }
.ob-facts b { color: #fff; font-weight: 600; }
.ob-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
.ob-btn { flex: 1; min-width: 120px; border: 1px solid rgba(255,255,255,.14); background: rgba(255,255,255,.06); color: #fff; font: inherit; font-size: 13px; font-weight: 600; padding: 9px 12px; border-radius: 11px; cursor: pointer; }
.ob-btn--primary { background: var(--app-accent, #7dd3fc); color: #04141c; border-color: transparent; }
.ob-btn:disabled { opacity: .5; }

.ob-sheet-enter-active, .ob-sheet-leave-active { transition: opacity 160ms, transform 160ms; }
.ob-sheet-enter-from, .ob-sheet-leave-to { opacity: 0; transform: translateY(8px); }
@keyframes ob-breathe { 0%, 100% { opacity: .12; } 50% { opacity: .32; } }
@media (prefers-reduced-motion: reduce) { .ob-halo { animation: none; } .ob-sheet-enter-active, .ob-sheet-leave-active { transition: none; } }
</style>