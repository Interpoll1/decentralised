# V2 validation

The repeated-cohort revision passed 169 scoped tests and all 186 declared
synthetic case checks on Windows with Node v22.15.0. Every case produced
a receipt that a fresh worker pair independently replayed. This establishes
these finite checks, not production readiness or a real-user error rate.

Policy: `coordination-impact-experiment-v2`, `repeated-cohorts-v2`.
Policy SHA-256: `c46ad51a93e589303dfda1e4ac837d383cae89551a7be24da535e40b3ea6802b`.

## Results

| Corpus | Cases | Review candidates | Context required | No pattern | Missed planted accounts | Additional accounts |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| saved | 24 | 24 | 0 | 0 | 0 | 0 |
| regression | 42 | 33 | 4 | 5 | 0 | 0 |
| challenge | 60 | 42 | 8 | 10 | 0 | 0 |
| fresh | 60 | 42 | 7 | 11 | 0 | 0 |

There were no v2 refusals, replay failures or failed account/context checks in
this corpus. Account columns compare the union of candidate members with
generator labels; they do not establish an exact partition into groups or
malicious intent. Staggered activity can produce overlapping cohorts, whose
independently calculated impacts must not be summed.

- 24 unchanged Viktor inputs reproduce the saved v1 outcomes. V2 recovers all
  eight planted accounts in each, without the earlier additional accounts.
- 42 original regression inputs are byte-identical to their development run.
- 60 challenge cases use seeds 711, 1223 and 1733. An earlier revised policy
  missed one actor in each of two heavy-unrelated cases. These cases exposed
  the suppression issue, prompted its fix, and are now explicitly regressions.
  Their exact input bytes were reused; none is claimed as unseen validation.
- 60 further cases use seeds 2221, 3253 and 4721, declared after fixing the
  rule and before evaluating these seeds. The algorithm was unchanged during
  the completed run. Profiles include small groups, unrelated activity,
  timing jitter, separate groups, popular targets and broad bursts.
- 9 legitimate-campaign controls intentionally reuse their corresponding
  coordinated-evidence inputs and produce identical receipts. There are
  177 unique snapshots among 186 case entries, not 186 independent samples.

The 37 new tests cover authenticated analysis/replay, invalid signatures in
both verification partitions, observer pins, tampered receipts, exact time
boundaries, clears, grouping regressions, bounded refusals, cancellation,
caller mutation, file CLIs and pilot policy checks. The 132 v1/pilot tests
passed on the unchanged legacy source bytes. No application build, browser,
live relay, database load or real-user validation is included.

## Resource measurements

All runs used the default five-second shared deadline per v2 pass, zero
automatic retries and two disposable workers. For the 18
1,000-reaction snapshots, analysis took 2.374-2.627 s
and fresh replay took 2.297-2.574 s. Both include
all required signature checks. These are local observations, not service limits.

Each worker allows 64 MiB old-generation heap, or 128 MiB combined, plus young
generation, stack and other overhead. V1 used one worker and 64 MiB old-generation
heap. This resource difference matters to timing comparisons. Worker heap at
completion is not peak memory; process RSS includes generation and both versions.

The saved synthetic 1,000-reaction export also passed the full v2 pilot and
fresh receipt replay. Its total was 9.226 s:
export authentication 4.324 s,
analysis 2.439 s and
replay 2.446 s. V1 returned
`CANNOT_ESTABLISH/CLUSTER_BUDGET`. No database was contacted or exported again.
The bundle has no external account labels, so its account recovery was not
scored. Replay used the explicit historical capture clock; it did not renew
the export policy. The normal CLI checks current time.

## Evidence and scope

Run from the repository root:

```text
npm run test:coordination-v2
npm run evaluate:coordination-v2 -- all ../v2-evaluation
```

The evaluator saves exact input snapshots, full results and replay summaries.
Input and receipt digests, per-case counts/timing and evaluated source hashes
are in [the committed summary](validation/2026-09-27-evaluation.json).
Summary SHA-256: `32a3da2bccb915cdf6f90a57b4147db2b37dae719ec87c6eb90f33879b042e23`.
Test output: [37 v2 tests](validation/2026-09-27-v2.tap) and
[132 unchanged legacy tests](validation/2026-09-27-legacy.tap).

Base: `4fb369f65580bc0ed9d72617d2c5418c06ce578a`.
Frozen v1 analyzer tree: `edccfed0b8efd6bde96dedaff8e93395381f7713`.
Old analyzer, exporter, shared authentication, application and deployment
files are unchanged. The new runner is opt-in and review-only.

Three-member groups need five shared targets for supported candidacy; weaker
repeats can request context. A broad majority can also be coordinated:
`CONTEXT_REQUIRED` is abstention, not proof of innocence. Suppression remains
an explicit heuristic, with ambiguous overlaps retained. Dense graphs can
still exceed bounded search limits. Representative user data and deployment
measurements remain necessary before claims about live accuracy or speed.
See the [contract](../../docs/security/COORDINATION_IMPACT_V2.md).
