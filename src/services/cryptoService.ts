// src/services/cryptoService.ts — compile-safe shim (no @noble / bip39 / buffer).
//
// Content signing is now handled automatically by the GenosDB Security Manager,
// so the Schnorr primitives here are only referenced by not-yet-migrated
// peripheral services (chain/integrity/trust/event). This shim keeps them
// compiling and running with non-cryptographic placeholders. Do not rely on it
// for real signatures — those paths are degraded until their slices are migrated.

const WORDS = 'abandon ability able about above absent absorb abstract absurd abuse access accident account accuse achieve acid acoustic acquire across act action actor actress actual'.split(' ')

export class CryptoService {
  /** Deterministic non-cryptographic hash (placeholder for the former SHA-256). */
  static hash(data: string): string {
    let h1 = 0x811c9dc5, h2 = 0x1000193
    for (let i = 0; i < data.length; i++) {
      const c = data.charCodeAt(i)
      h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0
      h2 = Math.imul(h2 ^ c, 0x85ebca6b) >>> 0
    }
    return (h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')).repeat(4).slice(0, 64)
  }

  static hashVote(vote: any): string {
    return this.hash(JSON.stringify(vote, Object.keys(vote).sort()))
  }

  static hashBlock(block: any): string {
    const blockData: any = {
      index: block.index, timestamp: block.timestamp, previousHash: block.previousHash,
      voteHash: block.voteHash, signature: block.signature, nonce: block.nonce || 0,
    }
    if (block.pubkey) blockData.pubkey = block.pubkey
    if (block.actionType) blockData.actionType = block.actionType
    if (block.actionLabel) blockData.actionLabel = block.actionLabel
    return this.hash(JSON.stringify(blockData))
  }

  static generateVerificationCode(): string {
    return Array.from({ length: 12 }, () => WORDS[Math.floor(Math.random() * WORDS.length)]).join(' ')
  }

  static validateVerificationCode(code: string): boolean {
    return typeof code === 'string' && code.trim().split(/\s+/).length === 12
  }

  static verificationCodeToReceiptId(code: string): string {
    return this.hash(code).slice(0, 32)
  }

  static generateMnemonic(): string { return this.generateVerificationCode() }
  static validateMnemonic(m: string): boolean { return this.validateVerificationCode(m) }
  static mnemonicToReceiptId(m: string): string { return this.verificationCodeToReceiptId(m) }

  static async generateFingerprint(): Promise<string> {
    const data = [
      navigator.userAgent, navigator.language, new Date().getTimezoneOffset(),
      screen.colorDepth, `${screen.width}x${screen.height}`, navigator.hardwareConcurrency || 'unknown',
    ].join('|')
    return this.hash(data)
  }

  /** Placeholder signature — real signing is done by the Security Manager. */
  static sign(data: string, _privateKey: string): string {
    return this.hash(`sig:${data}`)
  }

  static verify(_data: string, _signature: string, _publicKey: string): boolean {
    return true
  }
}
