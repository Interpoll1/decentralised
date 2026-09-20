import { defineStore } from 'pinia';

/**
 * Mobile bottom-nav customisation.
 *
 * The nav is a user-editable strip: which items appear, in what order, and
 * which one the app opens on. Persisted to localStorage (device-local, like
 * the feed scope preference) — it is a UI preference, not replicated state.
 */

export type NavItemKind = 'tab' | 'route';

export interface NavItemDef {
  /** Stable id — also the HomePage tab name for kind: 'tab'. */
  id: string;
  label: string;
  kind: NavItemKind;
  /** Router path for kind: 'route'. */
  path?: string;
  /** Item cannot be hidden (there must always be a way home). */
  locked?: boolean;
}

/** Everything the user may place in the bottom nav. */
export const NAV_ITEM_POOL: NavItemDef[] = [
  { id: 'home',          label: 'Feed',     kind: 'tab',   locked: true },
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

const ORDER_KEY   = 'interpoll_nav_order';
const DEFAULT_KEY = 'interpoll_nav_default_tab';

function readOrder(): string[] {
  try {
    const raw = localStorage.getItem(ORDER_KEY);
    if (!raw) return [...DEFAULT_NAV_ORDER];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [...DEFAULT_NAV_ORDER];
    const cleaned = parsed.filter((id: unknown): id is string => typeof id === 'string' && POOL_IDS.has(id));
    const deduped = Array.from(new Set(cleaned)).slice(0, MAX_VISIBLE);
    // 'home' is locked — always keep a way back to the feed.
    if (!deduped.includes('home')) deduped.unshift('home');
    return deduped.length >= MIN_VISIBLE ? deduped.slice(0, MAX_VISIBLE) : [...DEFAULT_NAV_ORDER];
  } catch {
    return [...DEFAULT_NAV_ORDER];
  }
}

function readDefaultTab(): string {
  try {
    const raw = localStorage.getItem(DEFAULT_KEY);
    return raw && TAB_IDS.has(raw) ? raw : 'home';
  } catch {
    return 'home';
  }
}

export const useNavStore = defineStore('nav', {
  state: () => ({
    /** Ordered ids of the visible bottom-nav items. */
    order: readOrder() as string[],
    /** Which tab HomePage opens on when no ?tab= is present. */
    defaultTab: readDefaultTab() as string,
    /** True while the user is rearranging the nav. */
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
    /** Pool items not currently in the nav. */
    availableItems(state): NavItemDef[] {
      return NAV_ITEM_POOL.filter(i => !state.order.includes(i.id));
    },
    /** Tabs the user may set as the landing tab (the ones actually in the nav). */
    defaultTabChoices(state): NavItemDef[] {
      return NAV_ITEM_POOL.filter(i => i.kind === 'tab' && state.order.includes(i.id));
    },
  },

  actions: {
    persist() {
      try {
        localStorage.setItem(ORDER_KEY, JSON.stringify(this.order));
        localStorage.setItem(DEFAULT_KEY, this.defaultTab);
      } catch { /* private mode / quota — preference is best-effort */ }
    },

    setEditing(on: boolean) {
      this.editing = on;
    },

    /** Move the item at `from` to index `to`, clamped to the visible range. */
    move(from: number, to: number) {
      if (from === to) return;
      if (from < 0 || from >= this.order.length) return;
      const target = Math.max(0, Math.min(this.order.length - 1, to));
      const [id] = this.order.splice(from, 1);
      this.order.splice(target, 0, id);
      this.persist();
    },

    add(id: string): boolean {
      if (!POOL_IDS.has(id) || this.order.includes(id)) return false;
      if (this.order.length >= MAX_VISIBLE) return false;
      this.order.push(id);
      this.persist();
      return true;
    },

    remove(id: string): boolean {
      const def = NAV_ITEM_POOL.find(i => i.id === id);
      if (!def || def.locked) return false;
      if (this.order.length <= MIN_VISIBLE) return false;
      this.order = this.order.filter(x => x !== id);
      if (this.defaultTab === id) this.setDefaultTab('home');
      this.persist();
      return true;
    },

    setDefaultTab(id: string) {
      if (!TAB_IDS.has(id)) return;
      this.defaultTab = id;
      this.persist();
    },

    reset() {
      this.order      = [...DEFAULT_NAV_ORDER];
      this.defaultTab = 'home';
      this.persist();
    },
  },
});
