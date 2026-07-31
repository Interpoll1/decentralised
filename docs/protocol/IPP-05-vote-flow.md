# IPP-05: Vote Flow

**Status:** Draft
**Version:** 1
**Supersedes:** `docs/protocol-whitepaper.md` v0.5 (§5.2, §11)

Requirements language: see [[IPP-00-overview]].

---

## 1. Local write path

When a user votes, a client MUST, in order:

1. Construct the vote payload (`vote.v1.json`, [[IPP-03-domain-objects]]).
2. Build a new local chain block linking `previousHash → currentHash`.
3. Persist block and vote locally.
4. Generate and persist a receipt.
5. Broadcast the new block/event for peer synchronization ([[IPP-06-replication-discovery]]).

Steps 1–4 MUST complete locally regardless of network availability. A vote is
recorded in the local chain even with no relay reachable; cross-device sync
resumes on reconnect.

## 2. Local duplicate-vote check

Before accepting a new vote for a poll, a client MUST check whether the current
identity has already voted on that poll. Identity precedence for this check MUST
be **pubkey-primary with deviceId fallback**: a stored vote record matches the
current voter when the pubkeys match (both present) **or**, failing that, when the
deviceIds match. This precedence MUST match the relay's `identityKey` construction
(§3) so client and relay agree on "the same voter".

> **Current Implementation Note.** `VoteTrackerService.hasVoted` /
> `getVoterIdentity` implement this (Phase 2). Legacy records carrying only a
> deviceId still block re-votes; new records store both `deviceId` and `pubkey`.

## 3. Two-phase relay authorization

For duplicate protection at the relay, a client MUST use a strict two-phase flow:

1. **`/api/vote-authorize`** — the relay computes an `identityKey`
   (`pollId:pubkey`, falling back to `pollId:deviceId`; for `requireLogin` polls,
   `pollId:oauth:provider:subject`), checks its vote registry and pending
   reservations, and — if the identity has not voted — issues a short-lived,
   HMAC-signed **reservation token**.
2. **`/api/vote-confirm`** — the client presents the reservation token; the relay
   re-validates its HMAC, expiry, and identity match, then commits the
   `identityKey` into its persisted vote registry.

Both requests MUST be integrity-sealed ([[IPP-02-canonical-format]] §4). A relay
MUST fail closed: an unreachable or invalid authorization MUST be treated as
"not authorized". The reservation MUST be persisted so a relay restart does not
reopen the same authorization window.

> **Current Implementation Note.** Implemented in
> `relay-server/relay-server-enhanced.js` (`reserveVoteSlot`, `commitVoteSlot`,
> `handleVoteCommit`) using `VOTE_RESERVATION_SECRET` for the HMAC and an
> in-memory `pendingVoteReservations` map with a persisted `voteRegistry`.

## 4. Single-relay trust limitation (normative scope statement)

The two-phase flow of §3 places the duplicate-vote bookkeeping entirely under
**one** relay operator's control. Client content signatures ([[IPP-02-canonical-format]])
prevent a relay from forging *what* was voted, but they do **not** prevent a
malicious or compromised relay from issuing two valid reservations for the same
`identityKey`, or from committing a vote it never authorized. Implementations and
operators MUST treat single-relay vote bookkeeping as a **trust assumption**, not
a cryptographic guarantee.

A conforming client SHOULD, where multiple independent relays are available,
reduce this trust using the multi-relay quorum extension of
[[IPP-07-multi-relay-quorum]]. Deployments that run a single relay accept this
limitation by design.

## 5. Relay trust boundary (what a relay can/cannot do)

| Threat | Relay can? | Client defence |
|---|---|---|
| Censor / drop propagation | Yes | Connect to multiple relays; BroadcastChannel local delivery; detect via §6 signals |
| Delay sync | Yes | Incremental re-request from `lastIndex` ([[IPP-06-replication-discovery]]) |
| Hide events from some peers | Yes | Detect index gaps, re-request |
| **Forge a vote/action** | **No** | Blocks/events are client-signed; relay cannot produce a valid signature |
| **Corrupt a local chain** | **No** | Clients validate hash-links on ingest and reject breaks |
| **Double-issue vote authorization** | **Yes (single-relay)** | [[IPP-07-multi-relay-quorum]]; signed kind-101 tally backstop |

## 6. Client-observable censorship signals

A client SHOULD surface these signals: local-vs-network mismatch (a locally
signed action peers behind other relays never see), persistent index gaps after
re-requests, divergent chain heads across relays, and asymmetric visibility
reports across users.

---

## Conformance checklist

- [ ] Local vote write (payload → block → persist → receipt) completes without network.
- [ ] Duplicate-vote check uses pubkey-primary, deviceId-fallback precedence matching the relay's identityKey.
- [ ] Vote uses two-phase authorize→confirm; both requests are integrity-sealed; relay fails closed; reservation persists across restart.
- [ ] Single-relay vote bookkeeping is treated as a trust assumption, not a guarantee.
- [ ] Clients cannot rely on a relay to forge/corrupt signed data (it cannot), but must assume it can censor/delay/double-authorize.
