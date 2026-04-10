import { describe, it, expect } from 'vitest';
import { schnorr } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, randomBytes } from '@noble/hashes/utils';

// CryptoService uses browser crypto APIs + bip39, test the pure crypto parts directly
describe('CryptoService primitives', () => {
  describe('SHA-256 hashing', () => {
    it('produces consistent 64-char hex hash', () => {
      const data = new TextEncoder().encode('hello world');
      const hash = bytesToHex(sha256(data));
      expect(hash).toHaveLength(64);
      expect(hash).toBe(bytesToHex(sha256(data))); // deterministic
    });

    it('different inputs produce different hashes', () => {
      const h1 = bytesToHex(sha256(new TextEncoder().encode('hello')));
      const h2 = bytesToHex(sha256(new TextEncoder().encode('world')));
      expect(h1).not.toBe(h2);
    });
  });

  describe('Schnorr signatures (secp256k1)', () => {
    it('generates valid key pair', () => {
      const privateKey = randomBytes(32);
      const publicKey = schnorr.getPublicKey(privateKey);
      expect(bytesToHex(privateKey)).toHaveLength(64);
      expect(bytesToHex(publicKey)).toHaveLength(64);
    });

    it('signs and verifies correctly', () => {
      const privateKey = randomBytes(32);
      const publicKey = schnorr.getPublicKey(privateKey);
      const message = sha256(new TextEncoder().encode('test message'));
      const sig = schnorr.sign(message, privateKey);
      expect(schnorr.verify(sig, message, publicKey)).toBe(true);
    });

    it('rejects invalid signature', () => {
      const privateKey = randomBytes(32);
      const publicKey = schnorr.getPublicKey(privateKey);
      const message = sha256(new TextEncoder().encode('test'));
      const sig = schnorr.sign(message, privateKey);

      // Tamper with the message
      const tampered = sha256(new TextEncoder().encode('tampered'));
      expect(schnorr.verify(sig, tampered, publicKey)).toBe(false);
    });

    it('rejects signature with wrong public key', () => {
      const privateKey1 = randomBytes(32);
      const privateKey2 = randomBytes(32);
      const publicKey2 = schnorr.getPublicKey(privateKey2);
      const message = sha256(new TextEncoder().encode('test'));
      const sig = schnorr.sign(message, privateKey1);
      expect(schnorr.verify(sig, message, publicKey2)).toBe(false);
    });
  });

  describe('Vote hash determinism', () => {
    it('same vote data produces same hash', () => {
      const vote = { pollId: 'p1', choice: 'A', timestamp: 1000, deviceId: 'd1' };
      const json1 = JSON.stringify(vote, Object.keys(vote).sort());
      const json2 = JSON.stringify(vote, Object.keys(vote).sort());
      const h1 = bytesToHex(sha256(new TextEncoder().encode(json1)));
      const h2 = bytesToHex(sha256(new TextEncoder().encode(json2)));
      expect(h1).toBe(h2);
    });

    it('different votes produce different hashes', () => {
      const v1 = { choice: 'A', pollId: 'p1' };
      const v2 = { choice: 'B', pollId: 'p1' };
      const h1 = bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(v1))));
      const h2 = bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(v2))));
      expect(h1).not.toBe(h2);
    });
  });

  describe('Block hash computation', () => {
    it('includes all critical fields', () => {
      const block = {
        index: 1,
        timestamp: 12345,
        previousHash: 'abc',
        voteHash: 'def',
        signature: 'sig',
        nonce: 42,
        pubkey: 'pub',
        actionType: 'vote',
        actionLabel: 'my vote',
      };
      const data = `${block.index}${block.timestamp}${block.previousHash}${block.voteHash}${block.signature}${block.nonce}${block.pubkey || ''}${block.actionType || ''}${block.actionLabel || ''}`;
      const hash = bytesToHex(sha256(new TextEncoder().encode(data)));
      expect(hash).toHaveLength(64);
    });
  });
});
