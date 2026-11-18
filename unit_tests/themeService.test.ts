import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { initializeTheme, setTheme, appTheme, THEME_PREFERENCE_KEY } from '../src/services/themeService';

let values: Map<string, string>;
function element() {
  const classes = new Set(['dark']);
  return { classes, dataset: {} as Record<string, string>, style: { colorScheme: '' },
    classList: { toggle: (name: string, on: boolean) => on ? classes.add(name) : classes.delete(name) } };
}
let html: ReturnType<typeof element>, body: ReturnType<typeof element>;
beforeEach(() => {
  values = new Map(); html = element(); body = element();
  vi.stubGlobal('document', { documentElement: html, body });
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value) });
});
afterEach(() => vi.unstubAllGlobals());

it('starts fresh installs in light graphite', () => {
  expect(initializeTheme()).toBe('light');
  expect(html.classes.has('dark')).toBe(false); expect(body.classes.has('dark')).toBe(false);
  expect(values.get(THEME_PREFERENCE_KEY)).toBe('light');
});
it('migrates the old forced-dark value once without clearing other data', () => {
  values.set('theme', 'dark'); values.set('identity-marker', 'keep-this');
  expect(initializeTheme()).toBe('light');
  expect(values.get('identity-marker')).toBe('keep-this');
  setTheme('dark'); expect(initializeTheme()).toBe('dark');
  expect(html.style.colorScheme).toBe('dark');
});
it('persists both explicit choices and applies them to html/body', () => {
  setTheme('dark'); expect(appTheme.value).toBe('dark'); expect(body.classes.has('dark')).toBe(true);
  setTheme('light'); expect(initializeTheme()).toBe('light'); expect(body.dataset.theme).toBe('light');
});
it('still switches themes when storage is unavailable', () => {
  vi.stubGlobal('localStorage', { getItem: () => { throw new Error('unavailable'); }, setItem: () => { throw new Error('unavailable'); } });
  expect(initializeTheme()).toBe('light');
  expect(() => setTheme('dark')).not.toThrow(); expect(html.classes.has('dark')).toBe(true);
});
it('the real first-paint bootstrap uses the same preference and light fallback', () => {
  const source = readFileSync(resolve(__dirname, '../index.html'), 'utf8');
  const script = [...source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
    .map(match => match[1]).find(text => text.includes(THEME_PREFERENCE_KEY))!;
  expect(script).toBeTruthy();
  for (const choice of [null, 'dark', 'light', 'unknown']) {
    const root = element();
    runInNewContext(script, { document: { documentElement: root, querySelector: () => ({ setAttribute: () => {} }) }, localStorage: { getItem: () => choice } });
    expect(root.classes.has('dark')).toBe(choice === 'dark');
  }
  const root = element();
  expect(() => runInNewContext(script, { document: { documentElement: root, querySelector: () => ({ setAttribute: () => {} }) }, localStorage: { getItem: () => { throw new Error('blocked'); } } })).not.toThrow();
  expect(root.classes.has('dark')).toBe(false);
});
