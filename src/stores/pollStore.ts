import { defineStore } from 'pinia';
import { ref } from 'vue';
import { Poll, Vote } from '../types/chain';
import { StorageService } from '../services/storageService';
import { BroadcastService } from '../services/broadcastService';
import { WebSocketService } from '../services/websocketService';

export const usePollStore = defineStore('poll', () => {
  const polls = ref<Poll[]>([]);
  const currentPoll = ref<Poll | null>(null);
  const isLoading = ref(false);

  // Load polls from IndexedDB (persistent storage)
  async function loadPolls() {
    isLoading.value = true;
    try {
      polls.value = await StorageService.getAllPolls();
      console.log(`✅ Loaded ${polls.value.length} polls from IndexedDB`);
      
      // Setup sync listeners (both local and remote)
      setupSyncListeners();
      
    } catch (error) {
      console.error('Error loading polls:', error);
    } finally {
      isLoading.value = false;
    }
  }

  // Setup listeners for BOTH BroadcastChannel (same browser) AND WebSocket (cross-browser/device)
  function setupSyncListeners() {
    // === BroadcastChannel Listeners (same browser tabs) ===
    
    BroadcastService.subscribe('new-poll', handleNewPoll);
    BroadcastService.subscribe('request-sync', handleSyncRequest);
    BroadcastService.subscribe('sync-response', handleSyncResponse);

    // === WebSocket Listeners (cross-browser/device) ===
    
    WebSocketService.subscribe('new-poll', handleNewPoll);
    WebSocketService.subscribe('request-sync', handleSyncRequest);
    WebSocketService.subscribe('sync-response', handleSyncResponse);
  }

  // Unified handler for new polls (works for both BroadcastChannel and WebSocket)
  async function handleNewPoll(poll: Poll) {
    console.log('📥 Received new poll:', poll.title);
    
    try {
      const existsInDB = await StorageService.getPoll(poll.id);
      if (!existsInDB) {
        console.log('💾 Saving new poll to IndexedDB');
        await StorageService.savePoll(poll);
        polls.value = await StorageService.getAllPolls();
        console.log(`✅ UI updated with new poll. Total: ${polls.value.length}`);
      } else {
        console.log('⏭️ Poll already exists:', poll.id);
      }
    } catch (error) {
      console.error('Error handling new poll:', error);
    }
  }

  // Unified handler for sync requests
  async function handleSyncRequest(data: any) {
    console.log('📤 Sync requested by peer:', data.peerId);
    
    const allPolls = await StorageService.getAllPolls();
    const allBlocks = await StorageService.getAllBlocks();
    
    const response = {
      polls: allPolls,
      blocks: allBlocks,
      peerId: BroadcastService.getPeerId()
    };
    
    // Respond via both channels
    BroadcastService.broadcast('sync-response', response);
    WebSocketService.broadcast('sync-response', response);
  }

  // Unified handler for sync responses
  async function handleSyncResponse(data: any) {
    if (data.polls && data.polls.length > 0) {
      console.log(`📥 Received ${data.polls.length} polls from sync`);
      
      let savedCount = 0;
      
      for (const poll of data.polls) {
        try {
          const existsInDB = await StorageService.getPoll(poll.id);
          
          if (!existsInDB) {
            console.log(`💾 Saving poll: ${poll.id} - ${poll.title}`);
            await StorageService.savePoll(poll);
            savedCount++;
          }
        } catch (error) {
          console.error(`❌ Error saving poll ${poll.id}:`, error);
        }
      }
      
      if (savedCount > 0) {
        console.log(`✅ Saved ${savedCount} new polls to IndexedDB`);
      }
      
      // Always reload to ensure consistency
      polls.value = await StorageService.getAllPolls();
      console.log(`🔄 UI now shows ${polls.value.length} total polls`);
    }
  }

  // Create poll and broadcast to ALL peers (same browser + remote)
  async function createPoll(poll: Poll) {
    try {
      // Save to IndexedDB first (persistent!)
      await StorageService.savePoll(poll);
      console.log('✅ Poll saved to IndexedDB:', poll.title);
      
      // Add to local UI
      polls.value.unshift(poll);

      // Broadcast to same-browser tabs
      BroadcastService.broadcast('new-poll', poll);
      
      // Broadcast to remote devices/browsers
      WebSocketService.broadcast('new-poll', poll);

      console.log('✅ Poll created and broadcast to all peers');
    } catch (error) {
      console.error('Error creating poll:', error);
      throw error;
    }
  }

  async function selectPoll(pollId: string) {
    currentPoll.value = await StorageService.getPoll(pollId);
  }

  async function getVotesForPoll(pollId: string): Promise<Vote[]> {
    return await StorageService.getVotesByPoll(pollId);
  }

  async function getResults(pollId: string) {
    const votes = await getVotesForPoll(pollId);
    const poll = await StorageService.getPoll(pollId);

    if (!poll) return null;

    const results: Record<string, number> = {};
    poll.options.forEach(option => {
      results[option] = 0;
    });

    votes.forEach(vote => {
      if (results[vote.choice] !== undefined) {
        results[vote.choice]++;
      }
    });

    return {
      poll,
      results,
      totalVotes: votes.length
    };
  }

  async function refreshPolls() {
    await loadPolls();
  }

  return {
    polls,
    currentPoll,
    isLoading,
    loadPolls,
    createPoll,
    selectPoll,
    getVotesForPoll,
    getResults,
    refreshPolls
  };
});