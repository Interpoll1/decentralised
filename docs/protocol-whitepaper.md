# InterPoll Protocol (IPP) Whitepaper

**Version:** 1.0
**Status:** Official

> Implementation-aligned specification of how InterPoll stores, signs, syncs and
> verifies polls, posts, comments, communities and chat — entirely peer-to-peer,
> with no backend, on top of **GenosDB**.

---

## 1. Ethos

A voice for everyone, with records that are harder to erase. InterPoll has no
owner and no server: data lives on participants' devices and replicates directly
between peers. Authority comes from cryptographic signatures, not from a company.

## 2. What the protocol is

InterPoll is a set of conventions over **GenosDB**, a peer-to-peer graph database:

- **Identity** is an Ethereum-style key pair managed by the GenosDB Security
  Manager (SM), protected on-device by a WebAuthn passkey or a BIP39 mnemonic.
- **State** is a graph of signed nodes (polls, votes, posts, comments,
  communities, memberships, chat, profiles, receipts, images).
- **Authenticity** is guaranteed by the SM: every operation is signed by its
  author and verified by every receiving peer before it is applied.
- **Ordering** uses a Hybrid Logical Clock (HLC) for deterministic, causal
  conflict resolution.
- **Transport** is WebRTC (GenosRTC) with decentralized Nostr relays used only
  for peer discovery (signaling) — never for application data.

## 3. Why it is unique

- **No backend.** No application server, no relay to run, nothing to seize.
- **Signed by default.** Forgery is impossible without the author's device key.
- **Race-free counting.** Each vote is its own signed node; tallies are derived,
  so concurrent votes never overwrite a shared counter.
- **Offline-first.** Actions persist locally (OPFS) and sync on reconnect.

## 4. Protocol objects

All objects are GenosDB nodes with an `id`, a JSON `value`, optional `edges`, and
an HLC `timestamp`. The `type` field discriminates them:

| Type | Key convention | Notes |
|---|---|---|
| `poll` | `poll-<ts>-<rand>` | options stored without counts |
| `vote` | `<pollId>:<address>` | one signed vote per identity; re-voting updates it |
| `post` | `post-<ts>-<rand>` | community content |
| `postVote` | `postVote:<postId>:<address>` | up/down, one per identity |
| `comment` | `comment-<ts>-<rand>` | threaded via `parentId` |
| `commentVote` | `commentVote:<commentId>:<address>` | one per identity |
| `community` | `c-<slug>` | `rules` is a native array on the node |
| `membership` | `member:<communityId>:<address>` | member count derived |
| `chatRoom` / `chatMessage` | `room-…` / `msg-…` | AES-encrypted |
| `dm` | `msg-…` (roomId = sorted pair) | RSA-encrypted 1:1 |
| `user` | the signing address | profile keyed by identity |
| `chainAction` / `receipt` | content hash / `receipt:<code>` | tamper-evident log |
| `image` | `img-<ts>-<rand>` | compressed base64 payload |
| `trustIssuer` / `username` | `trustIssuer:<domain>` / `username:<name>` | verified identities |
| `inviteCode` | `invite:<pollId>:<code>` | single-use, private polls |

## 5. Identity and signing

On first use the app calls `db.sm.startNewUserRegistration()` to mint an
identity, then protects it with a passkey (`protectCurrentIdentityWithWebAuthn`)
or lets the user keep a mnemonic. The private key never leaves the device.

The SM signs every `db.put`/`db.remove` and attaches the author's address.
Receiving peers verify the signature (and RBAC permissions) before applying the
operation — enforced locally by each peer, so a tampered client cannot make
honest peers accept forged actions.

## 6. End-to-end flow (a vote)

1. The client writes a `vote` node keyed `<pollId>:<address>` — one per identity.
2. The SM signs it; the node persists to OPFS immediately (works offline).
3. GenosRTC propagates the node to connected peers; each verifies the signature.
4. The poll tally is **derived** by aggregating that poll's `vote` nodes via
   `db.map({ query: { type: 'vote', pollId } })` — no shared counter is mutated.
5. A `receipt` node records a short verification code for the Chain Explorer.

## 7. Replication semantics

- **Conflict resolution:** HLC gives every operation a partially-ordered
  timestamp; last-write-wins is deterministic and identical on every peer.
- **Delta sync:** peers exchange only missing operations (an operation log) and
  fall back to full-state when needed (hybrid delta protocol).
- **Persistence:** a dedicated Web Worker writes the compressed graph to OPFS
  (IndexedDB fallback) with serialized, corruption-safe access.
- **Cross-tab:** BroadcastChannel keeps multiple tabs of the same origin in sync.

## 8. Transport and discovery

- **Data plane:** WebRTC data channels between peers (GenosRTC).
- **Signaling:** decentralized Nostr relays are used only to help peers find each
  other. They never see application data.
- **Scale:** an optional **Cellular Mesh** organizes peers into cells with bridge
  nodes, reducing connections from O(N²) to O(N) for large communities.

## 9. Anti-abuse controls

- **One identity, one vote** per poll (deterministic node id) and per post/comment.
- **Signed operations** make impersonation infeasible.
- **Single-use invite codes** gate voting on private polls (`inviteCode` nodes).
- **Content moderation** (word lists, karma thresholds) is applied client-side.
- **Verified usernames** (optional) via external trust issuers raise the trust
  tier of an identity; see §12.

## 10. Receipt semantics

Voting produces a `receipt` node holding a 12-word verification code and the
content hash of the action. Anyone can re-enter the code in the Chain Explorer to
confirm the action exists and is unchanged. Receipts are part of the synced graph.

## 11. Encrypted communities and private spaces

Private communities, group chat rooms and direct messages encrypt their content
in the browser:

- **Group spaces** (communities, chat rooms) use a shared AES-256-GCM key
  distributed via an invite link or password; only the encrypted blob is stored
  on the node, and the key lives in a local key vault (`KeyVaultService`).
- **Direct messages** are encrypted per-recipient with RSA-OAEP; both encrypted
  copies (for sender and recipient) are stored so each can read their history.

Peers replicate ciphertext; without the key, content is unreadable.

## 12. Verified identities (trust issuers)

A username can be claimed unverified (a `username` node), or verified by an
external trust issuer: the user solves a proof-of-work challenge and embeds the
issuer's signed certificate. Any peer re-verifies the certificate against the
issuer's published public key (`trustIssuer` node). This layer is optional.

## 13. Threat model and non-goals

- Data survives as long as **one honest peer** keeps a copy and reconnects.
- A signature **cannot be forged** without the device key; peers reject invalid
  operations.
- One-identity-one-vote and invite codes **raise the cost** of duplicate voting;
  they are not a one-human-one-vote mathematical guarantee.
- Lost keys are unrecoverable (no central reset).

## 14. Reference implementation map

| Concern | Where |
|---|---|
| Database instance, identity, network status | `services/gdbServices.ts` |
| Reactive identity / onboarding | `stores/authStore.ts`, `components/OnboardingModal.vue` |
| Polls & voting | `services/pollService.ts`, `stores/pollStore.ts` |
| Posts / comments | `services/postService.ts`, `services/commentService.ts` |
| Communities (+ private) | `services/communityService.ts`, `stores/communityStore.ts` |
| Chat (rooms + DMs) | `services/chatRoomService.ts`, `services/chatService.ts` |
| Integrity log / receipts | `stores/chainStore.ts` |
| Verified usernames | `services/trustService.ts` |
| Encryption / key vault | `services/encryptionService.ts`, `services/keyVaultService.ts` |
| Images | `services/ipfsService.ts` |
| Search | `services/searchService.ts` |
