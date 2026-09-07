---
id: 02
title: Zero-relay signalling survey
map: ../MAP-p2p-recomposition.md
labels: [wayfinder:research]
status: closed
assignee: research-agent (charting session)
blocked-by: []
---

## Question

With no relay server reachable, what can carry the first WebRTC offer/answer between two
browsers — and what does each option cost the user?

Survey and characterise, with current (2026) evidence:

- **Manual signalling** — already implemented in `P2PManualSignal.vue`. Offer/answer via
  copy-paste or QR. Size of the payload after compression, whether it fits a QR code,
  how stale an offer may get, ICE-gathering timing.
- **Peer-assisted introduction** — an already-connected peer relays signalling for a third.
  How other browser-P2P systems do this, and what it needs from the mesh layer.
- **LAN rendezvous** — one peer serves signalling over HTTP/WS on the LAN (this repo's
  `browserRelayService`). What existing projects do here and how they are addressed.
- **Shared-medium tricks** — BroadcastChannel (same origin, same browser only),
  localStorage events, Web Bluetooth / Web NFC / Web Serial as out-of-band channels:
  which are real options in a browser today and which are dead ends.
- **Third-party-carried signalling** — using someone else's public infrastructure
  (public STUN lists, public Gun relays, Nostr relays, IPFS/libp2p WebRTC-direct or
  WebTransport bootstrap nodes). For each: does it violate "zero-relay", or is it merely
  "no relay *we* run"? Name the operational and privacy costs.
- **WebRTC without STUN at all** — host-candidate-only connections on a LAN: when do they
  succeed, given the mDNS candidate obfuscation from ticket 01?

Output: for each option — works / conditional / dead end, user friction, whether it is
truly serverless, and what it needs from the rest of the system. Write it to
`docs/wayfinder/research/02-zero-relay-signalling.md`.

## Resolution

Full findings: [`docs/wayfinder/research/02-zero-relay-signalling.md`](../research/02-zero-relay-signalling.md).

**Only two options are unconditionally relay-free**: manual paste/QR, and same-LAN
host-candidate-only ICE. Everything else either requires a connection to already exist, or
reintroduces a third party.

- **Manual paste / QR** — works, truly serverless (`P2PManualSignal.vue`, `webrtcService.ts`).
  Non-trickle ICE bundle is 2–6 KB, too big for reliable QR; a compact scheme (QWBP-style,
  55–100 bytes vs 6.2 KB raw SDP) is needed to make QR real.
- **Peer-assisted mesh introduction** — works, but only once ≥1 connection exists. Mirrors
  js-libp2p Circuit Relay's SDP handshake, minus the reservation system.
- **LAN rendezvous** (`browserRelayService.ts`) — conditional. The LAN-IP branch is genuinely
  serverless; the tunnel-bridge branch just swaps our relay for someone else's.
- **Host-candidate-only, no STUN** — conditional. Works only inside one mDNS broadcast
  domain; breaks across VLANs, guest SSIDs, and under AP client isolation. Zero friction
  when it fires, but not a general answer.
- **Third-party public infra** (Nostr, public Gun relays, BitTorrent DHT, libp2p bootstrap)
  — conditional and low-friction, but this is "no relay *we* run", not "no relay". Metadata
  is visible to relay operators and DHT crawlers; public STUN exposes real IP and NAT mapping.
- **Dead ends**: BroadcastChannel/localStorage (same-origin, same-browser only, so useless
  cross-device); Web NFC as an SDP carrier (~6% support, payload far too small); Web Serial
  (needs a cable). Web Bluetooth is conditional at best — Chromium-only, ~76%, pairing friction.

**Consequence for the map**: "zero-relay capable" must be documented narrowly, and the
compact-bundle question is now load-bearing for QR-shareable invites.

## Why it matters

Defines the bottom tier of the stack. If nothing below "manual paste" is real, then
"zero-relay capable" means something much narrower than it sounds, and the tier ordering
and invite-link envelope must both be honest about that.
