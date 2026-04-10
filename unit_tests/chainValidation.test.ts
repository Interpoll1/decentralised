import { describe, it, expect, vi } from 'vitest';

// Mock CryptoService before importing
vi.mock('../src/services/cryptoService', () => ({
  CryptoService: {
    hashBlock: (block: any) => {
      // Simple deterministic mock hash
      const data = `${block.index}-${block.timestamp}-${block.previousHash}-${block.voteHash}`;
      let hash = 0;
      for (let i = 0; i < data.length; i++) {
        hash = ((hash << 5) - hash + data.charCodeAt(i)) | 0;
      }
      return Math.abs(hash).toString(16).padStart(8, '0');
    },
  },
}));

import { ChainValidation } from '../src/utils/chainValidation';
import { CryptoService } from '../src/services/cryptoService';
import type { ChainBlock } from '../src/types/chain';

function makeBlock(overrides: Partial<ChainBlock> = {}): ChainBlock {
  return {
    index: 0,
    timestamp: 1000,
    previousHash: '0',
    voteHash: 'vote1',
    signature: 'sig1',
    currentHash: 'hash1',
    nonce: 0,
    ...overrides,
  };
}

describe('ChainValidation', () => {
  describe('validateBlockStructure', () => {
    it('returns true for valid block', () => {
      expect(ChainValidation.validateBlockStructure(makeBlock())).toBe(true);
    });

    it('returns false when index is not a number', () => {
      expect(ChainValidation.validateBlockStructure(makeBlock({ index: 'a' as any }))).toBe(false);
    });

    it('returns false when timestamp is not a number', () => {
      expect(
        ChainValidation.validateBlockStructure(makeBlock({ timestamp: null as any })),
      ).toBe(false);
    });

    it('returns false when previousHash is not a string', () => {
      expect(
        ChainValidation.validateBlockStructure(makeBlock({ previousHash: 123 as any })),
      ).toBe(false);
    });

    it('returns false when voteHash is not a string', () => {
      expect(
        ChainValidation.validateBlockStructure(makeBlock({ voteHash: undefined as any })),
      ).toBe(false);
    });

    it('returns false when signature is not a string', () => {
      expect(
        ChainValidation.validateBlockStructure(makeBlock({ signature: true as any })),
      ).toBe(false);
    });

    it('returns false when currentHash is not a string', () => {
      expect(
        ChainValidation.validateBlockStructure(makeBlock({ currentHash: 0 as any })),
      ).toBe(false);
    });
  });

  describe('validateBlockHash', () => {
    it('returns true when hash matches', () => {
      const block = makeBlock();
      block.currentHash = CryptoService.hashBlock(block);
      expect(ChainValidation.validateBlockHash(block)).toBe(true);
    });

    it('returns false when hash is tampered', () => {
      const block = makeBlock();
      block.currentHash = 'tampered';
      expect(ChainValidation.validateBlockHash(block)).toBe(false);
    });
  });

  describe('validateBlockChain', () => {
    it('returns true for valid chain link', () => {
      const prev = makeBlock({ index: 0, currentHash: 'prev-hash' });
      const curr = makeBlock({
        index: 1,
        previousHash: 'prev-hash',
      });
      curr.currentHash = CryptoService.hashBlock(curr);
      expect(ChainValidation.validateBlockChain(curr, prev)).toBe(true);
    });

    it('returns false for non-sequential index', () => {
      const prev = makeBlock({ index: 0, currentHash: 'prev-hash' });
      const curr = makeBlock({ index: 5, previousHash: 'prev-hash' });
      curr.currentHash = CryptoService.hashBlock(curr);
      expect(ChainValidation.validateBlockChain(curr, prev)).toBe(false);
    });

    it('returns false for mismatched previousHash', () => {
      const prev = makeBlock({ index: 0, currentHash: 'prev-hash' });
      const curr = makeBlock({ index: 1, previousHash: 'wrong-hash' });
      curr.currentHash = CryptoService.hashBlock(curr);
      expect(ChainValidation.validateBlockChain(curr, prev)).toBe(false);
    });
  });

  describe('findInvalidBlock', () => {
    it('returns -1 for valid chain', () => {
      const b0 = makeBlock({ index: 0, previousHash: '0' });
      b0.currentHash = CryptoService.hashBlock(b0);
      const b1 = makeBlock({ index: 1, previousHash: b0.currentHash, timestamp: 2000 });
      b1.currentHash = CryptoService.hashBlock(b1);
      expect(ChainValidation.findInvalidBlock([b0, b1])).toBe(-1);
    });

    it('returns index of first invalid block', () => {
      const b0 = makeBlock({ index: 0 });
      b0.currentHash = CryptoService.hashBlock(b0);
      const b1 = makeBlock({ index: 1, previousHash: 'wrong' });
      b1.currentHash = CryptoService.hashBlock(b1);
      expect(ChainValidation.findInvalidBlock([b0, b1])).toBe(1);
    });

    it('returns -1 for single-block chain', () => {
      const b0 = makeBlock();
      expect(ChainValidation.findInvalidBlock([b0])).toBe(-1);
    });

    it('returns -1 for empty chain', () => {
      expect(ChainValidation.findInvalidBlock([])).toBe(-1);
    });
  });
});
