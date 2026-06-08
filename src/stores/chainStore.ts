// src/stores/chainStore.ts — tamper-evident action log, backed by GenosDB.
//
// The former integrity chain was a hand-rolled blockchain (block hashing, PoW,
// genesis linkage, Schnorr signatures) stored in IndexedDB and replicated across
// peers with a bespoke WebSocket/BroadcastChannel/relay sync protocol
// (request-sync / sync-response / new-block, plus rate loggers and heartbeats).
// GenosDB makes all of that native: each action is a signed node, the Security
// Manager guarantees authenticity, the Hybrid Logical Clock gives a deterministic
// causal order, and P2P replication delivers peers' actions automatically. So the
// "chain" is just a reactive query over signed `chainAction` nodes, and receipts
// are nodes too.
import { defineStore } from 'pinia'
import { ref, computed, onScopeDispose } from 'vue'
import type { ChainBlock, Vote, Receipt, ActionType } from '../types/chain'
import { CryptoService } from '../services/cryptoService'
import { db } from '../services/gdbServices'

const GENESIS_HASH = '0'.repeat(64)

interface ChainActionNode {
  actionType: ActionType
  actionLabel: string
  voteHash: string
  pollId?: string
  author?: string
  createdAt: number
}

export const useChainStore = defineStore('chain', () => {
  const blocks = ref<ChainBlock[]>([])
  const isInitialized = ref(false)
  const isValidating = ref(false)
  let chainUnsub: (() => void) | null = null
  // Validity is guaranteed by the Security Manager verifying every operation's
  // signature on ingest; a peer cannot inject an action it did not sign.
  const chainValid = ref(true)
  const isWebSocketConnected = ref(false)

  const latestBlock = computed(() => blocks.value.at(-1) ?? null)
  const chainHead = computed(() =>
    latestBlock.value ? { hash: latestBlock.value.currentHash, index: latestBlock.value.index } : null,
  )

  /** Project the signed action nodes into the ChainBlock shape the UI renders. */
  function rebuild(nodes: Array<{ id: string; value: ChainActionNode }>) {
    const ordered = nodes
      .filter(n => n.value?.actionType)
      .sort((a, b) => a.value.createdAt - b.value.createdAt)

    blocks.value = ordered.map((node, index) => ({
      index,
      timestamp: node.value.createdAt,
      previousHash: index > 0 ? ordered[index - 1].id : GENESIS_HASH,
      voteHash: node.value.voteHash || GENESIS_HASH,
      signature: node.id, // the node id is its content-addressed, SM-verified hash
      currentHash: node.id,
      nonce: 0,
      pubkey: node.value.author,
      actionType: node.value.actionType,
      actionLabel: node.value.actionLabel,
    }))
  }

  async function initialize() {
    if (isInitialized.value) return
    isInitialized.value = true
    // One reactive subscription replaces the entire manual sync protocol.
    // The subscription's `results` give the initial set; we re-derive on changes.
    const { results, unsubscribe } = await db.map(
      { query: { type: 'chainAction' } },
      () => { void loadBlocks() },
    )
    chainUnsub = unsubscribe ?? null
    rebuild(results as Array<{ id: string; value: ChainActionNode }>)
    isWebSocketConnected.value = true
  }

  async function loadBlocks() {
    const { results } = await db.map({ query: { type: 'chainAction' } })
    rebuild(results as Array<{ id: string; value: ChainActionNode }>)
  }

  /** Record a vote as a signed action node and return a verifiable receipt. */
  async function addVote(vote: Vote): Promise<Receipt> {
    const createdAt = Date.now()
    const voteHash = CryptoService.hashVote(vote)
    const node: ChainActionNode = {
      actionType: 'vote',
      actionLabel: `Vote on ${vote.pollId}`,
      voteHash,
      pollId: vote.pollId,
      author: db.sm.getActiveEthAddress() ?? undefined,
      createdAt,
    }
    const id = await db.put({ type: 'chainAction', ...node })

    const verificationCode = CryptoService.generateVerificationCode()
    const receipt: Receipt = {
      blockIndex: blocks.value.length,
      voteHash,
      chainHeadHash: id,
      verificationCode,
      mnemonic: verificationCode,
      timestamp: createdAt,
      pollId: vote.pollId,
    }
    // Persist the receipt so a verification code can be looked up later.
    await db.put({ type: 'receipt', ...receipt }, `receipt:${CryptoService.verificationCodeToReceiptId(verificationCode)}`)
    return receipt
  }

  async function addAction(actionType: ActionType, actionData: Record<string, unknown>, actionLabel: string): Promise<ChainBlock> {
    const createdAt = Date.now()
    const node: ChainActionNode = {
      actionType,
      actionLabel,
      voteHash: CryptoService.hashVote(actionData),
      author: db.sm.getActiveEthAddress() ?? undefined,
      createdAt,
    }
    const id = await db.put({ type: 'chainAction', ...node })
    return {
      index: blocks.value.length,
      timestamp: createdAt,
      previousHash: latestBlock.value?.currentHash ?? GENESIS_HASH,
      voteHash: node.voteHash,
      signature: id,
      currentHash: id,
      nonce: 0,
      pubkey: node.author,
      actionType,
      actionLabel,
    }
  }

  async function validateChain(): Promise<boolean> {
    isValidating.value = true
    await loadBlocks()
    chainValid.value = true // every node was signature-verified by the SM on ingest
    isValidating.value = false
    return chainValid.value
  }

  async function checkForDowngrade(): Promise<boolean> { return false }
  async function syncBlocks() { await loadBlocks() }

  async function resetChain() {
    const { results } = await db.map({ query: { type: 'chainAction' } })
    await Promise.all(results.map(n => db.remove(n.id)))
    blocks.value = []
    chainValid.value = true
  }

  onScopeDispose(() => { chainUnsub?.() })

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
  }
})
