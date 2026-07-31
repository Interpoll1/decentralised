import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref } from 'vue';

const tally = vi.hoisted(() => ({
  getVerifiedTotal: vi.fn(() => 0),
  trustState: vi.fn(() => 'unverified' as string),
}));
vi.mock('@/services/voteTallyService', () => ({ VoteTallyService: tally }));

import { useVerifiedPollResults } from '@/composables/useVerifiedPollResults';
import type { Poll, PollOption } from '@/types/poll';

function opt(id: string, votes: number): PollOption {
  return { id, text: id, votes, voters: [] };
}
function makePoll(options: PollOption[], totalVotes: number): Poll {
  return { id: 'p1', options, totalVotes } as Poll;
}

beforeEach(() => {
  vi.clearAllMocks();
  tally.getVerifiedTotal.mockReturnValue(0);
  tally.trustState.mockReturnValue('unverified');
});

describe('useVerifiedPollResults', () => {
  it('falls back to Gun totals when there is no verified evidence', () => {
    const p = ref(makePoll([opt('A', 6), opt('B', 4)], 10));
    const r = useVerifiedPollResults(p);
    expect(r.reportedTotal.value).toBe(10);
    expect(r.displayTotal.value).toBe(10);
    expect(r.percent(opt('A', 6))).toBe(60);
  });

  it('exposes the verified total and keeps display on the Gun total when verified', () => {
    tally.getVerifiedTotal.mockReturnValue(10);
    tally.trustState.mockReturnValue('verified');
    const p = ref(makePoll([opt('A', 6), opt('B', 4)], 10));
    const r = useVerifiedPollResults(p);
    expect(r.verifiedTotal.value).toBe(10);
    expect(r.trust.value).toBe('verified');
    expect(r.displayTotal.value).toBe(10);
  });

  it('collapses the display total to the verified floor when inflated', () => {
    tally.getVerifiedTotal.mockReturnValue(3);
    tally.trustState.mockReturnValue('inflated');
    const p = ref(makePoll([opt('A', 90), opt('B', 10)], 100));
    const r = useVerifiedPollResults(p);
    expect(r.displayTotal.value).toBe(3);           // not the forged 100
    // bars are proportional to the verified floor, capped at 100%
    expect(r.percent(opt('A', 90))).toBe(100);
  });

  it('sorts options by vote count, highest first', () => {
    const p = ref(makePoll([opt('A', 1), opt('B', 5), opt('C', 3)], 9));
    const r = useVerifiedPollResults(p);
    expect(r.sortedOptions.value.map((o) => o.id)).toEqual(['B', 'C', 'A']);
  });

  it('guards divide-by-zero when there are no votes', () => {
    const p = ref(makePoll([opt('A', 0)], 0));
    const r = useVerifiedPollResults(p);
    expect(r.percent(opt('A', 0))).toBe(0);
  });

  it('reacts when the poll source changes', () => {
    const p = ref(makePoll([opt('A', 2)], 2));
    const r = useVerifiedPollResults(p);
    expect(r.reportedTotal.value).toBe(2);
    p.value = makePoll([opt('A', 7)], 7);
    expect(r.reportedTotal.value).toBe(7);
  });
});
