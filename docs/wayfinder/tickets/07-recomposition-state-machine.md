---
id: 07
title: Recomposition state machine
map: ../MAP-p2p-recomposition.md
labels: [wayfinder:grilling]
status: open
assignee:
blocked-by: [04]
---

## Question

What are the states a peer moves through as the network forms, breaks, and re-forms — and
what event drives each transition?

Decide the machine for at least these entries:

- **Cold start, no known peers, no link** — the hardest case. What does the app do, and
  what does it show the user while doing it?
- **Cold start with an invite link** — the link's hints seed the tier walk from ticket 04.
- **Warm start** with a persisted peer set of unknown freshness.
- **Network change** — laptop moves LAN, VPN toggles, wifi to cellular. What is invalidated?
- **Partition and merge** — two islands of peers that were separated and now can see each
  other. What reconciles, and does anything need to happen beyond Gun's own sync?
- **Relay returns** after a relay-less period.

For each state: entry condition, what runs, exit conditions, timeouts, and what the user
sees. Also decide **where this machine lives** — a service, a store, or a composable — given
the repo convention that stores call services and components call stores.

## Why it matters

The request is "recomposition", and this ticket is where that word gets a definition
precise enough to implement and to test.
