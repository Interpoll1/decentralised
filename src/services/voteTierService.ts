/**
 * voteTierService — resolves the Sybil-resistance *trust tier* of a signed vote.
 *
 * A vote's tier is the strongest piece of evidence it carries that verifies
 * offline (see EventService.createVoteEvent for the tag format):
 *   issuer (3)   — a TrustService issuer certificate binding this exact pubkey
 *   relay  (2)   — a relay attestation over {voterPubkey, pollId} (relay vouched
 *                  a distinct device/OAuth identity)
 *   pow    (1)   — a self-contained vote proof-of-work
 *   anonymous(0) — a valid signature only (Sybil-cheap)
 *
 * Everything except the issuer list (cached in TrustService) is verified with no
 * network, so this runs at tally time. Sybil keypairs — which can produce a valid
 * signature but not a cert or attestation — resolve to `anonymous`.
 */

import type { NostrEvent } from '@/types/nostr';
import type { Poll } from '@/types/poll';
import { TrustService, type TrustCertificate } from '@/services/trustService';
import { CryptoService } from '@/services/cryptoService';
import { verifyVotePow, VOTE_POW_DIFFICULTY } from '@/utils/votePow';
import config from '@/config';

/** Sybil-resistance evidence to attach to a vote (see EventService.createVoteEvent). */
export interface VoteEvidence {
  powDifficulty?: number;
  trustCert?: unknown;
  relayAttestation?: { payload: string; sig: string };
}

export type VoteTier = 'anonymous' | 'pow' | 'relay' | 'issuer';

/** Policy required tier as chosen by a poll creator. `open` === anonymous. */
export type RequiredTier = 'open' | 'pow' | 'relay' | 'issuer';

const TIER_RANK: Record<VoteTier, number> = { anonymous: 0, pow: 1, relay: 2, issuer: 3 };
const REQUIRED_RANK: Record<RequiredTier, number> = { open: 0, pow: 1, relay: 2, issuer: 3 };

/** True when a vote of `tier` satisfies a poll's `required` tier. */
export function meetsTier(tier: VoteTier, required: RequiredTier): boolean {
  return TIER_RANK[tier] >= REQUIRED_RANK[required];
}

function tag(event: NostrEvent, name: string): string[] | undefined {
  if (!Array.isArray(event.tags)) return undefined;
  return event.tags.find((t) => Array.isArray(t) && t[0] === name);
}

export class VoteTierService {
  /**
   * Best-effort evidence to reach a poll's required tier for the current user.
   * Additive and non-blocking: an issuer cert (if held) is always attached; PoW
   * is solved only when the poll needs `pow` and the user has no cert (so we
   * don't burn CPU when already higher-tier). If the required tier can't be met
   * (e.g. `relay`/`issuer` with no credential), the vote still proceeds and
   * simply lands in the Open track. Relay attestations are fetched separately by
   * the vote flow (backend-dependent) and merged in by the caller.
   */
  static async gatherEvidence(poll: Pick<Poll, 'voteTrustPolicy'>): Promise<VoteEvidence> {
    const required = poll.voteTrustPolicy?.requiredTier ?? 'open';
    if (required === 'open') return {};

    const evidence: VoteEvidence = {};
    try {
      const cert = await TrustService.getMyCertificate();
      if (cert) evidence.trustCert = cert;
    } catch { /* no cert available */ }

    if (!evidence.trustCert && required === 'pow') {
      evidence.powDifficulty = VOTE_POW_DIFFICULTY;
    }
    return evidence;
  }

  /** Highest tier whose evidence on `event` verifies. Never throws. */
  static async tierOf(event: NostrEvent): Promise<VoteTier> {
    if (await this.hasValidIssuerCert(event)) return 'issuer';
    if (this.hasValidRelayAttestation(event)) return 'relay';
    if (this.hasValidPow(event)) return 'pow';
    return 'anonymous';
  }

  private static async hasValidIssuerCert(event: NostrEvent): Promise<boolean> {
    const t = tag(event, 'trust_cert');
    if (!t || typeof t[1] !== 'string') return false;
    let cert: TrustCertificate;
    try {
      cert = JSON.parse(t[1]);
    } catch {
      return false;
    }
    // The cert must bind THIS voter's pubkey, not some other user's.
    if (!cert || cert.userPubkey !== event.pubkey) return false;
    try {
      const issuers = await TrustService.getIssuers();
      return issuers.some((issuer) => TrustService.verifyCertificate(cert, issuer));
    } catch {
      return false;
    }
  }

  private static hasValidRelayAttestation(event: NostrEvent): boolean {
    const t = tag(event, 'relay_att');
    if (!t || typeof t[1] !== 'string' || typeof t[2] !== 'string') return false;
    const relayPubkey = config.security.relayAttestationPubkey;
    if (!relayPubkey) return false; // no configured relay key → cannot verify
    let payload: { voterPubkey?: string; pollId?: string };
    try {
      payload = JSON.parse(t[1]);
    } catch {
      return false;
    }
    // Attestation must be for this voter and this poll.
    if (payload.voterPubkey !== event.pubkey) return false;
    const pollId = tag(event, 'poll_id')?.[1];
    if (!pollId || payload.pollId !== pollId) return false;
    try {
      return CryptoService.verify(t[1], t[2], relayPubkey);
    } catch {
      return false;
    }
  }

  private static hasValidPow(event: NostrEvent): boolean {
    const t = tag(event, 'pow');
    if (!t || typeof t[1] !== 'string') return false;
    const nonce = Number(t[1]);
    if (!Number.isInteger(nonce)) return false;
    const pollId = tag(event, 'poll_id')?.[1];
    if (!pollId) return false;
    return verifyVotePow(event.pubkey, pollId, Number(event.created_at) || 0, nonce);
  }
}

export default VoteTierService;
