/**
 * engagementTierService — resolves the Sybil-resistance *trust tier* of any
 * signed engagement, not just a poll vote.
 *
 * `voteTierService` established the ladder for poll votes:
 *
 *   issuer (3)    — a TrustService issuer certificate binding this exact pubkey
 *   relay  (2)    — a relay attestation over {pubkey, target} (relay vouched a
 *                   distinct device/OAuth identity)
 *   pow    (1)    — a self-contained proof of work bound to the action
 *   anonymous (0) — a valid signature only (Sybil-cheap)
 *
 * Nothing about that ladder is vote-specific, and likes/comments are exactly
 * where batch-purchased engagement lands. This service generalises it to any
 * action over any target, so a surface can show "18 verified · 4,282 open"
 * instead of one merged number a farm can deliver against.
 *
 * The record shape is deliberately NOT `NostrEvent`: post votes and comments
 * live in the Gun graph as per-user nodes, not Nostr events. `fromNostrEvent`
 * adapts events that are.
 *
 * Everything except the issuer list (cached in TrustService) verifies with no
 * network, so this runs at render/tally time.
 */

import { TrustService, type TrustCertificate } from '@/services/trustService';
import { CryptoService } from '@/services/cryptoService';
import { meetsTier, type VoteTier, type RequiredTier } from '@/services/voteTierService';
import {
  verifyEngagementPow,
  ENGAGEMENT_POW_DIFFICULTY,
  type EngagementKind,
} from '@/utils/engagementPow';
import type { NostrEvent } from '@/types/nostr';
import config from '@/config';

/** The tier ladder is shared with poll votes — one vocabulary across surfaces. */
export type EngagementTier = VoteTier;
export type { RequiredTier };
export { meetsTier };

/** Sybil-resistance evidence attached to an engagement action. */
export interface EngagementEvidence {
  /** Solved nonce for the action's self-contained PoW. */
  pow?: number;
  /** Issuer certificate; accepted as an object or its JSON encoding. */
  trustCert?: TrustCertificate | string;
  /** Relay attestation: a signed JSON payload naming the actor and target. */
  relayAttestation?: { payload: string; sig: string };
}

/** One engagement action, with whatever evidence its author attached. */
export interface EngagementRecord {
  kind: EngagementKind;
  /** Actor's x-only pubkey (hex). */
  pubkey: string;
  /** Post id, comment id, poll id — whatever was acted upon. */
  targetId: string;
  /** Unix seconds. */
  createdAt: number;
  evidence?: EngagementEvidence;
}

/** Distinct actors on each side of a poll's/post's required tier. */
export interface TierSplit {
  /** Actors whose tier meets the required tier. */
  verified: number;
  /** Actors with a valid action that did not meet it. */
  open: number;
  /** Per-tier distinct-actor counts, for the provenance panel. */
  byTier: Record<EngagementTier, number>;
}

function parseCert(raw: TrustCertificate | string): TrustCertificate | null {
  if (typeof raw !== 'string') return raw ?? null;
  try {
    return JSON.parse(raw) as TrustCertificate;
  } catch {
    return null;
  }
}

export class EngagementTierService {
  /** Highest tier whose evidence on `record` verifies. Never throws. */
  static async tierOf(record: EngagementRecord): Promise<EngagementTier> {
    if (await this.hasValidIssuerCert(record)) return 'issuer';
    if (this.hasValidRelayAttestation(record)) return 'relay';
    if (this.hasValidPow(record)) return 'pow';
    return 'anonymous';
  }

  /**
   * Tier every record and count *distinct actors* on each side of `required`.
   *
   * Deduping by pubkey matters as much here as it does in the vote tally: a
   * farm that re-likes from the same key must not count twice. An actor who
   * acted several times is credited with their strongest tier.
   */
  static async splitByTier(
    records: EngagementRecord[],
    required: RequiredTier = 'open',
  ): Promise<TierSplit> {
    const strongest = new Map<string, EngagementTier>();
    const rank: Record<EngagementTier, number> = { anonymous: 0, pow: 1, relay: 2, issuer: 3 };

    for (const record of records) {
      if (!record?.pubkey) continue;
      const tier = await this.tierOf(record);
      const current = strongest.get(record.pubkey);
      if (!current || rank[tier] > rank[current]) strongest.set(record.pubkey, tier);
    }

    const split: TierSplit = {
      verified: 0,
      open: 0,
      byTier: { anonymous: 0, pow: 0, relay: 0, issuer: 0 },
    };
    for (const tier of strongest.values()) {
      split.byTier[tier]++;
      if (meetsTier(tier, required)) split.verified++;
      else split.open++;
    }
    return split;
  }

  /** Adapt a signed Nostr event (tag-encoded evidence) to an EngagementRecord. */
  static fromNostrEvent(
    event: NostrEvent,
    kind: EngagementKind,
    targetTag: string,
  ): EngagementRecord | null {
    const tags = Array.isArray(event?.tags) ? event.tags : [];
    const tag = (name: string) => tags.find((t) => Array.isArray(t) && t[0] === name);
    const targetId = tag(targetTag)?.[1];
    if (!targetId || !event.pubkey) return null;

    const evidence: EngagementEvidence = {};
    const pow = tag('pow')?.[1];
    if (typeof pow === 'string' && Number.isInteger(Number(pow))) evidence.pow = Number(pow);
    const cert = tag('trust_cert')?.[1];
    if (typeof cert === 'string') evidence.trustCert = cert;
    const att = tag('relay_att');
    if (att && typeof att[1] === 'string' && typeof att[2] === 'string') {
      evidence.relayAttestation = { payload: att[1], sig: att[2] };
    }

    return {
      kind,
      pubkey: event.pubkey,
      targetId,
      createdAt: Number(event.created_at) || 0,
      evidence,
    };
  }

  private static async hasValidIssuerCert(record: EngagementRecord): Promise<boolean> {
    const raw = record.evidence?.trustCert;
    if (!raw) return false;
    const cert = parseCert(raw);
    // The cert must bind THIS actor's pubkey, not some other user's.
    if (!cert || cert.userPubkey !== record.pubkey) return false;
    try {
      const issuers = await TrustService.getIssuers();
      return issuers.some((issuer) => TrustService.verifyCertificate(cert, issuer));
    } catch {
      return false;
    }
  }

  private static hasValidRelayAttestation(record: EngagementRecord): boolean {
    const att = record.evidence?.relayAttestation;
    if (!att || typeof att.payload !== 'string' || typeof att.sig !== 'string') return false;
    const relayPubkey = config.security.relayAttestationPubkey;
    if (!relayPubkey) return false; // no configured relay key → cannot verify

    let payload: { voterPubkey?: string; pubkey?: string; pollId?: string; targetId?: string };
    try {
      payload = JSON.parse(att.payload);
    } catch {
      return false;
    }
    // Accept the vote-flow payload shape as well as the generic one.
    const actor = payload.pubkey ?? payload.voterPubkey;
    const target = payload.targetId ?? payload.pollId;
    if (actor !== record.pubkey || target !== record.targetId) return false;

    try {
      return CryptoService.verify(att.payload, att.sig, relayPubkey);
    } catch {
      return false;
    }
  }

  private static hasValidPow(record: EngagementRecord): boolean {
    const nonce = record.evidence?.pow;
    if (nonce === undefined) return false;
    return verifyEngagementPow(
      record.kind,
      record.pubkey,
      record.targetId,
      record.createdAt,
      nonce,
      ENGAGEMENT_POW_DIFFICULTY[record.kind],
    );
  }
}

export default EngagementTierService;
