import { describe, it, expect } from 'vitest';
import {
  seal, open, toBase64, fromBase64,
  generateIdentityKeyPair, exportPublicKey, importPublicKey,
} from '../src/utils/hybridCrypto';

// The bug this module exists to fix: direct messages were encrypted with
// RSA-OAEP straight over the text, which caps plaintext at 190 bytes for a
// 2048-bit key with SHA-256. Anything longer threw on send and the chat view
// swallowed the error, so the message vanished with no trace.

describe('hybridCrypto', () => {
  it('round-trips a message far longer than RSA-OAEP could ever carry', async () => {
    const alice = await generateIdentityKeyPair();
    const bob = await generateIdentityKeyPair();
    const long = 'x'.repeat(50_000);

    const envelope = await seal(long, bob.publicKey, alice.publicKey);

    expect(await open(envelope, bob.privateKey, 'recipient')).toBe(long);
    // The sender must be able to read their own sent message back.
    expect(await open(envelope, alice.privateKey, 'sender')).toBe(long);
  });

  it('demonstrates the ceiling the hybrid scheme removes', async () => {
    const bob = await generateIdentityKeyPair();
    const tooLong = new TextEncoder().encode('x'.repeat(191));

    await expect(
      crypto.subtle.encrypt({ name: 'RSA-OAEP' }, bob.publicKey, tooLong),
    ).rejects.toThrow();

    // Same length, through the envelope: fine.
    const alice = await generateIdentityKeyPair();
    const envelope = await seal('x'.repeat(191), bob.publicKey, alice.publicKey);
    expect(await open(envelope, bob.privateKey, 'recipient')).toHaveLength(191);
  });

  it('preserves non-ASCII text exactly', async () => {
    const alice = await generateIdentityKeyPair();
    const bob = await generateIdentityKeyPair();
    const text = 'héllo 🌍 — ключ 漢字\nsecond line\t tabbed';

    const envelope = await seal(text, bob.publicKey, alice.publicKey);
    expect(await open(envelope, bob.privateKey, 'recipient')).toBe(text);
  });

  it('a third party cannot open the envelope', async () => {
    const alice = await generateIdentityKeyPair();
    const bob = await generateIdentityKeyPair();
    const mallory = await generateIdentityKeyPair();

    const envelope = await seal('secret', bob.publicKey, alice.publicKey);
    await expect(open(envelope, mallory.privateKey, 'recipient')).rejects.toThrow();
  });

  it('each message gets a fresh key and IV', async () => {
    const alice = await generateIdentityKeyPair();
    const bob = await generateIdentityKeyPair();

    const a = await seal('same text', bob.publicKey, alice.publicKey);
    const b = await seal('same text', bob.publicKey, alice.publicKey);

    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(a.keyForRecipient).not.toBe(b.keyForRecipient);
  });

  it('still reads v1 envelopes, where the whole message was RSA-encrypted', async () => {
    const alice = await generateIdentityKeyPair();
    const bob = await generateIdentityKeyPair();
    const text = 'a short legacy message';

    // Exactly what the old sendMessage wrote.
    const legacyEnvelope = {
      encryptedForRecipient: toBase64(new Uint8Array(await crypto.subtle.encrypt(
        { name: 'RSA-OAEP' }, bob.publicKey, new TextEncoder().encode(text),
      ))),
      encryptedForSender: toBase64(new Uint8Array(await crypto.subtle.encrypt(
        { name: 'RSA-OAEP' }, alice.publicKey, new TextEncoder().encode(text),
      ))),
    };

    expect(await open(legacyEnvelope, bob.privateKey, 'recipient')).toBe(text);
    expect(await open(legacyEnvelope, alice.privateKey, 'sender')).toBe(text);
  });

  it('rejects an envelope with nothing this device can read', async () => {
    const bob = await generateIdentityKeyPair();
    await expect(open({}, bob.privateKey, 'recipient')).rejects.toThrow(/no payload/i);
  });

  it('a key pair generated non-extractable still exports its public half', async () => {
    // `generateKey(..., false, ...)` marks only the private key non-extractable;
    // publishing the public key to Gun depends on that distinction.
    const pair = await generateIdentityKeyPair();
    const exported = await exportPublicKey(pair.publicKey);
    expect(exported.length).toBeGreaterThan(0);

    const reimported = await importPublicKey(exported);
    const envelope = await seal('via reimported key', reimported, pair.publicKey);
    expect(await open(envelope, pair.privateKey, 'recipient')).toBe('via reimported key');
  });

  it('base64 helpers survive a large binary round trip', () => {
    // Guards the chunked encoder: spreading one argument per byte overflows the
    // call stack on inputs this size.
    const bytes = new Uint8Array(300_000);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 256;

    const restored = new Uint8Array(fromBase64(toBase64(bytes)));
    expect(restored.length).toBe(bytes.length);
    expect(restored[0]).toBe(0);
    expect(restored[255]).toBe(255);
    expect(restored[299_999]).toBe(bytes[299_999]);
  });
});
