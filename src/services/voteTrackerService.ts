// src/services/voteTrackerService.ts
// Prevents same device from voting multiple times on same poll

import { StorageService } from './storageService';

export interface VoteRecord {
  pollId: string;
  deviceId: string;
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
  
  // Hash the fingerprint
  private static async hashFingerprint(data: string): Promise<string> {
    const encoder = new TextEncoder();
    const dataBuffer = encoder.encode(data);
    const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }
  
  // Check if device has already voted on this poll
  static async hasVoted(pollId: string): Promise<boolean> {
    const deviceId = await this.getDeviceId();
    const voteRecords = await StorageService.getMetadata('vote-records') || [];
    
    return voteRecords.some((record: VoteRecord) => 
      record.pollId === pollId && record.deviceId === deviceId
    );
  }
  
  // Record that this device voted on this poll
  static async recordVote(pollId: string, blockIndex: number): Promise<void> {
    const deviceId = await this.getDeviceId();
    const voteRecords = await StorageService.getMetadata('vote-records') || [];
    
    const newRecord: VoteRecord = {
      pollId,
      deviceId,
      timestamp: Date.now(),
      blockIndex
    };
    
    voteRecords.push(newRecord);
    await StorageService.setMetadata('vote-records', voteRecords);
  }
  
  // Get all votes by this device
  static async getMyVotes(): Promise<VoteRecord[]> {
    const deviceId = await this.getDeviceId();
    const voteRecords = await StorageService.getMetadata('vote-records') || [];
    
    return voteRecords.filter((record: VoteRecord) => 
      record.deviceId === deviceId
    );
  }
  
  // Clear vote records (admin/testing only)
  static async clearVoteRecords(): Promise<void> {
    await StorageService.setMetadata('vote-records', []);
  }
}