/**
 * trustService.ts
 *
 * Manages "trust issuers" — external authorities (e.g. viktor@endless.sbs)
 * whose endorsement elevates a username from UNVERIFIED to VERIFIED.
 *
 * Architecture:
 *   1. A trust issuer is identified by a domain + a well-known public key.
 *   2. When a user wants a verified username they POST their pubkey + desired
 *      username to the issuer's endpoint. The issuer returns a PoW challenge
 *      (~15 s on average hardware = difficulty 22 on SHA-256) plus a signed
 *      token they must embed in their Gun profile after solving.
 *   3. Any peer can re-verify by fetching the issuer's pubkey from GunDB
 *      `trust-issuers/<domain>` and checking the embedded certificate.
 *   4. Unverified usernames are accepted immediately but carry rate-limit
 *      penalties server-side (see RATE_LIMIT_TIERS below).
 *
 * PoW difficulty target:
 *   SHA-256 leading-zero-bit difficulty 22 → expected 4 M hashes → ~15 s
 *   on a 2024 mid-range laptop (JS single-thread ~250 kH/s).
 *   Trust issuers SHOULD use this difficulty for their challenge response.
 */

import { GunService } from './gunService';
import { KeyService } from './keyService';
import { CryptoService } from './cryptoService';

// ─── Types ────────────────────────────────────────────────────────────────────

export type TrustLevel = 'none' | 'verified';

export interface TrustIssuer {
  domain: string;          // e.g. "endless.sbs"
  contact: string;         // e.g. "viktor@endless.sbs"
  endpoint: string;        // REST API base, e.g. "https://endless.sbs/trust"
  publicKey: string;       // secp256k1 x-only hex, used to verify certificates
  addedAt: number;
}

/**
 * A certificate issued by a TrustIssuer and embedded in the user's Gun profile.
 * Verified by checking CryptoService.verify(payload, sig, issuer.publicKey).
 */
export interface TrustCertificate {
  issuerDomain: string;
  username: string;        // The username that was endorsed
  userPubkey: string;      // The user's secp256k1 public key
  issuedAt: number;        // Unix ms
  expiresAt: number;       // Unix ms
  signature: string;       // Schnorr sig over JSON.stringify({issuerDomain,username,userPubkey,issuedAt,expiresAt})
}

export interface VerifiedUsername {
  username: string;
  level: TrustLevel;
  certificate?: TrustCertificate;
  issuer?: TrustIssuer;
}

/**
 * Server-side rate limit actions per trust tier.
 * These constants are exported for use in websocketService / powService
 * when constructing messages — the relay enforces matching limits.
 */
export const RATE_LIMIT_TIERS = {
  /** Unverified: ~1 post/min, 5 comments/min */
  none: { postsPerMinute: 1, commentsPerMinute: 5, pollsPerHour: 2 },
  /** Verified: 10 posts/min, 30 comments/min */
  verified: { postsPerMinute: 10, commentsPerMinute: 30, pollsPerHour: 20 },
} as const;

/**
 * PoW difficulty issued by trust issuers for the claim challenge.
 * ~15 s on average 2024 hardware (JS, single-threaded).
 */
export const TRUST_POW_DIFFICULTY = 22;

// ─── GunDB schema paths ────────────────────────────────────────────────────

const GUN_ISSUERS_ROOT = 'trust-issuers';
const GUN_USERNAMES_ROOT = 'usernames'; // username → { userId, pubkey, certificate? }

// ─── Helpers ──────────────────────────────────────────────────────────────────

function certPayload(cert: Omit<TrustCertificate, 'signature'>): string {
  const { issuerDomain, username, userPubkey, issuedAt, expiresAt } = cert;
  return JSON.stringify({ issuerDomain, username, userPubkey, issuedAt, expiresAt });
}

// ─── TrustService ─────────────────────────────────────────────────────────────

export class TrustService {
  private static issuersCache: TrustIssuer[] | null = null;
  private static certCache = new Map<string, TrustCertificate | null>(); // pubkey → cert

  // ── Issuers ────────────────────────────────────────────────────────────────

  /** Fetch all registered trust issuers from GunDB. */
  static async getIssuers(): Promise<TrustIssuer[]> {
    if (this.issuersCache) return this.issuersCache;
    const gun = GunService.getGun();
    const issuers: TrustIssuer[] = [];

    await new Promise<void>((resolve) => {
      gun.get(GUN_ISSUERS_ROOT).map().once((data: any) => {
        if (data && data.domain) issuers.push(data as TrustIssuer);
      });
      setTimeout(resolve, 2000);
    });

    this.issuersCache = issuers;
    return issuers;
  }

  /** Register a new trust issuer (admin/bootstrap only). */
  static async registerIssuer(issuer: Omit<TrustIssuer, 'addedAt'>): Promise<void> {
    const gun = GunService.getGun();
    const full: TrustIssuer = { ...issuer, addedAt: Date.now() };
    await gun.get(GUN_ISSUERS_ROOT).get(issuer.domain).put(full);
    this.issuersCache = null; // invalidate
  }

  // ── Username claims ────────────────────────────────────────────────────────

  /**
   * Claim a username without a trust issuer (unverified).
   * The username is stored in GunDB mapped to the user's device ID + pubkey.
   * Returns false if the username is already taken.
   */
  static async claimUnverifiedUsername(username: string): Promise<boolean> {
    if (!this.isValidUsername(username)) throw new Error('Invalid username format');

    const gun = GunService.getGun();
    const pubkey = await KeyService.getPublicKeyHex();

    // Check availability
    const existing = await new Promise<any>((resolve) => {
      let done = false;
      gun.get(GUN_USERNAMES_ROOT).get(username).once((d: any) => {
        if (!done) { done = true; resolve(d); }
      });
      setTimeout(() => { if (!done) { done = true; resolve(null); } }, 2000);
    });

    if (existing && existing.pubkey && existing.pubkey !== pubkey) {
      return false; // taken by someone else
    }

    await gun.get(GUN_USERNAMES_ROOT).get(username).put({
      pubkey,
      level: 'none' as TrustLevel,
      claimedAt: Date.now(),
    });

    return true;
  }

  /**
   * Request a PoW challenge from a trust issuer for a username claim.
   * The issuer REST API should implement:
   *   POST /challenge  { username, pubkey }  → { challengeId, prefix, difficulty, expiresAt }
   */
  static async requestIssuerChallenge(
    issuer: TrustIssuer,
    username: string,
  ): Promise<{ challengeId: string; prefix: string; difficulty: number; expiresAt: number }> {
    const pubkey = await KeyService.getPublicKeyHex();

    const res = await fetch(`${issuer.endpoint}/challenge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, pubkey }),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => res.statusText);
      throw new Error(`Trust issuer challenge failed: ${err}`);
    }

    return res.json();
  }

  /**
   * Solve the issuer's PoW challenge (difficulty ~22, ~15 s) and submit it.
   * On success the issuer returns a signed TrustCertificate.
   * The certificate is then written into this user's Gun profile.
   */
  static async solveAndClaimVerifiedUsername(
    issuer: TrustIssuer,
    username: string,
    onProgress?: (nonce: number) => void,
  ): Promise<TrustCertificate> {
    const challenge = await this.requestIssuerChallenge(issuer, username);

    // Solve PoW
    const nonce = await this.solvePoW(
      challenge.prefix,
      challenge.difficulty,
      challenge.expiresAt,
      onProgress,
    );

    const pubkey = await KeyService.getPublicKeyHex();

    // Submit proof
    const res = await fetch(`${issuer.endpoint}/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ challengeId: challenge.challengeId, nonce, username, pubkey }),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => res.statusText);
      throw new Error(`Trust issuer claim failed: ${err}`);
    }

    const cert: TrustCertificate = await res.json();

    // Verify the certificate locally before storing
    if (!this.verifyCertificate(cert, issuer)) {
      throw new Error('Trust issuer returned an invalid certificate signature');
    }

    // Store in GunDB
    const gun = GunService.getGun();
    await gun.get(GUN_USERNAMES_ROOT).get(username).put({
      pubkey,
      level: 'verified' as TrustLevel,
      certificate: JSON.stringify(cert),
      claimedAt: Date.now(),
    });

    this.certCache.set(pubkey, cert);
    return cert;
  }

  // ── Verification ───────────────────────────────────────────────────────────

  /** Verify a certificate's signature against the issuer's registered pubkey. */
  static verifyCertificate(cert: TrustCertificate, issuer: TrustIssuer): boolean {
    if (cert.issuerDomain !== issuer.domain) return false;
    if (cert.expiresAt < Date.now()) return false;
    try {
      const payload = certPayload(cert);
      return CryptoService.verify(payload, cert.signature, issuer.publicKey);
    } catch {
      return false;
    }
  }

  /**
   * Look up the trust level for any username stored in GunDB.
   * Also resolves the issuer and verifies the certificate if present.
   */
  static async resolveTrust(username: string): Promise<VerifiedUsername> {
    const gun = GunService.getGun();

    const record = await new Promise<any>((resolve) => {
      let done = false;
      gun.get(GUN_USERNAMES_ROOT).get(username).once((d: any) => {
        if (!done) { done = true; resolve(d); }
      });
      setTimeout(() => { if (!done) { done = true; resolve(null); } }, 2000);
    });

    if (!record || !record.pubkey) {
      return { username, level: 'none' };
    }

    if (record.level !== 'verified' || !record.certificate) {
      return { username, level: 'none' };
    }

    let cert: TrustCertificate;
    try {
      cert = typeof record.certificate === 'string'
        ? JSON.parse(record.certificate)
        : record.certificate;
    } catch {
      return { username, level: 'none' };
    }

    const issuers = await this.getIssuers();
    const issuer = issuers.find(i => i.domain === cert.issuerDomain);
    if (!issuer) return { username, level: 'none' };

    if (!this.verifyCertificate(cert, issuer)) {
      return { username, level: 'none' };
    }

    return { username, level: 'verified', certificate: cert, issuer };
  }

  /**
   * Quick lookup of a user's own trust level by their public key.
   * Scans GunDB usernames for a matching pubkey+certificate.
   */
  static async getMyTrustLevel(): Promise<TrustLevel> {
    const pubkey = await KeyService.getPublicKeyHex();
    if (this.certCache.has(pubkey)) {
      return this.certCache.get(pubkey) ? 'verified' : 'none';
    }

    const gun = GunService.getGun();
    let found: TrustLevel = 'none';

    await new Promise<void>((resolve) => {
      gun.get(GUN_USERNAMES_ROOT).map().once((record: any) => {
        if (record && record.pubkey === pubkey && record.level === 'verified' && record.certificate) {
          found = 'verified';
        }
      });
      setTimeout(resolve, 2000);
    });

    this.certCache.set(pubkey, found === 'verified' ? ({} as TrustCertificate) : null);
    return found;
  }

  // ── PoW solver ─────────────────────────────────────────────────────────────

  private static async solvePoW(
    prefix: string,
    difficulty: number,
    expiresAt: number,
    onProgress?: (nonce: number) => void,
  ): Promise<number> {
    const BATCH = 5000;
    let nonce = 0;

    for (;;) {
      if (Date.now() > expiresAt) throw new Error('PoW challenge expired during solving');

      for (let i = 0; i < BATCH; i++) {
        const hash = CryptoService.hash(prefix + nonce.toString());
        if (this.countLeadingZeroBits(hash) >= difficulty) return nonce;
        nonce++;
      }

      onProgress?.(nonce);
      await new Promise<void>((r) => setTimeout(r, 0)); // yield to UI
    }
  }

  private static countLeadingZeroBits(hexHash: string): number {
    let bits = 0;
    for (const ch of hexHash) {
      const nibble = parseInt(ch, 16);
      if (nibble === 0) { bits += 4; continue; }
      if (nibble < 2) bits += 3;
      else if (nibble < 4) bits += 2;
      else if (nibble < 8) bits += 1;
      break;
    }
    return bits;
  }

  // ── Utilities ──────────────────────────────────────────────────────────────

  static isValidUsername(username: string): boolean {
    return /^[a-zA-Z0-9_.-]{3,32}$/.test(username);
  }

  static invalidateCache() {
    this.issuersCache = null;
    this.certCache.clear();
  }
}