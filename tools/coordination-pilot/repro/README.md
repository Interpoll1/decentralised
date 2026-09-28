# Coordination pilot: volume repro (2026-09-27)

Scripts and inputs behind the volume findings: extra accounts linked into candidate
clusters as reaction volume grows, and `CANNOT_ESTABLISH` at the exporter's 1,000-row
maximum. All data is synthetic; keys are derived from public seeds and must never be
used for real data. Nothing here changes the analyzer or exporter.

Run from the repository root after the setup in `../README.md`
(`npm ci --ignore-scripts` and `npm ci --prefix tools/coordination-pilot --ignore-scripts`).

## 1. Replay the saved inputs (no database, ~1 min)

```text
node tools/coordination-pilot/repro/replay-inputs.mjs
```

Re-analyzes every `inputs/sweep-*.json` snapshot and compares against the result recorded
at generation (`same`/`DIFF`), then replays `inputs/db-export-1000.bundle.json` (the signed
export from the MySQL run) through the real `runPilot`, with `now` pinned to its capture
time because its policy has expired. Expected: `db-export-1000: CANNOT_ESTABLISH/CLUSTER_BUDGET`.

## 2. Regenerate the sweep

```text
node tools/coordination-pilot/repro/sweep.mjs [--write DIR]
```

Each case: 8 coordinated accounts react `up` on `post-0..4` (20 s apart per post, 0.5 s
apart per account) plus N background accounts that each react `up` on K distinct random
posts at uniform random times in the 10-minute window, 20 posts total. Keys, times and
target choices are derived from the seed `coordination-pilot-repro|NxK|trialT`, so outcomes
are identical on every run. Reaction signatures differ byte-wise between runs (Schnorr
signing uses fresh auxiliary randomness), which does not affect IDs or analysis.

Recorded results (`other` = accounts outside the planted group that appear in a cluster):

| Background | Events | trial 0 | trial 1 | trial 2 |
|---|---|---|---|---|
| 10 × 3 | 70 | 8/8, other 0 | 8/8, other 0 | 8/8, other 0 |
| 20 × 3 | 100 | 8/8, other 0 | 8/8, other 0 | 8/8, other 0 |
| 30 × 3 | 130 | 8/8, other 0 | 8/8, other 0 | 8/8, **other 1** |
| 40 × 3 | 160 | 8/8, other 0 | 8/8, **2 clusters, other 2** | 8/8, other 0 |
| 50 × 3 | 190 | 8/8, other 0 | 8/8, other 0 | 8/8, other 0 |
| 56 × 3 | 208 | 8/8, other 0 | 8/8, other 0 | 8/8, other 0 |
| 56 × 5 | 320 | 8/8, other 0 | 8/8, **2 clusters, other 2** | 8/8, other 0 |
| 192 × 5 | 1000 | `CLUSTER_BUDGET` | `ACTOR_BUDGET` | `ACTOR_BUDGET` |

Uniform random background is a simplification; real activity concentrates on popular
posts. Three trials per case is enough to show the effect exists at modest volume, not
to estimate its rate.

## 3. Export load check on the staging table definitions (Docker)

`load-check.mjs` seeds a throwaway MySQL 8.0.46 container created from
`inputs/staging-schema.sql` (the staging definitions of the two tables the pilot reads)
and times three full export + run cycles at 1,000 in-window reactions. Usage and the
container commands are in its header; it is destructive to its target server. Its data
is randomized, which is why the exact run input is saved as the bundle above.
`inputs/db-export-policy.json` is that run's policy; its observer key was throwaway and
is not included.

Measured on the reporting machine (not the VPS): export ~1.33 s wall, ~85 MB peak RSS,
~1.4 s CPU; database ~8 ms ledger query, ~10 ms metadata query, rows examined equal to
rows returned; bundle 522 KB; run refused `CLUSTER_BUDGET` after ~2.6 s CPU, ~105 MB.
