---
id: 09
title: What counts as relay-free
map: ../MAP-p2p-recomposition.md
labels: [wayfinder:grilling]
status: open
assignee:
blocked-by: []
---

## Question

Ticket 02 showed the term "zero-relay" is doing two different jobs. Pin it down before the
tier ordering is decided on top of an ambiguous word.

Decide, normatively:

- Is **"no relay we operate"** acceptable as zero-relay — i.e. may the bottom tier lean on
  public third-party infrastructure (public STUN, public Gun relays, Nostr relays, the
  BitTorrent DHT, libp2p bootstrap nodes)? If yes, say plainly what the project is claiming
  when it says decentralised, and what it is not.
- What **metadata leak** is acceptable at each tier: relay operators and DHT crawlers see
  who is looking for whom; public STUN exposes a real IP and NAT mapping. Which of these is
  tolerable by default, which needs consent, which is never done?
- Is there a **hard floor** the app guarantees — a mode where nothing but the two proven
  relay-free paths (manual paste/QR, same-LAN host-only ICE) is used? If so, is it a user
  setting, a threat-model preset, or the always-available last resort?
- What the **UI claims**. Whatever wording ends up in Settings and on the network page is a
  promise; decide it here rather than letting a component invent it.

## Why it matters

Every tier in ticket 04 is ranked against this definition, and ticket 05's link hints
advertise the tiers. If "relay-free" stays fuzzy, the ordering silently encodes a privacy
position nobody chose.
