/**
 * Opaque route tokens — keep identifiers and secrets out of the address bar.
 *
 * Routes like /chat/:userId and /receipt/:code used to show a user's public
 * key, display name or vote verification code in the URL, where it leaks into
 * browser history/autocomplete, screenshots, screen shares and over-the-
 * shoulder views. Instead the app navigates to /chat/~k3j9d8f2a1: the token
 * maps to the real data in localStorage on this device only.
 *
 * Inbound links that still carry the raw value (old shares, notifications)
 * keep working: the view resolves the raw value, seals it, and rewrites the
 * address bar with replaceAddressBar().
 *
 * localStorage (not sessionStorage) so refresh, back/forward and "open in new
 * tab" keep working. The same values already live in IndexedDB (chat list,
 * receipts), so this adds no new at-rest exposure.
 */

export type SealedKind = 'chat' | 'receipt';
type SealedData = Record<string, string>;

interface VaultEntry { k: SealedKind; d: SealedData; t: number }

const STORAGE_KEY = 'ip-route-vault';
const TOKEN_PREFIX = '~';
const MAX_ENTRIES = 300;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

// Field that identifies the entry, so the same target reuses its token.
const PRIMARY: Record<SealedKind, string> = { chat: 'id', receipt: 'code' };

let memoryVault: Record<string, VaultEntry> = {};

function load(): Record<string, VaultEntry> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as Record<string, VaultEntry>;
  } catch { /* storage blocked or corrupt — fall back to memory */ }
  return memoryVault;
}

function save(vault: Record<string, VaultEntry>): void {
  const now = Date.now();
  const kept = Object.entries(vault)
    .filter(([, e]) => now - e.t < MAX_AGE_MS)
    .sort((a, b) => b[1].t - a[1].t)
    .slice(0, MAX_ENTRIES);
  memoryVault = Object.fromEntries(kept);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(memoryVault)); } catch { /* memory only */ }
}

function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return TOKEN_PREFIX + Array.from(bytes, b => (b % 36).toString(36)).join('');
}

export function isSealedToken(value: unknown): value is string {
  return typeof value === 'string' && /^~[a-z0-9]{8}$/.test(value);
}

/** Store data under an opaque token (reusing the existing token for the same target). */
export function sealRoute(kind: SealedKind, data: SealedData): string {
  const vault = load();
  const key = PRIMARY[kind];
  const existing = Object.entries(vault).find(([, e]) => e.k === kind && e.d[key] === data[key]);
  const token = existing?.[0] ?? newToken();
  vault[token] = { k: kind, d: { ...existing?.[1].d, ...data }, t: Date.now() };
  save(vault);
  return token;
}

/** Resolve a token back to its data, or null if unknown on this device. */
export function unsealRoute(kind: SealedKind, token: string): SealedData | null {
  if (!isSealedToken(token)) return null;
  const entry = load()[token];
  return entry && entry.k === kind ? entry.d : null;
}

/** Rewrite the visible URL without a router navigation (no view remount). */
export function replaceAddressBar(path: string): void {
  try {
    const state = window.history.state && typeof window.history.state === 'object'
      ? { ...window.history.state, current: path }
      : window.history.state;
    window.history.replaceState(state, '', path);
  } catch { /* non-browser context */ }
}

// ── Route builders ───────────────────────────────────────────────────────────

export function chatPath(userId: string, name?: string): string {
  const data: SealedData = { id: userId };
  if (name) data.name = name;
  return `/chat/${sealRoute('chat', data)}`;
}

/** The real user id behind a /chat/:userId param (sealed or raw). */
export function resolveChatUserId(param: unknown): string {
  if (typeof param !== 'string' || !param) return '';
  if (isSealedToken(param)) return unsealRoute('chat', param)?.id ?? '';
  return param;
}

export function receiptPath(verificationCode: string): string {
  return `/receipt/${sealRoute('receipt', { code: verificationCode })}`;
}
