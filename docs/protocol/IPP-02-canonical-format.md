# IPP-02: Canonical Format and Integrity Envelope

**Status:** Draft
**Version:** 1
**Supersedes:** `docs/protocol-whitepaper.md` v0.5 (§7.1)

Requirements language: see [[IPP-00-overview]].

---

## 1. Why canonical serialization

Signatures and content hashes are computed over a **canonical byte
serialization** of an object. Two conforming implementations, in any language,
MUST produce identical canonical bytes for the same logical object, or their
signatures will not verify against each other. This document defines that single
algorithm.

## 2. Canonical JSON

Given an object, its canonical JSON string MUST be produced by the following
rules:

1. **Strip integrity meta fields.** Remove the top-level keys `_hash`, `_sig`,
   `_pub`, `_pow`, `_ts`, `_nonce` (the envelope of §4) before serializing.
2. **Objects:** serialize keys in ascending Unicode code-point order (a plain
   lexicographic sort of the UTF-16 key strings). Each key is emitted as
   `JSON.stringify(key)`, followed by `:`, followed by the canonical form of its
   value. Pairs are joined with `,` and wrapped in `{ }`.
3. **Arrays:** serialize elements in order, each in canonical form, joined with
   `,` and wrapped in `[ ]`.
4. **`null`:** serialize as `null`.
5. **`undefined`:** a value of `undefined` is **omitted** — an object key whose
   value is `undefined` MUST NOT appear in the output; an array element that is
   `undefined` MUST be serialized as `null` (to preserve positional index).
6. **Primitives** (string, number, boolean): serialize via standard JSON
   (`JSON.stringify`).

The serialization MUST be recursive at every depth (nested objects and arrays
are canonicalized the same way).

> **Current Implementation Note.** The single implementation is
> `shared-validation/canonical.js` (`canonicalJSON` / `stableStringify` /
> `META_FIELDS`), imported by both the frontend (`integrityService.ts`,
> `postService.ts`, `commentService.ts` via a tracked ambient declaration
> `src/types/shared-validation.d.ts`) and Node relay code
> (`shared-validation/integrity.js`, which wraps it with `crypto.createHash`).
> Before Phase 1 there were three divergent implementations; consolidating them
> is what makes cross-implementation verification reliable.

## 3. Content hash

The content hash of an object is `SHA-256(canonicalJSON(object))`, expressed as
lowercase hex. Hashing MUST use the canonical form of §2.

## 4. Integrity envelope (sealed messages)

State-mutating relay/API messages MUST be *sealed* by attaching an integrity
envelope of six reserved top-level fields:

| Field | Meaning |
|---|---|
| `_hash` | `SHA-256(canonicalJSON(payload))`, hex |
| `_sig` | Schnorr signature over the same canonical payload |
| `_pub` | signer x-only public key, hex |
| `_pow` | hashcash nonce (see [[IPP-08-anti-abuse]]) |
| `_ts` | millisecond Unix timestamp of sealing |
| `_nonce` | unique per-message value (replay protection) |

A verifier MUST, for a non-exempt message:

1. recompute `canonicalJSON(payload)` (which strips the six envelope fields),
2. confirm `_hash` equals `SHA-256` of that canonical form,
3. verify `_sig` against `_pub` over that canonical form,
4. verify the `_pow` difficulty for the message type ([[IPP-08-anti-abuse]]),
5. confirm freshness (`_ts` within the accepted window, `_nonce` unseen).

A verifier MUST reject (fail closed) if any check fails. Certain low-risk message
types MAY be exempt from signing/PoW; the exempt set is defined in
[[IPP-08-anti-abuse]].

> **Current Implementation Note.** `IntegrityService.seal()` /
> `verifySealedPayload()` implement this. Signing internally hashes with SHA-256
> then Schnorr-signs (BIP-340). The nonce is a `crypto.randomUUID()`; the replay
> cache holds recent nonces in memory (bounded).

## 5. Signature scheme

Signatures MUST be BIP-340 Schnorr over secp256k1. The message signed is the
SHA-256 of the canonical form (i.e. signing hashes the canonical string first).
Verifiers MUST use the same hash-then-verify order.

## 6. Content-signature versioning

Domain objects that carry a detached content signature (e.g. posts, comments —
see [[IPP-03-domain-objects]]) MUST record which canonicalization algorithm
produced that signature, so a verifier can select the correct algorithm for
historical data.

- New signatures MUST be produced with the canonical algorithm of §2 and tagged
  `canonVersion: 2`.
- An object with no `canonVersion` MUST be treated as legacy (`v1`) and verified
  against the legacy algorithm that produced it.
- Implementations MUST NOT re-sign or rewrite historical objects to "upgrade"
  their canonicalization.

> **Current Implementation Note.** `postService.ts` and `commentService.ts` tag
> new signatures `canonVersion: 2` and retain deprecated `canonicalPostPayloadV1`
> / `buildSignablePayloadV1` **only** to verify pre-Phase-1 signatures. The v1
> post canonicalizer sorted only top-level keys and did not recurse — which is
> exactly why versioning is required.

---

## Conformance checklist

- [ ] Canonical JSON strips the six `_`-prefixed envelope fields before serializing.
- [ ] Object keys are emitted in ascending code-point order, recursively, at every depth.
- [ ] `undefined` object values are omitted; `undefined` array elements become `null`.
- [ ] Content hash is `SHA-256(canonicalJSON(obj))` in lowercase hex.
- [ ] Sealed messages carry `_hash/_sig/_pub/_pow/_ts/_nonce`; verifiers check all five conditions and fail closed.
- [ ] Signatures are BIP-340 Schnorr over `SHA-256(canonical)`.
- [ ] Detached content signatures record `canonVersion`; absent = legacy v1; historical objects are never re-signed.
