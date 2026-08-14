# IPP-10: Direct Messages and Encrypted Chat Rooms

**Status:** Draft  
**Version:** 1  
**Supersedes:** `docs/protocol-whitepaper.md` v0.5 (§11)

Requirements language: see [[IPP-00-overview]].

---

## 1. Scope statement

This document specifies end-to-end encrypted direct messaging (DMs) between two peers and multi-peer encrypted group chat rooms over GunDB. Both use the same tamper-evident signed envelope to establish sender authorship. Scope excludes typing indicators, read receipts, and network-layer privacy (see limitations in §8).

---

## 2. Wire versions and backward compatibility

Chat messages evolve through wire format versions. A conforming implementation MUST decrypt and render all versions, but only v3 carries a cryptographic signature. Unsigned records are marked `verified: false` rather than discarded, so existing history remains readable.

| Version | Format | Signature | Nonce replay | Freshness | Marked |
|---|---|---|---|---|---|
| v1 | Ciphertext only (`encryptedForRecipient`, `encryptedForSender` as encrypted blobs) | No | N/A | N/A | unsigned |
| v2 | Hybrid encrypt (AES-256-GCM text + RSA-wrapped keys) | No | N/A | N/A | unsigned |
| v3 | Same ciphertext + signed envelope metadata | Yes ([§3](#3-signed-envelope)) | Ignored | Ignored | verified if sig OK |

A v1/v2 record still decrypts correctly; the ciphertext format is unchanged. An implementation MAY warn when rendering pre-v3 messages to encourage upgrades; a relay MAY reject v1/v2 writes to encourage migration. Clients MUST accept all three on read.

---

## 3. Signed envelope (wire v3)

Every v3 message carries six metadata fields that prove sender identity and message freshness. A sender writes these fields before encryption; the verifier reconstructs them from an explicit field list and never canonicalizes the raw record (see [[IPP-10-chat#why-the-signed-payload-is-rebuilt-rather-than-verified-in-place]]).

### 3.1 Envelope metadata fields

```ts
_ts: number;      // Timestamp when signed (milliseconds since epoch)
_nonce: string;   // Unique per-message UUID, covers both hash and signature
_sig: string;     // Schnorr signature over canonical payload
_pub: string;     // Signing public key (x-only secp256k1, 64 hex chars)
_hash: string;    // SHA-256 of canonical signed payload
_pow: string;     // Hashcash nonce proving work over _hash
```

All six MUST be present for a message to be considered signed. Missing any field demotes it to `unsigned` status.

### 3.2 Signed field sets (per-message kind)

**Direct messages** sign exactly these field names:

```
id, senderId, recipientId, timestamp, seq, cipherHash, replyTo, retracts
```

(Note: `replyTo` and `retracts` are optional; when absent, they are not included in the signed payload.)

**Group room messages** sign exactly these field names:

```
id, roomId, senderId, timestamp, seq, cipherHash
```

Values are read off the raw record by name. The signed object is rebuilt from this explicit list only — Gun metadata (soul, vector clock) and any other fields are ignored and never authenticated.

### 3.3 cipherHash construction

`cipherHash` MUST be `SHA-256(ciphertext | keyForRecipient | keyForSender)` where the three parts are joined with the literal character `|`. This protects the ciphertext and both wrapped RSA keys as one unit. Signing only the ciphertext would leave the keys unsigned, and an attacker could swap `keyForRecipient` to make a message undecryptable (silent denial-of-service) while the signature still verifies. Signing only the text (decrypted) would require decryption before verification, allowing a sender to forge plaintext for any other sender by encrypting a fabricated body.

---

## 4. Identity binding

A user id is an x-only secp256k1 public key (32 bytes, typically stored as 64 hex characters). This is established elsewhere in the InterPoll protocol (every user profile is keyed by `KeyService.getPublicKeyHex()`, the device signing keypair from [[IPP-01-identity]]).

**Binding rule:** When a message claims sender `senderId`, the verifier MUST check that `_pub === senderId`. This check requires no key directory or PKI — the claim and the key are the same string. A forged `senderId` cannot survive this without the corresponding private key, because the signature is keyed to `_pub`, and a signer/verifier mismatch fails verification.

---

## 5. Verification semantics (durable vs. live)

Chat records are read from storage (IndexedDB) and re-verified on every history load, weeks or months after being written. This differs from [[IPP-04-events]] and relay-message verification ([[IPP-02-canonical-format]] §4).

| Check | Performed? | Why |
|---|---|---|
| Signature validity | YES | Proves sender identity. Never expires. |
| PoW validity | YES | Raises replay cost. Recomputable on old records. |
| Freshness (`_ts` in 5-min window) | NO | Would reject all retained history. |
| Nonce uniqueness per session | NO | Same message is re-verified many times; nonce is reused. |

Verifiers MUST check signature and PoW, and MUST NOT enforce freshness or nonce replay. A relay MAY enforce stricter checks on live inbound traffic, but a relay cannot be trusted to drop all replays — a conforming client must handle it.

---

## 6. Why the signed payload is rebuilt rather than verified in place

Gun nodes carry metadata (`_`, `soul`, `vector clock`) appended by the protocol layer. A hostile writer can also inject arbitrary fields. If the verifier canonicalizes the raw record as-is, those fields fold into the hash and break verification. Additionally, a signer and verifier might disagree about which fields "count," leading to security bypasses.

**Solution:** The verifier rebuilds the signed object from an explicit field list (e.g., `id`, `senderId`, `timestamp`) and ignores everything else on the record. Fields not in the list are not signed, and callers are responsible for treating them as untrusted.

---

## 7. Key distribution and TOFU pinning

### 7.1 Chat public keys

Each user publishes an RSA chat public key at `users/{userId}/chatPublicKey` (base64 SPKI format). This node is world-writable in Gun — without pinning, an attacker can replace it and transparently MITM the conversation.

### 7.2 Trust-on-first-use (TOFU)

When a message arrives from a new peer, the client fetches that peer's `chatPublicKey`, verifies it is a valid RSA key, and stores it locally (keyed by `userId`). Subsequent messages from that peer are decrypted with the pinned key. If the peer's published key changes, the client detects the mismatch and blocks sends until the user accepts the rotation.

**Acceptance rule:** When the user accepts a key rotation, the old key is moved to a history record, the new key becomes the active pin, and any prior manual verification (`verifiedAt` timestamp) is cleared. This ensures that a manual safety-number verification does not survive an undetected key change.

### 7.3 Safety numbers

Both peers independently derive a deterministic 60-digit number from their two public keys. They read this number to each other out of band (voice call, in-person, etc.) and each calls `markVerified()` if they match.

**Derivation:**

1. Sort the two base64 keys lexicographically.
2. Concatenate with domain tag: `interpoll-safety-v1|` + sorted[0] + `|` + sorted[1].
3. Compute `SHA-256` of this string twice (once for groups 1–8, once more for groups 9–12).
4. For each 8-hex-char chunk of the digest, compute `chunk_int % 100000`, zero-padded to 5 decimal digits.
5. Format as 12 groups separated by spaces: `AAAAA BBBBB CCCCC DDDDD EEEEE FFFFF GGGGG HHHHH IIIII JJJJJ KKKKK LLLLL`.

Both peers compute the same number regardless of key order (by sorting before hashing), so this is verifiable out of band.

---

## 8. Room ID derivation and indexed discovery

### 8.1 DM room IDs

A direct-message room between peers A and B is identified by:

```
roomId = SHA-256(sorted(A, B) + '|interpoll-dm-v1').slice(0, 32)
```

This is a 32-character hex string, opaque to observers. The corresponding room node is `chats/{roomId}`, where messages are written and read.

**Privacy tradeoff:** Hashing the room ID prevents a relay from reading the plaintext participant list off the Gun graph. However, a relay observing *which rooms a user writes to* and *when* still learns:

- That a conversation exists (metadata leak not addressed).
- Message volume and timing patterns within that room.
- Correlation: if A publishes at time T and B's room ID is hashed together with A, a relay could infer A and B are talking, even without reading the ID.

Hashing does not hide traffic patterns; it makes participant recovery require guessing both user IDs rather than reading them off the key.

### 8.2 Encrypted room index

To discover conversations without scanning the global `chats` root (which materializes every room into memory), each user maintains an index under `users/{userId}/rooms`. Entries are written encrypted to the reader:

- The index entry for user A lists the peer id (e.g., B), encrypted under A's own RSA chat key (so A can decrypt it).
- The index entry for user B lists A, encrypted under B's RSA chat key (so B can decrypt it).

The index itself is world-readable, but the peer ids are opaque encrypted blobs. A relay cannot recover the conversation list without holding A's or B's private key.

---

## 9. PoW tiers and relay policy

### 9.1 Base difficulty

All signed chat messages carry a proof-of-work nonce `_pow` such that `SHA-256(_hash + ':' + _pow)` has at least 10 leading zero bits. Verifiers MUST recompute this and reject messages with insufficient PoW.

### 9.2 Cold-outreach tier

When a peer has no prior conversation history with a contact (cold outreach), the sender MAY increase the difficulty to 16 leading zero bits. This raises the spam cost for unsolicited messages without affecting established conversations.

**Important:** The verifier enforces only the base tier (10 bits). A sender cannot know how a recipient classifies them (verified, trusted, or stranger), so a sender cannot be sure which difficulty tier is expected. Verifiers that enforce the higher tier will silently reject cold-outreach attempts from honest senders. Verifiers MUST therefore accept any PoW ≥ base difficulty.

---

## 10. Forgery prevention (group rooms)

Group chat rooms are encrypted with a shared AES-256-GCM key (held by all members). The HMAC auth tag is keyed with this shared room key, which means any member can forge a tag for any other member's ID without the victim's private key.

Before v3 signatures, a member could publish a message under another member's name and all members would accept it. 

**Solution:** Room messages now carry the same per-sender signature as DMs (keyed to the sender's own identity keypair). A signed message is binding — the signature proves `senderId` authored it, not merely that someone in the room published it.

**Double check:** Decryption is allowed only after signature verification. The encrypted body contains a plaintext `senderId` field; if verified and that field disagrees with the signed outer `senderId`, the message is rejected. This prevents a member from signing honestly on the outside and lying inside the ciphertext.

---

## 11. Replay and message ordering

Messages are assigned a `seq` counter (per-sender, per-conversation) and a `timestamp`. A conforming implementation SHOULD order messages by `(timestamp, senderId, seq)` for consistent display across devices and network conditions.

Older clocks can lead to temporary message-order inversions, but causality is preserved within a sender's own stream via the `seq` counter.

---

## 12. Security considerations and limitations

This section documents threats that are mitigated by this protocol and threats that are not.

### 12.1 What this protocol defends against

- **Forgery of sender identity:** A forged `senderId` cannot survive signature verification without the corresponding private key. The signature cannot be stripped without breaking the entire message format.
- **Tampering with message content:** The ciphertext is covered by the signature via `cipherHash`; modifications are detected.
- **Impersonation via key injection:** TOFU pinning locks each peer's key after first use. A key-replacement attempt blocks sends until the user accepts the change.
- **Spam/flood from cold outreach:** Optional 16-bit PoW on unsolicited messages raises the cost of unsolicited DMs.

### 12.2 What this protocol does NOT defend against

- **Forward secrecy:** A compromised long-lived RSA identity key can decrypt all retained chat history. Rotations are TOFU-based; old keys are not destroyed. Keys are held in IndexedDB metadata indefinitely (they are the device's identity).
- **Group room membership revocation:** Encrypted group keys are never rotated. A member who leaves a room retains the room key and can decrypt all future messages unless the room is evacuated and re-keyed. This is a deliberate tradeoff — rotating keys would require all members to rekeying and re-encrypting the full history with GunDB consensus.
- **Typing indicators and read receipts:** These are sent unsigned and unencrypted as best-effort signals (`chat-typing`, `chat-read-receipt`). They can be spoofed and are ineligible for signatures because they are high-volume and transient. Do not rely on them for security.
- **Traffic analysis:** A relay observing which rooms a peer writes to and message volume/timing learns metadata. Room ID hashing makes participant recovery harder but does not hide that a conversation exists.
- **Metadata from IP/session:** Relay and network operators see IP addresses, session times, and connection patterns. Encryption protects only message content and wrapped keys.

### 12.3 Threat model boundaries

This protocol operates within the trust boundary defined by [[IPP-00-overview]] and the app's threat model (see README.md). A compromised browser, relay, or device cannot be defended by the protocol alone.

---

## Conformance checklist

- [ ] Chat messages use wire v1/v2/v3; v1/v2 records decrypt correctly and render marked `verified: false`.
- [ ] v3 messages carry all six envelope fields (`_ts`, `_nonce`, `_sig`, `_pub`, `_hash`, `_pow`); missing any demotes to `unsigned`.
- [ ] Signed field sets are DM (`id, senderId, recipientId, timestamp, seq, cipherHash, replyTo, retracts`) and room (`id, roomId, senderId, timestamp, seq, cipherHash`).
- [ ] `cipherHash = SHA-256(ciphertext | keyForRecipient | keyForSender)`.
- [ ] Sender identity is verified via `_pub === senderId` (no key directory needed).
- [ ] Verification is durable: signature and PoW checked, freshness and nonce-replay ignored.
- [ ] Signed payload is rebuilt from explicit field list; Gun metadata and injected fields are ignored.
- [ ] Chat public keys use TOFU pinning; key rotation blocks sends until user acceptance, clearing prior verification.
- [ ] Safety numbers are derived deterministically from sorted keys with domain tag `interpoll-safety-v1`, formatted as 12 groups of 5 decimal digits.
- [ ] DM room IDs are opaque: `SHA-256(sorted(A, B) + '|interpoll-dm-v1').slice(0, 32)`.
- [ ] Room index entries encrypt peer IDs to individual readers via `sealSmall` (RSA-OAEP, one reader).
- [ ] Base PoW difficulty is 10 bits; cold-outreach MAY use 16 bits; verifiers enforce base tier only.
- [ ] Group room messages carry per-sender signatures; encrypted sender ID is checked against outer signature.
- [ ] The frontend-trust, forward-secrecy, no-revocation, and metadata-leak limitations are disclosed.
