---
id: 02
title: Zero-relay signalling survey
ticket: ../tickets/02-zero-relay-signalling-survey.md
map: ../MAP-p2p-recomposition.md
status: complete
---

# Zero-relay signalling survey

Question: with no relay server reachable, what can carry the first WebRTC offer/answer
between two browsers, and what does each option cost the user? Evidence dated 2026-09.

---

## 1. Manual signalling (copy-paste / QR)

This repo already implements this tier: `src/services/webrtcService.ts`
(`createManualOffer` / `acceptManualOffer` / `acceptManualAnswer`) and the UI in
`src/components/P2PManualSignal.vue`. ICE is gathered **non-trickle**
(`waitForIceGathering`, 4s cap) so the whole SDP + all local candidates ship as one
base64 JSON blob (`encodeBundle`) — no live channel is needed at all, which is the
correct design for a total blackout.

Cost: a full offer/answer SDP is roughly 2–6 KB depending on how many ICE candidates
and codecs are enumerated (a plain data-channel-only offer is smaller than a
video-call SDP, but the repo's bundle is JSON+base64-wrapped SDP with candidates
baked in, not trimmed). A "full video call" SDP was measured at 6,255 bytes, well
over the ~2,953-byte cap of a Version-40 QR code, meaning **copy-paste is the reliable
delivery route today**; QR needs a size-reduction scheme. The QWBP protocol
(Martin Garcia Monterde, Jan 2026) demonstrates a purpose-built compact encoding that
gets a WebRTC bootstrap payload down to 55–100 bytes (a 97.79% reduction vs raw SDP)
by re-deriving ICE ufrag/pwd and fingerprint deterministically and dropping
redundant fields, fitting QR Version 4–5. That is a different, much more invasive
encoding than "compress the SDP JSON" — it would require the local offerer/answerer
to reconstruct a full SDP from a handful of parameters rather than reusing the
browser's `RTCSessionDescription` object as this codebase does. Data-channel-only
offers (no media) are meaningfully smaller than the 6.2 KB video figure and gzip
compresses SDP well, so a compact QR-fitting bundle is reachable without going as far
as QWBP, but the current implementation ships raw JSON+base64 which is QR-hostile at
anything beyond a handful of candidates.

Staleness: ICE credentials and candidates in a non-trickle offer are valid until the
peer's NAT binding or the offering side's `RTCPeerConnection` closes/times out — in
practice a manual bundle is good for **minutes**, not hours, because host/srflx
candidates and STUN-mapped ports expire. The UI doesn't show or enforce a TTL; users
who paste a stale invite get a connect failure with no diagnostic hint. ICE gathering
itself (the 4-second cap in `waitForIceGathering`) is why copy-paste feels slow versus
a live signalling round trip.

**Verdict: works.** High user friction (manual copy/paste is a common pattern in
serverless-WebRTC demos and shipped IM/file-transfer tools, e.g.
[webrtc-manual-sdp-signaling](https://github.com/david-tkalcec/webrtc-manual-sdp-signaling),
[ShareRTC](https://fberivan-pala.medium.com/sharertc-android-file-transfer-with-webrtc-and-qr-code-sdp-signaling-3a203b480f36)),
truly serverless (no third party sees the offer at all), needs nothing from the rest
of the system except a side channel the user controls (chat app, in-person QR scan).
Sources: [qwbp](https://github.com/magarcia/qwbp),
[qwbp SPECIFICATION.md](https://github.com/magarcia/qwbp/blob/main/SPECIFICATION.md),
[Breaking the QR Limit](https://magarcia.io/air-gapped-webrtc-breaking-the-qr-limit/),
[ShareRTC](https://fberivan-pala.medium.com/sharertc-android-file-transfer-with-webrtc-and-qr-code-sdp-signaling-3a203b480f36).

---

## 2. Peer-assisted introduction (mesh relay of signalling)

Already implemented as the "mesh relay" tier in `src/services/signalingService.ts`:
when neither WSS nor Gun is reachable but at least one WebRTC datachannel is already
open, a Schnorr-signed offer/answer/ICE envelope is flooded over existing
datachannels (`MESH_SIGNAL_TYPE`, hop-limited to `SIGNAL_HOP_MAX = 4`, deduped via a
bounded `seen` set with a 60s TTL on the envelope itself). This is the same pattern
used by production libp2p WebRTC: **js-libp2p's browser-to-browser transport
literally requires a relay peer to carry the SDP handshake out-of-band** (its own
`webrtc-signaling` protocol run over a Circuit Relay v2 connection) because the
WebRTC spec doesn't define an in-band handshake — once the direct connection forms,
the relay "plays no further part." That is the same shape as this repo's mesh tier,
except libp2p's relay is a dedicated, addressable relay node with a reservation
system (`HOP`/`STOP` protocol) rather than an arbitrary already-connected mesh peer;
this repo's version is more opportunistic (any mesh peer, no reservation) and
therefore lower-guarantee but needs no dedicated relay infrastructure at all.

What it needs from the mesh layer: at least one already-open datachannel to flood
over (bootstrap problem — this tier cannot be the *first* connection for an isolated
device), a replay/loop guard (present), and a hop limit (present) to bound flood
cost. It inherits whatever trust model the mesh already has — a malicious mesh peer
can drop or delay the envelope but (per the signed-envelope design) cannot forge one.

**Verdict: works, but only as a second-or-later connection.** Zero added user
friction (fully automatic) once one connection exists by any other means; not usable
to bootstrap the very first peer. Truly serverless in the sense of "no dedicated
relay server," though it does depend on some other peer being reachable — arguably
"peer-operated" rather than "serverless." Needs: an existing mesh connection,
signed envelopes, hop/TTL bounds (all present in this codebase already).
Sources: [libp2p WebRTC (browser-to-browser) docs](https://docs.libp2p.io/concepts/transports/webrtc/),
[State of WebRTC relay signaling](https://discuss.libp2p.io/t/state-of-webrtc-relay-signaling/842),
[js-libp2p-example-webrtc-private-to-private](https://github.com/libp2p/js-libp2p-example-webrtc-private-to-private).

---

## 3. LAN rendezvous (one peer serves signalling over HTTP/WS on the LAN)

This repo's `browserRelayService.ts` is actually a Gun-relay-in-a-tab, not a
signalling rendezvous per se: it tries to get a public `wss://` tunnel URL from a
bridge service (`BRIDGE_URLS`, e.g. `tunnel.interpoll.endless.sbs` or the
`localtunnel` public fallback), and if no bridge answers, falls back to exposing
`http://<lan-ip>:8765/gun` for same-network peers. Note the LAN-IP discovery trick —
opening an `RTCPeerConnection` with no ICE servers and reading the host candidate's
IP from `onicecandidate` — is a well-known non-network-request way to learn your own
local IP; this is unrelated to the mDNS-obfuscation topic in §6 because it reads the
*local* browser's own candidate, not a peer's.

Comparable prior art: PeerJS's default "PeerServer Cloud" is exactly a hosted
signalling rendezvous over HTTP/WS, and it can be self-hosted for LAN use
(same pattern as this repo's `/gun` endpoint, generalized). WebTorrent trackers
serve a similar rendezvous role for BitTorrent/WebRTC swarms over HTTP(S)/WSS.
The addressing problem is the same in all of these: a human has to learn and enter
the LAN IP (or scan a QR/URL for it), and the URL breaks the moment the serving
tab/device leaves the LAN or its IP changes (DHCP lease renewal, VPN toggling, etc).

**Verdict: conditional.** Works only when both peers are on the same LAN/broadcast
domain and can reach the serving peer's chosen port (no isolation between clients on
guest Wi-Fi, no captive portal, no client-isolation AP setting) — a common enterprise
Wi-Fi and public-hotspot restriction. User friction is moderate (must obtain and
enter/scan an IP:port URL). Not truly serverless when it falls through to the
tunnel-bridge path (that bridge is third-party infrastructure genuinely in the
critical path, just not one InterPoll operates) — only the LAN-only fallback branch
is actually serverless. Needs a Gun relay running in the serving tab and an addressed
URL exchanged by some other channel (manual/QR again).

---

## 4. Shared-medium tricks

- **BroadcastChannel** — real and reliable, but strictly same-origin, same-browser
  (Chrome-profile) constrained: it syncs tabs of the same origin on one device, never
  across devices or across browsers on the same machine. Fine for the existing
  cross-tab chain sync use case; **useless for carrying an offer between two distinct
  browsers/devices**, which is what this ticket is about. Dead end for the
  cross-device signalling problem, though already correctly used elsewhere in this
  codebase for its actual purpose (`BroadcastService`).

- **localStorage events (`storage` event)** — same-origin constraint as
  BroadcastChannel, plus it only fires in *other* tabs, not the tab that wrote the
  key. Same dead end for cross-device signalling.

- **Web Bluetooth** — real API, but Chromium-only: global support sits at ~76% as of
  April 2026 because Firefox and all Safari builds (macOS/iOS/iPadOS) do not
  implement it at all. It requires a user gesture and a device-picker dialog per
  connection (high friction — not something you can silently pair on), works only at
  close range, and app-to-app Bluetooth data transfer for signalling would need a
  custom GATT service on both ends. Conditional at best: viable as an opportunistic
  proximity channel on Chromium/Android but not a cross-browser guarantee.

- **Web NFC** — Chromium-Android only (~6% global support), needs a physical tap,
  and even where implemented it's typically read/write of NDEF records with tight
  payload limits — not suitable for carrying a multi-KB SDP blob directly, only a
  short token or URL pointing elsewhere. Dead end as a primary channel; could work as
  a "carry a short code, look the rest up via Gun/URL" pattern, not as the SDP
  carrier itself.

- **Web Serial** — requires a physical serial/USB cable and exposes a raw byte
  stream; it's a real API in Chromium but is meant for external hardware (Arduino,
  modems), not phone-to-phone or laptop-to-laptop signalling, and has no meaningful
  install base for this use case. Dead end for the stated purpose.

**Verdict:** BroadcastChannel/localStorage — dead end for cross-device (real, but
wrong problem). Web Bluetooth — conditional (Chromium/Android+desktop only, high
friction, short range). Web NFC — dead end as SDP carrier, conditional as a
short-code trigger. Web Serial — dead end.
Sources: [Web Bluetooth support](https://www.testmuai.com/learning-hub/web-bluetooth-browser-support/),
[Web NFC support](https://www.testmuai.com/learning-hub/web-nfc-browser-support/),
[caniuse Web Bluetooth](https://caniuse.com/web-bluetooth), [caniuse Web NFC](https://caniuse.com/webnfc).

---

## 5. Third-party-carried signalling (public infra InterPoll doesn't run)

Multiple production libraries now standardize on exactly this pattern —
**Trystero** (actively maintained, v0.25.2 as of ~19 days before this survey) offers
the same client API over BitTorrent DHT/tracker swarms, Nostr relays, MQTT,
Supabase, Firebase, and IPFS, explicitly marketed as "serverless" because the app
author runs nothing; **GenosRTC** and the Nostr Game Engine likewise use public Nostr
relays purely to shuttle the WebRTC handshake (often via NIP-04 encrypted DMs or an
ephemeral event kind so the relay can garbage-collect the message after delivery),
after which "the relay drops out of the loop." This repo's own Gun-inbox tier
(`SignalingService.sendGunSignal`, writing signed envelopes to
`server-config/rtc-signal/<pubkey>` and tombstoning after consumption) is
architecturally identical to the Nostr-DM pattern, just on Gun instead of Nostr.

**Does it violate "zero-relay"?** No single answer — it depends on what "zero-relay"
is meant to guarantee:
- If the goal is "the user is never dependent on infrastructure InterPoll
  operates," then public Nostr relays, public Gun relays, BitTorrent trackers/DHT,
  and libp2p WebRTC-direct/WebTransport bootstrap nodes all qualify: **not a relay
  we run**, but the offer/answer still transits somebody's server.
- If the goal is "the peers need no third party at all," none of these qualify —
  they are all **"no relay we run," not "no relay."** Only manual signalling (§1)
  and the mesh-relay tier (§2, once bootstrapped) are actually relay-free.

Costs of leaning on someone else's public infra:
- **Operational**: uptime and rate limits are outside InterPoll's control (public
  Nostr relays and BitTorrent trackers are known to be flaky/rate-limited under
  load); a relay operator can unilaterally block the app's traffic pattern.
- **Privacy**: the offer/SDP (which includes ICE candidates, i.e. IP addresses)
  transits a relay operator's server even if payload is app-layer-encrypted; the
  relay sees connection metadata (who's signalling whom, timing, volume) and, for
  Nostr/BitTorrent DHT, that metadata is often visible to *any* participant in the
  swarm/relay set, not just the operator — DHT and tracker announces are
  observable by anyone running a crawler. Free public STUN servers additionally
  expose the peers' real public IP/NAT mapping to whoever runs the STUN server
  (Google's, or any gist-listed public STUN host); using STUN without TURN "leaves
  users at risk of ... location compromises."
- Reusing free/public STUN lists compounds this: they are widely advised against
  for anything beyond hobby use precisely because reliability and privacy are both
  uncontrolled.

**Verdict: conditional / "no relay we run," not "no relay."** Low user friction
(fully automatic, same UX as this repo's Gun-inbox tier already provides) but real
operational fragility and metadata-privacy cost, and it re-introduces exactly the
"someone's infrastructure in the path" dependency the ticket is trying to get below.
Needs: a signed, replay-guarded envelope format (already present in
`SignalingService`) so a hostile third-party relay can delay/observe metadata but
not forge signals — the same invariant the codebase already documents for its own
relay/Gun tiers.
Sources: [Trystero](https://trystero.dev/), [Trystero GitHub](https://github.com/dmotz/trystero),
[Stefan Hajnoczi — nostr for P2P apps](http://blog.vmsplice.net/2023/09/how-nostr-could-enable-peer-to-peer-apps.html),
[nostr-protocol NIPs issue #771](https://github.com/nostr-protocol/nips/issues/771),
[GenosRTC](https://genosdb.com/genosrtc-intelligent-relay-management),
[GenosDB P2P Protocol](https://genosdb.com/genosdb-p2p-protocol-architecture),
[STUN server privacy](https://bloggeek.me/webrtcglossary/stun/),
[free STUN/TURN risk](https://www.videosdk.live/developer-hub/stun-turn-server/stun-server-free),
[libp2p WebRTC bootstrap/relay](https://libp2p.io/docs/webrtc-browser-connectivity/).

---

## 6. WebRTC without STUN at all (host-candidate-only on a LAN)

Host-candidate-only connections succeed whenever both peers are on the same
broadcast/mDNS domain and no NAT sits between them — the classic same-LAN case.
Since ~Chrome M73 (and matched by Firefox/Safari/Edge since), browsers replace the
real local IP in host candidates with a randomly generated `.local` mDNS hostname
(mDNS obfuscation) for privacy; **this does not break same-LAN connectivity** because
peers resolve each other's mDNS hostname via multicast DNS rather than needing the
raw IP, and "mDNS allows STUN transactions to succeed on host candidates without any
host candidates being trickled" — i.e. the resolution effectively substitutes for
what STUN would have told you, for a device you're already directly reachable from.

The real failure modes for host-only connections are:
- **Different mDNS/broadcast domains** — two obfuscated peers on different VLANs,
  subnets, or beyond a router's multicast boundary (a very common case: guest vs.
  main Wi-Fi SSIDs on consumer mesh routers, corporate VLAN segmentation) cannot
  resolve each other's `.local` hostname and the connection fails even though both
  are "on the LAN" in a loose sense.
  [w3c/webrtc-nv-use-cases#59](https://github.com/w3c/webrtc-nv-use-cases/issues/59)
  notes the 1-hop mDNS limit causes real breakage in corporate networks, to the
  point Chrome Enterprise disables mDNS obfuscation and reverts to exposing the raw
  local IP for managed devices.
- **Client isolation** — many consumer/public/guest Wi-Fi APs block client-to-client
  traffic entirely regardless of mDNS, which defeats host candidates outright (this
  applies equally to §3's LAN rendezvous).
- **Cross-network peers** (the common case for "no relay reachable") never succeed
  on host candidates alone — by definition they need a NAT-traversing srflx/relay
  candidate, which requires STUN/TURN.

Given ticket 01's finding that mDNS obfuscates host candidates, the practical
takeaway for this ticket is: **host-only ICE is a real, zero-external-dependency
path, but strictly a same-broadcast-domain optimization**, not a general "no relay
needed" answer — it degrades to failure the moment either peer is behind a NAT
boundary the other doesn't share, which is most of the interesting zero-relay
scenarios (different Wi-Fi networks, cellular data, VPNs).

**Verdict: conditional.** Zero user friction when it works (fully automatic, no
signalling-payload difference from the STUN case — ICE just doesn't produce
server-reflexive candidates). Truly serverless (no STUN/TURN infrastructure
touched at all). Needs: both peers physically on the same broadcast/mDNS domain
with no client isolation — a condition the app can't verify in advance and should
not assume.
Sources: [mDNS: Multicast DNS and local IP privacy in WebRTC](https://bloggeek.me/webrtcglossary/mdns/),
[Local IP obfuscation w3c issue](https://github.com/w3c/webrtc-nv-use-cases/issues/59),
[PSA: WebRTC host candidate obfuscation M73](https://groups.google.com/g/discuss-webrtc/c/4Yggl6ZzqZk),
[WebRTC Metadata and IP Leakage cross-platform study (arXiv 2510.16168)](https://arxiv.org/pdf/2510.16168).

---

## Summary table

| Option | Verdict | User friction | Truly serverless? | Needs from rest of system |
|---|---|---|---|---|
| Manual copy/paste (SDP bundle) | works | high (manual exchange) | yes | out-of-band channel user controls; TTL/staleness UX is missing |
| Manual QR | conditional | high, but faster than paste | yes | payload must shrink (QWBP-style) to fit reliably; current raw JSON+base64 bundle risks overflow |
| Peer-assisted mesh introduction | works (bootstrap-dependent) | none (automatic) | yes, once ≥1 connection exists | an existing datachannel, signed envelope + hop/TTL limit (already present) |
| LAN rendezvous (this repo's browserRelayService LAN fallback) | conditional | moderate (share IP:port) | yes, LAN-only branch | same broadcast domain, no client isolation, address exchanged out-of-band |
| LAN rendezvous via tunnel bridge | works, but not serverless | low | no — third-party tunnel in the path | a reachable bridge service |
| BroadcastChannel / localStorage | dead end (for cross-device) | n/a | n/a | same-origin, same-browser only; wrong problem |
| Web Bluetooth | conditional | high (pairing dialog, proximity) | yes | Chromium-only (~76% global), custom GATT signalling protocol |
| Web NFC | dead end as SDP carrier | high (physical tap) | yes | Chromium-Android only (~6% global), payload too small for SDP |
| Web Serial | dead end | n/a | n/a | needs a physical cable; wrong use case |
| Third-party public infra (Nostr/Gun/BitTorrent DHT/libp2p bootstrap) | conditional / "no relay we run" | low (automatic) | no | signed+replay-guarded envelope (present); accept operator-visible metadata & availability risk |
| Public STUN/TURN lists | conditional | none | no | accept real-IP exposure to the STUN operator; prefer self-hosted TURN when privacy matters |
| Host-candidate-only (no STUN) | conditional | none | yes | same broadcast/mDNS domain, no client isolation, no NAT between peers |

## Bottom line for the tier ordering / invite-link envelope

Only two options are unconditionally relay-free in the strict sense: **manual
signalling** (§1) and **host-candidate-only same-LAN connections** (§6) — and the
latter only fires when both devices already share a broadcast domain, which the app
cannot guarantee or even detect reliably in advance. Everything else that is
low-friction and "automatic" (mesh relay, Gun inbox, Nostr, BitTorrent DHT, tunnel
bridges, public STUN) either requires a connection to already exist or quietly
reintroduces a third party — just one InterPoll doesn't operate. "Zero-relay
capable" should therefore be documented as **"manual paste/QR, plus same-LAN
auto-connect, plus best-effort peer-introduction once you already have one
connection"** — not as a guarantee that two isolated strangers with no shared LAN
and no existing mesh peer can always connect with zero external dependency. The
invite-link envelope should carry enough (compact bundle, ideally QWBP-scale) to make
the QR path reliable, since that's the only fully-serverless bootstrap for two
devices that share no LAN and have no prior mesh peer.
