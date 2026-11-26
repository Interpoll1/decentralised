import { describe, it, expect } from 'vitest';
import {
  clampConfidence, communityProbability, probabilityHistory, brierScore, scoreUser,
  buildReputation, popularityScore, disagreement, significantMove, isValidForecast,
  canonicalJson, forecastSigningPayload, type ForecastEntry, type ResolvedQuestion,
} from '../src/utils/forecastScoring';

const OPTS = ['yes', 'no'];
const DAY = 86_400_000;
const f = (userId: string, optionId: string, confidence: number, createdAt: number): ForecastEntry =>
  ({ pollId: 'p1', userId, optionId, confidence, createdAt });

describe('forecastScoring', () => {
  it('clamps confidence to 50–99', () => {
    expect(clampConfidence(10)).toBe(50);
    expect(clampConfidence(120)).toBe(99);
    expect(clampConfidence(NaN)).toBe(50);
    expect(clampConfidence(73.4)).toBe(73);
  });

  it('validates forecasts', () => {
    expect(isValidForecast(f('a', 'yes', 70, 1), OPTS)).toBe(true);
    expect(isValidForecast(f('a', 'maybe', 70, 1), OPTS)).toBe(false);
    expect(isValidForecast(f('a', 'yes', 100, 1), OPTS)).toBe(false);
  });

  it('uses only the latest forecast per user for the community probability', () => {
    const entries = [f('a', 'yes', 90, 1), f('a', 'no', 80, 2), f('b', 'yes', 60, 3)];
    const p = communityProbability(entries, OPTS);
    expect(p.yes).toBeCloseTo((0.2 + 0.6) / 2);
    expect(p.yes + p.no).toBeCloseTo(1);
  });

  it('builds a history with one point per forecast', () => {
    const h = probabilityHistory([f('a', 'yes', 90, 1), f('b', 'no', 90, 2)], OPTS);
    expect(h).toHaveLength(2);
    expect(h[0].probabilities.yes).toBeCloseTo(0.9);
    expect(h[1].probabilities.yes).toBeCloseTo(0.5);
  });

  it('computes Brier scores', () => {
    expect(brierScore(f('a', 'yes', 99, 1), OPTS, 'yes')).toBeCloseTo(2 * 0.01 ** 2);
    expect(brierScore(f('a', 'yes', 50, 1), OPTS, 'no')).toBeCloseTo(0.5);
  });

  it('scores users, counts early calls and builds reputation', () => {
    const q: ResolvedQuestion = {
      spec: { pollId: 'p1', topic: 'tech' },
      optionIds: OPTS,
      resolution: { pollId: 'p1', status: 'resolved', winningOptionId: 'yes', resolvedAt: 100 * DAY, resolverId: 'x' },
      entries: [f('early', 'yes', 80, 0), f('c1', 'no', 90, 1 * DAY), f('c2', 'no', 90, 2 * DAY),
        f('c3', 'yes', 90, 40 * DAY), f('c4', 'yes', 90, 41 * DAY), f('late', 'yes', 70, 101 * DAY)],
    };
    const [s] = scoreUser('early', [q]);
    expect(s.correct).toBe(true);
    expect(s.daysAheadOfCrowd).toBeGreaterThanOrEqual(40);
    expect(scoreUser('late', [q])).toHaveLength(0); // after resolution → ignored
    const rep = buildReputation('early', [s]);
    expect(rep.accuracy).toBe(1);
    expect(rep.byTopic[0].topic).toBe('tech');
    expect(rep.badges).toContain('Called it a month early');
  });

  it('ignores void resolutions', () => {
    const q: ResolvedQuestion = {
      spec: { pollId: 'p1', topic: 't' }, optionIds: OPTS,
      resolution: { pollId: 'p1', status: 'void', resolvedAt: 5, resolverId: 'x' },
      entries: [f('a', 'yes', 90, 1)],
    };
    expect(scoreUser('a', [q])).toHaveLength(0);
  });

  it('popularity rewards disagreement and is sublinear in size', () => {
    expect(disagreement([50, 50])).toBeCloseTo(1);
    expect(disagreement([100, 0])).toBe(0);
    const base = { recentActivity: 10, participants: 20, distribution: [0.5, 0.5], discussion: 3, msUntilResolution: 3 * DAY, meanCredibility: 60, ageMs: 3_600_000 };
    const huge = popularityScore({ ...base, participants: 100_000, distribution: [0.99, 0.01] });
    expect(huge / popularityScore(base)).toBeLessThan(2);
  });

  it('flags significant moves', () => {
    expect(significantMove({ yes: 0.5 }, { yes: 0.65 })?.delta).toBeCloseTo(0.15);
    expect(significantMove({ yes: 0.5 }, { yes: 0.55 })).toBeNull();
  });

  it('canonical json is key-order independent and excludes the signature', () => {
    expect(canonicalJson({ b: 1, a: [1, { d: 2, c: 3 }] })).toBe(canonicalJson({ a: [1, { c: 3, d: 2 }], b: 1 }));
    const e = f('a', 'yes', 70, 1);
    expect(forecastSigningPayload({ ...e, signature: 'x' })).toBe(forecastSigningPayload(e));
  });
});
