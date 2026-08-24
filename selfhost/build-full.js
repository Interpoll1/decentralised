/**
 * build-full.js — build the full Vue client for a self-hosted instance.
 *
 * Why a script instead of a line in package.json: the build needs the values in
 * `selfhost/.env.full` (or `.env.full.local`, if the operator made one) in
 * `process.env` before Vite starts, and it has to work the same on Windows,
 * where `VAR=value cmd` is not a thing.
 *
 * Output goes to `selfhost/dist-full/`, never `dist/`, so building a self-host
 * client cannot clobber a production bundle in the same checkout.
 */

import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const selfhostDir = path.dirname(fileURLToPath(import.meta.url));
const repoDir = path.resolve(selfhostDir, '..');

/** Minimal dotenv: `KEY=value`, `#` comments, optional surrounding quotes. */
function readEnvFile(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const env = {
  ...readEnvFile(path.join(selfhostDir, '.env.full')),
  ...readEnvFile(path.join(selfhostDir, '.env.full.local')),
};

// A real environment variable always wins, so `PORT=9000 npm run selfhost:full`
// and CI overrides behave the way anyone would expect.
for (const [key, value] of Object.entries(env)) {
  if (process.env[key] === undefined) process.env[key] = value;
}

// If the operator moved the port, the baked-in relay URLs have to follow — a
// client built for :8080 talking to a relay on :9000 fails in a way that looks
// like a bug in the app rather than a mismatch in the launch command.
const port = process.env.PORT;
if (port && !process.env.SELFHOST_URLS_PINNED) {
  const httpOrigin = `http://localhost:${port}`;
  process.env.VITE_RELAY_WS = `ws://localhost:${port}`;
  process.env.VITE_RELAY_GUN = `${httpOrigin}/gun`;
  process.env.VITE_RELAY_API = httpOrigin;
  process.env.VITE_WEB_ORIGIN = httpOrigin;
}

console.log(`Building the full client for ${process.env.VITE_RELAY_API || 'the configured relay'}…`);

const result = spawnSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['vite', 'build', '--outDir', path.join('selfhost', 'dist-full'), '--emptyOutDir'],
  { cwd: repoDir, stdio: 'inherit', env: process.env },
);

if (result.status !== 0) {
  console.error('\nBuild failed. The lite client needs no build — try `npm run selfhost:lite`.');
  process.exit(result.status ?? 1);
}
