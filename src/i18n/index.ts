import { computed, ref, watch, type App } from 'vue';
import { createI18n } from 'vue-i18n';
import en from './locales/en.json';
import uk from './locales/uk.json';

export const LANGUAGE_KEY = 'interpoll_language_v1';
export const supportedLanguages = [
  { code: 'en', name: 'English' },
  { code: 'uk', name: 'Українська' },
] as const;
export type AppLanguage = typeof supportedLanguages[number]['code'];
export type LanguagePreference = AppLanguage | 'system';
export const languagePreference = ref<LanguagePreference>('system');

// Source-English keys are intentional: only explicitly marked interface copy is
// translated. Posts, names, signed payloads, URLs and storage identifiers stay data.
function literalMessages(catalog: Record<string, string>) {
  return Object.fromEntries(Object.entries(catalog).map(([key, value]) =>
    [key, value.replace(/[{}@|]/g, symbol => `{'${symbol}'}`)]));
}
export const i18n = createI18n({
  legacy: false,
  locale: 'en',
  fallbackLocale: 'en',
  missingWarn: false,
  fallbackWarn: false,
  messageResolver: (messages, key) => Object.prototype.hasOwnProperty.call(messages, key)
    ? (messages as Record<string, string>)[key] : null,
  messages: { en: literalMessages(en), uk: literalMessages(uk) },
});
export const currentLanguage = computed(() => i18n.global.locale.value as AppLanguage);

export function detectLanguage(languages: readonly string[]): AppLanguage {
  for (const tag of languages) {
    const code = tag.toLowerCase().split(/[-_]/)[0];
    if (code === 'uk' || code === 'en') return code;
  }
  return 'en';
}
function deviceLanguage(): AppLanguage {
  return detectLanguage(typeof navigator === 'undefined' ? [] : navigator.languages?.length
    ? navigator.languages : [navigator.language]);
}
function validPreference(value: string | null): LanguagePreference {
  return value === 'uk' || value === 'en' ? value : 'system';
}
function applyLanguage(preference: LanguagePreference) {
  languagePreference.value = preference;
  const language = preference === 'system' ? deviceLanguage() : preference;
  i18n.global.locale.value = language;
  if (typeof document !== 'undefined') {
    document.documentElement.lang = language;
    document.documentElement.dir = 'ltr';
  }
}
export function setLanguage(preference: LanguagePreference) {
  // Validate at runtime too: a stale preference or DOM value cannot become a locale.
  const checked = validPreference(preference);
  applyLanguage(checked);
  try { localStorage.setItem(LANGUAGE_KEY, checked); } catch { /* still works in memory */ }
}
export function initializeLanguage(): () => void {
  let saved: string | null = null;
  try { saved = localStorage.getItem(LANGUAGE_KEY); } catch { /* device default */ }
  applyLanguage(validPreference(saved));
  if (typeof window === 'undefined') return () => {};
  const onDeviceChange = () => { if (languagePreference.value === 'system') applyLanguage('system'); };
  const onStorage = (event: StorageEvent) => {
    if (event.key === LANGUAGE_KEY) applyLanguage(validPreference(event.newValue));
  };
  window.addEventListener('languagechange', onDeviceChange);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener('languagechange', onDeviceChange);
    window.removeEventListener('storage', onStorage);
  };
}
export function ui(source: string): string {
  // Unknown copy falls back to its source rather than exposing a translation key.
  void i18n.global.locale.value;
  return Object.prototype.hasOwnProperty.call(en, source) ? i18n.global.t(source) : source;
}
export function formatUi(source: string, values: Record<string, unknown>): string {
  return ui(source).replace(/\{(\w+)\}/g, (token, name: string) =>
    Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : token);
}
export function relativeTime(timestamp: number): string {
  const minutes = Math.floor(Math.max(0, Date.now() - timestamp) / 60000);
  const formatter = new Intl.RelativeTimeFormat(currentLanguage.value, { numeric: 'auto', style: 'short' });
  if (minutes < 1) return formatter.format(0, 'second');
  if (minutes < 60) return formatter.format(-minutes, 'minute');
  if (minutes < 1440) return formatter.format(-Math.floor(minutes / 60), 'hour');
  if (minutes < 10080) return formatter.format(-Math.floor(minutes / 1440), 'day');
  return localeDate(timestamp);
}
export function remainingTime(expiresAt: number, expired: boolean): string {
  const remaining = expiresAt - Date.now();
  if (expired || remaining <= 0) return ui('Ended');
  const minutes = Math.floor(remaining / 60000);
  const formatter = new Intl.RelativeTimeFormat(currentLanguage.value, { numeric: 'always', style: 'short' });
  if (minutes >= 1440) return formatter.format(Math.floor(minutes / 1440), 'day');
  if (minutes >= 60) return formatter.format(Math.floor(minutes / 60), 'hour');
  return minutes > 0 ? formatter.format(minutes, 'minute') : ui('Ending soon');
}
export function localeDate(value: Date | number, options?: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(currentLanguage.value === 'uk' ? 'uk-UA' : 'en-US', options).format(value);
}
const countForms = {
  vote: ['голос', 'голоси', 'голосів', 'голосу'],
  member: ['учасник', 'учасники', 'учасників', 'учасника'],
  peer: ['вузол', 'вузли', 'вузлів', 'вузла'],
  'relay peer': ['вузол ретрансляції', 'вузли ретрансляції', 'вузлів ретрансляції', 'вузла ретрансляції'],
  'sync peer': ['вузол синхронізації', 'вузли синхронізації', 'вузлів синхронізації', 'вузла синхронізації'],
  'Gun peer': ['вузол Gun', 'вузли Gun', 'вузлів Gun', 'вузла Gun'],
  'ICE server': ['сервер ICE', 'сервери ICE', 'серверів ICE', 'сервера ICE'],
  space: ['спільнота', 'спільноти', 'спільнот', 'спільноти'],
  post: ['допис', 'дописи', 'дописів', 'допису'],
  key: ['ключ', 'ключі', 'ключів', 'ключа'],
  relay: ['ретранслятор', 'ретранслятори', 'ретрансляторів', 'ретранслятора'],
  device: ['пристрій', 'пристрої', 'пристроїв', 'пристрою'],
  'more option': ['варіант', 'варіанти', 'варіантів', 'варіанта'],
} as const;
export function countUi(count: number, noun: keyof typeof countForms): string {
  const language = currentLanguage.value;
  const number = new Intl.NumberFormat(language).format(count);
  if (language === 'en') return `${number} ${noun}${count === 1 ? '' : 's'}`;
  const category = new Intl.PluralRules('uk').select(count);
  const index = category === 'one' ? 0 : category === 'few' ? 1 : category === 'many' ? 2 : 3;
  return `${number} ${countForms[noun][index]}`;
}
export const languagePlugin = {
  install(app: App) {
    app.use(i18n);
    app.config.globalProperties.$ui = ui;
    app.config.globalProperties.$count = countUi;
  },
};
// Keep the document language accurate when callers change the composer directly.
watch(currentLanguage, language => {
  if (typeof document !== 'undefined') document.documentElement.lang = language;
}, { flush: 'sync' });

declare module 'vue' {
  interface ComponentCustomProperties { $ui: typeof ui; $count: typeof countUi }
}
