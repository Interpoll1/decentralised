// src/utils/forecastScoring.ts
//
// Pure, dependency-free logic for forecast polls ("Proof of Judgment").
// No money, no stakes: a forecast is an option pick + a confidence (50–99%),
// recorded as a signed, timestamped receipt and later scored against a
// declared resolution. Everything here is deterministic so any peer can
// recompute community probabilities and reputations from the raw records.

export const MIN_CONFIDENCE = 50;
export const MAX_CONFIDENCE = 99;

export type PollKind = 'opinion' | 'forecast';

/** Author-signed description of how a forecast poll resolves. */
export interface ForecastSpec {
  pollId: string;
  kind: 'forecast';
  /** Where the answer will come from, e.g. "Official Steam store page". */
  resolutionSource: string;
  /** Human-readable rule, e.g. "Resolves YES if playable on Steam before 1 Dec". */
  resolutionCriteria: string;
  /** Unix ms when the question is expected to resolve. */
  resolvesAt: number;
  /** Topic used for per-topic reputation (lowercase slug). */
  topic: string;
  authorId: string;
  authorPubkey?: string;
  createdAt: number;
  signature?: string;
}

/** One forecast revision. Users may submit many; the latest one counts. */
export interface ForecastEntry {
  pollId: string;
  userId: string;
  optionId: string;
  /** Probability (in %) that `optionId` is the correct outcome. 50–99. */
  confidence: number;
  createdAt: number;
  /** Optional short reasoning, e.g. "changed after the delay announcement". */
  note?: string;
  pubkey?: string;
  signature?: string;
}

export type ResolutionStatus = 'resolved' | 'void';

export interface ForecastResolution {
  pollId: string;
  status: ResolutionStatus;
  /** Required when status === 'resolved'. */
  winningOptionId?: string;
  evidenceUrl?: string;
  note?: string;
  resolvedAt: number;
  resolverId: string;
  resolverPubkey?: string;
  signature?: string;
}

// ── canonical form / receipts ───────────────────────────────────────────────

/** Stable JSON: sorted keys, undefined dropped. Used for hashing & signing. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
}

/** The fields a forecast signature commits to (everything except the signature). */
export function forecastSigningPayload(entry: ForecastEntry): string {
  const { signature: _sig, ...rest } = entry;
  return canonicalJson({ v: 1, type: 'forecast', ...rest });
}

export function specSigningPayload(spec: ForecastSpec): string {
  const { signature: _sig, ...rest } = spec;
  return canonicalJson({ v: 1, type: 'forecast-spec', ...rest });
}

export function resolutionSigningPayload(res: ForecastResolution): string {
  const { signature: _sig, ...rest } = res;
  return canonicalJson({ v: 1, type: 'forecast-resolution', ...rest });
}

// ── validation ──────────────────────────────────────────────────────────────

export function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return MIN_CONFIDENCE;
  return Math.min(MAX_CONFIDENCE, Math.max(MIN_CONFIDENCE, Math.round(value)));
}

export function isValidForecast(entry: ForecastEntry, optionIds: string[]): boolean {
  return (
    !!entry.pollId && !!entry.userId && optionIds.includes(entry.optionId) &&
    Number.isInteger(entry.confidence) &&
    entry.confidence >= MIN_CONFIDENCE && entry.confidence <= MAX_CONFIDENCE &&
    Number.isFinite(entry.createdAt) && entry.createdAt > 0
  );
}

export function validateSpec(spec: Partial<ForecastSpec>): string[] {
  const errors: string[] = [];
  if (!spec.resolutionSource?.trim()) errors.push('A resolution source is required.');
  if (!spec.resolutionCriteria?.trim()) errors.push('Resolution criteria are required.');
  if (!spec.resolvesAt || !Number.isFinite(spec.resolvesAt)) errors.push('A resolution date is required.');
  if (!spec.topic?.trim()) errors.push('A topic is required.');
  return errors;
}

export function normalizeTopic(topic: string): string {
  return topic.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'general';
}

// ── aggregation ─────────────────────────────────────────────────────────────

/** Latest valid forecast per user at or before `asOf`. */
export function latestForecasts(entries: ForecastEntry[], asOf = Infinity): Map<string, ForecastEntry> {
  const latest = new Map<string, ForecastEntry>();
  for (const e of entries) {
    if (e.createdAt > asOf) continue;
    const prev = latest.get(e.userId);
    if (!prev || e.createdAt > prev.createdAt) latest.set(e.userId, e);
  }
  return latest;
}

/** Spread one forecast into a full distribution over options. */
export function forecastDistribution(entry: ForecastEntry, optionIds: string[]): Record<string, number> {
  const p = entry.confidence / 100;
  const others = optionIds.length - 1;
  const dist: Record<string, number> = {};
  for (const id of optionIds) {
    dist[id] = id === entry.optionId ? p : (others > 0 ? (1 - p) / others : 0);
  }
  return dist;
}

/**
 * Community probability per option = mean of each forecaster's latest
 * distribution. Optional per-user weights (e.g. credibility) are supported;
 * missing weights default to 1.
 */
export function communityProbability(
  entries: ForecastEntry[],
  optionIds: string[],
  asOf = Infinity,
  weights?: Map<string, number>,
): Record<string, number> {
  const latest = latestForecasts(entries, asOf);
  const result: Record<string, number> = Object.fromEntries(optionIds.map((id) => [id, 0]));
  let totalWeight = 0;
  for (const entry of latest.values()) {
    if (!optionIds.includes(entry.optionId)) continue;
    const w = Math.max(0, weights?.get(entry.userId) ?? 1);
    if (w === 0) continue;
    const dist = forecastDistribution(entry, optionIds);
    for (const id of optionIds) result[id] += dist[id] * w;
    totalWeight += w;
  }
  if (totalWeight === 0) {
    const uniform = optionIds.length ? 1 / optionIds.length : 0;
    for (const id of optionIds) result[id] = uniform;
    return result;
  }
  for (const id of optionIds) result[id] /= totalWeight;
  return result;
}

export interface ProbabilityPoint {
  at: number;
  forecasters: number;
  probabilities: Record<string, number>;
}

/** History of the community probability, one point per forecast event. */
export function probabilityHistory(entries: ForecastEntry[], optionIds: string[]): ProbabilityPoint[] {
  const sorted = [...entries].sort((a, b) => a.createdAt - b.createdAt);
  const points: ProbabilityPoint[] = [];
  for (const e of sorted) {
    points.push({
      at: e.createdAt,
      forecasters: latestForecasts(sorted, e.createdAt).size,
      probabilities: communityProbability(sorted, optionIds, e.createdAt),
    });
  }
  return points;
}

/**
 * Detect a "significant move" for notifications: the leading option's
 * probability changed by at least `threshold` (absolute) between two points.
 */
export function significantMove(
  before: Record<string, number>,
  after: Record<string, number>,
  threshold = 0.1,
): { optionId: string; delta: number } | null {
  let best: { optionId: string; delta: number } | null = null;
  for (const id of Object.keys(after)) {
    const delta = (after[id] ?? 0) - (before[id] ?? 0);
    if (Math.abs(delta) >= threshold && (!best || Math.abs(delta) > Math.abs(best.delta))) {
      best = { optionId: id, delta };
    }
  }
  return best;
}

// ── scoring ─────────────────────────────────────────────────────────────────

/** Multi-class Brier score of a forecast (0 = perfect, 2 = worst). */
export function brierScore(entry: ForecastEntry, optionIds: string[], winningOptionId: string): number {
  const dist = forecastDistribution(entry, optionIds);
  let sum = 0;
  for (const id of optionIds) {
    const outcome = id === winningOptionId ? 1 : 0;
    sum += (dist[id] - outcome) ** 2;
  }
  return sum;
}

export interface ScoredForecast {
  pollId: string;
  topic: string;
  entry: ForecastEntry;
  correct: boolean;
  brier: number;
  resolvedAt: number;
  /** Days the user was right before the community crossed 50% on the winner (0 if never ahead). */
  daysAheadOfCrowd: number;
}

export interface ResolvedQuestion {
  spec: Pick<ForecastSpec, 'pollId' | 'topic'>;
  optionIds: string[];
  resolution: ForecastResolution;
  entries: ForecastEntry[];
}

const DAY_MS = 86_400_000;

/** Score one user's final pre-resolution forecast on each resolved question. */
export function scoreUser(userId: string, questions: ResolvedQuestion[]): ScoredForecast[] {
  const scored: ScoredForecast[] = [];
  for (const q of questions) {
    if (q.resolution.status !== 'resolved' || !q.resolution.winningOptionId) continue;
    const winner = q.resolution.winningOptionId;
    const valid = q.entries.filter((e) => e.createdAt <= q.resolution.resolvedAt);
    const mine = valid.filter((e) => e.userId === userId).sort((a, b) => a.createdAt - b.createdAt);
    if (!mine.length) continue;
    const final = mine[mine.length - 1];
    const correct = final.optionId === winner;

    let daysAheadOfCrowd = 0;
    if (correct) {
      // First moment from which the user stayed on the winner.
      let since = final.createdAt;
      for (let i = mine.length - 1; i >= 0 && mine[i].optionId === winner; i--) since = mine[i].createdAt;
      // The crowd excludes this user; it "crossed" when it last moved above 50%
      // on the winner and stayed there until resolution.
      const crowd = probabilityHistory(valid.filter((e) => e.userId !== userId), q.optionIds);
      let crowdCrossed = q.resolution.resolvedAt;
      for (let i = crowd.length - 1; i >= 0 && (crowd[i].probabilities[winner] ?? 0) > 0.5; i--) {
        crowdCrossed = crowd[i].at;
      }
      daysAheadOfCrowd = Math.max(0, Math.floor((crowdCrossed - since) / DAY_MS));
    }

    scored.push({
      pollId: q.spec.pollId,
      topic: q.spec.topic,
      entry: final,
      correct,
      brier: brierScore(final, q.optionIds, winner),
      resolvedAt: q.resolution.resolvedAt,
      daysAheadOfCrowd,
    });
  }
  return scored;
}

export interface CalibrationBucket {
  /** Lower bound of the bucket, e.g. 50 means 50–59%. */
  from: number;
  to: number;
  count: number;
  /** Mean stated confidence in the bucket (0–1). */
  expected: number;
  /** Fraction of those forecasts that were correct (0–1). */
  observed: number;
}

export function calibration(scored: ScoredForecast[]): CalibrationBucket[] {
  const buckets: CalibrationBucket[] = [];
  for (let from = 50; from < 100; from += 10) {
    const to = from === 90 ? 99 : from + 9;
    const inBucket = scored.filter((s) => s.entry.confidence >= from && s.entry.confidence <= to);
    buckets.push({
      from, to, count: inBucket.length,
      expected: inBucket.length ? inBucket.reduce((a, s) => a + s.entry.confidence / 100, 0) / inBucket.length : 0,
      observed: inBucket.length ? inBucket.filter((s) => s.correct).length / inBucket.length : 0,
    });
  }
  return buckets;
}

export interface TopicReputation {
  topic: string;
  forecasts: number;
  accuracy: number;
  meanBrier: number;
  /** 0–100, higher is better. Shrunk toward 50 for small samples. */
  score: number;
}

export interface ForecasterReputation {
  userId: string;
  forecasts: number;
  accuracy: number;
  meanBrier: number;
  score: number;
  /** Consecutive correct resolutions, most recent first. */
  currentStreak: number;
  bestStreak: number;
  bestEarlyCallDays: number;
  byTopic: TopicReputation[];
  calibration: CalibrationBucket[];
  badges: string[];
}

/** Brier skill → 0–100 with Bayesian shrinkage (k pseudo-forecasts at a neutral score). */
function skillScore(meanBrier: number, n: number, k = 5): number {
  // A coin-flip binary forecast at 50% scores Brier 0.5 → raw 50. Perfect → 100.
  const raw = Math.max(0, Math.min(100, 100 - meanBrier * 100));
  return Math.round(((raw * n) + (50 * k)) / (n + k));
}

export function buildReputation(userId: string, scored: ScoredForecast[]): ForecasterReputation {
  const n = scored.length;
  const meanBrier = n ? scored.reduce((a, s) => a + s.brier, 0) / n : 0;
  const accuracy = n ? scored.filter((s) => s.correct).length / n : 0;

  const chrono = [...scored].sort((a, b) => a.resolvedAt - b.resolvedAt);
  let best = 0, run = 0;
  for (const s of chrono) { run = s.correct ? run + 1 : 0; best = Math.max(best, run); }
  let current = 0;
  for (let i = chrono.length - 1; i >= 0 && chrono[i].correct; i--) current++;

  const topics = new Map<string, ScoredForecast[]>();
  for (const s of scored) topics.set(s.topic, [...(topics.get(s.topic) ?? []), s]);
  const byTopic: TopicReputation[] = [...topics.entries()].map(([topic, list]) => {
    const tb = list.reduce((a, s) => a + s.brier, 0) / list.length;
    return {
      topic,
      forecasts: list.length,
      accuracy: list.filter((s) => s.correct).length / list.length,
      meanBrier: tb,
      score: skillScore(tb, list.length),
    };
  }).sort((a, b) => b.score - a.score);

  const bestEarlyCallDays = scored.reduce((m, s) => Math.max(m, s.daysAheadOfCrowd), 0);
  const badges: string[] = [];
  if (n >= 1) badges.push('First forecast resolved');
  if (best >= 5) badges.push('5-streak');
  if (best >= 10) badges.push('10-streak');
  if (bestEarlyCallDays >= 30) badges.push('Called it a month early');
  for (const t of byTopic) if (t.forecasts >= 10 && t.score >= 70) badges.push(`Sharp on ${t.topic}`);

  return {
    userId, forecasts: n, accuracy, meanBrier, score: skillScore(meanBrier, n),
    currentStreak: current, bestStreak: best, bestEarlyCallDays,
    byTopic, calibration: calibration(scored), badges,
  };
}

// ── popularity ──────────────────────────────────────────────────────────────

export interface PopularitySignals {
  /** Forecasts / votes in the last 24h. */
  recentActivity: number;
  /** Distinct participants overall. */
  participants: number;
  /** Community probabilities (or vote shares) per option. */
  distribution: number[];
  /** Comments + evidence links in the last 24h. */
  discussion: number;
  /** Ms until resolution (or expiry); <= 0 when past. */
  msUntilResolution: number;
  /** Mean reputation score (0–100) of participants. */
  meanCredibility: number;
  /** Ms since creation. */
  ageMs: number;
}

/** Normalised entropy of a distribution (0 = unanimous, 1 = evenly split). */
export function disagreement(distribution: number[]): number {
  const total = distribution.reduce((a, b) => a + b, 0);
  if (total <= 0 || distribution.length < 2) return 0;
  let h = 0;
  for (const v of distribution) {
    const p = v / total;
    if (p > 0) h -= p * Math.log(p);
  }
  return h / Math.log(distribution.length);
}

/**
 * Ranking score that does not scale linearly with community size: counts go
 * through log1p so a 100k-member space cannot permanently bury a lively small one.
 */
export function popularityScore(s: PopularitySignals): number {
  const velocity = Math.log1p(Math.max(0, s.recentActivity));
  const breadth = Math.log1p(Math.max(0, s.participants));
  const debate = disagreement(s.distribution);
  const talk = Math.log1p(Math.max(0, s.discussion));
  const daysLeft = s.msUntilResolution / DAY_MS;
  // Peak urgency in the final week; finished questions get no boost.
  const urgency = daysLeft <= 0 ? 0 : daysLeft <= 7 ? 1 : 7 / daysLeft;
  const credibility = Math.max(0, Math.min(100, s.meanCredibility)) / 100;
  const raw = 2 * velocity + breadth + 1.5 * debate + talk + urgency + credibility;
  const ageHours = Math.max(0, s.ageMs) / 3_600_000;
  return raw / Math.pow(ageHours + 2, 0.8);
}
