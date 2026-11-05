import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { DEFAULT_NAV_ORDER, useNavStore } from '../src/stores/navStore';

const storage = new Map<string, string>();
beforeEach(() => {
  storage.clear();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  setActivePinia(createPinia());
});

describe('mobile navigation preferences', () => {
  it('opens Home for a new user, with publishing in the centre', () => {
    const nav = useNavStore();
    expect(nav.defaultTab).toBe('home');
    expect(nav.items.map(item => item.id)).toEqual(['home', 'orbit', 'create', 'chat', 'profile']);
  });

  it.each([
    ['home', 'orbit', 'chat', 'create', 'network'],
    ['chat', 'orbit', 'create', 'home', 'network'],
  ])('updates a shipped default without changing its Home start', (...order) => {
    storage.set('interpoll_nav_order', JSON.stringify(order));
    const nav = useNavStore();
    expect(nav.order).toEqual(DEFAULT_NAV_ORDER);
    expect(nav.defaultTab).toBe('home');
  });

  it('keeps a custom order and its chosen start tab', () => {
    const order = ['chat', 'home', 'create', 'orbit', 'settings'];
    storage.set('interpoll_nav_order', JSON.stringify(order));
    const nav = useNavStore();
    expect(nav.order).toEqual(order);
    expect(nav.defaultTab).toBe('chat');
  });

  it('keeps an explicit legacy Messages start during default migration', () => {
    storage.set('interpoll_nav_order', JSON.stringify(['chat', 'orbit', 'create', 'home', 'network']));
    storage.set('interpoll_nav_default_tab', 'chat');
    const nav = useNavStore();
    expect(nav.defaultTab).toBe('chat');
    expect(nav.order[0]).toBe('chat');
    expect(storage.has('interpoll_nav_default_tab')).toBe(false);
  });

  it('persists a manual reorder without enabling a disabled bar', () => {
    storage.set('interpoll_nav_enabled', '0');
    const nav = useNavStore();
    expect(nav.swap(0, 3)).toBe(true);
    expect(JSON.parse(storage.get('interpoll_nav_order')!)[0]).toBe('chat');
    expect(nav.defaultTab).toBe('chat');
    expect(nav.enabled).toBe(false);
  });
});
