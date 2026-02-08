import { ChainBlock, Vote } from '../types/chain';
import { CryptoService } from './cryptoService';
import { StorageService } from './storageService';
import { KeyService } from './keyService';

export class ChainService {
  private static readonly GENESIS_HASH = '0'.repeat(64);

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
      JSON.stringify({ index: block.index, timestamp: block.timestamp }),
      keyPair.privateKey
    );

    block.currentHash = CryptoService.hashBlock(block);

    return block;
  }

  static async createBlock(vote: Vote, previousBlock: ChainBlock): Promise<ChainBlock> {
    const keyPair = await KeyService.getKeyPair();
    const voteHash = CryptoService.hashVote(vote);

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

  static validateBlock(block: ChainBlock, previousBlock: ChainBlock): boolean {
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

    // Schnorr signature verification (blocks with pubkey)
    if (block.pubkey) {
      const dataToVerify = JSON.stringify({
        index: block.index,
        voteHash: block.voteHash,
        previousHash: block.previousHash,
      });

      if (!CryptoService.verify(dataToVerify, block.signature, block.pubkey)) {
        console.error('Invalid Schnorr signature');
        return false;
      }
    }
    // Legacy blocks without pubkey: accepted if hash-chain integrity holds

    return true;
  }

  static async validateChain(): Promise<boolean> {
    const blocks = await StorageService.getAllBlocks();

    if (blocks.length === 0) return true;

    blocks.sort((a, b) => a.index - b.index);

    if (blocks[0].index !== 0 || blocks[0].previousHash !== this.GENESIS_HASH) {
      console.error('Invalid genesis block');
      return false;
    }

    for (let i = 1; i < blocks.length; i++) {
      if (!this.validateBlock(blocks[i], blocks[i - 1])) {
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

    const newBlock = await this.createBlock(vote, previousBlock);

    await StorageService.saveBlock(newBlock);
    await StorageService.saveVote(vote);

    const mnemonic = CryptoService.generateMnemonic();

    return { block: newBlock, receipt: mnemonic };
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
