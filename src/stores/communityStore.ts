// src/stores/communityStore.ts
import { defineStore } from 'pinia';
import { ref } from 'vue';
import { Community, CommunityService } from '../services/communityService';

export const useCommunityStore = defineStore('community', () => {
  const communities = ref<Community[]>([]);
  const currentCommunity = ref<Community | null>(null);
  const isLoading = ref(false);
  const joinedCommunities = ref<Set<string>>(new Set());

  // Load all communities using subscription
  async function loadCommunities() {
    isLoading.value = true;
    communities.value = [];
    
    try {
      console.log('📡 Loading communities from GunDB...');
      
      const seen = new Set<string>();
      
      // Subscribe to real-time updates
      CommunityService.subscribeToCommunities((community) => {
        // Prevent duplicates
        if (!seen.has(community.id)) {
          seen.add(community.id);
          
          // Check if already exists in array
          const existingIndex = communities.value.findIndex(c => c.id === community.id);
          
          if (existingIndex >= 0) {
            // Update existing
            communities.value[existingIndex] = community;
            console.log('🔄 Community updated:', community.name);
          } else {
            // Add new
            communities.value.push(community);
            console.log('📥 Community loaded:', community.name);
          }
        }
      });
      
      // Also do a one-time fetch for initial load
      setTimeout(async () => {
        const allCommunities = await CommunityService.getAllCommunities();
        
        // Merge with existing
        allCommunities.forEach(community => {
          if (!seen.has(community.id)) {
            seen.add(community.id);
            communities.value.push(community);
            console.log('📥 Community loaded (fetch):', community.name);
          }
        });
        
        isLoading.value = false;
        console.log(`✅ Loaded ${communities.value.length} communities`);
        
        if (communities.value.length === 0) {
          console.log('ℹ️ No communities found. Create one to get started!');
        }
      }, 2000); // Wait 2 seconds for Gun to sync
      
    } catch (error) {
      console.error('❌ Error loading communities:', error);
      isLoading.value = false;
    }
  }

  // Create new community
  async function createCommunity(data: {
    name: string;
    displayName: string;
    description: string;
    rules: string[];
  }) {
    try {
      console.log('📝 Creating community:', data.name);
      
      const community = await CommunityService.createCommunity({
        ...data,
        creatorId: 'current-user-id', // TODO: Get from userStore
      });
      
      // Add to local array immediately
      const exists = communities.value.find(c => c.id === community.id);
      if (!exists) {
        communities.value.unshift(community);
      }
      
      console.log('✅ Community created:', community.name);
      
      return community;
    } catch (error) {
      console.error('❌ Error creating community:', error);
      throw error;
    }
  }

  // Select community
  async function selectCommunity(communityId: string) {
    try {
      console.log('🔍 Selecting community:', communityId);
      
      // First check if we have it locally
      const local = communities.value.find(c => c.id === communityId);
      if (local) {
        currentCommunity.value = local;
        console.log('✅ Community selected (from cache):', local.name);
        return;
      }
      
      // Otherwise fetch from Gun
      currentCommunity.value = await CommunityService.getCommunity(communityId);
      
      if (currentCommunity.value) {
        console.log('✅ Community selected:', currentCommunity.value.name);
        
        // Add to communities array if not present
        const exists = communities.value.find(c => c.id === communityId);
        if (!exists) {
          communities.value.push(currentCommunity.value);
        }
      } else {
        console.log('⚠️ Community not found:', communityId);
      }
    } catch (error) {
      console.error('❌ Error selecting community:', error);
    }
  }

  // Join community
  async function joinCommunity(communityId: string) {
    try {
      console.log('🤝 Joining community:', communityId);
      await CommunityService.joinCommunity(communityId);
      joinedCommunities.value.add(communityId);
      
      // Save to local storage
      localStorage.setItem('joined-communities', JSON.stringify(Array.from(joinedCommunities.value)));
      console.log('✅ Joined community');
      
      // Refresh the community to get updated member count
      await selectCommunity(communityId);
    } catch (error) {
      console.error('❌ Error joining community:', error);
    }
  }

  // Check if joined
  function isJoined(communityId: string): boolean {
    return joinedCommunities.value.has(communityId);
  }

  // Load joined communities from storage
  function loadJoinedCommunities() {
    try {
      const stored = localStorage.getItem('joined-communities');
      if (stored) {
        const joined = JSON.parse(stored);
        joinedCommunities.value = new Set(joined);
        console.log(`✅ Loaded ${joined.length} joined communities from storage`);
      }
    } catch (error) {
      console.error('Error loading joined communities:', error);
    }
  }

  // Refresh communities (force reload)
  async function refreshCommunities() {
    console.log('🔄 Refreshing communities...');
    communities.value = [];
    await loadCommunities();
  }

  // Initialize
  loadJoinedCommunities();

  return {
    communities,
    currentCommunity,
    isLoading,
    joinedCommunities,
    loadCommunities,
    createCommunity,
    selectCommunity,
    joinCommunity,
    isJoined,
    refreshCommunities,
  };
});