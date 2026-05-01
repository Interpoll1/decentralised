# InterPoll Protocol(IPP) Whitepaper
 
**Version:** 0.2  
**Status:** Official 


---

## 1. Ethos

InterPoll is built on a simple principle: **a voice for everyone, with records that are hard to impossible to erase**.

The protocol is designed so participation does not depend on a single central database. Votes and civic activity are written locally, propagated peer-to-peer, and replicated across distributed storage. In practice, this means discussion and voting history can survive outages, server churn, and total censorship as long as some peers/devices retain data and later reconnect.

We found that other social media platforms censor a lot, and even if not, shadow-ban it. In our case, anyone can create his algorithm.

Our motto is: **"101 % Uptime!!!"**

---

## 2. What the Protocol Is

InterPoll is a the first fully peer-to-peer social protocol, made from three cooperating planes:

1. **Integrity plane (local chain):** each client keeps an append-only hash-linked log of actions/votes in IndexedDB.
2. **Replication plane (GunDB):** polls, communities, posts, comments, users, and media metadata replicate as distributed graph data.
3. **Coordination plane (WS + BroadcastChannel):** peers discover each other and synchronize new blocks/events quickly across devices and tabs.

The protocol remains usable when parts of the network are unavailable, then converges when connectivity returns. It can even survive without any network at all, as long as devices can keep their local history and later reconnect to peers.

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

```ts
{
  blockIndex: number,
  voteHash: string,
  chainHeadHash: string,
  mnemonic: string, // BIP-39
  timestamp: number,
  pollId: string
}
```

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

### 5.2 Vote write path

When a user votes:

1. Vote payload is created.
2. A new local chain block is built (`previousHash` -> `currentHash` link).
3. Block and vote are persisted locally.
4. A receipt is generated and stored.
5. New block/event are broadcast for peer synchronization.
6. Optional backend confirmation path can mark vote registry state for duplicate protection.

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

---

## 6. Replication semanticcs

InterPoll does not promise mathematical immutability across all adversarial conditions. It does provide strong practical persistence through replication:

- Chain history exists on each participant device.
- Content graph data replicates through Gun peers/relays.
- New peers can be seeded from cached relay content and peer sync.

As long as at least some peers/devices retain data and later reconnect, history can be re-propagated. This is the core principle: sooner or later a peer with a copy will log back in and its back up.

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

---

## 8. Discovery and Multi-Relay Behavior

InterPoll is relay-fluid rather than relay-fixed:

- Clients maintain known relay endpoint sets.
- Endpoint sets are shared peer-to-peer.
- Discovery announcements are also published in Gun (`v3/server-config/discovery`).
- Runtime switching is supported by relay manager logic.

This reduces dependence on one host and supports community-run infrastructure.

---

## 9. Guardrails in case

Security/abuse controls exist but are not the protocol’s identity:

- optional vote authorization/confirm API flow
- optional OAuth gating for voting
- optional invite-code gating for private polls
- rate limits, bot scoring, and PoW on selected message classes

These are up to you, and need to be made in the context of being interoperable with this whitepaper.

---

## 10. Interoperability Notes

An  implementation should support:

1. append-only local block persistence and hash-link validation,
2. WS/Broadcast sync messages (`new-block`, `request-sync`, `sync-response`, `new-event`),
3. Gun namespace compatibility under `v1-v2` or `v3`(for compatibility with official client) roots,
4. Nostr-style event signing/verification for supported kinds,
5. receipt generation and local receipt lookup semantics.

---

## 11. Reference Implementation Map

- Chain + sync orchestration: `src/stores/chainStore.ts`
- Chain logic: `src/services/chainService.ts`
- Transport: `src/services/websocketService.ts`, `src/services/broadcastService.ts`
- Discovery: `src/services/discoveryService.ts`
- Vote API client path: `src/services/auditService.ts`
- Relay ingress/egress: `relay-server.js`, `relay-server/relay-server-enhanced.js`
- Shared protocol validation helpers: `shared-validation/index.js`

