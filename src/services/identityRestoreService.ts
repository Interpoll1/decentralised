// src/services/identityRestoreService.ts
// Restore the device identity from a 24-word recovery phrase (see KeyService.exportMnemonic).
import { CryptoService } from './cryptoService';
import { KeyService } from './keyService';
import { StorageService } from './storageService';

const PROFILE_META_KEY = 'user-profile-v2';

export class IdentityRestoreService {
  /** Returns an error message, or null if the phrase is a valid 24-word recovery phrase. */
  static validate(phrase: string): string | null {
    const words = phrase.trim().split(/\s+/).filter(Boolean);
    if (words.length !== 24) return `Expected 24 words, got ${words.length}.`;
    try { CryptoService.mnemonicToPrivateKey(phrase); } catch { return 'That is not a valid recovery phrase — check for typos.'; }
    return null;
  }

  /**
   * Replace this device's key with the one encoded in `phrase`. The locally cached profile
   * belonged to the old key, so it is dropped; the next load re-fetches the profile for the
   * restored public key from the network (username, bio, karma come back with it).
   * Callers should reload the app afterwards so no in-memory state keeps the old identity.
   */
  static async restore(phrase: string): Promise<{ publicKey: string }> {
    const err = this.validate(phrase);
    if (err) throw new Error(err);
    const pair = await KeyService.importFromMnemonic(phrase);
    await StorageService.setMetadata(PROFILE_META_KEY, null);
    return { publicKey: pair.publicKey };
  }
}
