// src/services/voteTrackerService.ts
// Prevents the same identity from voting multiple times on the same poll.
// Identity precedence mirrors the relay's `identityKey` (pollId:pubkey, falling
// back to pollId:deviceId) so client-side and relay-side dedup agree on what
// "the same voter" means.

import { StorageService } from './storageService';
import { KeyService } from './keyService';
import { CryptoService } from './cryptoService';

export interface VoteRecord {
  pollId: string;
  deviceId: string;
  /** Schnorr pubkey of the voter — portable identity, preferred for dedup. Absent on legacy records. */
  pubkey?: string;
  timestamp: number;
  blockIndex: number;
}

export class VoteTrackerService {
  private static DEVICE_ID_KEY = 'device-id';
  
  // Generate unique device fingerprint (persists across sessions)
  static async getDeviceId(): Promise<string> {
    let deviceId = await StorageService.getMetadata(this.DEVICE_ID_KEY);
    
    if (!deviceId) {
      // Create fingerprint from browser info
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.textBaseline = 'top';
        ctx.font = '14px Arial';
        ctx.fillText('fingerprint', 2, 2);
      }
      
      const fingerprint = {
        userAgent: navigator.userAgent,
        language: navigator.language,
        platform: navigator.platform,
        screenResolution: `${screen.width}x${screen.height}`,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        canvasFingerprint: canvas.toDataURL(),
        timestamp: Date.now()
      };
      
      deviceId = await this.hashFingerprint(JSON.stringify(fingerprint));
      await StorageService.setMetadata(this.DEVICE_ID_KEY, deviceId);
    }
    
    return deviceId;
  }
  
  // Hash the fingerprint.
  // `crypto.subtle` is undefined in insecure contexts (plain http://), which
  // mobile browsers enforce strictly — so fall back to the pure-JS noble
  // SHA-256 used for all chain hashing. Both produce identical SHA-256 hex, so
  // a device that once hashed via one path still matches under the other.
  private static async hashFingerprint(data: string): Promise<string> {
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      try {
        const dataBuffer = new TextEncoder().encode(data);
        const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
        return Array.from(new Uint8Array(hashBuffer))
          .map(b => b.toString(16).padStart(2, '0'))
          .join('');
      } catch {
        /* fall through to noble */
      }
    }
    return CryptoService.hash(data);
  }
  
  // Resolve the current voter identity: portable pubkey (preferred) + deviceId (fallback).
  static async getVoterIdentity(): Promise<{ deviceId: string; pubkey?: string }> {
    const deviceId = await this.getDeviceId();
    let pubkey: string | undefined;
    try {
      pubkey = await KeyService.getPublicKeyHex();
    } catch {
      pubkey = undefined;
    }
    return { deviceId, pubkey };
  }

  // Does a stored record identify the same voter as `identity`?
  // Matches on pubkey when both sides have one, else falls back to deviceId —
  // so legacy records (deviceId only) still block re-votes after migration.
  private static recordMatchesIdentity(
    record: VoteRecord,
    identity: { deviceId: string; pubkey?: string },
  ): boolean {
    if (identity.pubkey && record.pubkey && record.pubkey === identity.pubkey) return true;
    return record.deviceId === identity.deviceId;
  }

  // Check if this identity has already voted on this poll
  static async hasVoted(pollId: string): Promise<boolean> {
    const identity = await this.getVoterIdentity();
    const voteRecords: VoteRecord[] = await StorageService.getMetadata('vote-records') || [];

    return voteRecords.some((record) =>
      record.pollId === pollId && this.recordMatchesIdentity(record, identity),
    );
  }

  // Record that this identity voted on this poll
  static async recordVote(pollId: string, blockIndex: number): Promise<void> {
    const { deviceId, pubkey } = await this.getVoterIdentity();
    const voteRecords: VoteRecord[] = await StorageService.getMetadata('vote-records') || [];

    const newRecord: VoteRecord = {
      pollId,
      deviceId,
      pubkey,
      timestamp: Date.now(),
      blockIndex,
    };

    voteRecords.push(newRecord);
    await StorageService.setMetadata('vote-records', voteRecords);
  }

  // Get all votes by this identity
  static async getMyVotes(): Promise<VoteRecord[]> {
    const identity = await this.getVoterIdentity();
    const voteRecords: VoteRecord[] = await StorageService.getMetadata('vote-records') || [];

    return voteRecords.filter((record) => this.recordMatchesIdentity(record, identity));
  }
  
  // Clear vote records (admin/testing only)
  static async clearVoteRecords(): Promise<void> {
    await StorageService.setMetadata('vote-records', []);
  }
}