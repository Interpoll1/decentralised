# Coordination impact v2

An opt-in offline analyzer for repeated shared reactions. It supports small
groups with sufficient repeated evidence, tolerates unrelated activity and
separates broad responses from review candidates. Every result has a replayable,
policy-bound receipt. It does not classify bots or malicious intent.

Read the [exact contract](../../docs/security/COORDINATION_IMPACT_V2.md) and
[validation results](VALIDATION.md). The v1 tools and application are unchanged.

## Install and test

Run from the repository root with Node 22.15 or later:

```text
npm ci --ignore-scripts
npm ci --prefix tools/coordination-pilot --ignore-scripts
npm run test:coordination-v2
npm run test:coordination
npm run test:coordination-pilot
```

The second install is for the existing pilot MySQL adapter tests/export.
V2 adds no dependencies, database operation, server route or scheduler.

## Reproduce the comparison

Output directories must be empty or absent. Each command stores exact inputs,
full outputs, source/input digests, account recovery, context results and timing.

```text
npm run evaluate:coordination-v2 -- saved ../v2-saved
npm run evaluate:coordination-v2 -- regression ../v2-regression
npm run evaluate:coordination-v2 -- challenge ../v2-challenge
npm run evaluate:coordination-v2 -- fresh ../v2-fresh
```

Or run `all` with a new directory. The complete evaluation takes several minutes:

- `saved`: Viktor's 24 unchanged sweep inputs plus the signed synthetic
  1,000-reaction MySQL export, with explicitly labeled historical replay time.
  No database export/load test is repeated.
- `regression`: 42 original development cases, 14 profiles and three seeds.
- `challenge`: 60 additional development cases, including the heavy-unrelated
  cases that exposed a suppression miss. These seeds are now regressions.
- `fresh`: 60 cases from 20 profiles and three separately declared unseen
  seeds. This extends the original profiles with small mixed groups, heavier
  unrelated activity, 1,000 background reactions, a broad burst with background
  and a one-target burst. Legitimate-campaign controls intentionally duplicate
  matching coordinated-evidence inputs.

The complete run contains 186 case entries and one saved export replay.

Both versions retain a five-second analysis deadline by default. V2 uses two
workers and a higher combined memory ceiling. These resource differences are
recorded, not hidden. Optional `--deadline-ms 10000` changes only v2's explicit
budget; there is no automatic retry. Refusals have null recovery counts and
must not be counted as zero errors. `CONTEXT_REQUIRED` is a completed abstention,
not a finding that nothing happened. Finite synthetic checks are not a real-user
error rate.

## Analyze and independently replay a snapshot

Supply the expected observer from independent policy, not trust inferred from
a key inside the input. A sweep wrapper must first be reduced to its snapshot;
the evaluator already writes raw snapshot files under `inputs/`.

```text
node tools/coordination-impact-v2/cli.mjs analyze SNAPSHOT EXPECTED_OBSERVER RECEIPT
node tools/coordination-impact-v2/cli.mjs verify SNAPSHOT EXPECTED_OBSERVER RECEIPT
```

These commands handle v2 receipts. Output files are never overwritten. An
explicit trailing `--deadline-ms 10000` is available for offline review.
Only the public host result after both partitions complete is usable; an
internal `PARTITION_ONLY` draft is not a verified analysis.

## Opt-in pilot

Obtain an approved public sample through the unchanged v1 exporter first, then:

```text
node tools/coordination-pilot/cli-v2.mjs BUNDLE POLICY_SHA256 OUT_DIR
```

The pilot authenticates the signed export and current policy, analyzes it and
replays the receipt in fresh workers. It emits no usable receipt until replay
succeeds. The CLI exposes no historical-clock bypass. The existing v1 CLI
default is unchanged.

Whole-pilot time includes synchronous export authentication and two independent
analysis passes. The per-pass deadline is not a total-duration promise. Reported
worker heap is the sum at each worker's completion, not peak memory; local
timings and process RSS do not establish production performance.
