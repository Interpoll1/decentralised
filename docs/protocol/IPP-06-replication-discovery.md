# IPP-06: Replication, Discovery, and Resilience

**Status:** Draft
**Version:** 1
**Supersedes:** `docs/protocol-whitepaper.md` v0.5 (§6, §7, §8)

Requirements language: see [[IPP-00-overview]].

---

## 1. Two guarantees, kept separate

Implementations MUST NOT conflate:

- **Tamper-evidence** — provided by the local hash-chain
  ([[IPP-03-domain-objects]] §3). Any modification of a committed block breaks
  the link and is detectable.
- **Persistence/availability** — provided only by *replication*. The local chain
  exists on one device; data survives only as long as at least one honest peer,
  device, or relay retains a copy and later reconnects.

InterPoll provides *stronger practical persistence* than a single-server system,
**not** mathematical availability.

## 2. Incremental sync

Clients synchronize the chain incrementally. A client MUST be able to request
missing history from a head index and accept only continuity-valid blocks:

```json
{ "type": "request-sync", "lastIndex": <local_head_or_-1> }
{ "type": "sync-response", "blocks": [ ... ] }
```

A block MUST be accepted only when chain continuity holds (or a valid genesis
bootstrap). The same sync semantics MUST be carried over both transports:

- **WebSocket relay** for cross-device fan-out.
- **`BroadcastChannel('interpoll-sync')`** for local same-origin cross-tab
  fan-out (no network, no relay).

## 3. Core coordination messages

A conforming node SHOULD understand the coordination message families:
`register`, `join-room`, `peer-list`/`peer-left`, `new-block`, `new-event`,
`request-sync`, `sync-response`, `server-list`, `peer-addresses`, and
`chatroom-message` (opaque encrypted payload). State-mutating messages MUST be
integrity-sealed ([[IPP-02-canonical-format]] §4); low-risk types MAY be exempt
([[IPP-08-anti-abuse]]).

## 4. Discovery — relay-fluid, not relay-fixed

A node MUST NOT depend on a single fixed relay. A conforming client SHOULD:

- maintain a set of known relay endpoints,
- learn new endpoints from peers via signed `server-list` broadcasts,
- **reject** unsigned/unverified peer-sourced endpoints (verify the seal before
  merging a learned endpoint),
- support runtime relay switching.

A secondary discovery channel MAY publish relay announcements in the content
graph (reference: `v3/server-config/discovery`, PoW-and-signature gated).

> **Current Implementation Note.** `websocketService.ts` holds
> `knownServers` (persisted to `localStorage`) and only merges `server-list`
> entries that pass `IntegrityService.verifySealedPayload`; `discoveryService.ts`
> provides the Gun-based rendezvous registry.

## 5. Bootstrap assumptions

A fresh peer needs an initial discovery path. Minimum to restart a network from
zero: at least one WebSocket relay and one content-graph (Gun) relay reachable by
a bootstrap peer. Any peer that retained local chain data can reseed once a relay
is reachable. If all relays are unreachable and no local (BroadcastChannel) peer
is present, the node MUST fall back to local-only operation and converge later.

### 5.1 Cold-start snapshot fallback

When content-graph bootstrap returns no community data, a client MAY request a
relay snapshot fallback (`/db/search`, `/db/soul`) scoped to the namespace. To
avoid cross-type contamination from broad prefix scans, fallback ingestion MUST
accept only canonical top-level community nodes: soul matches
`{namespace}/communities/{id}` exactly, the payload `id` matches the soul `{id}`,
and the id is a canonical `c-*` slug. Nested rows MUST be ignored during
community hydration.

## 6. Resilience escalation ladder

To survive relay degradation, a client SHOULD implement a tiered escalation from
most- to least-infrastructure-dependent, only escalating after a blackout grace
period:

1. **relay** — normal relay connectivity.
2. **gossip** — relay failover across the known-relay set + discovery refresh.
3. **rendezvous** — content-graph rendezvous on rotating souls.
4. **mesh** — direct WebRTC peer mesh, with manual/QR signaling as the
   last-resort bridge when no relay is reachable.

> **Current Implementation Note.** `resilienceService.ts` implements this ladder
> (blackout = `!wsConnected && !gunConnected && peerCount===0`, 30s grace) over
> `RelayManager`, `DiscoveryService`, and `MeshService`. The known-relay set it
> maintains is also the candidate pool for [[IPP-07-multi-relay-quorum]].

---

## Conformance checklist

- [ ] Tamper-evidence (chain) and availability (replication) are treated as separate guarantees.
- [ ] Incremental sync request/response is continuity-checked; identical semantics over WebSocket and BroadcastChannel.
- [ ] State-mutating coordination messages are integrity-sealed.
- [ ] Node maintains a multi-relay known set, learns endpoints only from verified signed `server-list` broadcasts, and supports runtime switching.
- [ ] Cold-start community hydration accepts only canonical top-level community souls.
- [ ] Node falls back to local-only operation when all relays are unreachable and converges on reconnect.
