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
 *   3. Any peer can re-verify by fetching the issuer's pubkey from GenosDB
 *      `trust-issuers/<domain>` and checking the embedded certificate.
 *   4. Unverified usernames are accepted immediately but carry rate-limit
 *      penalties server-side (see RATE_LIMIT_TIERS below).
 *
 * PoW difficulty target:
 *   SHA-256 leading-zero-bit difficulty 22 → expected 4 M hashes → ~15 s
 *   on a 2024 mid-range laptop (JS single-thread ~250 kH/s).
 *   Trust issuers SHOULD use this difficulty for their challenge response.
 */

import { db } from './gdbServices';
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

// ─── Storage ────────────────────────────────────────────────────────────────
// Issuers are GenosDB nodes `trustIssuer:<domain>`; usernames are `username:<name>`.

const CUSTOM_ISSUERS_STORAGE_KEY = 'interpoll_custom_trust_issuers';
const BUILTIN_ISSUERS: Omit<TrustIssuer, 'addedAt'>[] = [
  {
    domain: 'endless.sbs',
    contact: 'viktor@endless.sbs',
    endpoint: 'https://interpoll.endless.sbs/trust',
    publicKey: '',
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function certPayload(cert: Omit<TrustCertificate, 'signature'>): string {
  const { issuerDomain, username, userPubkey, issuedAt, expiresAt } = cert;
  return JSON.stringify({ issuerDomain, username, userPubkey, issuedAt, expiresAt });
}

// ─── TrustService ─────────────────────────────────────────────────────────────

export class TrustService {
  private static issuersCache: TrustIssuer[] | null = null;
  private static certCache = new Map<string, TrustCertificate | null>(); // pubkey → cert
  private static readonly ISSUER_REQUEST_TIMEOUT_MS = 20000;
  private static readonly CLAIM_V2_SUPPORT_STORAGE_KEY = 'interpoll_trust_v2_support';
  private static readonly CLAIM_V2_AUTH_PURPOSE = 'interpoll-trust-claim-v2';

  // ── Issuers ────────────────────────────────────────────────────────────────

  /** Fetch all registered trust issuers from GenosDB. */
  static async getIssuers(): Promise<TrustIssuer[]> {
    if (this.issuersCache) return this.issuersCache;
    const gunIssuers: TrustIssuer[] = [];
    const { results } = await db.map({ query: { type: 'trustIssuer' } });
    for (const node of results) gunIssuers.push(node.value as TrustIssuer);

    const builtinIssuers: TrustIssuer[] = BUILTIN_ISSUERS.map((issuer) => ({
      ...issuer,
      addedAt: 0,
    }));
    const customIssuers = this.getCustomIssuers();
    const merged = this.mergeIssuers([...builtinIssuers, ...customIssuers, ...gunIssuers]);
    const hydrated = await Promise.allSettled(merged.map((issuer) => this.ensureIssuerPublicKey(issuer)));
    const valid = hydrated
      .filter((result): result is PromiseFulfilledResult<TrustIssuer> => result.status === 'fulfilled')
      .map((result) => result.value)
      .filter((issuer) => this.isValidPublicKey(issuer.publicKey));
    this.issuersCache = valid;
    return valid;
  }

  /** Register a new trust issuer (admin/bootstrap only). */
  static async registerIssuer(issuer: Omit<TrustIssuer, 'addedAt'>): Promise<void> {
    const full: TrustIssuer = { ...issuer, addedAt: Date.now() };
    await db.put({ type: 'trustIssuer', ...full }, `trustIssuer:${issuer.domain}`);
    this.issuersCache = null; // invalidate
  }

  /**
   * Add or update a custom issuer stored locally on this device.
   * If domain/publicKey are omitted, they are fetched from `${endpoint}/public-key`.
   */
  static async addCustomIssuer(input: {
    endpoint: string;
    contact?: string;
    domain?: string;
    publicKey?: string;
  }): Promise<TrustIssuer> {
    const endpoint = this.normalizeEndpoint(input.endpoint);
    const fallback = (!input.domain || !input.publicKey)
      ? await this.fetchIssuerMetadata(endpoint)
      : null;
    const domain = (input.domain || fallback?.domain || '').trim().toLowerCase();
    const publicKey = (input.publicKey || fallback?.publicKey || '').trim().toLowerCase();
    const contact = (input.contact || `issuer@${domain}`).trim();
    const endpointHost = this.getEndpointHost(endpoint);

    if (!this.isValidIssuerDomain(domain)) {
      throw new Error('Invalid issuer domain');
    }
    if (!this.isDomainBoundToHost(domain, endpointHost)) {
      throw new Error('Issuer domain must match endpoint host or parent domain');
    }
    if (!this.isValidPublicKey(publicKey)) {
      throw new Error('Invalid issuer public key');
    }

    const issuer: TrustIssuer = {
      domain,
      contact,
      endpoint,
      publicKey,
      addedAt: Date.now(),
    };

    const customIssuers = this.getCustomIssuers();
    const nextCustomIssuers = customIssuers.filter((existing) => existing.endpoint !== endpoint);
    nextCustomIssuers.push(issuer);
    this.saveCustomIssuers(nextCustomIssuers);
    this.invalidateCache();
    return issuer;
  }

  // ── Username claims ────────────────────────────────────────────────────────

  /**
   * Claim a username without a trust issuer (unverified).
   * The username is stored in GenosDB mapped to the user's device ID + pubkey.
   * Returns false if the username is already taken.
   */
  static async claimUnverifiedUsername(username: string): Promise<boolean> {
    if (!this.isValidUsername(username)) throw new Error('Invalid username format');

    const pubkey = await KeyService.getPublicKeyHex();

    // Check availability
    const { result } = await db.get(`username:${username}`);
    const existing = result?.value;
    if (existing && existing.pubkey && existing.pubkey !== pubkey) {
      return false; // taken by someone else
    }

    await db.put(
      { type: 'username', name: username, pubkey, level: 'none' as TrustLevel, claimedAt: Date.now() },
      `username:${username}`,
    );
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

    const res = await this.fetchWithTimeout(`${issuer.endpoint}/challenge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, pubkey }),
    }, this.ISSUER_REQUEST_TIMEOUT_MS);

    if (!res.ok) {
      const err = await res.text().catch(() => res.statusText);
      throw new Error(`Trust issuer challenge failed: ${err}`);
    }

    const raw = await res.json();
    const challengeId = typeof raw?.challengeId === 'string' ? raw.challengeId.trim() : '';
    const prefix = typeof raw?.prefix === 'string' ? raw.prefix : '';
    const difficulty = Number(raw?.difficulty);
    const expiresAt = Number(raw?.expiresAt);
    const maxExpiry = Date.now() + (30 * 60 * 1000);
    if (!challengeId || !prefix) throw new Error('Trust issuer returned an invalid challenge payload');
    if (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > 24) {
      throw new Error('Trust issuer returned an invalid challenge difficulty');
    }
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now() || expiresAt > maxExpiry) {
      throw new Error('Trust issuer returned an invalid challenge expiry');
    }
    return { challengeId, prefix, difficulty, expiresAt };
  }

  private static async requestIssuerChallengeV2(
    issuer: TrustIssuer,
    username: string,
  ): Promise<{ challengeId: string; prefix: string; difficulty: number; expiresAt: number } | null> {
    const support = this.getClaimV2Support(issuer.endpoint);
    if (support === false) return null;
    const pubkey = await KeyService.getPublicKeyHex();

    const res = await this.fetchWithTimeout(`${issuer.endpoint}/challenge-v2`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, pubkey }),
    }, this.ISSUER_REQUEST_TIMEOUT_MS);

    if (res.status === 404) {
      this.setClaimV2Support(issuer.endpoint, false);
      return null;
    }
    if (!res.ok) {
      const err = await res.text().catch(() => res.statusText);
      throw new Error(`Trust issuer v2 challenge failed: ${err}`);
    }

    const raw = await res.json();
    const challengeId = typeof raw?.challengeId === 'string' ? raw.challengeId.trim() : '';
    const prefix = typeof raw?.prefix === 'string' ? raw.prefix : '';
    const difficulty = Number(raw?.difficulty);
    const expiresAt = Number(raw?.expiresAt);
    const maxExpiry = Date.now() + (30 * 60 * 1000);
    if (!challengeId || !prefix) throw new Error('Trust issuer v2 returned an invalid challenge payload');
    if (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > 24) {
      throw new Error('Trust issuer v2 returned an invalid challenge difficulty');
    }
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now() || expiresAt > maxExpiry) {
      throw new Error('Trust issuer v2 returned an invalid challenge expiry');
    }

    this.setClaimV2Support(issuer.endpoint, true);
    return { challengeId, prefix, difficulty, expiresAt };
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
    const challengeV2 = await this.requestIssuerChallengeV2(issuer, username);
    if (challengeV2) {
      const nonce = await this.solvePoW(
        challengeV2.prefix,
        challengeV2.difficulty,
        challengeV2.expiresAt,
        onProgress,
      );
      const pubkey = await KeyService.getPublicKeyHex();
      const privateKey = await KeyService.getPrivateKeyHex();
      const authTs = Date.now();
      const authNonce = CryptoService.hash(`${pubkey}:${challengeV2.challengeId}:${authTs}:${Math.random()}`).slice(0, 32);
      const authPayload = this.buildClaimV2AuthPayload({
        challengeId: challengeV2.challengeId,
        username,
        pubkey,
        nonce,
        authTs,
        authNonce,
        issuerDomain: issuer.domain,
      });
      const authSig = CryptoService.sign(authPayload, privateKey);

      const resV2 = await this.fetchWithTimeout(`${issuer.endpoint}/claim-v2`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          challengeId: challengeV2.challengeId,
          nonce,
          username,
          pubkey,
          authTs,
          authNonce,
          authSig,
        }),
      }, this.ISSUER_REQUEST_TIMEOUT_MS);
      if (resV2.status === 404) {
        this.setClaimV2Support(issuer.endpoint, false);
        return this.solveAndClaimVerifiedUsernameLegacy(issuer, username, onProgress);
      }
      if (!resV2.ok) {
        const err = await resV2.text().catch(() => resV2.statusText);
        throw new Error(`Trust issuer v2 claim failed: ${err}`);
      }

      const certV2: TrustCertificate = await resV2.json();
      await this.validateClaimedCertificate(certV2, issuer, username, pubkey);
      this.certCache.set(pubkey, certV2);
      return certV2;
    }

    return this.solveAndClaimVerifiedUsernameLegacy(issuer, username, onProgress);
  }

  private static async solveAndClaimVerifiedUsernameLegacy(
    issuer: TrustIssuer,
    username: string,
    onProgress?: (nonce: number) => void,
  ): Promise<TrustCertificate> {
    const challenge = await this.requestIssuerChallenge(issuer, username);
    const nonce = await this.solvePoW(
      challenge.prefix,
      challenge.difficulty,
      challenge.expiresAt,
      onProgress,
    );

    const pubkey = await KeyService.getPublicKeyHex();
    const res = await this.fetchWithTimeout(`${issuer.endpoint}/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ challengeId: challenge.challengeId, nonce, username, pubkey }),
    }, this.ISSUER_REQUEST_TIMEOUT_MS);

    if (!res.ok) {
      const err = await res.text().catch(() => res.statusText);
      throw new Error(`Trust issuer claim failed: ${err}`);
    }

    const cert: TrustCertificate = await res.json();
    await this.validateClaimedCertificate(cert, issuer, username, pubkey);
    this.certCache.set(pubkey, cert);
    return cert;
  }

  private static async validateClaimedCertificate(
    cert: TrustCertificate,
    issuer: TrustIssuer,
    username: string,
    pubkey: string,
  ): Promise<void> {
    if (cert.username !== username) {
      throw new Error('Trust issuer returned certificate for a different username');
    }
    if (cert.userPubkey !== pubkey) {
      throw new Error('Trust issuer returned certificate for a different public key');
    }

    if (!this.verifyCertificate(cert, issuer)) {
      throw new Error('Trust issuer returned an invalid certificate signature');
    }
    await db.put(
      {
        type: 'username', name: username, pubkey,
        level: 'verified' as TrustLevel,
        certificate: JSON.stringify(cert),
        claimedAt: Date.now(),
      },
      `username:${username}`,
    );
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
   * Look up the trust level for any username stored in GenosDB.
   * Also resolves the issuer and verifies the certificate if present.
   */
  static async resolveTrust(username: string): Promise<VerifiedUsername> {
    const { result } = await db.get(`username:${username}`);
    const record = result?.value;

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
    if (cert.username !== username || cert.userPubkey !== record.pubkey) {
      return { username, level: 'none' };
    }

    const issuers = await this.getIssuers();
    const issuer = issuers.find(i =>
      i.domain === cert.issuerDomain && this.verifyCertificate(cert, i)
    );
    if (!issuer) {
      return { username, level: 'none' };
    }

    return { username, level: 'verified', certificate: cert, issuer };
  }

  /**
   * Quick lookup of a user's own trust level by their public key.
   * Scans GenosDB usernames for a matching pubkey+certificate.
   */
  static async getMyTrustLevel(): Promise<TrustLevel> {
    const pubkey = await KeyService.getPublicKeyHex();
    if (this.certCache.has(pubkey)) {
      return this.certCache.get(pubkey) ? 'verified' : 'none';
    }

    const { results } = await db.map({ query: { type: 'username', level: 'verified' } });
    const found: TrustLevel = results.some(
      (n: any) => n.value?.pubkey === pubkey && n.value?.certificate,
    ) ? 'verified' : 'none';

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
    const BATCH = 1000;
    const startedAt = Date.now();
    const hardDeadline = Math.min(expiresAt, startedAt + (3 * 60 * 1000));
    let nonce = 0;

    for (;;) {
      if (Date.now() > hardDeadline) {
        throw new Error('PoW challenge timed out; retry or use a lower challenge difficulty');
      }

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

  private static async ensureIssuerPublicKey(issuer: TrustIssuer): Promise<TrustIssuer> {
    if (this.isValidPublicKey(issuer.publicKey)) return issuer;
    try {
      const metadata = await this.fetchIssuerMetadata(issuer.endpoint);
      return {
        ...issuer,
        domain: issuer.domain || metadata.domain,
        publicKey: metadata.publicKey,
      };
    } catch {
      return issuer;
    }
  }

  private static async fetchIssuerMetadata(endpoint: string): Promise<{ domain: string; publicKey: string }> {
    const normalized = this.normalizeEndpoint(endpoint);
    const endpointHost = this.getEndpointHost(normalized);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    let res: Response;
    try {
      res = await fetch(`${normalized}/public-key`, { signal: controller.signal });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new Error('Issuer metadata request timed out');
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
    if (!res.ok) {
      const err = await res.text().catch(() => res.statusText);
      throw new Error(`Issuer metadata request failed: ${err}`);
    }
    const data = await res.json();
    const domain = typeof data?.issuerDomain === 'string' ? data.issuerDomain.trim().toLowerCase() : '';
    const publicKey = typeof data?.publicKey === 'string' ? data.publicKey.trim().toLowerCase() : '';
    if (!this.isValidIssuerDomain(domain)) throw new Error('Issuer metadata has invalid domain');
    if (!this.isDomainBoundToHost(domain, endpointHost)) {
      throw new Error('Issuer metadata domain does not match endpoint host');
    }
    if (!this.isValidPublicKey(publicKey)) throw new Error('Issuer metadata has invalid public key');
    return { domain, publicKey };
  }

  private static mergeIssuers(issuers: TrustIssuer[]): TrustIssuer[] {
    const map = new Map<string, TrustIssuer>();
    for (const issuer of issuers) {
      if (!issuer?.endpoint) continue;
      let endpoint: string;
      try {
        endpoint = this.normalizeEndpoint(issuer.endpoint);
      } catch {
        continue;
      }
      const key = endpoint.toLowerCase();
      const existing = map.get(key);
      if (!existing) {
        const endpointHost = this.getEndpointHost(endpoint);
        const candidateDomain = (issuer.domain || '').trim().toLowerCase();
        if (candidateDomain && !this.isDomainBoundToHost(candidateDomain, endpointHost)) {
          continue;
        }
        map.set(key, {
          ...issuer,
          endpoint,
          domain: candidateDomain || endpointHost,
          publicKey: (issuer.publicKey || '').trim().toLowerCase(),
        });
        continue;
      }
      const endpointHost = this.getEndpointHost(endpoint);
      const candidateDomain = (issuer.domain || existing.domain || '').trim().toLowerCase();
      if (candidateDomain && !this.isDomainBoundToHost(candidateDomain, endpointHost)) {
        continue;
      }
      map.set(key, {
        ...existing,
        ...issuer,
        endpoint,
        domain: candidateDomain || endpointHost,
        publicKey: this.isValidPublicKey(issuer.publicKey) ? issuer.publicKey.toLowerCase() : existing.publicKey,
        addedAt: Math.max(existing.addedAt || 0, issuer.addedAt || 0),
      });
    }
    return Array.from(map.values()).sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
  }

  private static getCustomIssuers(): TrustIssuer[] {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(CUSTOM_ISSUERS_STORAGE_KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      const valid: TrustIssuer[] = [];
      for (const issuer of parsed) {
        if (
          !issuer ||
          typeof issuer !== 'object' ||
          !this.isValidIssuerDomain((issuer as TrustIssuer).domain) ||
          typeof (issuer as TrustIssuer).contact !== 'string' ||
          typeof (issuer as TrustIssuer).endpoint !== 'string'
        ) {
          continue;
        }
        try {
          valid.push({
            ...(issuer as TrustIssuer),
            domain: (issuer as TrustIssuer).domain.trim().toLowerCase(),
            endpoint: this.normalizeEndpoint((issuer as TrustIssuer).endpoint),
            publicKey: typeof (issuer as TrustIssuer).publicKey === 'string'
              ? (issuer as TrustIssuer).publicKey.trim().toLowerCase()
              : '',
            addedAt: typeof (issuer as TrustIssuer).addedAt === 'number'
              ? (issuer as TrustIssuer).addedAt
              : Date.now(),
          });
        } catch {
          continue;
        }
      }
      return valid;
    } catch {
      return [];
    }
  }

  private static saveCustomIssuers(issuers: TrustIssuer[]): void {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(CUSTOM_ISSUERS_STORAGE_KEY, JSON.stringify(issuers));
  }

  private static normalizeEndpoint(endpoint: string): string {
    const value = endpoint.trim();
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new Error('Invalid issuer endpoint URL');
    }
    if (url.protocol !== 'https:') {
      const isLocalHttp = url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
      if (!isLocalHttp) {
        throw new Error('Issuer endpoint must use HTTPS (HTTP allowed only for localhost)');
      }
    }
    url.pathname = url.pathname.replace(/\/+$/, '');
    return url.toString().replace(/\/+$/, '');
  }

  private static isValidPublicKey(value: string | undefined): boolean {
    return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value.trim().toLowerCase());
  }

  private static isValidIssuerDomain(value: string | undefined): boolean {
    return typeof value === 'string' && /^[a-z0-9.-]{3,255}$/.test(value.trim().toLowerCase());
  }

  private static getEndpointHost(endpoint: string): string {
    return new URL(endpoint).hostname.trim().toLowerCase();
  }

  private static isDomainBoundToHost(domain: string, endpointHost: string): boolean {
    if (endpointHost === 'localhost' || endpointHost === '127.0.0.1') return true;
    return endpointHost === domain || endpointHost.endsWith(`.${domain}`);
  }

  private static async fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new Error('Trust issuer request timed out');
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  private static buildClaimV2AuthPayload(input: {
    challengeId: string;
    username: string;
    pubkey: string;
    nonce: number;
    authTs: number;
    authNonce: string;
    issuerDomain: string;
  }): string {
    const { challengeId, username, pubkey, nonce, authTs, authNonce, issuerDomain } = input;
    return JSON.stringify({
      purpose: this.CLAIM_V2_AUTH_PURPOSE,
      issuerDomain,
      challengeId,
      username,
      pubkey,
      nonce,
      authTs,
      authNonce,
    });
  }

  private static getClaimV2Support(endpoint: string): boolean | null {
    if (typeof sessionStorage === 'undefined') return null;
    const raw = sessionStorage.getItem(`${this.CLAIM_V2_SUPPORT_STORAGE_KEY}:${endpoint}`);
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    return null;
  }

  private static setClaimV2Support(endpoint: string, supported: boolean): void {
    if (typeof sessionStorage === 'undefined') return;
    sessionStorage.setItem(`${this.CLAIM_V2_SUPPORT_STORAGE_KEY}:${endpoint}`, supported ? 'true' : 'false');
  }
}
