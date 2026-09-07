---
id: 04
title: Transport tier ordering and fallback policy
map: ../MAP-p2p-recomposition.md
labels: [wayfinder:grilling]
status: open
assignee:
blocked-by: [01, 02]
---

## Question

Given the tiers that ticket 01 and ticket 02 prove real, in what order does a peer try them,
and what moves it between them?

Decide:

- The **priority order** across: configured relays, Gun rendezvous souls, LAN rendezvous
  peer, subnet sweep, native LAN helper, WebRTC direct, peer-assisted introduction,
  manual paste/QR.
- **Parallel or sequential** — does a cold-starting peer race all tiers at once, or walk
  them in order with timeouts? What are the timeouts?
- **Promotion and demotion**: when does a peer stop using a working relay in favour of a
  direct LAN link (or the reverse), and what evidence triggers the switch?
- **Sufficiency**: what counts as "the network has recomposed" — one peer? a quorum?
  a specific community's peers? This is the success condition the whole map points at.
- **What the user sees**: is tier a visible state (badge, network page) or invisible?
  What does the user have to be told when the stack has fallen through to manual?
- **Cost ceilings**: the tiers are not free (subnet sweeps burn battery, mDNS helper needs
  install). What is the budget, and who decides to spend it — heuristics or the user?

## Why it matters

This is the spine of the map. The seam, the recomposition state machine, and the hints an
invite link carries all hang off this ordering.
