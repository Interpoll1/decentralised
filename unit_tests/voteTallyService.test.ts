import { beforeEach, describe, expect, it, vi } from 'vitest';

const { eventSvc, storage } = vi.hoisted(() => ({
  eventSvc: { verifyEvent: vi.fn(() => true) },
  storage: { setMetadata: vi.fn(async () => {}), getMetadata: vi.fn(async () => null) },
}));
vi.mock('@/services/eventService', () => ({ EventService: eventSvc }));
vi.mock('@/services/storageService', () => ({ StorageService: storage }));

import { VoteTallyService } from '@/services/voteTallyService';

let pk = 0;
function pubkey(): string { return (++pk).toString(16).padStart(64, '0'); }

function voteEvent(opts: { pollId: string; option?: string; choice?: string; pubkey: string; ts?: number }) {
  const tags: string[][] = [['poll_id', opts.pollId]];
  if (opts.option) tags.push(['option', opts.option]);
  return {
    id: 'id', pubkey: opts.pubkey, created_at: opts.ts ?? 1000,
    kind: 101, tags, content: JSON.stringify({ choice: opts.choice ?? '', deviceId: 'd' }), sig: 'x',
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  eventSvc.verifyEvent.mockReturnValue(true);
  (VoteTallyService as any).polls.clear();
  (VoteTallyService as any).lastIngestAt.clear();
  const t = (VoteTallyService as any).persistTimer;
  if (t) { clearTimeout(t); (VoteTallyService as any).persistTimer = null; }
});

/** Force the poll's last-ingest time far into the past so the grace window expires. */
function expireGrace(pollId: string) {
  (VoteTallyService as any).lastIngestAt.set(pollId, Date.now() - 60_000);
}

describe('VoteTallyService', () => {
  it('tallies signed vote events per option', () => {
    VoteTallyService.ingest(voteEvent({ pollId: 'p1', option: 'A', pubkey: pubkey() }));
    VoteTallyService.ingest(voteEvent({ pollId: 'p1', option: 'A', pubkey: pubkey() }));
    VoteTallyService.ingest(voteEvent({ pollId: 'p1', option: 'B', pubkey: pubkey() }));

    const tally = VoteTallyService.getVerifiedTally('p1');
    expect(tally.total).toBe(3);
    expect(tally.byOption).toEqual({ A: 2, B: 1 });
  });

  it('falls back to the choice string when no option tag is present', () => {
    VoteTallyService.ingest(voteEvent({ pollId: 'p2', choice: 'Yes', pubkey: pubkey() }));
    expect(VoteTallyService.getVerifiedTally('p2').byOption).toEqual({ Yes: 1 });
  });

  it('dedupes by signer — one vote per voter, latest wins', () => {
    const voter = pubkey();
    VoteTallyService.ingest(voteEvent({ pollId: 'p3', option: 'A', pubkey: voter, ts: 100 }));
    VoteTallyService.ingest(voteEvent({ pollId: 'p3', option: 'B', pubkey: voter, ts: 200 })); // changed vote

    const tally = VoteTallyService.getVerifiedTally('p3');
    expect(tally.total).toBe(1);
    expect(tally.byOption).toEqual({ B: 1 });
  });

  it('ignores older duplicate events from the same voter', () => {
    const voter = pubkey();
    VoteTallyService.ingest(voteEvent({ pollId: 'p4', option: 'A', pubkey: voter, ts: 200 }));
    VoteTallyService.ingest(voteEvent({ pollId: 'p4', option: 'B', pubkey: voter, ts: 100 })); // stale
    expect(VoteTallyService.getVerifiedTally('p4').byOption).toEqual({ A: 1 });
  });

  it('rejects non-vote kinds and malformed pubkeys', () => {
    VoteTallyService.ingest({ ...voteEvent({ pollId: 'p5', option: 'A', pubkey: pubkey() }), kind: 100 } as any);
    VoteTallyService.ingest(voteEvent({ pollId: 'p5', option: 'A', pubkey: 'not-hex' }));
    expect(VoteTallyService.getVerifiedTotal('p5')).toBe(0);
  });

  it('ingestUntrusted rejects events with invalid signatures', () => {
    eventSvc.verifyEvent.mockReturnValue(false);
    const ok = VoteTallyService.ingestUntrusted(voteEvent({ pollId: 'p6', option: 'A', pubkey: pubkey() }));
    expect(ok).toBe(false);
    expect(VoteTallyService.getVerifiedTotal('p6')).toBe(0);
  });

  it('trustState: reported at or below the verified floor is verified', () => {
    for (let i = 0; i < 3; i++) VoteTallyService.ingest(voteEvent({ pollId: 'p7', option: 'A', pubkey: pubkey() }));
    expect(VoteTallyService.trustState('p7', 3)).toBe('verified');
    expect(VoteTallyService.trustState('p7', 2)).toBe('verified'); // stale-low Gun total
  });

  it('trustState: unproven surplus is partial during the grace window', () => {
    for (let i = 0; i < 3; i++) VoteTallyService.ingest(voteEvent({ pollId: 'p8', option: 'A', pubkey: pubkey() }));
    // Just ingested → in-flight votes plausible → don't alarm.
    expect(VoteTallyService.trustState('p8', 100)).toBe('partial');
    expect(VoteTallyService.looksInflated('p8', 100)).toBe(false);
  });

  it('trustState: unproven surplus becomes inflated once the grace window expires', () => {
    for (let i = 0; i < 3; i++) VoteTallyService.ingest(voteEvent({ pollId: 'p9', option: 'A', pubkey: pubkey() }));
    expireGrace('p9');
    expect(VoteTallyService.trustState('p9', 4)).toBe('inflated');   // any surplus, no slack
    expect(VoteTallyService.trustState('p9', 100)).toBe('inflated');
    expect(VoteTallyService.looksInflated('p9', 100)).toBe(true);
  });

  it('trustState: no verified evidence yet is unverified, never inflated', () => {
    expect(VoteTallyService.trustState('unknown', 999)).toBe('unverified');
    expect(VoteTallyService.looksInflated('unknown', 999)).toBe(false);
  });

  it('keeps tallies isolated per poll', () => {
    VoteTallyService.ingest(voteEvent({ pollId: 'pa', option: 'A', pubkey: pubkey() }));
    VoteTallyService.ingest(voteEvent({ pollId: 'pb', option: 'A', pubkey: pubkey() }));
    VoteTallyService.ingest(voteEvent({ pollId: 'pb', option: 'B', pubkey: pubkey() }));
    expect(VoteTallyService.getVerifiedTotal('pa')).toBe(1);
    expect(VoteTallyService.getVerifiedTotal('pb')).toBe(2);
  });
});

describe('VoteTallyService.getTieredTally (Sybil resistance)', () => {
  /** Force a stored vote's tier (tier resolution is async off the hot path). */
  function setTier(pollId: string, voter: string, tier: string) {
    const rec = (VoteTallyService as any).polls.get(pollId)?.get(voter);
    if (rec) rec.tier = tier;
  }

  it('keeps anonymous (potentially-Sybil) votes out of the verified track', () => {
    // Three Sybil keypairs (no evidence → anonymous) + one issuer-certified voter.
    for (let i = 0; i < 3; i++) VoteTallyService.ingest(voteEvent({ pollId: 'ps', option: 'A', pubkey: pubkey() }));
    const certified = pubkey();
    VoteTallyService.ingest(voteEvent({ pollId: 'ps', option: 'B', pubkey: certified }));
    setTier('ps', certified, 'issuer');

    const tally = VoteTallyService.getTieredTally('ps', 'issuer');
    expect(tally.verified.total).toBe(1);              // only the certified vote
    expect(tally.verified.byOption).toEqual({ B: 1 });
    expect(tally.open.total).toBe(3);                  // the Sybil keypairs
    expect(tally.open.byOption).toEqual({ A: 3 });
  });

  it('open policy puts every valid vote in the verified track', () => {
    for (let i = 0; i < 2; i++) VoteTallyService.ingest(voteEvent({ pollId: 'po', option: 'A', pubkey: pubkey() }));
    const tally = VoteTallyService.getTieredTally('po', 'open');
    expect(tally.verified.total).toBe(2);
    expect(tally.open.total).toBe(0);
  });

  it('pow-required: a pow-tier vote is verified, anonymous ones are open', () => {
    const powVoter = pubkey();
    VoteTallyService.ingest(voteEvent({ pollId: 'pp', option: 'A', pubkey: powVoter }));
    VoteTallyService.ingest(voteEvent({ pollId: 'pp', option: 'A', pubkey: pubkey() }));
    setTier('pp', powVoter, 'pow');

    const tally = VoteTallyService.getTieredTally('pp', 'pow');
    expect(tally.verified.total).toBe(1);
    expect(tally.open.total).toBe(1);
  });
});
