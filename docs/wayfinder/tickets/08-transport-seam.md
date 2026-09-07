---
id: 08
title: The transport seam
map: ../MAP-p2p-recomposition.md
labels: [wayfinder:grilling]
status: open
assignee:
blocked-by: [03, 04, 07]
---

## Question

What is the single interface every tier implements, and how do today's services collapse
onto it?

Decide:

- **The interface**: the minimum contract a tier must satisfy — discover peers, offer a
  channel, report health, tear down. Its exact shape in TypeScript terms, and what it
  deliberately does *not* expose.
- **Who owns tier selection**: one coordinator that drives the ordering from ticket 04, with
  the tiers themselves dumb — or tiers that self-promote. Where the recomposition state
  machine from ticket 07 sits relative to it.
- **The collapse**: for each service in the ticket 03 inventory — becomes a tier, becomes
  part of the coordinator, stays as-is, or dies. Name every one; no service left unassigned.
- **Gun's place**: Gun has its own peer list and its own reconnection logic. Is Gun a tier
  underneath the seam, a consumer above it, or does it keep its own parallel path? This is
  the decision most likely to be quietly fudged — do not leave it ambiguous.
- **The blast radius**: which stores, views, and components change shape as a result, and
  which `copilot-*.md` contracts need updating when this is eventually built.

## Why it matters

Six services currently share this job with overlapping responsibilities. Without one seam,
"tiered fallback" becomes six services each with their own opinion about who to talk to —
which is the state the map exists to leave behind.
