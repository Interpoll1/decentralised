# IPP-07: Multi-Relay Vote Quorum

**Status:** Proposed (design only — not implemented)
**Version:** 0 (draft design)
**Depends on:** [[IPP-01-identity]], [[IPP-02-canonical-format]], [[IPP-05-vote-flow]], [[IPP-06-replication-discovery]]

Requirements language: see [[IPP-00-overview]]. Because this document is
**Proposed**, its MUST/SHOULD statements describe the *target* design a future
implementation is expected to satisfy; nothing here is implemented yet.

---

## 1. Problem

[[IPP-05-vote-flow]] §4 establishes the gap precisely: the two-phase
authorize/confirm flow places duplicate-vote bookkeeping entirely under one relay
operator's control. A malicious or compromised relay can issue two valid
reservations for the same `identityKey`, or commit a vote it never authorized.
Content signatures prevent forging *what* was voted, not *whether an identity
already voted*. This is a single-point-of-trust problem, structurally similar to
needing agreement across independent parties.

## 2. Goal

No single relay should be able to unilaterally let one `identityKey` cast two
accepted votes on the same poll — **while** single-relay deployments (the common
case today) degrade gracefully to exactly the current behavior. The design must
be **additive**: existing single-relay relays and un-upgraded relays must keep
working unchanged.

## 3. Relay identity (new requirement)

Each participating relay MUST have its own Schnorr keypair (its **relay
identity**), analogous to the actor keypair of [[IPP-01-identity]] and reusing
the same `CryptoService` primitives. A relay SHOULD generate it once at startup
and expose the public key via a new endpoint:

```
GET /api/relay-info  →  { relayPubkey: string, mode: 'standalone' | 'quorum', ... }
```

Clients and peer relays use `relayPubkey` to verify relay-signed reservations
(§5). How relay pubkeys become *trusted* is an open question (§8).

## 4. Quorum set selection (client side)

A client selects a **quorum set** of `N` relays from its known-relay pool —
reusing the `knownServers` map and signed `server-list` / rendezvous discovery of
[[IPP-06-replication-discovery]] (no new discovery mechanism). Defaults:

- `N` = 3 preferred; the client SHOULD prefer freshest/most-recently-confirmed
  endpoints.
- Quorum threshold `M` = 2-of-3 by default.
- **Degrade:** if fewer than `N` relays are known/reachable, the client reduces
  `N` toward 1. At `N = 1`, `M = 1` and the flow is identical to today's
  single-relay path (§7).

The exact `M`/`N` are configuration, not fixed protocol; the invariant is that
**no single relay's authorize/confirm response is trusted alone** whenever `N > 1`.

## 5. Authorize phase (quorum)

The client sends the same integrity-sealed `vote-authorize` request to all `N`
relays in parallel. Each relay independently computes its own `identityKey` and
consults its own registry exactly as today (**no change to a relay's internal
authorize logic**). A relay that agrees to reserve MUST sign its reservation with
its **relay identity** (§3), producing a relay-signed reservation token bound to
`{identityKey, pollId, reservationId, expiresAt}`.

The client collects **M-of-N** relay-signed reservations as its *authorize
quorum proof*. If fewer than `M` agree (some report "already voted", some
unreachable), the client MUST NOT proceed — this is the prevented-double-vote
outcome, surfaced as a normal rejection.

## 6. Confirm phase (quorum)

The client submits `vote-confirm` to each relay in the quorum set, **attaching the
full M-of-N set of relay-signed reservations**. Each relay, before committing,
MUST additionally verify that the attached proof contains signatures from at least
`M` distinct, recognized relay pubkeys, all referencing the *same*
`identityKey`/`pollId`/`reservationId`. A relay MUST refuse to commit on its own
say-so alone when operating in `quorum` mode.

## 7. Backstop: signed-event tally (the real ground truth)

The quorum handshake **reduces** the double-vote window; it does not need to be
perfectly Byzantine-fault-tolerant, because the authoritative tally is derived
from client-signed kind-101 vote-cast events ([[IPP-04-events]], [[IPP-03-domain-objects]] §5),
deduplicated by signer pubkey. Even if a relay lies or the handshake races, the
signed-event tally is what clients ultimately reconcile against. Implementations
MUST reconcile displayed results against this tally and MUST NOT present a relay's
registry state as authoritative over it. This backstop is why the design is sound
even though it is not full BFT.

## 8. Graceful degradation and compatibility

- **Standalone relays.** A relay configured `mode = standalone` MUST treat a
  missing quorum proof, or a proof of size 1 containing only its own signature, as
  valid (`M = 1`). No existing single-relay deployment changes anything.
- **Un-upgraded relays.** A relay that does not implement quorum verification MUST
  simply ignore the extra confirm field (it is an additive, non-breaking schema
  field per [[IPP-03-domain-objects]] §7). Quorum protection activates only once
  enough relays in a deployment's peer set upgrade — the same advisory-then-
  enforcing rollout shape used elsewhere.

## 9. Open questions (for the implementation IPP)

These MUST be resolved before an implementation branch:

- **Relay-pubkey trust bootstrap** — a mini-PKI problem. A starting point is to
  reuse the centralized-issuer trust model of [[IPP-08-anti-abuse]] (verified
  usernames) for "which relay pubkeys a client trusts", rather than inventing a
  new trust mechanism.
- **Quorum-set persistence** — how a client persists and refreshes its chosen
  quorum set across sessions.
- **Gossiped proofs** — whether quorum proofs should be gossiped through the
  content graph (as `server-list` broadcasts already are) so relays can detect
  disagreement even without a client submitting a cross-checking confirm.
- **Latency/UX** — parallel `N`-relay round trips add latency to a
  latency-sensitive flow; mitigate with race-to-`M`-of-`N` (not wait-for-all) and
  the 30s blackout grace pattern from [[IPP-06-replication-discovery]].

## 10. Security note (do not oversell)

This design **raises the cost of cheating and provides after-the-fact detection**;
it is **not** full Byzantine fault tolerance. A relay can still lie about proofs
it received; the signed-event tally (§7) — not the handshake — is the actual
backstop against a lying relay. This document MUST be pinned down with concrete
`M`/`N`, proof formats, and trust bootstrap before any implementation.

---

## Conformance checklist (target design)

- [ ] Each participating relay has a Schnorr relay identity exposed via `/api/relay-info`.
- [ ] Client selects an `N`-relay quorum set from the verified known-relay pool; no single relay trusted alone when `N > 1`.
- [ ] Authorize collects M-of-N relay-signed reservations; fewer than `M` ⇒ vote rejected.
- [ ] Confirm attaches the M-of-N proof; quorum-mode relays verify ≥`M` distinct recognized relay signatures over the same identity/poll/reservation before committing.
- [ ] Results reconcile against the signed kind-101 tally, which overrides relay registry state.
- [ ] Standalone and un-upgraded relays remain fully functional (additive, non-breaking).
