// src/stores/chainStore.ts
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { ChainBlock, Vote, Receipt, ActionType } from '../types/chain';
import { ChainService } from '../services/chainService';
import { StorageService } from '../services/storageService';
import { BroadcastService } from '../services/broadcastService';
import { WebSocketService } from '../services/websocketService';
import { WebRTCService } from '../services/webrtcService';
import { MeshService } from '../services/meshService';
import { ResilienceService } from '../services/resilienceService';
import RelayManager from '../services/relayManager';
import { AuditService } from '../services/auditService';
import { EventService } from '../services/eventService';
import { VoteTallyService } from '../services/voteTallyService';
import config from '../config';

export const useChainStore = defineStore('chain', () => {
  const SYNC_REQUEST_BASE_INTERVAL_MS = 1200;
  const SYNC_REQUEST_MAX_INTERVAL_MS = 12000;
  const SYNC_LOG_DEDUP_WINDOW_MS = 5000;
  const SYNC_DEBUG_HEARTBEAT_MS = 3000;

  const blocks = ref<ChainBlock[]>([]);
  const isInitialized = ref(false);
  const isValidating = ref(false);
  const chainValid = ref(true);
  const isWebSocketConnected = ref(false);

  let lastSyncRequestAt = 0;
  let consecutiveSyncNoProgress = 0;
  let pendingSyncTimer: ReturnType<typeof setTimeout> | null = null;
  const syncLogLastSeen = new Map<string, number>();
  let debugHeartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let lastSyncMessageAt = 0;

  function isSyncDebugEnabled(): boolean {
    return typeof window !== 'undefined' && window.localStorage.getItem('interpoll_sync_debug') === 'true';
  }

  function createRateLogger(label: string, snapshot?: () => Record<string, unknown>) {
    let windowStart = Date.now();
    let count = 0;
    return (delta = 1) => {
      if (!isSyncDebugEnabled()) return;
      count += delta;
      const now = Date.now();
      lastSyncMessageAt = now;
      if (now - windowStart < 1000) return;
      const payload = snapshot ? snapshot() : {};
      console.log(`[SyncRate] ${label}`, { eventsPerSec: count, ...payload });
      windowStart = now;
      count = 0;
    };
  }

  function ensureSyncDebugHeartbeat() {
    if (debugHeartbeatTimer) return;
    if (!isSyncDebugEnabled()) return;
    console.log('[SyncDebug] chainStore diagnostics active');
    debugHeartbeatTimer = setInterval(() => {
      if (!isSyncDebugEnabled()) return;
      const now = Date.now();
      const ageMs = lastSyncMessageAt > 0 ? now - lastSyncMessageAt : null;
      console.log('[SyncDebug] chainStore heartbeat', {
        wsConnected: isWebSocketConnected.value,
        localHeight: blocks.value.length > 0 ? blocks.value[blocks.value.length - 1].index : -1,
        sinceLastSyncMessageMs: ageMs,
      });
    }, SYNC_DEBUG_HEARTBEAT_MS);
  }

  const logNewBlockRate = createRateLogger('chain-new-block');
  const logSyncRequestSentRate = createRateLogger('chain-sync-request-sent');
  const logSyncRequestReceivedRate = createRateLogger('chain-sync-request-received');
  const logSyncResponseReceivedRate = createRateLogger('chain-sync-response-received');
  const logSyncResponseBlockRate = createRateLogger('chain-sync-response-blocks');

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

    // P2P mesh fallback: keeps blocks/events/content syncing when relays are down.
    // Anonymity (Tor) Mode force-disables it — WebRTC/STUN would leak the real IP
    // even inside Tor Browser. `WebRTCService.setEnabled` also refuses on its own,
    // so this is a fast-path guard that avoids spinning up mesh/discovery timers.
    await WebRTCService.initialize();
    if (config.anonymityMode) {
      WebRTCService.setEnabled(false);
    } else {
      MeshService.initialize();
    }

    // Resilience orchestrator: detects total blackout and escalates through
    // failover → gossip → rendezvous → mesh to reconverge the network.
    ResilienceService.initialize();

    // Verified vote tally: aggregate signed kind-101 vote events (CRITICAL-2).
    void VoteTallyService.initialize();

    await ChainService.initializeChain();
    await loadBlocks();

    setupSyncListeners();

    // Register incremental sync: on every (re)connect, send lastIndex
    // so peers only respond with blocks we're missing
    WebSocketService.onConnectSyncRequest(() => {
      setTimeout(() => {
        requestIncrementalSync();
      }, 1000);
    });

    WebSocketService.onStatusChange(({ connected }) => {
      isWebSocketConnected.value = connected;
    });

    ensureSyncDebugHeartbeat();

    isInitialized.value = true;
  }

  async function loadBlocks() {
    blocks.value = await StorageService.getAllBlocks();
    blocks.value.sort((a, b) => a.index - b.index);
  }

  function logSyncIssue(key: string, message: string) {
    const now = Date.now();
    const lastSeen = syncLogLastSeen.get(key) ?? 0;
    if (now - lastSeen < SYNC_LOG_DEDUP_WINDOW_MS) return;
    syncLogLastSeen.set(key, now);
    console.warn(message);
  }

  function markSyncProgress() {
    consecutiveSyncNoProgress = 0;
  }

  function requestIncrementalSync() {
    const now = Date.now();
    const minInterval = Math.min(
      SYNC_REQUEST_BASE_INTERVAL_MS * Math.max(1, consecutiveSyncNoProgress),
      SYNC_REQUEST_MAX_INTERVAL_MS,
    );
    const waitMs = (lastSyncRequestAt + minInterval) - now;
    if (waitMs > 0) {
      if (!pendingSyncTimer) {
        pendingSyncTimer = setTimeout(() => {
          pendingSyncTimer = null;
          requestIncrementalSync();
        }, waitMs);
      }
      return;
    }

    lastSyncRequestAt = now;
    consecutiveSyncNoProgress++;
    const lastIndex = blocks.value.length > 0 ? blocks.value[blocks.value.length - 1].index : -1;
    const request = { peerId: BroadcastService.getPeerId(), lastIndex };
    logSyncRequestSentRate();
    BroadcastService.broadcast('request-sync', request);
    WebSocketService.broadcast('request-sync', request);
    WebRTCService.broadcastToAll('request-sync', request);
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

    // WebRTC mesh — same idempotent handlers; duplicate delivery is safe.
    WebRTCService.onMessage('new-block', (d) => { void handleNewBlock(d as ChainBlock); });
    WebRTCService.onMessage('request-sync', (d) => { void handleSyncRequest(d); });
    WebRTCService.onMessage('sync-response', (d) => { void handleSyncResponse(d); });
    WebRTCService.onMessage('new-event', (d) => { void handleNewEvent(d); });
  }

  async function handleNewBlock(block: ChainBlock) {
    if (!block || typeof block !== 'object') return;
    logNewBlockRate();

    const exists = blocks.value.find((b) => b.index === block.index);
    if (exists) {
      if (exists.currentHash !== block.currentHash) {
        logSyncIssue(
          `new-block-conflict-${block.index}`,
          `Chain conflict at block index ${block.index}; requesting incremental resync`,
        );
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
        logSyncIssue(
          `new-block-future-${expectedIndex}`,
          `Received future block ${block.index} (expected ${expectedIndex}); requesting sync`,
        );
        requestIncrementalSync();
      }
      return;
    }

    if (ChainService.validateBlock(block, previousBlock)) {
      await StorageService.saveBlock(block);
      blocks.value.push(block);
      markSyncProgress();
    }
  }

  async function handleSyncRequest(data: any) {
    logSyncRequestReceivedRate();
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
    WebRTCService.broadcastToAll('sync-response', response);
  }

  async function handleSyncResponse(data: any) {
    if (!data?.blocks?.length || !Array.isArray(data.blocks)) return;
    logSyncResponseReceivedRate();
    logSyncResponseBlockRate(data.blocks.length);

    const sorted = [...data.blocks].sort((a: ChainBlock, b: ChainBlock) => a.index - b.index);
    let addedCount = 0;

    for (const block of sorted) {
      if (!block || typeof block !== 'object') continue;

      const exists = blocks.value.find((b) => b.index === block.index);
      if (exists) {
        if (exists.currentHash !== block.currentHash) {
          logSyncIssue(
            `sync-conflict-${block.index}`,
            `Detected conflicting sync block at index ${block.index}; requesting resync`,
          );
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
          markSyncProgress();
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
          logSyncIssue(
            `sync-gap-${expectedIndex}`,
            `Sync gap detected at index ${block.index} (expected ${expectedIndex}); requesting resync`,
          );
          requestIncrementalSync();
          break;
        }
        continue;
      }

      if (ChainService.validateBlock(block, latest, { allowLegacy: true })) {
        await StorageService.saveBlock(block);
        blocks.value.push(block);
        addedCount++;
        markSyncProgress();
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

    // Aggregate signed kind-101 vote events into the verified tally (CRITICAL-2)
    // instead of discarding them, so counts can be cross-checked against Gun.
    VoteTallyService.ingest(eventData);
  }

  async function addVote(vote: Vote): Promise<Receipt> {
    // Create signed vote event. Tag the option id only for single-option votes —
    // a single kind-101 event can carry one `option` tag, so multi-choice votes
    // fall back to the free-text `choice` (poll-total trust is unaffected either
    // way; per-option attribution just isn't available for multi-choice).
    const singleOptionId = vote.optionIds?.length === 1 ? vote.optionIds[0] : undefined;
    const voteEvent = await EventService.createVoteEvent({
      pollId: vote.pollId,
      choice: vote.choice,
      optionId: singleOptionId,
      deviceId: vote.deviceId,
      powDifficulty: vote.powDifficulty,
      trustCert: vote.trustCert,
      relayAttestation: vote.relayAttestation,
    });

    // Add vote to blockchain (signed with real Schnorr key)
    const { block, receipt: verificationCode } = await ChainService.addVote(vote);

    blocks.value.push(block);

    // Broadcast both the block and the signed event
    BroadcastService.broadcast('new-block', block);
    WebSocketService.broadcast('new-block', block);
    WebRTCService.broadcastToAll('new-block', block);
    BroadcastService.broadcast('new-event', voteEvent);
    WebSocketService.broadcast('new-event', voteEvent);
    WebRTCService.broadcastToAll('new-event', voteEvent);

    const receipt: Receipt = {
      blockIndex: block.index,
      voteHash: block.voteHash,
      chainHeadHash: block.currentHash,
      verificationCode,
      mnemonic: verificationCode,
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
    WebRTCService.broadcastToAll('new-block', block);

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
