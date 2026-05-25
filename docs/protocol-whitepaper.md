# InterPoll Protocol(IPP) Whitepaper
 
**Version:** 0.5  
**Status:** Official 


---

## 1. Ethos

InterPoll is built on a simple principle: **a voice for everyone, with records that are harder to erase than on any single-server system**.

The protocol is designed so participation does not depend on a single central database. Votes and civic activity are written locally, propagated peer-to-peer, and replicated across distributed storage. In practice, this means discussion and voting history can survive outages, server churn, and censorship attempts — provided at least one honest peer, device, or relay retains a copy and later reconnects.

We found that other social media platforms censor a lot — and even if not — shadow-ban it. In our case, anyone can create his algorithm.

Our motto is: **"101 % Uptime!!!"**

---

## 2. What the Protocol Is

InterPoll is a **browser-first, relay-assisted P2P polling protocol** with local-first storage, tamper-evident receipts, GunDB replication, and eventual convergence. It is made from three cooperating planes:

1. **Integrity plane (local chain):** each client keeps an append-only hash-linked log of actions/votes in IndexedDB.
2. **Replication plane (GunDB):** polls, communities, posts, comments, users, and media metadata replicate as distributed graph data.
3. **Coordination plane (WS + BroadcastChannel):** peers discover each other and synchronize new blocks/events quickly across devices and tabs.

The protocol remains usable when parts of the network are unavailable, then converges when connectivity returns. It can even survive without any network at all, as long as devices can keep their local history and later reconnect to peers.

> **Architecture note:** The current implementation relies on WebSocket relays, GunDB relay servers, and optional backend API paths as real infrastructure. This is the correct and realistic architecture for a browser-first system. The protocol does not claim to eliminate relay infrastructure; it is designed to minimise trust requirements on any single relay and allow communities to run their own.

---

## 3. Why It Is Unique

Most systems choose one source of truth (a server) and one transport path. InterPoll uses **composed truth**:

- **Local truth:** every participant has a verifiable local history.
- **Network truth:** peers exchange only missing history incrementally.
- **Distributed content truth:** social/poll objects replicate in GunDB under a versioned namespace (`v3`).

This combination gives a property that is uncommon in polling products: **offline continuity with later convergence** rather than all-or-nothing online dependence.

---

## 4. Protocol Objects

### 4.1 Vote payload

```ts
{
  pollId: string,
  choice: string,
  timestamp: number,
  deviceId: string
}
```

### 4.2 Chain block

```ts
{
  index: number,
  timestamp: number,
  previousHash: string,
  voteHash: string,
  signature: string,
  currentHash: string,
  nonce: number,
  pubkey?: string,
  eventId?: string,
  actionType?: 'vote' | 'community-create' | 'post-create',
  actionLabel?: string
}
```

### 4.3 Receipt

A receipt contains **public verification material only**. It does not contain any private key, wallet seed, or recovery secret.

```ts
{
  receiptId: string,
  pollId: string,
  actionType: string,
  voteHash: string,
  blockIndex: number,
  chainHeadHash: string,
  timestamp: number,
  pubkey: string,
  signature: string,
  verificationCode: string  // human-readable lookup code (not a wallet seed or signing secret)
}
```

> **Note on `verificationCode`:** This is a short human-readable code used for receipt lookup and display. It is **not** a BIP-39 wallet seed, not a private key, and not a recovery secret. It carries no cryptographic signing authority. Users should not treat it as sensitive wallet material.

### 4.4 Signed event (Nostr-compatible shape)

```ts
{
  id: string,
  pubkey: string,
  created_at: number,
  kind: 100|101|102|103,
  tags: string[][],
  content: string,
  sig: string
}
```

Kinds used now:

- `100` poll creation
- `101` vote cast
- `102` poll update
- `103` post creation

---

## 5. End-to-End Protocol Flow

### 5.1 Boot and identity

On startup, a client:

1. Initializes local stores (`interpoll-db`).
2. Loads or creates a persistent signing keypair.
3. Connects to configured relay endpoints.
4. Joins sync channels (WebSocket + BroadcastChannel).
5. Announces/learns relay endpoints through discovery (`server-list` and Gun discovery registry).

#### Bootstrap assumptions

A fresh browser peer still needs an initial discovery path. The current assumptions are:

- **Known relay endpoint:** the client is pre-configured with at least one known WebSocket relay URL and one GunDB relay URL (via environment variables or `localStorage` override).
- **GunDB peer:** the GunDB relay at the configured URL is the first replication peer.
- **Cached server list:** once a peer has connected at least once, it accumulates known relay endpoints in `localStorage`. These are used for reconnection without any central registry.
- **Community-provided relays:** communities can run their own relay servers. These are discovered through peer-to-peer `server-list` sharing.
- **Discovery registry:** relay announcements are also published in GunDB under `v3/server-config/discovery`, providing a secondary discovery channel.

**What happens if all known relays are unavailable?** The client falls back to local-only operation. Votes and actions are still recorded in the local hash-chain (IndexedDB) and replicated to other open tabs via BroadcastChannel. Cross-device sync resumes when any relay becomes reachable again.

**Minimum infrastructure for network restart from zero:** at least one WebSocket relay and one GunDB relay must be reachable by a bootstrap peer. Any peer that retained local chain data can then reseed the network once a relay is available.

### 5.2 Vote write path

When a user votes:

1. Vote payload is created.
2. A new local chain block is built (`previousHash` -> `currentHash` link).
3. Block and vote are persisted locally.
4. A receipt is generated and stored.
5. New block/event are broadcast for peer synchronization.
6. Backend duplicate-protection uses a strict two-phase path: `vote-authorize` issues a short-lived reservation token, and `vote-confirm` commits only with that token from the same session context.
7. For polls marked `requireLogin`, relay-side vote identity is OAuth-backed (provider+subject), not only device ID.

### 5.3 Incremental sync path

Clients synchronize with:

```json
{ "type": "request-sync", "lastIndex": <local_head_or_-1> }
```

Peers respond with only missing blocks:

```json
{ "type": "sync-response", "blocks": [...] }
```

A block is accepted only when chain continuity is satisfied (or valid genesis bootstrap).

### 5.4 Cross-tab convergence

Within one browser, `BroadcastChannel('interpoll-sync')` mirrors the same sync semantics as WebSocket, so separate tabs converge without needing network round-trips.

### 5.5 Verified username trust-issuer flow

InterPoll supports optional verified usernames through external trust issuers.

1. Client selects an issuer (`domain`, `endpoint`, `publicKey`) from built-in, Gun, or local custom issuer sources.
2. Client requests challenge: `POST {issuer}/challenge` with `{ username, pubkey }`.
3. Issuer returns `{ challengeId, prefix, difficulty, expiresAt }`.
4. Client solves SHA-256 leading-zero PoW locally and submits `POST {issuer}/claim` with `{ challengeId, nonce, username, pubkey }`.
5. Issuer returns signed certificate:

```ts
{
  issuerDomain: string,
  username: string,
  userPubkey: string,
  issuedAt: number,
  expiresAt: number,
  signature: string
}
```

6. Client verifies certificate signature against issuer public key and verifies username/pubkey binding before persisting claim.
7. Verified claim is stored under `usernames/{username}` with `level: 'verified'`, and UI profile identity fields (`identityUsername`, `identityIssuer`, `identityTrustLevel`) are updated from claim state.

Security constraints implemented by the client:

- issuer endpoints must be HTTPS (except localhost development)
- issuer domain must match endpoint host/parent domain
- challenge payload bounds are validated (`difficulty`, `expiresAt`, required fields)
- certificate username and `userPubkey` must match the request and persisted username record

---

## 6. Replication semantics

InterPoll separates two distinct guarantees that are often confused:

- **Tamper-evidence** is provided by the local hash-chain. Each block's `previousHash` links to the preceding block's `currentHash`, so any modification of a committed block breaks the chain and is immediately detectable.
- **Persistence and availability** depend on replication. The local chain exists only on the participant's device. GunDB peers/relays and WebSocket peer sync help spread copies, but data availability still depends on at least one honest peer, device, or relay retaining a copy and later reconnecting.

InterPoll does not promise mathematical immutability or guaranteed data availability under all adversarial conditions. It does provide **stronger practical persistence than a single-server system**:

- Chain history exists on each participant device.
- Content graph data replicates through GunDB peers/relays.
- New peers can be seeded from cached relay content and peer sync.

As long as at least some peers/devices retain data and later reconnect, history can be re-propagated. This is the core principle: sooner or later a peer with a copy will log back in and reseed the network.

**In short:** the system is *harder to erase* than a single-server platform, not *impossible to erase*.

### 6.1 Cold-start DB snapshot fallback behavior

When Gun bootstrap returns no community data, the client may request relay snapshot fallback via `/db/search` and `/db/soul` for namespace-scoped community hydration.

To avoid cross-type contamination from broad prefix scans, fallback ingestion accepts only canonical top-level community nodes:

- soul must match `{namespace}/communities/{id}` exactly
- community `id` in payload must match soul `{id}`
- accepted community IDs are canonical `c-*` slugs

Nested poll/post/index rows are ignored during community hydration.

---

## 7. Transport and Message Families

Core coordination messages:

- `register`, `join-room`
- `peer-list`, `peer-left`
- `new-block`, `new-event`
- `request-sync`, `sync-response`
- `server-list`, `peer-addresses`
- `chatroom-message` (opaque encrypted relay payload)

Two media:

1. **WebSocket relay** for cross-device fan-out.
2. **BroadcastChannel** for local tab fan-out.

Both carry compatible sync semantics so clients can process updates similarly regardless of path.

### 7.1 Integrity-sealed mutating requests

All mutating relay/API requests are integrity-sealed and verified with canonical hash + Schnorr signature + freshness + replay nonce + PoW checks.

- Sealed metadata: `_hash`, `_sig`, `_pub`, `_pow`, `_ts`, `_nonce`
- Verified paths include vote authorization/confirmation, receipt logging, and poll policy registration; vote authorization persists its short-lived reservation so a relay restart does not reopen the same authorization window.
- Invalid or stale envelopes are rejected (fail-closed)

---

## 8. Discovery and Multi-Relay Behavior

InterPoll is relay-fluid rather than relay-fixed:

- Clients maintain known relay endpoint sets.
- Endpoint sets are shared peer-to-peer.
- Discovery announcements are also published in Gun (`v3/server-config/discovery`).
- Runtime switching is supported by relay manager logic.

This reduces dependence on one host and supports community-run infrastructure.

---

## 9. Anti-Abuse Controls

The following mechanisms exist to reduce fraud and spam. They are **practical abuse mitigations**, not cryptographic Sybil resistance. A determined adversary with multiple devices or accounts can still attempt abuse; these controls raise the cost and complexity of doing so.

| Mechanism | What it does | What it does NOT guarantee |
|---|---|---|
| Device fingerprinting | Tracks per-device vote history locally and in the backend registry | Cryptographic uniqueness per human person |
| Backend vote authorization | Persisted relay registry (`pollId:identity`) plus strict two-phase authorize/confirm with reservation token; mutating requests require integrity-sealed envelopes; relay fails closed when poll policy is missing | Availability guarantee if relay is offline |
| Invite codes | Single-use per-poll access codes gated via GunDB | Resistance if invite codes are leaked |
| OAuth gating | Optionally requires Google/Microsoft login before voting; backend identity is derived from provider userinfo (not unverified JWT payload decode) | Anonymity or unlinkability of votes |
| Rate limits and bot scoring | Reduces automated spam | Guaranteed spam elimination |
| Proof-of-Work (optional) | Increases cost of high-frequency message floods | Mathematical Sybil resistance |

**What the anti-abuse layer does:**
- practical duplicate-vote prevention per device
- private poll access control via invite codes
- spam and bot mitigation
- backend authorization that fails closed (`unreachable/invalid response => not authorized`) with audit log

**What the anti-abuse layer does NOT provide:**
- cryptographic Sybil resistance (one vote per unique person)
- anonymity against the application origin or relay operator
- protection from a compromised or malicious frontend bundle
- guaranteed duplicate-vote prevention when the backend is offline and multiple devices are used

These controls should be deployed together for best effect. Community administrators can choose which layers to enable per poll.

> **Current implementation note:** poll `requireLogin` policy is persisted per relay and enforced fail-closed at vote time. This improves safety against bypasses, but cross-relay policy consistency is still an operational concern in decentralized deployments.

---

## 10. Interoperability Notes

An  implementation should support:

1. append-only local block persistence and hash-link validation,
2. WS/Broadcast sync messages (`new-block`, `request-sync`, `sync-response`, `new-event`),
3. Gun namespace compatibility under `v1-v2` or `v3`(for compatibility with official client) roots,
4. Nostr-style event signing/verification for supported kinds,
5. receipt generation and local receipt lookup semantics,
6. optional trust-issuer flow (`/public-key`, `/challenge`, `/claim`) with local certificate verification before claim persistence.

---

## 11. Relay Trust Assumptions

Since the architecture depends on WebSocket and GunDB relays, the following documents what a malicious or unavailable relay can and cannot do:

| Threat | Can a relay do this? | Client defence |
|---|---|---|
| **Censor propagation** | Yes — a relay can drop messages and refuse to forward blocks | Clients can connect to multiple relays; BroadcastChannel provides local-tab delivery without any relay |
| **Delay sync** | Yes — a relay can throttle or queue messages | Incremental sync re-requests from `lastIndex`, so delayed delivery is eventually resolved |
| **Hide events from some peers** | Yes — a relay can selectively deliver messages | Clients detect gaps in their local chain index and can re-request missing blocks |
| **Forge votes or actions** | No — all blocks are signed by the originating client keypair; a relay cannot produce a valid signature for a key it does not hold |  |
| **Corrupt local chains** | No — clients validate the full chain on ingest; a block with a broken hash link is rejected |  |
| **Detect inconsistent chain heads** | Yes — clients that receive conflicting chain heads can detect the inconsistency by comparing block hashes and chain lengths |  |

**Summary:** a relay can censor or delay, but it cannot forge or corrupt data that has been locally signed and hash-linked. Clients that connect to multiple relays are more resilient to relay-level censorship.

**Simple censorship-detection signals (client-observable):**
- **Local-vs-network mismatch:** a user sees a locally signed action in their chain, but peers connected to other relays do not see it after expected sync windows.
- **Persistent index gaps:** repeated missing block ranges (for the same peer/relay path) after incremental re-requests from `lastIndex`.
- **Divergent chain heads across relays:** one relay consistently reports a shorter or stale head while others progress.
- **Asymmetric visibility reports:** multiple users report that only clients behind a specific relay fail to receive certain posts/votes.

---

## 12. Browser App-Origin Trust Boundary

Even when network data is hash-linked and signature-protected, there are inherent limitations of the browser runtime that users and operators should understand:

- **What the backend can observe:** the relay server sees client IP addresses, connection metadata, vote authorization requests, and any unencrypted payloads sent over WebSocket. If OAuth is enabled, it can also see OAuth identity tokens.
- **What GunDB peers/relays can observe:** all GunDB-stored data (polls, posts, communities, user profiles, images) is stored in plaintext. Any GunDB relay that replicates the namespace can read this data.
- **Vote and action linkability:** all actions are associated with the device's persistent public key. A full observer (e.g. a relay that stores all traffic) can link all actions from the same device across polls.
- **Device fingerprint linkability:** the device ID is derived from browser properties. It is stable across sessions on the same device and browser profile.
- **Frontend bundle trust:** the integrity and privacy of all data processed in the browser depends on the frontend bundle being honest. A compromised or malicious frontend bundle could read private keys, exfiltrate votes before signing, or silently modify data. Users relying on the hosted version must trust the application origin.

---

## 13. Receipt Semantics

The receipt is one of the strongest parts of the protocol. The following defines precisely what a receipt proves and does not prove.

**A receipt proves:**
- a local vote/action was committed to the local hash-chain
- the action was included at a specific `blockIndex` in the chain
- the chain head at that time had a specific `chainHeadHash`
- the action was signed by the `pubkey` included in the receipt
- the `voteHash` matches the hash of the original vote payload

**A receipt does NOT prove:**
- global consensus or replication to any specific number of peers
- final inclusion across all relays or GunDB nodes
- long-term data availability (a receipt is only as durable as the chain that issued it)
- that the frontend was honest at the time of signing
- that the voter was unique or non-Sybil

The `verificationCode` field in the receipt is a short human-readable lookup code. It is **not** a BIP-39 wallet seed, not a private key, and not a recovery secret. It is safe to share as part of a receipt. Private signing keys are never included in a receipt.

---

## 14. Threat Model and Non-Goals

InterPoll currently does NOT guarantee:

- **Global consensus under adversarial partitions** — the protocol converges eventually, but does not guarantee agreement across all peers under adversarial network splits.
- **Mathematical data availability** — data persistence depends on at least one honest peer, device, or relay retaining a copy and later reconnecting.
- **Cryptographic Sybil resistance** — the anti-abuse mechanisms raise the cost of duplicate voting but do not provide one-human-one-vote guarantees.
- **Anonymity against the application origin** — the relay, GunDB nodes, and the application server can observe connection metadata, public keys, and stored content.
- **Protection from a malicious frontend bundle** — if the frontend served to the browser is compromised, all client-side guarantees may fail.
- **Censorship resistance if all known relays are blocked** — if all configured relays are unreachable and no BroadcastChannel peers are available, the network is inaccessible.
- **Permanent availability if no peer retains the data** — if no device, relay, or GunDB node retains a copy of a poll or block, that data is lost.

This is not a list of weaknesses — it is a precise statement of scope. The protocol is designed to be *harder to censor and tamper with* than a single-server platform. Stating these boundaries clearly makes the protocol easier to evaluate and extend.

---

## 15. Encrypted Communities and Private Spaces

InterPoll supports fully encrypted communities where the community name, description, rules, and all content (posts, polls, comments, and chat messages) are encrypted client-side before being stored in GunDB. This section documents how it works.

### 15.1 What gets encrypted

| Object | What is encrypted | Storage in GunDB |
|---|---|---|
| Community metadata | `name`, `displayName`, `description`, `rules[]` — stored as a single `encryptedMeta` blob | Public shell contains `isEncrypted: true`, member count, creator ID, and a `🔒 Private Community` placeholder |
| Posts | All post fields (title, body, author, images, Schnorr signature) — stored as `encryptedContent` blob | Public shell contains `🔒 Encrypted Post` title |
| Polls | Poll question, options, description — stored as `encryptedContent` blob | Public shell contains `🔒 Encrypted Poll` question |
| Comments | Comment text, author name/ID — stored as `encryptedContent` blob | Public shell contains `🔒 Encrypted comment` |
| Chat room metadata | Room name, description, creator ID — stored as `encryptedMeta` blob | Public shell contains `🔒 Encrypted Room` placeholder |
| Chat messages | Message text, sender ID and name — stored as `encryptedContent` blob | No plaintext content in GunDB |

A community's existence is always visible in GunDB (anyone can see `isEncrypted: true` and the member count). Only the content is hidden from non-members.

### 15.2 Encryption algorithm

All community/content encryption uses **AES-256-GCM** via the browser's Web Crypto API:

- A random 96-bit (12-byte) IV is generated per encryption operation and prepended to the ciphertext.
- The combined `IV (12 bytes) || ciphertext` is base64-encoded and stored as an `EncryptedBlob` string in GunDB.
- Decryption extracts the IV from the first 12 bytes of the decoded blob and uses AES-GCM's built-in authentication to detect tampering (any modification causes decryption to fail).

Each encrypted message/post also includes an **HMAC-SHA256 authentication tag** derived from the community AES key via HKDF (domain-separated with `'interpoll-hmac-auth-v1'`). This provides an additional anti-sabotage check independent of the GCM authentication tag.

### 15.3 Key distribution

There are two ways to join a private community, corresponding to two key distribution methods:

**Invite-link method (random key):**
1. The community creator generates a random AES-256 key via `crypto.subtle.generateKey`.
2. An invite URL is generated in the format `{origin}/join/community/{id}#{base64url-key}`.
3. The `#fragment` portion of the URL is **never sent to any server** — it exists only in the browser's URL bar.
4. The invitee visits the link, the key is extracted from the fragment, and used to decrypt the community.
5. The key is stored locally in IndexedDB via `KeyVaultService`.

**Password method (derived key):**
1. The creator sets a community password.
2. The AES-256 key is derived via PBKDF2-SHA-256 with 600,000 iterations and salt = the string literal `communityId + 'interpoll-v2'` (e.g. `c-bitcoin-interpoll-v2`). Note: this is simple string concatenation; community IDs are slugs (`c-{name}`) and the suffix `interpoll-v2` is a fixed domain separator, so collisions are not a practical concern with the slug format used.
3. Any peer who knows the password and community ID can independently derive the same key.
4. The derived key is stored locally in IndexedDB for future access.

### 15.4 Trust model for encrypted communities

| Actor | What they can observe |
|---|---|
| GunDB relays | Only encrypted blobs — they cannot read community content, names, or post data without the key |
| WebSocket relay server | Only encrypted blobs passed through; cannot read content |
| Uninvited peers | Can see that a community exists and its member count; cannot read metadata or content |
| Backend/API server | Same as GunDB relays — content is encrypted before being written to GunDB |
| Community members | Full plaintext after decryption using the stored key |

**Important limitations:**
- **The frontend must be trusted.** Encryption and decryption happen in the browser. If the frontend bundle is compromised, it could exfiltrate keys or plaintext before encryption.
- **Invite links must be shared securely.** An invite link in the URL fragment is invisible to servers, but is visible in the user's browser history and can be shared by copy-paste like any URL.
- **Key loss is permanent.** There is no key recovery mechanism. If a user loses their key (clears IndexedDB, changes browsers) and has no backup, they cannot decrypt community content.
- **Key revocation is not supported.** There is no mechanism to rotate the community key or revoke access for specific members. All members with the key retain permanent read access to all past content.

### 15.5 Metadata leakage notes (what remains visible)

Even with end-to-end content encryption, the system still leaks structural metadata that operators should model explicitly:

| Leakage surface | Visible to relays/observers | Why this matters |
|---|---|---|
| Community existence | Community ID and `isEncrypted: true` shell | Reveals that a private space exists even if content is unreadable |
| Membership/activity size | Member counts and rough object volume growth | Enables coarse inference of community growth and activity spikes |
| Timing metadata | Write timestamps and update cadence | Correlating burst times can reveal event windows (e.g., live discussions) |
| Social graph hints | Which encrypted communities a public user key appears to join | May reveal affiliation patterns even without plaintext access |
| Network metadata | IP addresses, connection/session metadata at relay layer | Can support traffic analysis or cross-service correlation by infrastructure operators |

Encryption protects payload confidentiality, not traffic-shape secrecy. InterPoll does not currently implement cover traffic, mixnet routing, or metadata-hiding replication.

### 15.6 Key storage

Keys are persisted in the browser's IndexedDB via `KeyVaultService` (`encryption-keys` store). Each stored key has:

```ts
{
  id: string,         // communityId, chatRoomId, or 'server' for server-wide keys
  type: 'community' | 'chatroom' | 'server',
  key: string,        // base64-encoded AES-256 key
  method: 'invite' | 'password',
  label: string,
  joinedAt: number
}
```

- `'community'` — key for a specific private community (covers its posts, polls, and comments).
- `'chatroom'` — key for a specific encrypted group chat room.
- `'server'` — key for server-wide encryption, used when an operator enables `encryptAll` in `ServerEncryptionConfig`, so all communities on that relay instance are encrypted under a single server-wide AES key derived from the operator-supplied `serverPassword`.

Keys can be exported as JSON for backup and imported on a different device or browser. `KeyManagementSection` in Settings provides this UI.

---

## 16. Reference Implementation Map

- Chain + sync orchestration: `src/stores/chainStore.ts`
- Chain logic: `src/services/chainService.ts`
- Transport: `src/services/websocketService.ts`, `src/services/broadcastService.ts`
- Discovery: `src/services/discoveryService.ts`
- Vote API client path: `src/services/auditService.ts`
- Relay ingress/egress: `relay-server.js`, `relay-server/relay-server-enhanced.js`
- Shared protocol validation helpers: `shared-validation/index.js`
- Encryption: `src/services/encryptionService.ts`, `src/services/keyVaultService.ts`
- Invite links: `src/services/inviteLinkService.ts`
- Private community CRUD: `src/services/communityService.ts` (`createPrivateCommunity`, `joinPrivateCommunity`, `decryptCommunityMeta`)
