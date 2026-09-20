<template>
  <ion-footer class="bottom-nav-footer" :class="{ 'footer-hidden': hidden && !navStore.editing }">
    <div
      v-if="navStore.editing"
      class="nav-edit-hint"
    >
      <span>Drag to reorder · tap ✕ to remove</span>
      <button class="nav-edit-hint__btn" @click="customizeOpen = true">Add / default</button>
      <button class="nav-edit-hint__btn nav-edit-hint__btn--done" @click="navStore.setEditing(false)">Done</button>
    </div>

    <div ref="navEl" class="bottom-nav" :class="{ 'bottom-nav--editing': navStore.editing }">
      <button
        v-for="(item, index) in navStore.items"
        :key="item.id"
        class="nav-item"
        :class="{
          active: !navStore.editing && isActive(item),
          'nav-item--dragging': dragIndex === index,
        }"
        :data-nav-index="index"
        @click="onItemClick(item)"
        @pointerdown="onPointerDown($event, index)"
        @contextmenu.prevent
      >
        <span class="nav-icon-wrap">
          <RelayIndicator v-if="item.id === 'network' && !navStore.editing" :compact="true" />
          <NavIcon v-else :id="item.id" :active="!navStore.editing && isActive(item)" />
          <span v-if="item.id === 'chat' && unread > 0" class="nav-badge nav-badge--mobile">
            {{ unread > 99 ? '99+' : unread }}
          </span>
        </span>
        <span class="nav-label">{{ item.label }}</span>

        <span
          v-if="navStore.editing && !item.locked && navStore.order.length > navStore.minVisible"
          class="nav-item__remove"
          @pointerdown.stop
          @click.stop="navStore.remove(item.id)"
        >✕</span>
        <span v-if="navStore.editing && navStore.defaultTab === item.id" class="nav-item__default">★</span>
      </button>
    </div>

    <ion-modal :is-open="customizeOpen" @didDismiss="customizeOpen = false">
      <div class="nav-customize">
        <header class="nav-customize__head">
          <h2>Customise navigation</h2>
          <button class="nav-customize__close" @click="customizeOpen = false">Close</button>
        </header>

        <section class="nav-customize__section">
          <h3>In the bar ({{ navStore.order.length }}/{{ navStore.maxVisible }})</h3>
          <ul class="nav-customize__list">
            <li v-for="(item, index) in navStore.items" :key="item.id">
              <span class="nav-customize__label">{{ item.label }}</span>
              <span class="nav-customize__actions">
                <button :disabled="index === 0" @click="navStore.move(index, index - 1)">↑</button>
                <button :disabled="index === navStore.order.length - 1" @click="navStore.move(index, index + 1)">↓</button>
                <button
                  :disabled="!!item.locked || navStore.order.length <= navStore.minVisible"
                  @click="navStore.remove(item.id)"
                >Remove</button>
              </span>
            </li>
          </ul>
        </section>

        <section v-if="navStore.availableItems.length" class="nav-customize__section">
          <h3>Available</h3>
          <ul class="nav-customize__list">
            <li v-for="item in navStore.availableItems" :key="item.id">
              <span class="nav-customize__label">{{ item.label }}</span>
              <span class="nav-customize__actions">
                <button :disabled="navStore.order.length >= navStore.maxVisible" @click="navStore.add(item.id)">Add</button>
              </span>
            </li>
          </ul>
        </section>

        <section class="nav-customize__section">
          <h3>Open the app on</h3>
          <div class="nav-customize__chips">
            <button
              v-for="tab in navStore.defaultTabChoices"
              :key="tab.id"
              class="nav-customize__chip"
              :class="{ 'nav-customize__chip--on': navStore.defaultTab === tab.id }"
              @click="navStore.setDefaultTab(tab.id)"
            >{{ tab.label }}</button>
          </div>
          <p class="nav-customize__hint">
            The app opens on this tab when you launch it without a link to somewhere else.
          </p>
        </section>

        <button class="nav-customize__reset" @click="navStore.reset()">Reset to defaults</button>
      </div>
    </ion-modal>
  </ion-footer>
</template>

<script setup lang="ts">
import { ref, computed, defineAsyncComponent, onUnmounted } from 'vue';
import { IonFooter, IonModal } from '@ionic/vue';
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

const router        = useRouter();
const navStore      = useNavStore();
const navEl         = ref<HTMLElement | null>(null);
const customizeOpen = ref(false);

const unread = computed(() => props.totalUnread ?? 0);

function isActive(item: NavItemDef) {
  return item.kind === 'tab' && props.activeTab === item.id;
}

function onItemClick(item: NavItemDef) {
  if (navStore.editing || suppressClick) return;
  if (item.kind === 'tab') emit('update:activeTab', item.id);
  else if (item.path)      void router.push(item.path);
}

// ── Long-press to enter edit mode, drag to reorder ─────────────────────────
let pressTimer: ReturnType<typeof setTimeout> | null = null;
let suppressClick = false;
const dragIndex = ref<number | null>(null);

function clearPressTimer() {
  if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
}

function onPointerDown(ev: PointerEvent, index: number) {
  if (navStore.editing) {
    beginDrag(ev, index);
    return;
  }
  clearPressTimer();
  pressTimer = setTimeout(() => {
    navStore.setEditing(true);
    suppressClick = true;
    try { navigator.vibrate?.(15); } catch { /* not supported */ }
  }, 550);
  // Cancel on release, or on a real drag — a few pixels of finger jitter
  // during a long press must not abort it.
  const startX = ev.clientX, startY = ev.clientY;
  const cancel = () => {
    clearPressTimer();
    window.removeEventListener('pointerup', cancel);
    window.removeEventListener('pointercancel', cancel);
    window.removeEventListener('pointermove', onMaybeMove);
  };
  const onMaybeMove = (move: PointerEvent) => {
    if (Math.hypot(move.clientX - startX, move.clientY - startY) > 12) cancel();
  };
  window.addEventListener('pointerup', cancel);
  window.addEventListener('pointercancel', cancel);
  window.addEventListener('pointermove', onMaybeMove);
  // Let the click land normally unless the long press fired.
  setTimeout(() => { suppressClick = false; }, 700);
}

function beginDrag(ev: PointerEvent, index: number) {
  dragIndex.value = index;
  ev.preventDefault();

  const onMove = (move: PointerEvent) => {
    const from = dragIndex.value;
    if (from === null || !navEl.value) return;
    const to = indexAtX(move.clientX);
    if (to !== null && to !== from) {
      navStore.move(from, to);
      dragIndex.value = to;
    }
  };
  const onUp = () => {
    dragIndex.value = null;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
}

/** Which slot the pointer's x coordinate currently sits over. */
function indexAtX(x: number): number | null {
  const el = navEl.value;
  if (!el) return null;
  const children = Array.from(el.querySelectorAll<HTMLElement>('[data-nav-index]'));
  for (let i = 0; i < children.length; i++) {
    const r = children[i].getBoundingClientRect();
    if (x >= r.left && x <= r.right) return i;
  }
  if (children.length) {
    if (x < children[0].getBoundingClientRect().left) return 0;
    return children.length - 1;
  }
  return null;
}

onUnmounted(() => {
  clearPressTimer();
  navStore.setEditing(false);
});
</script>

<style scoped>
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
.nav-edit-hint__btn {
  background: rgba(255, 255, 255, 0.12);
  color: inherit;
  border: none;
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 12px;
}
.nav-edit-hint__btn--done { background: var(--ion-color-primary, #3880ff); color: #fff; }

.bottom-nav--editing :deep(.nav-item) { animation: nav-wiggle 0.45s ease-in-out infinite alternate; }
.nav-item--dragging { opacity: 0.55; transform: scale(1.06); }

.nav-item__remove {
  position: absolute;
  top: 2px;
  left: 8px;
  width: 16px;
  height: 16px;
  line-height: 16px;
  text-align: center;
  font-size: 10px;
  border-radius: 999px;
  background: #d9534f;
  color: #fff;
}
.nav-item__default {
  position: absolute;
  top: 2px;
  right: 8px;
  font-size: 10px;
  color: #f0b429;
}

@keyframes nav-wiggle {
  from { transform: rotate(-1.1deg); }
  to   { transform: rotate(1.1deg); }
}
@media (prefers-reduced-motion: reduce) {
  .bottom-nav--editing :deep(.nav-item) { animation: none; }
}

.nav-customize {
  padding: 16px;
  overflow-y: auto;
  height: 100%;
  background: var(--app-bg, #111);
  color: var(--app-text, #eee);
}
.nav-customize__head { display: flex; align-items: center; justify-content: space-between; }
.nav-customize__head h2 { font-size: 17px; margin: 0; }
.nav-customize__close { background: none; border: none; color: var(--ion-color-primary, #3880ff); font-size: 14px; }
.nav-customize__section { margin-top: 20px; }
.nav-customize__section h3 { font-size: 13px; text-transform: uppercase; opacity: 0.6; margin: 0 0 8px; }
.nav-customize__list { list-style: none; margin: 0; padding: 0; }
.nav-customize__list li {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 12px; margin-bottom: 6px;
  background: rgba(255, 255, 255, 0.06); border-radius: 10px;
}
.nav-customize__actions { display: flex; gap: 6px; }
.nav-customize__actions button {
  background: rgba(255, 255, 255, 0.12); color: inherit; border: none;
  border-radius: 8px; padding: 5px 10px; font-size: 12px;
}
.nav-customize__actions button:disabled { opacity: 0.35; }
.nav-customize__chips { display: flex; flex-wrap: wrap; gap: 8px; }
.nav-customize__chip {
  background: rgba(255, 255, 255, 0.1); color: inherit; border: none;
  border-radius: 999px; padding: 7px 14px; font-size: 13px;
}
.nav-customize__chip--on { background: var(--ion-color-primary, #3880ff); color: #fff; }
.nav-customize__hint { font-size: 12px; opacity: 0.6; margin-top: 8px; }
.nav-customize__reset {
  margin-top: 24px; width: 100%; padding: 11px;
  background: rgba(217, 83, 79, 0.15); color: #ff8a85;
  border: none; border-radius: 10px; font-size: 14px;
}
</style>
