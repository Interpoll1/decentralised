import { defineStore } from 'pinia';

/**
 * Mobile bottom-nav customisation.
 *
 * Interaction model: tap a tab to go there; hold a tab and drag it onto another to swap places.
 * The FIRST tab in the bar is the one the app opens on (like WhatsApp), so there is no separate
 * "start tab" setting to manage.
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
  { id: 'orbit',         label: 'Orbit',    kind: 'tab'  },
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

/** Messages · Orbit · [Publish] · Feed · Network — Publish sits in the centre as the raised button. */
export const DEFAULT_NAV_ORDER = ['chat', 'orbit', 'create', 'home', 'network'];
/** The bar shipped with this order before the redesign; anyone still on it moves to the new default. */
const PREVIOUS_DEFAULT_ORDER = ['home', 'orbit', 'chat', 'create', 'network'];
const sameOrder = (a: string[], b: string[]) => a.length === b.length && a.every((id, i) => id === b[i]);
/** Spaces became Orbit; saved bars and start tabs that say 'communities' keep their slot. */
const RENAMED: Record<string, string> = { communities: 'orbit' };
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
    const cleaned = parsed.map((id: unknown) => (typeof id === 'string' ? RENAMED[id] ?? id : id)).filter((id: unknown): id is string => typeof id === 'string' && POOL_IDS.has(id));
    const deduped = Array.from(new Set(cleaned)).slice(0, MAX_VISIBLE);
    if (sameOrder(deduped, PREVIOUS_DEFAULT_ORDER)) return [...DEFAULT_NAV_ORDER];
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
    const raw = localStorage.getItem(LEGACY_START_KEY);
    if (raw === null) return order;
    const legacy = RENAMED[raw] ?? raw;
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
    /**
     * Which tab HomePage opens on when no ?tab= is present: the first tab in the bar —
     * except on the untouched default bar, which still opens on Feed (Messages leads that bar visually).
     */
    defaultTab(state): string {
      return sameOrder(state.order, DEFAULT_NAV_ORDER) ? 'home' : firstTab(state.order);
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

    reset() {
      this.order = [...DEFAULT_NAV_ORDER];
      this.persist();
    },

    setEnabled(v: boolean) {
      this.enabled = v;
      try { localStorage.setItem(ENABLED_KEY, v ? '1' : '0'); } catch { /* ignore */ }
    },
  },
});
