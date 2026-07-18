/**
 * Verified vote tally (CRITICAL-2 mitigation).
 *
 * Poll counts shown in the UI come from the Gun graph, which any peer/relay can
 * forge. Meanwhile every vote is ALSO cast as a Schnorr-signed Nostr kind-101
 * event that already broadcasts across the network — but the app used to verify
 * and then throw those away. This service keeps them: it aggregates the signed
 * vote events into a per-poll, per-option tally, deduped by signer, that the UI
 * can trust and cross-check against the forgeable Gun total.
 *
 * Honest scope: a client only holds the events that actually reached it, so the
 * verified tally is a trustworthy **lower bound** on the true global count — used
 * for a "verified" display + forgery flagging, not as a global consensus number.
 */

import { EventService } from '@/services/eventService';
import { EventKind, type NostrEvent } from '@/types/nostr';
import { StorageService } from '@/services/storageService';
import { VoteTierService, meetsTier, type VoteTier, type RequiredTier } from '@/services/voteTierService';

const STORAGE_KEY = 'verified-vote-tally';
const PERSIST_DEBOUNCE_MS = 4_000;

// A Gun total above the verified tally is only "surplus that hasn't been proven
// yet" for a short window after the last signed event lands — signed events and
// the Gun count-write typically arrive within a second or two of each other, but
// mesh/relay lag can stretch that. Past this grace window, unproven surplus is
// treated as inflation rather than in-flight votes.
const INFLATION_GRACE_MS = 30_000;

/**
 * Trust state of a poll's *displayed* (Gun-reported) total relative to the
 * signature-verified lower bound:
 * - `verified`   — reported total is fully backed by signed events.
 * - `partial`    — reported exceeds verified, but a signed event landed recently,
 *                  so the surplus is plausibly in-flight votes. Show, don't alarm.
 * - `unverified` — no signed events have reached this client, so nothing can be
 *                  confirmed either way.
 * - `inflated`   — reported exceeds verified and the grace window has elapsed:
 *                  a likely forged/inflated count.
 */
export type PollTrustState = 'verified' | 'partial' | 'unverified' | 'inflated';

export interface VerifiedTally {
  /** optionKey (option id if present, else the choice string) → distinct voters. */
  byOption: Record<string, number>;
  /** distinct voters across the poll. */
  total: number;
}

/**
 * Two disjoint result tracks for a poll under a Sybil-resistance policy:
 * `verified` = voters whose tier meets the required tier; `open` = everyone else
 * (valid signed votes that did not meet it). Sum = all distinct voters.
 */
export interface TieredTally {
  verified: VerifiedTally;
  open: VerifiedTally;
}

interface VoteRecord {
  optionKey: string;
  ts: number; // event created_at (seconds)
  tier: VoteTier; // Sybil-resistance tier; starts 'anonymous', upgraded async
}

export class VoteTallyService {
  // pollId → (voterPubkey → latest vote). One vote per signer per poll; latest wins.
  private static polls = new Map<string, Map<string, VoteRecord>>();
  // pollId → wall-clock ms of the most recently ingested event, used to decide
  // whether unproven Gun surplus is plausibly in-flight (partial) vs inflated.
  private static lastIngestAt = new Map<string, number>();
  private static loaded = false;
  private static persistTimer: ReturnType<typeof setTimeout> | null = null;

  /** Load the persisted tally and start backfilling from the Gun events root. */
  static async initialize(): Promise<void> {
    await this.load();
    this.backfillFromGun();
  }

  /** Ingest an already-signature-verified kind-101 event (hot path). */
  static ingest(event: NostrEvent): boolean {
    if (!event || event.kind !== EventKind.VOTE_CAST) return false;
    const pollId = this.tag(event, 'poll_id');
    if (!pollId) return false;

    let optionKey = this.tag(event, 'option');
    if (!optionKey) {
      try { optionKey = String((JSON.parse(event.content) || {}).choice || ''); } catch { optionKey = ''; }
    }
    if (!optionKey) return false;

    const voter = String(event.pubkey || '');
    if (!/^[0-9a-f]{64}$/i.test(voter)) return false;
    const ts = Number(event.created_at) || 0;

    let pollVotes = this.polls.get(pollId);
    if (!pollVotes) { pollVotes = new Map(); this.polls.set(pollId, pollVotes); }

    // Track receipt time regardless of dedup outcome — any signed event landing
    // for this poll means counts are actively syncing, which resets the grace
    // window used by trustState.
    this.lastIngestAt.set(pollId, Date.now());

    const existing = pollVotes.get(voter);
    if (existing && existing.ts >= ts) return false; // keep the latest vote per voter
    pollVotes.set(voter, { optionKey, ts, tier: 'anonymous' });
    this.resolveTierAsync(pollId, voter, ts, event);
    this.schedulePersist();
    return true;
  }

  /**
   * Resolve a vote's Sybil-resistance tier off the hot path (issuer-cert checks
   * touch the cached issuer list). The record is stored as `anonymous` first and
   * upgraded here; guarded so a stale resolution can't clobber a newer vote.
   */
  private static resolveTierAsync(pollId: string, voter: string, ts: number, event: NostrEvent): void {
    void VoteTierService.tierOf(event).then((tier) => {
      if (tier === 'anonymous') return;
      const rec = this.polls.get(pollId)?.get(voter);
      if (rec && rec.ts === ts && rec.tier !== tier) {
        rec.tier = tier;
        this.schedulePersist();
      }
    }).catch(() => { /* leave at anonymous */ });
  }

  /** Verify an untrusted event (e.g. from Gun) before ingesting it. */
  static ingestUntrusted(event: NostrEvent): boolean {
    try {
      if (!EventService.verifyEvent(event)) return false;
    } catch {
      return false;
    }
    return this.ingest(event);
  }

  /** Verified per-option counts for a poll (deduped by signer). */
  static getVerifiedTally(pollId: string): VerifiedTally {
    const byOption: Record<string, number> = {};
    let total = 0;
    const pollVotes = this.polls.get(pollId);
    if (pollVotes) {
      for (const { optionKey } of pollVotes.values()) {
        byOption[optionKey] = (byOption[optionKey] || 0) + 1;
        total += 1;
      }
    }
    return { byOption, total };
  }

  static getVerifiedTotal(pollId: string): number {
    return this.polls.get(pollId)?.size ?? 0;
  }

  /**
   * Split a poll's votes into two disjoint tracks by the creator's required tier.
   * Sybil keypairs — which resolve to `anonymous` — cannot enter the `verified`
   * track unless the policy is `open`. `open` required tier puts every valid vote
   * in `verified` and leaves `open` empty.
   */
  static getTieredTally(pollId: string, requiredTier: RequiredTier): TieredTally {
    const mk = (): VerifiedTally => ({ byOption: {}, total: 0 });
    const verified = mk();
    const open = mk();
    const pollVotes = this.polls.get(pollId);
    if (pollVotes) {
      for (const { optionKey, tier } of pollVotes.values()) {
        const track = meetsTier(tier, requiredTier) ? verified : open;
        track.byOption[optionKey] = (track.byOption[optionKey] || 0) + 1;
        track.total += 1;
      }
    }
    return { verified, open };
  }

  /**
   * Trust state of a Gun-reported total against the signed lower bound.
   *
   * The verified tally is an honest lower bound (a client only holds the signed
   * events that reached it), so:
   * - reported ≤ verified is always trustworthy (`verified`);
   * - reported > verified is *unproven surplus* — `partial` while signed events
   *   are still landing (grace window), otherwise `inflated`;
   * - zero verified evidence is `unverified`.
   */
  static trustState(pollId: string, reportedTotal: number): PollTrustState {
    const verified = this.getVerifiedTotal(pollId);
    if (verified === 0) return 'unverified';
    if (reportedTotal <= verified) return 'verified';
    const lastAt = this.lastIngestAt.get(pollId) ?? 0;
    if (Date.now() - lastAt < INFLATION_GRACE_MS) return 'partial';
    return 'inflated';
  }

  /**
   * True when the Gun-reported total is unproven surplus that the grace window
   * has already expired on — a likely forgery/inflation signal. Thin wrapper
   * over {@link trustState} kept for existing call sites.
   */
  static looksInflated(pollId: string, reportedTotal: number): boolean {
    return this.trustState(pollId, reportedTotal) === 'inflated';
  }

  private static backfillFromGun(): void {
    void (async () => {
      try {
        const { GunService } = await import('@/services/gunService');
        GunService.map('events', (raw: unknown) => {
          if (raw && typeof raw === 'object') this.ingestUntrusted(raw as NostrEvent);
        });
      } catch {
        // Gun unavailable; hot-path ingestion still works.
      }
    })();
  }

  private static tag(event: NostrEvent, name: string): string {
    if (!Array.isArray(event.tags)) return '';
    for (const t of event.tags) {
      if (Array.isArray(t) && t[0] === name && typeof t[1] === 'string') return t[1];
    }
    return '';
  }

  private static schedulePersist(): void {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      void this.persist();
    }, PERSIST_DEBOUNCE_MS);
  }

  private static async persist(): Promise<void> {
    try {
      const flat: Record<string, Record<string, VoteRecord>> = {};
      for (const [pollId, voters] of this.polls) {
        flat[pollId] = Object.fromEntries(voters);
      }
      await StorageService.setMetadata(STORAGE_KEY, flat);
    } catch {
      // Best-effort persistence.
    }
  }

  private static async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const flat = await StorageService.getMetadata(STORAGE_KEY) as
        Record<string, Record<string, VoteRecord>> | undefined;
      if (!flat || typeof flat !== 'object') return;
      for (const [pollId, voters] of Object.entries(flat)) {
        const m = new Map<string, VoteRecord>();
        for (const [voter, rec] of Object.entries(voters || {})) {
          if (rec && typeof rec.optionKey === 'string') {
            const tier: VoteTier = (['anonymous', 'pow', 'relay', 'issuer'] as const)
              .includes(rec.tier as VoteTier) ? (rec.tier as VoteTier) : 'anonymous';
            m.set(voter, { optionKey: rec.optionKey, ts: Number(rec.ts) || 0, tier });
          }
        }
        if (m.size > 0) this.polls.set(pollId, m);
      }
    } catch {
      // Corrupt/unavailable — start empty.
    }
  }
}

export default VoteTallyService;
