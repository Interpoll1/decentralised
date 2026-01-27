// src/services/communityService.ts
import { GunService } from './gunService';

export interface Community {
  id: string;
  name: string;
  displayName: string;
  description: string;
  rules: string[];
  creatorId: string;
  createdAt: number;
  memberCount: number;
  postCount?: number; // Optional for backwards compatibility
}

export class CommunityService {
  // Create a new community
  static async createCommunity(data: {
    name: string;
    displayName: string;
    description: string;
    rules: string[];
    creatorId: string;
  }): Promise<Community> {
    const gun = GunService.getGun();
    
    const community: Community = {
      id: `c-${data.name}`,
      name: data.name,
      displayName: data.displayName,
      description: data.description,
      rules: data.rules,
      creatorId: data.creatorId,
      createdAt: Date.now(),
      memberCount: 1,
      postCount: 0,
    };

    console.log('📝 Creating community:', community.name);

    try {
      // Save to both individual path AND communities collection
      console.log('📝 Saving community to Gun:', community.id);
      
      // 1. Save to individual path for direct access
      await GunService.put(community.id, community);
      
      // 2. Add reference to communities collection (THIS IS KEY!)
      await new Promise<void>((resolve, reject) => {
        gun.get('communities').get(community.id).put(community, (ack: any) => {
          if (ack.err) {
            console.error('❌ Error adding to communities collection:', ack.err);
            reject(ack.err);
          } else {
            console.log('✅ Community added to collection');
            resolve();
          }
        });
      });
      
      console.log('✅ Community saved to Gun');
      return community;
    } catch (error) {
      console.error('❌ Error saving community:', error);
      throw error;
    }
  }

  // Subscribe to all communities
  static subscribeToCommunities(callback: (community: Community) => void): void {
    const gun = GunService.getGun();
    
    console.log('📡 Subscribing to communities...');
    
    try {
      // Subscribe to the 'communities' collection
      gun.get('communities').map().on((data: any, key: string) => {
        // Filter out Gun metadata and ensure we have valid data
        if (data && data.name && data.id && typeof data === 'object') {
          // Avoid processing Gun's internal metadata
          if (!key.startsWith('_') && data._ === undefined) {
            console.log('📥 Community received from Gun:', data.name, 'Key:', key);
            callback(data as Community);
          } else if (data.name && data.id) {
            // Sometimes Gun includes metadata, extract clean data
            const cleanData: Community = {
              id: data.id || '',
              name: data.name || '',
              displayName: data.displayName || data.name || '',
              description: data.description || '',
              rules: Array.isArray(data.rules) ? data.rules : [],
              creatorId: data.creatorId || '',
              createdAt: data.createdAt || Date.now(),
              memberCount: data.memberCount || 1,
              postCount: data.postCount || 0,
            };
            console.log('📥 Community received (cleaned):', cleanData.name);
            callback(cleanData);
          }
        }
      });
      
      console.log('✅ Community subscription active');
    } catch (error) {
      console.error('❌ Error subscribing to communities:', error);
    }
  }

  // Get a specific community
  static async getCommunity(communityId: string): Promise<Community | null> {
    console.log('🔍 Fetching community:', communityId);
    
    try {
      // Try getting from communities collection first
      const data = await new Promise<any>((resolve) => {
        const gun = GunService.getGun();
        let resolved = false;
        
        // Try from collection
        gun.get('communities').get(communityId).once((collectionData: any) => {
          if (!resolved && collectionData && collectionData.name) {
            resolved = true;
            resolve(collectionData);
          }
        });
        
        // Fallback to direct path after 1 second
        setTimeout(() => {
          if (!resolved) {
            gun.get(communityId).once((directData: any) => {
              if (!resolved) {
                resolved = true;
                resolve(directData);
              }
            });
          }
        }, 1000);
        
        // Timeout after 3 seconds
        setTimeout(() => {
          if (!resolved) {
            resolved = true;
            resolve(null);
          }
        }, 3000);
      });

      if (data && data.name) {
        console.log('✅ Community found:', data.name);
        return {
          id: data.id || '',
          name: data.name || '',
          displayName: data.displayName || data.name || '',
          description: data.description || '',
          rules: Array.isArray(data.rules) ? data.rules : [],
          creatorId: data.creatorId || '',
          createdAt: data.createdAt || Date.now(),
          memberCount: data.memberCount || 1,
          postCount: data.postCount || 0,
        };
      }

      console.log('⚠️ Community not found:', communityId);
      return null;
    } catch (error) {
      console.error('❌ Error fetching community:', error);
      return null;
    }
  }

  // Join a community
  static async joinCommunity(communityId: string): Promise<void> {
    const gun = GunService.getGun();
    
    try {
      console.log('🤝 Joining community:', communityId);
      
      // Get current community
      const community = await this.getCommunity(communityId);
      if (!community) {
        throw new Error('Community not found');
      }

      // Increment member count
      const updatedCommunity = {
        ...community,
        memberCount: (community.memberCount || 1) + 1,
      };

      // Update both paths
      await GunService.put(communityId, updatedCommunity);
      gun.get('communities').get(communityId).put(updatedCommunity);
      
      console.log('✅ Joined community successfully');
    } catch (error) {
      console.error('❌ Error joining community:', error);
      throw error;
    }
  }

  // Get all communities (alternative to subscription)
  static async getAllCommunities(): Promise<Community[]> {
    const gun = GunService.getGun();
    const communities: Community[] = [];
    
    return new Promise((resolve) => {
      console.log('📡 Fetching all communities...');
      
      let timeout: NodeJS.Timeout;
      const seen = new Set<string>();
      
      gun.get('communities').map().once((data: any, key: string) => {
        if (data && data.name && data.id && !seen.has(data.id)) {
          seen.add(data.id);
          
          const community: Community = {
            id: data.id || '',
            name: data.name || '',
            displayName: data.displayName || data.name || '',
            description: data.description || '',
            rules: Array.isArray(data.rules) ? data.rules : [],
            creatorId: data.creatorId || '',
            createdAt: data.createdAt || Date.now(),
            memberCount: data.memberCount || 1,
            postCount: data.postCount || 0,
          };
          
          communities.push(community);
          console.log('📥 Loaded community:', community.name);
        }
      });
      
      // Wait 2 seconds for Gun to sync
      timeout = setTimeout(() => {
        console.log(`✅ Loaded ${communities.length} communities`);
        resolve(communities);
      }, 2000);
    });
  }
}