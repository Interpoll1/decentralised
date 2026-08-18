/**
 * collusionService — statistical detection of batch-purchased engagement.
 *
 * Engagement marketplaces have three durable weaknesses, and this service reads
 * all three off signed actions a client already holds. No network, no relay
 * cooperation, and — importantly — no verdicts: every function here returns a
 * score or a flag. Heuristics change weights and annotate displays; they never
 * delete content and never block a user. Only the cryptographic controls
 * (`engagementTierService`, PoW) produce hard answers.
 *
 *   M3 — Inventory reuse.  A farm services every order from the same few
 *        thousand accounts, so those accounts keep co-occurring across
 *        unrelated targets. Cohorts, not individuals, are the unit of action:
 *        down-weighting a cohort by 1/√n means buying 500 accounts from one
 *        seller buys the influence of roughly one.
 *
 *   M4 — Delivery shape.  Organic engagement decays from publication; a
 *        delivered order is a rectangle — near-uniform gaps, a late start, a
 *        round total, and a mass of keys whose first observed action is minutes
 *        old.
 *
 *   M5 — Template reuse.  Paid comment batches come from a handful of prompts.
 *        A 64-bit SimHash per comment finds near-duplicates across distinct
 *        keys, which is the highest-precision signal available for paid
 *        opinions.
 *
 * Everything is a pure function over observations, so it is testable without
 * Gun, IndexedDB or a relay.
 */

/** One observed engagement action, as much as the local client knows of it. */
export interface EngagementObservation {
  pubkey: string;
  targetId: string;
  /** Unix seconds. */
  createdAt: number;
  /** Comment body, when the action carries text. */
  content?: string;
  /** Community/board the target belongs to, used to discount same-community overlap. */
  context?: string;
}

// ─── M3: co-engagement clustering ────────────────────────────────────────────

export interface ClusterOptions {
  /** Jaccard overlap above which two accounts are treated as linked. */
  minJaccard?: number;
  /** Shared targets required before overlap counts at all. */
  minSharedTargets?: number;
  /** Accounts acting on fewer targets than this are too sparse to judge. */
  minActivity?: number;
}

export interface Cohort {
  members: string[];
  /** Targets every member of the cohort touched. */
  sharedTargets: number;
  /** Mean pairwise Jaccard across the linked pairs that formed the cohort. */
  meanJaccard: number;
}

const CLUSTER_DEFAULTS: Required<ClusterOptions> = {
  minJaccard: 0.6,
  minSharedTargets: 5,
  minActivity: 3,
};

/** Jaccard overlap of two target sets. Empty on either side is 0, not NaN. */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const item of small) if (large.has(item)) shared++;
  if (shared === 0) return 0;
  return shared / (a.size + b.size - shared);
}

/**
 * Group accounts whose target sets overlap far past coincidence.
 *
 * Union-find over the linked pairs: a farm's inventory is transitively
 * connected even when no single pair reaches the threshold against every other.
 */
export function coEngagementCohorts(
  observations: EngagementObservation[],
  options: ClusterOptions = {},
): Cohort[] {
  const opts = { ...CLUSTER_DEFAULTS, ...options };

  const targetsByActor = new Map<string, Set<string>>();
  for (const obs of observations) {
    if (!obs?.pubkey || !obs?.targetId) continue;
    let set = targetsByActor.get(obs.pubkey);
    if (!set) targetsByActor.set(obs.pubkey, (set = new Set()));
    set.add(obs.targetId);
  }

  const actors = [...targetsByActor.entries()].filter(
    ([, targets]) => targets.size >= opts.minActivity,
  );

  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root) ?? root;
    // Path compression keeps repeated lookups cheap on wide cohorts.
    let cur = x;
    while (parent.get(cur) !== root) {
      const next = parent.get(cur) ?? root;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };
  for (const [actor] of actors) parent.set(actor, actor);

  const linkScores = new Map<string, number[]>();
  for (let i = 0; i < actors.length; i++) {
    for (let j = i + 1; j < actors.length; j++) {
      const [a, aTargets] = actors[i];
      const [b, bTargets] = actors[j];
      let shared = 0;
      for (const t of aTargets) if (bTargets.has(t)) shared++;
      if (shared < opts.minSharedTargets) continue;
      const score = jaccard(aTargets, bTargets);
      if (score < opts.minJaccard) continue;

      const rootA = find(a);
      const rootB = find(b);
      if (rootA !== rootB) parent.set(rootB, rootA);
      const key = find(a);
      const scores = linkScores.get(key) ?? [];
      scores.push(score);
      linkScores.set(key, scores);
    }
  }

  const grouped = new Map<string, string[]>();
  for (const [actor] of actors) {
    const root = find(actor);
    const members = grouped.get(root) ?? [];
    members.push(actor);
    grouped.set(root, members);
  }

  const cohorts: Cohort[] = [];
  for (const [root, members] of grouped) {
    if (members.length < 2) continue;
    // Re-key link scores through find(), since roots move during union.
    let scores: number[] = [];
    for (const [key, values] of linkScores) {
      if (find(key) === root) scores = scores.concat(values);
    }
    const sharedTargets = intersectionSize(members.map((m) => targetsByActor.get(m)!));
    cohorts.push({
      members: members.sort(),
      sharedTargets,
      meanJaccard: scores.length
        ? scores.reduce((sum, s) => sum + s, 0) / scores.length
        : 0,
    });
  }
  return cohorts.sort((a, b) => b.members.length - a.members.length);
}

function intersectionSize(sets: Set<string>[]): number {
  if (sets.length === 0) return 0;
  let shared = 0;
  const [first, ...rest] = sets;
  for (const item of first) {
    if (rest.every((set) => set.has(item))) shared++;
  }
  return shared;
}

/**
 * Contribution multiplier for one member of a cohort of `size`.
 *
 * Sub-linear rather than zero: real communities co-engage too, and a wrong
 * cohort call should cost influence, not erase people.
 */
export function cohortWeight(size: number): number {
  if (!Number.isFinite(size) || size <= 1) return 1;
  return 1 / Math.sqrt(size);
}

// ─── M4: delivery-shape statistics ───────────────────────────────────────────

export interface BurstSignals {
  /** Normalised Shannon entropy of the inter-arrival distribution, 0–1. */
  arrivalEntropy: number;
  /** Coefficient of variation of inter-arrival gaps; ~0 is machine-flat. */
  arrivalCv: number;
  /** Share of actors whose first-ever observed action is this one, 0–1. */
  freshActorShare: number;
  /** Total lands on a marketplace round number (500 / 1 000 / 5 000 …). */
  roundTotal: boolean;
  /** Engagement started long after publication — a delivered order, not a launch. */
  lateStart: boolean;
}

export interface BurstAssessment {
  /** 0–1. Higher means the arrival pattern looks delivered rather than organic. */
  score: number;
  signals: BurstSignals;
  flags: string[];
}

const ROUND_TOTALS = [100, 250, 500, 1_000, 2_500, 5_000, 10_000];
/** Actions this many seconds after publication start looking like a delivery. */
const LATE_START_SECONDS = 6 * 3_600;
/** A key first seen within this window of acting is "fresh". */
const FRESH_ACTOR_SECONDS = 3_600;

/**
 * Score how much a target's arrival pattern resembles a delivered order.
 *
 * `firstSeenByActor` maps pubkey → earliest action this client has ever seen
 * from that key, which is what makes cohort-birth visible.
 */
export function burstAssessment(
  observations: EngagementObservation[],
  publishedAt?: number,
  firstSeenByActor: Map<string, number> = new Map(),
): BurstAssessment {
  const times = observations
    .map((o) => o.createdAt)
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b);

  const signals: BurstSignals = {
    arrivalEntropy: 1,
    arrivalCv: 1,
    freshActorShare: 0,
    roundTotal: false,
    lateStart: false,
  };
  const flags: string[] = [];

  // Under ~8 actions there is no distribution to speak of; stay silent.
  if (times.length < 8) return { score: 0, signals, flags };

  const gaps: number[] = [];
  for (let i = 1; i < times.length; i++) gaps.push(Math.max(0, times[i] - times[i - 1]));

  const mean = gaps.reduce((sum, g) => sum + g, 0) / gaps.length;
  if (mean > 0) {
    const variance = gaps.reduce((sum, g) => sum + (g - mean) ** 2, 0) / gaps.length;
    signals.arrivalCv = Math.sqrt(variance) / mean;
  } else {
    signals.arrivalCv = 0; // every action in the same second
  }
  signals.arrivalEntropy = normalisedLogGapEntropy(gaps);

  const actors = new Set(observations.map((o) => o.pubkey).filter(Boolean));
  if (actors.size > 0) {
    let fresh = 0;
    for (const actor of actors) {
      const firstSeen = firstSeenByActor.get(actor);
      const acted = observations.find((o) => o.pubkey === actor)?.createdAt ?? 0;
      if (firstSeen !== undefined && acted - firstSeen <= FRESH_ACTOR_SECONDS) fresh++;
    }
    signals.freshActorShare = fresh / actors.size;
  }

  signals.roundTotal = ROUND_TOTALS.includes(observations.length);
  if (publishedAt !== undefined && Number.isFinite(publishedAt)) {
    signals.lateStart = times[0] - publishedAt > LATE_START_SECONDS;
  }

  // Weighted sum, capped at 1. Flatness dominates because it is the hardest
  // property for a delivery script to fake away without paying for real time.
  let score = 0;
  if (signals.arrivalCv < 0.35) {
    score += 0.35;
    flags.push('uniform-arrival-gaps');
  }
  if (signals.arrivalEntropy < 0.4) {
    score += 0.25;
    flags.push('low-arrival-entropy');
  }
  if (signals.freshActorShare > 0.5) {
    score += 0.25;
    flags.push('fresh-actor-cohort');
  }
  if (signals.lateStart) {
    score += 0.1;
    flags.push('late-start');
  }
  if (signals.roundTotal) {
    score += 0.05;
    flags.push('round-total');
  }

  return { score: Math.min(1, score), signals, flags };
}

/** Shannon entropy of gaps bucketed by log2(seconds), normalised to 0–1. */
function normalisedLogGapEntropy(gaps: number[]): number {
  if (gaps.length === 0) return 1;
  const buckets = new Map<number, number>();
  for (const gap of gaps) {
    const bucket = gap <= 0 ? 0 : Math.floor(Math.log2(gap)) + 1;
    buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
  }
  if (buckets.size <= 1) return 0;
  let entropy = 0;
  for (const count of buckets.values()) {
    const p = count / gaps.length;
    entropy -= p * Math.log2(p);
  }
  return entropy / Math.log2(buckets.size);
}

// ─── M5: comment template similarity ─────────────────────────────────────────

const SHINGLE_SIZE = 4;

/** Case-, punctuation- and whitespace-insensitive form used for shingling. */
export function normaliseForSimhash(text: string): string {
  return (text ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 64-bit SimHash over character shingles.
 *
 * Character shingles rather than words: spintax and LLM paraphrase both keep
 * long character runs intact even when they swap words around.
 */
export function simhash(text: string): bigint {
  const normalised = normaliseForSimhash(text);
  if (!normalised) return 0n;

  const shingles = new Map<string, number>();
  if (normalised.length <= SHINGLE_SIZE) {
    shingles.set(normalised, 1);
  } else {
    for (let i = 0; i + SHINGLE_SIZE <= normalised.length; i++) {
      const shingle = normalised.slice(i, i + SHINGLE_SIZE);
      shingles.set(shingle, (shingles.get(shingle) ?? 0) + 1);
    }
  }

  const columns = new Array<number>(64).fill(0);
  for (const [shingle, weight] of shingles) {
    const hash = fnv1a64(shingle);
    for (let bit = 0; bit < 64; bit++) {
      const set = (hash >> BigInt(bit)) & 1n;
      columns[bit] += set === 1n ? weight : -weight;
    }
  }

  let result = 0n;
  for (let bit = 0; bit < 64; bit++) {
    if (columns[bit] > 0) result |= 1n << BigInt(bit);
  }
  return result;
}

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK64 = (1n << 64n) - 1n;

function fnv1a64(input: string): bigint {
  let hash = FNV_OFFSET;
  for (let i = 0; i < input.length; i++) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = (hash * FNV_PRIME) & MASK64;
  }
  return hash;
}

/** Number of differing bits between two SimHash fingerprints. */
export function hammingDistance(a: bigint, b: bigint): number {
  let diff = a ^ b;
  let bits = 0;
  while (diff) {
    diff &= diff - 1n;
    bits++;
  }
  return bits;
}

export interface TemplateCluster {
  /** Indexes into the input array. */
  indexes: number[];
  /** Distinct authors in the cluster — the number that makes it suspicious. */
  distinctAuthors: number;
}

/** Distance at or below which two comments are treated as one template. */
export const TEMPLATE_MAX_DISTANCE = 6;

/**
 * Cluster near-duplicate comments.
 *
 * One author repeating themselves is a habit; ten keys posting one template is
 * a purchase, which is why `distinctAuthors` is reported separately from size.
 */
export function templateClusters(
  comments: Array<{ pubkey: string; content: string }>,
  maxDistance: number = TEMPLATE_MAX_DISTANCE,
): TemplateCluster[] {
  const fingerprints = comments.map((c) => simhash(c.content));
  const assigned = new Array<number>(comments.length).fill(-1);
  const clusters: TemplateCluster[] = [];

  for (let i = 0; i < comments.length; i++) {
    if (assigned[i] !== -1 || fingerprints[i] === 0n) continue;
    const indexes = [i];
    assigned[i] = clusters.length;
    for (let j = i + 1; j < comments.length; j++) {
      if (assigned[j] !== -1 || fingerprints[j] === 0n) continue;
      if (hammingDistance(fingerprints[i], fingerprints[j]) <= maxDistance) {
        assigned[j] = clusters.length;
        indexes.push(j);
      }
    }
    if (indexes.length < 2) {
      assigned[i] = -1;
      continue;
    }
    clusters.push({
      indexes,
      distinctAuthors: new Set(indexes.map((idx) => comments[idx].pubkey)).size,
    });
  }
  return clusters.filter((c) => c.distinctAuthors >= 2);
}

// ─── Facade ──────────────────────────────────────────────────────────────────

export interface TargetAssessment {
  /** 0–1 suspicion that this target's engagement was purchased. */
  suspicion: number;
  flags: string[];
  burst: BurstAssessment;
  cohorts: Cohort[];
  templates: TemplateCluster[];
  /** Per-actor contribution multiplier after cohort down-weighting. */
  weights: Map<string, number>;
}

export class CollusionService {
  /**
   * Assess one target's engagement.
   *
   * `history` is engagement this client has seen on *other* targets — cohort
   * detection is meaningless without it, since inventory reuse is only visible
   * across orders.
   */
  static assessTarget(
    observations: EngagementObservation[],
    options: {
      publishedAt?: number;
      history?: EngagementObservation[];
      firstSeenByActor?: Map<string, number>;
      clusterOptions?: ClusterOptions;
    } = {},
  ): TargetAssessment {
    const burst = burstAssessment(observations, options.publishedAt, options.firstSeenByActor);
    const cohorts = coEngagementCohorts(
      [...(options.history ?? []), ...observations],
      options.clusterOptions,
    );

    const onThisTarget = new Set(observations.map((o) => o.pubkey));
    const weights = new Map<string, number>();
    for (const actor of onThisTarget) weights.set(actor, 1);
    const flags = [...burst.flags];

    let cohortedActors = 0;
    for (const cohort of cohorts) {
      const present = cohort.members.filter((m) => onThisTarget.has(m));
      if (present.length < 2) continue;
      cohortedActors += present.length;
      const weight = cohortWeight(cohort.members.length);
      for (const member of present) weights.set(member, weight);
    }
    if (cohortedActors > 0) flags.push('co-engagement-cohort');

    const templates = templateClusters(
      observations
        .filter((o) => typeof o.content === 'string' && o.content.trim().length > 0)
        .map((o) => ({ pubkey: o.pubkey, content: o.content as string })),
    );
    if (templates.length > 0) flags.push('template-comments');

    const cohortShare = onThisTarget.size ? cohortedActors / onThisTarget.size : 0;
    const templateShare = observations.length
      ? templates.reduce((sum, c) => sum + c.indexes.length, 0) / observations.length
      : 0;

    const suspicion = Math.min(
      1,
      0.45 * burst.score + 0.35 * cohortShare + 0.2 * templateShare,
    );

    return { suspicion, flags, burst, cohorts, templates, weights };
  }
}

export default CollusionService;
