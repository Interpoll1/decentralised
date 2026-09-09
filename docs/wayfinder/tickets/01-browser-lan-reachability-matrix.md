---
id: 01
title: Browser LAN reachability matrix
map: ../MAP-p2p-recomposition.md
labels: [wayfinder:research]
status: closed
assignee: unassigned
blocked-by: []
---

## Question

What can an InterPoll page actually reach on the local network, per browser and per page
origin? The four LAN-search tiers are only as real as this answer.

Establish, with citations to current specs/browser docs (2026):

- **Mixed content**: an `https://` page reaching `http://192.168.x.x` and `http://*.local` —
  what is blocked, what is upgraded, what exceptions exist (localhost, PNA).
- **Private Network Access / Local Network Access**: current state of the spec and shipping
  behaviour in Chrome, Firefox, Safari — preflight requirements, permission prompts,
  whether a user-granted permission exists yet.
- **CORS and WebSocket**: what a LAN peer serving `ws://` or `http://` must send for a
  page on another origin to talk to it; whether `ws://` from an `https://` page is possible.
- **WebRTC host candidates and mDNS obfuscation**: local IPs are replaced with
  `*.local` mDNS candidates by default — under what conditions are real host candidates
  exposed, and can two peers on the same LAN connect directly without any STUN server?
- **Subnet sweep feasibility**: timing/error-channel probing of a /24 from a page — what
  actually works today, what it costs, and what breaks it.
- **The `http://` deployment case**: does serving InterPoll over plain HTTP on the LAN
  (or from a peer's own `browserRelayService`) unlock tiers that `https://` cannot have,
  and what is lost (secure context APIs: crypto.subtle, service workers, etc.).

Output: a matrix of `mechanism × browser × page-origin → works / blocked / conditional`,
with the condition spelled out. Write it to `docs/wayfinder/research/01-lan-reachability.md`.

## Resolution

Full findings and citations: [`docs/wayfinder/research/01-lan-reachability.md`](../research/01-lan-reachability.md).

**LAN reach from an `https://` page is a permission-gated, Chromium-only capability today.**

- Mixed content blocks `https://` → `http://192.168.x.x` and `ws://` by default. Loopback
  (`127.0.0.1`, `localhost`) is exempt as potentially-trustworthy; other private IPs are not.
- Chrome's old PNA server-preflight model was shelved in 2024–25 (router/IoT firmware could
  never implement it). Its replacement, **Local Network Access (LNA)**, is a user-permission
  prompt — GA around Chrome 141–142 for fetch/subresources, extended to `ws://`/`wss://`
  around Chrome 147 (April 2026).
- **LNA is secure-context-only.** An `http://`-served page loses the exemption entirely after
  the 141–146 reverse origin trial; its requests are silently rejected, not prompted.
- **Firefox** has no stable documented equivalent (Bugzilla #2059274 shows regressing
  behaviour as of March 2026). **Safari/WebKit** has no web-facing equivalent at all —
  `NSLocalNetworkUsageDescription` is native-app-only. Weakest-evidence area; flagged as such.
- **WebRTC host candidates are mDNS-obfuscated** in all major engines since ~2019. Real LAN
  IPs reach a page only under a Chrome enterprise policy for allowlisted origins.
- **Same-LAN WebRTC without STUN/TURN works in principle** (host candidates are gathered
  regardless), but Firefox has open bugs (#1698141, #1659672) breaking mDNS resolution in
  exactly this case.
- **Subnet sweeping still works** via timing side-channels; LNA's own preflight TCP handshake
  leaks an even cleaner open/closed signal *before* the user answers the prompt.
- **Serving InterPoll over plain `http://` on the LAN** removes mixed-content/LNA blocking for
  same-scheme requests, but forfeits `crypto.subtle` and Service Workers — which the signing
  and chain architecture depend on. Not a free escape hatch.

**Consequence for the map**: LAN tiers are Chromium-first with a permission prompt in the
path, and are effectively absent on Firefox and Safari. Any tier ordering must survive
"the LAN tier does not exist for this user".

## Why it matters

Blocks the tier ordering and the invite-link bootstrap hints: a hint pointing at a tier the
browser refuses to use is dead weight in every link ever issued.
