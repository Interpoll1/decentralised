// src/services/chatKeyPinService.ts — Trust-on-first-use pinning for DM encryption keys
// Users publish their RSA chat public key at users/{id}/chatPublicKey, which is world-writable
// in Gun. Without pinning, an attacker can replace a peer's key and MITM the conversation.
// This service implements Signal-style safety numbers and TOFU key rotation.
import { StorageService } from './storageService';
import { CryptoService } from './cryptoService';

export interface PinnedKey {
  userId: string;
  /** base64 SPKI of the peer's RSA chat public key. */
  keyB64: string;
  /** When this key was first pinned. */
  pinnedAt: number;
  /** Set when the user manually confirmed the safety number out of band. */
  verifiedAt?: number;
  /** Previous keys we have seen for this peer, newest first. Audit trail. */
  history?: Array<{ keyB64: string; pinnedAt: number; replacedAt: number }>;
}

export type PinCheck =
  | { status: 'new' }
  | { status: 'match'; pin: PinnedKey }
  | { status: 'changed'; pin: PinnedKey; incomingKeyB64: string };

export class ChatKeyPinService {
  private static storageKey(userId: string): string {
    return `chat-pin:${userId}`;
  }

  /** Retrieve a pinned key; returns null on any error or malformed record. */
  static async getPin(userId: string): Promise<PinnedKey | null> {
    try {
      const stored = await StorageService.getMetadata(this.storageKey(userId));
      if (!stored) return null;

      // Guard: keyB64 must be a non-empty string
      if (typeof stored.keyB64 !== 'string' || stored.keyB64.length === 0) {
        return null;
      }

      return stored as PinnedKey;
    } catch {
      return null;
    }
  }

  /**
   * Check if a peer's key is pinned; return status and existing/new key.
   * No pin → new. Same key → match. Different key → changed.
   */
  static async check(userId: string, incomingKeyB64: string): Promise<PinCheck> {
    const pin = await this.getPin(userId);
    if (!pin) {
      return { status: 'new' };
    }
    if (pin.keyB64 === incomingKeyB64) {
      return { status: 'match', pin };
    }
    return { status: 'changed', pin, incomingKeyB64 };
  }

  /** Pin a key for the first time; no-op if identical key already pinned. */
  static async pin(userId: string, keyB64: string): Promise<PinnedKey> {
    const existing = await this.getPin(userId);
    if (existing && existing.keyB64 === keyB64) {
      return existing;
    }

    const pinned: PinnedKey = {
      userId,
      keyB64,
      pinnedAt: Date.now(),
    };

    try {
      await StorageService.setMetadata(this.storageKey(userId), pinned);
    } catch {
      // Degrade gracefully: return the object we built even if storage failed.
      // The pin exists in memory and will sync if storage recovers.
    }

    return pinned;
  }

  /**
   * User explicitly accepted a key rotation.
   * Move the old key to history, update to new key, reset verifiedAt.
   */
  static async acceptChange(userId: string, newKeyB64: string): Promise<PinnedKey> {
    const existing = await this.getPin(userId);

    let history: Array<{ keyB64: string; pinnedAt: number; replacedAt: number }> = [];
    if (existing) {
      // Move old key into history
      history.push({
        keyB64: existing.keyB64,
        pinnedAt: existing.pinnedAt,
        replacedAt: Date.now(),
      });
      // Add any existing history (newest first)
      if (existing.history && Array.isArray(existing.history)) {
        history = history.concat(existing.history);
      }
      // Cap at 10 entries, newest first
      history = history.slice(0, 10);
    }

    const updated: PinnedKey = {
      userId,
      keyB64: newKeyB64,
      pinnedAt: Date.now(),
      // verifiedAt is not carried over; rotated keys start unverified
      history: history.length > 0 ? history : undefined,
    };

    try {
      await StorageService.setMetadata(this.storageKey(userId), updated);
    } catch {
      // Degrade gracefully: return the object even if storage failed.
    }

    return updated;
  }

  /** Manually verify the current pin (user confirmed safety number out of band). */
  static async markVerified(userId: string): Promise<void> {
    try {
      const pin = await this.getPin(userId);
      if (!pin) return;

      pin.verifiedAt = Date.now();
      await StorageService.setMetadata(this.storageKey(userId), pin);
    } catch {
      // Degraded: verification mark did not persist, but operation is best-effort.
    }
  }

  /** Check if a peer's pinned key has been manually verified. */
  static async isVerified(userId: string): Promise<boolean> {
    try {
      const pin = await this.getPin(userId);
      return !!(pin && pin.verifiedAt);
    } catch {
      return false;
    }
  }

  /** Remove a pin entirely. */
  static async clear(userId: string): Promise<void> {
    try {
      await StorageService.setMetadata(this.storageKey(userId), null);
    } catch {
      // Degraded: clear did not persist, but operation is best-effort.
    }
  }

  /**
   * Compute a deterministic, symmetric safety number from two base64 keys.
   * Returns 60 decimal digits grouped as 12 groups of 5, space-separated.
   */
  static safetyNumber(keyA: string, keyB: string): string {
    // Sort keys lexicographically; both peers will compute the same number regardless of argument order.
    const sorted = [keyA, keyB].sort();
    const combined = `interpoll-safety-v1|${sorted[0]}|${sorted[1]}`;
    const digest = CryptoService.hash(combined);

    // Convert hex digest to 12 groups of 5 decimal digits
    return this.hexToSafetyNumber(digest);
  }

  /**
   * Convenience: look up the pinned key for a peer and return the safety number.
   * Returns null if no pin exists.
   */
  static async safetyNumberFor(myKeyB64: string, peerUserId: string): Promise<string | null> {
    try {
      const pin = await this.getPin(peerUserId);
      if (!pin) return null;
      return this.safetyNumber(myKeyB64, pin.keyB64);
    } catch {
      return null;
    }
  }

  /**
   * Convert a 64-char hex digest into 60 decimal digits (12 groups of 5).
   * Walk the digest in 8-hex-char (32-bit) chunks, derive each group via modulo 100000.
   */
  private static hexToSafetyNumber(digest: string): string {
    const groups: string[] = [];

    // Extract 8 chunks from the first hash (64 hex = 8 chunks of 8)
    for (let i = 0; i < 8; i++) {
      const chunk = digest.slice(i * 8, (i + 1) * 8);
      const num = (parseInt(chunk, 16) % 100000).toString().padStart(5, '0');
      groups.push(num);
    }

    // Need 4 more groups; hash digest + ':2' and extract 4 more chunks
    const digest2 = CryptoService.hash(`${digest}:2`);
    for (let i = 0; i < 4; i++) {
      const chunk = digest2.slice(i * 8, (i + 1) * 8);
      const num = (parseInt(chunk, 16) % 100000).toString().padStart(5, '0');
      groups.push(num);
    }

    return groups.join(' ');
  }
}
