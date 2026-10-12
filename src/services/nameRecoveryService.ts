// src/services/nameRecoveryService.ts
// Username claims, recovery designations and key succession over Gun — IPP-10.
// Pure rules live in utils/usernameEvents.ts; this file is the I/O + flows around them.
import { GunService } from './gunService';
import { KeyService } from './keyService';
import { CryptoService } from './cryptoService';
import { StorageService } from './storageService';
import { gunPut, gunReadChildren } from '../utils/gunAsync';
import config from '../config';
import {
  DEFAULT_TIMELOCK_MS, daysUntil, eventId, normalizeUsername, resolveUsername, signWith, signingPayload,
  type KeyRotation, type RecoveryDesignation, type ResolvedName, type RotationCancel, type UsernameClaim,
  type UsernameEvent,
} from '../utils/usernameEvents';

/** Global (non-namespaced) root: a name is unique across data versions, like `usernames`. */
const EVENTS_ROOT = 'username-events';
const PENDING_KEY_PREFIX = 'pending-key-rotation:';
const LEDGER_PREFIX = 'name-ledger:';

/** The relay is a witness: it checks signatures, remembers each name's recovery key, and stamps when it first saw each event. */
async function relayCall(path: string, init?: RequestInit): Promise<Response | null> {
  try {
    const base = config.relay.api.replace(/\/$/, '');
    return await fetch(`${base}${path}`, { ...init, signal: AbortSignal.timeout(8000) });
  } catch { return null; }
}

/** What THIS device has observed about a name: who it accepted as holder, and when it first saw each event. */
interface Ledger { pinned?: string; seen: Record<string, number>; witness?: Record<string, number>; }

const RELAY_ERRORS: Record<string, string> = {
  NAME_TAKEN: 'That username is already taken.',
  NAME_NOT_CLAIMED: 'That username has not been claimed.',
  NOT_HOLDER: 'This key does not hold that username.',
  NO_RECOVERY_KEY: 'That username has no recovery key, so it cannot be recovered.',
  RECOVERY_KEY_MISMATCH: 'That recovery phrase does not match this username.',
  ROTATION_PENDING: 'A recovery or key change is already pending for this username.',
  NOTHING_TO_CANCEL: 'There is nothing to cancel.',
  OLDER_DESIGNATION: 'A newer recovery key is already registered.',
  STALE_OR_FUTURE_EVENT: 'Your device clock is more than 15 minutes off. Fix the time and try again.',
  BAD_TIMELOCK: 'That waiting period is not allowed.',
  TOO_MANY_EVENTS: 'This username has too many events; try again later.',
};

/** Where signed events live. Gun in production; swappable so the flows can be tested without a network. */
export interface EventStore {
  put(username: string, id: string, json: string): Promise<boolean>;
  list(username: string): Promise<string[]>;
}

export function createGunEventStore(getGun: () => any): EventStore {
  return {
    async put(username, id, json) {
      const ack = await gunPut(getGun().get(EVENTS_ROOT).get(username).get(id), { json });
      return ack.ok;
    },
    async list(username) {
      const children = await gunReadChildren<any>(getGun().get(EVENTS_ROOT).get(username), { minMs: 2000, idleMs: 600, maxMs: 7000 });
      return children.map(c => (typeof c.value === 'string' ? c.value : c.value?.json)).filter((j): j is string => typeof j === 'string');
    },
  };
}

export interface NameStatus {
  username: string;
  resolved: ResolvedName;
  /** Another key published an earlier-dated or higher-ranked claim than the holder this device already accepted. It was ignored. */
  conflict: boolean;
  /** This device's key currently holds the name. */
  isHolder: boolean;
  hasRecovery: boolean;
  /** Name was claimed before signed claims existed (unsigned `usernames/` record) and belongs to this key — sign it to secure it. */
  legacyUnsigned: boolean;
  /** A pending rotation that would move the name away from this device's key. */
  pendingAgainstMe: { newPubkey: string; effectiveAt: number; days: number; kind: 'voluntary' | 'recovery'; rotationId: string } | null;
  /** A pending rotation that would move the name TO this device's key (we requested it). */
  pendingForMe: { effectiveAt: number; days: number; kind: 'voluntary' | 'recovery' } | null;
}

function parseEvent(raw: any): UsernameEvent | null {
  try {
    const ev = JSON.parse(typeof raw === 'string' ? raw : raw?.json);
    if (!ev || typeof ev !== 'object') return null;
    return ['claim', 'designation', 'rotation', 'cancel'].includes(ev.type) ? (ev as UsernameEvent) : null;
  } catch { return null; }
}

export class NameRecoveryService {
  /** Swap in another store (tests, or an isolated Gun instance). */
  static store: EventStore = createGunEventStore(() => GunService.getGun());

  // ── transport ──────────────────────────────────────────────────────────────

  /** Set to false to skip the relay witness (tests, or an isolated Gun instance). */
  static relayEnabled = true;

  /**
   * Publish a signed event. The relay validates it first and stamps the time it first saw it; if the relay says
   * no (taken, unauthorised, bad phrase…) we stop and raise a readable error. If the relay is unreachable the
   * event still goes out over Gun, so recovery keeps working without the relay.
   */
  static async publish(ev: UsernameEvent): Promise<boolean> {
    const name = normalizeUsername(ev.username);
    const id = eventId(ev);
    const ledger = await this.loadLedger(name);
    // Our own event counts from now, whatever timestamp it declares.
    ledger.seen[id] ??= Date.now();

    if (this.relayEnabled) {
      const res = await relayCall('/api/username-events', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ev),
      });
      if (res && res.status >= 400 && res.status < 500) {
        const code = (await res.json().catch(() => ({})))?.error as string | undefined;
        throw new Error(RELAY_ERRORS[code ?? ''] ?? `The relay rejected this request (${code ?? res.status}).`);
      }
      if (res?.ok) {
        const body = await res.json().catch(() => null);
        if (body && Number.isFinite(body.firstSeen)) (ledger.witness ??= {})[id] = body.firstSeen;
      }
    }

    if (ev.type === 'claim' && !ledger.pinned && (await this.resolve(name)).owner === null) ledger.pinned = ev.pubkey;
    await this.saveLedger(name, ledger);
    return this.store.put(name, id, JSON.stringify(ev));
  }

  private static async loadLedger(name: string): Promise<Ledger> {
    const raw = await StorageService.getMetadata(LEDGER_PREFIX + name).catch(() => null);
    return raw && typeof raw === 'object' ? { pinned: raw.pinned, seen: raw.seen ?? {}, witness: raw.witness ?? {} } : { seen: {}, witness: {} };
  }
  private static async saveLedger(name: string, l: Ledger): Promise<void> {
    await StorageService.setMetadata(LEDGER_PREFIX + name, l).catch(() => { /* private mode */ });
  }

  /**
   * Sync certificate check for the resolver. Fails closed: the issuer must be one we trust, its signature must
   * verify, and the certificate must bind THIS username to THIS claimant key.
   */
  private static async certVerifier(): Promise<(c: UsernameClaim) => boolean> {
    try {
      const { TrustService } = await import('./trustService');
      const issuers = await TrustService.getIssuers();
      return (c) => {
        const cert: any = c.cert;
        if (!cert || typeof cert !== 'object') return false;
        const issuer = issuers.find((i: any) => i.domain === cert.issuerDomain);
        if (!issuer) return false;
        if (normalizeUsername(String(cert.username ?? '')) !== normalizeUsername(c.username)) return false;
        if (cert.userPubkey !== c.pubkey) return false;
        return TrustService.verifyCertificate(cert, issuer);
      };
    } catch { return () => false; }
  }

  /** Events from Gun plus the relay, merged by id, with the relay's first-seen stamps. */
  static async fetchAll(username: string): Promise<{ events: UsernameEvent[]; witness: Record<string, number> }> {
    const name = normalizeUsername(username);
    const byId = new Map<string, UsernameEvent>();
    const witness: Record<string, number> = {};
    const add = (raw: unknown) => {
      const ev = parseEvent(raw);
      if (ev) byId.set(eventId(ev), ev);
    };
    const [rows, relayRes] = await Promise.all([
      this.store.list(name).catch(() => [] as string[]),
      this.relayEnabled ? relayCall(`/api/username-events/${encodeURIComponent(name)}`) : Promise.resolve(null),
    ]);
    rows.forEach(add);
    if (relayRes?.ok) {
      const body = await relayRes.json().catch(() => null);
      for (const row of body?.events ?? []) {
        add(JSON.stringify(row.event));
        // Trust the stamp only for an event whose id matches what we computed ourselves.
        const ev = parseEvent(JSON.stringify(row.event));
        if (ev && eventId(ev) === row.id && Number.isFinite(row.firstSeen)) witness[row.id] = row.firstSeen;
      }
    }
    return { events: Array.from(byId.values()), witness };
  }

  static async fetchEvents(username: string): Promise<UsernameEvent[]> {
    return (await this.fetchAll(username)).events;
  }

  static async resolve(username: string, now = Date.now()): Promise<ResolvedName & { conflict: boolean }> {
    const name = normalizeUsername(username);
    const { events, witness } = await this.fetchAll(name);
    const ledger = await this.loadLedger(name);
    let dirty = false;
    ledger.witness ??= {};
    for (const [id, t] of Object.entries(witness)) if (ledger.witness[id] !== t) { ledger.witness[id] = t; dirty = true; }
    for (const ev of events) {
      const id = eventId(ev);
      if (ledger.seen[id] === undefined) { ledger.seen[id] = now; dirty = true; }
    }
    const res = resolveUsername(name, events, now, {
      isCertValid: await this.certVerifier(),
      firstSeen: (id) => ledger.seen[id],
      witness: (id) => ledger.witness?.[id],
      pinnedOwner: ledger.pinned ?? null,
    });
    // Remember who held the name. After a rotation has really taken effect the new holder becomes the pin.
    if (res.owner && !res.pending && !res.conflict && ledger.pinned !== res.owner) { ledger.pinned = res.owner; dirty = true; }
    if (dirty) await this.saveLedger(name, ledger);
    return res;
  }

  // ── claims ─────────────────────────────────────────────────────────────────

  /** Publish a signed claim for a name this device just claimed (unverified or issuer-certified). */
  static async publishClaim(username: string, level: 'none' | 'issuer', cert?: unknown): Promise<boolean> {
    const pubkey = await KeyService.getPublicKeyHex();
    const claim: UsernameClaim = {
      type: 'claim', v: 1, username: normalizeUsername(username), pubkey,
      claimedAt: Date.now(), level, ...(cert ? { cert } : {}), sig: '',
    };
    claim.sig = signWith(signingPayload(claim), await KeyService.getPrivateKeyHex());
    try { return await this.publish(claim); } catch { return false; } // e.g. the relay says the name is taken
  }

  /** Sign a claim for a legacy (unsigned) name that this key already owns. */
  static async secureLegacyName(username: string): Promise<boolean> {
    const st = await this.status(username);
    if (!st.legacyUnsigned) return false;
    return this.publishClaim(username, 'none');
  }

  // ── status ─────────────────────────────────────────────────────────────────

  static async status(username: string, now = Date.now()): Promise<NameStatus> {
    const resolved = await this.resolve(username, now);
    const me = await KeyService.getPublicKeyHex();
    const p = resolved.pending;
    let legacyUnsigned = false;
    if (!resolved.owner) {
      try {
        const { TrustService } = await import('./trustService');
        legacyUnsigned = (await TrustService.resolveUsernameOwner(username)) === me;
      } catch { /* offline: leave false */ }
    }
    return {
      username: resolved.username,
      resolved,
      conflict: resolved.conflict,
      isHolder: resolved.owner === me,
      hasRecovery: !!resolved.recovery,
      legacyUnsigned,
      pendingAgainstMe: p && resolved.owner === me && p.newPubkey !== me
        ? { newPubkey: p.newPubkey, effectiveAt: p.effectiveAt, days: daysUntil(p.effectiveAt, now), kind: p.kind, rotationId: p.rotationId }
        : null,
      pendingForMe: p && p.newPubkey === me
        ? { effectiveAt: p.effectiveAt, days: daysUntil(p.effectiveAt, now), kind: p.kind }
        : null,
    };
  }

  // ── recovery key (§6.1) ────────────────────────────────────────────────────

  /**
   * Create and register a recovery key for a name this device holds.
   * Returns the name-recovery phrase — shown once; the private half is never stored.
   */
  static async setupRecovery(username: string, timelockMs = DEFAULT_TIMELOCK_MS): Promise<{ phrase: string; recoveryPubkey: string }> {
    const st = await this.status(username);
    if (!st.isHolder) throw new Error('This device does not hold that name.');
    const recPriv = KeyService.generatePrivateKey();
    const recoveryPubkey = KeyService.getPublicKey(recPriv);
    const holder = await KeyService.getPublicKeyHex();
    const d: RecoveryDesignation = {
      type: 'designation', v: 1, username: normalizeUsername(username), pubkey: holder,
      recoveryPubkey, timelockMs, createdAt: Date.now(), sig: '',
    };
    d.sig = signWith(signingPayload(d), await KeyService.getPrivateKeyHex());
    if (!(await this.publish(d))) throw new Error('Could not publish the recovery key. Check your relay connection and try again.');
    return { phrase: CryptoService.privateKeyToMnemonic(recPriv), recoveryPubkey };
  }

  /** Recover a name onto THIS device's key using the name-recovery phrase. Starts the time lock. */
  static async requestRecovery(username: string, phrase: string): Promise<NameStatus> {
    const name = normalizeUsername(username);
    const recPriv = CryptoService.mnemonicToPrivateKey(phrase);   // throws on a bad phrase
    const recPub = KeyService.getPublicKey(recPriv);
    const resolved = await this.resolve(name);
    if (!resolved.owner) throw new Error('That name has not been claimed.');
    if (!resolved.recovery) throw new Error('That name has no recovery key set, so it cannot be recovered.');
    if (resolved.recovery.recoveryPubkey !== recPub) throw new Error('That recovery phrase does not match this name.');
    const me = await KeyService.getPublicKeyHex();
    if (resolved.owner === me) throw new Error('This device already holds that name.');
    if (resolved.pending) throw new Error('A recovery is already pending for this name.');

    const r: KeyRotation = {
      type: 'rotation', v: 1, username: name, oldPubkey: resolved.owner, newPubkey: me, createdAt: Date.now(), sigNew: '',
    };
    const payload = signingPayload(r);
    r.sigNew = signWith(payload, await KeyService.getPrivateKeyHex());
    r.sigRecovery = signWith(payload, recPriv);
    if (!(await this.publish(r))) throw new Error('Could not publish the recovery request. Check your relay connection.');
    return this.status(name, Date.now() + 1000);
  }

  /** The current holder cancels a pending rotation (e.g. someone else is trying to recover their name). */
  static async cancelPending(username: string): Promise<boolean> {
    const st = await this.status(username);
    const p = st.resolved.pending;
    if (!st.isHolder || !p) return false;
    const me = await KeyService.getPublicKeyHex();
    const c: RotationCancel = { type: 'cancel', v: 1, username: st.username, pubkey: me, rotationId: p.rotationId, createdAt: Date.now(), sig: '' };
    c.sig = signWith(signingPayload(c), await KeyService.getPrivateKeyHex());
    return this.publish(c);
  }

  // ── voluntary key rotation (§5) ────────────────────────────────────────────

  /**
   * Prepare a new identity key and announce it. The new private key is kept on this device
   * until the 24-hour notice window passes; `activateRotatedKey` then switches to it.
   */
  static async startKeyRotation(username: string): Promise<{ effectiveAt: number; newPubkey: string }> {
    const st = await this.status(username);
    if (!st.isHolder) throw new Error('This device does not hold that name.');
    if (st.resolved.pending) throw new Error('A rotation is already pending for this name.');
    const newPriv = KeyService.generatePrivateKey();
    const newPub = KeyService.getPublicKey(newPriv);
    const old = await KeyService.getPublicKeyHex();
    const r: KeyRotation = { type: 'rotation', v: 1, username: st.username, oldPubkey: old, newPubkey: newPub, createdAt: Date.now(), sigNew: '' };
    const payload = signingPayload(r);
    r.sigNew = signWith(payload, newPriv);
    r.sigOld = signWith(payload, await KeyService.getPrivateKeyHex());
    if (!(await this.publish(r))) throw new Error('Could not publish the rotation. Check your relay connection.');
    const effectiveAt = r.createdAt + 24 * 60 * 60 * 1000;
    await StorageService.setMetadata(PENDING_KEY_PREFIX + st.username, { privateKey: newPriv, publicKey: newPub, effectiveAt });
    return { effectiveAt, newPubkey: newPub };
  }

  static async pendingRotationKey(username: string): Promise<{ publicKey: string; effectiveAt: number } | null> {
    const stored = await StorageService.getMetadata(PENDING_KEY_PREFIX + normalizeUsername(username)).catch(() => null);
    return stored?.privateKey ? { publicKey: stored.publicKey, effectiveAt: stored.effectiveAt } : null;
  }

  /** After the notice window, switch this device to the new key. The caller reloads the app. */
  static async activateRotatedKey(username: string): Promise<void> {
    const name = normalizeUsername(username);
    const stored = await StorageService.getMetadata(PENDING_KEY_PREFIX + name);
    if (!stored?.privateKey) throw new Error('No pending key rotation on this device.');
    const resolved = await this.resolve(name);
    if (resolved.owner !== stored.publicKey) throw new Error('The rotation has not taken effect yet.');
    await KeyService.importPrivateKey(stored.privateKey);
    await StorageService.setMetadata('user-profile-v2', null);
    await StorageService.setMetadata(PENDING_KEY_PREFIX + name, null);
  }

  // ── verified names (§6.2) ──────────────────────────────────────────────────

  /**
   * Ask the name's trust issuer to re-issue the certificate to this device's key.
   * The issuer only does so when this key already owns the name (signed claim-v2).
   */
  static async reissueVerified(username: string, onProgress?: (nonce: number) => void): Promise<void> {
    const { TrustService } = await import('./trustService');
    const trust = await TrustService.resolveTrust(username);
    const issuer = (trust as any).issuer ?? (await TrustService.getIssuers()).find(i => i.domain === (trust as any).certificate?.issuerDomain);
    if (!issuer) throw new Error('Could not find the trust issuer for this name.');
    await TrustService.solveAndClaimVerifiedUsername(issuer, username, onProgress);
  }
}
