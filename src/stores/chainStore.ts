// src/stores/chainStore.ts
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { ChainBlock, Vote, Receipt } from '../types/chain';
import { ChainService } from '../services/chainService';
import { StorageService } from '../services/storageService';
import { BroadcastService } from '../services/broadcastService';
import { WebSocketService } from '../services/websocketService';
import { AuditService } from '../services/auditService';

export const useChainStore = defineStore('chain', () => {
  const blocks = ref<ChainBlock[]>([]);
  const isInitialized = ref(false);
  const isValidating = ref(false);
  const chainValid = ref(true);
  const isWebSocketConnected = ref(false);

  const latestBlock = computed(() =>
    blocks.value.length > 0 ? blocks.value[blocks.value.length - 1] : null
  );

  const chainHead = computed(() => {
    if (!latestBlock.value) return null;
    return {
      hash: latestBlock.value.currentHash,
      index: latestBlock.value.index,
    };
  });

  async function initialize() {
    if (isInitialized.value) return;

    BroadcastService.initialize();
    WebSocketService.initialize();

    await ChainService.initializeChain();
    await loadBlocks();

    setupSyncListeners();

    setInterval(() => {
      isWebSocketConnected.value = WebSocketService.getConnectionStatus();
    }, 1000);

    isInitialized.value = true;
  }

  async function loadBlocks() {
    blocks.value = await StorageService.getAllBlocks();
    blocks.value.sort((a, b) => a.index - b.index);
  }

  function setupSyncListeners() {
    // BroadcastChannel
    BroadcastService.subscribe('new-block', handleNewBlock);
    BroadcastService.subscribe('request-sync', handleSyncRequest);
    BroadcastService.subscribe('sync-response', handleSyncResponse);

    // WebSocket
    WebSocketService.subscribe('new-block', handleNewBlock);
    WebSocketService.subscribe('request-sync', handleSyncRequest);
    WebSocketService.subscribe('sync-response', handleSyncResponse);
  }

  async function handleNewBlock(block: ChainBlock) {
    const exists = blocks.value.find((b) => b.index === block.index);
    if (exists) return;

    if (blocks.value.length > 0 && block.index === blocks.value.length) {
      const previousBlock = blocks.value[blocks.value.length - 1];
      if (ChainService.validateBlock(block, previousBlock)) {
        await StorageService.saveBlock(block);
        blocks.value.push(block);
      }
    } else if (block.index === 0) {
      await StorageService.saveBlock(block);
      blocks.value.push(block);
    }
  }

  async function handleSyncRequest(data: any) {
    const allBlocks = await StorageService.getAllBlocks();

    const response = {
      blocks: allBlocks,
      peerId: BroadcastService.getPeerId(),
    };

    BroadcastService.broadcast('sync-response', response);
    WebSocketService.broadcast('sync-response', response);
  }

  async function handleSyncResponse(data: any) {
    if (!data?.blocks?.length) return;

    let addedCount = 0;

    for (const block of data.blocks) {
      const exists = blocks.value.find((b) => b.index === block.index);
      if (!exists) {
        await StorageService.saveBlock(block);
        blocks.value.push(block);
        addedCount++;
      }
    }

    if (addedCount > 0) {
      blocks.value.sort((a, b) => a.index - b.index);
    }
  }

  async function addVote(vote: Vote): Promise<Receipt> {
    const { block, receipt: mnemonic } = await ChainService.addVote(vote);

    blocks.value.push(block);

    BroadcastService.broadcast('new-block', block);
    WebSocketService.broadcast('new-block', block);

    const receipt: Receipt = {
      blockIndex: block.index,
      voteHash: block.voteHash,
      chainHeadHash: block.currentHash,
      mnemonic,
      timestamp: block.timestamp,
      pollId: vote.pollId,
    };

    await StorageService.saveReceipt(receipt);

    // Mirror receipt to backend for independent audit log
    AuditService.logReceipt('vote', {
      ...receipt,
      deviceId: vote.deviceId,
    });

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

  async function resetChain() {
    await ChainService.resetChain();
    await loadBlocks();
    chainValid.value = true;
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
    syncBlocks,
    resetChain,
  };
});