---
id: 06
title: Peer-as-LAN-rendezvous trust and UX
map: ../MAP-p2p-recomposition.md
labels: [wayfinder:grilling]
status: open
assignee:
blocked-by: [01]
---

## Question

If one peer on a LAN serves as the rendezvous others find, what is the trust story and what
does that peer's user actually experience?

Decide:

- **Who volunteers**: automatic election, explicit opt-in, or only the peer that generated
  the invite link? What happens when the volunteer's tab closes?
- **What the volunteer learns** about everyone who connects through it — IPs, identities,
  which communities they asked for — and whether that is acceptable, or must be blinded.
- **Threat model for a hostile LAN peer**: an attacker on the same coffee-shop network who
  answers discovery first. What can they do — eclipse a joiner, harvest identities, serve a
  forged peer list, MITM the signalling? Which of these does signing already prevent?
- **Whether the volunteer's browser can even serve** — `browserRelayService` exists, but
  ticket 01 decides whether other pages may reach it. If it cannot, does this tier require
  the native helper, and does that change the answer to "who volunteers"?
- **The consent surface**: what the volunteering user is told, what the joining user is
  told about who they just trusted.
- **Same-network search UX**: how a user asks "who's here?" and what a result looks like
  before any trust decision has been made.

## Why it matters

"Search on the same network" is the half of the request most exposed to a hostile local
network, and it is the tier a user is most likely to reach for in the room where they are
sharing the link.
