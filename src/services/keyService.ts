// src/services/keyService.ts — Schnorr key pair management (secp256k1)
import { schnorr } from '@noble/curves/secp256k1.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { StorageService } from './storageService';
import type { StoredKeyPair } from '../types/nostr';

export class KeyService {
  private static readonly KEYPAIR_META_KEY = 'nostr-keypair';
  private static cachedKeyPair: StoredKeyPair | null = null;

  // Generate a new 32-byte random private key (hex)
  static generatePrivateKey(): string {
    const privateKeyBytes = crypto.getRandomValues(new Uint8Array(32));
    return bytesToHex(privateKeyBytes);
  }

  // Derive the x-only public key from a private key
  static getPublicKey(privateKey: string): string {
    return bytesToHex(schnorr.getPublicKey(hexToBytes(privateKey)));
  }

  // Generate a fresh key pair, store it, and return it
  static async generateAndStoreKeyPair(): Promise<StoredKeyPair> {
    const privateKey = this.generatePrivateKey();
    const publicKey = this.getPublicKey(privateKey);
    const keyPair: StoredKeyPair = { privateKey, publicKey, createdAt: Date.now() };

    await StorageService.setMetadata(this.KEYPAIR_META_KEY, keyPair);
    this.cachedKeyPair = keyPair;

    return keyPair;
  }

  // Retrieve the stored key pair, generating one if none exists
  static async getKeyPair(): Promise<StoredKeyPair> {
    if (this.cachedKeyPair) return this.cachedKeyPair;

    const stored = await StorageService.getMetadata(this.KEYPAIR_META_KEY);
    if (stored && stored.privateKey && stored.publicKey) {
      this.cachedKeyPair = stored as StoredKeyPair;
      return this.cachedKeyPair;
    }

    return this.generateAndStoreKeyPair();
  }

  // Get just the public key (safe to share)
  static async getPublicKeyHex(): Promise<string> {
    const keyPair = await this.getKeyPair();
    return keyPair.publicKey;
  }

  // Get just the private key (internal use only)
  static async getPrivateKeyHex(): Promise<string> {
    const keyPair = await this.getKeyPair();
    return keyPair.privateKey;
  }

  // Import an existing private key (e.g. from backup)
  static async importPrivateKey(privateKeyHex: string): Promise<StoredKeyPair> {
    if (!/^[0-9a-f]{64}$/i.test(privateKeyHex)) {
      throw new Error('Invalid private key format: must be 64 hex characters');
    }

    const publicKey = this.getPublicKey(privateKeyHex);
    const keyPair: StoredKeyPair = {
      privateKey: privateKeyHex.toLowerCase(),
      publicKey,
      createdAt: Date.now(),
    };

    await StorageService.setMetadata(this.KEYPAIR_META_KEY, keyPair);
    this.cachedKeyPair = keyPair;

    return keyPair;
  }

  // Check if a key pair already exists
  static async hasKeyPair(): Promise<boolean> {
    if (this.cachedKeyPair) return true;
    const stored = await StorageService.getMetadata(this.KEYPAIR_META_KEY);
    return !!(stored && stored.privateKey);
  }

  // Clear in-memory cache
  static clearCache(): void {
    this.cachedKeyPair = null;
  }
}
