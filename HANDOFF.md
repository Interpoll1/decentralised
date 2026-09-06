# HANDOFF — InterPoll Desktop (Tauri v2 + Rust)

**For the next agent/developer picking this up.** Phase 0 (the shell + the
platform seam) is done and verified. Phases 1–6 build the features that justify
a desktop app existing at all. This document is the implementation guide for
those, plus everything already learned the hard way.

Not committed (gitignored). Full plan of record:
`~/.claude/plans/plan-out-a-desktop-jazzy-bear.md`.

---

## 0. Why this app exists

The browser build is at a structural ceiling on four fronts. Every feature below
targets one of them. If a change does not remove one of these ceilings, it
probably belongs in the web app instead:

| Ceiling | Browser reality | Desktop answer |
|---|---|---|
| **Cannot seed** | Close the tab, your contribution ends. Network leans entirely on `endless.sbs`. | Tray-resident relay hub (Phase 3) |
| **Cannot store** | IndexedDB quota forces `pruneComments`/`pruneChatMessages`. No full history. | SQLite + FTS5, pruning off (Phase 1) |
| **Cannot be anonymous** | See `src/config.ts:50-64` — a web app cannot route its own traffic. "Anonymity Mode" *subtracts* capability: kill STUN, kill WebRTC, lose P2P. | arti client + onion service (Phase 6) |
| **Cannot protect keys** | secp256k1 private key sits in IndexedDB, readable by any script in the origin. | OS keychain + signing in Rust (Phase 4) |

---

## 1. Current state (verified, do not re-derive)

### What exists

```
src/platform/                 the seam — types.ts + web/ + tauri/
src-tauri/
  Cargo.toml                  app package AND workspace root (see gotcha #1)
  tauri.conf.json
  src/{main,lib,tray,settings}.rs
  crates/ip-crypto/           canonical JSON, verified byte-exact vs JS
```

### Verified working

- `npm test` → **500 passed, 1 skipped**. Includes 2 new guard suites.
- `cargo test --manifest-path src-tauri/crates/ip-crypto/Cargo.toml` → 8 passed.
- Canonical JSON: 20k seeded cases + **200k random raw f64 bit patterns**, exact
  byte match against `shared-validation/canonical.js`.
- `vue-tsc`: 157 errors before Phase 0, 157 after — **zero new**. (The 157 are
  pre-existing: `NetworkSettingsPanel.vue` imports several things that do not
  exist, `storageService.ts` has bare `Promise` return types, `ImportMeta.env`
  lacks `vite/client` types. Not yours; do not "fix" them mid-feature.)
- Web build, desktop build, release binary (6.7 MB) all clean.

### The seam — read before touching anything

`vite.config.ts` maps `@platform` → `src/platform/{web,tauri}` **at build time**.
Rules enforced by `unit_tests/platformSeam.test.ts`:

1. `@tauri-apps/*` may only be imported inside `src/platform/tauri/`.
2. Nothing outside `src/platform/` may import `platform/web/...` or
   `platform/tauri/...` directly — always `@platform/x`.
3. Both platform dirs must expose the same module names.

**The pattern for every phase below is identical:** implement the Rust side,
swap only `src/platform/tauri/<module>.ts` to call it, leave the ~50k LOC of Vue
untouched. If a phase makes you edit components, you are doing it wrong.

### Two things that must not be "simplified"

- **`src/main.ts` uses a dynamic `import('./bootstrap')` on purpose.** A static
  import gets hoisted above the `await platformConfig.hydrate()` and the whole
  synchronous-config design collapses. `src/config.ts` reads localStorage at
  module top level and ~29 files import it.
- **`src-tauri/crates/ip-crypto/src/canonical.rs` is a deliberate duplicate** of
  `shared-validation/canonical.js`. Never replace with `serde_json::to_string`
  (emits `1.0` for `1`) or an RFC 8785 crate (different number formatting).
  See gotcha #2.

---

## 2. Hard-won gotchas

**#1 — Tauri CLI requires `src-tauri/Cargo.toml` to be the app package.**
It was originally `src-tauri/app/Cargo.toml` with a pure `[workspace]` root, and
the CLI failed with the unhelpful `No package info in the config file`. The file
is now both `[package]` and `[workspace]` (`members = ["crates/ip-crypto"]`).
Add new crates under `crates/` and to that members list.

**#2 — Rust and V8 disagree about shortest-float formatting.**
Caught by the differential test on its first run:
`1738474848680198.2` → Rust `{:e}` gives `…198.3`, JS gives `…198.2`. Both are
17 digits, both round-trip. Rust's default float formatting yields *a* shortest
representation, not necessarily V8's. Fix in `shortest_round_trip()`: walk
precisions `0..=16`, take the first that round-trips — ECMA-262's "fewest digits,
then closest" stated directly. **Any future Rust↔JS numeric interop must reuse
this function, not `format!`.** Had this shipped, signatures would verify locally
and be rejected by the network, intermittently, only for content containing such
a value — it would have looked like flaky sync, not a crypto bug.

**#3 — NVIDIA + Wayland + WebKitGTK is pathologically slow.**
WebKitGTK 2.42+ uses a DMABUF renderer the NVIDIA proprietary driver mishandles;
it silently falls back to a software copy of every frame. `apply_webkit_workarounds()`
in `src-tauri/src/lib.rs` sets `WEBKIT_DISABLE_DMABUF_RENDERER=1` when NVIDIA is
detected, before GTK init. **This is still unconfirmed as a full fix** — see §9.

**#4 — Do not run `cargo build --release` to test the app.** It keeps the dev URL
and you get `Could not connect to localhost`. Use
`TAURI_BUILD=1 npx tauri build --no-bundle`, then run
`src-tauri/target/release/interpoll-desktop`.

**#5 — `pkill -f interpoll-desktop` matches its own command line** and kills the
shell running it (exit 144). Use `pkill -f "target/release/interpoll-desk"` or
`pgrep` + explicit PID.

**#6 — `tauri dev` is not representative.** Unoptimized Rust + Vite dev server +
HMR. Always judge performance from a release build.

---

## 3. Phase 1 — SQLite + FTS5 (unlimited storage, full history, offline search)

**Ships:** the storage ceiling is gone. Full archive, instant local search, works
fully offline.

### Rust: `crates/ip-store`

`rusqlite` with features `["bundled", "backup", "serde_json"]`. **Not redb** — we
need `MATCH`, joins across blocks/votes/polls, and a file users can inspect.
`bundled` avoids system-sqlite version skew.

```sql
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;

-- Mirrors the 8 IndexedDB object stores. Generic kv keeps the idb shape cheap
-- to emulate; typed columns only where we actually query on them.
CREATE TABLE kv (
  store TEXT NOT NULL,
  key   TEXT NOT NULL,
  value TEXT NOT NULL,          -- JSON
  PRIMARY KEY (store, key)
) WITHOUT ROWID;

-- Index columns the JS calls getAllFromIndex() on:
--   blocks.by-hash(currentHash), votes.by-poll(pollId),
--   receipts.by-block(blockIndex), comments.by-post(postId),
--   chat-messages.by-room(roomId)
CREATE TABLE kv_index (store TEXT, idx TEXT, value TEXT, key TEXT);
CREATE INDEX kv_index_lookup ON kv_index(store, idx, value);

CREATE VIRTUAL TABLE search USING fts5(
  id UNINDEXED, type UNINDEXED, title, body,
  tokenize = "unicode61 remove_diacritics 2"
);
```

Store names: `blocks`, `votes`, `receipts`, `polls`, `metadata`,
`encryption-keys`, `comments`, `chat-messages`. Key paths (inline vs explicit)
are listed in `src/platform/web/db.ts` — `metadata` alone uses out-of-line keys.

### Frontend

Replace `src/platform/tauri/db.ts` (currently re-exports the web impl) with an
`idb`-shaped facade over `invoke('kv_*')`. It must support exactly what
`StorageService` calls: `get`, `put`, `delete`, `getAll`, `getAllFromIndex`, and
`transaction(name).objectStore(name)` with `openCursor(null,'prev')` +
`getAllKeys` + `clear`. Read `src/platform/web/db.ts`'s `createInMemoryDB()` —
it is already a minimal implementation of that exact surface and is the best
spec for what to build.

`StorageService` and its **25 importers do not change.**

Then `src/platform/tauri/search.ts` → `searchLocal` hits FTS5. In
`searchService.ts`, merge local + remote hits de-duplicated by id (local wins).

Disable pruning on desktop via `capabilities.unlimitedStorage` — grep
`pruneComments` / `pruneChatMessages`.

### Migration (get this right or users lose data)

One-way IndexedDB → SQLite on first desktop run:
1. Read every store from IndexedDB (the webview still has it).
2. Write into SQLite in one transaction.
3. **Verify:** row counts per store match, plus a hash over sorted keys.
4. Only then set a `migration_complete` flag.
5. **Do not delete the IndexedDB copy for 30 days.**

`receipts` (keyPath `mnemonic`) and `encryption-keys` are **not recoverable from
the network**. Everything else can be re-synced. Say so in any UI you build.

### Acceptance
1M rows, search <50 ms, IndexedDB emptied only after verification passes.

---

## 4. Phase 2 — Gun wire protocol in Rust (leaf mode)

**Ships:** no visible change. That is the point — it proves HAM correctness
before anything depends on it.

### The shortcut nobody should miss

`gunService.ts` already has `attachWireBridge()`, which taps `root.on('out')` and
re-injects inbound messages. **That is already the pluggable-transport hook.**
Do not build a new one. Gun-JS stays in the webview as the API/Proxy layer with
`peers: []`; all wire traffic routes through that bridge into Rust.

### Envelope

Frames are JSON text, either a single object **or an array** (Gun's DAM
batching — parse both, emit single objects).

```jsonc
{ "#":"<msgId>", "put": { "<soul>": { "_": {"#":"<soul>", ">":{"<field>": <state_ms_f64>}}, "<field>": <value> } } }
{ "#":"<msgId>", "get": { "#":"<soul>", ".":"<field>" } }
{ "#":"<msgId>", "@":"<reqId>", "ok":1 }
{ "#":"<id>", "dam":"hi", "pid":"<peerId>" }
```

Values: JSON primitive, `null` (tombstone), or a relation `{"#": soul}`.
Anything else → reject the node.

### HAM — the actual algorithm

Per `(soul, field)` hold `(value, state)`. Against local `(cur, curState)` and
`machineState = now()`:

```
incomingState > machineState  → DEFER      (queue for the delta, then re-run)
incomingState < curState      → HISTORICAL (discard, do NOT relay)
incomingState > curState      → CONVERGE   (write, relay onward)
incomingState == curState:
    values equal   → STATE (no-op, do NOT relay)
    values differ  → lexical tiebreak on JSON.stringify() of each; GREATER wins
```

Three things everyone gets wrong — put each in a test:
1. **DEFER must be implemented, not dropped.** Peers with slightly-fast clocks
   are common; dropping their writes makes the app look lossy. Bound it: reject
   >5 min future outright, cap the queue.
2. The tiebreak compares **serialized JS forms** — `2` vs `"2"` is `"2"` vs
   `"\"2\""`. Use `ip_crypto::stable_stringify`.
3. Merge is **per field, never per node.** One node update can yield three
   different outcomes.

### Dedup & relay

- LRU of seen `#` ids (10k, ~5 min TTL).
- Never echo to the peer it arrived from.
- After CONVERGE emit **only the merged diff**, not the whole node. Relaying
  unchanged fields is the classic Gun traffic-amplification bug.
- Per-peer subscription table from `get` messages (`soul` → peer ids) so puts
  push only to interested peers. Without this the hub broadcasts everything and
  LAN traffic explodes.
- Port the `attachWireBridge` limits: 256 KB max frame, 60 writes/soul/10 s, and
  the `wireFilterMode` `off|log|enforce` namespace check (`v3/` prefix).

### Interop with the live network

`ip-gun-peer` connects as an ordinary peer to `wss://interpoll.endless.sbs` and
`https://interpoll2.endless.sbs/gun`:
- Send `{"#":id,"dam":"hi","pid":<uuid>}` on open.
- Ignore unrecognised frames rather than disconnecting.
- **Honour `@` acks** — JS `once()` never resolves without one.
- Never `put` outside `v3/`.
- Message ids shaped like `Gun.text.random(9)`.

### 🔴 Non-negotiable gate before Phase 3

Build a conformance harness running **real gun-js in Node** (vitest; `ws` is
already a dependency) against the Rust hub over loopback. Assert convergence for:
concurrent same-field writes, out-of-order arrival, tombstones, relations,
deferred/future states, subscription fan-out.

**Where Rust and gun-js disagree, gun-js wins.** Gun's wire has no spec — it is
defined by its source (deployed relay is `0.2020.1241`). Treat gun-js as the
oracle exactly as `canonicalDifferential.test.ts` treats `canonical.js`.

**Fallback if HAM proves unreliable against the live network:** run the hub as a
*transparent relay* — dedup + persist + fan-out, no merge — and let peers merge.
Degraded but functional, and Phase 3 still ships.

---

## 5. Phase 3 — Embedded relay hub (**the headline feature**)

**Ships:** always-on seeding. Your machine becomes infrastructure.

`crates/ip-relay-hub`, `axum` 0.8 with the `ws` feature.

**Cheapest correct approach: keep the HTTP/WS contract, swap the implementation.**
The JS already knows how to talk to a relay; serve that same contract on
`http://127.0.0.1:<port>` and nothing in the frontend needs to learn anything new.

Port from `relay-server/relay-server-enhanced.js` (2521 LOC) — WS types:
`register`, `join-room`, `chat-start`, `chat-message`, `chat-typing`, `chat-read`,
`broadcast`, `direct`, `new-poll`, `new-block`, `request-sync`, `sync-response`,
`new-post`, `chatroom-message`, `peer-addresses`, `server-list`, `ping`,
`request-pow`, `rtc-offer|answer|ice`, `snapshot-*`.

HTTP: `/api/search`, `/api/index`, `/api/posts`, `/api/polls`, `/api/communities`,
`/api/chat/history`, `/health`, and `/db/*` from `gun-relay/gun-relay-enhanced.js`.

**Explicitly OUT of scope: OAuth routes and MySQL.** Those stay on the hosted
relay; OAuth-gated features degrade to "requires the hosted relay" on desktop.
Porting all 2521 LOC is a multi-month detour with no user value — resist it.

Ported validation must match `shared-validation/`: canonical JSON (use
`ip-crypto`), Schnorr verify, the PoW leading-zero-bit table, replay window.

Then:
- `settings.rs::SettingsStore::snapshot()` currently hardcodes `hub_port: 0`.
  Report the real port. `src/platform/tauri/config.ts::preferredGunPeers()`
  already prepends `ws://127.0.0.1:<port>/gun` when non-zero, and
  `config.getGunPeers()` already puts it first. **That wiring is done and
  untested — verify it end to end.**
- Move the relay socket into Rust: `src/platform/tauri/signal.ts` →
  `invoke('relay_connect')` + a Tauri `Channel<string>`. This is what lets the
  socket survive a webview reload and keep relaying with the window hidden.
- `tray.rs` has a disabled `status` menu item reading `"Relay: not running"`.
  Wire it to live peers-served / bytes-relayed / uptime.
- Add `--hidden` to the autostart args in `lib.rs` so launch-at-login seeds from
  the tray without stealing focus.
- Flip `capabilities.canSeed = true` **only when it actually works.**

### Acceptance
A browser tab configured to point at the desktop's local relay works fully, with
the desktop machine disconnected from the internet.

---

## 6. Phase 4 — Hardware-protected keys

**Ships:** the private key never enters JS.

### Read this before promising anything

The protocol identity is **BIP-340 Schnorr over secp256k1**. Neither TPM 2.0's
standard algorithm set nor YubiKey PIV can sign that curve+scheme. You **cannot**
move this signature into hardware without a protocol change that forks the
network. Market as **"hardware-protected"**, never "hardware-signed".

- **Tier 1 (ship this):** key encrypted at rest; wrapping key in the OS keychain
  (`keyring` 3.x). Signing in `ip-crypto` via the **`secp256k1` crate with the
  `schnorrsig` feature** — `k256` does **not** implement BIP-340. Zeroize after
  use (`zeroize` crate).
- **Tier 2 (optional, later):** TPM/YubiKey holds a P-256 *wrapping* key; the
  secp256k1 identity is sealed to it, so hardware presence unseals the session.

**Linux with no Secret Service is a real failure mode** (headless, minimal
installs) → fall back to an Argon2id-derived passphrase file
(`argon2` + `chacha20poly1305`).

Frontend: `SignerBackend` in `src/platform/types.ts` is already defined. Route
`cryptoService`/`keyService` signing to it. `getPrivateKeyHex()` /
`exportPrivateKey()` **must throw** on desktop; `exportMnemonic()` goes behind an
OS auth prompt.

Migrate `metadata['nostr-keypair']` out of IndexedDB into the sealed store with a
one-time "your key has been moved to the OS keychain" notice.

Also move PoW here: `invoke('pow_solve')` with `rayon`. Difficulty 18 drops from
~200 ms of blocked main thread to <10 ms.

### Acceptance
Dump the running webview heap — no 64-hex private key present.

---

## 7. Phase 5 — Direct P2P

**Ships:** LAN discovery, relay-free operation.

`crates/ip-p2p`:
- **mDNS:** `mdns-sd` 0.11+ (pure Rust, no Avahi/Bonjour). Service
  `_interpoll._udp.local.`, TXT records `pub=<xonly>`, `port`, `ns=v3`,
  `chain=<tipHash>`. Fallback if Windows firewall profiles misbehave: hand-rolled
  UDP multicast on `239.255.42.99:8765` (~150 LOC).
- **Transport ladder (opinionated):** desktop↔desktop uses **`quinn`** (QUIC) +
  STUN hole punching — simpler and more reliable than WebRTC when both ends are
  native. Use **`str0m`** *only* for desktop↔browser. str0m's API churns and its
  SCTP is less battle-tested; if it blocks, that path degrades to hub relaying
  and nothing else is affected.
- STUN via `stunclient`; reuse `config.getIceServers()`.

Frontend: `signalingService.ts` already has a tier model
(`SignalTier = 'wss' | 'gun' | 'mesh' | 'none'`). Add `'lan'` **above** `'wss'`.
`webrtcService.ts` already has full manual/offline signaling
(`createManualOffer`, `acceptManualOffer`, `encodeBundle`/`decodeBundle`) — reuse
it, don't rewrite it.

### Acceptance
Two desktops on a LAN with the internet cable pulled discover each other and sync
a new poll in <5 s. Two desktops behind different NATs connect with no relay in
the data path.

---

## 8. Phase 6 — Tor (**the capability the web build structurally cannot have**)

**Ships:** real anonymity *and* onion-addressed seeding — no longer mutually
exclusive.

Today `anonymityMode` is a subtraction (`config.ts:50-64`): kill STUN, kill
WebRTC, hope the user is in Tor Browser. With **arti** linked as a library this
inverts.

`crates/ip-tor`:
- **Outbound:** `arti-client` builds a `TorClient`; `ip-gun-peer` and the HTTP
  client dial through Tor streams. The app is anonymous with no Tor Browser, no
  Orbot, no system proxy. `.onion` upstreams work natively.
- **Inbound (the good part):** `tor-hsservice` publishes the embedded hub as an
  onion service. A user behind CGNAT with no port forwarding and no public IP
  becomes a **reachable relay**. This is the cleanest answer to the network's
  dependence on `endless.sbs`, and it composes with tray seeding.

**Three modes** in Settings:
- `off` — direct; LAN + STUN + QUIC all on (default).
- `tor` — all relay/API traffic over arti; `ip-p2p` **hard-disabled in Rust** so
  mDNS/STUN/QUIC emit zero packets; onion service on.
- `hybrid` — LAN/mDNS peers direct (same network, no anonymity to lose),
  everything internet-bound over Tor.

**Enforcement must move into Rust.** Today `config.anonymityMode` returning `[]`
is advisory — any code path constructing an `RTCPeerConnection` could bypass it.
In `tor` mode `ip-p2p` must refuse to start, making the leak impossible rather
than discouraged. Keep the JS guard as defence in depth.

**Costs, state them honestly:** arti adds ~6–8 MB and a 5–20 s first bootstrap;
onion latency makes chat feel sluggish; arti's onion-service support is younger
than its client side. Mitigate: Tor is opt-in, bootstrap runs in background with
the app usable on LAN meanwhile, tray shows circuit status.

### Acceptance
In `tor` mode a packet capture shows **no** direct connection to `endless.sbs`,
no STUN, no mDNS. A second machine syncs to us via our `.onion` alone.

---

## 9. 🔴 Open issue — desktop performance on Linux

**Unresolved. Investigate before building features on top.**

The user's first run was reported as *"very slow… very laggy in general"* on
Wayland + NVIDIA RTX 4060 + WebKitGTK 2.52.3. That was a `tauri dev` build
(unoptimized Rust, Vite dev server), so not representative — but it was bad
enough to matter, and this was **risk #5 in the plan**: WebKitGTK trails Chromium
badly, especially on Ionic's animations.

`apply_webkit_workarounds()` in `src-tauri/src/lib.rs` now sets
`WEBKIT_DISABLE_DMABUF_RENDERER=1` when NVIDIA is detected. **A release build with
this fix was produced but never confirmed by the user.** Do not assume it worked.

Next steps, in order:
1. Get a subjective read on the release build:
   `TAURI_BUILD=1 npx tauri build --no-bundle && ./src-tauri/target/release/interpoll-desktop`
2. If still laggy, bisect the environment:
   - `WEBKIT_DISABLE_COMPOSITING_MODE=1` (heavier hammer)
   - `GDK_BACKEND=x11` (run under XWayland — often decisive on NVIDIA)
   - Compare against the same build on an Intel/AMD GPU machine to separate
     "NVIDIA problem" from "WebKitGTK problem".
3. If WebKitGTK itself is the floor, the honest options are: accept Linux as the
   weak platform (Windows WebView2 and macOS WKWebView are much faster), reduce
   Ionic animation use on desktop, or reconsider the webview-reuse premise —
   which would invalidate the "reuse the Vue UI" decision and is a genuine
   architectural fork worth escalating to the user, not deciding alone.

**Also worth noting:** the user's other reaction was *"I don't see any additional
features"* — correct, and by design for Phase 0, but it means **Phase 1 or 3
should land soon** to make the desktop app feel worth running. Phase 3 (tray
seeding) is the most visible; Phase 1 (unlimited history + instant offline
search) is the most immediately *useful*. Either beats another invisible phase.

---

## 10. Working agreements

- **Update `capabilities.ts` flags only when the feature actually works.** The UI
  reads them to decide what to advertise; a premature `true` promises something
  broken.
- **Keep `unit_tests/platformSeam.test.ts` green.** If it fails you have leaked
  the abstraction.
- **Every Rust↔JS boundary gets a differential test.** The canonical-JSON one
  found a real bug on its first run; the gun-js conformance harness is the same
  idea for the wire protocol. This is the single highest-value practice here.
- **Per CLAUDE.md:** update the relevant `copilot-*.md` when contracts change.
  The seam is documented at the end of `src/services/copilot-services.md`.
- Commands: `npm run dev:desktop`, `npm run build:desktop`, `npm test`,
  `cargo test --manifest-path src-tauri/Cargo.toml`.
- Linux build deps: `libwebkit2gtk-4.1-dev libgtk-3-dev
  libayatana-appindicator3-dev librsvg2-dev libsoup-3.0-dev build-essential`.
