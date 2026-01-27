import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import * as bip39 from 'bip39';

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

  // Create block hash
  static hashBlock(block: Omit): string {
    const blockString = JSON.stringify({
      index: block.index,
      timestamp: block.timestamp,
      previousHash: block.previousHash,
      voteHash: block.voteHash,
      signature: block.signature,
      nonce: block.nonce || 0
    });
    return this.hash(blockString);
  }

  // Generate 12-word mnemonic
  static generateMnemonic(): string {
    return bip39.generateMnemonic();
  }

  // Validate mnemonic
  static validateMnemonic(mnemonic: string): boolean {
    return bip39.validateMnemonic(mnemonic);
  }

  // Derive receipt ID from mnemonic
  static mnemonicToReceiptId(mnemonic: string): string {
    const seed = bip39.mnemonicToSeedSync(mnemonic);
    return bytesToHex(sha256(seed)).substring(0, 32);
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

  // Simple signature using hash (for demo - in production use proper signing)
  static sign(data: string, privateKey: string): string {
    return this.hash(data + privateKey);
  }

  // Verify signature
  static verify(data: string, signature: string, privateKey: string): boolean {
    return this.sign(data, privateKey) === signature;
  }
}