import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { schnorr } from '@noble/curves/secp256k1.js';
import * as bip39 from 'bip39';
import { Buffer } from 'buffer';

// Ensure Buffer exists in browser for bip39
if (typeof (globalThis as any).Buffer === 'undefined') {
  (globalThis as any).Buffer = Buffer;
}

export class CryptoService {
  // Hash any data
  static hash(data: string): string {
    const hashBytes = sha256(new TextEncoder().encode(data));
    return bytesToHex(hashBytes);
  }

  // Create a deterministic hash for a vote
  static hashVote(vote: any): string {
    const voteString = JSON.stringify(vote, Object.keys(vote).sort());
    return this.hash(voteString);
  }

  // Create block hash (includes pubkey when present for tamper-proofing)
  static hashBlock(block: Omit<any, 'currentHash'>): string {
    const blockData: any = {
      index: block.index,
      timestamp: block.timestamp,
      previousHash: block.previousHash,
      voteHash: block.voteHash,
      signature: block.signature,
      nonce: block.nonce || 0
    };
    if (block.pubkey) {
      blockData.pubkey = block.pubkey;
    }
    if (block.actionType) {
      blockData.actionType = block.actionType;
    }
    if (block.actionLabel) {
      blockData.actionLabel = block.actionLabel;
    }
    const blockString = JSON.stringify(blockData);
    return this.hash(blockString);
  }

  // Generate 12-word receipt verification code (BIP-39 word list format)
  static generateVerificationCode(): string {
    return bip39.generateMnemonic();
  }

  // Validate receipt verification code format
  static validateVerificationCode(verificationCode: string): boolean {
    return bip39.validateMnemonic(verificationCode);
  }

  // Derive receipt ID from receipt verification code
  static verificationCodeToReceiptId(verificationCode: string): string {
    const seed = bip39.mnemonicToSeedSync(verificationCode);
    return bytesToHex(sha256(seed)).substring(0, 32);
  }

  // ── Identity backup: private key ↔ BIP-39 recovery phrase ──────────────────
  // A Schnorr private key is 32 bytes (256 bits) of entropy, which maps to a
  // 24-word BIP-39 phrase. Distinct from the 12-word receipt codes above.

  // Convert a 32-byte private key (hex) into a 24-word recovery phrase.
  static privateKeyToMnemonic(privateKeyHex: string): string {
    if (!/^[0-9a-f]{64}$/i.test(privateKeyHex)) {
      throw new Error('Invalid private key: must be 64 hex characters');
    }
    return bip39.entropyToMnemonic(privateKeyHex.toLowerCase());
  }

  // Recover a private key (hex) from a 24-word phrase produced by privateKeyToMnemonic.
  static mnemonicToPrivateKey(mnemonic: string): string {
    const normalized = mnemonic.trim().toLowerCase().replace(/\s+/g, ' ');
    if (!bip39.validateMnemonic(normalized)) {
      throw new Error('Invalid recovery phrase');
    }
    return bip39.mnemonicToEntropy(normalized).toLowerCase();
  }

  // Legacy aliases
  static generateMnemonic(): string {
    return this.generateVerificationCode();
  }

  static validateMnemonic(mnemonic: string): boolean {
    return this.validateVerificationCode(mnemonic);
  }

  static mnemonicToReceiptId(mnemonic: string): string {
    return this.verificationCodeToReceiptId(mnemonic);
  }

  // Generate browser fingerprint (anonymous)
  static async generateFingerprint(): Promise {
    const data = [
      navigator.userAgent,
      navigator.language,
      new Date().getTimezoneOffset(),
      screen.colorDepth,
      screen.width + 'x' + screen.height,
      navigator.hardwareConcurrency || 'unknown'
    ].join('|');
    
    return this.hash(data);
  }

  // Schnorr signature over secp256k1
  static sign(data: string, privateKey: string): string {
    const messageHash = this.hash(data);
    const sig = schnorr.sign(hexToBytes(messageHash), hexToBytes(privateKey));
    return bytesToHex(sig);
  }

  // Verify Schnorr signature using public key
  static verify(data: string, signature: string, publicKey: string): boolean {
    try {
      const messageHash = this.hash(data);
      return schnorr.verify(hexToBytes(signature), hexToBytes(messageHash), hexToBytes(publicKey));
    } catch {
      return false;
    }
  }
}