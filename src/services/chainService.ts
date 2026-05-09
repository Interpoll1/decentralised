import { ChainBlock, Vote, ActionType } from '../types/chain';
import { CryptoService } from './cryptoService';
import { StorageService } from './storageService';
import { KeyService } from './keyService';

export class ChainService {
  private static readonly GENESIS_HASH = '0'.repeat(64);
  private static readonly HEX_64 = /^[0-9a-f]{64}$/i;
  private static readonly HEX_128 = /^[0-9a-f]{128}$/i;
  private static readonly MAX_FUTURE_SKEW_MS = 30_000;

  static async createGenesisBlock(): Promise<ChainBlock> {
    const keyPair = await KeyService.getKeyPair();

    const block: ChainBlock = {
      index: 0,
      timestamp: Date.now(),
      previousHash: this.GENESIS_HASH,
      voteHash: this.GENESIS_HASH,
      signature: '',
      currentHash: '',
      nonce: 0,
      pubkey: keyPair.publicKey,
    };

    block.signature = CryptoService.sign(
      JSON.stringify({
        index: block.index,
        voteHash: block.voteHash,
        previousHash: block.previousHash,
      }),
      keyPair.privateKey
    );

    block.currentHash = CryptoService.hashBlock(block);

    return block;
  }

  static async createBlock(
    data: Record<string, unknown>,
    previousBlock: ChainBlock,
    actionType?: ActionType,
    actionLabel?: string
  ): Promise<ChainBlock> {
    const keyPair = await KeyService.getKeyPair();
    const voteHash = CryptoService.hashVote(data);

    const block: ChainBlock = {
      index: previousBlock.index + 1,
      timestamp: Date.now(),
      previousHash: previousBlock.currentHash,
      voteHash,
      signature: '',
      currentHash: '',
      nonce: 0,
      pubkey: keyPair.publicKey,
    };

    if (actionType) block.actionType = actionType;
    if (actionLabel) block.actionLabel = actionLabel;

    block.signature = CryptoService.sign(
      JSON.stringify({
        index: block.index,
        voteHash: block.voteHash,
        previousHash: block.previousHash,
      }),
      keyPair.privateKey
    );

    block.currentHash = CryptoService.hashBlock(block);

    return block;
  }

  static validateGenesisBlock(
    block: ChainBlock,
    options: { allowLegacy?: boolean } = {},
  ): boolean {
    if (!Number.isInteger(block.index) || block.index !== 0) {
      console.error('Invalid genesis index');
      return false;
    }
    if (!Number.isFinite(block.timestamp) || block.timestamp <= 0) {
      console.error('Invalid genesis timestamp');
      return false;
    }
    if (block.previousHash !== this.GENESIS_HASH || block.voteHash !== this.GENESIS_HASH) {
      console.error('Invalid genesis hash linkage');
      return false;
    }
    if (!this.HEX_64.test(block.currentHash)) {
      console.error('Invalid genesis currentHash format');
      return false;
    }
    if (!this.validateSignatureFields(block, options.allowLegacy === true)) {
      return false;
    }
    const calculatedHash = CryptoService.hashBlock(block);
    if (block.currentHash !== calculatedHash) {
      console.error('Invalid genesis block hash');
      return false;
    }
    return true;
  }

  private static validateSignatureFields(block: ChainBlock, allowLegacy: boolean): boolean {
    if (!block.pubkey && allowLegacy) {
      return true;
    }
    if (!this.HEX_128.test(block.signature)) {
      console.error('Invalid block signature format');
      return false;
    }
    if (block.pubkey) {
      if (!this.HEX_64.test(block.pubkey)) {
        console.error('Invalid block pubkey format');
        return false;
      }
      const dataToVerify = JSON.stringify({
        index: block.index,
        voteHash: block.voteHash,
        previousHash: block.previousHash,
      });
      if (!CryptoService.verify(dataToVerify, block.signature, block.pubkey)) {
        console.error('Invalid Schnorr signature');
        return false;
      }
      return true;
    }
    console.error('Unsigned legacy blocks are not accepted');
    return false;
  }

  static validateBlock(
    block: ChainBlock,
    previousBlock: ChainBlock,
    options: { allowLegacy?: boolean } = {},
  ): boolean {
    if (!Number.isInteger(block.index) || !Number.isInteger(previousBlock.index)) {
      console.error('Invalid block index type');
      return false;
    }
    if (!Number.isFinite(block.timestamp) || !Number.isFinite(previousBlock.timestamp)) {
      console.error('Invalid block timestamp type');
      return false;
    }
    if (block.timestamp < previousBlock.timestamp) {
      console.error('Block timestamp is older than previous block');
      return false;
    }
    if (block.timestamp > Date.now() + this.MAX_FUTURE_SKEW_MS) {
      console.error('Block timestamp too far in the future');
      return false;
    }
    if (!this.HEX_64.test(block.previousHash) || !this.HEX_64.test(block.voteHash) || !this.HEX_64.test(block.currentHash)) {
      console.error('Invalid block hash format');
      return false;
    }
    if (block.actionType && block.actionType !== 'vote' && block.actionType !== 'community-create' && block.actionType !== 'post-create') {
      console.error('Invalid block action type');
      return false;
    }
    if (block.actionLabel && (typeof block.actionLabel !== 'string' || block.actionLabel.length > 200)) {
      console.error('Invalid block action label');
      return false;
    }
    if (block.index !== previousBlock.index + 1) {
      console.error('Invalid block index');
      return false;
    }

    if (block.previousHash !== previousBlock.currentHash) {
      console.error('Invalid previous hash');
      return false;
    }

    const calculatedHash = CryptoService.hashBlock(block);
    if (block.currentHash !== calculatedHash) {
      console.error('Invalid block hash');
      return false;
    }

    if (!this.validateSignatureFields(block, options.allowLegacy === true)) {
      return false;
    }

    return true;
  }

  static async validateChain(): Promise<boolean> {
  const blocks = await StorageService.getAllBlocks();

  if (blocks.length === 0) return true;

  // Explicitly type the parameters
  blocks.sort((a: ChainBlock, b: ChainBlock) => a.index - b.index);

  if (!this.validateGenesisBlock(blocks[0], { allowLegacy: true })) {
    console.error('Invalid genesis block');
    return false;
  }

  for (let i = 1; i < blocks.length; i++) {
    if (blocks[i].index !== blocks[i - 1].index + 1) {
      console.error(`Chain gap or duplicate detected at index ${i}`);
      return false;
    }
    if (!this.validateBlock(blocks[i], blocks[i - 1], { allowLegacy: true })) {
      console.error(`Invalid block at index ${i}`);
      return false;
    }
  }

  return true;
}


  static async initializeChain(): Promise<void> {
    const latestBlock = await StorageService.getLatestBlock();

    if (!latestBlock) {
      const genesis = await this.createGenesisBlock();
      await StorageService.saveBlock(genesis);
    }
  }

  static async resetChain(): Promise<void> {
    const db = await StorageService.getDB();
    const tx = db.transaction(['blocks', 'votes', 'receipts'], 'readwrite');

    await Promise.all([
      tx.objectStore('blocks').clear(),
      tx.objectStore('votes').clear(),
      tx.objectStore('receipts').clear(),
    ]);

    await tx.done;

    const genesis = await this.createGenesisBlock();
    await StorageService.saveBlock(genesis);
  }

  static async getChainHead(): Promise<{ hash: string; index: number } | null> {
    const latestBlock = await StorageService.getLatestBlock();

    if (!latestBlock) return null;

    return {
      hash: latestBlock.currentHash,
      index: latestBlock.index,
    };
  }

  static async addVote(vote: Vote): Promise<{ block: ChainBlock; receipt: string }> {
    const previousBlock = await StorageService.getLatestBlock();

    if (!previousBlock) {
      throw new Error('Chain not initialized');
    }

    const newBlock = await this.createBlock(
      vote as unknown as Record<string, unknown>,
      previousBlock,
      'vote',
      `Vote on ${vote.pollId}`
    );

    await StorageService.saveBlock(newBlock);
    await StorageService.saveVote(vote);

    const mnemonic = CryptoService.generateMnemonic();

    return { block: newBlock, receipt: mnemonic };
  }

  static async addAction(
    actionType: ActionType,
    actionData: Record<string, unknown>,
    actionLabel: string
  ): Promise<ChainBlock> {
    const previousBlock = await StorageService.getLatestBlock();

    if (!previousBlock) {
      throw new Error('Chain not initialized');
    }

    const newBlock = await this.createBlock(actionData, previousBlock, actionType, actionLabel);

    await StorageService.saveBlock(newBlock);

    return newBlock;
  }

  static async detectDowngrade(remoteHash: string, remoteIndex: number): Promise<boolean> {
    const localHead = await this.getChainHead();

    if (!localHead) return false;

    if (remoteIndex < localHead.index) {
      return true;
    }

    if (remoteIndex === localHead.index && remoteHash !== localHead.hash) {
      return true;
    }

    return false;
  }
}
