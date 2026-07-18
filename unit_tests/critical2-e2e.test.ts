/**
 * CRITICAL-2 end-to-end proof — NO crypto mocks.
 *
 * Uses the real EventService (real Schnorr signing/verification via @noble/curves),
 * the real VoteTallyService, and the real useVerifiedPollResults composable
 * together. Only StorageService (IndexedDB persistence) is stubbed. This proves:
 *   1. A forged/inflated Gun total cannot raise the displayed count — it collapses
 *      to the signature-verified floor and is flagged `inflated`.
 *   2. Only genuinely-signed votes are counted; tampered/unsigned events are rejected
 *      by real signature verification.
 *   3. The mesh wire bridge drops a forged out-of-namespace graph write in enforce mode.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ref } from 'vue';
import { schnorr } from '@noble/curves/secp256k1.js';
import { bytesToHex } from '@noble/hashes/utils';

// Only stub persistence (IndexedDB) — every crypto path stays real.
vi.mock('@/services/storageService', () => ({
  StorageService: { setMetadata: vi.fn(async () => {}), getMetadata: vi.fn(async () => null) },
}));

import { EventService } from '@/services/eventService';
import { VoteTallyService } from '@/services/voteTallyService';
import { useVerifiedPollResults } from '@/composables/useVerifiedPollResults';
import { GunService } from '@/services/gunService';
import { EventKind } from '@/types/nostr';
import type { Poll, PollOption } from '@/types/poll';
import config from '@/config';

/** Mint a distinct real keypair (one per voter → distinct signer). */
function newVoter(): { priv: string; pub: string } {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const priv = bytesToHex(bytes);
  const pub = bytesToHex(schnorr.getPublicKey(bytes)); // x-only, 64 hex chars
  return { priv, pub };
}

/** Build a genuinely Schnorr-signed kind-101 vote event, exactly like the app. */
function signedVote(pollId: string, optionId: string, voter: { priv: string; pub: string }) {
  const unsigned = {
    pubkey: voter.pub,
    created_at: Math.floor(Date.now() / 1000),
    kind: EventKind.VOTE_CAST,
    tags: [['poll_id', pollId], ['option', optionId]],
    content: JSON.stringify({ choice: optionId, deviceId: 'd' }),
  };
  const id = EventService.computeEventId(unsigned);
  const sig = EventService.signEventId(id, voter.priv);
  return { ...unsigned, id, sig } as any;
}

function opt(id: string, votes: number): PollOption {
  return { id, text: id, votes, voters: [] };
}
function poll(id: string, options: PollOption[], totalVotes: number): Poll {
  return { id, options, totalVotes } as Poll;
}

function expireGrace(pollId: string) {
  (VoteTallyService as any).lastIngestAt.set(pollId, Date.now() - 60_000);
}

beforeEach(() => {
  (VoteTallyService as any).polls.clear();
  (VoteTallyService as any).lastIngestAt.clear();
  const t = (VoteTallyService as any).persistTimer;
  if (t) { clearTimeout(t); (VoteTallyService as any).persistTimer = null; }
  config.setWireFilterMode('log');
});

describe('CRITICAL-2 end-to-end (real crypto)', () => {
  it('rejects an inflated Gun total: display collapses to the signed floor', () => {
    // Two real, independently-signed votes actually reach this client.
    expect(VoteTallyService.ingestUntrusted(signedVote('poll-x', 'A', newVoter()))).toBe(true);
    expect(VoteTallyService.ingestUntrusted(signedVote('poll-x', 'A', newVoter()))).toBe(true);

    // A malicious peer forges a Gun node claiming 1000 votes.
    const forged = ref(poll('poll-x', [opt('A', 1000), opt('B', 0)], 1000));
    const r = useVerifiedPollResults(forged);

    expireGrace('poll-x'); // let the in-flight grace window lapse

    expect(r.verifiedTotal.value).toBe(2);      // only 2 votes are cryptographically real
    expect(r.trust.value).toBe('inflated');     // the surplus is flagged
    expect(r.displayTotal.value).toBe(2);        // the forged 1000 never shows
    expect(r.percent(opt('A', 1000))).toBe(100); // bar honors the verified floor, capped
  });

  it('counts only genuinely-signed votes — tampered events are rejected by real verification', () => {
    const voter = newVoter();
    const good = signedVote('poll-y', 'A', voter);

    // Tamper with the content AFTER signing → id/sig no longer match.
    const tampered = { ...good, content: JSON.stringify({ choice: 'B', deviceId: 'd' }) };
    // Forge a signature with a different key for the same id → signature invalid.
    const impostor = { ...good, pubkey: newVoter().pub };

    expect(VoteTallyService.ingestUntrusted(good)).toBe(true);
    expect(VoteTallyService.ingestUntrusted(tampered)).toBe(false);
    expect(VoteTallyService.ingestUntrusted(impostor)).toBe(false);

    expect(VoteTallyService.getVerifiedTotal('poll-y')).toBe(1); // only the real one counts
  });

  it('accepts a truthful Gun total that the signatures back', () => {
    for (let i = 0; i < 3; i++) {
      VoteTallyService.ingestUntrusted(signedVote('poll-z', 'A', newVoter()));
    }
    const honest = ref(poll('poll-z', [opt('A', 3)], 3));
    const r = useVerifiedPollResults(honest);
    expect(r.trust.value).toBe('verified');
    expect(r.displayTotal.value).toBe(3);
  });

  it('mesh wire bridge drops a forged out-of-namespace graph write (enforce)', () => {
    const inbound: unknown[] = [];
    (GunService as unknown as { gun: unknown }).gun = {
      _: { on(ev: string, arg: unknown) { if (ev === 'in') inbound.push(arg); } },
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    config.setWireFilterMode('enforce');

    const bridge = GunService.attachWireBridge(() => {});
    // Attacker tries to write a node outside the app namespace over the mesh.
    bridge.receive({ '#': 'atk', put: { 'evil/backdoor': { pwn: true } } });
    // A legitimate in-namespace poll update still flows.
    bridge.receive({ '#': 'ok', put: { 'v3/polls/poll-x': { totalVotes: 3 } } });

    expect(inbound.some((m) => (m as any)['#'] === 'atk')).toBe(false); // forged write blocked
    expect(inbound.some((m) => (m as any)['#'] === 'ok')).toBe(true);   // real sync unaffected

    warn.mockRestore();
    config.setWireFilterMode('log');
  });
});
