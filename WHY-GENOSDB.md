# Same InterPoll, one dependency — a GenosDB proof of concept

> A friendly contribution, not a critique. InterPoll solves a real, important
> problem, and the engineering behind its P2P stack is no small feat. This
> document shows how **[GenosDB](https://github.com/estebanrfp/gdb)** can deliver
> the *exact same capabilities* with a fraction of the moving parts — offered in
> case it helps the project.

---

## The headline

| | InterPoll before | InterPoll on GenosDB |
|---|---|---|
| **Runtime dependencies** | **28** | **16** (the UI stack stays untouched) |
| ↳ data / P2P / crypto / storage stack | **13** of them | **1** (`genosdb`) |
| **Service files** (`src/services`) | **~40** | **21** |
| **Source lines** (`src`, ts+vue) | **~46,000** | **~23,100** (−50%) |
| **Relay servers to run** | **3** + `peer.js` | **0** (Nostr signaling) |
| **Data-layer bundle** | `gun` + `ipfs-core` + `libp2p-webrtc-star` + `simple-peer` + Node polyfills | **~116 KB gzip** full stack · **26 KB** core |

The 13 dependencies GenosDB replaces with itself:

```
gun  ipfs-core  libp2p-webrtc-star  simple-peer  ws
@noble/curves  @noble/hashes  bip39  idb
buffer  os-browserify  path-browserify  stream-browserify
```

> Note: InterPoll already runs Gun with `localStorage: false, radisk: false,
> axe: false` — i.e. Gun was reduced to a live pub/sub channel, and persistence,
> identity, integrity and transport were rebuilt by hand on top. That hand-built
> layer is precisely what GenosDB provides natively.

---

## What GenosDB resolves out of the box

Most of the 40 services exist to build, by hand, things GenosDB ships built-in:

| InterPoll builds by hand | GenosDB native feature |
|---|---|
| `cryptoService` · `keyService` · `keyVaultService` · `@noble/*` · `bip39` | **Security Manager** — WebAuthn + BIP39 identity, every op cryptographically signed |
| `encryptionService` · private communities | `db.sm.put/get` — per-user end-to-end encryption |
| `chainService` · `integrityService` · `powService` | **Hybrid Logical Clock** — causal ordering + deterministic, signed, tamper-evident history |
| RBAC / roles / invites by hand | **Security Manager RBAC** — roles, permissions, expirations |
| `relayManager` · `relayHealthService` · 3 relay servers · `ws` | **GenosRTC** — decentralized Nostr signaling, no servers to run |
| `webrtcService` · `simple-peer` · `libp2p-webrtc-star` | **GenosRTC** + **Cells** (cellular mesh) — orders-of-magnitude fewer connections at scale, zero infrastructure |
| `storageManager` · `storageService` · `idb` · `ipfsService` · `pinningService` | **OPFS** persistence in a dedicated Web Worker |
| `snapshotService` · `snapshotSyncService` | **Hybrid Delta Protocol** — delta updates + full-state fallback |
| `searchService` (relay REST index) · `auditService` (OAuth backend) | local reactive `db.map` queries · SM signature as authorization |
| `pollService` (1,605 lines) · `postService` · `commentService` | `db.put()` + reactive `db.map()` queries |

---

## What this looks like in code

A poll, a vote, and live results — signed identity, P2P sync, and persistence
included, with **no relay server and no extra dependency**:

```js
import { gdb } from 'genosdb'

// Identity (WebAuthn/BIP39), RBAC, signing, P2P sync, OPFS — all enabled here.
const db = await gdb('interpoll', { rtc: true, sm: { superAdmins: ['0x…'] } })

// Create a poll — signed by the author, replicated to peers, persisted locally.
await db.put({ type: 'poll', q: 'Best P2P DB?', options: ['GenosDB', 'Other'] }, 'poll:1')

// Cast a vote — cryptographically attributed, conflict-resolved by HLC.
await db.put({ type: 'vote', poll: 'poll:1', choice: 'GenosDB' })

// Live, tamper-evident results — reactive, offline-first, no polling.
db.map({ query: { type: 'vote', poll: 'poll:1' } }, ({ action, value }) => {
  renderTally(value) // 'initial' | 'added' | 'updated' | 'removed'
})
```

That is the whole stack InterPoll assembles across `gunService`, `webrtcService`,
`websocketService`, `relayManager`, `cryptoService`, `keyService`,
`integrityService`, `storageManager` and more — expressed in a few lines.

---

## What you gain (not just what you remove)

This isn't only about deleting code — the approach we're sharing makes the app
**stronger** at the same time:

- **Real cryptographic identity.** Users are their signing key (WebAuthn passkey
  or BIP39 phrase), not a spoofable device fingerprint. Every action is attributed
  and verifiable.
- **Security that can't be skipped.** Signing and verification are automatic and
  built into the database — there's no "we forgot to sign this path" surface area.
- **Race-free results.** Votes are independent signed nodes; tallies are derived,
  so two people voting at once can never clobber each other's count.
- **True offline-first.** Actions persist to OPFS instantly and sync on reconnect,
  with cross-tab consistency for free — no warmup, no fallback database.
- **Zero operations.** No relay servers, no OAuth backend, no SQL fallback, no
  nginx/PM2/Tor to run, monitor, secure or pay for. The app *is* the network.
- **Scales by design.** The optional cellular mesh (**Cells**) keeps large communities
  fast by cutting peer connections by orders of magnitude vs a full mesh (the docs cite
  roughly 100×–1000× fewer for large networks) — without changing a line of app code.
- **Half the codebase to maintain.** ~46k → ~23k lines, 40 → 21 services. Less
  surface for bugs, faster onboarding for new contributors.
- **One dependency, zero transitive deps.** A smaller supply-chain and attack
  surface than a multi-library P2P/crypto/storage stack.

---

## Build with AI on GenosDB (a skill is bundled in this repo)

We did this entire migration pair-programming with an AI assistant, and it went
smoothly for one concrete reason: **GenosDB has genuinely excellent, complete
documentation** — API reference, CRUD guides, real-time (GenosRTC), Security
Manager, the query language, the optional modules, and the internals (HLC, worker,
delta protocol). That breadth is exactly what lets an AI write correct, idiomatic
GenosDB code with you instead of guessing.

To make that easy for your team **whatever assistant you use**, this repo ships the
GenosDB guidance in each tool's native format:

- **`AGENTS.md`** (repo root) — the cross-tool standard read by GitHub Copilot,
  Cursor, Zed and others: architecture summary + the full official docs index.
- **`.github/copilot-instructions.md`** — GitHub Copilot's repo instructions, pointing
  to `AGENTS.md`.
- **`.claude/skills/genosdb/`** — a Claude Code skill for the same expertise on demand.

Open the project in your assistant and it becomes a GenosDB expert — it pulls the
official docs (all links resolve to
[github.com/estebanrfp/gdb](https://github.com/estebanrfp/gdb)) and follows the
recommended patterns: top-level `await gdb(...)`, reactive `db.map` with proper
`unsubscribe` cleanup, signed-by-default writes, derived counts over signed nodes,
and RBAC via the Security Manager.

In other words: the same comfortable, fast AI workflow that produced this
migration is now one prompt away for any contributor — ask it to *"add a feature
with GenosDB"* and it already knows how.

---

## Why I'm sharing this

I spent years contributing to the P2P/decentralized community — docs, examples,
issues — and I built GenosDB to remove exactly the friction InterPoll is fighting:
the pile of dependencies, the hand-rolled identity and integrity layers, the
relay servers you have to operate. Seeing InterPoll tackle a problem I care about,
I wanted to show a lighter path — freely, no strings attached. Use it, adapt it,
ignore it, or ask me anything.

— Esteban Fuster Pozzi ([@estebanrfp](https://github.com/estebanrfp)) · GenosDB

## Links

- GenosDB: https://github.com/estebanrfp/gdb · https://www.npmjs.com/package/genosdb
- Docs: https://genosdb.com
- Cellular Mesh (P2P network scalability): https://dev.to/estebanrfp/genosdb-cellular-mesh-solving-p2p-network-scalability-4jei

---

# Migration findings log — concrete, measured evidence

> A running record of what the migration found: the work a P2P app must build and
> maintain by hand on the previous stack, and how GenosDB provides it natively.
> None of this is a knock on the InterPoll team — this is plumbing the underlying
> library leaves to *every* project, and exactly the plumbing we wanted to spare
> you. Numbers are real line counts from the migrated files.

## Code reduction by section (measured)

| Section | Before (Gun) | After (GenosDB) | Reduction |
|---|---:|---:|---:|
| Polls (service + store) | 2,088 | 369 | **−82%** |
| Communities (service + store) | 1,195 | 287 | **−76%** |
| Posts (service + store) | 1,142 | 335 | **−71%** |
| Comments (service + store) | 915 | 253 | **−72%** |
| `gunService.ts` → `gdbServices.ts` | 433 | ~30 | **−93%** |
| Runtime dependencies | 28 | 16 (one of them is `genosdb`) | the 13-dep P2P/crypto stack → **1** |
| Relay servers to operate | 3 + `peer.js` | **0** | Nostr signaling |

## What the previous stack made you build by hand — and what GenosDB does for you

1. **Gun was demoted to a dumb pub/sub pipe.** The app ran Gun with
   `localStorage:false, radisk:false, axe:false` and a comment admitting "Gun is
   now live-updates only, not the initial load source." Persistence, identity and
   integrity were all rebuilt by hand on top. GenosDB provides all three natively.

2. **Manual namespacing.** A `Proxy` re-routed every `.get()` through a `v3/`
   prefix because Gun has no database scoping. In GenosDB the db name *is* the
   scope — the proxy is deleted.

3. **Flood firefighting everywhere.** Throttled `map`, batched incoming queues,
   sync-rate loggers and a console-trace for Gun's "syncing 1K+ records a second"
   warning. GenosDB's `db.map` emits only matching nodes with clean
   `initial/added/updated/removed` actions — none of this is needed.

4. **Manual RAM eviction.** `evictCache('light'|'aggressive'|'emergency')` and
   `getGraphNodeCount()` existed because Gun keeps the entire graph in memory and
   floods. GenosDB runs storage in an OPFS Web Worker — no eviction code.

5. **Vote counts stored on the parent node → last-write-wins races.** Polls kept
   `options[].votes`, so concurrent voters overwrote each other; the store added a
   10-second "vote-protection" window to stop the UI reverting. Posts were worse:
   `voteOnPost` did `upvotes++` with **no per-user record at all — you could vote
   infinitely.** GenosDB model: each vote is a **signed node** keyed
   `${id}:${address}` (one vote per identity), and tallies are **derived** →
   deterministic, race-free, and the whole vote-protection machinery vanishes.

6. **Identity was a spoofable device id.** Users were keyed by a browser
   fingerprint/`deviceId`. Zero-trust fix: identity *is* the Security Manager
   signing address; a profile is cryptographically attributed, not self-declared.

7. **Every piece of content was signed by hand.** ~10 services called
   `KeyService.getKeyPair()` + `CryptoService.sign()` for "anti-sabotage"
   signatures on posts, comments, communities and votes. The SM **signs every
   `db.put` automatically** and peers verify it — all of that hand-rolled signing
   is deleted.

8. **Arrays couldn't be stored, so they were shredded.** Community `rules` were
   split into a child node and reassembled through `rulesCache`,
   `rulesLoadPromises`, `rulesSubscriptions`, `parseRules`, `loadRulesCached`…
   GenosDB stores arrays on the node directly — the entire rules layer is gone.

9. **The live subscription was disabled in production.** Communities defaulted to
   `COMMUNITY_GUN_LIVE_ENABLED = false` and bootstrapped from **MySQL/REST
   fallbacks** (`/db/search`, `/api/communities`, `/api/posts`) plus a "posts
   warmup" that re-injected rows into Gun's cache. That's a P2P database falling
   back to a central SQL server because its own sync was unreliable. GenosDB syncs
   P2P and persists to OPFS — one reactive subscription replaces all of it.

10. **Denormalized double-writes.** Each post was written to both `posts/{id}`
    and `communities/{cid}/posts/{id}` for queryability. GenosDB stores one node
    and queries it with `db.map({ query: { type:'post', communityId } })`.

11. **Namespace migration cruft.** A v2-vs-v3 `dataVersion` legacy-purge system
    (`purgeLegacyPosts`, an `evict-legacy-posts` window event) existed to stop old
    Gun data bleeding into new clients. Not needed.

12. **Cross-tab and propagation done by hand.** Stores manually wired
    `BroadcastService` (cross-tab) and `WebSocketService` (relay rebroadcast) for
    "poll-updated"/"new-event". GenosDB has BroadcastChannel cross-tab sync and
    P2P delta propagation built in.

13. **A redundant signed-event log.** `EventService` re-signed every action into a
    parallel event stream — redundant once the SM signs all operations.

14. **A hand-rolled blockchain for vote integrity.** `chainService` +
    `integrityService` built a real blockchain in IndexedDB: genesis block, block
    hashing and linking, Schnorr block signatures, proof-of-work nonces and
    full-chain validation. GenosDB's **HLC + per-operation signatures** give the
    same tamper-evidence natively, so the chain is just signed `chainAction`
    nodes — the genesis/PoW/linking machinery is gone.

15. **A bespoke cross-peer chain-sync protocol.** Sharing that chain needed a
    custom `request-sync` / `sync-response` / `new-block` message protocol over
    WebSocket + BroadcastChannel + relay, with incremental-sync back-off, rate
    loggers and a debug heartbeat. GenosDB replicates the signed nodes
    automatically — the whole protocol (~250 lines) was deleted.

16. **An OAuth + REST authorization backend for voting.** `auditService` ran a
    two-phase `/api/vote-authorize` → `/api/vote-confirm` flow with reservation
    tokens, plus Google/Microsoft OAuth login gates, all served by the relay. In a
    zero-trust model the **SM signature *is* the authorization** — peers verify it
    locally — so the backend, the OAuth apps and their secrets all disappear.

17. **A relay-backed search index.** `searchService` POSTed a sealed index to
    `/api/index` and queried `/api/search` on the relay. GenosDB holds the data
    locally, so search is a direct reactive `db.map` over `post`/`poll` nodes — no
    index to maintain, no server to query.

18. **Image hosting bolted on with IPFS.** `ipfs-core` + `pinningService` shipped
    a whole IPFS stack to store images. Images are now ordinary GenosDB nodes
    (compressed, OPFS-persisted, P2P-synced) — one less subsystem and dependency.

19. **Server-side anti-abuse + deployment to operate.** Three relay servers,
    `peer.js`, and a fleet of Node scripts (`bot-detector`, `spam-scorer`,
    `pow-challenge`, `rate-limiter`, `ws-validators`) plus nginx/PM2 configs and
    Tor-relay guides existed just to keep the network alive and fair. GenosDB needs
    **zero servers** — nothing to deploy, monitor, or defend.

## Edge cases the signed-node model removes by design

These aren't criticisms — they're the kind of subtle issue that simply *cannot
arise* once identity is cryptographic and votes are per-identity signed nodes.
We mention them only to show the model is safer, not just smaller:

- A community was created with `creatorId: 'current-user-id'` (a placeholder
  string). With GenosDB the author is always the real signing address — there is
  no separate id to forget to fill in.
- A post could be up/down-voted unlimited times (no per-user vote record). The
  one-signed-vote-node-per-identity model makes repeat voting structurally
  impossible, with no extra code.

## It compiles, runs, and was verified in the browser

The migrated app builds with Vite and runs live on GenosDB:

- **Bundler:** Vite. GenosDB ships a self-contained `dist/` and resolves its own
  modules at runtime via `import(new URL('./*.min.js', import.meta.url))`, so rather
  than bundling it the app loads it **intact from one served folder** (`<base>/genosdb/`)
  via a small `genosdb-static` plugin (serves it from `node_modules` in dev, copies it
  into the build); build `target: 'es2022'` (top-level await for the `gdb()` init).
  `npm install genosdb` adds **zero transitive dependencies**.
- **Onboarding:** a minimalist identity gate (`OnboardingModal.vue`) backed by the
  Security Manager, following the SM UX best practices (state-callback as single
  source of truth, always-available mnemonic login, read-only phrase + save
  warning during registration, Passkey as the recommended upgrade).
- **Verified end-to-end in the browser console:**
  ```json
  { "identityActive": true, "address": "0xc158…5e4f",
    "pollQuestion": "Does GenosDB work?", "voteCount": 1, "votedFor": ["o1"] }
  ```
  i.e. SM identity (generate + mnemonic login) → signed `db.put` (poll + vote
  nodes) → `db.get` / `db.map` read-back all work. The feed, communities, posts,
  votes and private communities render on GenosDB.
- **Verified peer-to-peer across two independent browsers.** With two isolated
  contexts (separate identities and OPFS), a poll created in peer A appeared in
  peer B, and a vote cast in peer B was accepted and counted in peer A — over
  WebRTC with Nostr signaling, **no server in between**.
- **Open-participation RBAC, configured deliberately.** GenosDB's Security Manager
  is secure-by-default: a brand-new identity is a `guest` that can only read/sync
  until a superadmin promotes it. For an open public platform that's the wrong
  default, so we pass `customRoles` giving `guest` the `write`/`link` permissions
  — anyone can post and vote the instant they exist, while authenticity stays
  fully enforced (every op is still signed and peer-verified). This is the right
  use of the permission model, not a workaround.
- **Full vitest suite green** (7 files, 95 tests) and a clean tree — every test,
  service and script tied to the old stack was removed.

## Dependency note

`idb` was initially removed as "storage → OPFS", then restored: OPFS holds the
GenosDB *graph*, but `KeyVaultService` legitimately uses `idb` as a **local vault
for group AES keys** (encrypted rooms / private communities) — local secret
storage that GenosDB does not replace. The clean rule: GenosDB replaces the P2P
data/identity/sync layer; genuinely local, non-graph secrets stay local.

---

# Refactor complete — final state

The migration is finished end-to-end: **Gun is 100% removed** from the codebase
(no `gun` import, no `GunService`, no relay servers), every feature runs on
GenosDB, and the app compiles, runs and was verified live in the browser.

## Whole-project totals

| Metric | Before (Gun) | After (GenosDB) |
|---|---:|---:|
| Runtime dependencies | 28 | **16** (the P2P/crypto/storage stack: 13 → **1**, `genosdb`) |
| Source lines (`src`, ts+vue) | ~46,000 | **~23,100** (−50%) |
| Service files | ~40 | **21** |
| Relay servers to operate | 3 + `peer.js` | **0** |
| Gun / IPFS / libp2p deps | many | **none** |

## What every section became

- **Identity** → Security Manager (WebAuthn + BIP39), `authStore` + a minimalist
  `OnboardingModal` following the SM's UX best practices. Every op is signed.
- **Polls / Posts / Comments** → nodes + **signed vote nodes** (one per identity);
  tallies derived, no last-write-wins races, no "vote-protection" hacks.
- **Communities** → nodes with native arrays; membership as signed nodes.
- **Chat** → group rooms and DMs over GenosDB nodes + `db.room`; E2E encryption kept.
- **Trust** → issuer/username storage on GenosDB; external issuer protocol untouched.
- **Integrity / receipts** → the hand-rolled blockchain replaced by signed
  `chainAction` nodes ordered by the Hybrid Logical Clock; receipts are nodes.
- **Network page** → relay management replaced by live GenosRTC mesh/room status.
- **Images** → stored as GenosDB nodes (OPFS-persisted), not Gun + IPFS pinning.
- **Search** → local reactive `db.map` query instead of a relay REST index.
- **Audit / OAuth vote-gating** → removed; the SM signature *is* the authorization.

## Removed for good (dead Gun ecosystem)

`gunService`, `relayManager`, `relayHealthService`, `websocketService`,
`broadcastService`, `discoveryService`, `snapshotService`, `snapshotSyncService`,
`bootstrapInviteService`, `powService`, `integrityService`, `chainService`,
`eventService`, `dbWarmup`, `memoryWatchdogService`, `storageManager`,
`pinningService`, `gunRelayPresets`, `dataVersionSettings`, `webrtcService`,
`useProofOfWork`, the 3 relay servers, `peer.js`, the anti-abuse scripts, the
nginx/pm2/nuxt configs, and the entire `KeyService`/`CryptoService` Schnorr stack —
the Security Manager signs every operation, so the leftover compile-shims
(`cryptoService`, `keyService`, `useFingerprint`) have since been deleted as dead code.

## Why we're sharing this

Building a censorship-resistant platform on the previous stack meant hand-building
identity, signing, a blockchain, relay management, cross-tab and cross-peer sync,
RAM eviction, flood throttling, SQL fallbacks and an OAuth backend — and operating
the servers behind them. That's an enormous, admirable amount of work.

We went through every line of it and rebuilt the same product on GenosDB, where
all of that is native: **one dependency, zero servers, signed-by-default,
race-free**. Same app, half the code, stronger guarantees — and it runs.

We're not pitching a rewrite or claiming InterPoll did anything wrong. We care
about the same problem, we built an alternative that removes this whole class of
plumbing, and we wanted to share it in case it's useful — to adopt, to borrow
ideas from, or just to compare notes. Use it, fork it, ignore it, or ask us
anything.

And an open invitation: **it would be our pleasure to feature InterPoll in the
[Awesome Projects & Showcases](https://github.com/estebanrfp/gdb/blob/main/docs/genosdb-examples.md#awesome-projects--showcases)
section of the main GenosDB repository.** InterPoll is exactly the kind of real,
ambitious decentralized app that community deserves to see — your project, your
credit, alongside the others building in the open. If you'd like that, just say
the word (or open a PR / issue on the GenosDB repo) and we'll add it with pleasure.

— Esteban Fuster Pozzi ([@estebanrfp](https://github.com/estebanrfp)) · GenosDB

---

# Update — beyond the migration: governance and moderation

The migration above proved GenosDB *replaces* InterPoll's old stack. The work since
proves more: GenosDB carries the app's **hardest** features — earned trust and
moderation — natively.

## Earned trust, not granted — governance

InterPoll's toughest question is moderation without a central censor. GenosDB's
**Security Manager + governance rules** answer it as *data, not policy*. We defined a
public, identical-for-everyone ladder: a settled `guest` becomes a `member`, and a
`member` climbs to `trusted` by participating (3+ posts), auto-demoting if activity
drops. A superadmin signs each promotion as a transparent **notary** — it only signs
what the public rules dictate — and once signed, the role is **synced graph state**
that propagates and persists across peers *even after the superadmin goes offline*. No
server decides who is trusted; the public rules do, and every peer verifies it. The
role badge is **reactive**: a promotion climbs it live, with no refresh, because it
subscribes to the signed `user:<address>` node over realtime `db.get` (verified
cross-peer — a role change written on one browser fires the subscription on another).

## Moderation that respects the model — per community, never global

Moderation is **node-level ACLs**, scoped to each community. A community is an
ACL-owned node (its creator owns it), so only the owner — or a moderator the owner
*explicitly* delegates to — can act on that community's content, and only that
community's. There is no global `delete`, no platform-wide censor: each community
governs its own space, exactly the autonomy a decentralized forum should have. An
author can always remove their own posts; a community can remove what breaks *its*
rules — neither is the other's censor.
