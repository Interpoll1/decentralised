---
id: 03
title: Current wiring inventory
map: ../MAP-p2p-recomposition.md
labels: [wayfinder:task]
status: open
assignee:
blocked-by: []
---

## Question

What is the actual call graph of discovery and transport in this repo today, before anything
is recomposed?

This is manual work, not a decision: produce a precise inventory covering

- `discoveryService`, `webrtcService`, `signalingService`, `meshService`,
  `browserRelayService`, `relayManager`, `websocketService`, `resilienceService`,
  `inviteLinkService`, `peerReputationService`, plus `utils/rendezvous.ts`.
- For each: what it owns, who calls it (stores, views, components, other services), what
  state it holds, and what it assumes is reachable.
- Where responsibilities **overlap or contradict** — two services that both decide "which
  peer do we talk to", two places that both hold a peer list, dead code paths that nothing
  calls any more.
- Where a relay is assumed and the failure mode when it is absent (does it retry forever,
  throw, degrade silently?).
- What the invite link does today end-to-end: generation in `inviteLinkService`, the
  fragment/key handling, what consumes it on the joining side.

Output: `docs/wayfinder/research/03-current-wiring.md`, with a diagram or table of the call
graph and an explicit list of overlaps/dead paths. Facts and `file:line` references only —
no proposals, no refactoring.

## Why it matters

The seam ticket cannot decide what collapses onto one interface without knowing what is
there and what is already vestigial.
