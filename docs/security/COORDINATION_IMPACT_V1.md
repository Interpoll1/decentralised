# Coordination impact v1 — offline prototype contract

Status: local experiment. No application imports, live relay ingestion, feed
changes, bans, account scores, private-content analysis or network calls.
This extends the earlier offline coordination experiment with signed snapshots,
explicit relationships, deterministic impact receipts and independent replay.
It is not a claim of a globally novel algorithm, Semantic ABI conformance, unique
humanity, malicious intent or a deployed bot detector.

## Evidence and authority

A caller supplies an expected observer public key separately from the snapshot.
An observer-signed snapshot commits to namespace, target type, a ten-minute
window, public target descriptors and accepted reaction envelopes with observer
receipt times. Its signature must verify under that expected key. Discovering a
key inside an input does not authorize it. Each actor signature is also verified,
including namespace/target binding and freshness at the asserted receipt time.

The observer attests acceptance time, public visibility, target existence and
its exported sample. Those assertions are NOT independently proved by its
signature. The prototype has no production exporter or observer signing key.
All demonstration identities are synthetic. A future exporter must enforce the
public-target policy and export only committed rows from the admission ledger.
Raw WebSocket events, unsigned legacy counts, views, private/group content and
caller-supplied `verified:true` flags cannot substitute for this contract.

Snapshot schema: exactly `version:1`, `namespace`, `targetType` (`post` or
`comment`), `from`, `to`, `observer`, `targets`, `observations`, `signature`.
Target: exactly `{id,visibility:"public"}`. Observation: exactly
`{action,receivedAt}` with an unchanged public-engagement-v1 reaction envelope.
The duration is exactly 600,000 ms. Receipt times lie inclusively in the window.
The observer signs SHA-256 of canonical JSON of
`["interpoll.coordination-snapshot.v1", version, namespace, targetType, from, to,
observer, sortedTargets, sortedObservations]`. Targets sort by id; observations
by action id then receipt time. Object keys sort lexicographically, arrays retain
this defined order, numbers are safe integers, strings are bounded. Action IDs
and signatures remain those defined by PUBLIC_ENGAGEMENT_V1.md.

Duplicate IDs with identical action/receipt time coalesce. Conflicting copies,
unknown fields, missing/publicity-conflicting targets and invalid signatures
reject the whole analysis. Latest `(createdAt,id)` reaction per actor/target
determines the observed state; repeated toggles never inflate a score. There is
no inferred initial state before the window and no invented legacy baseline.

## Relation and counterfactual

Two accounts form a review edge if their latest non-cleared reactions agree in
direction and have receipt times at most 60 seconds apart on at least three
targets. Each target/direction must have at least five distinct actors in the
supplied state. Connected components of those edges form review clusters;
connectivity does not mean every pair coordinated, or that members are bots.
Every edge includes exact action IDs/target/time-gap witnesses.

The explicit ranking projection is `window-net-reactions-v1`: latest up = +1,
down = -1, none = 0; score descending, target id ascending breaks ties. Rank uses
only the declared candidate targets and supplied window. For each cluster remove
all its latest reactions, without falling back to its earlier actions, and
recompute. Report scores, ranks and removed action IDs. Removing coordinated
downvotes can increase a score. Displacement is arithmetic, not causal evidence
of real-world harm or grounds for exclusion.

This is NOT the production personalized feed. `src/utils/feedRanking.ts` also
uses preferences, text matches, freshness and communities. That implementation
and all production ranking/tallies remain unchanged. The prototype does not
export preferences or claim to reconstruct a person's feed.

## Receipts and bounds

Receipts bind the exact policy digest, canonical input digest, observer, window,
namespace, target type, evidence edges and both rankings. Reverification reruns
the algorithm against the separately supplied snapshot and expected observer;
checking a receipt's own hash alone is insufficient. `VERIFIED` means this
calculation matches these inputs and policy, not that the observer's assertions
are true, the sample is complete, or somebody is a bot.

Hard bounds: 1 MiB raw snapshot; 1,000 observations; 100 targets; 64 actors per
target/direction; 50,000 pair comparisons; 8,192 distinct pairs; 64 retained
qualifying edges; 32 actors per component; eight components; 1 MiB receipt.
Over-budget inputs return `CANNOT_ESTABLISH` without partial accusations or
silent truncation. No time-based eviction, historical accumulation or unbounded
queue. Canonical encoding also bounds depth/node count/string size.

The Node worker host permits one job, rejects concurrent submissions as BUSY,
and enforces a five-second deadline and 64 MiB old-generation heap limit. It can
be cancelled; the next job can run afterward. The worker does all parsing,
signature checking and analysis. No module is loaded by the browser/feed.
Benchmarks measure synthetic worker wall/CPU/heap and host event-loop delay,
including cold start. This is not a mobile/browser/feed-latency measurement.
Budget stops are acceptable results, not evidence of no coordination.

## Review and rollout gate

Legitimate campaigns can satisfy the relation. Sparse samples, omitted initial
state, omitted candidates and a dishonest observer can distort the result.
Cryptography does not solve those problems. There are no automatic sanctions.
Before any integration: review this policy; implement and test a public-target
exporter; measure actual device/feed behavior; define explicit operator/observer
trust and retention; and calibrate false positives against representative data.
The prototype neither creates nor loads production secrets.
