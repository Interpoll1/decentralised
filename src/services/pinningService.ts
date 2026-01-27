// src/services/pinningService.ts
import { StorageService } from './storageService';
import { IPFSService } from './ipfsService';

export interface PinPolicy {
  // Always pin
  myPosts: boolean;
  myUpvotes: boolean;
  myCommunities: boolean;
  
  // Temporary cache
  recentPosts: number; // Keep last N posts
  popularPosts: boolean; // Pin posts with >100 upvotes
  
  // Storage limits
  maxStorageMB: number;
  autoPruneOldContent: boolean;
}

export class PinningService {
  private static readonly DEFAULT_POLICY: PinPolicy = {
    myPosts: true,
    myUpvotes: true,
    myCommunities: true,
    recentPosts: 50,
    popularPosts: true,
    maxStorageMB: 100,
    autoPruneOldContent: true
  };

  // Get user's pinning policy
  static async getPolicy(): Promise<PinPolicy> {
    const policy = await StorageService.getMetadata('pin-policy');
    return policy || this.DEFAULT_POLICY;
  }

  // Update policy
  static async setPolicy(policy: Partial<PinPolicy>) {
    const current = await this.getPolicy();
    const updated = { ...current, ...policy };
    await StorageService.setMetadata('pin-policy', updated);
  }

  // Check if should pin this content
  static async shouldPin(contentType: 'post' | 'image', contentId: string, metadata: any): Promise<boolean> {
    const policy = await this.getPolicy();
    
    // Always pin user's own content
    if (metadata.isOwn) return true;
    
    // Pin based on policy
    if (contentType === 'post') {
      if (metadata.isUpvoted && policy.myUpvotes) return true;
      if (metadata.score > 100 && policy.popularPosts) return true;
    }
    
    return false;
  }

  // Auto-prune old content
  static async pruneOldContent() {
    const policy = await this.getPolicy();
    if (!policy.autoPruneOldContent) return;

    // Get storage usage
    const usage = await navigator.storage.estimate();
    const usageMB = (usage.usage || 0) / (1024 * 1024);

    if (usageMB < policy.maxStorageMB) return;

    console.log('🧹 Storage limit reached, pruning...');
    
    // Unpin old cached posts (keep only recent N)
    // TODO: Implement pruning logic
  }

  // Get storage stats
  static async getStorageStats() {
    const estimate = await navigator.storage.estimate();
    const pinnedContent = await IPFSService.listPinned();
    
    return {
      used: (estimate.usage || 0) / (1024 * 1024),
      quota: (estimate.quota || 0) / (1024 * 1024),
      pinnedItems: pinnedContent.length
    };
  }
}