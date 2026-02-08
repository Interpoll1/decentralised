// src/stores/chainStore.ts
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { ChainBlock, Vote, Receipt } from '../types/chain';
import { ChainService } from '../services/chainService';
import { CryptoService } from '../services/cryptoService';
import { StorageService } from '../services/storageService';
import { BroadcastService } from '../services/broadcastService';
import { WebSocketService } from '../services/websocketService';
import { AuditService } from '../services/auditService';
import { EventService } from '../services/eventService';

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

    WebSocketService.onStatusChange(({ connected }) => {
      isWebSocketConnected.value = connected;
    });

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

    // Signed event verification
    BroadcastService.subscribe('new-event', handleNewEvent);
    WebSocketService.subscribe('new-event', handleNewEvent);
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
      // Genesis block: verify hash integrity before accepting
      const calculatedHash = CryptoService.hashBlock(block);
      if (block.currentHash === calculatedHash) {
        await StorageService.saveBlock(block);
        blocks.value.push(block);
      }
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

    // Sort incoming blocks by index for sequential validation
    const sorted = [...data.blocks].sort((a: ChainBlock, b: ChainBlock) => a.index - b.index);
    let addedCount = 0;

    for (const block of sorted) {
      const exists = blocks.value.find((b) => b.index === block.index);
      if (exists) continue;

      // Find the previous block for validation
      const previousBlock = blocks.value.find((b) => b.index === block.index - 1);

      if (block.index === 0) {
        // Genesis block: verify hash integrity
        const calculatedHash = CryptoService.hashBlock(block);
        if (block.currentHash === calculatedHash) {
          await StorageService.saveBlock(block);
          blocks.value.push(block);
          addedCount++;
        }
      } else if (previousBlock && ChainService.validateBlock(block, previousBlock)) {
        await StorageService.saveBlock(block);
        blocks.value.push(block);
        addedCount++;
      }
    }

    if (addedCount > 0) {
      blocks.value.sort((a, b) => a.index - b.index);
    }
  }

  async function handleNewEvent(eventData: any) {
    // Verify the Nostr event signature before accepting
    if (!EventService.verifyEvent(eventData)) {
      console.warn('Rejected event with invalid signature:', eventData.id);
      return;
    }

    console.log(
      'Verified event: kind=%d from pubkey=%s',
      eventData.kind,
      eventData.pubkey?.substring(0, 16),
    );
  }

  async function addVote(vote: Vote): Promise<Receipt> {
    // Create signed vote event
    const voteEvent = await EventService.createVoteEvent({
      pollId: vote.pollId,
      choice: vote.choice,
      deviceId: vote.deviceId,
    });

    // Add vote to blockchain (signed with real Schnorr key)
    const { block, receipt: mnemonic } = await ChainService.addVote(vote);

    blocks.value.push(block);

    // Broadcast both the block and the signed event
    BroadcastService.broadcast('new-block', block);
    WebSocketService.broadcast('new-block', block);
    BroadcastService.broadcast('new-event', voteEvent);
    WebSocketService.broadcast('new-event', voteEvent);

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
