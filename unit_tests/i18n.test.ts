import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import en from '../src/i18n/locales/en.json';
import uk from '../src/i18n/locales/uk.json';
import { i18n, ui, formatUi, countUi, localeDate, detectLanguage, initializeLanguage, setLanguage, currentLanguage, languagePreference, LANGUAGE_KEY } from '../src/i18n';

let storage: Map<string, string>, html: { lang: string; dir: string };
const cleanups: Array<() => void> = [];
beforeEach(() => {
  storage = new Map(); html = { lang: '', dir: '' };
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value) });
  vi.stubGlobal('navigator', { languages: ['uk-UA', 'en-US'], language: 'uk-UA' });
  vi.stubGlobal('document', { documentElement: html });
  vi.stubGlobal('window', new EventTarget());
  i18n.global.locale.value = 'en';
});
afterEach(() => { cleanups.splice(0).forEach(stop => stop()); vi.unstubAllGlobals(); });

it('all bundled entries have nonempty Ukrainian translations and render their literal source in English', () => {
  expect(Object.keys(en).sort()).toEqual(Object.keys(uk).sort());
  expect(Object.keys(en).length).toBeGreaterThan(1500);
  for (const [source, value] of Object.entries(en)) expect(ui(source), source).toBe(value);
  i18n.global.locale.value = 'uk';
  for (const [source, translated] of Object.entries(uk)) {
    expect(translated.trim(), source).not.toBe('');
    expect(ui(source), source).toBe(translated);
    expect(translated.match(/\{p\d+\}/g)?.sort() ?? [], source)
      .toEqual(source.match(/\{p\d+\}/g)?.sort() ?? []);
  }
});
it('formats diagnostic parameters literally, without interpreting them as a message or HTML', () => {
  setLanguage('uk');
  expect(formatUi('Private poll link: {p0}', { p0: 'https://example.test/@alice?a={x}' }))
    .toBe('Приватне опитування: https://example.test/@alice?a={x}');
  expect(formatUi('Question: {p0}', { p0: '<b>Question</b>' })).toBe('Питання: <b>Question</b>');
});
it('follows device changes only in automatic mode and synchronizes explicit choices across tabs', () => {
  cleanups.push(initializeLanguage()); expect(currentLanguage.value).toBe('uk');
  vi.stubGlobal('navigator', { languages: ['en-GB'], language: 'en-GB' });
  window.dispatchEvent(new Event('languagechange')); expect(currentLanguage.value).toBe('en');
  setLanguage('uk'); window.dispatchEvent(new Event('languagechange')); expect(currentLanguage.value).toBe('uk');
  const event = new Event('storage'); Object.assign(event, { key: LANGUAGE_KEY, newValue: 'en' });
  window.dispatchEvent(event); expect(currentLanguage.value).toBe('en'); expect(html.lang).toBe('en');
});
it('detects supported device language variants in order with an English fallback', () => {
  expect(detectLanguage(['uk-UA'])).toBe('uk');
  expect(detectLanguage(['pl-PL', 'en-GB', 'uk'])).toBe('en');
  expect(detectLanguage(['UK_ua'])).toBe('uk');
  expect(detectLanguage(['fr', 'pl'])).toBe('en');
});
it('keeps an explicit choice across initialization and leaves unrelated storage untouched', () => {
  storage.set('identity-marker', 'unchanged');
  setLanguage('en'); cleanups.push(initializeLanguage());
  expect(currentLanguage.value).toBe('en'); expect(html.lang).toBe('en');
  expect(storage.get('identity-marker')).toBe('unchanged');
  setLanguage('uk'); cleanups.push(initializeLanguage()); expect(ui('Settings')).toBe('Налаштування');
  expect(storage.get(LANGUAGE_KEY)).toBe('uk');
  setLanguage('system'); expect(languagePreference.value).toBe('system'); expect(html.lang).toBe('uk');
});
it('handles stale preferences and blocked storage while keeping the selector usable', () => {
  storage.set(LANGUAGE_KEY, 'unsupported'); cleanups.push(initializeLanguage());
  expect(currentLanguage.value).toBe('uk');
  vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } });
  cleanups.push(initializeLanguage()); expect(currentLanguage.value).toBe('uk');
  expect(() => setLanguage('en')).not.toThrow(); expect(currentLanguage.value).toBe('en');
  expect(ui('An unknown technical diagnostic')).toBe('An unknown technical diagnostic');
});
it('uses Ukrainian count forms and locale dates rather than appending an English s', () => {
  setLanguage('uk');
  for (const [count, result] of [[0,'0 голосів'],[1,'1 голос'],[2,'2 голоси'],[5,'5 голосів'],[11,'11 голосів'],[21,'21 голос'],[22,'22 голоси'],[1.5,'1,5 голосу']] as const) expect(countUi(count,'vote')).toBe(result);
  expect(localeDate(new Date('2026-11-17T12:00:00Z'), { month:'long', timeZone:'UTC' })).toBe('листопад');
  setLanguage('en'); expect(countUi(1,'member')).toBe('1 member'); expect(countUi(2,'member')).toBe('2 members');
});
