<template>
  <ion-footer class="bottom-nav-footer" :class="{ 'footer-hidden': hidden && !drag.active }">
    <div ref="navEl" class="bottom-nav" data-tour="bottom-nav">
      <button
        v-for="(item, index) in navStore.items"
        :key="item.id"
        class="nav-item"
        :class="{
          active: !drag.active && isActive(item),
          'nav-item--fab': item.id === 'create',
          'nav-item--lifted': drag.active && drag.from === index,
          'nav-item--target': drag.active && drag.overSlot === index,
        }"
        :data-nav-index="index"
        :data-tour="item.id"
        :aria-label="item.label"
        :aria-current="!drag.active && isActive(item) ? 'page' : undefined"
        @click="onItemClick(item)"
        @pointerdown="onPointerDown($event, index)"
        @keydown.alt.left.prevent="nudge(index, -1)"
        @keydown.alt.right.prevent="nudge(index, 1)"
        @contextmenu.prevent
      >
        <span class="nav-icon-wrap">
          <!-- Publish: raised round button sitting in a curved notch of the bar -->
          <template v-if="item.id === 'create'">
            <span class="nav-fab-bump" aria-hidden="true"></span>
            <span class="nav-fab" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 3.5v8M2.5 7.5h8"/><path d="M20.4 8.1l-9.9 9.9-3.6.9.9-3.6 9.9-9.9a1.9 1.9 0 012.7 2.7z"/></svg>
            </span>
          </template>
          <template v-else>
            <NavIcon :id="item.id" :active="!drag.active && isActive(item)" />
            <!-- Network: live relay status dot on the icon -->
            <RelayIndicator v-if="item.id === 'network' && !drag.active" :compact="true" class="nav-live" />
          </template>
          <span v-if="item.id === 'chat' && unread > 0" class="nav-badge nav-badge--mobile">
            {{ unread > 99 ? '99+' : unread }}
          </span>
        </span>
        <span class="nav-label">{{ item.label }}</span>
      </button>
    </div>

    <!-- Drag layer: the lifted tab following your finger. Teleported because the footer clips overflow. -->
    <Teleport to="body">
      <div v-if="drag.active && draggedItem" class="nav-drag-layer" aria-hidden="true">
        <div class="nav-ghost" :style="ghostStyle">
          <span class="nav-ghost__icon"><NavIcon :id="draggedItem.id" :active="true" /></span>
          <span class="nav-ghost__label">{{ draggedItem.label }}</span>
        </div>
      </div>
    </Teleport>
  </ion-footer>
</template>

<script setup lang="ts">
import { ref, reactive, computed, defineAsyncComponent, nextTick, onUnmounted } from 'vue';
import { IonFooter } from '@ionic/vue';
import { useRouter } from 'vue-router';
import { useNavStore, type NavItemDef } from '../stores/navStore';
import NavIcon from './NavIcon.vue';

const RelayIndicator = defineAsyncComponent(() => import('./RelayIndicator.vue'));

const props = defineProps<{
  activeTab: string;
  totalUnread?: number;
  hidden?: boolean;
}>();

const emit = defineEmits<{ (e: 'update:activeTab', tab: string): void }>();

const router   = useRouter();
const navStore = useNavStore();
const navEl    = ref<HTMLElement | null>(null);

const unread = computed(() => props.totalUnread ?? 0);

function isActive(item: NavItemDef) {
  return item.kind === 'tab' && props.activeTab === item.id;
}

// A tap navigates. The click the browser fires when a hold/drag is released is not a tap.
let suppressClick = false;
function onItemClick(item: NavItemDef) {
  if (suppressClick) return;
  if (item.kind === 'tab') emit('update:activeTab', item.id);
  else if (item.path)      void router.push(item.path);
}

// ── Hold → drag → drop to swap ─────────────────────────────────────────────
const HOLD_MS        = 450;   // press-and-hold before a tab lifts
const HOLD_SLOP_PX   = 14;    // moving further than this before the hold completes means "swipe", not "hold"
const SLOT_REACH_PX  = 60;    // forgiveness above the bar when aiming at a slot

const drag = reactive({
  active: false,
  from: -1,
  x: 0, y: 0,
  overSlot: -1,        // bar slot currently under the finger (never the lifted one)
});

const draggedItem = computed<NavItemDef | null>(() => (drag.active ? navStore.items[drag.from] ?? null : null));
const ghostStyle  = computed(() => ({ left: `${drag.x}px`, top: `${drag.y}px` }));

let pressTimer: ReturnType<typeof setTimeout> | null = null;
let pressIndex = -1;
let startX = 0, startY = 0, lastX = 0, lastY = 0;

function buzz(ms: number) { try { navigator.vibrate?.(ms); } catch { /* not supported */ } }

function onPointerDown(ev: PointerEvent, index: number) {
  if (ev.pointerType === 'mouse' && ev.button !== 0) return;
  cancelPress();
  pressIndex = index;
  startX = lastX = ev.clientX;
  startY = lastY = ev.clientY;
  pressTimer = setTimeout(lift, HOLD_MS);
  window.addEventListener('pointermove', onPressMove);
  window.addEventListener('pointerup', cancelPress);
  window.addEventListener('pointercancel', cancelPress);
}

function onPressMove(ev: PointerEvent) {
  lastX = ev.clientX; lastY = ev.clientY;
  if (Math.hypot(lastX - startX, lastY - startY) > HOLD_SLOP_PX) cancelPress();
}

function cancelPress() {
  if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
  window.removeEventListener('pointermove', onPressMove);
  window.removeEventListener('pointerup', cancelPress);
  window.removeEventListener('pointercancel', cancelPress);
}

function lift() {
  cancelPress();
  drag.active     = true;
  drag.from       = pressIndex;
  drag.x          = lastX;
  drag.y          = lastY;
  drag.overSlot   = -1;
  suppressClick   = true;          // released at some later moment; cleared shortly after that
  window.addEventListener('pointermove', onDragMove);
  window.addEventListener('touchmove', blockScroll, { passive: false });
  window.addEventListener('pointerup', onDragEnd);
  window.addEventListener('pointercancel', onDragCancel);
  buzz(15);
}

function inside(x: number, y: number, r: DOMRect, pad = 0) {
  return x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad;
}

/** Which bar slot is under the finger (or -1). */
function hitSlot(x: number, y: number): number {
  const bar = navEl.value;
  if (!bar || y < bar.getBoundingClientRect().top - SLOT_REACH_PX) return -1;
  const slots = Array.from(bar.querySelectorAll<HTMLElement>('[data-nav-index]'));
  for (let i = 0; i < slots.length; i++) {
    const r = slots[i].getBoundingClientRect();
    if (x >= r.left && x <= r.right) return i;
  }
  return -1;
}

function track(ev: PointerEvent) {
  drag.x = ev.clientX; drag.y = ev.clientY;
  const hit  = hitSlot(drag.x, drag.y);
  const slot = hit === drag.from ? -1 : hit;               // hovering your own slot is a no-op
  if (slot !== drag.overSlot) {
    if (slot >= 0) buzz(6);                                // tiny tick when a new target engages
    drag.overSlot = slot;
  }
}

function blockScroll(ev: TouchEvent) { if (ev.cancelable) ev.preventDefault(); }
function onDragMove(ev: PointerEvent) { track(ev); }
function onDragEnd(ev: PointerEvent)  { track(ev); finishDrag(true); }
function onDragCancel()               { finishDrag(false); }

function finishDrag(apply: boolean) {
  let changed = false;
  if (apply) {
    if (drag.overSlot >= 0) changed = navStore.swap(drag.from, drag.overSlot);
  }
  window.removeEventListener('pointermove', onDragMove);
  window.removeEventListener('touchmove', blockScroll);
  window.removeEventListener('pointerup', onDragEnd);
  window.removeEventListener('pointercancel', onDragCancel);
  drag.active = false; drag.from = -1; drag.overSlot = -1;
  if (changed) buzz(20);
  setTimeout(() => { suppressClick = false; }, 150);     // after the release click has come and gone
}

/** Keyboard route to the same result: Alt + ←/→ moves the focused tab one slot. */
function nudge(index: number, dir: -1 | 1) {
  const to = index + dir;
  if (!navStore.swap(index, to)) return;
  void nextTick(() => navEl.value?.querySelectorAll<HTMLElement>('[data-nav-index]')[to]?.focus());
}

onUnmounted(() => {
  cancelPress();
  if (drag.active) finishDrag(false);
});
</script>

<style scoped>
/* Base bar styles live here (not in HomePage.css) — scoped parent styles
   don't reach into this component's elements. */
.bottom-nav-footer { --background: transparent; --border: none; }
ion-footer.bottom-nav-footer {
  max-height: 120px;
  overflow: hidden;            /* Ionic/global CSS clip the footer box, so the notch gets its own room inside it (see .bottom-nav) */
  pointer-events: none;        /* the transparent notch strip must not block taps on the page behind it */
  margin-top: 0;
  transition: max-height 240ms cubic-bezier(0.4, 0, 0.2, 1);
}
ion-footer.bottom-nav-footer.footer-hidden { max-height: 0; overflow: hidden; margin-top: 0; }
.bottom-nav { margin-top: 0; }
@media (min-width: 768px) {
  .bottom-nav-footer { display: none !important; }
}

.bottom-nav {
  display: flex;
  align-items: stretch;
  justify-content: space-around;
  background: var(--app-bg-elevated);
  backdrop-filter: blur(40px) saturate(1.8);
  -webkit-backdrop-filter: blur(40px) saturate(1.8);
  border-top: 1px solid var(--app-border-strong);
  padding: 0 0 env(safe-area-inset-bottom);
  pointer-events: all;
}
.nav-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  flex: 1;
  min-width: 0;
  padding: 11px 4px 9px;
  background: none;
  border: none;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  position: relative;
  transition: color 140ms, background 140ms, opacity 140ms;
  color: var(--app-text-subtle);
  font: inherit;
  /* A hold-and-drag must reach us as pointer events, not be taken over as a scroll or a long-press menu. */
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
}
.nav-item:hover { color: var(--app-text-muted); background: var(--app-surface); }
.nav-item:active { opacity: 0.6; background: transparent; }
.nav-item.active { color: var(--app-accent); }
.nav-item.active::before {
  content: '';
  position: absolute;
  top: 0; left: 50%;
  transform: translateX(-50%);
  width: 38px; height: 2.5px;
  border-radius: 0 0 3px 3px;
  background: var(--app-accent);
  box-shadow: 0 0 10px rgba(var(--app-accent-rgb), 0.6);
}
.nav-item.active .nav-icon-wrap { filter: drop-shadow(0 0 6px rgba(var(--app-accent-rgb), 0.45)); }

/* Publish: raised round button in a curved notch */
.nav-item--fab.active::before { display: none; }
.nav-fab-bump {
  display: none;
  position: absolute; top: -36px; left: 50%; transform: translateX(-50%);
  width: 72px; height: 36px; box-sizing: border-box;
  border-radius: 36px 36px 0 0;
  background: var(--app-bg-elevated);
  border: 1px solid var(--app-border-strong); border-bottom: none;
  pointer-events: none;
}
.nav-fab {
  position: relative; flex-shrink: 0;
  width: 30px; height: 30px; border-radius: 50%;
  display: grid; place-items: center;
  background: var(--app-accent); color: #04120a;
  box-shadow: 0 0 12px rgba(var(--app-accent-rgb), 0.35);
  transition: transform 140ms;
}
.nav-item--fab .nav-label { margin-top: 0; }
.nav-fab svg { width: 17px; height: 17px; display: block; }
.nav-item--fab:active .nav-fab { transform: scale(0.94); }
.nav-item--fab { color: var(--app-text-muted); }
.nav-item--fab.active { color: var(--app-accent); }
.nav-item--fab .nav-icon-wrap { filter: none; }
/* The dark theme paints every .nav-badge green; unread counts stay red like the design. */
.nav-icon-wrap .nav-badge.nav-badge--mobile { background: #ff4d4f; color: #fff; top: -6px; right: -12px; }
.nav-live { position: absolute; top: -2px; right: -5px; }
.nav-live :deep(.relay-dot) { box-shadow: 0 0 0 2px var(--app-bg-elevated); }
.nav-item--lifted { opacity: 0.25; }
.nav-item--target { background: rgba(230, 230, 230, 0.22); color: #e6e6e6; border-radius: 12px; }
.nav-label {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.02em;
  line-height: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}
.nav-icon-wrap {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px; height: 24px;
}
.nav-icon-wrap > :deep(svg),
.nav-icon-wrap > :deep(.nav-svg) {
  width: 24px; height: 24px;
  display: block;
  flex-shrink: 0;
  pointer-events: none;
}
.nav-badge {
  position: absolute;
  top: -4px; right: -10px;
  background: #ff4d4f;
  color: #fff;
  font-size: 9px; font-weight: 900;
  min-width: 16px; height: 16px;
  border-radius: 999px;
  display: flex; align-items: center; justify-content: center;
  padding: 0 4px;
  border: 2px solid var(--app-bg-elevated, #141414);
  pointer-events: none;
}

/* ── Drag layer (teleported to <body>) ───────────────────────────────────── */
.nav-drag-layer { position: fixed; inset: 0; z-index: 20000; pointer-events: none; }
.nav-ghost {
  position: fixed;
  transform: translate(-50%, -70%) scale(1.15);
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  min-width: 64px; padding: 10px 12px;
  border-radius: 16px;
  background: rgba(41, 41, 41, 0.96);
  border: 1px solid rgba(230, 230, 230, 0.5);
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.55);
  color: #e6e6e6;
}
.nav-ghost__icon { width: 24px; height: 24px; display: flex; }
.nav-ghost__icon :deep(svg), .nav-ghost__icon :deep(.nav-svg) { width: 24px; height: 24px; display: block; }
.nav-ghost__label { font-size: 10px; font-weight: 700; line-height: 1; }

@media (prefers-reduced-motion: reduce) { .nav-item { transition: none; } }
</style>
