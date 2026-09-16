# Group security v1 (F11/F21)

Status: implementation contract; tests establish only the properties they exercise.

## Authority and identity

Room/group identity is `g1:<owner account Schnorr public key>:<owner device UUID>:<random UUID>`. A room route is the trust anchor: it fixes the expected owner account and device before discovery. The account authorizes the existing P-256 device signing/ECDH identity using the DM v1 DeviceBinding and its account signature. No DM protocol or session state is changed. Members are exact account/device bindings; membership never follows an unsigned display name. Account keys are existing public-key identities, not usernames or human identity verification.

The creator device is the sole membership and publication authority. Its exact binding is pinned at first validated discovery; replacement is not automatic. One authoritative persistent database is required for this device. Cloning or rolling back its private keys/database, or owner equivocation, is outside the model. Loss/revocation of the owner requires a new room; there is no implicit successor. Multiple contexts sharing its IndexedDB use compare-and-swap. Independent databases claiming the same owner device are unsupported.

All current members share a fresh random AES-256 key for one epoch. Possession proves no individual authorship. Messages additionally require the sender device's ECDSA signature, validated against its account-authorized binding in the signed membership. Each accepted message also requires the owner device's publication receipt. Neither relay/Gun discovery nor a valid signature from a different subject supplies authority.

## Encoding and message envelope

All signed inputs use fixed-order JSON arrays, UTF-8, no optional fields. Strings use exact JSON encoding without Unicode normalization. Versions are numeric 1. Public keys/signatures/ciphertext use canonical base64; hashes use SHA-256 lowercase hex. Unknown envelope fields are rejected (Gun metadata is outside the serialized envelope). Device binding canonical bytes use the existing `bindingBytes` function and account signature.

Message header array: `["interpoll/group/message",1,roomId,membershipEpoch,keyEpoch,epochHash,messageId,senderAccount,senderDevice,sequence,timestamp]`. Epochs and counters are positive safe integers; messageId is a UUID. Timestamp is signed ordering metadata, not freshness authority. Content is exactly `{text,senderName}` and is encrypted as JSON. Attachments are not supported by this room API; unknown content/envelope/media fields fail closed.

AES-GCM uses a fresh random 96-bit IV and header bytes as AAD. Here `header` means the canonical header array serialized as a JSON string (not a nested array). Sender ECDSA-SHA256 signature covers `["interpoll/group/authorship",1,header,iv,ciphertext]`. Signature verification requires the claimed member's exact authorized device. The owner publication receipt signs `["interpoll/group/accepted",1,SHA256(authorship bytes),senderSignature,publicationSequence]`. PublicationSequence is a room-global monotonically increasing counter, never reset on membership change. The complete wire envelope is serialized in one Gun string field to avoid graph field recombination.

Changing room, epochs, epoch hash, messageId, sender/device, sender sequence, timestamp, IV, ciphertext, sender signature or receipt must fail verification. Same accepted bytes are idempotent. A reused messageId with different authenticated bytes conflicts. Reordering within the bounded receipt window is supported. Retried publications reuse the committed immutable envelope.

## Membership/key transition

Each signed epoch binds domain/version, room, owner binding, positive membershipEpoch/keyEpoch (equal), previous epoch hash, ordered member bindings, encrypted room metadata (name/description), creation time, key commitment, and per-member encrypted key distributions. Owner signature authenticates all these fields. Room metadata uses AES-GCM under the fresh epoch key with AAD `["interpoll/group/metadata",1,roomId,membershipEpoch,keyEpoch]`; names/descriptions remain private. Membership/device identifiers and epoch numbers are public metadata. Epoch hash hashes the signed payload (signature randomness does not define identity).

Create = epoch1. Every add, leave, removal, rejoin, member device revocation or identity replacement advances both epochs and generates an independent random key. Owner cannot be removed; owner leave closes the room with an empty membership and a new epoch. Identity/device replacement is explicit remove then add, never discovery-driven. Compromised-member response uses removal; owner compromise cannot be repaired inside this authority model. Membership changes are owner-only; signed member leave requests are accepted by the owner. A nonowner leave is not reported completed until its signed revoking transition is received. An offline owner means retryable/pending leave, not fictional revocation.

New keys are individually sealed to each retained binding's ECDH IK with fresh ephemeral P-256 ECDH, HKDF-SHA256 and AES-GCM. KDF/AAD bind room, epoch, account, device and purpose; the full distribution list is owner-signed. Removed bindings receive no distribution. Key commitment is checked after unwrap. State, key, publication counters and pending publication records commit in one metadata CAS before any publication. CAS conflict discards candidate key material and reloads state. Failure commits nothing.

A new member gets only the new epoch key; past plaintext already obtained by anyone cannot be revoked. A rejoining identity needs explicit approval and receives only its new epoch. No ratcheted forward secrecy, post-compromise recovery, protection against an authorized member leaking keys, or cryptographic erasure is claimed.

## Publication barrier (why fetching latest is insufficient)

A stale relay can hide removal from a sender. Therefore peers MUST NOT directly publish group ciphertext merely after fetching a latest epoch. Each signed candidate envelope is additionally sealed to the pinned owner device under a distinct request domain. A removed member with an old group key cannot read another sender's proposal on Gun. The owner validates membership, epoch, individual signature and AEAD, then atomically assigns a receipt and saves the immutable accepted envelope against the authoritative epoch. Only accepted envelopes are published publicly. Removal and acceptance contend on the same CAS. Acceptance before removal belongs to the old epoch; acceptance after removal requires the new key. Transport may deliver old already-authorized messages later; wall-clock delivery time is not creation authority.

The creator must be online to process peer proposals, joins/leaves and epoch refresh. This is a deliberate availability tradeoff, not a claim of relay-free/decentralized group authority. A malicious relay may censor; it cannot mint authorizations or decrypt sealed proposals. Cached stale proposals fail at the owner. A stale sender must refresh/re-encrypt locally after rejection; its stale outer sealed proposal is never publicly unwrapped.

## Join, discovery, migration and restart

Invites contain a public room/owner pointer, not a group key or authority to enroll. Owner must explicitly approve an account/device binding through the service API. Join uses the pointer to fetch a signed epoch and can unwrap only if approved. No membership list fetched from Gun authorizes addition. UI enrollment approval workflow is not added in this pass. Password/bearer-key creation is rejected for new epoch rooms rather than silently implying revocation. Existing generic invite URL plumbing can carry the public `epoch-v1` marker.

Legacy rooms are `LEGACY_SHARED_KEY`; their old plaintext mirror may be viewed but legacy wire messages cannot become authenticated messages and new sends/joins are blocked with a migration-required error. There is no in-place relabeling. Migration means creator explicitly creates a new room and re-approves current devices; no old key, membership marker or unauthenticated author record becomes authority. KeyVault entries for epoch rooms are discovery/UI markers only; epoch keys and authorization live in account-scoped metadata. No database version/migration-complete flag is introduced.

Clients persist the current signed epoch/hash and exact owner binding. Lower epochs and conflicting equal epochs are rejected after restart. A newer owner-signed epoch can checkpoint a lagging client without fabricating intermediate history. Consecutive epochs must reference the pinned predecessor; gaps rely explicitly on the sole owner signature. A higher epoch excluding the local device commits revocation with no key. A missing creator authority record is never reconstructed from discovery; it requires trusted local state restoration or a new room. Whole-database rollback or a forged local backup is not protected. Receiving an older epoch is stale except an exact already-persisted duplicate. A client which has not learned a removal cannot know it globally; owner publication barrier still prevents newly authorized old-key traffic.

## Bounds and atomic acceptance

Maximum64 member devices,8 retained local epoch keys,128 unflushed owner publications,128 accepted receipt positions for reordering,128 sender positions per current member device (maximum64),100 owner room listeners,64 in-flight transport requests,64KiB plaintext and512KiB encoded record. Safe integer overflow fails closed. Replay positions below the retained window are stale, not treated as new. Owner sender-position windows persist independently of plaintext history and reset only on an authenticated epoch transition; pruned messages cannot be reauthorized. Known exact messages still in the mirror are duplicates; pruned accepted positions are rejected rather than repersisted. Current epoch pin and publication high-water mark persist indefinitely per joined room. Historical epochs evict oldest-first; accepted plaintext follows the existing local history policy. No persistent queue of arbitrary unauthenticated proposals or key distributions is added. Gun replication/storage DoS quotas are not claimed.

Owner candidate acceptance and membership changes compare-and-swap the same account/room record. Received acceptance atomically commits replay position and plaintext row using the existing metadata/chat-messages transaction. Failed authentication or storage failure changes neither. Publication outbox is inside owner state and survives restart. Owner retries drain only immutable accepted records. Missing current key fails closed; old keys never substitute for it.

## Implementation/test mapping

`groupSecurity.ts`: canonical cryptography, pinned epochs, sealed distribution, atomic transition/publication/receive. `groupRoomTransport.ts`: sealed owner requests and durable publication retry. `chatRoomService.ts`: active create/join/leave/send/history integration and legacy quarantine. Local group-security tests exercise F11/F21 using fake IndexedDB and fake Gun only. SI-21 through SI-26 in SECURITY_INVARIANTS.md map concrete tests after verification.

## Compatibility details

Generic key-vault exports contain only `epoch-v1` discovery markers for these rooms, not epoch keys/state or device credentials. Importing a marker is not membership or a complete group backup. Room restore requires the approved device credentials plus persistent epoch metadata, or explicit approval of a new device in a later epoch. No migration-complete flag or historical trust inference is used. Legacy stored messages are displayed with an unverified label and no authenticated sender ID. No new group attachment API, enrollment approval UI, ownership transfer or offline-authority fallback is supplied.

The existing account-signed DM DeviceBinding identifies a device key; it does not automatically authorize membership. The owner's explicit signed member list separately authorizes that exact binding for group use. All group signatures/key wrapping use group-specific domains; DM capabilities, key lifecycle and wire formats are unchanged.
