// src/stores/chainStore.ts
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { ChainBlock, Vote, Receipt, ActionType } from '../types/chain';
import { ChainService } from '../services/chainService';
import { StorageService } from '../services/storageService';
import { BroadcastService } from '../services/broadcastService';
import { WebSocketService } from '../services/websocketService';
import RelayManager from '../services/relayManager';
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
    RelayManager.initialize();
    WebSocketService.initialize();

    await ChainService.initializeChain();
    await loadBlocks();

    setupSyncListeners();

    // Register incremental sync: on every (re)connect, send lastIndex
    // so peers only respond with blocks we're missing
    WebSocketService.onConnectSyncRequest(() => {
      setTimeout(() => {
        const lastIndex = blocks.value.length > 0
          ? blocks.value[blocks.value.length - 1].index
          : -1;
        BroadcastService.broadcast('request-sync', { peerId: BroadcastService.getPeerId(), lastIndex });
        WebSocketService.broadcast('request-sync', { peerId: WebSocketService.getPeerId(), lastIndex });
      }, 1000);
    });

    WebSocketService.onStatusChange(({ connected }) => {
      isWebSocketConnected.value = connected;
    });

    isInitialized.value = true;
  }

  async function loadBlocks() {
    blocks.value = await StorageService.getAllBlocks();
    blocks.value.sort((a, b) => a.index - b.index);
  }

  function requestIncrementalSync() {
    const lastIndex = blocks.value.length > 0 ? blocks.value[blocks.value.length - 1].index : -1;
    const request = { peerId: BroadcastService.getPeerId(), lastIndex };
    BroadcastService.broadcast('request-sync', request);
    WebSocketService.broadcast('request-sync', request);
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
    if (!block || typeof block !== 'object') return;

    const exists = blocks.value.find((b) => b.index === block.index);
    if (exists) {
      if (exists.currentHash !== block.currentHash) {
        console.warn(`Chain conflict at block index ${block.index}; requesting incremental resync`);
        requestIncrementalSync();
      }
      return;
    }

    if (block.index === 0) {
      if (blocks.value.length === 0 && ChainService.validateGenesisBlock(block, { allowLegacy: true })) {
        await StorageService.saveBlock(block);
        blocks.value.push(block);
      }
      return;
    }

    if (blocks.value.length === 0) {
      requestIncrementalSync();
      return;
    }

    const previousBlock = blocks.value[blocks.value.length - 1];
    const expectedIndex = previousBlock.index + 1;
    if (block.index !== expectedIndex) {
      if (block.index > expectedIndex) {
        console.warn(`Received future block ${block.index} (expected ${expectedIndex}); requesting sync`);
        requestIncrementalSync();
      }
      return;
    }

    if (ChainService.validateBlock(block, previousBlock)) {
      await StorageService.saveBlock(block);
      blocks.value.push(block);
    }
  }

  async function handleSyncRequest(data: any) {
    const allBlocks: ChainBlock[] = await StorageService.getAllBlocks();
    const lastIndex = typeof data?.lastIndex === 'number' ? data.lastIndex : -1;

    // Only send blocks the requester doesn't have yet
    const missingBlocks = lastIndex >= 0
      ? allBlocks.filter((b: ChainBlock) => b.index > lastIndex)
      : allBlocks;

    // Nothing to send
    if (missingBlocks.length === 0) return;

    const response = {
      blocks: missingBlocks,
      peerId: BroadcastService.getPeerId(),
    };

    BroadcastService.broadcast('sync-response', response);
    WebSocketService.broadcast('sync-response', response);
  }

  async function handleSyncResponse(data: any) {
    if (!data?.blocks?.length || !Array.isArray(data.blocks)) return;

    const sorted = [...data.blocks].sort((a: ChainBlock, b: ChainBlock) => a.index - b.index);
    let addedCount = 0;

    for (const block of sorted) {
      if (!block || typeof block !== 'object') continue;

      const exists = blocks.value.find((b) => b.index === block.index);
      if (exists) {
        if (exists.currentHash !== block.currentHash) {
          console.warn(`Detected conflicting sync block at index ${block.index}; requesting resync`);
          requestIncrementalSync();
          break;
        }
        continue;
      }

      if (block.index === 0) {
        if (blocks.value.length === 0 && ChainService.validateGenesisBlock(block, { allowLegacy: true })) {
          await StorageService.saveBlock(block);
          blocks.value.push(block);
          addedCount++;
        }
        continue;
      }

      const latest = blocks.value[blocks.value.length - 1];
      if (!latest) {
        requestIncrementalSync();
        break;
      }

      const expectedIndex = latest.index + 1;
      if (block.index !== expectedIndex) {
        if (block.index > expectedIndex) {
          console.warn(`Sync gap detected at index ${block.index} (expected ${expectedIndex}); requesting resync`);
          requestIncrementalSync();
          break;
        }
        continue;
      }

      if (ChainService.validateBlock(block, latest, { allowLegacy: true })) {
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

  async function addAction(
    actionType: ActionType,
    actionData: Record<string, unknown>,
    actionLabel: string
  ): Promise<ChainBlock> {
    const block = await ChainService.addAction(actionType, actionData, actionLabel);

    blocks.value.push(block);

    BroadcastService.broadcast('new-block', block);
    WebSocketService.broadcast('new-block', block);

    return block;
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
    addAction,
    validateChain,
    checkForDowngrade,
    syncBlocks,
    resetChain,
  };
});
