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
import type { StoredChatMessage } from '../types/social';
import { authorizeLocalBundle, verifyAuthenticatedBundle, continuityChange, bootstrapContext,
  verifyContext, DMIdentityError, type AuthenticatedBundle, type MetadataChange } from './dmIdentity';

import {readEpoch, createEpoch, verifyEpoch, admitEpoch, epochChange, DMEpochError, type EpochRecord} from './dmSessionEpoch';
import {ReceiveFailure,receiveCommitChanges,type ReceiveCommit} from './dmReceiveState';
export const SIGNAL_WIRE_VERSION = 5;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SignalEnvelope {
  v:     3 | 4 | 5;
  epoch?: string;
  auth?: string;
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
  receiveGeneration?: number;
  skippedAt?: Record<string,number>;
  closedChains?: string[];
  epoch?: string;
  auth?: string;
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
  if ((bundle as AuthenticatedBundle).version === 1) {
    await verifyAuthenticatedBundle(bundle,(bundle as AuthenticatedBundle).binding.accountId);
    return;
  }
  if (!bundle.spkSig || !bundle.ikSignPub) throw new Error('Signed prekey required');
  const pub = await importEcdsaPub(bundle.ikSignPub);
  if (!await crypto.subtle.verify(ECDSA_SIGN_PARAMS,pub,fromB64(bundle.spkSig),fromB64(bundle.spk)))
    throw new Error('SPK signature verification failed');
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
  let plain:ArrayBuffer;
  try {plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv, additionalData: enc.encode(aad) }, aesKey, blob.slice(12));}
  catch {throw new ReceiveFailure('rejected-auth','Ciphertext authentication failed');}
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
  if (!await StorageService.compareAndSwapMetadata([{key:storageKey,before:null,after:{pub:kp.pubB64,priv:privJwk}}])) {
    const stored = await StorageService.getMetadata(storageKey);
    return {pub:await importDHPub(stored.pub),priv:await importDHPriv(stored.priv),pubB64:stored.pub};
  }
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
  if (!await StorageService.compareAndSwapMetadata([{key:storageKey,before:null,after:{pub:kp.pubB64,priv:privJwk}}])) {
    const stored = await StorageService.getMetadata(storageKey);
    return {pub:await importEcdsaPub(stored.pub),priv:await importEcdsaPriv(stored.priv),pubB64:stored.pub};
  }
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

/** Active DM publication: authorize existing messaging keys with the account root. */
export async function getOrCreateAuthenticatedIdentityBundle(userId: string, accountPrivateKey?: string) {
  const local = await getOrCreateIdentityBundle(userId);
  const pool = await loadOrCreateOPKPool(userId);
  const bundle = await authorizeLocalBundle(userId,local.bundle,local.ikSign.priv,pool,accountPrivateKey);
  return {...local,bundle};
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
  return (await StorageService.getMetadata(SESSION_KEY(myId, theirId))) ?? null;
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
  return state;
}

// ── Double Ratchet encrypt / decrypt ─────────────────────────────────────────

export const MAX_SKIP = 1000;
export const MAX_TOTAL_SKIPPED = 1000;
export const MAX_SKIPPED_GENERATIONS = 4;
const MAX_CLOSED_CHAINS = 64;
function retainSkipped(state:RatchetState):RatchetState {
  const skipped={...state.skipped},skippedAt={...state.skippedAt},generation=state.receiveGeneration??0;
  for(const key of Object.keys(skipped)){
    skippedAt[key]??=generation;
    if(generation-skippedAt[key]>MAX_SKIPPED_GENERATIONS){delete skipped[key];delete skippedAt[key];}
  }
  for(const key of Object.keys(skipped).slice(0,Math.max(0,Object.keys(skipped).length-MAX_TOTAL_SKIPPED))){delete skipped[key];delete skippedAt[key];}
  return {...state,skipped,skippedAt,receiveGeneration:generation};
}

function messageAAD(senderIK: string, envelope: Omit<SignalEnvelope,'v'>): string {
  return envelope.auth ? JSON.stringify(['interpoll/dm/message',envelope.epoch?5:4,senderIK,envelope.dh,envelope.n,
    envelope.pn,envelope.eph??null,envelope.opkId??null,envelope.auth,...(envelope.epoch?[envelope.epoch]:[])]) : `${senderIK}:${envelope.dh}:${envelope.n}`;
}

async function ratchetEncrypt(
  state: RatchetState, plaintext: string, senderIKPub: string,
  header: {auth?:string;epoch?:string;eph?:string;opkId?:string} = {},
): Promise<{ envelope: Omit<SignalEnvelope, 'v'>; state: RatchetState }> {
  if (!state.ckS) throw new Error('No sending chain key — session not initialised for sending');
  const { mk, ck } = await kdfCK(state.ckS);
  // AAD: senderIK:ratchetPub:messageNumber (all stable identifiers)
  const aad = messageAAD(senderIKPub,{dh:state.dhSend.pub,n:state.ns,pn:state.pn,ct:'',...header});
  const ct  = await aeadEncrypt(mk, plaintext, aad);
  return {
    envelope: { dh: state.dhSend.pub, n: state.ns, pn: state.pn, ct, ...header },
    state: { ...state, ckS: ck, ns: state.ns + 1, skipped: { ...state.skipped } },
  };
}

async function skipMessageKeys(state: RatchetState, until: number): Promise<RatchetState> {
  if (!Number.isSafeInteger(until)||until<0||state.nr+MAX_SKIP<until) throw new ReceiveFailure('rejected-stale','Receive gap exceeds MAX_SKIP');
  let s = { ...state, skipped: { ...state.skipped },skippedAt:{...state.skippedAt} };
  while (s.nr < until) {
    const { mk, ck } = await kdfCK(s.ckR);
    s.skipped[`${s.dhRecv}:${s.nr}`] = mk;
    s.skippedAt[`${s.dhRecv}:${s.nr}`]=s.receiveGeneration??0;
    s = { ...s, ckR: ck, nr: s.nr + 1 };
  }
  return retainSkipped(s);
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
  return retainSkipped({
    ...state,
    receiveGeneration:(state.receiveGeneration??0)+1,
    closedChains:[...(state.closedChains??[]),state.dhRecv].filter(Boolean).slice(-MAX_CLOSED_CHAINS),
    auth: state.auth, epoch: state.epoch,
    dhSend:  { pub: newDH.pubB64, priv: privJwk },
    dhRecv:  theirDHPub,
    rootKey: rk2,
    ckS, ckR,
    ns: 0, nr: 0, pn: state.ns,
    skipped: {...state.skipped},
  });
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
    const aad       = messageAAD(senderIKPub,envelope);
    const plaintext = await aeadDecrypt(mk, envelope.ct, aad);
    const skippedAt={...state.skippedAt};delete skippedAt[skipKey];
    return { plaintext, state: { ...state, skipped: newSkipped,skippedAt } };
  }

  if((envelope.dh===state.dhRecv&&envelope.n<state.nr)||(state.closedChains??[]).includes(envelope.dh))
    throw new ReceiveFailure('rejected-stale','Consumed or evicted receive position');
  let s = retainSkipped(state);

  // 2. Ratchet step if sender's DH key has changed
  if (envelope.dh !== state.dhRecv) {
    if (s.ckR) s = await skipMessageKeys(s, envelope.pn);
    s = await ratchetStep(s, envelope.dh);
  }

  // 3. Advance receiving chain to the message's position
  s = await skipMessageKeys(s, envelope.n);
  const { mk, ck } = await kdfCK(s.ckR);
  s = { ...s, ckR: ck, nr: s.nr + 1, skipped: { ...s.skipped } };

  const aad       = messageAAD(senderIKPub,envelope);
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
    myBundle:    { ik: DHKeyPair; spk: DHKeyPair; opk: DHKeyPair; bundle?: SignalPublicBundle },
    theirBundle: SignalPublicBundle,
    messageId?: string,
    resetParent?: string,
  ): Promise<SignalEnvelope> {
    for (let attempt = 0; attempt < 256; attempt++) {
    const journalKey = messageId ? `signal-envelope:${this.myId}:${this.theirId}:${messageId}` : undefined;
    const journal = journalKey ? await StorageService.getMetadata(journalKey) : null;
    if (journal) {
      if (journal.plaintext !== plaintext) throw new Error('Logical message content changed');
      return journal.envelope as SignalEnvelope;
    }
    const before = await loadSession(this.myId, this.theirId);
    let state = before;
    const epochBefore = await readEpoch(this.myId,this.theirId);
    let epochAfter: EpochRecord | null = epochBefore;
    const authenticated = (theirBundle as AuthenticatedBundle).version === 1;
    const identityChanges: MetadataChange[] = [];
    let context = state?.auth;
    if (authenticated) {
      const own = await verifyAuthenticatedBundle(myBundle.bundle!,this.myId);
      const peer = await verifyAuthenticatedBundle(theirBundle,this.theirId);
      identityChanges.push(await continuityChange(this.myId,peer));
      if (state && (!state.auth || !state.epoch)) throw new DMIdentityError('LEGACY_UNAUTHENTICATED','Existing session is not identity-bound');
      if (resetParent) {
        if (!epochBefore || epochBefore.current!==resetParent) throw new DMEpochError('STALE','Reset parent is not current');
        if(!epochBefore.settled) throw new DMEpochError('RESET_PENDING','Peer must confirm selected session before local reset');
        state=null;context=undefined;
      }
      if (context) await verifyContext(context,this.myId,this.theirId,own);
      else context = bootstrapContext(own,peer);
      if (!state && epochBefore && !resetParent) throw new DMEpochError('RESET_PENDING','Missing ratchet does not authorize reset');
      if (state && (!epochBefore || epochBefore.candidates[epochBefore.current]?.certificate!==state.epoch)) throw new DMEpochError('STALE','Ratchet authority mismatch');
    } else if (state?.auth || epochBefore) throw new DMIdentityError('LEGACY_UNAUTHENTICATED','Cannot downgrade authenticated session');
    let x3dhEphPub: string | undefined;
    let x3dhOpkId:  string | undefined;

    // Session is stale if it exists but has no receiving chain (ckR) after
    // having already sent messages (ns > 0). This happens when the other side
    // cleared their session (e.g. after key rotation). Force a fresh X3DH.
    const isStale = !authenticated && state && !state.ckR && (state.ns ?? 0) >= 50; // threshold: only stale after 50 unacknowledged sends

    if (!state || isStale) {
      // First message or stale session: X3DH → bootstrap session
      const { masterKey, x3dhEphPub: ep, opkId } = await x3dhSend(myBundle.ik, theirBundle);
      x3dhEphPub = ep;
      if (opkId) x3dhOpkId = opkId;
      const { state: s } = await initSessionAsSender(
        masterKey, theirBundle.spk,
      );
      state = {...s,auth:context};
      if(authenticated){
        state.epoch=await createEpoch(this.myId,context!,ep,s.dhSend.pub,resetParent?epochBefore!.generation+1:1,resetParent??null);
        const info=await verifyEpoch(state.epoch,context!);
        epochAfter=admitEpoch(epochBefore,info,before,false);
      }
      if (authenticated && opkId) {
        const key = `dm-sent-opk-v1:${this.myId}:${this.theirId}:${opkId}`;
        const used = await StorageService.getMetadata(key);
        if (used) {
          // Another send may have atomically established this session while
          // our speculative X3DH ran. Retry its state, never reissue the OPK.
          if (JSON.stringify(await loadSession(this.myId,this.theirId)) !== JSON.stringify(before)) continue;
          throw new DMIdentityError('STALE_PREKEY','Cached OPK already selected');
        }
        identityChanges.push({key,before:used,after:true});
      }
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
    }

    const { envelope, state: newState } = await ratchetEncrypt(
      state, plaintext, myBundle.ik.pubB64,
      authenticated ? {auth:context,epoch:state.epoch,eph:x3dhEphPub,opkId:x3dhOpkId} : {},
    );
    const result: SignalEnvelope = { v: authenticated ? 5 : 3, ...envelope,
      ...(x3dhEphPub ? { eph: x3dhEphPub } : {}),
      ...(x3dhOpkId  ? { opkId: x3dhOpkId } : {}),
    };
    const changes: MetadataChange[] = [...identityChanges,{ key: SESSION_KEY(this.myId, this.theirId), before, after: newState }];
    if(authenticated && epochAfter) changes.push(epochChange(this.myId,this.theirId,epochBefore,epochAfter));
    if (journalKey) changes.push({ key: journalKey, before: journal, after: { plaintext, envelope: result } } as any);
    if (await StorageService.compareAndSwapMetadata(changes)) return result;
    }
    throw new Error('Session contention; no envelope published');
  }

  /**
   * Decrypt a received envelope. On first receive performs X3DH to establish
   * the receiving chain; subsequent calls advance the double-ratchet.
   * myUserId is needed to look up the OPK pool in IDB and consume the right entry.
   */
  async decrypt(
    envelope: SignalEnvelope,
    myBundle: { ik: DHKeyPair; spk: DHKeyPair; bundle?: SignalPublicBundle },
    senderIKPub: string,
    myUserId: string,
    acceptedRow?: (plaintext: string) => StoredChatMessage,
    receiveCommit?: ReceiveCommit,
  ): Promise<string> {
    if (myUserId !== this.myId) throw new Error('Receiver identity mismatch');
    for (let attempt = 0; attempt < 256; attempt++) {
      const before = await loadSession(this.myId, this.theirId);
      let state = before;
      const changes: MetadataChange[] = [];
      const epochBefore=await readEpoch(this.myId,this.theirId);
      let epochAfter=epochBefore;
      let incomingId:string|undefined;
      let bootstrap=false;
      let branch=false;
      if (envelope.v === 5) {
        if (!envelope.auth) throw new DMIdentityError('UNKNOWN','Authenticated transcript missing');
        const own = await verifyAuthenticatedBundle(myBundle.bundle!,this.myId);
        const {peer,receiver} = await verifyContext(envelope.auth,this.myId,this.theirId,own);
        if (peer.ik !== senderIKPub) throw new DMIdentityError('IDENTITY_CHANGED','Sender IK mismatch');
        changes.push(await continuityChange(this.myId,peer));
        if (!envelope.epoch) throw new DMEpochError('LEGACY_UNAUTHENTICATED','Epoch certificate required');
        const info=await verifyEpoch(envelope.epoch,envelope.auth);incomingId=info.id;
        if(epochBefore&&info.generation<epochBefore.generation)throw new DMEpochError('STALE','Retired epoch');
        if(receiveCommit)changes.push(...await receiveCommitChanges(receiveCommit));
        if(envelope.eph){
          const certificate=JSON.parse(envelope.epoch);
          if(info.initiator!==this.theirId||certificate[5]!==envelope.eph||certificate[6]!==envelope.dh||envelope.n!==0||envelope.pn!==0) throw new DMEpochError('STALE','Bootstrap header mismatch');
          epochAfter=admitEpoch(epochBefore,info,before,true);bootstrap=true;
          branch=epochAfter.current!==info.id;
        }else{
          if(!epochBefore||epochBefore.candidates[info.id]?.certificate!==envelope.epoch){
            const current=epochBefore?.candidates[epochBefore.current];
            if((!epochBefore&&info.generation===1)||(current&&((info.generation===epochBefore!.generation&&info.parent===current.parent)||(info.generation===epochBefore!.generation+1&&info.parent===current.id))))
              throw new ReceiveFailure('retryable','Prerequisite bootstrap unavailable');
            throw new DMEpochError('STALE','Unknown or retired epoch');
          }
          if(info.generation!==epochBefore.generation)throw new DMEpochError('STALE','Retired epoch');
          branch=epochBefore.current!==info.id;
          state=branch?epochBefore.branches[info.id]:before;
          if(!state||state.epoch!==envelope.epoch) throw new DMEpochError('RESET_PENDING','Missing epoch ratchet');
        }
        if (envelope.eph && (receiver.binding.accountId !== this.myId || (receiver.selectedOPK?.id ?? undefined) !== envelope.opkId))
          throw new DMIdentityError('UNKNOWN','OPK transcript mismatch');
        if (!envelope.eph && envelope.opkId) throw new DMIdentityError('UNKNOWN','Unexpected OPK header');
      } else if (state?.auth || envelope.auth || epochBefore || envelope.v !== 3) throw new DMIdentityError('LEGACY_UNAUTHENTICATED','Cannot downgrade authenticated session');
      if (bootstrap || (envelope.v===3 && envelope.eph && !(state && state.nr > 0))) {
        let opk: OPKEntry | null = null;
        if (envelope.opkId) {
          const key = OPK_POOL_KEY(myUserId);
          const pool = await StorageService.getMetadata(key) as OPKEntry[] | undefined;
          const consumedKey = `dm-consumed-opks-v1:${myUserId}`;
          const consumed = await StorageService.getMetadata(consumedKey);
          if (consumed?.[envelope.opkId]) throw new DMIdentityError('STALE_PREKEY','OPK already consumed');
          opk = pool?.find(entry => entry.id === envelope.opkId) ?? null;
          changes.push({key:consumedKey,before:consumed,after:{...consumed,[envelope.opkId]:true}});
          if (!opk) throw new Error('Requested one-time prekey unavailable');
          changes.push({ key, before: pool, after: pool!.filter(entry => entry.id !== envelope.opkId) });
        }
        const master = await x3dhReceive(myBundle.ik, myBundle.spk, opk, senderIKPub, envelope.eph!);
        state = {...await initSessionAsReceiver(master, myBundle.spk, envelope.dh),auth:envelope.auth,epoch:envelope.epoch};
      }
      if (!state) throw new Error('No session and no X3DH ephemeral key');
      const result = await ratchetDecrypt(state, envelope, senderIKPub);
      if(epochAfter && incomingId){
        epochAfter=structuredClone(epochAfter);
        if(branch) epochAfter.branches[incomingId]=result.state;
        else if(!bootstrap) epochAfter.settled=true;
        changes.push(epochChange(this.myId,this.theirId,epochBefore,epochAfter));
      }
      changes.push({ key: SESSION_KEY(this.myId, this.theirId), before, after: branch?before:result.state });
      // Callback is pure construction; all acceptance writes share this transaction.
      if (await StorageService.compareAndSwapMetadata(changes, acceptedRow?.(result.plaintext))) return result.plaintext;
    }
    throw new ReceiveFailure('retryable','Session contention; retry decryption');
  }
  /** Explicit local replacement; retries must retain messageId and plaintext. */
  async resetSession(plaintext:string,myBundle:Parameters<SignalSession['encrypt']>[1],theirBundle:SignalPublicBundle,parentSessionId:string,messageId:string):Promise<SignalEnvelope>{
    if((theirBundle as AuthenticatedBundle).version!==1) throw new DMEpochError('LEGACY_UNAUTHENTICATED','Authenticated reset required');
    return this.encrypt(plaintext,myBundle,theirBundle,messageId,parentSessionId);
  }
  async hasSession(): Promise<boolean> {
    return !!(await loadSession(this.myId, this.theirId));
  }

  /** Legacy-only deletion. Epoch authority must use resetSession instead. */
  async clearSession(): Promise<void> {
    for (;;) {
      const before=await loadSession(this.myId,this.theirId);
      const authority=await readEpoch(this.myId,this.theirId);
      if(authority) throw new DMEpochError('RESET_PENDING','Use an explicit authenticated reset');
      if(await StorageService.compareAndSwapMetadata([{key:SESSION_KEY(this.myId,this.theirId),before,after:null},
        {key:`dm-session-epoch-v1:${this.myId}:${this.theirId}`,before:authority,after:authority}])) return;
    }
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
    const consumed = await StorageService.getMetadata(`dm-consumed-opks-v1:${userId}`);
    if (Array.isArray(stored) && stored.length > 0) {
      const available = stored.filter(entry => !consumed?.[entry.id]);
      if (available.length) return available as OPKEntry[];
    }
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
  for (;;) {
    const key = OPK_POOL_KEY(userId);
    const before = await StorageService.getMetadata(key);
    const consumedKey = `dm-consumed-opks-v1:${userId}`;
    const consumed = await StorageService.getMetadata(consumedKey);
    const merged = [...batch, ...(Array.isArray(before) ? before : [])].filter(entry => !consumed?.[entry.id]);
    if (new Set(merged.map(entry=>entry.id)).size !== merged.length || batch.some(entry=>consumed?.[entry.id])) throw new Error('OPK identifier collision');
    if (await StorageService.compareAndSwapMetadata([{key, before, after: merged},{key:consumedKey,before:consumed,after:consumed??{}}])) return merged;
  }
}

/** Local explicit consumption; receiver bootstrap uses the joint transaction above. */
export async function consumeOPK(userId: string, opkId: string): Promise<OPKEntry | null> {
  for (;;) {
    const key = OPK_POOL_KEY(userId);
    const before = await StorageService.getMetadata(key) as OPKEntry[] | undefined;
    const consumedKey = `dm-consumed-opks-v1:${userId}`;
    const consumed = await StorageService.getMetadata(consumedKey);
    const entry = before?.find(e => e.id === opkId);
    if (!entry || consumed?.[opkId]) return null;
    if (await StorageService.compareAndSwapMetadata([{key, before, after: before!.filter(e => e.id !== opkId)},
      {key:consumedKey,before:consumed,after:{...consumed,[opkId]:true}}])) return entry;
  }
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