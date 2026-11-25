import { describe, it, expect } from 'vitest';
import { CryptoService } from '../src/services/cryptoService';
import { KeyService } from '../src/services/keyService';
import { buildSplitVersion, type SplitEntry } from '../src/utils/contributionSplit';
import { canonicalJson } from '../src/utils/forecastScoring';
// @ts-expect-error plain ESM module without types
import * as server from '../payments-api/split.mjs';

describe('payments-api parity with the client', () => {
  it('verifies split hashes and acceptances produced by the app', () => {
    const priv = KeyService.generatePrivateKey();
    const pub = KeyService.getPublicKey(priv);
    const entries: SplitEntry[] = [{ contributorId: pub, displayName: 'Me', role: 'writer', shareBps: 10_000 }];
    const v = buildSplitVersion({ workId: 'w', workKind: 'post', entries, proposedBy: pub, proposedAt: 1 }, null, CryptoService.hash);
    expect(server.verifyHistory([v])?.hash).toBe(v.hash);
    const a: any = { workId: 'w', version: 1, versionHash: v.hash, contributorId: pub, state: 'accepted', at: 2, pubkey: pub };
    a.signature = CryptoService.sign(CryptoService.hash(canonicalJson({ v: 1, type: 'contribution-acceptance', ...a })), priv);
    expect(server.verifyAcceptance(a)).toBe(true);
    expect(server.splitStatus(v, [a])).toBe('active');
  });
});
