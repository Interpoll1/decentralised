# IPP-03: Domain Objects

**Status:** Draft
**Version:** 1
**Supersedes:** `docs/protocol-whitepaper.md` v0.5 (§4)

Requirements language: see [[IPP-00-overview]].

Machine-readable schemas (normative): `docs/protocol/schemas/{poll,post,comment,vote}.v1.json`.
This document is the human-readable companion; where prose and schema disagree,
the schema is authoritative for field shape and the prose for semantics.

---

## 1. Object families

InterPoll defines five core object families. Each conforming object MUST validate
against its `*.v1.json` schema.

| Object | Plane | Schema |
|---|---|---|
| **Vote payload** | integrity (chain) | `vote.v1.json` |
| **Chain block** | integrity (chain) | §3 below |
| **Receipt** | integrity (chain) | §4 below |
| **Poll** | replication | `poll.v1.json` |
| **Post** | replication | `post.v1.json` |
| **Comment** | replication | `comment.v1.json` |

## 2. Authorship and signatures

A replicated object (Poll/Post/Comment) that is signed MUST carry `authorPubkey`
(the signer's x-only pubkey, hex) and `contentSignature` (a Schnorr signature).
Signed objects that use the versioned canonicalization MUST carry `canonVersion`
per [[IPP-02-canonical-format]] §6.

- **Post** signs `canonicalJSON({authorId, communityId, content, createdAt, title})`
  and tags `canonVersion: 2`.
- **Comment** signs `SHA-256(canonicalJSON({content, postId, communityId, timestamp: createdAt}))`
  and tags `canonVersion: 2`.

> **Current Implementation Note — poll signing is a known divergence.**
> `pollService.ts` signs a poll over
> `SHA-256(JSON.stringify({ question, communityId, timestamp }))` — an inline,
> non-canonical serialization that is **not** IPP-02 `canonicalJSON` and carries
> **no** `canonVersion` tag. Phase 1 consolidated post and comment
> canonicalization but did not touch poll signing (it was outside the approved
> scope). A conforming implementation SHOULD converge poll signing onto IPP-02 +
> `canonVersion`; until then, poll `contentSignature` is only interoperable with
> this exact inline form. This is tracked debt, not intended protocol.

## 3. Chain block

A chain block links the local append-only log. Fields:

```ts
{
  index: number,          // monotonic, starts at 0 (genesis)
  timestamp: number,
  previousHash: string,   // == prior block's currentHash
  voteHash: string,       // hash of the action/vote payload
  signature: string,      // Schnorr over {index, voteHash, previousHash}
  currentHash: string,    // hash of the block's own fields
  nonce: number,
  pubkey?: string,        // signer x-only pubkey; absent on legacy genesis
  eventId?: string,       // reference to the NostrEvent (IPP-04) that produced it
  actionType?: 'vote' | 'community-create' | 'post-create',
  actionLabel?: string
}
```

Rules a verifier MUST enforce on ingest:

- `index` is monotonically increasing with no gaps relative to local head.
- `previousHash` equals the prior block's `currentHash` (genesis uses the fixed
  genesis hash).
- `currentHash` recomputes correctly from the block's fields.
- `signature` verifies against `pubkey` over the signed subset, **unless** the
  block is a tolerated legacy/genesis block validated in a legacy path.
- timestamps are within bounded skew (reject far-future; guard large backward
  skew).

A block that fails these checks MUST be rejected (the chain fails closed).

> **Current Implementation Note.** `ChainService.validateBlock`/`validateChain`
> implement these; genesis is deterministic (shared timestamp+hash, unsigned) so
> fresh clients converge on the same index-0 block. `allowLegacy` tolerates old
> unsigned blocks only in sync/history validation paths.

## 4. Receipt

A receipt contains **public verification material only**. It MUST NOT contain any
private key, wallet seed, or recovery secret.

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
  verificationCode: string   // human-readable lookup code only
}
```

- `verificationCode` is a short human-readable lookup code (a 12-word BIP-39
  wordlist string in the reference client). It MUST NOT be treated as signing
  material and is safe to share. It is distinct from the 24-word identity phrase
  of [[IPP-01-identity]].

**A receipt proves** the action was committed to the local chain at a specific
`blockIndex` under a specific `chainHeadHash`, signed by `pubkey`, with `voteHash`
matching the vote payload. **A receipt does NOT prove** global consensus,
cross-relay inclusion, long-term availability, frontend honesty, or voter
uniqueness.

## 5. Vote tallying — counters are not CRDTs

Poll option counts (`PollOption.votes`, `Poll.totalVotes`, and post `score`) are
maintained by **client-side read-modify-write**, not by a convergent counter.
Concurrent writers can therefore race. Implementations MUST NOT treat these
mutable counters as authoritative vote totals.

For an authoritative tally, an implementation SHOULD aggregate the independently
signed vote-cast events (kind `101`, [[IPP-04-events]]) **deduplicated by signer
pubkey, latest-timestamp-wins**. This signed-event tally is the trustworthy lower
bound and the reconciliation ground truth referenced by [[IPP-07-multi-relay-quorum]].

> **Current Implementation Note.** `voteTallyService.ts` implements the signed
> kind-101 tally and flags Gun-reported totals as `looksInflated` when they
> exceed it. `pollService.ts` rewrites the whole options map on each vote (with
> retries) to reduce clobbering, but this is mitigation, not a guarantee.

## 6. The `voters` object-map encoding

`PollOption.voters` is a `string[]` in the application model but MUST be encoded
on the Gun wire as an **index-keyed object map** (`{"0":"voterId", "1":...}`),
because Gun cannot reliably store sparse arrays. Readers MUST reconstruct the
array from the object map; writers MUST emit the object map. See
`buildVotersMap`/`buildOptionsMap` in `pollService.ts`. The schema
(`poll.v1.json`) accepts both encodings.

## 7. Namespace and data versioning

Replicated objects live under a versioned namespace (`v3` today). A breaking
change to a replicated object's shape MUST be introduced under a new namespace or
schema version, never by mutating `v1` semantics in place. `Post.dataVersion`
records the namespace a post was read from; absence SHOULD be treated as the
current namespace.

---

## Conformance checklist

- [ ] Poll/Post/Comment/Vote objects validate against their `*.v1.json` schema.
- [ ] Signed replicated objects carry `authorPubkey` + `contentSignature`, and `canonVersion` when versioned.
- [ ] Chain blocks are hash-linked, index-monotonic, signature-checked, skew-bounded; invalid blocks are rejected.
- [ ] Receipts contain only public material; `verificationCode` is never signing material.
- [ ] Mutable vote counters are not treated as authoritative; authoritative tally derives from signed kind-101 events deduped by pubkey.
- [ ] `PollOption.voters` is encoded as an index-keyed object map on the wire and reconstructed on read.
- [ ] Breaking object-shape changes are introduced under a new namespace/version.
