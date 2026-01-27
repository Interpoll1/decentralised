import { ChainBlock } from '../types/chain';
import { CryptoService } from '../services/cryptoService';

export class ChainValidation {
  static validateBlockStructure(block: ChainBlock): boolean {
    return (
      typeof block.index === 'number' &&
      typeof block.timestamp === 'number' &&
      typeof block.previousHash === 'string' &&
      typeof block.voteHash === 'string' &&
      typeof block.signature === 'string' &&
      typeof block.currentHash === 'string'
    );
  }

  static validateBlockHash(block: ChainBlock): boolean {
    const calculatedHash = CryptoService.hashBlock(block);
    return calculatedHash === block.currentHash;
  }

  static validateBlockChain(currentBlock: ChainBlock, previousBlock: ChainBlock): boolean {
    // Validate structure
    if (!this.validateBlockStructure(currentBlock)) {
      return false;
    }

    // Validate index sequence
    if (currentBlock.index !== previousBlock.index + 1) {
      return false;
    }

    // Validate previous hash linkage
    if (currentBlock.previousHash !== previousBlock.currentHash) {
      return false;
    }

    // Validate current block hash
    if (!this.validateBlockHash(currentBlock)) {
      return false;
    }

    return true;
  }

  static findInvalidBlock(blocks: ChainBlock[]): number {
    for (let i = 1; i < blocks.length; i++) {
      if (!this.validateBlockChain(blocks[i], blocks[i - 1])) {
        return i;
      }
    }
    return -1;
  }
}