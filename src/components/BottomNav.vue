<template>
  <ion-footer class="bottom-nav-footer" :class="{ 'footer-hidden': hidden && !navStore.editing && !drag.active }">
    <!-- Shown when opened from Settings → Customise. The gesture itself needs no mode. -->
    <div v-if="navStore.editing" class="nav-edit-hint">
      <span class="nav-edit-hint__text">Hold a tab, then drag it onto another to swap places. The first tab is where the app opens.</span>
      <button class="nav-edit-hint__btn" @click="navStore.reset()">Reset</button>
      <button class="nav-edit-hint__btn nav-edit-hint__btn--done" @click="navStore.setEditing(false)">Done</button>
    </div>

    <div ref="navEl" class="bottom-nav">
      <button
        v-for="(item, index) in navStore.items"
        :key="item.id"
        class="nav-item"
        :class="{
          active: !drag.active && isActive(item),
          'nav-item--lifted': drag.active && drag.from === index,
          'nav-item--target': drag.active && drag.overSlot === index,
        }"
        :data-nav-index="index"
        :aria-label="item.label"
        @click="onItemClick(item)"
        @pointerdown="onPointerDown($event, index)"
        @keydown.alt.left.prevent="nudge(index, -1)"
        @keydown.alt.right.prevent="nudge(index, 1)"
        @contextmenu.prevent
      >
        <span class="nav-icon-wrap">
          <RelayIndicator v-if="item.id === 'network' && !drag.active" :compact="true" />
          <NavIcon v-else :id="item.id" :active="!drag.active && isActive(item)" />
          <span v-if="item.id === 'chat' && unread > 0" class="nav-badge nav-badge--mobile">
            {{ unread > 99 ? '99+' : unread }}
          </span>
        </span>
        <span class="nav-label">{{ item.label }}</span>
      </button>
    </div>

    <!-- Drag layer: the lifted tab following your finger, plus a tray of everything that isn't in
         the bar. Teleported because the footer clips overflow. Only exists while dragging. -->
    <Teleport to="body">
      <div v-if="drag.active && draggedItem" class="nav-drag-layer" aria-hidden="true">
        <div v-if="trayItems.length" class="nav-tray" :style="trayStyle">
          <div class="nav-tray__title">Drop on one to swap it in</div>
          <div class="nav-tray__row">
            <div
              v-for="t in trayItems"
              :key="t.id"
              class="nav-tray__chip"
              :class="{ 'nav-tray__chip--over': drag.overTray === t.id }"
              :data-tray-id="t.id"
            >
              <span class="nav-tray__icon"><NavIcon :id="t.id" :active="drag.overTray === t.id" /></span>
              <span class="nav-tray__label">{{ t.label }}</span>
            </div>
          </div>
        </div>

        <div class="nav-ghost" :style="ghostStyle">
          <span class="nav-ghost__icon"><NavIcon :id="draggedItem.id" :active="true" /></span>
          <span class="nav-ghost__label">{{ draggedItem.label }}</span>
        </div>
      </div>
    </Teleport>
  </ion-footer>
</template>

<script setup lang="ts">
import { ref, reactive, computed, defineAsyncComponent, nextTick, watch, onUnmounted } from 'vue';
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
const HOLD_SLOP_PX   = 10;    // moving further than this before the hold completes means "swipe", not "hold"
const SLOT_REACH_PX  = 28;    // forgiveness above the bar when aiming at a slot

const drag = reactive({
  active: false,
  from: -1,
  x: 0, y: 0,
  overSlot: -1,        // bar slot currently under the finger (never the lifted one)
  overTray: '' as string,
  trayBottom: 90,
});

const draggedItem = computed<NavItemDef | null>(() => (drag.active ? navStore.items[drag.from] ?? null : null));
const trayItems   = computed(() => navStore.availableItems);
const ghostStyle  = computed(() => ({ left: `${drag.x}px`, top: `${drag.y}px` }));
const trayStyle   = computed(() => ({ bottom: `${drag.trayBottom}px` }));

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
  const bar = navEl.value?.getBoundingClientRect();
  drag.active     = true;
  drag.from       = pressIndex;
  drag.x          = lastX;
  drag.y          = lastY;
  drag.overSlot   = -1;
  drag.overTray   = '';
  drag.trayBottom = bar ? Math.max(0, window.innerHeight - bar.top + 12) : 90;
  suppressClick   = true;          // released at some later moment; cleared shortly after that
  window.addEventListener('pointermove', onDragMove);
  window.addEventListener('pointerup', onDragEnd);
  window.addEventListener('pointercancel', onDragCancel);
  buzz(15);
}

function inside(x: number, y: number, r: DOMRect, pad = 0) {
  return x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad;
}

/** What is under the finger: a tray chip (floats above the bar) or a bar slot. */
function hitTest(x: number, y: number): { slot: number; tray: string } {
  for (const el of Array.from(document.querySelectorAll<HTMLElement>('[data-tray-id]'))) {
    if (inside(x, y, el.getBoundingClientRect(), 6)) return { slot: -1, tray: el.dataset.trayId ?? '' };
  }
  const bar = navEl.value;
  if (bar && y >= bar.getBoundingClientRect().top - SLOT_REACH_PX) {
    const slots = Array.from(bar.querySelectorAll<HTMLElement>('[data-nav-index]'));
    for (let i = 0; i < slots.length; i++) {
      const r = slots[i].getBoundingClientRect();
      if (x >= r.left && x <= r.right) return { slot: i, tray: '' };
    }
  }
  return { slot: -1, tray: '' };
}

function track(ev: PointerEvent) {
  drag.x = ev.clientX; drag.y = ev.clientY;
  const hit  = hitTest(drag.x, drag.y);
  const slot = hit.slot === drag.from ? -1 : hit.slot;     // hovering your own slot is a no-op
  if (slot !== drag.overSlot || hit.tray !== drag.overTray) {
    if (slot >= 0 || hit.tray) buzz(6);                    // tiny tick when a new target engages
    drag.overSlot = slot;
    drag.overTray = hit.tray;
  }
}

function onDragMove(ev: PointerEvent) { track(ev); }
function onDragEnd(ev: PointerEvent)  { track(ev); finishDrag(true); }
function onDragCancel()               { finishDrag(false); }

function finishDrag(apply: boolean) {
  let changed = false;
  if (apply) {
    if (drag.overSlot >= 0)    changed = navStore.swap(drag.from, drag.overSlot);
    else if (drag.overTray)    changed = navStore.replaceAt(drag.from, drag.overTray);
  }
  window.removeEventListener('pointermove', onDragMove);
  window.removeEventListener('pointerup', onDragEnd);
  window.removeEventListener('pointercancel', onDragCancel);
  drag.active = false; drag.from = -1; drag.overSlot = -1; drag.overTray = '';
  if (changed) buzz(20);
  setTimeout(() => { suppressClick = false; }, 150);     // after the release click has come and gone
}

/** Keyboard route to the same result: Alt + ←/→ moves the focused tab one slot. */
function nudge(index: number, dir: -1 | 1) {
  const to = index + dir;
  if (!navStore.swap(index, to)) return;
  void nextTick(() => navEl.value?.querySelectorAll<HTMLElement>('[data-nav-index]')[to]?.focus());
}

// The Settings → Customise hint fades by itself so it can't linger.
let hintTimer: ReturnType<typeof setTimeout> | null = null;
watch(() => navStore.editing, (on) => {
  if (hintTimer) { clearTimeout(hintTimer); hintTimer = null; }
  if (on) hintTimer = setTimeout(() => navStore.setEditing(false), 12_000);
}, { immediate: true });

onUnmounted(() => {
  cancelPress();
  if (drag.active) finishDrag(false);
  if (hintTimer) clearTimeout(hintTimer);
});
</script>

<style scoped>
/* Base bar styles live here (not in HomePage.css) — scoped parent styles
   don't reach into this component's elements. */
.bottom-nav-footer { --background: transparent; --border: none; }
ion-footer.bottom-nav-footer {
  max-height: 200px;
  overflow: hidden;
  transition: max-height 240ms cubic-bezier(0.4, 0, 0.2, 1);
}
ion-footer.bottom-nav-footer.footer-hidden { max-height: 0; }
@media (min-width: 768px) {
  .bottom-nav-footer { display: none !important; }
}

.bottom-nav {
  display: flex;
  align-items: stretch;
  justify-content: space-around;
  background: rgba(8, 8, 18, 0.72);
  backdrop-filter: blur(40px) saturate(1.8);
  -webkit-backdrop-filter: blur(40px) saturate(1.8);
  border-top: 1px solid rgba(255, 255, 255, 0.06);
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
  color: rgba(255, 255, 255, 0.45);
  font: inherit;
  /* A hold-and-drag must reach us as pointer events, not be taken over as a scroll or a long-press menu. */
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
}
.nav-item:hover { color: rgba(255, 255, 255, 0.75); background: rgba(255, 255, 255, 0.04); }
.nav-item:active { opacity: 0.6; background: transparent; }
.nav-item.active { color: #a78bfa; }
.nav-item.active::before {
  content: '';
  position: absolute;
  top: 0; left: 50%;
  transform: translateX(-50%);
  width: 32px; height: 2.5px;
  border-radius: 0 0 3px 3px;
  background: linear-gradient(90deg, #818cf8, #a78bfa);
}
.nav-item--lifted { opacity: 0.25; }
.nav-item--target { background: rgba(167, 139, 250, 0.22); color: #c4b5fd; border-radius: 12px; }
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
.nav-icon-wrap :deep(svg),
.nav-icon-wrap :deep(.nav-svg) {
  width: 24px; height: 24px;
  display: block;
  flex-shrink: 0;
  pointer-events: none;
}
.nav-badge {
  position: absolute;
  top: -4px; right: -10px;
  background: #f59e0b;
  color: #1a1200;
  font-size: 9px; font-weight: 900;
  min-width: 16px; height: 16px;
  border-radius: 999px;
  display: flex; align-items: center; justify-content: center;
  padding: 0 4px;
  border: 2px solid var(--app-bg-elevated, #0e0e1a);
  pointer-events: none;
}

.nav-edit-hint {
  display: flex;
  align-items: center;
  gap: 8px;
  justify-content: center;
  padding: 6px 10px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.7);
  background: rgba(0, 0, 0, 0.55);
}
.nav-edit-hint__text { flex: 1; min-width: 0; line-height: 1.25; }
.nav-edit-hint__btn {
  background: rgba(255, 255, 255, 0.12);
  color: inherit;
  border: none;
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 12px;
}
.nav-edit-hint__btn--done { background: var(--ion-color-primary, #3880ff); color: #fff; }

/* ── Drag layer (teleported to <body>) ───────────────────────────────────── */
.nav-drag-layer { position: fixed; inset: 0; z-index: 20000; pointer-events: none; }
.nav-ghost {
  position: fixed;
  transform: translate(-50%, -70%) scale(1.15);
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  min-width: 64px; padding: 10px 12px;
  border-radius: 16px;
  background: rgba(30, 27, 55, 0.96);
  border: 1px solid rgba(167, 139, 250, 0.5);
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.55);
  color: #c4b5fd;
}
.nav-ghost__icon { width: 24px; height: 24px; display: flex; }
.nav-ghost__icon :deep(svg), .nav-ghost__icon :deep(.nav-svg) { width: 24px; height: 24px; display: block; }
.nav-ghost__label { font-size: 10px; font-weight: 700; line-height: 1; }

.nav-tray {
  position: fixed; left: 8px; right: 8px;
  padding: 8px 10px 10px;
  border-radius: 16px;
  background: rgba(14, 14, 28, 0.94);
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
  animation: nav-tray-in 140ms ease-out;
}
.nav-tray__title { font-size: 11px; color: rgba(255, 255, 255, 0.55); margin-bottom: 8px; text-align: center; }
.nav-tray__row { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; }
.nav-tray__chip {
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  width: 64px; padding: 8px 4px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.7);
  transition: background 120ms, color 120ms, transform 120ms;
}
.nav-tray__chip--over { background: rgba(167, 139, 250, 0.28); color: #ddd6fe; transform: scale(1.08); }
.nav-tray__icon { width: 24px; height: 24px; display: flex; }
.nav-tray__icon :deep(svg), .nav-tray__icon :deep(.nav-svg) { width: 24px; height: 24px; display: block; }
.nav-tray__label { font-size: 10px; font-weight: 600; line-height: 1; }
@keyframes nav-tray-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
@media (prefers-reduced-motion: reduce) { .nav-tray { animation: none; } .nav-tray__chip, .nav-item { transition: none; } }
</style>