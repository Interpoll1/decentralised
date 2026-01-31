// src/services/storageManager.ts
// Manages storage limits and prunes old data

import { StorageService } from './storageService';

export class StorageManager {
  // Storage limits
  private static readonly MAX_POLLS = 100; // Keep last 100 polls
  private static readonly MAX_BLOCKS = 1000; // Keep last 1000 blocks
  private static readonly MAX_RECEIPTS = 500; // Keep last 500 receipts
  private static readonly POLL_RETENTION_DAYS = 30; // Delete polls older than 30 days
  
  // Check storage usage
  static async getStorageInfo() {
    if (!navigator.storage || !navigator.storage.estimate) {
      return null;
    }
    
    const estimate = await navigator.storage.estimate();
    return {
      usage: estimate.usage || 0,
      quota: estimate.quota || 0,
      usagePercent: ((estimate.usage || 0) / (estimate.quota || 1)) * 100,
      usageMB: ((estimate.usage || 0) / (1024 * 1024)).toFixed(2),
      quotaMB: ((estimate.quota || 0) / (1024 * 1024)).toFixed(2)
    };
  }
  
  // Prune old data automatically
  static async pruneOldData(): Promise<{
    pollsDeleted: number;
    blocksDeleted: number;
    receiptsDeleted: number;
  }> {
    console.log('🧹 Starting storage cleanup...');
    
    let pollsDeleted = 0;
    let blocksDeleted = 0;
    let receiptsDeleted = 0;
    
    // Prune old polls
    const allPolls = await StorageService.getAllPolls();
    if (allPolls.length > this.MAX_POLLS) {
      // Sort by date, keep newest
      allPolls.sort((a, b) => b.createdAt - a.createdAt);
      const pollsToDelete = allPolls.slice(this.MAX_POLLS);
      
      for (const poll of pollsToDelete) {
        // Delete poll and associated votes
        const db = await StorageService.getDB();
        await db.delete('polls', poll.id);
        
        // Delete associated votes
        const votes = await StorageService.getVotesByPoll(poll.id);
        const tx = db.transaction('votes', 'readwrite');
        for (const vote of votes) {
          await tx.store.delete(vote.timestamp);
        }
        await tx.done;
        
        pollsDeleted++;
      }
    }
    
    // Prune old polls by age
    const cutoffDate = Date.now() - (this.POLL_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const oldPolls = allPolls.filter(p => p.createdAt < cutoffDate);
    
    for (const poll of oldPolls) {
      const db = await StorageService.getDB();
      await db.delete('polls', poll.id);
      pollsDeleted++;
    }
    
    // Note: We DON'T prune blocks as they're needed for chain integrity
    // But we could archive them to a separate compressed storage
    
    const info = await this.getStorageInfo();
    console.log(`Cleanup complete: ${pollsDeleted} polls, ${blocksDeleted} blocks, ${receiptsDeleted} receipts deleted`);
    if (info) {
      console.log(`Storage: ${info.usageMB}MB / ${info.quotaMB}MB (${info.usagePercent.toFixed(1)}%)`);
    }
    
    return { pollsDeleted, blocksDeleted, receiptsDeleted };
  }
  
  // Check if we need to prune
  static async checkAndPrune(): Promise<void> {
    const info = await this.getStorageInfo();
    
    if (info && info.usagePercent > 80) {
      console.warn('Storage usage high, running cleanup...');
      await this.pruneOldData();
    }
  }
  
  // Export data for backup
  static async exportAllData() {
    const polls = await StorageService.getAllPolls();
    const blocks = await StorageService.getAllBlocks();
    const receipts = await StorageService.getAllReceipts();
    
    return {
      version: '1.0',
      exportDate: Date.now(),
      polls,
      blocks,
      receipts
    };
  }
  
  // Import data from backup
  static async importData(data: any) {
    if (!data.version || !data.polls || !data.blocks) {
      throw new Error('Invalid backup data');
    }
    
    // Import polls
    for (const poll of data.polls) {
      await StorageService.savePoll(poll);
    }
    
    // Import blocks
    for (const block of data.blocks) {
      await StorageService.saveBlock(block);
    }
    
    // Import receipts
    if (data.receipts) {
      for (const receipt of data.receipts) {
        await StorageService.saveReceipt(receipt);
      }
    }
    
    console.log('Data imported successfully');
  }
}