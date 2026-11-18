import { CryptoService } from '../services/cryptoService';
import type { Poll } from '../types/poll';

export type PollSignatureStatus = 'legacy-verified' | 'unsigned' | 'invalid' | 'encrypted';

/** Verify only the fields actually signed by historical poll writers.
 * This does not authenticate options, result counters, author display names or a whole poll.
 * A canonical, fully bound replacement requires a separately versioned protocol migration.
 */
export function verifyPollSignature(poll: Poll): PollSignatureStatus {
  if (!poll.authorPubkey && !poll.contentSignature) return 'unsigned';
  if (!poll.authorPubkey || !poll.contentSignature) return 'invalid';
  if (poll.isEncrypted) return 'encrypted';
  const payload = {
    question: poll.question, communityId: poll.communityId, timestamp: poll.createdAt,
    voteTrustPolicy: poll.voteTrustPolicy || null,
  };
  if (CryptoService.verify(CryptoService.hash(JSON.stringify(payload)), poll.contentSignature, poll.authorPubkey)) {
    return 'legacy-verified';
  }
  // Pre-policy signatures did not carry the policy field. They may only verify with no policy.
  if (!poll.voteTrustPolicy) {
    const older = { question: poll.question, communityId: poll.communityId, timestamp: poll.createdAt };
    if (CryptoService.verify(CryptoService.hash(JSON.stringify(older)), poll.contentSignature, poll.authorPubkey)) return 'legacy-verified';
  }
  return 'invalid';
}
