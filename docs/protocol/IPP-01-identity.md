# IPP-01: Identity

**Status:** Draft
**Version:** 1
**Supersedes:** `docs/protocol-whitepaper.md` v0.5 (§5.1 identity portions); consolidates `docs/user-key-identity-map.md`

Requirements language: see [[IPP-00-overview]].

---

## 1. The identity primitive

An actor's identity is a **secp256k1 Schnorr keypair** (BIP-340, Nostr-compatible).

- The **public key** (x-only, 32 bytes, lowercase hex) is the actor's canonical,
  portable identifier. It MUST be the value other participants use to attribute
  authorship and to verify signatures.
- The **private key** (32 bytes, lowercase hex) MUST remain local to the actor's
  device. It MUST NOT be transmitted to any relay, appear in any replicated
  object, or be included in a receipt.

A client MUST be able to sign arbitrary canonical payloads with the private key
and MUST verify signatures using the public key, over the canonical form defined
in [[IPP-02-canonical-format]].

## 2. Key generation

A client MUST generate the private key from a cryptographically secure random
source of 32 bytes and derive the x-only public key via BIP-340. If no keypair
exists when one is needed, a client SHOULD generate and persist one
transparently.

> **Current Implementation Note.** `KeyService` generates the key with
> `crypto.getRandomValues(32)` and derives the pubkey via `@noble/curves`
> `schnorr.getPublicKey`. It is stored in IndexedDB metadata under
> `'nostr-keypair'`. The key is stored **in plaintext at rest** (no passphrase
> or OS keystore) — a known limitation.

## 3. Portable backup and restore

Because the keypair *is* the identity, a client SHOULD provide a way to export
and re-import it so a user can carry their identity to another device or browser.

- A client SHOULD support export/import of the raw private key (64 hex chars).
- A client SHOULD support a **24-word BIP-39 recovery phrase** as a
  human-copyable encoding of the 32-byte private key. This phrase encodes the
  key as BIP-39 entropy; it MUST round-trip losslessly (phrase → key → same
  public key).
- The 24-word identity phrase MUST NOT be confused with the 12-word receipt
  verification code (see [[IPP-03-domain-objects]] §Receipt), which carries no
  signing authority. The differing word counts distinguish them.

> **Current Implementation Note.** `KeyService.exportPrivateKey()`,
> `exportMnemonic()`, `importPrivateKey()`, and `importFromMnemonic()` implement
> this; the BIP-39 conversion lives in `CryptoService.privateKeyToMnemonic` /
> `mnemonicToPrivateKey`. Added in protocol-formalization Phase 2.

## 4. Profiles and the identity-migration model

A profile is a replicated record of human-readable identity (username, display
name, avatar, stats) associated with a public key. A profile MUST carry the
actor's `publicKey`.

Target model: the public key is the authoritative actor identifier, and profiles
are addressable by it.

> **Current Implementation Note — migration in progress.** Historically profiles
> are keyed in the content graph by `deviceId` (a browser-fingerprint hash), with
> `publicKey` stored only as a field. Phase 2 introduced a dual-write migration:
>
> - Every profile write additionally writes a best-effort reverse pointer
>   `user-pubkey-index/<pubkey> → { deviceId }` (a dedicated namespaced root),
>   populated lazily on profile touch — there is **no bulk backfill**.
> - `UserService.getUserByPubkey(pubkey)` resolves via that pointer and falls
>   back to a `users` scan if the pointer is missing/stale (the pointer is a
>   cache, not authoritative).
> - Profiles remain physically keyed by `deviceId` for storage compatibility.
>   The pubkey is authoritative for identity *comparisons* only, until the
>   config flag `config.identity.primaryKey` (default `'deviceId'`) is flipped
>   to `'pubkey'` once index coverage has converged in a deployment.

## 5. Multi-device identity (non-goal for v1)

Unifying one human's multiple devices under one identity is **out of scope** for
this version. Because the keypair is per-installation until a user explicitly
exports and imports it (§3), the same person on two devices has two identities
unless they deliberately copy the key. A future version MAY define multi-device
key sync; implementations MUST NOT assume it today.

## 6. Verified usernames (optional trust issuers)

A client MAY support optional verified usernames issued by external trust
issuers. This is layered *on top of* the keypair identity and does not replace
it. The flow (challenge → PoW → signed certificate → local verification) is
specified in [[IPP-08-anti-abuse]] §Verified-usernames. A client that supports it
MUST verify the issuer's certificate signature and the username↔pubkey binding
before persisting a claim, and MUST require issuer endpoints to be HTTPS (except
localhost in development).

---

## Conformance checklist

- [ ] Identity is a secp256k1 Schnorr (BIP-340) keypair; the x-only pubkey (hex) is the canonical actor id.
- [ ] The private key never leaves the device, never appears in a replicated object or receipt.
- [ ] Signing/verification is performed over the canonical form of [[IPP-02-canonical-format]].
- [ ] A 24-word BIP-39 identity phrase, if offered, round-trips losslessly to the same public key.
- [ ] The 24-word identity phrase is never conflated with the 12-word receipt code.
- [ ] A profile carries its actor's `publicKey`.
- [ ] Verified-username support (if present) verifies certificate signature and username↔pubkey binding before persisting, over HTTPS issuers.
