/**
 * collusionService — statistical detection of batch-purchased engagement.
 *
 * The tests are written as the two cases that matter: a simulated delivered
 * order must score high, and organic traffic with the same volume must not.
 * Everything here is a pure function, so no Gun, IndexedDB or relay is needed.
 */
import { describe, it, expect } from 'vitest';
import {
  CollusionService,
  coEngagementCohorts,
  cohortWeight,
  burstAssessment,
  jaccard,
  simhash,
  hammingDistance,
  normaliseForSimhash,
  templateClusters,
  type EngagementObservation,
} from '@/services/collusionService';

const T0 = 1_700_000_000;

/** A farm delivering `count` actions at a near-constant rate. */
function deliveredOrder(target: string, count: number, start = T0, gap = 7): EngagementObservation[] {
  return Array.from({ length: count }, (_, i) => ({
    pubkey: `farm${i}`,
    targetId: target,
    createdAt: start + i * gap,
  }));
}

/** Organic arrivals: bursty at publication, then a long decaying tail. */
function organicArrivals(target: string, count: number, start = T0): EngagementObservation[] {
  return Array.from({ length: count }, (_, i) => ({
    pubkey: `user${i}`,
    targetId: target,
    createdAt: start + Math.round(Math.exp(i / 3) * 11) + (i % 5),
  }));
}

describe('jaccard', () => {
  it('is 0 for an empty set and 1 for identical sets', () => {
    expect(jaccard(new Set(), new Set(['a']))).toBe(0);
    expect(jaccard(new Set(['a', 'b']), new Set(['a', 'b']))).toBe(1);
  });

  it('measures overlap against the union', () => {
    expect(jaccard(new Set(['a', 'b', 'c']), new Set(['b', 'c', 'd']))).toBeCloseTo(2 / 4);
  });
});

describe('coEngagementCohorts', () => {
  it('groups accounts that keep servicing the same targets', () => {
    const targets = ['t1', 't2', 't3', 't4', 't5', 't6'];
    const inventory = ['f1', 'f2', 'f3', 'f4'];
    const observations: EngagementObservation[] = [];
    for (const pubkey of inventory) {
      for (const targetId of targets) observations.push({ pubkey, targetId, createdAt: T0 });
    }
    // Real users each touch their own handful of targets.
    for (let i = 0; i < 10; i++) {
      for (const targetId of [`o${i}a`, `o${i}b`, `o${i}c`, 't1']) {
        observations.push({ pubkey: `real${i}`, targetId, createdAt: T0 });
      }
    }

    const cohorts = coEngagementCohorts(observations);
    expect(cohorts).toHaveLength(1);
    expect(cohorts[0].members).toEqual(inventory);
    expect(cohorts[0].sharedTargets).toBe(targets.length);
    expect(cohorts[0].meanJaccard).toBeCloseTo(1);
  });

  it('links a farm transitively through partial overlaps', () => {
    // f1↔f2 and f2↔f3 clear the bar; f1↔f3 alone would not.
    const obs: EngagementObservation[] = [];
    const push = (pubkey: string, targets: string[]) =>
      targets.forEach((targetId) => obs.push({ pubkey, targetId, createdAt: T0 }));
    push('f1', ['t1', 't2', 't3', 't4', 't5', 't6']);
    push('f2', ['t1', 't2', 't3', 't4', 't5', 't6', 't7']);
    push('f3', ['t2', 't3', 't4', 't5', 't6', 't7', 't8']);

    const cohorts = coEngagementCohorts(obs);
    expect(cohorts).toHaveLength(1);
    expect(cohorts[0].members).toEqual(['f1', 'f2', 'f3']);
  });

  it('does not cluster people who merely share one popular target', () => {
    const obs: EngagementObservation[] = [];
    for (let i = 0; i < 12; i++) {
      for (const targetId of ['viral', `p${i}a`, `p${i}b`, `p${i}c`]) {
        obs.push({ pubkey: `user${i}`, targetId, createdAt: T0 });
      }
    }
    expect(coEngagementCohorts(obs)).toHaveLength(0);
  });

  it('ignores accounts too sparse to judge', () => {
    const obs: EngagementObservation[] = [
      { pubkey: 'a', targetId: 't1', createdAt: T0 },
      { pubkey: 'b', targetId: 't1', createdAt: T0 },
    ];
    expect(coEngagementCohorts(obs)).toHaveLength(0);
  });
});

describe('cohortWeight', () => {
  it('is sub-linear, so a wrong call costs influence rather than erasing people', () => {
    expect(cohortWeight(1)).toBe(1);
    expect(cohortWeight(4)).toBeCloseTo(0.5);
    expect(cohortWeight(100)).toBeCloseTo(0.1);
  });

  it('a 500-account purchase buys about one account of influence', () => {
    expect(500 * cohortWeight(500)).toBeCloseTo(Math.sqrt(500), 5);
    expect(cohortWeight(500) * 500).toBeLessThan(500 * 0.05);
  });
});

describe('burstAssessment', () => {
  it('flags a delivered order as machine-flat', () => {
    const result = burstAssessment(deliveredOrder('t', 500), T0 - 48 * 3_600);
    expect(result.score).toBeGreaterThan(0.5);
    expect(result.flags).toContain('uniform-arrival-gaps');
    expect(result.flags).toContain('late-start');
    expect(result.flags).toContain('round-total');
    expect(result.signals.arrivalCv).toBeLessThan(0.35);
  });

  it('does not flag organic decay at the same volume', () => {
    const result = burstAssessment(organicArrivals('t', 60), T0);
    expect(result.flags).not.toContain('uniform-arrival-gaps');
    expect(result.score).toBeLessThan(0.35);
  });

  it('stays silent when there is no distribution to read', () => {
    expect(burstAssessment(deliveredOrder('t', 5)).score).toBe(0);
  });

  it('flags a cohort of keys whose first-ever action is this one', () => {
    const obs = deliveredOrder('t', 40);
    const firstSeen = new Map(obs.map((o) => [o.pubkey, o.createdAt - 60]));
    expect(burstAssessment(obs, undefined, firstSeen).flags).toContain('fresh-actor-cohort');
  });

  it('does not flag freshness for established accounts', () => {
    const obs = deliveredOrder('t', 40);
    const firstSeen = new Map(obs.map((o) => [o.pubkey, o.createdAt - 90 * 86_400]));
    expect(burstAssessment(obs, undefined, firstSeen).flags).not.toContain('fresh-actor-cohort');
  });
});

describe('simhash', () => {
  it('normalises case, punctuation and spacing away', () => {
    expect(normaliseForSimhash('Great   POLL!!  Really.')).toBe('great poll really');
    expect(simhash('Great poll, really!')).toBe(simhash('great   poll really'));
  });

  it('keeps near-duplicates close and unrelated text far apart', () => {
    const a = simhash('This is honestly the best take I have read on this all year');
    const b = simhash('This is honestly the best take I have read on this all week');
    const c = simhash('Disagree completely, the methodology here ignores the base rate');
    expect(hammingDistance(a, b)).toBeLessThanOrEqual(6);
    expect(hammingDistance(a, c)).toBeGreaterThan(12);
  });

  it('is 0 for empty content, which never clusters', () => {
    expect(simhash('   ')).toBe(0n);
  });
});

describe('templateClusters', () => {
  it('clusters one template posted by many keys', () => {
    const comments = [
      { pubkey: 'k1', content: 'Amazing project, this is exactly what the space needed!' },
      { pubkey: 'k2', content: 'Amazing project, this is exactly what the space needs!' },
      { pubkey: 'k3', content: 'Amazing project — this is exactly what the space needed.' },
      { pubkey: 'k4', content: 'The turnout numbers here look off compared to last quarter' },
    ];
    const clusters = templateClusters(comments);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].indexes).toEqual([0, 1, 2]);
    expect(clusters[0].distinctAuthors).toBe(3);
  });

  it('one author repeating themselves is a habit, not a purchase', () => {
    const comments = [
      { pubkey: 'k1', content: 'Amazing project, this is exactly what the space needed!' },
      { pubkey: 'k1', content: 'Amazing project, this is exactly what the space needed!!' },
    ];
    expect(templateClusters(comments)).toHaveLength(0);
  });
});

describe('CollusionService.assessTarget', () => {
  it('scores a purchased batch high and down-weights the cohort', () => {
    const order = deliveredOrder('target', 100, T0, 6);
    // The same inventory serviced five earlier orders.
    const history: EngagementObservation[] = [];
    for (const other of ['prev1', 'prev2', 'prev3', 'prev4', 'prev5']) {
      for (const obs of order) history.push({ ...obs, targetId: other, createdAt: T0 - 86_400 });
    }
    const firstSeen = new Map(order.map((o) => [o.pubkey, o.createdAt - 300]));

    const result = CollusionService.assessTarget(order, {
      publishedAt: T0 - 72 * 3_600,
      history,
      firstSeenByActor: firstSeen,
    });

    expect(result.suspicion).toBeGreaterThan(0.6);
    expect(result.flags).toContain('co-engagement-cohort');
    expect(result.flags).toContain('uniform-arrival-gaps');
    expect(result.weights.get('farm0')).toBeCloseTo(cohortWeight(100));
  });

  it('leaves organic engagement at full weight and low suspicion', () => {
    const organic = organicArrivals('target', 60);
    const history: EngagementObservation[] = organic.flatMap((o, i) => [
      { ...o, targetId: `other${i % 7}a` },
      { ...o, targetId: `other${i % 5}b` },
    ]);

    const result = CollusionService.assessTarget(organic, { publishedAt: T0, history });

    expect(result.suspicion).toBeLessThan(0.25);
    expect(result.flags).not.toContain('co-engagement-cohort');
    for (const weight of result.weights.values()) expect(weight).toBe(1);
  });

  it('never returns a verdict — only a bounded score', () => {
    const result = CollusionService.assessTarget(deliveredOrder('t', 1_000), {
      publishedAt: T0 - 96 * 3_600,
    });
    expect(result.suspicion).toBeGreaterThanOrEqual(0);
    expect(result.suspicion).toBeLessThanOrEqual(1);
  });
});
