# Map: P2P Network Recomposition

<!-- labels: wayfinder:map -->
<!-- tracker: local-markdown. Tickets are files in ./tickets/. A ticket is OPEN unless its
     frontmatter says `status: closed`. CLAIMED when `assignee:` is non-empty.
     BLOCKED while any id in `blocked-by:` is still open.
     FRONTIER = open + unblocked + unclaimed. -->

## Destination

A locked set of architecture decisions (no spec document, no implementation) covering how an
InterPoll peer set **recomposes itself into a working network** from invite links and
same-network discovery — the transport tiers, their ordering and fallback, the invite-link
envelope, and the single seam the six existing discovery/transport services collapse onto.
The map is done when someone could sit down and write the implementation plan without
another architectural question left open.

## Notes

- **Domain**: browser-first P2P (Vue 3 + Pinia + GunDB + WebRTC), existing services
  `discoveryService`, `webrtcService`, `signalingService`, `meshService`, `browserRelayService`,
  `relayManager`, `inviteLinkService`, `resilienceService`, component `P2PManualSignal.vue`.
- **Skills each session should consult**: `grilling`, `superpowers:brainstorming` for
  HITL tickets; `research` behaviour for AFK tickets.
- **Standing preferences** (settled while charting, do not relitigate):
  - Output is **decisions only** — no IPP document, no code, in this map.
  - Relay independence is **tiered**: zero-relay-capable *and* relay-preferred *and*
    graceful-degradation all coexist. The question is ordering, not which one wins.
  - **All four** LAN-search mechanisms (peer-as-LAN-rendezvous, subnet sweep, native LAN
    helper, Gun-replicated LAN doc) ship as a layered stack; the map decides the priority
    order and the shared interface, not a single winner.
  - Invite link is a **signed bundle**, and the **issuer chooses per link** whether it is
    transport-only or also carries a capability/community key.
- This repo is local-only (never pushed). Research output goes in `docs/wayfinder/research/`,
  not a throwaway branch.

## Decisions so far

<!-- one line per closed ticket: gist + link -->

- [Browser LAN reachability matrix](tickets/01-browser-lan-reachability-matrix.md): LAN reach
  from `https://` is a permission-prompted, Chromium-only capability (LNA, ~Chrome 141+, and
  ~147 for WebSockets); Firefox and Safari have no equivalent, WebRTC host candidates stay
  mDNS-obfuscated, and serving over `http://` to escape this forfeits `crypto.subtle`.
  **Every tier ordering must survive "no LAN tier at all" for this user.**
- [Zero-relay signalling survey](tickets/02-zero-relay-signalling-survey.md): only manual
  paste/QR and same-LAN host-only ICE are unconditionally relay-free; peer-assisted
  introduction needs a connection to already exist; everything else reintroduces a third
  party. QR needs a compact bundle (~100 B, not the raw 2–6 KB SDP) to be real.

## Not yet specified

- **Sybil and abuse under relay-less discovery.** The existing Gun rendezvous already notes
  that signed-but-fake announcements are cheap to flood. Once relays stop being the
  chokepoint, the anti-abuse story (IPP-08) has to be re-derived. Can't be phrased sharply
  until the tier ordering exists.
- **NAT traversal without our servers.** STUN/TURN implies infrastructure, and public STUN
  exposes a real IP and NAT mapping. Sharpens once ticket 09 rules on third-party infra.
- **Browser-tier divergence.** Ticket 01 leaves LAN tiers Chromium-only. Whether InterPoll
  ships a materially different network on Firefox/Safari, or holds every browser to the
  lowest common denominator, is a product decision that needs the tier ordering first.
- **Compact signalling-bundle encoding.** Ticket 02 makes a ~100-byte SDP bundle load-bearing
  for QR invites. Whether that is an existing scheme (QWBP), our own, or a reason to drop
  QR-direct-connect entirely, follows the invite-link envelope decision.
- **Persistence and decay of the learned peer set.** How long a peer stays trusted/tried,
  where it is stored, how it survives a cold start.
- **Migration of existing users** on the `v3` Gun namespace into whatever the recomposed
  network looks like.
- **Mobile and background limits** — page in the background, radios asleep, WebRTC dropped.
- **Distribution of the native LAN helper** (packaging, install, trust) if that tier survives.
- **Identity rotation across a recomposition** — what a peer's stable identity is when
  every transport underneath it has changed.

## Out of scope

- Writing the implementation, or the IPP spec document — the destination is decisions.
- Changing vote/chain semantics (IPP-05) or the encrypted-community crypto (IPP-09);
  this map rewires how peers *find* each other, not what they agree on.
