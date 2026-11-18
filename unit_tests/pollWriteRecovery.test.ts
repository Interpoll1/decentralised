import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('../src/services/gunService', () => ({ GUN_NAMESPACE: 'v5', GunService: { getGun: () => {
  const node = (path = ''): any => ({ path, get: (key: string) => node(path + '/' + key) }); return node();
} } }));
vi.mock('../src/services/keyService', () => ({ KeyService: { getKeyPair: async () => ({
  privateKey: '01'.padStart(64, '0'),
  publicKey: '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
}) } }));
vi.mock('../src/services/keyVaultService', () => ({ KeyVaultService: { getKey: async () => null } }));
vi.mock('../src/services/contentPowService', () => ({ ContentPowService: { stamp: async () => 1 } }));
vi.mock('../src/services/humanGateService', () => ({ HumanGateService: {
  assertRateLimit: () => {}, requiredBits: () => 20, recordCreation: () => {},
} }));
import { PollService } from '../src/services/pollService';

const service = PollService as any;
const data = { communityId: 'c-fixture', authorId: 'fixture', authorName: 'Fixture', question: 'Choose?',
  options: ['A', 'B'], durationDays: 1, allowMultipleChoices: false, showResultsBeforeVoting: true,
  requireLogin: false, isPrivate: false };
beforeEach(() => {
  vi.spyOn(service, 'registerPollPolicyBestEffort').mockResolvedValue(undefined);
  vi.spyOn(service, 'verifyRelayPersistence').mockResolvedValue(true);
  vi.spyOn(service, 'saveLocalPollBackup').mockResolvedValue(undefined);
  vi.spyOn(service, 'putPromise').mockImplementation(async (_node, _value, opts: any) => {
    if (opts.label === 'poll root write' || opts.label === 'community poll write') opts.onTimeout();
  });
});
afterEach(() => vi.restoreAllMocks());
it('returns an offline-created poll when both local paths exist after write timeouts', async () => {
  vi.spyOn(service, 'onceNode').mockResolvedValue({ id: 'poll-fixture' });
  const wait = vi.spyOn(service, 'waitForNode');
  const result = await PollService.createPoll(data, 'poll-fixture');
  expect(result.id).toBe('poll-fixture'); expect(wait).not.toHaveBeenCalled();
});
it('repairs a missing community copy within the same confirmation scope', async () => {
  vi.spyOn(service, 'onceNode').mockResolvedValue(null);
  let communityReads = 0;
  vi.spyOn(service, 'waitForNode').mockImplementation(async (node: any) => {
    if (node.path.includes('/communities/')) return ++communityReads === 1 ? null : { id: 'poll-fixture' };
    return { id: 'poll-fixture' };
  });
  expect((await PollService.createPoll(data, 'poll-fixture')).id).toBe('poll-fixture');
  expect(service.putPromise).toHaveBeenCalledWith(expect.anything(), expect.anything(),
    expect.objectContaining({ label: 'community poll repair write (attempt 1)' }));
});
