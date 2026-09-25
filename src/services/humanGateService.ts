/**
 * Human gate — friction that is cheap for a person and expensive for a script.
 *
 * Layers (all client-side; the relay firewall enforces the PoW stamp and
 * per-IP creation limits independently, so bypassing this file alone does not
 * let a bot post freely):
 *
 *  1. Trusted input: posting requires real, browser-generated (isTrusted)
 *     input events on the form plus pointer or keyboard activity. Synthetic dispatchEvent()
 *     and element.value assignment never produce these.
 *  2. Form checks (useHumanGate): a hidden honeypot field bots fill in, and a
 *     minimum time between opening a form and submitting it.
 *  3. Automation signals (navigator.webdriver, headless UA, zero-size window)
 *     raise the proof-of-work difficulty instead of blocking outright, so
 *     false positives stay usable but slow.
 *  4. Local rate limit per device with PoW difficulty that escalates with
 *     recent activity.
 */
import { CONTENT_POW_MIN_BITS } from '../../shared-validation/contentPow.js';

export class HumanGateError extends Error {
  readonly silent: boolean;

  constructor(message: string, silent = false) {
    super(message);
    this.name = 'HumanGateError';
    this.silent = silent;
  }
}

export type GateAction = 'post' | 'comment' | 'poll';

const RATE_KEY = 'ip-create-log';
// [max per minute, max per hour]
const LIMITS: Record<GateAction, [number, number]> = {
  post:    [3, 20],
  poll:    [3, 15],
  comment: [8, 90],
};
const MIN_FORM_MS: Record<GateAction, number> = { post: 4_000, poll: 4_000, comment: 1_500 };
const MAX_EXTRA_BITS = 4;

interface InputStats { pointer: number; keys: number; edits: number }
const stats: InputStats = { pointer: 0, keys: 0, edits: 0 };
let tracking = false;

/** Install passive listeners that count browser-trusted user input. Idempotent. */
export function startInputTracking(): void {
  if (tracking || typeof window === 'undefined') return;
  tracking = true;
  const opts = { capture: true, passive: true } as const;
  const onPointer = (e: Event) => { if (e.isTrusted) stats.pointer++; };
  window.addEventListener('pointerdown', onPointer, opts);
  window.addEventListener('touchstart', onPointer, opts);
  window.addEventListener('keydown', (e) => { if (e.isTrusted) stats.keys++; }, opts);
  // `input` covers typing, IME/swipe keyboards, dictation and paste. Setting
  // .value from script fires nothing, and dispatchEvent() is never trusted.
  window.addEventListener('input', (e) => { if (e.isTrusted) stats.edits++; }, opts);
}

export function inputSnapshot(): Readonly<InputStats> {
  return { ...stats };
}

/** Automation signals. Each one adds proof-of-work bits; none blocks by itself. */
export function automationScore(): number {
  if (typeof navigator === 'undefined') return 0;
  let score = 0;
  if (navigator.webdriver) score += 2;
  if (/HeadlessChrome|PhantomJS|Puppeteer|Playwright/i.test(navigator.userAgent)) score += 2;
  if (typeof window !== 'undefined' && (window.outerWidth === 0 || window.outerHeight === 0)) score += 1;
  if (Array.isArray(navigator.languages) && navigator.languages.length === 0) score += 1;
  return score;
}

function readLog(): Record<GateAction, number[]> {
  try {
    const raw = localStorage.getItem(RATE_KEY);
    if (raw) return { post: [], poll: [], comment: [], ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { post: [], poll: [], comment: [] };
}

function writeLog(log: Record<GateAction, number[]>): void {
  try { localStorage.setItem(RATE_KEY, JSON.stringify(log)); } catch { /* ignore */ }
}

function recent(action: GateAction, now = Date.now()): { minute: number; hour: number } {
  const times = readLog()[action].filter(t => now - t < 3_600_000);
  return { minute: times.filter(t => now - t < 60_000).length, hour: times.length };
}

export class HumanGateService {
  /**
   * Throw if this device is creating content too fast.
   * Called by the services right before stamping.
   */
  static assertRateLimit(action: GateAction): void {
    const [perMinute, perHour] = LIMITS[action];
    const { minute, hour } = recent(action);
    if (minute >= perMinute) throw new HumanGateError(`You're posting too fast. Wait a minute and try again.`);
    if (hour >= perHour) throw new HumanGateError(`Hourly limit reached for new ${action}s. Try again later.`);
  }

  /** PoW difficulty for the next item: base + recent-activity + automation signals. */
  static requiredBits(action: GateAction): number {
    const { minute, hour } = recent(action);
    const activity = minute + Math.floor(hour / 5);
    return CONTENT_POW_MIN_BITS + Math.min(MAX_EXTRA_BITS, activity + automationScore());
  }

  static recordCreation(action: GateAction): void {
    const log = readLog();
    const now = Date.now();
    log[action] = [...log[action].filter(t => now - t < 3_600_000), now];
    writeLog(log);
  }

  /**
   * Form-level checks, run by useHumanGate() before a create action.
   * `inputsAtOpen` is the trusted-input snapshot taken when the form opened.
   */
  static assertHumanSubmit(action: GateAction, opts: {
    honeypot: string;
    openedAt: number;
    inputsAtOpen: Readonly<InputStats>;
  }): void {
    // Honeypot: invisible to people, irresistible to form-filling bots. Fail
    // silently so the bot gets no signal about why nothing appeared.
    if (opts.honeypot.trim() !== '') throw new HumanGateError('honeypot', true);

    if (Date.now() - opts.openedAt < MIN_FORM_MS[action]) {
      throw new HumanGateError('That was quick — take a second to review before posting.');
    }

    // Must have edited a field with real input since the form opened, and have
    // used a pointer or the keyboard at some point (keyboard-only users count).
    const now = inputSnapshot();
    const edited = now.edits - opts.inputsAtOpen.edits;
    if (edited < 1 || (now.pointer === 0 && now.keys < 3)) {
      throw new HumanGateError('Please type your message before posting.');
    }
  }
}
