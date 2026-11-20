import { Capacitor, registerPlugin } from '@capacitor/core';

const ThemeChrome = registerPlugin<{ setAppearance(options: { dark: boolean }): Promise<void> }>('EchoThemeChrome');

export async function syncNativeTheme(dark: boolean): Promise<void> {
  if (Capacitor.getPlatform() !== 'android') return;
  try { await ThemeChrome.setAppearance({ dark }); } catch { /* browser/older native shell */ }
}
