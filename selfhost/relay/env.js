/**
 * env.js — every knob the self-host relay has, in one place.
 *
 * Deliberately small: a self-hosted instance should be runnable with zero
 * configuration, so every value here has a default that works on a laptop.
 */

import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const SELFHOST_DIR = path.resolve(here, '..');
export const REPO_DIR = path.resolve(SELFHOST_DIR, '..');

function bool(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return !/^(0|false|no|off)$/i.test(raw);
}

function num(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** `lite` serves the build-free client; `full` serves the Vue build in dist/. */
const edition = (process.env.EDITION || 'lite').toLowerCase() === 'full' ? 'full' : 'lite';

/** In-memory only: nothing is written to disk and a restart is a clean slate. */
const ephemeral = bool('EPHEMERAL', false);

const config = {
  port: num('PORT', 8080),
  host: process.env.HOST || '0.0.0.0',
  edition,
  ephemeral,

  /** Name shown by the lite client. Blank keeps it fully unbranded. */
  instanceName: process.env.INSTANCE_NAME ?? 'Polls',
  accentColor: process.env.ACCENT_COLOR || '#4f7cff',

  /** Where radisk and the soul index live. Ignored when `ephemeral`. */
  dataDir: path.resolve(process.env.DATA_DIR || path.join(SELFHOST_DIR, 'data')),

  /**
   * Static root. `lite/` is served as-is; `full` needs `npm run selfhost:full`,
   * which builds into `selfhost/dist-full/` — deliberately not `dist/`, so a
   * self-host build never overwrites a production bundle sitting in the repo.
   */
  get clientDir() {
    if (process.env.CLIENT_DIR) return path.resolve(process.env.CLIENT_DIR);
    return edition === 'full'
      ? path.join(SELFHOST_DIR, 'dist-full')
      : path.join(SELFHOST_DIR, 'lite');
  },

  /**
   * Short-lived hosting: content older than this is swept from the index and
   * nulled in the graph. `0` disables expiry entirely.
   */
  ttlHours: num('RELAY_TTL_HOURS', 24),
  get ttlMs() { return this.ttlHours > 0 ? this.ttlHours * 3600_000 : 0; },
  sweepIntervalMs: num('SWEEP_INTERVAL_MS', 60_000),

  /**
   * Production gates WS `register` behind an OAuth session, which is why an
   * anonymous client's peer count is always 0. A self-hosted instance has no
   * accounts, so registration is open unless the operator says otherwise.
   */
  requireAuth: bool('REQUIRE_AUTH', false),

  /**
   * Verify the client's hashcash + Schnorr seal on vote/policy requests. The
   * client always produces one, so this costs nothing to leave on; turn it off
   * for LAN events on slow phones (18-bit PoW takes a second or two).
   */
  requirePow: bool('REQUIRE_POW', true),

  /** Per-IP request budget (see rate-limiter.js). */
  httpRateLimit: num('HTTP_RATE_LIMIT', 120),
  wsRateLimit: num('WS_RATE_LIMIT', 240),

  /** Max bytes accepted on a sealed JSON POST body. */
  maxBodyBytes: num('MAX_BODY_BYTES', 256 * 1024),
};

export default config;
