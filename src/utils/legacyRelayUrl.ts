/** Migrate transport hosts only. Never rewrite certificate issuer domains or signed records. */
export function migrateLegacyRelayUrl(value: string): string {
  try {
    const url = new URL(value);
    const hosts: Record<string, string> = {
      'echo.endless.sbs': 'echo.endless.social',
      'echo2.endless.sbs': 'echo2.endless.social',
    };
    if (!hosts[url.hostname]) return value;
    url.hostname = hosts[url.hostname];
    return url.toString().replace(/\/$/, value.endsWith('/') ? '/' : '');
  } catch { return value; }
}
