# DM account/device/prekey contract v1

## Authority and circular-trust review

The authoritative account ID is the lowercase 64-hex Schnorr x-only public key already managed by KeyService (`nostr-keypair`). Verification uses the **requested account ID itself**, never a relay-provided signer, profile `_pub`, display name, issuer label, or JWT claim. Local publication requires that KeyService's private key derives exactly the ChatService account ID. Anonymous random IDs without that private key cannot publish authenticated bindings. No parallel account root is introduced.

The intended recipient account key must already have been selected by the caller/contact. This contract does not prove that a display name belongs to that key; untrusted name/profile resolution remains outside this pass.

Chain: requested account key -> account-signed device binding -> messaging ECDH IK AND messaging ECDSA signing key -> signed SPK identifier/public key -> signed OPK identifier/public key (or explicit null) -> authenticated bootstrap transcript -> session.

Circular-trust check: an IK signing its SPK cannot establish account authority. The account signature is verified first against the independently supplied requested account key. Every subsequent signature is checked against the messaging signing key authorized by that binding. Structurally valid replacement keys are insufficient.

## Identities and canonical bytes

Device identity is a random UUID stored once per local account installation by an IndexedDB CAS. It is not the account ID, legacy profile deviceId, browser fingerprint, transport peer ID, or a claim of hardware attestation. v1 selects/pins one authorized device per peer account; additional devices are not silently selected. No multi-device fanout is implemented.

Binding fields: version=1, accountId, deviceId, generation (positive safe integer), ik (P-256 raw public key, canonical base64), ikSignPub (P-256 ECDSA public key, canonical base64), capabilities=`dm-auth-v1`. The account signature is lowercase hex Schnorr over SHA-256(UTF-8(JSON.stringify(the ordered array below))), using existing CryptoService.sign/verify:

```
["interpoll/dm/device-binding",1,accountId,deviceId,generation,ik,ikSignPub,"dm-auth-v1"]
```

There is no implicit signer supplied by the binding. Its accountId must equal the requested account and verification uses that requested account key. A requested/pinned deviceId must also match.

SPK signature: WebCrypto ECDSA P-256/SHA-256, canonical base64 of its 64-byte IEEE-P1363 output, over UTF-8 JSON:

```
["interpoll/dm/spk",1,accountId,deviceId,bindingGeneration,ik,ikSignPub,spkId,spkGeneration,spk]
```

OPK signature under that authorized messaging signing key:

```
["interpoll/dm/opk",1,accountId,deviceId,bindingGeneration,ik,spkId,spkGeneration,opkId,opkPub]
```

All IDs/integers/key encodings and signature lengths are validated. Unknown versions, missing signatures, malformed encodings and incompatible capabilities fail closed. v1 has no time-based expiry; generation identifiers and continuity enforce local rollback detection. A fresh client cannot know a revocation/supersession it has never observed.

## Continuity, rotation and device approval

Persist the first cryptographically validated binding as FIRST_SEEN_VALIDATED only at an authenticated crypto commit (send or accepted receive). Same binding is TRUSTED. Changed device -> UNKNOWN_DEVICE; changed IK/signing key or binding generation -> IDENTITY_CHANGED; lower generations -> stale rejection. Preserve the trusted record when rejecting; discovery cannot replace it. Explicit locally recorded revocation -> REVOKED.

This pass has no approval UX: changed identity/device bindings are quarantined via typed errors, not auto-approved. Key rotation, device addition and device removal require a separately authorized local/device action; relay responses cannot authorize those transitions. Account-key rotation means a different account ID and requires a new trusted contact decision. SPK generations may advance only under an unchanged authorized binding, with rollback detection; reused SPK IDs/generations with changed keys are rejected. Existing local key replacement is detected rather than silently re-signed.

## OPK lifecycle

Local pool entries contain UUID, public key and private JWK. AVAILABLE entries alone are published with signed IDs/keys. CONSUMED tombstones persist by ID. A sender selects an authenticated candidate, and records that selection with its immutable outgoing bootstrap and sending state; a cached selection already used by that sender is rejected. Replenishment uses new IDs and cannot reintroduce tombstoned entries.

The receiver finds exactly the transcript-selected ID. Its private key remains AVAILABLE during tentative X3DH/AEAD. Only successful authenticated bootstrap atomically removes it and adds its CONSUMED tombstone together with session and message acceptance. Missing/consumed named OPKs are rejected, never converted to no-OPK. A forged bootstrap cannot consume or reserve one durably. Explicit local consume uses the same atomic pool/tombstone transition and may invalidate, but cannot duplicate, a bootstrap consumer.

Relay/Gun may replay public bytes or supply stale availability. They cannot provide a trusted global reservation service in this repository. Concurrent remote senders may select the same public candidate; exactly one receiver bootstrap can consume it, and others receive a stale-prekey failure. This establishes one successful cryptographic consumer, not guaranteed delivery or an honest server reservation API. No OPK is represented by explicit null in the authenticated transcript; stripping/changing that choice must fail authentication/validation.

## Bundle, wire and bootstrap

Authenticated bundles have version=1, the account-signed binding, existing IK/signing-key fields, signed SPK ID/generation/public key and signed OPK candidates/selection. Legacy top-level fields retain their old meanings; new authorization is not inferred from them.

New authenticated envelopes use wire v4. A canonical bootstrap context binds both device bindings, selected receiver SPK and explicit OPK choice. It persists with the session and is authenticated together with header fields (version, eph, opkId, dh, n, pn) as AES-GCM AAD. Receiver verifies the account/device chain and context before accepting plaintext; continuity and OPK changes share the authenticated commit. Both directions retain the original context.

Mixed authenticated-v4/legacy-v3 negotiation is not supported. Legacy primitive/session data is not upgraded by relabeling it. Preserve old state as LEGACY_UNAUTHENTICATED; do not mark it trusted or reset it. New authenticated messaging fails closed on incompatible existing state, with a typed result. Old encrypted envelope retries retain their original bytes; they cannot acquire new authenticated identity claims. Low-level legacy cryptographic regression coverage remains separate from the authenticated ChatService path.

## Local storage and migration

Add namespaced local device/binding/SPK identity records, per-local-account peer continuity records, sender-used OPK records and receiver-consumed OPK tombstones. Existing IK/SPK private material may be bound only by the actual local account signer; existing remote bundles and sessions never become trusted merely because present on disk.

Migration is lazy and keyed by the exact requested local account; it reads each required record explicitly and commits the full local authenticated identity record atomically. There is no optional-enumeration or global migration-complete flag. Existing malformed/mismatched local records fail closed. Missing root authority remains UNKNOWN/LEGACY_UNAUTHENTICATED. Existing receiver pools retain available entries; historical consumed IDs cannot be reconstructed from old absent records, and no retroactive history claim is made.

F06 bootstrap replay/reset/session epochs remain out of scope. This contract does not authorize unauthenticated reset controls or claim full replay/reset safety, Signal compatibility, or complete authenticated E2EE.
