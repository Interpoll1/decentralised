# Coordination impact prototype

Local, offline and review-only. Requires the repository's installed Node
dependencies; uses existing Schnorr/SHA-256 implementations. No new dependency,
API endpoint, production key, server process or browser integration.

Read [the contract](../../docs/security/COORDINATION_IMPACT_V1.md) first.

```sh
node --test tools/coordination-impact/core.test.mjs
node tools/coordination-impact/benchmark.mjs
node tools/coordination-impact/demo.mjs ../coordination-impact-demo
```

The demo creates signed **synthetic** public actions and an explicitly separate
fixture observer pin. It does not detect real bots. Use the test observer key
from `expected-observer.txt` as `EXPECTED_OBSERVER` below:

```sh
node tools/coordination-impact/cli.mjs analyze ../coordination-impact-demo/snapshot.json EXPECTED_OBSERVER ../coordination-impact-demo/receipt.json
node tools/coordination-impact/cli.mjs verify ../coordination-impact-demo/snapshot.json EXPECTED_OBSERVER ../coordination-impact-demo/receipt.json
```

Replace the placeholder with the actual 64-hex fixture pin, without angle
brackets. For real evidence, the expected observer must come from an independently
approved operator policy; never accept the key merely because an input lists it.
Output files are created exclusively and never overwrite an existing receipt.

`REVIEW_CANDIDATES` includes exact account-pair witnesses and a ranking table with
and without each connected component's latest reactions. `NO_PATTERN` means only
this relation was absent in this supplied sample. `CANNOT_ESTABLISH` includes
invalid evidence, capacity limits, cancellation, deadline or worker failure.
Receipt verification recomputes signatures, relation, scores and ranks; a match
is `VERIFIED_RELATIVE_TO_SNAPSHOT`. It is not proof of observer truth/completeness,
causation, human uniqueness or malicious coordination. Real campaigns can match.

`host.mjs` runs parsing/verification/analysis in a disposable Node worker. One
active job, no queued backlog, bounded input and heap, deadline and cancellation.
Do not call the synchronous pure `core.mjs` from a browser UI. Do not schedule
this on every interaction: admission and feed rendering must remain independent.
The prototype has no scheduler and performs no action until explicitly invoked.

Benchmarks are synthetic Node workloads at 19, 100, 500 and 1,000 observations,
three repetitions each, with three idle host event-loop samples. Fixture signing
is outside the measured analysis interval. CPU is process-wide; worker heap is
sampled at completion, not a peak measurement; RSS deltas are noisy and include
worker teardown/GC. Event-loop p99 on a short window is not a production SLA or
a browser/mobile/feed-latency measurement. Deadline exhaustion is reported,
never disguised as an absence of coordination.

Production export, public-target verification, durable observation retention,
operator trust configuration, false-positive calibration and client/server
integration remain separate work. This module does not modify the previous
public-engagement admission patch or any existing application subsystem.
