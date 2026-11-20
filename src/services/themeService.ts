import { ref } from 'vue';

export type AppTheme = 'light' | 'dark';
export const THEME_PREFERENCE_KEY = 'echo_theme_preference_v1';
export const appTheme = ref<AppTheme>('light');

/** The former `theme=dark` value was written automatically, even without a choice.
 * Start that legacy installation in graphite once; preserve all new explicit choices.
 */
export function initializeTheme(): AppTheme {
  let selected: AppTheme = 'light';
  try { if (localStorage.getItem(THEME_PREFERENCE_KEY) === 'dark') selected = 'dark'; } catch { /* storage unavailable */ }
  setTheme(selected);
  return selected;
}

export function setTheme(theme: AppTheme): void {
  appTheme.value = theme;
  if (typeof document !== 'undefined') {
    for (const element of [document.documentElement, document.body]) {
      if (!element) continue;
      element.classList.toggle('dark', theme === 'dark');
      element.dataset.theme = theme;
      element.style.colorScheme = theme;
    }
  }
  try {
    localStorage.setItem(THEME_PREFERENCE_KEY, theme);
    localStorage.setItem('theme', theme); // compatibility for older readers only
  } catch { /* the in-memory preference still works */ }
}
