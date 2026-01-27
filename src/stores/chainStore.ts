import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { ChainBlock, Vote, Receipt } from '../types/chain';
import { ChainService } from '../services/chainService';
import { StorageService } from '../services/storageService';
import { BroadcastService } from '../services/broadcastService';
import { WebSocketService } from '../services/websocketService';

export const useChainStore = defineStore('chain', () => {
  const blocks = ref<ChainBlock[]>([]);
  const isInitialized = ref(false);
  const isValidating = ref(false);
  const chainValid = ref(true);
  const isWebSocketConnected = ref(false);

  const latestBlock = computed(() => {
    return blocks.value.length > 0 
      ? blocks.value[blocks.value.length - 1] 
      : null;
  });

  const chainHead = computed(() => {
    if (!latestBlock.value) return null;
    return {
      hash: latestBlock.value.currentHash,
      index: latestBlock.value.index
    };
  });

  async function initialize() {
    if (isInitialized.value) return;

    console.log('🚀 Initializing chain with hybrid P2P sync...');

    // Initialize BroadcastChannel (same browser)
    BroadcastService.initialize();

    // Initialize WebSocket (cross-browser/device)
    WebSocketService.initialize();

    // Initialize chain
    await ChainService.initializeChain();
    await loadBlocks();

    // Setup sync listeners
    setupSyncListeners();

    // Monitor WebSocket connection
    setInterval(() => {
      isWebSocketConnected.value = WebSocketService.getConnectionStatus();
    }, 1000);

    isInitialized.value = true;
    console.log('✅ Chain initialized with BroadcastChannel + WebSocket P2P');
  }

  async function loadBlocks() {
    blocks.value = await StorageService.getAllBlocks();
    blocks.value.sort((a, b) => a.index - b.index);
    console.log(`✅ Loaded ${blocks.value.length} blocks from IndexedDB`);
  }

  function setupSyncListeners() {
    // === BroadcastChannel Listeners ===
    BroadcastService.subscribe('new-block', handleNewBlock);
    BroadcastService.subscribe('request-sync', handleSyncRequest);
    BroadcastService.subscribe('sync-response', handleSyncResponse);

    // === WebSocket Listeners ===
    WebSocketService.subscribe('new-block', handleNewBlock);
    WebSocketService.subscribe('request-sync', handleSyncRequest);
    WebSocketService.subscribe('sync-response', handleSyncResponse);
  }

  async function handleNewBlock(block: ChainBlock) {
    console.log(`📥 Received block #${block.index} via network`);
    
    const exists = blocks.value.find(b => b.index === block.index);
    if (!exists) {
      // Validate before adding
      if (blocks.value.length > 0 && block.index === blocks.value.length) {
        const previousBlock = blocks.value[blocks.value.length - 1];
        if (ChainService.validateBlock(block, previousBlock)) {
          await StorageService.saveBlock(block);
          blocks.value.push(block);
          console.log(`✅ Block #${block.index} added and validated`);
        } else {
          console.error(`❌ Block #${block.index} validation failed`);
        }
      } else if (block.index === 0) {
        await StorageService.saveBlock(block);
        blocks.value.push(block);
      }
    }
  }

  async function handleSyncRequest(data: any) {
    const allBlocks = await StorageService.getAllBlocks();
    
    const response = {
      blocks: allBlocks,
      peerId: BroadcastService.getPeerId()
    };
    
    BroadcastService.broadcast('sync-response', response);
    WebSocketService.broadcast('sync-response', response);
  }

  async function handleSyncResponse(data: any) {
    if (data.blocks && data.blocks.length > 0) {
      console.log(`📥 Received ${data.blocks.length} blocks from sync`);
      
      let addedCount = 0;
      
      for (const block of data.blocks) {
        const exists = blocks.value.find(b => b.index === block.index);
        if (!exists) {
          await StorageService.saveBlock(block);
          blocks.value.push(block);
          addedCount++;
        }
      }
      
      if (addedCount > 0) {
        blocks.value.sort((a, b) => a.index - b.index);
        console.log(`✅ Added ${addedCount} new blocks`);
      }
    }
  }

  async function addVote(vote: Vote): Promise<Receipt> {
    const { block, receipt: mnemonic } = await ChainService.addVote(vote);
    
    blocks.value.push(block);

    // Broadcast to all peers
    BroadcastService.broadcast('new-block', block);
    WebSocketService.broadcast('new-block', block);

    const receipt: Receipt = {
      blockIndex: block.index,
      voteHash: block.voteHash,
      chainHeadHash: block.currentHash,
      mnemonic,
      timestamp: block.timestamp,
      pollId: vote.pollId
    };

    await StorageService.saveReceipt(receipt);

    return receipt;
  }

  async function validateChain() {
    isValidating.value = true;
    chainValid.value = await ChainService.validateChain();
    isValidating.value = false;
    return chainValid.value;
  }

  async function checkForDowngrade(remoteHash: string, remoteIndex: number): Promise<boolean> {
    return await ChainService.detectDowngrade(remoteHash, remoteIndex);
  }

  async function syncBlocks() {
    await loadBlocks();
  }

  return {
    blocks,
    latestBlock,
    chainHead,
    isInitialized,
    isValidating,
    chainValid,
    isWebSocketConnected,
    initialize,
    loadBlocks,
    addVote,
    validateChain,
    checkForDowngrade,
    syncBlocks
  };
});