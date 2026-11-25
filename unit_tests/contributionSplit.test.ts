import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';
import {
  validateSplit, buildSplitVersion, verifyHistory, affectedContributors, splitStatus,
  allocateRevenue, publicCredits, type SplitEntry, type Acceptance, type SplitVersion,
} from '../src/utils/contributionSplit';

const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const E = (id: string, role: SplitEntry['role'], shareBps: number): SplitEntry => ({ contributorId: id, displayName: id, role, shareBps });
const ENTRIES = [E('presenter', 'host', 3500), E('producer', 'producer', 3000), E('editor', 'editor', 2000), E('researcher', 'researcher', 1000), E('uploader', 'uploader', 500)];
const v1 = buildSplitVersion({ workId: 'w', workKind: 'video', entries: ENTRIES, proposedBy: 'uploader', proposedAt: 1 }, null, hash);
const acceptAll = (v: SplitVersion): Acceptance[] => v.entries.map((e) => ({ workId: v.workId, version: v.version, versionHash: v.hash, contributorId: e.contributorId, state: 'accepted', at: 2 }));

describe('contributionSplit', () => {
  it('requires shares to total 100% with no duplicates', () => {
    expect(validateSplit(ENTRIES)).toEqual([]);
    expect(validateSplit([E('a', 'host', 5000)]).join()).toMatch(/50.00%/);
    expect(validateSplit([E('a', 'host', 5000), E('a', 'editor', 5000)]).join()).toMatch(/twice/);
  });

  it('is draft until everyone accepts, disputed if anyone disputes', () => {
    expect(splitStatus(v1, [])).toBe('draft');
    expect(splitStatus(v1, acceptAll(v1))).toBe('active');
    const disputed = [...acceptAll(v1), { ...acceptAll(v1)[0], state: 'disputed' as const, at: 3 }];
    expect(splitStatus(v1, disputed)).toBe('disputed');
  });

  it('ignores acceptances of a different version hash', () => {
    const forged = acceptAll(v1).map((a) => ({ ...a, versionHash: 'nope' }));
    expect(splitStatus(v1, forged)).toBe('draft');
    expect(publicCredits(v1, forged)).toHaveLength(0);
  });

  it('hash-chains versions and detects tampering', () => {
    const v2 = buildSplitVersion({ workId: 'w', workKind: 'video', entries: [...ENTRIES.slice(0, 3), E('researcher', 'researcher', 1500)], proposedBy: 'uploader', proposedAt: 5 }, v1, hash);
    expect(v2.prevHash).toBe(v1.hash);
    expect(verifyHistory([v1, v2], hash)).toBe(true);
    const tampered = { ...v1, entries: v1.entries.map((e) => (e.contributorId === 'uploader' ? { ...e, shareBps: 600 } : e)) };
    expect(verifyHistory([tampered, v2], hash)).toBe(false);
    expect(affectedContributors(v1, v2).sort()).toEqual(['researcher', 'uploader']);
  });

  it('reproduces the $100 example exactly', () => {
    const s = allocateRevenue({ grossCents: 10_000, processingFeesCents: 500, refundsCents: 0, platformBps: 0 }, v1, acceptAll(v1));
    // $95 net, then 10 of the original $100 to the platform: emulate with platformBps on net.
    expect(s.lines.reduce((a, l) => a + l.amountCents, 0)).toBe(s.distributableCents);
    const s2 = allocateRevenue({ grossCents: 10_000, processingFeesCents: 500, refundsCents: 0, platformBps: 1053 }, v1, acceptAll(v1));
    expect(s2.distributableCents).toBe(8500);
    expect(s2.lines.map((l) => l.amountCents)).toEqual([2975, 2550, 1700, 850, 425]);
    expect(s2.heldCents).toBe(0);
  });

  it('holds unaccepted shares instead of paying the uploader', () => {
    const partial = acceptAll(v1).filter((a) => a.contributorId !== 'editor');
    const s = allocateRevenue({ grossCents: 10_000, processingFeesCents: 0, refundsCents: 0, platformBps: 0 }, v1, partial);
    expect(s.lines.find((l) => l.contributorId === 'editor')!.disposition).toBe('held');
    expect(s.lines.find((l) => l.contributorId === 'uploader')!.amountCents).toBe(500);
    expect(s.heldCents).toBe(2000);
  });

  it('rounding always sums to the distributable amount', () => {
    const odd = buildSplitVersion({ workId: 'w', workKind: 'post', entries: [E('a', 'writer', 3333), E('b', 'editor', 3333), E('c', 'artist', 3334)], proposedBy: 'a', proposedAt: 1 }, null, hash);
    const s = allocateRevenue({ grossCents: 101, processingFeesCents: 0, refundsCents: 0, platformBps: 0 }, odd, acceptAll(odd));
    expect(s.lines.reduce((a, l) => a + l.amountCents, 0)).toBe(101);
  });
});
