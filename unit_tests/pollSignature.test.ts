import { expect, it } from 'vitest';
import { CryptoService } from '../src/services/cryptoService';
import { verifyPollSignature } from '../src/utils/pollSignature';
import { schnorr } from '@noble/curves/secp256k1.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import type { Poll } from '../src/types/poll';
import { vi, afterEach } from 'vitest';
import { PollService } from '../src/services/pollService';
import { StorageService } from '../src/services/storageService';

afterEach(() => vi.restoreAllMocks());

const privateKey = '02'.padStart(64, '0'); // Synthetic fixture only.
function signed(withPolicy = true): Poll {
  const poll: Poll = { id: 'poll-signature-fixture', communityId: 'c-test', authorId: 'test-author',
    authorName: 'Fixture', question: 'Choose?', description: '', options: [{ id: 'a', text: 'A', votes: 0, voters: [] }],
    createdAt: 1794880000000, expiresAt: 1795880000000, allowMultipleChoices: false,
    showResultsBeforeVoting: true, requireLogin: false, isPrivate: false, totalVotes: 0, isExpired: false,
    authorPubkey: bytesToHex(schnorr.getPublicKey(hexToBytes(privateKey))),
    ...(withPolicy ? { voteTrustPolicy: { requiredTier: 'issuer', mode: 'gate' } as const } : {}),
  };
  const payload = { question: poll.question, communityId: poll.communityId, timestamp: poll.createdAt,
    ...(withPolicy ? { voteTrustPolicy: poll.voteTrustPolicy } : {}) };
  poll.contentSignature = CryptoService.sign(CryptoService.hash(JSON.stringify(payload)), privateKey);
  return poll;
}
it('verifies the exact legacy signed fields and rejects policy weakening', () => {
  const poll = signed();
  expect(verifyPollSignature(poll)).toBe('legacy-verified');
  for (const change of [{ question: 'Changed?' }, { communityId: 'other' }, { createdAt: poll.createdAt + 1 },
    { voteTrustPolicy: { requiredTier: 'open', mode: 'separate' } }, { voteTrustPolicy: undefined },
    { contentSignature: '00'.repeat(64) }, { authorPubkey: '00'.repeat(32) }]) {
    expect(verifyPollSignature({ ...poll, ...change } as Poll)).toBe('invalid');
  }
});
it('recognizes pre-policy signatures without retroactively authenticating a policy', () => {
  const poll = signed(false);
  expect(verifyPollSignature(poll)).toBe('legacy-verified');
  expect(verifyPollSignature({ ...poll, voteTrustPolicy: { requiredTier: 'issuer', mode: 'gate' } })).toBe('invalid');
});
it('distinguishes unsigned, incomplete and encrypted descriptors', () => {
  const poll = signed();
  expect(verifyPollSignature({ ...poll, authorPubkey: undefined, contentSignature: undefined })).toBe('unsigned');
  expect(verifyPollSignature({ ...poll, contentSignature: undefined })).toBe('invalid');
  expect(verifyPollSignature({ ...poll, isEncrypted: true, question: 'Encrypted' })).toBe('encrypted');
});
it('does not claim legacy signatures bind options or tally counters', () => {
  const poll = signed();
  expect(verifyPollSignature({ ...poll, options: [], totalVotes: 999 })).toBe('legacy-verified');
});
it('read normalization and offline backups reject altered signed content', async () => {
  const poll = signed();
  const service = PollService as any;
  expect(service.buildPollRecord(poll, poll.options)?.signatureStatus).toBe('legacy-verified');
  expect(service.buildPollRecord({ ...poll, question: 'tampered' }, poll.options)).toBeNull();
  vi.spyOn(StorageService, 'getMetadata').mockResolvedValue({
    original: { poll, backedUpAt: Date.now() },
    changed: { poll: { ...poll, question: 'tampered', signatureStatus: 'legacy-verified' }, backedUpAt: Date.now() },
  });
  const cached = await service.readLocalPollMap();
  expect(Object.keys(cached)).toEqual(['original']);
  expect(cached.original.poll.signatureStatus).toBe('legacy-verified');
});
