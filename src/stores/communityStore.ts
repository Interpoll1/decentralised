// src/stores/communityStore.ts
import { defineStore } from 'pinia';
import { ref } from 'vue';
import { Community, CommunityService } from '../services/communityService';
import { useChainStore } from './chainStore';

export const useCommunityStore = defineStore('community', () => {
  const communities = ref<Community[]>([]);
  const currentCommunity = ref<Community | null>(null);
  const isLoading = ref(false);
  const joinedCommunities = ref<Set<string>>(new Set());

  async function loadCommunities() {
    isLoading.value = true;
    communities.value = [];
    
    try {
      const seen = new Set<string>();
      let subscriptionActive = true;
      
      // Subscribe to real-time updates
      CommunityService.subscribeToCommunities((community) => {
        // Prevent duplicates
        if (!seen.has(community.id)) {
          seen.add(community.id);
          communities.value.push(community);
        } else {
          // Update existing community
          const index = communities.value.findIndex(c => c.id === community.id);
          if (index >= 0) {
            // Only update if data actually changed
            const existing = communities.value[index];
            if (JSON.stringify(existing) !== JSON.stringify(community)) {
              communities.value[index] = community;
            }
          }
        }
      });
      
      // Also do a one-time fetch for initial load
      setTimeout(async () => {
        if (!subscriptionActive) return;
        
        const allCommunities = await CommunityService.getAllCommunities();
        
        // Merge with existing
        allCommunities.forEach(community => {
          if (!seen.has(community.id)) {
            seen.add(community.id);
            communities.value.push(community);
          }
        });
        
        isLoading.value = false;
      }, 1000); // Wait 1 second for Gun to sync (faster)
      
    } catch (error) {
      console.error('Error loading communities:', error);
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
      const community = await CommunityService.createCommunity({
        ...data,
        creatorId: 'current-user-id',
      });

      // Record on blockchain
      const chainStore = useChainStore();
      await chainStore.addAction('community-create', {
        communityId: community.id,
        name: community.name,
        displayName: community.displayName,
        timestamp: community.createdAt,
      }, community.displayName);

      // Add to local array immediately
      const exists = communities.value.find(c => c.id === community.id);
      if (!exists) {
        communities.value.unshift(community);
      }

      return community;
    } catch (error) {
      console.error('Error creating community:', error);
      throw error;
    }
  }

  // Select community
  async function selectCommunity(communityId: string) {
    try {
      // First check if we have it locally
      const local = communities.value.find(c => c.id === communityId);
      if (local) {
        currentCommunity.value = local;
        return;
      }
      
      // Otherwise fetch from Gun
      currentCommunity.value = await CommunityService.getCommunity(communityId);
      
      if (currentCommunity.value) {
        // Add to communities array if not present
        const exists = communities.value.find(c => c.id === communityId);
        if (!exists) {
          communities.value.push(currentCommunity.value);
        }
      }
    } catch (error) {
      console.error('Error selecting community:', error);
    }
  }

  // Join community
  async function joinCommunity(communityId: string) {
    try {
      await CommunityService.joinCommunity(communityId);
      joinedCommunities.value.add(communityId);
      
      // Save to local storage
      localStorage.setItem('joined-communities', JSON.stringify(Array.from(joinedCommunities.value)));

      // Refresh the community to get updated member count
      await selectCommunity(communityId);
    } catch (error) {
      console.error('Error joining community:', error);
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
      }
    } catch (error) {
      console.error('Error loading joined communities:', error);
    }
  }

  // Refresh communities (force reload)
  async function refreshCommunities() {
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