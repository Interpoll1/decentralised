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
  const t = (VoteTallyService as any).persistTimer;
  if (t) { clearTimeout(t); (VoteTallyService as any).persistTimer = null; }
});

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

  it('flags a Gun total that materially exceeds the verified tally', () => {
    for (let i = 0; i < 3; i++) VoteTallyService.ingest(voteEvent({ pollId: 'p7', option: 'A', pubkey: pubkey() }));
    expect(VoteTallyService.looksInflated('p7', 4)).toBe(false);  // within slack
    expect(VoteTallyService.looksInflated('p7', 100)).toBe(true); // wildly inflated
  });

  it('does not flag when there is no verified evidence yet', () => {
    expect(VoteTallyService.looksInflated('unknown', 999)).toBe(false);
  });
});
