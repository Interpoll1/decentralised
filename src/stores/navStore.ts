import { defineStore } from 'pinia';

/**
 * Mobile bottom-nav customisation.
 *
 * Interaction model (kept deliberately tiny): hold a tab, drag it onto another, they swap places.
 * While dragging, destinations that aren't in the bar are offered in a tray; dropping on one swaps
 * it into the bar. The FIRST tab in the bar is the one the app opens on (like WhatsApp), so there
 * is no separate "start tab" setting to manage.
 *
 * Persisted to localStorage (device-local, like the feed scope preference): a UI preference,
 * not replicated state.
 */

export type NavItemKind = 'tab' | 'route';

export interface NavItemDef {
  /** Stable id — also the HomePage tab name for kind: 'tab'. */
  id: string;
  label: string;
  kind: NavItemKind;
  /** Router path for kind: 'route'. */
  path?: string;
}

/** Everything the user may place in the bottom nav. */
export const NAV_ITEM_POOL: NavItemDef[] = [
  { id: 'home',          label: 'Feed',     kind: 'tab'  },
  { id: 'communities',   label: 'Spaces',   kind: 'tab'  },
  { id: 'chat',          label: 'Messages', kind: 'tab'  },
  { id: 'create',        label: 'Publish',  kind: 'tab'  },
  { id: 'network',       label: 'Network',  kind: 'route', path: '/network' },
  { id: 'search',        label: 'Search',   kind: 'route', path: '/search' },
  { id: 'profile',       label: 'Profile',  kind: 'route', path: '/profile' },
  { id: 'chatrooms',     label: 'Rooms',    kind: 'route', path: '/chatrooms' },
  { id: 'chainExplorer', label: 'Chain',    kind: 'route', path: '/chain-explorer' },
  { id: 'settings',      label: 'Settings', kind: 'route', path: '/settings' },
];

const POOL_IDS = new Set(NAV_ITEM_POOL.map(i => i.id));
const TAB_IDS  = new Set(NAV_ITEM_POOL.filter(i => i.kind === 'tab').map(i => i.id));

export const DEFAULT_NAV_ORDER = ['home', 'communities', 'chat', 'create', 'network'];
const MAX_VISIBLE = 5;
const MIN_VISIBLE = 3;

const ORDER_KEY      = 'interpoll_nav_order';
const ENABLED_KEY    = 'interpoll_nav_enabled';
/** Older builds stored an explicit start tab here. Read once, folded into the order, then removed. */
const LEGACY_START_KEY = 'interpoll_nav_default_tab';

function readOrder(): string[] {
  try {
    const raw = localStorage.getItem(ORDER_KEY);
    if (!raw) return [...DEFAULT_NAV_ORDER];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [...DEFAULT_NAV_ORDER];
    const cleaned = parsed.filter((id: unknown): id is string => typeof id === 'string' && POOL_IDS.has(id));
    const deduped = Array.from(new Set(cleaned)).slice(0, MAX_VISIBLE);
    return deduped.length >= MIN_VISIBLE ? deduped : [...DEFAULT_NAV_ORDER];
  } catch {
    return [...DEFAULT_NAV_ORDER];
  }
}

/** Where the app opens: the first tab-type item in the bar. */
function firstTab(order: string[]): string {
  return order.find(id => TAB_IDS.has(id)) ?? 'home';
}

/**
 * Anyone who picked a start tab in an older build keeps it: that tab trades places with the
 * current first tab, so "the first tab opens the app" gives the same result they had before.
 */
function migrateLegacyStart(order: string[]): string[] {
  try {
    const legacy = localStorage.getItem(LEGACY_START_KEY);
    if (legacy === null) return order;
    localStorage.removeItem(LEGACY_START_KEY);
    const first = firstTab(order);
    if (!TAB_IDS.has(legacy) || !order.includes(legacy) || legacy === first) return order;
    const next = [...order];
    const i = next.indexOf(legacy), j = next.indexOf(first);
    [next[i], next[j]] = [next[j], next[i]];
    localStorage.setItem(ORDER_KEY, JSON.stringify(next));
    return next;
  } catch {
    return order;
  }
}

function readEnabled(): boolean {
  try {
    return localStorage.getItem(ENABLED_KEY) !== '0';
  } catch {
    return true;
  }
}

export const useNavStore = defineStore('nav', {
  state: () => ({
    /** Ordered ids of the visible bottom-nav items. */
    order: migrateLegacyStart(readOrder()) as string[],
    /** Whether the bar is shown at all (user toggle in Settings). */
    enabled: readEnabled(),
    /** True while the "hold a tab and drag it" hint is showing (opened from Settings). */
    editing: false,
  }),

  getters: {
    maxVisible: () => MAX_VISIBLE,
    minVisible: () => MIN_VISIBLE,
    /** Visible items, resolved to their definitions, in user order. */
    items(state): NavItemDef[] {
      return state.order
        .map(id => NAV_ITEM_POOL.find(i => i.id === id))
        .filter((i): i is NavItemDef => !!i);
    },
    /** Pool items not currently in the bar (shown in the drag tray). */
    availableItems(state): NavItemDef[] {
      return NAV_ITEM_POOL.filter(i => !state.order.includes(i.id));
    },
    /** Which tab HomePage opens on when no ?tab= is present: the first tab in the bar. */
    defaultTab(state): string {
      return firstTab(state.order);
    },
  },

  actions: {
    persist() {
      try {
        localStorage.setItem(ORDER_KEY, JSON.stringify(this.order));
      } catch { /* storage unavailable — keep in-memory state */ }
    },

    /** Two slots trade places. */
    swap(i: number, j: number): boolean {
      const n = this.order.length;
      if (!Number.isInteger(i) || !Number.isInteger(j) || i < 0 || j < 0 || i >= n || j >= n) return false;
      if (i === j) return true;
      const next = [...this.order];
      [next[i], next[j]] = [next[j], next[i]];
      this.order = next;
      this.persist();
      return true;
    },

    /**
     * Put `id` into slot `index`. If `id` is already in the bar the two trade places; otherwise
     * the slot's old item leaves the bar (it reappears in the drag tray).
     */
    replaceAt(index: number, id: string): boolean {
      if (!POOL_IDS.has(id) || !Number.isInteger(index) || index < 0 || index >= this.order.length) return false;
      const existing = this.order.indexOf(id);
      if (existing >= 0) return this.swap(index, existing);
      const next = [...this.order];
      next[index] = id;
      this.order = next;
      this.persist();
      return true;
    },

    reset() {
      this.order = [...DEFAULT_NAV_ORDER];
      this.persist();
    },

    setEnabled(v: boolean) {
      this.enabled = v;
      try { localStorage.setItem(ENABLED_KEY, v ? '1' : '0'); } catch { /* ignore */ }
    },

    setEditing(v: boolean) {
      this.editing = v;
    },
  },
});