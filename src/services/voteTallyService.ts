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

const STORAGE_KEY = 'verified-vote-tally';
const PERSIST_DEBOUNCE_MS = 4_000;

export interface VerifiedTally {
  /** optionKey (option id if present, else the choice string) → distinct voters. */
  byOption: Record<string, number>;
  /** distinct voters across the poll. */
  total: number;
}

interface VoteRecord {
  optionKey: string;
  ts: number; // event created_at (seconds)
}

export class VoteTallyService {
  // pollId → (voterPubkey → latest vote). One vote per signer per poll; latest wins.
  private static polls = new Map<string, Map<string, VoteRecord>>();
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

    const existing = pollVotes.get(voter);
    if (existing && existing.ts >= ts) return false; // keep the latest vote per voter
    pollVotes.set(voter, { optionKey, ts });
    this.schedulePersist();
    return true;
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
   * True when the Gun-reported total materially exceeds the verified tally —
   * a possible forgery/inflation signal. Allows a small slack for votes whose
   * signed events simply haven't reached this client yet.
   */
  static looksInflated(pollId: string, reportedTotal: number): boolean {
    const verified = this.getVerifiedTotal(pollId);
    if (verified === 0) return false; // no evidence either way
    return reportedTotal > verified * 2 && reportedTotal - verified >= 5;
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
            m.set(voter, { optionKey: rec.optionKey, ts: Number(rec.ts) || 0 });
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
