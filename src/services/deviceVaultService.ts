// src/services/deviceVaultService.ts
//
// Keeps the account alive when the browser's site data is wiped.
//
// Everything the app knows about "who you are" lives in IndexedDB, and
// "Clear cache / site data" deletes IndexedDB. So the identity needs an anchor
// that sits OUTSIDE the browser's storage jar, on the device itself:
//
//  1. Passkey anchor (primary). A WebAuthn passkey lives in the device's
//     authenticator (Secure Enclave / TPM / Android keystore / password
//     manager), not in site data. Its PRF extension gives a 32-byte secret that
//     only that authenticator can reproduce. We derive from it:
//        - a KEK that AES-GCM-encrypts the vault (identity key + community keys)
//        - an opaque locator under which the sealed vault is replicated to Gun
//     The vault record is Schnorr-signed by the identity, and the identity's
//     public key rides in the passkey's userHandle, so a relay can drop the
//     record but cannot swap in a forged one.
//     After a wipe: one biometric prompt -> PRF -> fetch -> decrypt -> back.
//
//  2. Device file anchor (offline). A passphrase-sealed vault file on the
//     real filesystem. On Chromium it is kept up to date through a
//     File System Access handle; elsewhere it is a one-shot download.
//
//  3. navigator.storage.persist(): stops silent eviction under disk pressure.
//     (It does not stop a manual wipe; that is what 1 and 2 are for.)

import { KeyService } from './keyService';
import { KeyVaultService } from './keyVaultService';
import { CryptoService } from './cryptoService';
import { GunService } from './gunService';
import { StorageService } from './storageService';
import { gunOnce, gunPut } from '../utils/gunAsync';
import type { StoredEncryptionKey } from '../types/encryption';

const VAULT_ROOT = 'device-vault-v1';
const PRF_SALT_LABEL = 'echo/device-vault/prf/v1';
const PROFILE_META_KEY = 'user-profile-v2';
const ANCHOR_META_KEY = 'device-vault-anchor';
const FILE_HANDLE_META_KEY = 'device-vault-file-handle';
const FILE_FORMAT = 'echo-device-vault';
const PBKDF2_ITERATIONS = 600_000;

export interface VaultContents {
  v: 1;
  privateKey: string;
  encryptionKeys: StoredEncryptionKey[];
  savedAt: number;
}

interface SealedRecord {
  v: 1;
  pub: string;       // identity public key (x-only hex)
  iv: string;        // base64
  ct: string;        // base64 AES-GCM ciphertext
  savedAt: number;
  sig: string;       // Schnorr over canonical(v,pub,iv,ct,savedAt,locator)
}

interface AnchorInfo { credentialId: string; createdAt: number; lastSyncedAt: number }

const enc = new TextEncoder();
const dec = new TextDecoder();
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const hex = (u: Uint8Array) => Array.from(u, b => b.toString(16).padStart(2, '0')).join('');
const unhex = (s: string) => Uint8Array.from(s.match(/../g) ?? [], h => parseInt(h, 16));
const b64url = (u: Uint8Array) => b64(u).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s: string) => unb64(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
const buf = (u: Uint8Array) => u.slice().buffer as ArrayBuffer;

function signingPayload(r: Omit<SealedRecord, 'sig'>, locator: string): string {
  return JSON.stringify(['echo/device-vault', r.v, r.pub, r.iv, r.ct, r.savedAt, locator]);
}

async function hkdf(secret: Uint8Array, info: string, usage: 'aes' | 'raw'): Promise<CryptoKey | Uint8Array> {
  const base = await crypto.subtle.importKey('raw', buf(secret), 'HKDF', false, ['deriveKey', 'deriveBits']);
  const params = { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: enc.encode(info) };
  if (usage === 'aes') {
    return crypto.subtle.deriveKey(params, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  return new Uint8Array(await crypto.subtle.deriveBits(params, base, 256));
}

async function seal(key: CryptoKey, data: VaultContents): Promise<{ iv: string; ct: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(data))));
  return { iv: b64(iv), ct: b64(ct) };
}

async function unseal(key: CryptoKey, iv: string, ct: string): Promise<VaultContents> {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, key, buf(unb64(ct)));
  const data = JSON.parse(dec.decode(pt));
  if (data?.v !== 1 || !/^[0-9a-f]{64}$/i.test(data.privateKey)) throw new Error('Vault contents are malformed');
  return data;
}

export class DeviceVaultService {
  // ── Capability detection ────────────────────────────────────────────────────

  /** Passkeys need a secure, non-native web context (Capacitor/Tauri origins can't own an rpId). */
  static passkeySupported(): boolean {
    if (typeof window === 'undefined' || !window.isSecureContext || !window.PublicKeyCredential) return false;
    const w = window as any;
    if (w.Capacitor?.isNativePlatform?.() || w.__TAURI_INTERNALS__) return false;
    return true;
  }

  static fileHandleSupported(): boolean {
    return typeof window !== 'undefined' && 'showSaveFilePicker' in window && 'showOpenFilePicker' in window;
  }

  // ── Persistent storage ─────────────────────────────────────────────────────

  /** Ask the browser not to evict our storage. Safe to call on every start. */
  static async requestPersistence(): Promise<boolean> {
    try {
      if (!navigator.storage?.persist) return false;
      if (await navigator.storage.persisted()) return true;
      return await navigator.storage.persist();
    } catch { return false; }
  }

  static async isPersisted(): Promise<boolean> {
    try { return !!(await navigator.storage?.persisted?.()); } catch { return false; }
  }

  // ── Vault snapshot ─────────────────────────────────────────────────────────

  static async snapshot(): Promise<VaultContents> {
    const [privateKey, encryptionKeys] = await Promise.all([
      KeyService.getPrivateKeyHex(),
      KeyVaultService.listKeys().catch(() => [] as StoredEncryptionKey[]),
    ]);
    return { v: 1, privateKey, encryptionKeys, savedAt: Date.now() };
  }

  /** Install a vault onto this device. Caller should reload afterwards. */
  static async install(data: VaultContents): Promise<{ publicKey: string }> {
    const pair = await KeyService.importPrivateKey(data.privateKey);
    await StorageService.setMetadata(PROFILE_META_KEY, null);
    for (const k of data.encryptionKeys ?? []) {
      if (k?.id && k.key && k.type) await KeyVaultService.storeKey(k);
    }
    return { publicKey: pair.publicKey };
  }

  // ── Passkey anchor ─────────────────────────────────────────────────────────

  static async getAnchor(): Promise<AnchorInfo | null> {
    return (await StorageService.getMetadata(ANCHOR_META_KEY).catch(() => null)) ?? null;
  }

  private static async prfSalt(): Promise<Uint8Array> {
    return new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(PRF_SALT_LABEL)));
  }

  /** Run a get() ceremony with PRF. Empty allowCredentials = let the user pick any of our passkeys. */
  private static async evaluatePrf(credentialId?: Uint8Array): Promise<{ prf: Uint8Array; userHandle: Uint8Array | null; credentialId: Uint8Array }> {
    const salt = await this.prfSalt();
    const cred = await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        userVerification: 'required',
        allowCredentials: credentialId ? [{ type: 'public-key', id: buf(credentialId) }] : [],
        extensions: { prf: { eval: { first: buf(salt) } } } as any,
      },
    }) as PublicKeyCredential | null;
    if (!cred) throw new Error('No passkey was selected.');
    const first = (cred.getClientExtensionResults() as any)?.prf?.results?.first;
    if (!first) throw new Error('This passkey or browser does not support the PRF extension. Use the device file backup instead.');
    const resp = cred.response as AuthenticatorAssertionResponse;
    return {
      prf: new Uint8Array(first),
      userHandle: resp.userHandle ? new Uint8Array(resp.userHandle) : null,
      credentialId: new Uint8Array(cred.rawId),
    };
  }

  private static async keysFromPrf(prf: Uint8Array) {
    const kek = await hkdf(prf, 'echo/device-vault/kek/v1', 'aes') as CryptoKey;
    const locator = hex(await hkdf(prf, 'echo/device-vault/locator/v1', 'raw') as Uint8Array);
    return { kek, locator };
  }

  /** Create a passkey for this identity and replicate the sealed vault. */
  static async enrollPasskey(displayName: string): Promise<void> {
    if (!this.passkeySupported()) throw new Error('Passkeys are not available in this app/browser.');
    const publicKey = await KeyService.getPublicKeyHex();
    const salt = await this.prfSalt();

    const cred = await navigator.credentials.create({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rp: { name: 'Echo' },
        user: { id: buf(unhex(publicKey)), name: displayName || `echo-${publicKey.slice(0, 8)}`, displayName: displayName || 'Echo account' },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'required' },
        extensions: { prf: { eval: { first: buf(salt) } } } as any,
      },
    }) as PublicKeyCredential | null;
    if (!cred) throw new Error('Passkey creation was cancelled.');

    const ext = (cred.getClientExtensionResults() as any)?.prf;
    if (ext && ext.enabled === false) throw new Error('This authenticator cannot derive keys (no PRF). Use the device file backup instead.');
    const rawId = new Uint8Array(cred.rawId);

    // Some platforms only report prf.enabled on create; evaluate with a get().
    const prf = ext?.results?.first ? new Uint8Array(ext.results.first) : (await this.evaluatePrf(rawId)).prf;

    await this.pushSealed(prf, publicKey);
    await StorageService.setMetadata(ANCHOR_META_KEY, { credentialId: b64url(rawId), createdAt: Date.now(), lastSyncedAt: Date.now() } satisfies AnchorInfo);
  }

  /** Re-seal the current state under the existing passkey (e.g. after joining a private community). */
  static async resyncPasskey(): Promise<void> {
    const anchor = await this.getAnchor();
    if (!anchor) throw new Error('No passkey is linked on this device.');
    const { prf } = await this.evaluatePrf(unb64url(anchor.credentialId));
    await this.pushSealed(prf, await KeyService.getPublicKeyHex());
    await StorageService.setMetadata(ANCHOR_META_KEY, { ...anchor, lastSyncedAt: Date.now() });
  }

  private static async pushSealed(prf: Uint8Array, publicKey: string): Promise<void> {
    const { kek, locator } = await this.keysFromPrf(prf);
    const { iv, ct } = await seal(kek, await this.snapshot());
    const body = { v: 1 as const, pub: publicKey, iv, ct, savedAt: Date.now() };
    const record: SealedRecord = { ...body, sig: CryptoService.sign(signingPayload(body, locator), await KeyService.getPrivateKeyHex()) };
    const ack = await gunPut(GunService.getGun().get(VAULT_ROOT).get(locator), { json: JSON.stringify(record) });
    if (!ack.ok) throw new Error('No relay confirmed the backup. Check your connection and try again.');
  }

  /** After a wipe: pick the passkey, pull the sealed vault, verify, decrypt, install. */
  static async restoreWithPasskey(): Promise<{ publicKey: string; communityKeys: number }> {
    if (!this.passkeySupported()) throw new Error('Passkeys are not available in this app/browser.');
    const { prf, userHandle, credentialId } = await this.evaluatePrf();
    const { kek, locator } = await this.keysFromPrf(prf);

    const node = await gunOnce<any>(GunService.getGun().get(VAULT_ROOT).get(locator), 8000);
    const raw = typeof node?.json === 'string' ? node.json : null;
    if (!raw) throw new Error('Passkey found, but no relay has its vault right now. Try again online, or use the device file.');
    const record = JSON.parse(raw) as SealedRecord;

    const expectedPub = userHandle && userHandle.length === 32 ? hex(userHandle) : null;
    if (expectedPub && record.pub !== expectedPub) throw new Error('Vault does not belong to this passkey.');
    const { sig, ...body } = record;
    if (!CryptoService.verify(signingPayload(body, locator), sig, record.pub)) throw new Error('Vault signature is invalid — refusing to restore.');

    const data = await unseal(kek, record.iv, record.ct);
    if (KeyService.getPublicKey(data.privateKey) !== record.pub) throw new Error('Vault key does not match its signer.');
    const result = await this.install(data);
    await StorageService.setMetadata(ANCHOR_META_KEY, { credentialId: b64url(credentialId), createdAt: Date.now(), lastSyncedAt: record.savedAt } satisfies AnchorInfo);
    return { publicKey: result.publicKey, communityKeys: data.encryptionKeys?.length ?? 0 };
  }

  // ── Device file anchor ─────────────────────────────────────────────────────

  private static async passphraseKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
    const base = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', hash: 'SHA-256', salt: buf(salt), iterations: PBKDF2_ITERATIONS },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
    );
  }

  static async buildFile(passphrase: string): Promise<string> {
    if (passphrase.length < 8) throw new Error('Use a passphrase of at least 8 characters.');
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const { iv, ct } = await seal(await this.passphraseKey(passphrase, salt), await this.snapshot());
    return JSON.stringify({ format: FILE_FORMAT, v: 1, kdf: { name: 'PBKDF2-SHA256', iterations: PBKDF2_ITERATIONS, salt: b64(salt) }, iv, ct }, null, 2);
  }

  static async readFile(text: string, passphrase: string): Promise<VaultContents> {
    let f: any;
    try { f = JSON.parse(text); } catch { throw new Error('That is not an Echo vault file.'); }
    if (f?.format !== FILE_FORMAT || f.v !== 1 || !f.kdf?.salt) throw new Error('That is not an Echo vault file.');
    try {
      return await unseal(await this.passphraseKey(passphrase, unb64(f.kdf.salt)), f.iv, f.ct);
    } catch { throw new Error('Wrong passphrase, or the file is damaged.'); }
  }

  /** Save to disk. On Chromium the handle is kept so later saves overwrite the same file silently. */
  static async saveFile(passphrase: string): Promise<'linked' | 'downloaded'> {
    const text = await this.buildFile(passphrase);
    const name = 'echo-account.echovault';
    if (this.fileHandleSupported()) {
      const handle = await (window as any).showSaveFilePicker({
        suggestedName: name,
        types: [{ description: 'Echo vault', accept: { 'application/json': ['.echovault'] } }],
      });
      const w = await handle.createWritable();
      await w.write(text); await w.close();
      await StorageService.setMetadata(FILE_HANDLE_META_KEY, handle).catch(() => {});
      return 'linked';
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    return 'downloaded';
  }

  static async hasLinkedFile(): Promise<boolean> {
    return !!(await StorageService.getMetadata(FILE_HANDLE_META_KEY).catch(() => null));
  }

  /** Overwrite the linked file with the current state. */
  static async updateLinkedFile(passphrase: string): Promise<void> {
    const handle = await StorageService.getMetadata(FILE_HANDLE_META_KEY);
    if (!handle) throw new Error('No vault file is linked.');
    if ((await handle.queryPermission?.({ mode: 'readwrite' })) !== 'granted'
      && (await handle.requestPermission?.({ mode: 'readwrite' })) !== 'granted') {
      throw new Error('Permission to write the vault file was denied.');
    }
    const w = await handle.createWritable();
    await w.write(await this.buildFile(passphrase)); await w.close();
  }

  static async restoreFromFile(file: File, passphrase: string): Promise<{ publicKey: string; communityKeys: number }> {
    const data = await this.readFile(await file.text(), passphrase);
    const r = await this.install(data);
    return { publicKey: r.publicKey, communityKeys: data.encryptionKeys?.length ?? 0 };
  }
}
