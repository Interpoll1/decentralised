import { describe, expect, it } from 'vitest';
import { ChainService } from '../src/services/chainService';
import { CryptoService } from '../src/services/cryptoService';
import type { ChainBlock } from '../src/types/chain';

function makeLegacyBlock(index: number, timestamp: number, previousHash: string, voteHash: string): ChainBlock {
  const block: ChainBlock = {
    index,
    timestamp,
    previousHash,
    voteHash,
    signature: '',
    currentHash: '',
    nonce: 0,
  };
  block.currentHash = CryptoService.hashBlock(block);
  return block;
}

describe('ChainService', () => {
  it('creates a deterministic legacy genesis block', async () => {
    const first = await ChainService.createGenesisBlock();
    const second = await ChainService.createGenesisBlock();

    expect(first).toEqual(second);
    expect(first.signature).toBe('');
    expect(first.pubkey).toBeUndefined();
  });

  it('accepts moderate backward timestamp skew for synced blocks', () => {
    const previous = makeLegacyBlock(0, 1_700_000_100_000, '0'.repeat(64), '0'.repeat(64));
    const current = makeLegacyBlock(1, 1_700_000_000_000, previous.currentHash, '1'.repeat(64));

    const valid = ChainService.validateBlock(current, previous, { allowLegacy: true });
    expect(valid).toBe(true);
  });
});
