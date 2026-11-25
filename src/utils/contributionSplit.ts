// src/utils/contributionSplit.ts
//
// Pure logic for the Contribution Graph ("Proof of Contribution").
//
// Phase 1 (shipping now) is credits only: who made a work, in what role, and
// an agreed share — accepted by each contributor and recorded as a versioned,
// hash-chained split. No money moves. `allocateRevenue` exists so revenue
// statements can be previewed and tested before any payment rail is wired up;
// when payments arrive they must go through a regulated processor (e.g. Stripe
// Connect separate charges & transfers), never an Interpoll-held wallet.
//
// Amounts are integer minor units (cents) and shares are basis points
// (10_000 = 100%) so every calculation is exact.

import { canonicalJson } from './forecastScoring';

export const TOTAL_BPS = 10_000;

export const CONTRIBUTOR_ROLES = [
  'originator', 'writer', 'researcher', 'host', 'performer', 'editor',
  'producer', 'photographer', 'artist', 'translator', 'source', 'collaborator',
  'uploader',
] as const;
export type ContributorRole = typeof CONTRIBUTOR_ROLES[number];

export type WorkKind = 'post' | 'poll' | 'video' | 'project';

export interface SplitEntry {
  contributorId: string;
  /** Public display name. Payment/KYC identity is never stored here. */
  displayName: string;
  role: ContributorRole;
  shareBps: number;
}

export interface SplitVersion {
  workId: string;
  workKind: WorkKind;
  version: number;
  entries: SplitEntry[];
  proposedBy: string;
  proposedAt: number;
  /** Hash of the previous version ('' for v1) — makes history tamper-evident. */
  prevHash: string;
  /** Hash of this version's canonical content. */
  hash: string;
}

export type AcceptanceState = 'pending' | 'accepted' | 'declined' | 'disputed';

export interface Acceptance {
  workId: string;
  version: number;
  versionHash: string;
  contributorId: string;
  state: Exclude<AcceptanceState, 'pending'>;
  at: number;
  reason?: string;
  pubkey?: string;
  signature?: string;
}

// ── versions ────────────────────────────────────────────────────────────────

export function validateSplit(entries: SplitEntry[]): string[] {
  const errors: string[] = [];
  if (!entries.length) errors.push('Add at least one contributor.');
  const seen = new Set<string>();
  let total = 0;
  for (const e of entries) {
    if (!e.contributorId) errors.push('Every contributor needs an account.');
    if (seen.has(e.contributorId)) errors.push(`${e.displayName || e.contributorId} is listed twice.`);
    seen.add(e.contributorId);
    if (!CONTRIBUTOR_ROLES.includes(e.role)) errors.push(`Unknown role "${e.role}".`);
    if (!Number.isInteger(e.shareBps) || e.shareBps < 0) errors.push('Shares must be whole basis points ≥ 0.');
    total += e.shareBps;
  }
  if (entries.length && total !== TOTAL_BPS) {
    errors.push(`Shares add up to ${(total / 100).toFixed(2)}%, not 100%.`);
  }
  return errors;
}

export function percentToBps(percent: number): number {
  return Math.round(percent * 100);
}

export function splitContentPayload(v: Omit<SplitVersion, 'hash'>): string {
  const entries = [...v.entries]
    .sort((a, b) => a.contributorId.localeCompare(b.contributorId))
    .map(({ contributorId, role, shareBps }) => ({ contributorId, role, shareBps }));
  return canonicalJson({
    v: 1, type: 'contribution-split', workId: v.workId, workKind: v.workKind,
    version: v.version, entries, proposedBy: v.proposedBy, proposedAt: v.proposedAt,
    prevHash: v.prevHash,
  });
}

/**
 * Build the next split version. `hashFn` is injected (CryptoService.hash in the
 * app) so this module stays pure and testable.
 */
export function buildSplitVersion(
  input: { workId: string; workKind: WorkKind; entries: SplitEntry[]; proposedBy: string; proposedAt: number },
  previous: SplitVersion | null,
  hashFn: (s: string) => string,
): SplitVersion {
  const errors = validateSplit(input.entries);
  if (errors.length) throw new Error(errors.join(' '));
  const base = {
    ...input,
    version: previous ? previous.version + 1 : 1,
    prevHash: previous ? previous.hash : '',
  };
  return { ...base, hash: hashFn(splitContentPayload(base)) };
}

/** Verify each version's hash and its link to the previous one. */
export function verifyHistory(history: SplitVersion[], hashFn: (s: string) => string): boolean {
  const sorted = [...history].sort((a, b) => a.version - b.version);
  for (let i = 0; i < sorted.length; i++) {
    const v = sorted[i];
    if (v.version !== i + 1) return false;
    if (v.prevHash !== (i === 0 ? '' : sorted[i - 1].hash)) return false;
    const { hash, ...rest } = v;
    if (hashFn(splitContentPayload(rest)) !== hash) return false;
  }
  return true;
}

/**
 * Contributors who must approve a change from `prev` to `next`: anyone added,
 * removed, or whose role/share changed. On v1 everyone must approve.
 */
export function affectedContributors(prev: SplitVersion | null, next: SplitVersion): string[] {
  if (!prev) return next.entries.map((e) => e.contributorId);
  const before = new Map(prev.entries.map((e) => [e.contributorId, e]));
  const after = new Map(next.entries.map((e) => [e.contributorId, e]));
  const ids = new Set([...before.keys(), ...after.keys()]);
  return [...ids].filter((id) => {
    const a = before.get(id), b = after.get(id);
    return !a || !b || a.role !== b.role || a.shareBps !== b.shareBps;
  });
}

// ── acceptance ──────────────────────────────────────────────────────────────

/** Latest acceptance state per contributor for a given version. */
export function acceptanceStates(version: SplitVersion, acceptances: Acceptance[]): Map<string, AcceptanceState> {
  const states = new Map<string, AcceptanceState>(version.entries.map((e) => [e.contributorId, 'pending']));
  const latest = new Map<string, Acceptance>();
  for (const a of acceptances) {
    if (a.workId !== version.workId || a.version !== version.version || a.versionHash !== version.hash) continue;
    if (!states.has(a.contributorId)) continue;
    const prev = latest.get(a.contributorId);
    if (!prev || a.at > prev.at) latest.set(a.contributorId, a);
  }
  for (const [id, a] of latest) states.set(id, a.state);
  return states;
}

export type SplitStatus = 'draft' | 'active' | 'disputed';

/** `active` only when every listed contributor accepted this exact version. */
export function splitStatus(version: SplitVersion, acceptances: Acceptance[]): SplitStatus {
  const states = [...acceptanceStates(version, acceptances).values()];
  if (states.some((s) => s === 'disputed' || s === 'declined')) return 'disputed';
  if (states.every((s) => s === 'accepted')) return 'active';
  return 'draft';
}

/** Public credits: only contributors who accepted are shown as credited. */
export function publicCredits(version: SplitVersion, acceptances: Acceptance[]): SplitEntry[] {
  const states = acceptanceStates(version, acceptances);
  return version.entries.filter((e) => states.get(e.contributorId) === 'accepted');
}

// ── revenue statement (preview only in phase 1) ─────────────────────────────

export interface RevenueInput {
  grossCents: number;
  processingFeesCents: number;
  refundsCents: number;
  platformBps: number;
}

export interface StatementLine {
  contributorId: string;
  displayName: string;
  role: ContributorRole;
  shareBps: number;
  amountCents: number;
  /** `held` when the contributor has not accepted or the split is disputed. */
  disposition: 'payable' | 'held';
}

export interface RevenueStatement {
  grossCents: number;
  processingFeesCents: number;
  refundsCents: number;
  platformCents: number;
  distributableCents: number;
  lines: StatementLine[];
  heldCents: number;
  payableCents: number;
}

/**
 * Split distributable revenue by share using largest-remainder rounding so the
 * lines always sum exactly to the distributable amount. Shares belonging to
 * contributors who have not accepted — or every share when the split is
 * disputed — are held, never redirected to the uploader.
 */
export function allocateRevenue(
  input: RevenueInput,
  version: SplitVersion,
  acceptances: Acceptance[],
): RevenueStatement {
  const net = Math.max(0, input.grossCents - input.processingFeesCents - input.refundsCents);
  const platformCents = Math.floor((net * input.platformBps) / TOTAL_BPS);
  const distributable = net - platformCents;

  const raw = version.entries.map((e) => (distributable * e.shareBps) / TOTAL_BPS);
  const amounts = raw.map(Math.floor);
  let remainder = distributable - amounts.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; remainder > 0 && k < order.length; k++, remainder--) amounts[order[k].i]++;

  const status = splitStatus(version, acceptances);
  const states = acceptanceStates(version, acceptances);
  const lines: StatementLine[] = version.entries.map((e, i) => ({
    contributorId: e.contributorId,
    displayName: e.displayName,
    role: e.role,
    shareBps: e.shareBps,
    amountCents: amounts[i],
    disposition: status !== 'disputed' && states.get(e.contributorId) === 'accepted' ? 'payable' : 'held',
  }));
  const heldCents = lines.filter((l) => l.disposition === 'held').reduce((a, l) => a + l.amountCents, 0);

  return {
    grossCents: input.grossCents,
    processingFeesCents: input.processingFeesCents,
    refundsCents: input.refundsCents,
    platformCents,
    distributableCents: distributable,
    lines,
    heldCents,
    payableCents: distributable - heldCents,
  };
}

export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
