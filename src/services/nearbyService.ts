// Nearby: opt-in, coarse-location discovery.
//
// Privacy
//  • Only a grid CELL (1–500 km, user's choice) is ever published — never exact coordinates. Exact GPS/IP
//    coordinates stay in memory.
//  • Everything published expires (TTL) and is retracted (signed `gone` record) when the user turns Nearby off.
//  • "Everyone" publishes a signed public record. "Contacts" publishes one sealed record PER CONTACT under an
//    opaque tag (ECDH-derived key), so only that contact can find or read it.
//
// Integrity (the relay enforces the same rules — see backend/nearby-firewall.js)
//  • Every record is Schnorr-signed; the signer's public key is part of the soul key, so nobody can write
//    or overwrite someone else's entry.
//  • Records carry a proof-of-work stamp (same primitive as posts) so mass-producing fake presences costs work.
//  • Readers re-check signature, owner, cell, stamp and freshness; anything that fails is dropped.
//  • Each record is ONE string field (`r`), so a later write replaces it wholesale — no merging of stale fields.
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { GunService } from './gunService';
import { KeyService } from './keyService';
import { CryptoService } from './cryptoService';
import { ContentPowService } from './contentPowService';
import { verifyContentPow } from '../../shared-validation/contentPow.js';
import { GUN_NAMESPACE } from '../utils/namespace';
import { cellFor, isPrecision, levelsFrom, type GeoPoint, type Precision, type RadiusKm } from '../utils/geoCells';

export type Visibility = 'everyone' | 'contacts' | 'off';
export type LocationSource = 'gps' | 'ip' | 'manual';

export interface NearbyPrefs {
  /** The user has gone through the consent screen. Nothing runs until this is true. */
  enabled: boolean;
  visibility: Visibility;
  precision: Precision;
  source: LocationSource;
  radius: RadiusKm;
  blocked: string[];
  manual: { lat: number; lon: number; label: string } | null;
  /** Only list people whose location was detected (GPS / network), not typed in by hand. */
  detectedOnly: boolean;
}

export interface NearbyPerson { id: string; name: string; prec: number; lat: number; lon: number; at: number; viaContacts: boolean; src: LocationSource }
export interface NearbyMeetup { id: string; hostId: string; hostName: string; title: string; desc: string; place: string; when: number; prec: number; lat: number; lon: number; src: LocationSource }
export interface NearbySpace { id: string; hostId: string; name: string; desc: string; prec: number; lat: number; lon: number; src: LocationSource }

export interface FoundPosition extends GeoPoint { accuracyKm?: number }

const PREFS_KEY = 'interpoll_nearby_prefs_v2';
const PUBLISHED_KEY = 'interpoll_nearby_published_v2';
const STAMPS_KEY = 'interpoll_nearby_stamps_v1';
export const PRESENCE_TTL_MS = 30 * 60_000;
export const HEARTBEAT_MS = 10 * 60_000;
const MEETUP_GRACE_MS = 3 * 60 * 60_000;
const SPACE_TTL_MS = 30 * 24 * 60 * 60_000;
const STAMP_REUSE_MS = 3 * 60 * 60_000;       // relay accepts stamps up to 6 h old; refresh well before that
const MAX_CONTACTS = 40;
const CLOCK_SKEW_MS = 5 * 60_000;
const RADII = [1, 5, 25, 100, 500, 2000, 20000];

export const DEFAULT_PREFS: NearbyPrefs = {
  enabled: false, visibility: 'everyone', precision: 5, source: 'gps', radius: 100, blocked: [], manual: null, detectedOnly: false,
};

function stableStringify(obj: Record<string, unknown>): string {
  const keys = Object.keys(obj).sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${JSON.stringify((obj as any)[k])}`).join(',')}}`;
}

const clip = (s: unknown, n: number) => String(s ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
const HEX64 = /^[0-9a-f]{64}$/;

type PublishedPath = { l: number; cell: string; key: string } | { c: string; tag: string };

/** Pull the owner's public key out of a soul key (`p_<pub>`, `m_<pub>_<id>`, `s_<pub>_<id>`). */
function keyOwner(key: string): string | null {
  const m = /^[pms]_([0-9a-f]{64})(?:_[a-z0-9]+)?$/.exec(key);
  return m ? m[1] : null;
}

export class NearbyService {
  // ── Preferences (no coordinates in here) ───────────────────────────────────
  static loadPrefs(): NearbyPrefs {
    try {
      const raw = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null');
      if (!raw || typeof raw !== 'object') return { ...DEFAULT_PREFS };
      return {
        enabled: !!raw.enabled,
        visibility: ['everyone', 'contacts', 'off'].includes(raw.visibility) ? raw.visibility : 'everyone',
        precision: isPrecision(raw.precision) ? raw.precision : 5,
        source: ['gps', 'ip', 'manual'].includes(raw.source) ? raw.source : 'gps',
        radius: RADII.includes(raw.radius) ? raw.radius : 100,
        blocked: Array.isArray(raw.blocked) ? raw.blocked.filter((x: unknown) => typeof x === 'string').slice(0, 500) : [],
        manual: raw.manual && Number.isFinite(raw.manual.lat) && Number.isFinite(raw.manual.lon)
          ? { lat: raw.manual.lat, lon: raw.manual.lon, label: clip(raw.manual.label, 60) } : null,
        detectedOnly: !!raw.detectedOnly,
      };
    } catch { return { ...DEFAULT_PREFS }; }
  }

  static savePrefs(p: NearbyPrefs): void {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* private mode */ }
  }

  // ── Locating ───────────────────────────────────────────────────────────────
  /** Reject positions that are obviously wrong (NaN, out of range, the (0,0) "null island" default). */
  static sane(p: GeoPoint): boolean {
    return Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180
      && !(Math.abs(p.lat) < 0.5 && Math.abs(p.lon) < 0.5);
  }

  static locateGps(): Promise<FoundPosition> {
    return new Promise((resolve, reject) => {
      if (!('geolocation' in navigator)) return reject(new Error('unsupported'));
      navigator.geolocation.getCurrentPosition(
        pos => {
          const p: FoundPosition = { lat: pos.coords.latitude, lon: pos.coords.longitude, accuracyKm: Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy / 1000 : undefined };
          if (!this.sane(p) || (p.accuracyKm ?? 0) > 500) return reject(new Error('unavailable'));
          resolve(p);
        },
        err => reject(new Error(err.code === 1 ? 'denied' : 'unavailable')),
        { enableHighAccuracy: false, timeout: 15_000, maximumAge: 2 * 60_000 },
      );
    });
  }

  /** City-level position from the network address. No permission prompt, but a third-party lookup. */
  static async locateIp(): Promise<FoundPosition & { label: string }> {
    const tries: Array<() => Promise<FoundPosition & { label: string }>> = [
      async () => {
        const j = await (await fetch('https://ipwho.is/', { cache: 'no-store' })).json();
        if (!j || j.success === false || !Number.isFinite(j.latitude)) throw new Error('lookup');
        return { lat: j.latitude, lon: j.longitude, accuracyKm: 25, label: [j.city, j.country].filter(Boolean).join(', ') };
      },
      async () => {
        const j = await (await fetch('https://ipapi.co/json/', { cache: 'no-store' })).json();
        if (!Number.isFinite(j?.latitude)) throw new Error('lookup');
        return { lat: j.latitude, lon: j.longitude, accuracyKm: 25, label: [j.city, j.country_name].filter(Boolean).join(', ') };
      },
    ];
    for (const t of tries) {
      try { const r = await t(); if (this.sane(r)) return r; } catch { /* next */ }
    }
    throw new Error('unavailable');
  }

  /** Turn a typed city into a point. Only the text you typed is sent. */
  static async geocode(query: string): Promise<Array<GeoPoint & { label: string }>> {
    const q = query.trim();
    if (q.length < 2) return [];
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&addressdetails=0&q=${encodeURIComponent(q)}`, {
      headers: { Accept: 'application/json' },
    });
    const rows = await res.json();
    return (Array.isArray(rows) ? rows : [])
      .map((r: any) => ({ lat: Number(r.lat), lon: Number(r.lon), label: clip(r.display_name, 70) }))
      .filter(r => this.sane(r));
  }

  /** The smallest publishable area that is honest about how accurate the position really is. */
  static effectivePrecision(wanted: Precision, accuracyKm?: number): Precision {
    if (!accuracyKm || !Number.isFinite(accuracyKm)) return wanted;
    const need = ([1, 5, 25, 100, 500] as Precision[]).find(p => p >= accuracyKm) ?? 500;
    return need > wanted ? need : wanted;
  }

  // ── Signing & proof of work ────────────────────────────────────────────────
  private static async sign(rec: Record<string, unknown>): Promise<Record<string, unknown>> {
    const priv = await KeyService.getPrivateKeyHex();
    const pub = await KeyService.getPublicKeyHex();
    const canonical = stableStringify(rec);
    return { ...rec, _sig: CryptoService.sign(canonical, priv), _pub: pub, _hash: CryptoService.hash(canonical) };
  }

  private static stamps: Record<string, { created: number; pn: number }> | null = null;
  private static loadStamps() {
    if (this.stamps) return this.stamps;
    try { this.stamps = JSON.parse(localStorage.getItem(STAMPS_KEY) || '{}') || {}; } catch { this.stamps = {}; }
    return this.stamps!;
  }

  /** One proof-of-work stamp per key, reused for a few hours (all levels of one record share it). */
  private static async stampFor(key: string, pub: string): Promise<{ created: number; pn: number }> {
    const all = this.loadStamps();
    const hit = all[key];
    if (hit && Date.now() - hit.created < STAMP_REUSE_MS) return hit;
    const created = Date.now();
    const pn = await ContentPowService.stamp({ kind: 'nearby', id: key, createdAt: created, authorId: pub });
    all[key] = { created, pn };
    for (const k of Object.keys(all)) if (Date.now() - all[k].created > 24 * 3_600_000) delete all[k];
    try { localStorage.setItem(STAMPS_KEY, JSON.stringify(all)); } catch { /* ignore */ }
    return all[key];
  }

  // ── Reading & verifying ────────────────────────────────────────────────────
  private static verified = new Map<string, true>();

  /** Signature + hash check. Returns the clean record and signer, or null. */
  private static checkSignature(raw: any): { rec: any; pub: string } | null {
    try {
      if (!raw || typeof raw !== 'object') return null;
      const { _sig, _pub, _hash, _, ...rec } = raw;
      if (!HEX64.test(String(_pub)) || !_sig || !_hash || rec.v !== 1) return null;
      if (!this.verified.has(_hash)) {
        const canonical = stableStringify(rec);
        if (CryptoService.hash(canonical) !== _hash || !CryptoService.verify(canonical, _sig, _pub)) return null;
        if (this.verified.size > 3000) this.verified.clear();
        this.verified.set(_hash, true);
      }
      return { rec, pub: _pub };
    } catch { return null; }
  }

  /**
   * Verify a public leaf (`r` string) read off the network. `level`/`cell`/`key` come from the soul it was
   * read from, so a record can't be replayed into a cell it doesn't belong to. Returns the record,
   * `{ type: 'gone' }` for a retraction, or null when invalid / expired.
   */
  static verifyPublic(r: unknown, level: number, cell: string, key: string, now = Date.now()): any | null {
    try {
      if (typeof r !== 'string' || r.length < 2 || r.length > 4096) return null;
      const signed = this.checkSignature(JSON.parse(r));
      if (!signed) return null;
      const { rec, pub } = signed;
      if (keyOwner(key) !== pub) return null;
      if (!Number.isFinite(rec.at) || rec.at > now + CLOCK_SKEW_MS || rec.dataVersion !== GUN_NAMESPACE) return null;
      if (rec.type === 'gone') return { type: 'gone', owner: pub, at: rec.at };
      const kind = key[0] === 'p' ? 'person' : key[0] === 'm' ? 'meetup' : 's' === key[0] ? 'space' : '';
      if (rec.type !== kind) return null;
      if ((rec.type === 'person' ? rec.id : rec.hostId) !== pub) return null;
      if (!isPrecision(rec.prec) || rec.prec > level) return null;
      if (!Number.isFinite(rec.lat) || !Number.isFinite(rec.lon)) return null;
      if (cellFor(rec.lat, rec.lon, rec.prec).key !== rec.cell || cellFor(rec.lat, rec.lon, level).key !== cell) return null;
      const ttl = Number(rec.ttl) || 0;
      if (ttl <= 0 || ttl > SPACE_TTL_MS + 100 * 86_400_000 || rec.at + ttl < now) return null;
      if (!Number.isSafeInteger(rec.created) || rec.created > rec.at) return null;
      if (!verifyContentPow({ kind: 'nearby', id: key, createdAt: rec.created, authorId: pub, powNonce: rec.pn })) return null;
      if (rec.type === 'meetup' && Number(rec.when) + MEETUP_GRACE_MS < now) return null;
      if (!['gps', 'ip', 'manual'].includes(rec.src)) rec.src = 'manual';
      return rec;
    } catch { return null; }
  }

  /** Verify a record that arrived sealed from a contact. */
  static verifySealedInner(inner: unknown, contactPub: string, now = Date.now()): any | null {
    const signed = this.checkSignature(inner);
    if (!signed || signed.pub !== contactPub) return null;
    const { rec } = signed;
    if (rec.dataVersion !== GUN_NAMESPACE || !Number.isFinite(rec.at) || rec.at > now + CLOCK_SKEW_MS) return null;
    if (rec.type === 'gone') return { type: 'gone', owner: contactPub, at: rec.at };
    if (rec.type !== 'person' || rec.id !== contactPub) return null;
    if (!isPrecision(rec.prec) || !Number.isFinite(rec.lat) || !Number.isFinite(rec.lon)) return null;
    if (cellFor(rec.lat, rec.lon, rec.prec).key !== rec.cell) return null;
    if (!(Number(rec.ttl) > 0) || rec.at + Number(rec.ttl) < now) return null;
    if (!['gps', 'ip', 'manual'].includes(rec.src)) rec.src = 'manual';
    return rec;
  }

  // ── Contact sealing (ECDH → AES-GCM) ───────────────────────────────────────
  private static sealCache = new Map<string, { shared: Uint8Array; key: CryptoKey }>();
  private static myPubCache = '';

  private static async shared(contactPub: string) {
    const hit = this.sealCache.get(contactPub);
    if (hit) return hit;
    if (!HEX64.test(contactPub.toLowerCase())) return null;
    const priv = hexToBytes(await KeyService.getPrivateKeyHex());
    // x-only keys → even-y point; the shared x-coordinate is identical from both sides.
    const shared = (secp256k1 as any).getSharedSecret(priv, hexToBytes('02' + contactPub.toLowerCase())).slice(1, 33) as Uint8Array;
    const enc = new TextEncoder();
    const keyBytes = sha256(new Uint8Array([...enc.encode('interpoll-nearby-key'), ...shared]));
    const key = await crypto.subtle.importKey('raw', keyBytes as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt']);
    const out = { shared, key };
    this.sealCache.set(contactPub, out);
    return out;
  }

  /** Directional tag: the record *I* leave for `contactPub`, or (sender=contactPub) the one they leave for me. */
  private static tagFor(shared: Uint8Array, senderPub: string): string {
    const enc = new TextEncoder();
    return bytesToHex(sha256(new Uint8Array([...enc.encode('interpoll-nearby-tag'), ...shared, ...enc.encode(senderPub.toLowerCase())]))).slice(0, 32);
  }

  static async outgoingTag(contactPub: string): Promise<{ tag: string; key: CryptoKey } | null> {
    try {
      const s = await this.shared(contactPub); if (!s) return null;
      if (!this.myPubCache) this.myPubCache = await KeyService.getPublicKeyHex();
      return { tag: this.tagFor(s.shared, this.myPubCache), key: s.key };
    } catch { return null; }
  }
  static async incomingTag(contactPub: string): Promise<{ tag: string; key: CryptoKey } | null> {
    try {
      const s = await this.shared(contactPub); if (!s) return null;
      return { tag: this.tagFor(s.shared, contactPub), key: s.key };
    } catch { return null; }
  }

  private static b64(buf: ArrayBuffer | Uint8Array): string {
    const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    let s = ''; for (const b of u) s += String.fromCharCode(b);
    return btoa(s);
  }
  private static unb64(s: string): Uint8Array {
    const bin = atob(s); const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  }

  private static async seal(signedInner: Record<string, unknown>, key: CryptoKey): Promise<string> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(signedInner)));
    return JSON.stringify({ v: 1, type: 'sealed', iv: this.b64(iv), ct: this.b64(ct), at: Date.now(), dataVersion: GUN_NAMESPACE });
  }

  static async openSealed(r: unknown, key: CryptoKey): Promise<any | null> {
    try {
      const w = JSON.parse(String(r));
      if (!w || w.type !== 'sealed') return null;
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: this.unb64(String(w.iv)) as BufferSource }, key, this.unb64(String(w.ct)) as BufferSource);
      return JSON.parse(new TextDecoder().decode(plain));
    } catch { return null; }
  }

  // ── Gun paths ──────────────────────────────────────────────────────────────
  private static node(l: number, cell: string) {
    return GunService.getGun().get('nearby').get(`l${l}`).get(cell);
  }
  private static sealedNode(tag: string) {
    return GunService.getGun().get('nearby').get('c').get(tag);
  }

  /** Last reason the relay refused one of our writes (shown in the UI). */
  static lastError = '';

  private static putLeaf(chain: any, r: string): Promise<boolean> {
    return new Promise(resolve => {
      let done = false;
      const finish = (ok: boolean) => { if (!done) { done = true; resolve(ok); } };
      try {
        chain.put({ r }, (ack: any) => {
          if (ack?.err) { this.lastError = String(ack.err); finish(false); } else finish(true);
        });
      } catch { finish(false); }
      setTimeout(() => finish(true), 4000); // no ack from a quiet relay isn't a refusal
    });
  }

  private static loadPublished(): PublishedPath[] {
    try { const a = JSON.parse(localStorage.getItem(PUBLISHED_KEY) || '[]'); return Array.isArray(a) ? a : []; } catch { return []; }
  }
  private static savePublished(a: PublishedPath[]) {
    try { localStorage.setItem(PUBLISHED_KEY, JSON.stringify(a.slice(0, 800))); } catch { /* ignore */ }
  }
  private static same(a: PublishedPath, b: PublishedPath) {
    return 'l' in a && 'l' in b ? a.l === b.l && a.cell === b.cell && a.key === b.key : 'tag' in a && 'tag' in b ? a.tag === b.tag : false;
  }
  private static inScope(p: PublishedPath, scope: (key: string) => boolean) { return 'l' in p ? scope(p.key) : scope('t_'); }

  private static async goneRecord(): Promise<Record<string, unknown>> {
    return this.sign({ v: 1, type: 'gone', at: Date.now(), ttl: 60_000, dataVersion: GUN_NAMESPACE });
  }

  /** Overwrite a published path with a signed `gone` record. */
  private static async takeDown(p: PublishedPath): Promise<void> {
    const gone = await this.goneRecord();
    if ('l' in p) await this.putLeaf(this.node(p.l, p.cell).get(p.key), JSON.stringify(gone));
    else {
      const s = await this.outgoingTag(p.c);
      if (s) await this.putLeaf(this.sealedNode(p.tag), await this.seal(gone, s.key));
    }
  }

  /**
   * Write public records (each filed under every level ≥ its precision) and take down anything this device
   * published before that is no longer part of the set (moved cell, changed precision, expired meetup…).
   */
  static async syncPublic(items: Array<{ key: string; rec: Record<string, unknown>; prec: number }>, scope: (key: string) => boolean): Promise<boolean> {
    const pub = await KeyService.getPublicKeyHex();
    const before = this.loadPublished();
    const next: PublishedPath[] = [];
    let ok = true;
    for (const it of items) {
      const stamp = await this.stampFor(it.key, pub);
      const rec = { ...it.rec, created: stamp.created, pn: stamp.pn };
      const json = JSON.stringify(await this.sign(rec));
      for (const l of levelsFrom(it.prec)) {
        const cell = cellFor(Number(rec.lat), Number(rec.lon), l).key;
        next.push({ l, cell, key: it.key });
        if (!(await this.putLeaf(this.node(l, cell).get(it.key), json))) ok = false;
      }
    }
    const stale = before.filter(p => 'l' in p && scope(p.key) && !next.some(n => this.same(n, p)));
    for (const p of stale) await this.takeDown(p);
    this.savePublished([...before.filter(p => !('l' in p) || !scope(p.key)), ...next]);
    return ok;
  }

  /** Write one sealed record per contact; take down sealed records for people no longer included. */
  static async syncSealed(rec: Record<string, unknown>, contactPubs: string[]): Promise<boolean> {
    const before = this.loadPublished();
    const next: PublishedPath[] = [];
    const signed = await this.sign(rec);
    let ok = true;
    for (const c of contactPubs) {
      const s = await this.outgoingTag(c);
      if (!s) continue;
      next.push({ c, tag: s.tag });
      if (!(await this.putLeaf(this.sealedNode(s.tag), await this.seal(signed, s.key)))) ok = false;
    }
    const stale = before.filter(p => 'tag' in p && !next.some(n => this.same(n, p)));
    for (const p of stale) await this.takeDown(p);
    this.savePublished([...before.filter(p => 'l' in p), ...next]);
    return ok;
  }

  /** Take down everything this device has published (or just keys matching `scope`). */
  static async retract(scope: (key: string) => boolean = () => true): Promise<void> {
    const before = this.loadPublished();
    const hit = before.filter(p => this.inScope(p, scope));
    for (const p of hit) await this.takeDown(p);
    this.savePublished(before.filter(p => !hit.includes(p)));
  }

  // ── Publishing ─────────────────────────────────────────────────────────────
  static async publishPresence(pos: FoundPosition, prefs: NearbyPrefs, name: string, contactPubs: string[]): Promise<{ ok: boolean; precision: Precision }> {
    const isPresence = (k: string) => k.startsWith('p_') || k === 't_';
    if (prefs.visibility === 'off') { await this.retract(isPresence); return { ok: true, precision: prefs.precision }; }
    const pub = await KeyService.getPublicKeyHex();
    const prec = this.effectivePrecision(prefs.precision, pos.accuracyKm);
    const c = cellFor(pos.lat, pos.lon, prec);
    const rec: Record<string, unknown> = {
      v: 1, type: 'person', id: pub, name: clip(name, 40) || 'Someone', prec, cell: c.key,
      lat: Math.round(c.lat * 1e4) / 1e4, lon: Math.round(c.lon * 1e4) / 1e4, src: prefs.source,
      at: Date.now(), ttl: PRESENCE_TTL_MS, dataVersion: GUN_NAMESPACE,
    };
    // Rounding must still land in the same cell.
    if (cellFor(rec.lat as number, rec.lon as number, prec).key !== rec.cell) { rec.lat = c.lat; rec.lon = c.lon; }

    if (prefs.visibility === 'everyone') {
      await this.retractSealedOnly();
      return { ok: await this.syncPublic([{ key: `p_${pub}`, rec, prec }], isPresence), precision: prec };
    }
    await this.retract(k => k.startsWith('p_'));
    const list = contactPubs.filter(cp => cp !== pub && !prefs.blocked.includes(cp)).slice(0, MAX_CONTACTS);
    return { ok: await this.syncSealed(rec, list), precision: prec };
  }

  private static async retractSealedOnly() {
    const before = this.loadPublished();
    const sealed = before.filter(p => 'tag' in p);
    if (!sealed.length) return;
    for (const p of sealed) await this.takeDown(p);
    this.savePublished(before.filter(p => 'l' in p));
  }

  static async publishMeetup(pos: FoundPosition, prefs: NearbyPrefs, hostName: string, m: { title: string; desc: string; place: string; when: number }): Promise<string> {
    const pub = await KeyService.getPublicKeyHex();
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const prec = this.effectivePrecision(prefs.precision, pos.accuracyKm);
    const c = cellFor(pos.lat, pos.lon, prec);
    const key = `m_${pub}_${id}`;
    const rec = {
      v: 1, type: 'meetup', id, hostId: pub, hostName: clip(hostName, 40) || 'Someone', title: clip(m.title, 80), desc: clip(m.desc, 300),
      place: clip(m.place, 80), when: Math.floor(m.when), prec, cell: c.key, lat: c.lat, lon: c.lon, src: prefs.source,
      at: Date.now(), ttl: Math.max(0, m.when - Date.now()) + MEETUP_GRACE_MS, dataVersion: GUN_NAMESPACE,
    };
    if (!(await this.syncPublic([{ key, rec, prec }], k => k === key))) throw new Error(this.lastError || 'refused');
    return id;
  }

  static spaceKey(pub: string, communityId: string): string {
    return `s_${pub}_${bytesToHex(sha256(new TextEncoder().encode(communityId))).slice(0, 16)}`;
  }

  static async publishSpace(pos: FoundPosition, prefs: NearbyPrefs, s: { id: string; name: string; desc: string }): Promise<void> {
    const pub = await KeyService.getPublicKeyHex();
    const prec = this.effectivePrecision(prefs.precision, pos.accuracyKm);
    const c = cellFor(pos.lat, pos.lon, prec);
    const rec = {
      v: 1, type: 'space', id: clip(s.id, 80), hostId: pub, name: clip(s.name, 60), desc: clip(s.desc, 200),
      prec, cell: c.key, lat: c.lat, lon: c.lon, src: prefs.source, at: Date.now(), ttl: SPACE_TTL_MS, dataVersion: GUN_NAMESPACE,
    };
    const key = this.spaceKey(pub, rec.id);
    await this.syncPublic([{ key, rec, prec }], k => k === key);
  }

  static async removeItem(key: string): Promise<void> { await this.retract(k => k === key); }

  static ownKeys(prefix: 'm_' | 's_'): string[] {
    return [...new Set(this.loadPublished().filter((p): p is { l: number; cell: string; key: string } => 'l' in p && p.key.startsWith(prefix)).map(p => p.key))];
  }

  // ── Reading ────────────────────────────────────────────────────────────────
  /** Watch one cell. The callback gets the leaf's `r` string (or null when it vanishes). */
  static watchCell(level: number, cell: string, cb: (r: string | null, key: string) => void): () => void {
    try {
      const chain = this.node(level, cell).map();
      chain.on((data: any, key: string) => cb(data && typeof data === 'object' && typeof data.r === 'string' ? data.r : null, key));
      return () => { try { chain.off(); } catch { /* detached */ } };
    } catch { return () => {}; }
  }

  /** Watch the sealed record a contact leaves for me. */
  static watchSealed(tag: string, cb: (r: string | null) => void): () => void {
    try {
      const chain = this.sealedNode(tag);
      chain.on((data: any) => cb(data && typeof data === 'object' && typeof data.r === 'string' ? data.r : null));
      return () => { try { chain.off(); } catch { /* detached */ } };
    } catch { return () => {}; }
  }
}
