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

it('starts fresh installs in dark without persisting a choice', () => {
  expect(initializeTheme()).toBe('dark');
  expect(html.classes.has('dark')).toBe(true); expect(body.classes.has('dark')).toBe(true);
  expect(values.has(THEME_PREFERENCE_KEY)).toBe(false);
});
it('ignores legacy values and only honours an explicit light choice', () => {
  values.set('theme', 'light'); values.set('interpoll_theme_preference_v1', 'light'); values.set('identity-marker', 'keep-this');
  expect(initializeTheme()).toBe('dark');
  expect(values.get('identity-marker')).toBe('keep-this');
  setTheme('light'); expect(initializeTheme()).toBe('light');
  expect(html.style.colorScheme).toBe('light');
});
it('persists both explicit choices and applies them to html/body', () => {
  setTheme('dark'); expect(appTheme.value).toBe('dark'); expect(body.classes.has('dark')).toBe(true);
  setTheme('light'); expect(initializeTheme()).toBe('light'); expect(body.dataset.theme).toBe('light');
});
it('still switches themes when storage is unavailable', () => {
  vi.stubGlobal('localStorage', { getItem: () => { throw new Error('unavailable'); }, setItem: () => { throw new Error('unavailable'); } });
  expect(initializeTheme()).toBe('dark');
  expect(() => setTheme('light')).not.toThrow(); expect(html.classes.has('dark')).toBe(false);
});
it('the real first-paint bootstrap defaults to dark unless light was chosen', () => {
  const source = readFileSync(resolve(__dirname, '../index.html'), 'utf8');
  const script = [...source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
    .map(match => match[1]).find(text => text.includes(THEME_PREFERENCE_KEY))!;
  expect(script).toBeTruthy();
  for (const choice of [null, 'dark', 'light', 'unknown']) {
    const root = element();
    runInNewContext(script, { document: { documentElement: root, querySelector: () => ({ setAttribute: () => {} }) }, localStorage: { getItem: () => choice } });
    expect(root.classes.has('dark')).toBe(choice !== 'light');
  }
  const root = element();
  expect(() => runInNewContext(script, { document: { documentElement: root, querySelector: () => ({ setAttribute: () => {} }) }, localStorage: { getItem: () => { throw new Error('blocked'); } } })).not.toThrow();
  expect(root.classes.has('dark')).toBe(true);
});
