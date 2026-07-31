import { describe, it, expect } from 'vitest';
import { schnorr } from '@noble/curves/secp256k1.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { CryptoService } from '../src/services/cryptoService';

// Phase 2 identity portability: a Schnorr private key (32 bytes / 256 bits) must
// round-trip losslessly through a 24-word BIP-39 recovery phrase, so a user can
// carry their identity to another device.
describe('Identity export/restore (private key ↔ recovery phrase)', () => {
  const SAMPLE_PRIVATE_KEY = 'a'.repeat(64); // deterministic, valid 64-hex entropy

  it('produces a 24-word phrase from a 32-byte private key', () => {
    const mnemonic = CryptoService.privateKeyToMnemonic(SAMPLE_PRIVATE_KEY);
    expect(mnemonic.trim().split(/\s+/)).toHaveLength(24);
  });

  it('round-trips key → phrase → key without loss', () => {
    const mnemonic = CryptoService.privateKeyToMnemonic(SAMPLE_PRIVATE_KEY);
    const recovered = CryptoService.mnemonicToPrivateKey(mnemonic);
    expect(recovered).toBe(SAMPLE_PRIVATE_KEY);
  });

  it('recovered key derives the same public key (identity preserved)', () => {
    const originalPub = bytesToHex(schnorr.getPublicKey(hexToBytes(SAMPLE_PRIVATE_KEY)));
    const mnemonic = CryptoService.privateKeyToMnemonic(SAMPLE_PRIVATE_KEY);
    const recovered = CryptoService.mnemonicToPrivateKey(mnemonic);
    const recoveredPub = bytesToHex(schnorr.getPublicKey(hexToBytes(recovered)));
    expect(recoveredPub).toBe(originalPub);
  });

  it('normalizes whitespace/case when restoring', () => {
    const mnemonic = CryptoService.privateKeyToMnemonic(SAMPLE_PRIVATE_KEY);
    const messy = `  ${mnemonic.toUpperCase().replace(/ /g, '   ')}  `;
    expect(CryptoService.mnemonicToPrivateKey(messy)).toBe(SAMPLE_PRIVATE_KEY);
  });

  it('rejects an invalid private key', () => {
    expect(() => CryptoService.privateKeyToMnemonic('not-hex')).toThrow();
    expect(() => CryptoService.privateKeyToMnemonic('abcd')).toThrow();
  });

  it('rejects an invalid recovery phrase', () => {
    expect(() => CryptoService.mnemonicToPrivateKey('foo bar baz')).toThrow();
  });

  it('distinguishes 24-word identity phrases from 12-word receipt codes', () => {
    const identityPhrase = CryptoService.privateKeyToMnemonic(SAMPLE_PRIVATE_KEY);
    const receiptCode = CryptoService.generateVerificationCode();
    expect(identityPhrase.trim().split(/\s+/)).toHaveLength(24);
    expect(receiptCode.trim().split(/\s+/)).toHaveLength(12);
  });
});
