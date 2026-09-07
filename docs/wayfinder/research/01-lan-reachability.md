# Browser LAN Reachability Matrix (research, 2026)

Ticket: `docs/wayfinder/tickets/01-browser-lan-reachability-matrix.md`

This is a facts-only research note. No designs, no recommendations for InterPoll's
architecture — just what current specs and shipping browser behavior actually allow, with
citations. Where sources conflict or are stale, that is flagged inline.

**Caveat on dates**: several sources found are the primary vendor blog/intent-to-ship posts,
which are the best available evidence, but Chromium's own rollout has moved twice in two
years (PNA → on hold → replaced by LNA), and version numbers below come from
blink-dev intent threads and third-party trackers, not independently re-verified against a
running Chrome 147 binary. Firefox and Safari support is thin/contradictory in places — noted
where it happens.

---

## Summary matrix

`mechanism × browser × page origin → works / blocked / conditional`

| Mechanism | Chrome/Chromium (2026) | Firefox (2026) | Safari/WebKit (2026) |
|---|---|---|---|
| `https://` page → `http://192.168.x.x` (mixed content) | **Conditional** — blocked by mixed-content by default; LNA (Ch 141+) opens a permission-gated exemption for private-IP-literal / `.local` targets, or `targetAddressSpace:"local"` fetch option | **Blocked** — no LNA equivalent shipped broadly; mixed-content blocking applies with no private-network exemption | **Blocked** — no public LNA/PNA equivalent for Safari; mixed content blocking applies |
| `https://` page → `http://127.0.0.1` / `localhost` | **Works** — loopback is a "potentially trustworthy origin" per spec, exempt from mixed content regardless of LNA | **Works** — same spec exemption, MDN/spec-documented | **Works** — same spec exemption (spec-level, not browser-specific) |
| `http://` page (served on LAN) → `http://192.168.x.x` | **Conditional** — same-scheme (no mixed-content issue), but Chrome 142+ LNA blocks *insecure-context* callers outright ("requests from insecure contexts will be silently rejected") pending a time-limited reverse origin trial | **Works today** (no LNA equivalent enforced), but is unhardened and could change | **Works today** in the absence of a WebKit LNA/PNA; unhardened |
| PNA/LNA preflight or permission prompt | **Shipping** — LNA permission prompt, Chrome 142 (fetch/XHR/subframe), extended to WebSockets in Chrome 147 | **Not shipped** broadly; Bugzilla issue 2059274 shows inconsistent/regressed local-device permission prompting for some sites as of March 2026 — unclear/unstable state | **Not implemented** — no public Local Network Access equivalent found in WebKit docs |
| `ws://` from `https://` page, cross-origin LAN host | **Blocked** — same mixed-content rule as HTTP subresources (long-standing, WebKit bug 89068 codified this cross-browser); as of Chrome 147, additionally gated by LNA permission if it were otherwise allowed | **Blocked** — mixed content rule blocks `ws://` under `https://` | **Blocked** — mixed content rule blocks `ws://` under `https://` |
| `ws://` from `http://` page (LAN-served), cross-origin | **Conditional** — no mixed-content issue, but Chrome 147+ LNA now gates WebSocket connections into the local network behind the same permission prompt as fetch | **Works** (no equivalent restriction shipped) | **Works** (no equivalent restriction) |
| CORS to a LAN HTTP server from a different origin | **Conditional** — ordinary CORS headers (`Access-Control-Allow-Origin`) required as always; additionally, if this is a public→local request, an LNA permission prompt now gates it regardless of CORS headers being correct | Standard CORS only, no additional gate | Standard CORS only, no additional gate |
| WebRTC host candidates exposing real LAN IP | **Obfuscated by default** — mDNS `.local` random hostname replaces literal IP in ICE candidates (shipped since ~Chrome 74/M73, 2019) | **Obfuscated by default** — Firefox also emits mDNS candidates, but uses different (reportedly less fingerprint-stable) generation than Chrome | **Obfuscated by default** per general WebRTC-NV local-IP-obfuscation adoption across engines |
| WebRTC direct peer connect on same LAN, no STUN/TURN | **Works** — host candidates are gathered and checked without any ICE server; two peers on the same subnet can connect via host↔host or via resolved mDNS candidates | **Works** in principle, but Firefox Bugzilla #1698141 and #1659672 document real breakage: mDNS ICE candidates can break P2P connections between two machines on the same LAN, and pure-LAN ICE gathering has had failures | **Works** in principle (same ICE mechanics), no browser-specific breakage found in this research pass |
| Subnet `/24` sweep via timing/error channel | **Conditional, still effective** — `fetch()`/`img` timing against closed vs. open TCP ports remains a reliable binary signal; LNA's own preflight-before-prompt behavior (successful TCP handshake → prompt shown/pending; RST → instant reject) is *itself* now a clean side channel usable to fingerprint open ports "regardless of whether the user Allows or Blocks" | Same generic timing-based scan techniques apply (no LNA-specific signal since LNA isn't shipped) | Same generic timing-based scan techniques apply |

Legend: "Conditional" always has the specific condition named in the row.

---

## 1. Mixed content: `https://` page reaching `http://` LAN targets

- Spec baseline (W3C Mixed Content, and its living successor via WHATWG/Fetch "potentially
  trustworthy origin" concept): loopback addresses (`127.0.0.0/8`, `::1`) and `localhost` are
  treated as "potentially trustworthy" and are **exempt** from mixed-content blocking — an
  `https://` page can load `http://127.0.0.1` resources without a mixed-content error. This is
  documented on MDN and traces to the mixed-content spec's "does settings prohibit mixed
  security contexts" algorithm, which keys off origin trustworthiness, not scheme literally.
  Historically browsers were inconsistent about whitelisting `127.0.0.1` vs. the string
  `localhost` (Mozilla Bugzilla #903966 tracked this for Firefox); by 2026 mainstream engines
  treat both as trustworthy, but there is a documented history of divergence, so an
  implementation should not assume the *hostname* `localhost` was always exempted with the
  same reliability as the IP literal.
  Sources: https://developer.mozilla.org/en-US/docs/Web/Security/Mixed_content ,
  https://bugzilla.mozilla.org/show_bug.cgi?id=903966 ,
  https://www.w3.org/TR/2015/CR-mixed-content-20151008
- For non-loopback private IPs (`192.168.x.x`, `10.x.x.x`, `.local` mDNS names), the
  loopback exemption does **not** apply. An `https://` page hitting `http://192.168.x.x`
  is ordinary mixed content and is blocked by default in all three engines.
- Chrome's Local Network Access (LNA) feature (see §2) adds a **new, narrow exemption**:
  when the browser can identify a target as local *before* making the request (a private-IP
  literal, a `.local` name, or the request explicitly declares
  `fetch(url, {targetAddressSpace: "local"})`), and the user grants the LNA permission
  prompt, Chrome relaxes mixed-content blocking for that specific request. This is
  Chrome-only as of this research; no equivalent found for Firefox or Safari.
  Source: https://groups.google.com/a/chromium.org/g/blink-dev/c/cwu_RUmBpzY (Intent to
  Ship: Local network access restrictions — "relaxes mixed content blocking for local
  network requests" once permission is granted).

## 2. Private Network Access / Local Network Access — current spec and shipping state

- **History**: the original WICG Private Network Access (PNA) proposal wanted local network
  *servers* to opt in via a CORS preflight (`Access-Control-Request-Private-Network: true` /
  `Access-Control-Allow-Private-Network: true`), with private-network requests restricted to
  secure contexts and a deprecation trial for non-secure-context exceptions. This is
  documented across several Chrome for Developers posts and the WICG HOWTO.
  Sources: https://developer.chrome.com/blog/private-network-access-preflight ,
  https://github.com/WICG/private-network-access/blob/main/HOWTO.md ,
  https://developer.chrome.com/blog/private-network-access-update-2024-03
- **PNA was put on hold**: Chrome's own blog states the PNA preflight rollout was paused due
  to compatibility problems — updating firmware on the huge installed base of routers/IoT
  devices to answer the preflight correctly proved impractical.
  Source: https://developer.chrome.com/blog/pna-on-hold
- **Replaced by Local Network Access (LNA)**: rather than requiring the *target* device to
  opt in via preflight, LNA instead gates the request behind a **user permission prompt** on
  the browser side — closer to the iOS `NSLocalNetworkUsageDescription` model than to CORS.
  This was announced as an Intent to Ship for Chromium.
  Sources: https://developer.chrome.com/blog/local-network-access ,
  https://groups.google.com/a/chromium.org/g/blink-dev/c/cwu_RUmBpzY
- **Scope and rollout, per the Intent to Ship thread**:
  - Initial ship (Chrome 141, enabled for all desktop + Android users; origin trial window
    141–146) covers subresource requests, `fetch()`, and subframe navigation.
  - WebSocket, WebTransport, and WebRTC were explicitly deferred to separate intents at
    first.
  - LNA is **restricted to secure contexts**; there is a time-limited reverse origin trial
    ("Local Network Access from Non-Secure Contexts") letting sites keep working from
    `http://` origins during migration, but the stated end-state is that **requests from
    insecure contexts are silently rejected**.
  - Per-developer blog (developer.chrome.com/blog/local-network-access): the initial rollout
    (Chrome 138 flag → Chrome 142 general launch per that page) also states WebSockets are
    "not yet covered," listed as a known gap.
  - **WebSocket coverage was added afterward**: a later Intent to Ship /
    Ready-for-Developer-Testing pair ("Local network access restrictions for WebSockets") and
    a third-party support article (Visualware) both describe LNA extending to WebSocket
    connections starting **Chrome 147** (cited as current stable, April 2026) — i.e. opening
    a `ws://` (or even `wss://`) connection from a public origin to a loopback or private-IP
    destination now also triggers the LNA permission prompt.
    Sources: https://groups.google.com/a/chromium.org/g/blink-dev/c/O6GMKt44Ups ,
    https://groups.google.com/a/chromium.org/g/blink-dev/c/4gx2y5jPGbU ,
    https://myconnectionserver.visualware.com/support/v11/userguide/chrome-lna-websocket
  - Note the version discrepancy across Chrome-owned sources: the developer.chrome.com blog
    post text (as fetched) says "ships enabled for all users in Chrome 141," a different
    developer.chrome.com blog post title says the prompt is "launching in Chrome 142," and
    third-party trackers describe a `chrome://flags` opt-in at Chrome 138. These are not
    contradictory in substance (flag → origin trial → general availability is a normal
    rollout shape) but the exact version boundary is fuzzy across sources; treat "Chrome
    ~141–142" as the GA point for fetch/subresource LNA and "Chrome 147" as the GA point for
    WebSocket LNA, both per Google's own announcements, not independently reverified here.
  - "Local network" address ranges covered, per the developer.chrome.com blog: private IPv4
    (RFC1918), IPv4 link-local (169.254.0.0/16), IPv6 ULA (fc00::/7), IPv6 link-local
    (fe80::/10), and loopback (127.0.0.0/8, ::1/128).
  - Service Workers / Shared Workers need a permission grant on their own origin before they
    can reach the local network — an extra layer beyond a plain page.
- **Firefox**: no broad Private Network Access / Local Network Access implementation found.
  A Mozilla Bugzilla report (#2059274, filed around the same period) describes Firefox
  *stopping* prompting for a "Local Network Devices" permission for some sites as of March
  2026, while Chrome continues to prompt — implying Firefox has *some* local-network
  permission concept but its behavior is inconsistent/regressing, not a stable, documented
  spec-level feature. Treat Firefox's LNA/PNA posture as **unclear and unstable** based on
  available evidence, not "not implemented" outright.
  Source: https://bugzilla.mozilla.org/show_bug.cgi?id=2059274
- **Safari/WebKit**: no public LNA or PNA equivalent found in this research pass. Apple's own
  local-network gating (`NSLocalNetworkUsageDescription`) is a **native iOS/macOS app**
  Info.plist mechanism (Bonjour/mDNS discovery, network scanning by native apps), not a Web
  Platform / WebKit browser feature. No WebKit status/standards-position entry for
  PNA-equivalent behavior was found; treat Safari as having **no web-exposed LNA/PNA gate**
  as of this research.
  Sources: https://developer.apple.com/documentation/bundleresources/information-property-list/nslocalnetworkusagedescription ,
  https://www.itechguides.com/local-network-access-on-iphone-what-it-is-and-how-to-enable-it/

## 3. CORS and WebSocket to a LAN peer

- For a page on origin A to `fetch()` a resource on LAN origin B (different scheme/host/port),
  ordinary CORS rules apply regardless of LAN-ness: B's response needs
  `Access-Control-Allow-Origin` (and any other required CORS headers) for A's JS to read the
  response. This is unrelated to, and layered underneath, LNA — LNA's permission prompt gates
  whether the *request* is allowed to be sent/read at all when it crosses a public→local
  boundary; CORS then still governs whether the response is exposed to script once the
  connection is permitted.
- `ws://` (unencrypted WebSocket) from an `https://` page to any origin is blocked as mixed
  content, by long-standing cross-browser convention traceable to a WebKit bug from 2012
  (#89068, "Do not allow mixed-content WebSockets") that all major engines eventually adopted.
  Source: https://bugs.webkit.org/show_bug.cgi?id=89068
  As of 2026, current developer guidance/analysis (websocket.org) reaffirms: "browsers refuse
  to open `ws://` connections" from an `https://` page, and states this is essentially
  universal by 2026 — "there is no legitimate reason to skip encryption in 2026" reflects the
  hardened default, not a spec carve-out.
  Source: https://websocket.org/reference/wss-vs-ws/
- The **only** environment where `ws://` reliably works, per that same source, is from a page
  itself served over `http://` (no mixed-content issue) or from `localhost`/loopback (treated
  as a trustworthy origin, same exemption as §1).
- On Chrome specifically, once LNA extended to WebSockets (Chrome 147, see §2), even a
  same-scheme (`http://` page → `ws://` LAN target, or theoretically `https://`→`wss://` to a
  private IP) WebSocket connection into RFC1918/loopback/link-local space triggers the LNA
  permission prompt, on top of whatever mixed-content rule would otherwise apply.

## 4. WebRTC host candidates and mDNS obfuscation

- Since roughly Chrome 74/M73 (2019), Chrome (and subsequently other Chromium browsers,
  Firefox, and per general engine-adoption trackers, Safari) replace the literal local IP
  address in ICE host candidates with a randomly generated mDNS hostname of the form
  `<uuid>.local`, rather than exposing e.g. `192.168.1.42` directly to the remote peer or to
  JS inspecting `RTCPeerConnection` candidates.
  Sources: https://github.com/w3c/webrtc-nv-use-cases/issues/59 ,
  https://groups.google.com/g/discuss-webrtc/c/4Yggl6ZzqZk ,
  https://groups.google.com/g/discuss-webrtc/c/6stQXi72BEU
- The generated `.local` mDNS name is **session-stable** (same value reused across
  connections within a browsing session), which a 2026 measurement paper (arXiv 2510.16168)
  flags as still enabling short-term device fingerprinting/correlation even though the literal
  IP is hidden.
  Source: https://arxiv.org/pdf/2510.16168
- Firefox is reported (same source discussion) to use differently-generated pseudo-values than
  Chrome, described as a "stronger design choice," but no further verification of Firefox's
  exact scheme was found in this pass — treat as a claim from secondary literature, not a
  Mozilla primary source.
- **Two peers on the same LAN connecting without any STUN/TURN server**: this is possible in
  principle — ICE gathers and checks host candidates even when no `iceServers` are configured,
  and same-subnet host↔host or mDNS-resolved-host connections can succeed with zero external
  infrastructure.
  Source: https://webrtc.ventures/2022/04/ice-in-webrtc/ (general ICE mechanics), corroborated
  by Mozilla Bugzilla threads showing this is the *expected* path.
- However, this is **not fully reliable in practice**: Mozilla Bugzilla #1698141 documents
  mDNS ICE candidates actively breaking a WebRTC P2P connection between two machines on the
  same private LAN (the mDNS resolution step itself fails or races), and #1659672 documents
  ICE gathering failing outright in a "completely pure LAN environment" (no gateway/DHCP
  quirks assumed). Both bugs are Firefox-side; no equivalent Chrome-side failure reports were
  found in this pass, so this class of failure looks more Firefox-specific but is not proven
  to be absent from Chrome.
  Sources: https://bugzilla.mozilla.org/show_bug.cgi?id=1698141 ,
  https://bugzilla.mozilla.org/show_bug.cgi?id=1659672
- Real host candidates (literal IPs, bypassing mDNS obfuscation) are exposed only via
  enterprise policy, not to arbitrary web content: Chrome has (per discuss-webrtc threads) an
  enterprise policy (referenced as tentatively `WebRtcLocalIPsAllowedUrls`) letting IT admins
  allow-list specific origins to see real local IPs on managed devices/networks. This is not
  something a page can request or rely on for a general end user.

## 5. Subnet sweep feasibility

- Classic technique (pre-LNA): time how long `fetch()`/`img.src`/`AbortController`-bounded
  requests take against each candidate host:port. A near-instant `ECONNREFUSED`/RST-driven
  rejection indicates a closed port; a longer hang (until timeout) indicates something is
  listening. Tools like `webscan` (samyk/webscan) implement exactly this, sweeping subnets via
  timing plus abort-controller-based socket cycling to dodge rate limiting.
  Source: https://github.com/samyk/webscan ; background on the general technique also at
  https://portswigger.net/research/exposing-intranets-with-reliable-browser-based-port-scanning
  and https://incolumitas.com/2021/01/10/browser-based-port-scanning/ and
  https://defuse.ca/in-browser-port-scanning.htm
- **LNA changes the signal quality rather than eliminating the technique.** Per the
  wiki.notveg.ninja analysis (2026): LNA's own internal behavior — it performs a TCP
  handshake against the target *before* deciding whether to show the user a permission
  prompt — creates an even cleaner binary timing channel than the old approach: an open port
  completes the handshake and the fetch stays pending (prompt shown or deferred); a closed
  port gets an RST and the fetch rejects within milliseconds. The article states explicitly
  that user choice doesn't matter for the leak: "Allow, Block, or ignore: it doesn't matter.
  By the time the prompt appears, the scan is already done." A full 65535-port sweep against
  one host is described as feasible with batched concurrent fetches and tuned abort timeouts,
  at roughly a ~2-second practical cutoff per port (though the actual differentiating signal
  resolves in milliseconds).
  Source: https://wiki.notveg.ninja/tools/lna-port-scanning/
- This means: on Chrome 141+ (LNA-enabled), a page can still enumerate which ports are open
  across a `/24` purely from timing, without ever needing the user to click Allow, and without
  needing the target to run any particular server. This is a **security regression relative
  to LNA's stated privacy goal** of "reducing the ability of sites to fingerprint the local
  network" (per developer.chrome.com/blog/local-network-access's own framing) — the research
  source treats it as an acknowledged/observed gap, not a fixed one, as of the time of that
  writeup.
- No browser-specific mitigation (rate limiting, jitter, coalesced timing) was found described
  as shipped against this class of side channel in the sources located.
- Firefox/Safari: since neither ships an LNA-equivalent per §2, the *original* (pre-LNA)
  timing-based scanning technique is what applies to them — same fundamental technique, just
  without the extra LNA-preflight signal amplification described above.

## 6. The `http://` deployment case

- Serving InterPoll itself over plain `http://` on the LAN removes the **mixed-content**
  barrier entirely for LAN-to-LAN requests (same-scheme `http://`→`http://`, and `ws://`→
  `ws://`), per §1 and §3.
- It does **not** automatically restore reachability against Chrome's LNA once LNA's
  insecure-context restriction is fully enforced: the Intent-to-Ship thread states the
  end-state is "requests from insecure contexts will be silently rejected," with only a
  time-boxed reverse origin trial (141–146) as a bridge. After that trial window, an
  `http://`-served InterPoll page attempting to reach another LAN device (even via plain
  `http://`) would be **blocked outright by Chrome**, not merely subjected to a permission
  prompt — a strictly worse outcome than the secure-context case (permission-gated) once the
  trial ends, per that source.
  Source: https://groups.google.com/a/chromium.org/g/blink-dev/c/cwu_RUmBpzY
- On Firefox and Safari, since no LNA/PNA gate is confirmed shipping (§2), an `http://`-served
  InterPoll page reaching other `http://` LAN peers (fetch, WebSocket) is currently unblocked
  by anything found in this research — but this is explicitly described by Mozilla's own
  bug tracker (#2059274) as an area of flux, not a stable guarantee.
- Cost of the `http://` deployment path: giving up **secure-context-gated Web Platform APIs**.
  This is well-established browser policy (not separately re-verified via a fresh citation in
  this pass, since it is long-standing, non-controversial platform behavior): `crypto.subtle`
  (Web Crypto), Service Workers, and a number of other powerful APIs require a secure context
  (`https:` or the loopback/`localhost` exemption from §1). An InterPoll instance served over
  plain `http://` on a LAN IP (not loopback) cannot use `crypto.subtle` for its
  device-key signing/verification flows or register a Service Worker, both of which
  CLAUDE.md's architecture description says are core to InterPoll (`cryptoService.ts` uses
  SHA-256 hashing/verification, `ChainService` signs with device keys). This is a structural,
  not incidental, tradeoff of the `http://`-LAN deployment path.

---

## What this rules out

- A hint that points a browser at `ws://` or `http://` on a private IP from an **`https://`**
  InterPoll page is dead on arrival in **every** engine tested for evidence (mixed content
  blocks it outright) unless the browser is Chrome with LNA granted **and** the target is
  identified up front as local (IP literal / `.local` / `targetAddressSpace`) — and even then,
  WebSocket only became eligible as of the Chrome 147 LNA-WebSocket extension, not before.
- Relying on WebRTC to get two peers talking without any signaling/STUN infrastructure on the
  same LAN is possible in principle (host candidates, no ICE server needed) but is **not
  reliable** even same-vendor-to-different-vendor: Firefox has open bugs where mDNS-obfuscated
  host candidates break exactly this same-LAN, no-NAT case.
- Real (non-mDNS-obfuscated) local IPs are not obtainable by ordinary web content in any
  browser tested; only a Chrome enterprise policy exposes them, and only to admin-allow-listed
  origins on managed devices — not usable as a general end-user assumption.
- A `/24` subnet sweep for "what's listening" cannot be assumed blocked by LNA's permission
  prompt — the prompt itself leaks port-open/closed state via timing before the user ever
  responds, on Chrome. This means "requiring a permission prompt" does not equal "requiring
  user consent before information is extracted" for this particular tier.
- Deploying over plain `http://` to dodge mixed-content/LNA restrictions trades away
  `crypto.subtle` and Service Workers (both secure-context-gated), which are load-bearing for
  InterPoll's signing/chain architecture per CLAUDE.md — this is not a free unlock.
- Firefox and Safari's local-network access model is **not settled evidence** as of this
  research pass: Firefox shows a regressing/undocumented local-network permission behavior
  (Bugzilla #2059274) and Safari shows no public web-facing LNA/PNA equivalent at all — so
  any tier-ordering decision resting on "Firefox/Safari behave like Chrome" or "Firefox/Safari
  have no gate at all" should be treated as unverified and checked against real browser builds
  before being relied upon.
