// src/services/keyService.ts — compile-safe shim (no @noble).
//
// User identity and operation signing are handled by the GenosDB Security
// Manager. The former Schnorr keypair survives only as a placeholder for
// not-yet-migrated peripheral services (chat key publish, trust/chain/event).
// Keys are random hex persisted locally; they do not produce real signatures.
import { StorageService } from './storageService'
import type { StoredKeyPair } from '../types/nostr'

function randomHex(bytes: number): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), b => b.toString(16).padStart(2, '0')).join('')
}

export class KeyService {
  private static readonly KEYPAIR_META_KEY = 'nostr-keypair'
  private static cachedKeyPair: StoredKeyPair | null = null

  static generatePrivateKey(): string {
    return randomHex(32)
  }

  /** Deterministic placeholder public key derived from the private key. */
  static getPublicKey(privateKey: string): string {
    let h = 0
    for (let i = 0; i < privateKey.length; i++) h = (Math.imul(31, h) + privateKey.charCodeAt(i)) >>> 0
    return (h.toString(16).padStart(8, '0')).repeat(8)
  }

  static async generateAndStoreKeyPair(): Promise<StoredKeyPair> {
    const privateKey = this.generatePrivateKey()
    const keyPair: StoredKeyPair = { privateKey, publicKey: this.getPublicKey(privateKey), createdAt: Date.now() }
    await StorageService.setMetadata(this.KEYPAIR_META_KEY, keyPair)
    this.cachedKeyPair = keyPair
    return keyPair
  }

  static async getKeyPair(): Promise<StoredKeyPair> {
    if (this.cachedKeyPair) return this.cachedKeyPair
    const stored = await StorageService.getMetadata(this.KEYPAIR_META_KEY)
    if (stored?.privateKey && stored?.publicKey) {
      this.cachedKeyPair = stored as StoredKeyPair
      return this.cachedKeyPair
    }
    return this.generateAndStoreKeyPair()
  }

  static async getPublicKeyHex(): Promise<string> {
    return (await this.getKeyPair()).publicKey
  }

  static async getPrivateKeyHex(): Promise<string> {
    return (await this.getKeyPair()).privateKey
  }

  static async importPrivateKey(privateKeyHex: string): Promise<StoredKeyPair> {
    const keyPair: StoredKeyPair = { privateKey: privateKeyHex.toLowerCase(), publicKey: this.getPublicKey(privateKeyHex), createdAt: Date.now() }
    await StorageService.setMetadata(this.KEYPAIR_META_KEY, keyPair)
    this.cachedKeyPair = keyPair
    return keyPair
  }

  static async hasKeyPair(): Promise<boolean> {
    if (this.cachedKeyPair) return true
    const stored = await StorageService.getMetadata(this.KEYPAIR_META_KEY)
    return !!stored?.privateKey
  }

  static clearCache(): void {
    this.cachedKeyPair = null
  }
}
