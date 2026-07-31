# IPP-00: InterPoll Protocol Overview

**Status:** Draft
**Version:** 1
**Supersedes:** `docs/protocol-whitepaper.md` v0.5 (§1–3, §16)

---

## Requirements language

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHALL**, **SHALL NOT**,
**SHOULD**, **SHOULD NOT**, **RECOMMENDED**, **MAY**, and **OPTIONAL** in the
IPP document series are to be interpreted as described in
[RFC 2119](https://www.rfc-editor.org/rfc/rfc2119). They appear in uppercase
only when used in this normative sense.

Each document separates two kinds of statement:

- **Normative** text (using the keywords above) defines what any conforming
  implementation must do to interoperate.
- **Current Implementation Note** callouts describe what *this* codebase does
  today — including known deviations and technical debt. They are informative,
  not binding, and may change without a protocol version bump.

Every document ends with a **Conformance checklist** enumerating its MUST-level
requirements, so an independent implementation has a literal list to test
against.

---

## 1. Ethos

InterPoll exists to give **a voice to everyone, with records that are harder to
erase than on any single-server system**. Participation MUST NOT depend on a
single central database: actions are written locally, propagated peer-to-peer,
and replicated across distributed storage, so discussion and voting history can
survive outages, server churn, and censorship attempts — provided at least one
honest peer, device, or relay retains a copy and later reconnects.

The protocol does **not** claim mathematical immutability or guaranteed
availability. It provides *stronger practical persistence* than a single-server
platform. See [[IPP-05-vote-flow]] and IPP threat-model text for exact scope.

## 2. The three planes

A conforming InterPoll node is organized into three cooperating planes:

1. **Integrity plane (local chain).** An append-only, hash-linked log of
   actions/votes held locally (IndexedDB in the reference client). Provides
   tamper-evidence. Specified in [[IPP-03-domain-objects]] and the chain-block
   rules therein.
2. **Replication plane (content graph).** Polls, communities, posts, comments,
   user profiles, and media metadata replicate as distributed graph data under
   a versioned namespace (`v3` today). Specified in [[IPP-03-domain-objects]]
   and [[IPP-06-replication-discovery]].
3. **Coordination plane (peer sync).** Peers discover each other and synchronize
   new blocks/events over a real-time transport (WebSocket relay) and, within a
   browser, across tabs (BroadcastChannel). Specified in
   [[IPP-06-replication-discovery]].

A node MUST remain usable when parts of the network are unavailable and MUST
converge when connectivity returns.

## 3. Document index

| Doc | Title | Status |
|---|---|---|
| [[IPP-00-overview]] | Overview, requirements language, index | Draft |
| [[IPP-01-identity]] | Keypair identity, backup/restore, migration | Draft |
| [[IPP-02-canonical-format]] | Canonical JSON + integrity envelope | Draft |
| [[IPP-03-domain-objects]] | Poll / Post / Comment / Vote / Block schemas | Draft |
| [[IPP-04-events]] | Nostr-compatible signed events (kinds 100–103) | Draft |
| [[IPP-05-vote-flow]] | Two-phase vote authorize/confirm | Draft |
| [[IPP-06-replication-discovery]] | Sync, discovery, resilience ladder | Draft |
| [[IPP-07-multi-relay-quorum]] | Multi-relay vote quorum | **Proposed** |
| [[IPP-08-anti-abuse]] | PoW, rate limiting, replay, dedup | Draft |
| [[IPP-09-encrypted-communities]] | AES-256-GCM private spaces | Draft |

## 4. Versioning

Each IPP document is versioned independently via its `Version` header. A
breaking change to a wire format MUST be introduced as a new version alongside
the old (e.g. a new schema file, a bumped Gun namespace, or a `canonVersion`
tag) rather than mutating an existing definition in place — see
[[IPP-02-canonical-format]] and [[IPP-03-domain-objects]].

---

## Conformance checklist

- [ ] Node organizes behavior into the three planes (integrity / replication / coordination).
- [ ] Node remains usable during network unavailability and converges on reconnect.
- [ ] Node does not require a single central database for participation.
- [ ] Breaking wire-format changes are introduced additively (new version), never by mutating an existing definition.
