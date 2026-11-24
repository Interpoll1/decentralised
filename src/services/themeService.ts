import { ref } from 'vue';

export type AppTheme = 'light' | 'dark';
/** v2: only written when the user explicitly picks a theme, so everyone starts in dark. */
export const THEME_PREFERENCE_KEY = 'interpoll_theme_preference_v2';
export const appTheme = ref<AppTheme>('dark');

/** Dark unless the user explicitly chose light. Never persists the default. */
export function initializeTheme(): AppTheme {
  let selected: AppTheme = 'dark';
  try { if (localStorage.getItem(THEME_PREFERENCE_KEY) === 'light') selected = 'light'; } catch { /* storage unavailable */ }
  setTheme(selected, false);
  return selected;
}

export function setTheme(theme: AppTheme, persist = true): void {
  appTheme.value = theme;
  if (typeof document !== 'undefined') {
    for (const element of [document.documentElement, document.body]) {
      if (!element) continue;
      element.classList.toggle('dark', theme === 'dark');
      element.dataset.theme = theme;
      element.style.colorScheme = theme;
    }
  }
  if (!persist) return;
  try {
    localStorage.setItem(THEME_PREFERENCE_KEY, theme);
    localStorage.setItem('theme', theme); // compatibility for older readers only
  } catch { /* the in-memory preference still works */ }
}
