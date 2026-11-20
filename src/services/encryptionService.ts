/**
 * AES-256-GCM encryption service using the Web Crypto API.
 * Used for community/room-level message encryption, invite-link key sharing,
 * and HMAC-based anti-sabotage authentication tags.
 */
export class EncryptionService {
  private static readonly AES_ALGO = 'AES-GCM';
  private static readonly AES_KEY_LENGTH = 256;
  private static readonly IV_BYTE_LENGTH = 12; // 96-bit IV per NIST recommendation
  private static readonly PBKDF2_HASH = 'SHA-256';
  private static readonly DEFAULT_PBKDF2_ITERATIONS = 600_000;

  /**
   * Generate a random AES-256 key.
   * Returns a CryptoKey usable for encrypt/decrypt.
   */
  static async generateKey(): Promise<CryptoKey> {
    return crypto.subtle.generateKey(
      { name: this.AES_ALGO, length: this.AES_KEY_LENGTH },
      true, // extractable — needed for export/sharing
      ['encrypt', 'decrypt']
    );
  }

  /**
   * Derive an AES-256 key from a password using PBKDF2.
   * @param password - user-provided password
   * @param salt - typically communityId + 'interpoll-v2'
   * @param iterations - default 600 000 (OWASP 2023 recommendation for SHA-256)
   */
  static async deriveKeyFromPassword(
    password: string,
    salt: string,
    iterations: number = this.DEFAULT_PBKDF2_ITERATIONS
  ): Promise<CryptoKey> {
    const encoder = new TextEncoder();

    const baseKey = await crypto.subtle.importKey(
      'raw',
      encoder.encode(password),
      'PBKDF2',
      false,
      ['deriveKey']
    );

    return crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: encoder.encode(salt),
        iterations,
        hash: this.PBKDF2_HASH,
      },
      baseKey,
      { name: this.AES_ALGO, length: this.AES_KEY_LENGTH },
      true,
      ['encrypt', 'decrypt']
    );
  }

  /**
   * Encrypt plaintext with AES-256-GCM.
   * Generates a random 96-bit IV, prepends it to ciphertext.
   * Returns base64-encoded string: IV (12 bytes) + ciphertext.
   */
  static async encrypt(plaintext: string, key: CryptoKey): Promise<string> {
    const iv = crypto.getRandomValues(new Uint8Array(this.IV_BYTE_LENGTH));
    const encoded = new TextEncoder().encode(plaintext);

    let cipherBuffer: ArrayBuffer;
    try {
      cipherBuffer = await crypto.subtle.encrypt(
        { name: this.AES_ALGO, iv },
        key,
        encoded
      );
    } catch {
      throw new Error('Encryption failed — invalid key or unsupported algorithm');
    }

    // Prepend IV to ciphertext so decrypt can extract it
    const combined = new Uint8Array(iv.byteLength + cipherBuffer.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(cipherBuffer), iv.byteLength);

    return this.uint8ToBase64(combined);
  }

  /**
   * Decrypt an AES-256-GCM encrypted payload.
   * Expects base64-encoded string with prepended IV (12 bytes).
   * Throws on authentication failure (tampered data).
   */
  static async decrypt(ciphertext: string, key: CryptoKey): Promise<string> {
    let combined: Uint8Array;
    try {
      combined = this.base64ToUint8(ciphertext);
    } catch {
      throw new Error('Decryption failed — invalid base64 payload');
    }

    if (combined.byteLength <= this.IV_BYTE_LENGTH) {
      throw new Error('Decryption failed — payload too short');
    }

    const iv = combined.slice(0, this.IV_BYTE_LENGTH);
    const data = combined.slice(this.IV_BYTE_LENGTH);

    try {
      const plainBuffer = await crypto.subtle.decrypt(
        { name: this.AES_ALGO, iv },
        key,
        data
      );
      return new TextDecoder().decode(plainBuffer);
    } catch {
      throw new Error('Decryption failed — invalid key or tampered data');
    }
  }

  /**
   * Export a CryptoKey to base64 string for storage.
   * Uses 'raw' format (32 bytes for AES-256).
   */
  static async exportKey(key: CryptoKey): Promise<string> {
    const raw = await crypto.subtle.exportKey('raw', key);
    return this.uint8ToBase64(new Uint8Array(raw));
  }

  /**
   * Import a base64 string back into a CryptoKey.
   */
  static async importKey(base64Key: string): Promise<CryptoKey> {
    let raw: Uint8Array;
    try {
      raw = this.base64ToUint8(base64Key);
    } catch {
      throw new Error('Invalid key — malformed base64 encoding');
    }
    if (raw.byteLength !== this.AES_KEY_LENGTH / 8) {
      throw new Error(
        `Invalid key length: expected ${this.AES_KEY_LENGTH / 8} bytes, got ${raw.byteLength}`
      );
    }
    return crypto.subtle.importKey(
      'raw',
      raw.buffer as ArrayBuffer,
      { name: this.AES_ALGO, length: this.AES_KEY_LENGTH },
      true,
      ['encrypt', 'decrypt']
    );
  }

  /**
   * Export key as base64url (for invite link URL fragments).
   * Same as exportKey but URL-safe encoding (no +/= characters).
   */
  static async exportKeyAsBase64Url(key: CryptoKey): Promise<string> {
    const base64 = await this.exportKey(key);
    return this.base64ToBase64Url(base64);
  }

  /**
   * Import a base64url-encoded key (from invite link).
   */
  static async importKeyFromBase64Url(base64urlKey: string): Promise<CryptoKey> {
    const base64 = this.base64UrlToBase64(base64urlKey);
    return this.importKey(base64);
  }

  /**
   * Generate HMAC-SHA256 authentication tag for anti-sabotage.
   * Derives an HMAC key from the AES key material.
   * @param key - the room/community AES key
   * @param fields - string fields to include in the HMAC (e.g., messageId, timestamp, senderId)
   * @returns hex-encoded HMAC
   */
  static async generateAuthTag(key: CryptoKey, ...fields: string[]): Promise<string> {
    const hmacKey = await this.deriveHmacKey(key);
    // Length-prefix each field for unambiguous canonicalization
    const canonical = fields.map(f => `${f.length}:${f}`).join('|');
    const message = new TextEncoder().encode(canonical);

    const signature = await crypto.subtle.sign('HMAC', hmacKey, message);
    return this.bufferToHex(signature);
  }

  /**
   * Verify an HMAC authentication tag.
   * Uses crypto.subtle.verify for platform-native timing-safe comparison.
   * @returns true if the authTag matches the expected value
   */
  static async verifyAuthTag(
    key: CryptoKey,
    authTag: string,
    ...fields: string[]
  ): Promise<boolean> {
    const hmacKey = await this.deriveHmacKey(key);
    const canonical = fields.map(f => `${f.length}:${f}`).join('|');
    const message = new TextEncoder().encode(canonical);

    let signature: Uint8Array;
    try {
      signature = this.hexToUint8(authTag);
    } catch {
      return false;
    }

    return crypto.subtle.verify('HMAC', hmacKey, signature.buffer as ArrayBuffer, message);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Derive a deterministic HMAC-SHA256 key from AES key material via HKDF.
   * Domain-separated with 'interpoll-hmac-auth-v1' info string.
   */
  private static async deriveHmacKey(aesKey: CryptoKey): Promise<CryptoKey> {
    const rawBytes = await crypto.subtle.exportKey('raw', aesKey);

    const hkdfKey = await crypto.subtle.importKey(
      'raw', rawBytes, 'HKDF', false, ['deriveKey']
    );

    return crypto.subtle.deriveKey(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: new Uint8Array(0),
        info: new TextEncoder().encode('interpoll-hmac-auth-v1'),
      },
      hkdfKey,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign', 'verify']
    );
  }

  /** Convert Uint8Array to base64 string. */
  private static uint8ToBase64(bytes: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  /** Convert base64 string to Uint8Array. */
  private static base64ToUint8(base64: string): Uint8Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  /** Convert standard base64 to base64url. */
  private static base64ToBase64Url(base64: string): string {
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  /** Convert base64url back to standard base64. */
  private static base64UrlToBase64(base64url: string): string {
    let base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
    const pad = base64.length % 4;
    if (pad === 1) throw new Error('Invalid base64url string');
    if (pad === 2) base64 += '==';
    else if (pad === 3) base64 += '=';
    return base64;
  }

  /** Convert hex string to Uint8Array. */
  private static hexToUint8(hex: string): Uint8Array {
    if (hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) {
      throw new Error('Invalid hex string');
    }
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
    }
    return bytes;
  }

  /** Convert ArrayBuffer to hex string. */
  private static bufferToHex(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let hex = '';
    for (let i = 0; i < bytes.length; i++) {
      hex += bytes[i].toString(16).padStart(2, '0');
    }
    return hex;
  }
}
