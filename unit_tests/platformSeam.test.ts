import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { resolve, relative, join } from 'path';

/**
 * Guards the platform-adapter seam.
 *
 * One `src/` serves web, Android and desktop. The failure mode this prevents is
 * quiet: a desktop-only import lands in shared code, every developer running
 * `dev:desktop` sees it work, and the web build breaks — or ships 200 KB of
 * Tauri IPC to browser users. Neither shows up until release.
 *
 * A static source check rather than a bundle grep: it costs milliseconds, runs
 * on every PR without a build step, and points at the offending file instead of
 * a minified chunk.
 */

const SRC = resolve(__dirname, '../src');
const TAURI_DIR = resolve(SRC, 'platform/tauri');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|vue)$/.test(entry)) out.push(full);
  }
  return out;
}

const files = walk(SRC);

describe('platform seam', () => {
  it('confines @tauri-apps imports to src/platform/tauri', () => {
    const offenders = files
      .filter((f) => !f.startsWith(TAURI_DIR))
      .filter((f) => /from\s+['"]@tauri-apps\//.test(readFileSync(f, 'utf8')))
      .map((f) => relative(SRC, f));

    // Anything here would be bundled into the browser build, where the Tauri
    // IPC bridge does not exist and `invoke()` throws on first call.
    expect(offenders).toEqual([]);
  });

  it('never imports a platform implementation directly', () => {
    // Shared code must import `@platform/x`, which Vite resolves per target.
    // A direct `platform/web/...` import hard-wires the browser implementation
    // into the desktop build — the bug this seam exists to make impossible.
    const offenders = files
      .filter((f) => !f.startsWith(resolve(SRC, 'platform')))
      .filter((f) => /from\s+['"][^'"]*platform\/(web|tauri)\//.test(readFileSync(f, 'utf8')))
      .map((f) => relative(SRC, f));

    expect(offenders).toEqual([]);
  });

  it('implements the same module surface on both platforms', () => {
    // A module present on one side and missing on the other fails only at the
    // other target's build time, which is usually someone else's machine.
    const names = (dir: string) =>
      readdirSync(dir).filter((f) => f.endsWith('.ts')).sort();

    expect(names(resolve(SRC, 'platform/tauri'))).toEqual(names(resolve(SRC, 'platform/web')));
  });
});
