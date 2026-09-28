# Coordination impact v2: repeated cohorts

This opt-in offline analyzer finds repeated shared activity for human review.
It does not decide whether participants are bots or whether their intent is
malicious. The v1 snapshot, authentication, analyzer, exporter and application
remain unchanged. V2 receipts bind their own policy digest.

## Relation

Start from authenticated observations and the latest reaction per actor/target.
Clears and old reactions do not contribute matching evidence. The snapshot is
one observer-attested ten-minute sample, not a complete activity history.

A cohort contains at least three actors who reacted in the same direction on
the SAME set of at least three targets. On each shared target the full cohort's
maximum receipt-time span is at most 60 seconds. A path linking different
pairs on different targets is insufficient.

Its repeat support is `(actorCount - 1) * (sharedTargetCount - 1)`, with a
minimum of eight: five actors on three targets, four on four, or three on five
can qualify. This is an explicit evidence threshold, not a probability or
learned confidence score. Other activity does not dilute shared support.
Three actors on only three or four targets request more context instead of
being silently treated as no pattern.

For each target/direction, identify maximal 60-second response windows. A
window containing at least three actors and at least three quarters of ALL
active actors in the supplied sample is broad context. Pairs within such a
window do not supply selective evidence for a particular cohort. Receipts
retain broad-window counts, times and event IDs. Three broad target responses
request context, without naming a review group. This can also occur for a
coordinated majority: it is abstention due to inadequate contrast, not a claim
of innocence. A broad response on one target alone is not repeated evidence.

The implementation builds pair target masks, intersects triangles, closes
witness sets under intersection, and enumerates bounded maximal cliques for
each witness set. Closing under intersection prevents extra targets shared by
different subgroups from hiding their larger common pattern.

A weaker overlapping cohort is suppressed only when a RETAINED cohort has
at least 50% more repeat support, shares at least three members, and leaves
fewer than three new members. Consider cohorts in descending support order;
discarded alternatives cannot suppress others. A small support advantage from
extra shared activity must not erase a comparably supported larger cohort.
This is an explicit heuristic for weak extensions, not proof of membership.
Ambiguous overlaps remain explicit; a receipt reports overlapping actors. Each group's
ranking impact is calculated independently and MUST NOT be summed across
overlapping groups.

All thresholds and search limits are explicit in
[policy.mjs](../../tools/coordination-impact-v2/policy.mjs). They were developed
against regression cases. Unseen seeded controls are evaluated separately;
neither dataset is a real-user accuracy measurement.

## Status and evidence

- `REVIEW_CANDIDATES`: at least one supported cohort; no intent verdict.
- `CONTEXT_REQUIRED`: broad repeated activity or weak repeated evidence,
  with no supported candidate. This is not a clean bill of health.
- `NO_PATTERN`: no supported or context-requiring repeated pattern under
  this policy in the supplied sample; not proof of no coordination.
- `CANNOT_ESTABLISH`: invalid authority/data or a resource limit. No partial
  accepted receipt is returned.

A v2 receipt includes exact common witnesses, support, broad context, search
counters, suppressed-pattern counts, optional overlaps and the unchanged
`window-net-reactions-v1` arithmetic projection. Removing a cohort does not
revive old reactions. Replay recomputes the result; it establishes consistency
with the signed inputs and policy, not source truth, completeness or intent.
Legitimate and malicious labels attached to identical evidence cannot change
the output.

## Authentication and execution

The synchronous public analysis/replay functions verify every action and the
observer signature using the unchanged shared validator and Schnorr library.
They expose no skip-authentication option.

The host starts exactly two disposable workers under ONE shared deadline.
They verify disjoint even/odd observation indexes, each validates the observer
attestation, and both independently calculate the full proposed receipt.
Their internal `PARTITION_ONLY` drafts are incomplete and not accepted evidence.
The host checks both partition identities, exact coverage of all observations,
identical receipt bytes/digests and, for replay, agreement with the claimed
receipt. Any failed, missing, inconsistent, cancelled or timed-out partition
prevents an accepted result. Inputs are copied once before dispatch. No
signature cache, cryptographic shortcut or automatic retry is used.

The default deadline remains five seconds per two-worker pass. An explicit
offline override up to ten seconds remains available. Each worker has a
64 MiB old-generation heap limit (128 MiB combined), plus its other runtime
overheads. This is not a whole-process memory limit. Timeouts/cancellation
terminate BOTH workers before the host accepts another job; there is no queue.

Input/receipt ceilings remain 1 MiB, with at most 1,000 observations, 100 targets
and 256 active actors. Pair, edge, triangle, witness-intersection, clique-search,
pattern and output caps fail closed. The inherited canonical encoding limits
also apply. The event ceiling is not a promise to accept every dense graph.

The separate pilot runner first authenticates the original signed export,
then runs analysis and fresh replay in separate two-worker passes. Export
verification is synchronous and has no worker deadline. The full pilot can
therefore take longer than five seconds. Its file CLI checks the current clock
and has no historical-policy bypass flag. Explicit historical evaluation time
does not renew authority.

## Use

Review-only, manual invocation. No feed integration, account actions, production
collection or automatic sanctions are added. Representative user activity,
actual relay schema checks and server/device measurements remain separate.
See the [README](../../tools/coordination-impact-v2/README.md) for runnable commands
and the [validation record](../../tools/coordination-impact-v2/VALIDATION.md).
