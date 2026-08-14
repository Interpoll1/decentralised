/**
 * Envelope encryption for direct messages.
 *
 * Direct messages used to be encrypted with RSA-OAEP straight over the message
 * text. RSA-OAEP with a 2048-bit modulus and SHA-256 can only carry
 * `256 - 2*32 - 2 = 190` bytes of plaintext, so anything longer than a short
 * sentence threw `OperationError` inside `crypto.subtle.encrypt` — and the chat
 * view swallowed the failure, so the message simply disappeared on send.
 *
 * Here the message is encrypted with a fresh AES-256-GCM key and only that
 * 32-byte key is RSA-wrapped, once per recipient. Message length is unbounded,
 * and every already-published RSA identity key keeps working unchanged.
 */

export interface SealedEnvelope {
  /** base64 of `iv || ciphertext`. */
  ciphertext: string;
  /** base64 RSA-OAEP wrap of the AES key, for the recipient. */
  keyForRecipient: string;
  /** The same AES key wrapped for the sender, so a device can read its own sends. */
  keyForSender: string;
}

export const AES_IV_BYTES = 12;

/**
 * Chunked on purpose: `String.fromCharCode(...bytes)` passes one argument per
 * byte and overflows the call stack somewhere around a hundred kilobytes, which
 * is well within reach now that message length is no longer capped.
 */
export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * Returns an `ArrayBuffer` rather than a view: every consumer hands the result
 * straight to WebCrypto, which wants a `BufferSource`, and a plain buffer
 * sidesteps the view-vs-buffer typing entirely.
 */
export function fromBase64(value: string): ArrayBuffer {
  const binary = atob(value);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return buffer;
}

export async function generateIdentityKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(
    { name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    // The private key stays non-extractable; a key pair's public key is
    // extractable regardless, which is what `exportPublicKey` relies on.
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function exportPublicKey(publicKey: CryptoKey): Promise<string> {
  return toBase64(new Uint8Array(await crypto.subtle.exportKey('spki', publicKey)));
}

export async function importPublicKey(base64Key: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'spki', fromBase64(base64Key),
    { name: 'RSA-OAEP', hash: 'SHA-256' }, true, ['encrypt'],
  );
}

/**
 * RSA-OAEP directly, for values that comfortably fit the 190-byte ceiling.
 *
 * The room index needs to name a conversation partner to exactly one reader,
 * and a user id is 64 hex characters. Going through `seal` there would mean
 * carrying an AES key and two wraps to protect 64 bytes, and `seal` addresses
 * two readers when only one is wanted.
 */
export async function sealSmall(text: string, publicKey: CryptoKey): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  if (bytes.byteLength > 190) {
    throw new Error('sealSmall is for short values; use seal() instead');
  }
  return toBase64(new Uint8Array(await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, publicKey, bytes)));
}

export async function openSmall(value: string, privateKey: CryptoKey): Promise<string> {
  const plain = await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, privateKey, fromBase64(value));
  return new TextDecoder().decode(plain);
}

export async function seal(
  text: string,
  recipientPublicKey: CryptoKey,
  senderPublicKey: CryptoKey,
): Promise<SealedEnvelope> {
  const aesKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(AES_IV_BYTES));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, aesKey, new TextEncoder().encode(text),
  );

  // iv || ciphertext, so a message travels as one self-describing blob.
  const blob = new Uint8Array(iv.length + encrypted.byteLength);
  blob.set(iv, 0);
  blob.set(new Uint8Array(encrypted), iv.length);

  const rawAesKey = await crypto.subtle.exportKey('raw', aesKey);
  const wrap = async (publicKey: CryptoKey) =>
    toBase64(new Uint8Array(await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, publicKey, rawAesKey)));

  return {
    ciphertext: toBase64(blob),
    keyForRecipient: await wrap(recipientPublicKey),
    keyForSender: await wrap(senderPublicKey),
  };
}

/**
 * Decrypt an envelope from either side.
 *
 * Falls back to the v1 layout (`encryptedForRecipient` / `encryptedForSender`,
 * the whole message RSA-encrypted) so conversations that predate this change
 * stay readable.
 */
export async function open(
  raw: {
    ciphertext?: unknown;
    keyForRecipient?: unknown;
    keyForSender?: unknown;
    encryptedForRecipient?: unknown;
    encryptedForSender?: unknown;
  },
  privateKey: CryptoKey,
  side: 'recipient' | 'sender',
): Promise<string> {
  const wrapped = side === 'sender' ? raw.keyForSender : raw.keyForRecipient;
  if (typeof raw.ciphertext === 'string' && typeof wrapped === 'string') {
    const rawAesKey = await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, privateKey, fromBase64(wrapped));
    const aesKey = await crypto.subtle.importKey('raw', rawAesKey, { name: 'AES-GCM' }, false, ['decrypt']);
    const blob = fromBase64(raw.ciphertext);
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: blob.slice(0, AES_IV_BYTES) },
      aesKey,
      blob.slice(AES_IV_BYTES),
    );
    return new TextDecoder().decode(plain);
  }

  const legacy = side === 'sender' ? raw.encryptedForSender : raw.encryptedForRecipient;
  if (typeof legacy !== 'string' || legacy.length === 0) {
    throw new Error('Message has no payload this device can read');
  }
  const plain = await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, privateKey, fromBase64(legacy));
  return new TextDecoder().decode(plain);
}
