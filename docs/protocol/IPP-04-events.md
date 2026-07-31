# IPP-04: Signed Events (Nostr-compatible)

**Status:** Draft
**Version:** 1
**Supersedes:** `docs/protocol-whitepaper.md` v0.5 (§4.4)

Requirements language: see [[IPP-00-overview]].

---

## 1. Event envelope

InterPoll uses a Nostr-compatible signed-event envelope for actions that need an
independently verifiable, replay-able record separate from the local chain:

```ts
{
  id: string,          // event id (hash of the serialized event)
  pubkey: string,      // author x-only pubkey, hex
  created_at: number,  // seconds (Nostr convention)
  kind: number,        // see §2
  tags: string[][],
  content: string,
  sig: string          // Schnorr signature over the event id
}
```

An event's `id` MUST be derived by hashing the canonical serialization of the
event's signable fields, and `sig` MUST be a Schnorr signature bound to that
`id`. A verifier MUST recompute `id` and verify `sig` against `pubkey` before
accepting an event.

> **Current Implementation Note.** `src/types/nostr.ts` defines
> `NostrEvent`/`UnsignedEvent`/`EventKind`; `src/services/eventService.ts`
> builds and verifies events (canonical-serialize → hash → sign). This envelope
> is Nostr-shaped for interoperability but InterPoll does not currently federate
> with the public Nostr relay network.

## 2. Event kinds

The following kinds are defined:

| Kind | Meaning |
|---|---|
| `100` | poll creation |
| `101` | vote cast |
| `102` | poll update |
| `103` | post creation |

A conforming implementation MUST preserve the meaning of these kinds and MUST NOT
reuse a number for a different meaning. New action types SHOULD claim a new kind
number in a future version of this document.

## 3. Vote-cast events (kind 101) as the tally substrate

Kind-`101` vote-cast events are the substrate for the authoritative tally of
[[IPP-03-domain-objects]] §5. Each vote SHOULD be recorded as a signed kind-101
event in addition to any mutable counter update, so tallies can be reconstructed
by deduplicating kind-101 events per signer pubkey (latest-timestamp-wins). This
is also the Byzantine backstop referenced by [[IPP-07-multi-relay-quorum]].

## 4. Relationship to chain blocks

A chain block MAY reference the event that produced it via `eventId`
([[IPP-03-domain-objects]] §3). The event and the block are complementary: the
block gives local tamper-evident ordering; the event gives a portable,
independently verifiable signed record that replicates through the content graph.

---

## Conformance checklist

- [ ] Events use the `{id, pubkey, created_at, kind, tags, content, sig}` envelope.
- [ ] `id` is recomputed and `sig` verified against `pubkey` before acceptance.
- [ ] Kinds 100/101/102/103 keep their defined meanings; numbers are not reused.
- [ ] Votes are recorded as signed kind-101 events to support the authoritative tally.
