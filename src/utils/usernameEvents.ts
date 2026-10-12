// src/utils/usernameEvents.ts
// Signed username events and the deterministic resolver — IPP-10.
// Pure logic: no Gun, no storage, so it can be tested and replayed anywhere.
import { CryptoService } from '../services/cryptoService';

export const NOTICE_MS = 24 * 60 * 60 * 1000;               // voluntary rotation notice window
export const DEFAULT_TIMELOCK_MS = 14 * 24 * 60 * 60 * 1000; // recovery time lock default
export const MIN_TIMELOCK_MS = 3 * 24 * 60 * 60 * 1000;      // recovery time lock minimum

// ── Event shapes ────────────────────────────────────────────────────────────

export interface UsernameClaim {
  type: 'claim';
  v: 1;
  username: string;
  pubkey: string;
  claimedAt: number;
  level: 'none' | 'issuer';
  cert?: unknown;            // TrustCertificate when level = 'issuer'
  sig: string;
}

export interface RecoveryDesignation {
  type: 'designation';
  v: 1;
  username: string;
  pubkey: string;            // holder who designates
  recoveryPubkey: string;
  timelockMs: number;
  createdAt: number;
  sig: string;
}

export interface KeyRotation {
  type: 'rotation';
  v: 1;
  username: string;
  oldPubkey: string;
  newPubkey: string;
  createdAt: number;
  sigOld?: string;           // voluntary: old key still held
  sigNew: string;
  sigRecovery?: string;      // recovery: designated recovery key
}

export interface RotationCancel {
  type: 'cancel';
  v: 1;
  username: string;
  pubkey: string;            // current holder
  rotationId: string;
  createdAt: number;
  sig: string;
}

export type UsernameEvent = UsernameClaim | RecoveryDesignation | KeyRotation | RotationCancel;

// ── Canonical form, ids, signing ────────────────────────────────────────────

function stable(obj: Record<string, unknown>): string {
  const keys = Object.keys(obj).filter(k => obj[k] !== undefined).sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${JSON.stringify(obj[k])}`).join(',')}}`;
}

/** Everything but signatures: the bytes that are signed. */
export function signingPayload(ev: UsernameEvent): string {
  const { sig, sigOld, sigNew, sigRecovery, ...rest } = ev as any;
  void sig; void sigOld; void sigNew; void sigRecovery;
  return stable(rest as Record<string, unknown>);
}

export function eventId(ev: UsernameEvent): string {
  return CryptoService.hash(signingPayload(ev));
}

/** The timestamp that orders an event. */
export function eventTime(ev: UsernameEvent): number {
  return ev.type === 'claim' ? ev.claimedAt : ev.createdAt;
}

export function normalizeUsername(name: string): string {
  return name.trim().toLowerCase();
}

export function signWith(payload: string, privateKeyHex: string): string {
  return CryptoService.sign(payload, privateKeyHex);
}
function verifyWith(payload: string, sig: string | undefined, pubkey: string): boolean {
  return !!sig && CryptoService.verify(payload, sig, pubkey);
}

// ── Verification ────────────────────────────────────────────────────────────

export function verifyClaim(c: UsernameClaim): boolean {
  return c.v === 1 && verifyWith(signingPayload(c), c.sig, c.pubkey);
}
export function verifyDesignation(d: RecoveryDesignation): boolean {
  return d.v === 1 && d.timelockMs >= MIN_TIMELOCK_MS && verifyWith(signingPayload(d), d.sig, d.pubkey);
}
export function verifyCancel(c: RotationCancel): boolean {
  return c.v === 1 && verifyWith(signingPayload(c), c.sig, c.pubkey);
}
/** A rotation is internally valid when the new key signed it and at least one authorising signature checks out. */
export function verifyRotationSignatures(r: KeyRotation, recoveryPubkey?: string): { voluntary: boolean; recovery: boolean } {
  const payload = signingPayload(r);
  if (r.v !== 1 || !verifyWith(payload, r.sigNew, r.newPubkey)) return { voluntary: false, recovery: false };
  return {
    voluntary: verifyWith(payload, r.sigOld, r.oldPubkey),
    recovery: !!recoveryPubkey && verifyWith(payload, r.sigRecovery, recoveryPubkey),
  };
}

// ── Resolver ────────────────────────────────────────────────────────────────

export interface PendingRotation {
  rotationId: string;
  newPubkey: string;
  requestedAt: number;
  effectiveAt: number;
  kind: 'voluntary' | 'recovery';
}

export interface ResolvedName {
  username: string;
  owner: string | null;                 // current holder, null if never claimed
  level: 'none' | 'issuer';
  claimedAt: number | null;
  recovery: { recoveryPubkey: string; timelockMs: number } | null;
  pending: PendingRotation | null;
  history: Array<{ at: number; what: string; pubkey: string }>;
}

/**
 * Claim conflict rule (IPP-10 §4): issuer-cert beats none; then earliest claimedAt; then lower hash.
 * `isCertValid` verifies issuer certificates (it needs issuer keys this module does not have).
 * It FAILS CLOSED: with no verifier, no certificate counts, so a bogus `cert` can never outrank a claim.
 */
export function pickWinningClaim(
  claims: UsernameClaim[],
  isCertValid: (c: UsernameClaim) => boolean = () => false,
  claimTime: (c: UsernameClaim) => number = (c) => c.claimedAt,
): UsernameClaim | null {
  const valid = claims.filter(c => verifyClaim(c));
  if (!valid.length) return null;
  const rank = (c: UsernameClaim) => (c.level === 'issuer' && !!c.cert && isCertValid(c) ? 0 : 1);
  return [...valid].sort((a, b) =>
    rank(a) - rank(b) || claimTime(a) - claimTime(b) || (eventId(a) < eventId(b) ? -1 : 1),
  )[0];
}

export const MAX_FUTURE_SKEW_MS = 10 * 60 * 1000;

export interface ResolveOptions {
  /** Verify an issuer certificate (signature, issuer trusted, binds THIS username to THIS pubkey). Default: reject all. */
  isCertValid?: (c: UsernameClaim) => boolean;
  /**
   * When this observer first saw an event. Author-supplied timestamps are never trusted for time locks:
   * an event counts from max(declared time, first seen), so backdating cannot shorten a lock.
   */
  firstSeen?: (id: string) => number | undefined;
  /**
   * Relay-witnessed time of an event (the relay's own clock when it first stored it). When present it replaces the
   * author's clock for claim priority and for the start of every time lock, so backdating has no effect at all.
   */
  witness?: (id: string) => number | undefined;
  /** The holder this observer already accepted. A later or backdated claim by another key cannot displace it. */
  pinnedOwner?: string | null;
  maxSkewMs?: number;
}

/**
 * Replay all events for one username up to `now` and return who holds it.
 * Deterministic for a fixed event set and fixed options.
 */
export function resolveUsername(
  usernameRaw: string,
  events: UsernameEvent[],
  now: number,
  opts: ResolveOptions = {},
): ResolvedName & { conflict: boolean } {
  const { isCertValid = () => false, firstSeen, witness, pinnedOwner = null, maxSkewMs = MAX_FUTURE_SKEW_MS } = opts;
  const username = normalizeUsername(usernameRaw);
  // Drop events dated in the future: they cannot be ordered honestly and would otherwise win "earliest" races later.
  const mine = events.filter(e => normalizeUsername(e.username) === username && eventTime(e) <= now + maxSkewMs);
  const out: ResolvedName & { conflict: boolean } = {
    username, owner: null, level: 'none', claimedAt: null, recovery: null, pending: null, history: [], conflict: false,
  };
  /** Sequence events by their declared time (an honest order), but start every lock from when we first SAW the event. */
  const lockStart = (ev: UsernameEvent) => witness?.(eventId(ev)) ?? Math.max(eventTime(ev), firstSeen?.(eventId(ev)) ?? 0);
  const claimTime = (c: UsernameClaim) => witness?.(eventId(c)) ?? c.claimedAt;

  const claims = mine.filter((e): e is UsernameClaim => e.type === 'claim');
  let claim = pickWinningClaim(claims, isCertValid, claimTime);
  if (pinnedOwner) {
    const mineClaim = pickWinningClaim(claims.filter(c => c.pubkey === pinnedOwner), isCertValid, claimTime);
    if (mineClaim) {
      if (claim && claim.pubkey !== mineClaim.pubkey) out.conflict = true; // someone else tried to out-rank the holder
      claim = mineClaim;
    }
  }
  if (!claim) return out;
  out.owner = claim.pubkey;
  out.level = claim.level === 'issuer' && !!claim.cert && isCertValid(claim) ? 'issuer' : 'none';
  out.claimedAt = claim.claimedAt;
  out.history.push({ at: claim.claimedAt, what: 'claimed', pubkey: claim.pubkey });
  const claimAt = claim.claimedAt;

  const timeline = mine
    .filter(e => e.type !== 'claim')
    .sort((a, b) => eventTime(a) - eventTime(b) || (eventId(a) < eventId(b) ? -1 : 1));

  // A rotation whose effective time has passed becomes the new owner; designations reset.
  const settle = (upTo: number) => {
    const p = out.pending;
    if (p && p.effectiveAt <= upTo) {
      out.owner = p.newPubkey;
      out.recovery = null;
      out.pending = null;
      out.history.push({ at: p.effectiveAt, what: `rotated (${p.kind})`, pubkey: p.newPubkey });
    }
  };

  for (const ev of timeline) {
    const t = eventTime(ev);
    if (t < claimAt) continue;   // cannot predate the claim it acts on
    settle(t);

    if (ev.type === 'designation') {
      if (ev.pubkey === out.owner && verifyDesignation(ev)) {
        out.recovery = { recoveryPubkey: ev.recoveryPubkey, timelockMs: ev.timelockMs };
        out.history.push({ at: t, what: 'recovery key set', pubkey: ev.pubkey });
      }
    } else if (ev.type === 'rotation') {
      if (out.pending || ev.oldPubkey !== out.owner || ev.newPubkey === out.owner) continue; // first pending wins
      const sigs = verifyRotationSignatures(ev, out.recovery?.recoveryPubkey);
      const id = eventId(ev);
      if (sigs.voluntary) {
        out.pending = { rotationId: id, newPubkey: ev.newPubkey, requestedAt: t, effectiveAt: lockStart(ev) + NOTICE_MS, kind: 'voluntary' };
        out.history.push({ at: t, what: 'rotation requested', pubkey: ev.newPubkey });
      } else if (sigs.recovery && out.recovery) {
        out.pending = { rotationId: id, newPubkey: ev.newPubkey, requestedAt: t, effectiveAt: lockStart(ev) + out.recovery.timelockMs, kind: 'recovery' };
        out.history.push({ at: t, what: 'recovery requested', pubkey: ev.newPubkey });
      }
    } else if (ev.type === 'cancel') {
      if (out.pending && ev.pubkey === out.owner && ev.rotationId === out.pending.rotationId && verifyCancel(ev)) {
        out.history.push({ at: t, what: 'rotation cancelled', pubkey: ev.pubkey });
        out.pending = null;
      }
    }
  }
  settle(now);
  return out;
}

/** Whole days (rounded up) until a pending rotation takes effect. */
export function daysUntil(effectiveAt: number, now: number): number {
  return Math.max(0, Math.ceil((effectiveAt - now) / (24 * 60 * 60 * 1000)));
}
