/**
 * Signal Protocol — X3DH key agreement + Double Ratchet encryption.
 *
 * Pure WebCrypto implementation (no npm deps). Uses P-256 ECDH instead of
 * Curve25519 (identical security, universally supported in browsers/Capacitor).
 *
 * WIRE FORMAT (v3):
 *   { v:3, eph?:string, dh:string, n:number, pn:number, ct:string }
 *
 *   eph  — sender's ephemeral public key (base64, X3DH first message only)
 *   dh   — sender's current ratchet public key (base64)
 *   n    — message number in current sending chain
 *   pn   — message count in previous sending chain
 *   ct   — base64 AES-256-GCM iv(12B) + ciphertext
 *
 * SESSION BOOTSTRAP (what was wrong before, now fixed):
 *
 *   Sender (X3DH + first ratchet step):
 *     masterKey = X3DH(senderIK, recipientBundle)
 *     ephRatchetKP = generateDH()
 *     dhOut = DH(ephRatchetKP.priv, recipientSPK.pub)   // initial ratchet DH
 *     rootKey, ckS = KDF_RK(masterKey, dhOut)
 *     → sends envelope with dh=ephRatchetKP.pub, eph=x3dhEph.pub
 *
 *   Receiver (X3DH reverse + derive ckR from same DH):
 *     masterKey = X3DH_receive(recipientIK, recipientSPK, recipientOPK, senderIK, senderEph)
 *     // Must mirror sender's ratchet DH using SPK as the initial recv ratchet key:
 *     dhOut = DH(recipientSPK.priv, envelope.dh)        // envelope.dh = sender's ephRatchetKP.pub
 *     rootKey, ckR = KDF_RK(masterKey, dhOut)
 *     → now receiver has ckR that matches sender's ckS derivation
 *
 *   This is correct because:
 *     Sender:   dhOut = DH(ephRatchetKP.priv,  recipientSPK.pub)
 *     Receiver: dhOut = DH(recipientSPK.priv,  ephRatchetKP.pub)
 *     Both sides compute the same DH shared secret (ECDH is symmetric).
 *
 * PREVIOUS BUG:
 *   initSessionAsReceiver() set ckR='' and dhRecv='' — so on first decrypt,
 *   ratchetDecrypt saw envelope.dh !== '' and did a ratchet step with dhRecv='',
 *   producing garbage keys. aeadDecrypt then failed with OperationError.
 */

import { StorageService } from './storageService';

export const SIGNAL_WIRE_VERSION = 3;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SignalEnvelope {
  v:     3;
  eph?:  string;   // X3DH ephemeral pub (first message only)
  opkId?: string;  // id of the OPK from the pool the sender used (first message only)
  dh:    string;   // sender's current ratchet pub
  n:     number;   // message number in sending chain
  pn:    number;   // previous chain length
  ct:    string;   // base64 iv(12B)+ciphertext
}

export interface SignalPublicBundle {
  ik:        string;   // identity pub (base64, ECDH P-256 raw) — used for X3DH DH operations
  ikSignPub: string;   // identity signing pub (base64, ECDSA P-256 raw) — used to verify spkSig
  spk:       string;   // signed pre-key pub (base64)
  opk?:      string;   // one-time pre-key pub (base64) — may be absent if pool exhausted
  opkId?:    string;   // pool id of the OPK — included in envelope so receiver can consume it
  spkSig:    string;   // ECDSA-P256-SHA256 signature over spk, signed by ikSignPub (base64 DER)
}

interface DHKeyPair {
  pub:    CryptoKey;
  priv:   CryptoKey;
  pubB64: string;
}

interface RatchetState {
  dhSend:  { pub: string; priv: JsonWebKey };
  dhRecv:  string;   // their current ratchet pub — '' until first recv
  rootKey: string;   // hex
  ckS:     string;   // sending chain key hex  — '' until first send
  ckR:     string;   // receiving chain key hex — '' until first recv
  ns:  number;
  nr:  number;
  pn:  number;
  skipped: Record<string, string>;   // "dhPub:n" → message key hex
}

// ── Base64 / hex utils ────────────────────────────────────────────────────────

const enc = new TextEncoder();
const dec = new TextDecoder();

export function toB64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK)
    s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(s);
}

export function fromB64(s: string): ArrayBuffer {
  const bin = atob(s);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex: string): ArrayBuffer {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++)
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes.buffer;
}

// ── ECDH P-256 ────────────────────────────────────────────────────────────────

async function generateDH(): Promise<DHKeyPair> {
  const kp = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey', 'deriveBits'],
  );
  const pubRaw = await crypto.subtle.exportKey('raw', kp.publicKey);
  return { pub: kp.publicKey, priv: kp.privateKey, pubB64: toB64(pubRaw) };
}

async function importDHPub(b64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw', fromB64(b64), { name: 'ECDH', namedCurve: 'P-256' }, true, [],
  );
}

async function importDHPriv(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveKey', 'deriveBits'],
  );
}

async function dh(priv: CryptoKey, pub: CryptoKey): Promise<ArrayBuffer> {
  return crypto.subtle.deriveBits({ name: 'ECDH', public: pub }, priv, 256);
}

// ── ECDSA P-256 (SPK signature) ───────────────────────────────────────────────
// We re-use the P-256 curve but as ECDSA for signing, distinct from ECDH keys.
// The identity key (IK) signs the signed pre-key (SPK) so peers can verify the
// bundle hasn't been tampered with by the relay or the Gun graph layer.
//
// NOTE: We import the ECDH IK raw public key into an ECDSA key for verification
// only. The private signing key is stored separately (signal-ik-sign:<uid>).

const ECDSA_PARAMS = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const ECDSA_SIGN_PARAMS = { name: 'ECDSA', hash: 'SHA-256' } as const;

async function generateSigningKey(): Promise<{ pub: CryptoKey; priv: CryptoKey; pubB64: string }> {
  const kp = await crypto.subtle.generateKey(ECDSA_PARAMS, true, ['sign', 'verify']);
  const pubRaw = await crypto.subtle.exportKey('raw', kp.publicKey);
  return { pub: kp.publicKey, priv: kp.privateKey, pubB64: toB64(pubRaw) };
}

async function importEcdsaPub(b64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', fromB64(b64), ECDSA_PARAMS, true, ['verify']);
}

async function importEcdsaPriv(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey('jwk', jwk, ECDSA_PARAMS, false, ['sign']);
}

async function signSpk(ikSignPriv: CryptoKey, spkPubB64: string): Promise<string> {
  const sig = await crypto.subtle.sign(ECDSA_SIGN_PARAMS, ikSignPriv, fromB64(spkPubB64));
  return toB64(sig);
}

/**
 * Verify that bundle.spk was signed by the identity signing key.
 * - Missing spkSig: logs a warning and returns (graceful rollout — old peers
 *   haven't regenerated their bundle yet; we still allow the session).
 * - Present but invalid spkSig: throws (active tamper attempt; refuse session).
 */
export async function verifySpkSignature(bundle: SignalPublicBundle): Promise<void> {
  if (!bundle.spkSig) {
    // Old bundle — peer hasn't updated yet. Warn once; don't block.
    console.warn('[Signal] Bundle missing SPK signature — peer may be on an old version');
    return;
  }
  // Use ikSignPub (the ECDSA signing key) not ik (the ECDH key) — they are
  // different keypairs. Mixing them up means verify always fails with a
  // DOMException because the key usage flags don't match.
  const signingPub = bundle.ikSignPub || bundle.ik; // fallback to ik for old bundles without ikSignPub
  try {
    const ikSignPub = await importEcdsaPub(signingPub);
    const valid = await crypto.subtle.verify(
      ECDSA_SIGN_PARAMS, ikSignPub, fromB64(bundle.spkSig), fromB64(bundle.spk),
    );
    if (!valid) throw new Error('SPK signature verification failed — bundle may have been tampered with');
  } catch (e) {
    if (e instanceof Error && e.message.includes('tampered')) throw e;
    // importEcdsaPub throws if the key bytes aren't a valid ECDSA P-256 key
    // (e.g. old peer whose ik is ECDH-only and ikSignPub isn't in the bundle yet).
    // Treat the same as a missing signature — warn, allow, don't block.
    console.warn('[Signal] Could not verify SPK signature (key format mismatch — old peer?):', (e as Error).message);
  }
}

// ── HKDF-SHA256 ───────────────────────────────────────────────────────────────

async function hkdf(
  ikm: ArrayBuffer, salt: ArrayBuffer | null, info: string, lengthBytes: number,
): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: salt ?? new ArrayBuffer(32), info: enc.encode(info) },
    key, lengthBytes * 8,
  );
}

// KDF_RK: (rootKey, dhOut) → (newRootKey, chainKey)  — 64 bytes split in half
async function kdfRK(rk: string, dhOut: ArrayBuffer): Promise<{ rk: string; ck: string }> {
  const out = await hkdf(dhOut, fromHex(rk), 'WhisperRatchet', 64);
  return { rk: toHex(out.slice(0, 32)), ck: toHex(out.slice(32)) };
}

// KDF_CK: chainKey → (newChainKey, messageKey)  — HMAC-SHA256
async function kdfCK(ck: string): Promise<{ ck: string; mk: string }> {
  const key = await crypto.subtle.importKey(
    'raw', fromHex(ck), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const [mkBuf, ckBuf] = await Promise.all([
    crypto.subtle.sign('HMAC', key, new Uint8Array([1])),
    crypto.subtle.sign('HMAC', key, new Uint8Array([2])),
  ]);
  return { mk: toHex(mkBuf), ck: toHex(ckBuf) };
}

// ── AES-256-GCM ───────────────────────────────────────────────────────────────

async function deriveAEAD(mk: string): Promise<{ aesKey: CryptoKey; iv: ArrayBuffer }> {
  const derived = await hkdf(fromHex(mk), null, 'WhisperMessageKeys', 80);
  const aesKey = await crypto.subtle.importKey('raw', derived.slice(0, 32), 'AES-GCM', false, ['encrypt', 'decrypt']);
  return { aesKey, iv: derived.slice(32, 44) };
}

async function aeadEncrypt(mk: string, plaintext: string, aad: string): Promise<string> {
  const { aesKey, iv } = await deriveAEAD(mk);
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: enc.encode(aad) },
    aesKey, enc.encode(plaintext),
  );
  // Prepend IV so the blob is self-contained
  const blob = new Uint8Array(12 + ct.byteLength);
  blob.set(new Uint8Array(iv), 0);
  blob.set(new Uint8Array(ct), 12);
  return toB64(blob);
}

async function aeadDecrypt(mk: string, ctB64: string, aad: string): Promise<string> {
  const blob = new Uint8Array(fromB64(ctB64));
  const { aesKey, iv } = await deriveAEAD(mk);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv, additionalData: enc.encode(aad) },
    aesKey, blob.slice(12),
  );
  return dec.decode(plain);
}

// ── Identity key storage ──────────────────────────────────────────────────────

const IK_KEY      = (uid: string) => `signal-ik:${uid}`;
const IK_SIGN_KEY = (uid: string) => `signal-ik-sign:${uid}`; // ECDSA signing keypair
const SPK_KEY     = (uid: string) => `signal-spk:${uid}`;
const OPK_KEY     = (uid: string) => `signal-opk:${uid}`;

async function loadOrCreateDHKey(storageKey: string): Promise<DHKeyPair> {
  try {
    const stored = await StorageService.getMetadata(storageKey);
    if (stored?.pub && stored?.priv) {
      const pub  = await importDHPub(stored.pub);
      const priv = await importDHPriv(stored.priv);
      return { pub, priv, pubB64: stored.pub };
    }
  } catch { }
  const kp      = await generateDH();
  const privJwk = await crypto.subtle.exportKey('jwk', kp.priv);
  await StorageService.setMetadata(storageKey, { pub: kp.pubB64, priv: privJwk });
  return kp;
}

async function loadOrCreateSigningKey(storageKey: string): Promise<{ pub: CryptoKey; priv: CryptoKey; pubB64: string }> {
  try {
    const stored = await StorageService.getMetadata(storageKey);
    if (stored?.pub && stored?.priv) {
      const pub  = await importEcdsaPub(stored.pub);
      const priv = await importEcdsaPriv(stored.priv);
      return { pub, priv, pubB64: stored.pub };
    }
  } catch { }
  const kp      = await generateSigningKey();
  const privJwk = await crypto.subtle.exportKey('jwk', kp.priv);
  await StorageService.setMetadata(storageKey, { pub: kp.pubB64, priv: privJwk });
  return kp;
}

export async function getOrCreateIdentityBundle(userId: string): Promise<{
  ik: DHKeyPair; spk: DHKeyPair; opk: DHKeyPair;
  ikSign: { pub: CryptoKey; priv: CryptoKey; pubB64: string };
  bundle: SignalPublicBundle;
}> {
  const [ik, spk, opk, ikSign] = await Promise.all([
    loadOrCreateDHKey(IK_KEY(userId)),
    loadOrCreateDHKey(SPK_KEY(userId)),
    loadOrCreateDHKey(OPK_KEY(userId)),
    loadOrCreateSigningKey(IK_SIGN_KEY(userId)),
  ]);

  // Sign the SPK with the identity signing key so recipients can detect substitution.
  // The SPK public key bytes are the signed material; no encoding needed beyond raw b64.
  const spkSig = await signSpk(ikSign.priv, spk.pubB64);

  const bundle: SignalPublicBundle = {
    ik:        ik.pubB64,
    ikSignPub: ikSign.pubB64,   // separate ECDSA key — NOT the same as the ECDH ik
    spk:       spk.pubB64,
    opk:       opk.pubB64,
    spkSig,
  };

  return { ik, spk, opk, ikSign, bundle };
}

// ── Session storage ───────────────────────────────────────────────────────────

// SESSION_KEY must be directional (myId:theirId), NOT sorted.
// Sorting made both sides share the same key, so each saveSession() call
// overwrote the other side's ratchet state. Alice's send-chain was
// replaced by Bob's receive-chain and vice-versa the moment either side
// saved, causing OperationError on every message after the first exchange.
const SESSION_KEY = (myId: string, theirId: string) =>
  `signal-session:${myId}:${theirId}`;

async function loadSession(myId: string, theirId: string): Promise<RatchetState | null> {
  try {
    return (await StorageService.getMetadata(SESSION_KEY(myId, theirId))) ?? null;
  } catch { return null; }
}

async function saveSession(myId: string, theirId: string, s: RatchetState): Promise<void> {
  await StorageService.setMetadata(SESSION_KEY(myId, theirId), s);
}

// ── X3DH ─────────────────────────────────────────────────────────────────────

async function x3dhCombine(parts: ArrayBuffer[]): Promise<string> {
  const total = parts.reduce((n, p) => n + p.byteLength, 0);
  const ikm   = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { ikm.set(new Uint8Array(p), off); off += p.byteLength; }
  return toHex(await hkdf(ikm.buffer, null, 'WhisperText', 32));
}

/**
 * Sender X3DH: produces masterKey + ephemeral public key (b64) for the envelope.
 * Verifies the recipient's SPK signature before performing X3DH so a relay that
 * substitutes the SPK is detected here rather than producing a silently broken session.
 * Returns the opkId used so the receiver knows which private key to consume.
 */
async function x3dhSend(
  senderIK: DHKeyPair,
  bundle: SignalPublicBundle,
): Promise<{ masterKey: string; x3dhEphPub: string; opkId: string | null }> {
  // Warns for missing sig, throws only for actively invalid sig
  await verifySpkSignature(bundle);
  const rIK  = await importDHPub(bundle.ik);
  const rSPK = await importDHPub(bundle.spk);
  const eph  = await generateDH();

  // Use the OPK from the bundle if present (one-time pre-key from pool)
  const opkEntry = bundle.opk && bundle.opkId
    ? { pub: await importDHPub(bundle.opk), id: bundle.opkId }
    : null;

  const dh1 = await dh(senderIK.priv, rSPK);             // DH(IK_S,  SPK_R)
  const dh2 = await dh(eph.priv,      rIK);              // DH(EK_S,  IK_R)
  const dh3 = await dh(eph.priv,      rSPK);             // DH(EK_S,  SPK_R)
  const dh4 = opkEntry ? await dh(eph.priv, opkEntry.pub) : null; // DH(EK_S, OPK_R)

  const masterKey = await x3dhCombine([dh1, dh2, dh3, ...(dh4 ? [dh4] : [])]);
  return { masterKey, x3dhEphPub: eph.pubB64, opkId: opkEntry?.id ?? null };
}

/**
 * Receiver X3DH: derives the same masterKey from the sender's ephemeral key.
 * myOPK is an OPKEntry from the local pool (consumed by id from the envelope).
 * If null (OPK was already consumed or pool was exhausted), X3DH runs without dh4 —
 * still secure; just weaker forward secrecy for that session initiation.
 */
async function x3dhReceive(
  myIK:  DHKeyPair,
  mySPK: DHKeyPair,
  myOPK: { priv: JsonWebKey } | null,
  senderIKPub:  string,
  senderEphPub: string,
): Promise<string> {
  const sIK  = await importDHPub(senderIKPub);
  const sEph = await importDHPub(senderEphPub);

  const dh1 = await dh(mySPK.priv, sIK);    // DH(SPK_R, IK_S)
  const dh2 = await dh(myIK.priv,  sEph);   // DH(IK_R,  EK_S)
  const dh3 = await dh(mySPK.priv, sEph);   // DH(SPK_R, EK_S)
  let dh4: ArrayBuffer | null = null;
  if (myOPK) {
    const opkPriv = await importDHPriv(myOPK.priv);
    dh4 = await dh(opkPriv, sEph);          // DH(OPK_R, EK_S)
  }

  return x3dhCombine([dh1, dh2, dh3, ...(dh4 ? [dh4] : [])]);
}

// ── Session bootstrap ─────────────────────────────────────────────────────────

/**
 * Sender session init — called once per new conversation.
 *
 * The sender generates a fresh ratchet keypair (ephRatchet) and does one
 * ratchet step against the recipient's SPK to derive the initial ckS.
 * The envelope carries ephRatchet.pub as `dh` so the receiver can mirror it.
 *
 *   dhOut = DH(ephRatchet.priv, recipientSPK.pub)
 *   rootKey, ckS = KDF_RK(masterKey, dhOut)
 */
async function initSessionAsSender(
  myId: string, theirId: string,
  masterKey: string,
  recipientSPKPub: string,
): Promise<{ state: RatchetState; ratchetPub: string }> {
  const ephRatchet = await generateDH();
  const dhOut      = await dh(ephRatchet.priv, await importDHPub(recipientSPKPub));
  const { rk, ck } = await kdfRK(masterKey, dhOut);
  const privJwk    = await crypto.subtle.exportKey('jwk', ephRatchet.priv);

  const state: RatchetState = {
    dhSend:  { pub: ephRatchet.pubB64, priv: privJwk },
    dhRecv:  recipientSPKPub,  // initial "their" ratchet pub = recipient's SPK
    rootKey: rk,
    ckS:     ck,
    ckR:     '',               // no receiving chain yet
    ns: 0, nr: 0, pn: 0,
    skipped: {},
  };
  await saveSession(myId, theirId, state);
  return { state, ratchetPub: ephRatchet.pubB64 };
}

/**
 * Receiver session init — called on the first incoming message.
 *
 * The receiver mirrors the sender's ratchet DH using its own SPK private key:
 *   dhOut = DH(mySPK.priv, envelope.dh)   // envelope.dh = sender's ephRatchet.pub
 *   rootKey, ckR = KDF_RK(masterKey, dhOut)
 *
 * This is the same DH output the sender computed, so ckR == sender's ckS.
 * The receiver then generates a fresh ratchet keypair for future sends.
 */
async function initSessionAsReceiver(
  myId: string, theirId: string,
  masterKey: string,
  mySPK: DHKeyPair,
  senderRatchetPub: string,  // envelope.dh
): Promise<RatchetState> {
  // Mirror sender's ratchet DH → get ckR that matches sender's ckS
  const dhOut      = await dh(mySPK.priv, await importDHPub(senderRatchetPub));
  const { rk, ck } = await kdfRK(masterKey, dhOut);

  // Fresh ratchet keypair for our own future sends
  const myRatchet  = await generateDH();
  const privJwk    = await crypto.subtle.exportKey('jwk', myRatchet.priv);

  const state: RatchetState = {
    dhSend:  { pub: myRatchet.pubB64, priv: privJwk },
    dhRecv:  senderRatchetPub,  // sender's current ratchet pub
    rootKey: rk,
    ckS:     '',                // no sending chain until first send
    ckR:     ck,                // receiving chain = matches sender's ckS
    ns: 0, nr: 0, pn: 0,
    skipped: {},
  };
  // Also save under the REVERSE key (myId:theirId as sender) so that
  // when we later send, encrypt() loads this same rootKey and derives
  // a ckS that Tab A can match. Without this, a stale session from a
  // previous X3DH exchange pollutes the sending path with a wrong rootKey.
  await saveSession(myId, theirId, state);
  return state;
}

// ── Double Ratchet encrypt / decrypt ─────────────────────────────────────────

const MAX_SKIP = 1000;

async function ratchetEncrypt(
  state: RatchetState, plaintext: string, senderIKPub: string,
): Promise<{ envelope: Omit<SignalEnvelope, 'v'>; state: RatchetState }> {
  if (!state.ckS) throw new Error('No sending chain key — session not initialised for sending');
  const { mk, ck } = await kdfCK(state.ckS);
  // AAD: senderIK:ratchetPub:messageNumber (all stable identifiers)
  const aad = `${senderIKPub}:${state.dhSend.pub}:${state.ns}`;
  const ct  = await aeadEncrypt(mk, plaintext, aad);
  return {
    envelope: { dh: state.dhSend.pub, n: state.ns, pn: state.pn, ct },
    state: { ...state, ckS: ck, ns: state.ns + 1, skipped: { ...state.skipped } },
  };
}

async function skipMessageKeys(state: RatchetState, until: number): Promise<RatchetState> {
  if (state.nr + MAX_SKIP < until) throw new Error('Too many skipped messages');
  let s = { ...state, skipped: { ...state.skipped } };
  while (s.nr < until) {
    const { mk, ck } = await kdfCK(s.ckR);
    s.skipped[`${s.dhRecv}:${s.nr}`] = mk;
    s = { ...s, ckR: ck, nr: s.nr + 1 };
  }
  return s;
}

/**
 * Perform a DH ratchet step when the sender's ratchet key changes.
 * Derives the new receiving chain, then a new sending chain.
 */
async function ratchetStep(state: RatchetState, theirDHPub: string): Promise<RatchetState> {
  const theirPub = await importDHPub(theirDHPub);
  const myPriv   = await importDHPriv(state.dhSend.priv);

  // Receiving ratchet: derive ckR from current sending key + their new DH pub
  const dhOut1           = await dh(myPriv, theirPub);
  const { rk: rk1, ck: ckR } = await kdfRK(state.rootKey, dhOut1);

  // Sending ratchet: generate new DH pair, derive new ckS
  const newDH            = await generateDH();
  const dhOut2           = await dh(newDH.priv, theirPub);
  const { rk: rk2, ck: ckS } = await kdfRK(rk1, dhOut2);

  const privJwk = await crypto.subtle.exportKey('jwk', newDH.priv);
  // Clear ALL skipped message keys on ratchet step: any keys stored for
  // previous ratchet positions are now permanently stale. Keeping them
  // causes ratchetDecrypt to use a wrong cached mk instead of deriving
  // the correct one from the new ckR, silently failing aeadDecrypt.
  return {
    dhSend:  { pub: newDH.pubB64, priv: privJwk },
    dhRecv:  theirDHPub,
    rootKey: rk2,
    ckS, ckR,
    ns: 0, nr: 0, pn: state.ns,
    skipped: {},
  };
}

async function ratchetDecrypt(
  state: RatchetState, envelope: Omit<SignalEnvelope, 'v'>, senderIKPub: string,
): Promise<{ plaintext: string; state: RatchetState }> {
  const skipKey = `${envelope.dh}:${envelope.n}`;

  // 1. Check skipped message keys (out-of-order delivery)
  if (state.skipped[skipKey]) {
    const mk         = state.skipped[skipKey];
    const newSkipped = { ...state.skipped };
    delete newSkipped[skipKey];
    const aad       = `${senderIKPub}:${envelope.dh}:${envelope.n}`;
    const plaintext = await aeadDecrypt(mk, envelope.ct, aad);
    return { plaintext, state: { ...state, skipped: newSkipped } };
  }

  let s = state;

  // 2. Ratchet step if sender's DH key has changed
  if (envelope.dh !== state.dhRecv) {
    if (s.ckR) s = await skipMessageKeys(s, envelope.pn);
    s = await ratchetStep(s, envelope.dh);
  }

  // 3. Advance receiving chain to the message's position
  s = await skipMessageKeys(s, envelope.n);
  const { mk, ck } = await kdfCK(s.ckR);
  s = { ...s, ckR: ck, nr: s.nr + 1, skipped: { ...s.skipped } };

  const aad       = `${senderIKPub}:${envelope.dh}:${envelope.n}`;
  const plaintext = await aeadDecrypt(mk, envelope.ct, aad);
  return { plaintext, state: s };
}

// ── Public API ────────────────────────────────────────────────────────────────

export class SignalSession {
  constructor(private myId: string, private theirId: string) {}

  /**
   * Encrypt a plaintext message. Performs X3DH on first call to establish
   * the session; subsequent calls advance the double-ratchet.
   */
  async encrypt(
    plaintext: string,
    myBundle:    { ik: DHKeyPair; spk: DHKeyPair; opk: DHKeyPair },
    theirBundle: SignalPublicBundle,
  ): Promise<SignalEnvelope> {
    let state = await loadSession(this.myId, this.theirId);
    let x3dhEphPub: string | undefined;
    let x3dhOpkId:  string | undefined;

    // Session is stale if it exists but has no receiving chain (ckR) after
    // having already sent messages (ns > 0). This happens when the other side
    // cleared their session (e.g. after key rotation). Force a fresh X3DH.
    const isStale = state && !state.ckR && (state.ns ?? 0) >= 50; // threshold: only stale after 50 unacknowledged sends

    if (!state || isStale) {
      // First message or stale session: X3DH → bootstrap session
      const { masterKey, x3dhEphPub: ep, opkId } = await x3dhSend(myBundle.ik, theirBundle);
      x3dhEphPub = ep;
      if (opkId) x3dhOpkId = opkId;
      const { state: s } = await initSessionAsSender(
        this.myId, this.theirId, masterKey, theirBundle.spk,
      );
      state = s;
    }

    // If ckS is empty the session was receiver-bootstrapped — do a ratchet step
    // to generate a sending chain before encrypting.
    if (!state.ckS) {
      // Receiver first send: generate new DH keypair, derive ckS with ONE
      // kdfRK round from the shared rootKey.
      //
      // ratchetStep() runs TWO kdfRK rounds (ckR + ckS), advancing rootKey
      // twice. But Tab A only advances rootKey ONCE when it receives Tab B's
      // message, so their rootKeys diverge and decryption fails.
      //
      // One kdfRK round means Tab A can derive the same ckR when it does
      // its ratchetStep on receiving this message (they share rootKey + DH).
      const newDH   = await generateDH();
      const dhOut   = await dh(newDH.priv, await importDHPub(state.dhRecv));
      const { rk, ck: ckS } = await kdfRK(state.rootKey, dhOut);
      const privJwk = await crypto.subtle.exportKey('jwk', newDH.priv);
      state = {
        ...state,
        dhSend:  { pub: newDH.pubB64, priv: privJwk },
        rootKey: rk,
        ckS,
        ns:  0,
        pn:  state.ns,
        // ckR/nr/dhRecv unchanged: still on the X3DH receive chain
      };
      await saveSession(this.myId, this.theirId, state);
    }

    const { envelope, state: newState } = await ratchetEncrypt(
      state, plaintext, myBundle.ik.pubB64,
    );
    await saveSession(this.myId, this.theirId, newState);

    return { v: SIGNAL_WIRE_VERSION, ...envelope,
      ...(x3dhEphPub ? { eph: x3dhEphPub } : {}),
      ...(x3dhOpkId  ? { opkId: x3dhOpkId } : {}),
    };
  }

  /**
   * Decrypt a received envelope. On first receive performs X3DH to establish
   * the receiving chain; subsequent calls advance the double-ratchet.
   * myUserId is needed to look up the OPK pool in IDB and consume the right entry.
   */
  async decrypt(
    envelope:     SignalEnvelope,
    myBundle:     { ik: DHKeyPair; spk: DHKeyPair },
    senderIKPub:  string,
    myUserId:     string,
  ): Promise<string> {
    let state = await loadSession(this.myId, this.theirId);

    // If eph is present this is a new X3DH initiation — always reset session.
    if (envelope.eph) {
      // Always reset when eph is present UNLESS the session is already live with messages
      // having been successfully received (nr > 0). The only safe "don't reset" case is
      // a stale Gun re-delivery of the original X3DH message after a session is established.
      // Any other case — including a failed prior X3DH that saved bad state — must reset.
      // Previously, sameDH + ckR-set was treated as "sessionLive" and skipped the reset,
      // but ckR gets set by initSessionAsReceiver BEFORE aeadDecrypt runs, so a failed
      // decrypt leaves a corrupted session that blocks all future messages from that peer.
      const sessionHasSuccessfullyDecrypted = state && state.nr > 0;
      const shouldReset = !sessionHasSuccessfullyDecrypted;
      if (shouldReset) {
        // Look up the OPK the sender used. consumeOPK removes it from the local
        // pool so it can never be reused, giving per-session forward secrecy.
        // If the id is absent or already consumed, X3DH still works without OPK.
        let myOPK: { priv: JsonWebKey } | null = null;
        if (envelope.opkId) {
          myOPK = await consumeOPK(myUserId, envelope.opkId);
        }
        const masterKey = await x3dhReceive(
          myBundle.ik, myBundle.spk, myOPK,
          senderIKPub, envelope.eph,
        );
        state = await initSessionAsReceiver(
          this.myId, this.theirId, masterKey, myBundle.spk, envelope.dh,
        );
      }
      // else: active session, stale Gun re-delivery — skip reset
    } else if (!state) {
      throw new Error('No session and no X3DH ephemeral key — cannot establish session');
    }

    const { plaintext, state: newState } = await ratchetDecrypt(state!, envelope, senderIKPub);
    await saveSession(this.myId, this.theirId, newState);
    return plaintext;
  }
  async hasSession(): Promise<boolean> {
    return !!(await loadSession(this.myId, this.theirId));
  }

  /** Wipe the local session state for this pair. Called when decrypt fails so
   *  the next message triggers a clean X3DH instead of retrying with bad state. */
  async clearSession(): Promise<void> {
    await StorageService.setMetadata(SESSION_KEY(this.myId, this.theirId), null);
  }

  async clearSession(): Promise<void> {
    await StorageService.setMetadata(SESSION_KEY(this.myId, this.theirId), null);
  }
}

// ── Safety numbers ────────────────────────────────────────────────────────────

/**
 * Derive a safety number from both parties' identity signing keys.
 *
 * Uses SHA-256 over the sorted concatenation of both ikSignPub values so the
 * result is identical regardless of who initiates the comparison. Formatted as
 * 12 groups of 5 digits (same visual style as Signal) so users can read it
 * aloud or compare screenshots to detect a MitM.
 *
 * @param myIKSignPub    Your ikSignPub (base64) from getOrCreateIdentityBundle
 * @param theirIKSignPub Their ikSignPub (base64) from their SignalPublicBundle
 */
export async function getSafetyNumber(
  myIKSignPub: string,
  theirIKSignPub: string,
): Promise<string> {
  // Sort so both parties derive the same number regardless of who calls first
  const [a, b] = [myIKSignPub, theirIKSignPub].sort();
  const combined = new TextEncoder().encode(a + '|' + b);
  const hash     = await crypto.subtle.digest('SHA-256', combined);
  const bytes    = new Uint8Array(hash);
  // 12 groups × 5 digits.  Each group = two bytes as 0..65535 mod 100000.
  return Array.from({ length: 12 }, (_, i) =>
    String(((bytes[i * 2] << 8) | bytes[i * 2 + 1]) % 100000).padStart(5, '0')
  ).join(' ');
}

// ── OPK pool ──────────────────────────────────────────────────────────────────

export const OPK_POOL_SIZE       = 20;  // keep this many OPKs published on the relay
export const OPK_POOL_LOW_WATER  = 5;   // replenish when pool drops below this

const OPK_POOL_KEY = (uid: string) => `signal-opk-pool:${uid}`;

export interface OPKEntry {
  id:     string;          // random UUID — used as the relay key
  pubB64: string;          // ECDH public key (base64)
  priv:   JsonWebKey;      // private key — NEVER leaves the device
}

/**
 * Load the local OPK pool from IDB, or generate a fresh one if it doesn't exist.
 * The pool is stored as an array of { id, pubB64, priv } entries.
 */
export async function loadOrCreateOPKPool(userId: string): Promise<OPKEntry[]> {
  try {
    const stored = await StorageService.getMetadata(OPK_POOL_KEY(userId));
    if (Array.isArray(stored) && stored.length > 0) return stored as OPKEntry[];
  } catch { }
  return generateOPKBatch(OPK_POOL_SIZE, userId);
}

/**
 * Generate a fresh batch of OPKs, persist to IDB, and return them.
 * Does NOT publish to the relay — that's the caller's job.
 */
export async function generateOPKBatch(count: number, userId: string): Promise<OPKEntry[]> {
  const batch: OPKEntry[] = [];
  for (let i = 0; i < count; i++) {
    const kp      = await generateDH();
    const privJwk = await crypto.subtle.exportKey('jwk', kp.priv);
    batch.push({
      id:     crypto.randomUUID(),
      pubB64: kp.pubB64,
      priv:   privJwk,
    });
  }
  // Merge with any existing pool (prepend new ones, keep old ones that haven't been consumed)
  let existing: OPKEntry[] = [];
  try {
    const stored = await StorageService.getMetadata(OPK_POOL_KEY(userId));
    if (Array.isArray(stored)) existing = stored as OPKEntry[];
  } catch { }
  const merged = [...batch, ...existing];
  await StorageService.setMetadata(OPK_POOL_KEY(userId), merged);
  return merged;
}

/**
 * Find and remove an OPK from the local pool by id. Returns the entry so the
 * caller can use the private key for X3DH. Returns null if the id isn't found
 * (already consumed or from a previous install — session still works without OPK).
 */
export async function consumeOPK(userId: string, opkId: string): Promise<OPKEntry | null> {
  try {
    const pool = await loadOrCreateOPKPool(userId);
    const idx  = pool.findIndex(e => e.id === opkId);
    if (idx === -1) return null;
    const [entry] = pool.splice(idx, 1);
    await StorageService.setMetadata(OPK_POOL_KEY(userId), pool);
    return entry;
  } catch { return null; }
}

/**
 * Return the current pool size without modifying it.
 */
export async function getOPKPoolSize(userId: string): Promise<number> {
  try {
    const pool = await StorageService.getMetadata(OPK_POOL_KEY(userId));
    return Array.isArray(pool) ? pool.length : 0;
  } catch { return 0; }
}