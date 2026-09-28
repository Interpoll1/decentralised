export const POLICY = Object.freeze({
  version: 'coordination-impact-experiment-v2', ranking: 'window-net-reactions-v1',
  relation: 'repeated-cohorts-v2', windowMs: 600_000,
  coincidenceMs: 60_000, minSharedTargets: 3, minClusterActors: 3,
  minRepeatSupport: 8,
  dominanceNumerator: 3, dominanceDenominator: 2,
  broadNumerator: 3, broadDenominator: 4,
  maxInputBytes: 1_048_576, maxEvents: 1000, maxTargets: 100, maxActiveActors: 256,
  maxComparisons: 125_000, maxPairs: 32_640, maxEdges: 2048,
  maxTriangleTests: 250_000, maxWitnessSets: 512, maxWitnessIntersections: 131_072, maxCliqueSearchSteps: 100_000,
  maxPatterns: 256, maxClusterActors: 64, maxClusters: 32, maxReceiptBytes: 1_048_576,
});
