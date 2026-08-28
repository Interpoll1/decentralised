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
  v:    3;
  eph?: string;   // X3DH ephemeral pub (first message only)
  dh:   string;   // sender's current ratchet pub
  n:    number;   // message number in sending chain
  pn:   number;   // previous chain length
  ct:   string;   // base64 iv(12B)+ciphertext
}

export interface SignalPublicBundle {
  ik:  string;   // identity pub (base64)
  spk: string;   // signed pre-key pub (base64)
  opk: string;   // one-time pre-key pub (base64)
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

const IK_KEY  = (uid: string) => `signal-ik:${uid}`;
const SPK_KEY = (uid: string) => `signal-spk:${uid}`;
const OPK_KEY = (uid: string) => `signal-opk:${uid}`;

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

export async function getOrCreateIdentityBundle(userId: string): Promise<{
  ik: DHKeyPair; spk: DHKeyPair; opk: DHKeyPair; bundle: SignalPublicBundle;
}> {
  const [ik, spk, opk] = await Promise.all([
    loadOrCreateDHKey(IK_KEY(userId)),
    loadOrCreateDHKey(SPK_KEY(userId)),
    loadOrCreateDHKey(OPK_KEY(userId)),
  ]);
  return { ik, spk, opk, bundle: { ik: ik.pubB64, spk: spk.pubB64, opk: opk.pubB64 } };
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
 */
async function x3dhSend(
  senderIK: DHKeyPair,
  bundle: SignalPublicBundle,
): Promise<{ masterKey: string; x3dhEphPub: string }> {
  const rIK  = await importDHPub(bundle.ik);
  const rSPK = await importDHPub(bundle.spk);
  const rOPK = bundle.opk ? await importDHPub(bundle.opk) : null;
  const eph  = await generateDH();

  const dh1 = await dh(senderIK.priv, rSPK);   // DH(IK_S,  SPK_R)
  const dh2 = await dh(eph.priv,      rIK);    // DH(EK_S,  IK_R)
  const dh3 = await dh(eph.priv,      rSPK);   // DH(EK_S,  SPK_R)
  const dh4 = rOPK ? await dh(eph.priv, rOPK) : null; // DH(EK_S, OPK_R)

  const masterKey = await x3dhCombine([dh1, dh2, dh3, ...(dh4 ? [dh4] : [])]);
  return { masterKey, x3dhEphPub: eph.pubB64 };
}

/**
 * Receiver X3DH: derives the same masterKey from the sender's ephemeral key.
 */
async function x3dhReceive(
  myIK:  DHKeyPair,
  mySPK: DHKeyPair,
  myOPK: DHKeyPair | null,
  senderIKPub:  string,
  senderEphPub: string,
): Promise<string> {
  const sIK  = await importDHPub(senderIKPub);
  const sEph = await importDHPub(senderEphPub);

  const dh1 = await dh(mySPK.priv, sIK);    // DH(SPK_R, IK_S)
  const dh2 = await dh(myIK.priv,  sEph);   // DH(IK_R,  EK_S)
  const dh3 = await dh(mySPK.priv, sEph);   // DH(SPK_R, EK_S)
  const dh4 = myOPK ? await dh(myOPK.priv, sEph) : null; // DH(OPK_R, EK_S)

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

    // Session is stale if it exists but has no receiving chain (ckR) after
    // having already sent messages (ns > 0). This happens when the other side
    // cleared their session (e.g. after key rotation). Force a fresh X3DH.
    const isStale = state && !state.ckR && (state.ns ?? 0) >= 50; // threshold: only stale after 50 unacknowledged sends

    if (!state || isStale) {
      // First message or stale session: X3DH → bootstrap session
      const { masterKey, x3dhEphPub: ep } = await x3dhSend(myBundle.ik, theirBundle);
      x3dhEphPub = ep;
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

    return { v: SIGNAL_WIRE_VERSION, ...envelope, ...(x3dhEphPub ? { eph: x3dhEphPub } : {}) };
  }

  /**
   * Decrypt a received envelope. On first receive performs X3DH to establish
   * the receiving chain; subsequent calls advance the double-ratchet.
   */
  async decrypt(
    envelope:     SignalEnvelope,
    myBundle:     { ik: DHKeyPair; spk: DHKeyPair; opk: DHKeyPair },
    senderIKPub:  string,
  ): Promise<string> {
    let state = await loadSession(this.myId, this.theirId);

    // If eph is present this is a new X3DH initiation — always reset session.
    // This handles the case where a stale session exists from a previous
    // conversation (e.g. after key rotation or IndexedDB clear on one side).
    if (envelope.eph) {
      // Reset session when:
      //   1. No existing session at all
      //   2. envelope.dh differs from dhRecv = NEW X3DH init, always accept
      //   3. envelope.dh matches dhRecv but session not yet active (nr=0, no ckR)
      // Do NOT reset when: session is already active (nr>0 or ckR set)
      //   AND dh matches dhRecv = stale Gun re-delivery of original X3DH msg.
      const noSession    = !state;
      const newDHKey     = state && envelope.dh !== state.dhRecv;
      const sameDH       = state && envelope.dh === state.dhRecv;
      const sessionLive  = sameDH && (state.nr > 0 || !!state.ckR);
      const shouldReset  = noSession || newDHKey || (sameDH && !sessionLive);
      if (shouldReset) {
        const masterKey = await x3dhReceive(
          myBundle.ik, myBundle.spk, myBundle.opk,
          senderIKPub, envelope.eph,
        );
        state = await initSessionAsReceiver(
          this.myId, this.theirId, masterKey, myBundle.spk, envelope.dh,
        );
      }
      // else: active session, stale Gun re-delivery, skip reset
    } else if (!state) {
      throw new Error('No session and no X3DH ephemeral key — cannot establish session');
    }

    const { plaintext, state: newState } = await ratchetDecrypt(state, envelope, senderIKPub);
    await saveSession(this.myId, this.theirId, newState);
    return plaintext;
  }

  async hasSession(): Promise<boolean> {
    return !!(await loadSession(this.myId, this.theirId));
  }

  async clearSession(): Promise<void> {
    await StorageService.setMetadata(SESSION_KEY(this.myId, this.theirId), null);
  }
}