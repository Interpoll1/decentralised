# IPP-08: Anti-Abuse Controls

**Status:** Draft
**Version:** 1
**Supersedes:** `docs/protocol-whitepaper.md` v0.5 (§9), consolidates §5.5 (verified usernames)

Requirements language: see [[IPP-00-overview]].

---

## 1. Scope statement (normative)

The controls in this document are **practical abuse mitigations, not
cryptographic Sybil resistance**. A determined adversary with multiple devices or
accounts can still attempt abuse; these controls raise its cost. Implementations
and operators MUST NOT represent them as one-human-one-vote guarantees.

## 2. Control layers

| Mechanism | What it does | What it does NOT guarantee |
|---|---|---|
| Device fingerprinting | Per-device vote history, local + relay registry | Cryptographic uniqueness per person |
| Two-phase vote authorization | Persisted `pollId:identity` registry + reservation token; fails closed | Availability if the relay is offline |
| Invite codes | Single-use per-poll access, consumed in the content graph | Resistance if codes are leaked |
| OAuth gating | Optional login before voting; identity from provider userinfo | Anonymity/unlinkability of votes |
| Rate limits + bot scoring | Reduces automated spam | Guaranteed spam elimination |
| Proof-of-Work | Raises cost of message floods | Mathematical Sybil resistance |

These controls SHOULD be deployable together and per-poll.

## 3. Proof-of-Work (hashcash)

Non-exempt sealed messages ([[IPP-02-canonical-format]] §4) MUST carry a `_pow`
nonce such that `SHA-256(_hash + ':' + _pow)` has at least the message type's
required number of leading zero bits. Verifiers MUST recompute and reject
insufficient PoW.

Reference difficulties (leading zero bits) and exemptions:

| Type | Bits |
|---|---|
| `vote-authorize` / `vote-record` / `vote-confirm` / `poll-policy` | 18 |
| `new-poll` / `new-block` / `new-event` | 16 |
| `index` | 14 |
| `broadcast` | 12 (DEFAULT) |
| `chat-message` / `chatroom-message` | 10 |

**Exempt** (no signature/PoW required): `ping`, `pong`, `register`, `join-room`,
`chat-typing`, `chat-read`, `chat-delivered`, `chat-read-receipt`, `rtc-offer`,
`rtc-answer`, `rtc-ice`, `snapshot-accept`, `snapshot-cancel`. Exempt messages
still MUST carry `_ts`/`_nonce` for freshness/replay.

> **Current Implementation Note.** Difficulty table and exempt set live in
> `integrityService.ts` (client) and are mirrored by relay validation.

## 4. Replay / freshness

A verifier MUST reject a sealed message whose `_ts` is outside the accepted window
(reference: older than 5 minutes, or more than 30s in the future) or whose
`_nonce` has been seen within the window. The nonce cache MAY be bounded.

## 5. Duplicate-vote identity precedence

The relay's duplicate-vote `identityKey` MUST be `pollId:pubkey`, falling back to
`pollId:deviceId`, and to `pollId:oauth:provider:subject` for `requireLogin`
polls. Clients MUST use the same precedence for their local check
([[IPP-05-vote-flow]] §2) so both sides agree on voter identity. A relay MUST fail
closed when a poll's policy is missing.

## 6. Verified usernames (optional trust-issuer flow)

A client MAY support verified usernames via external issuers. The flow:

1. Client selects an issuer (`domain`, `endpoint`, `publicKey`).
2. `POST {issuer}/challenge` with `{username, pubkey}` → `{challengeId, prefix,
   difficulty, expiresAt}`.
3. Client solves SHA-256 leading-zero PoW, then `POST {issuer}/claim` with
   `{challengeId, nonce, username, pubkey}`.
4. Issuer returns a signed certificate `{issuerDomain, username, userPubkey,
   issuedAt, expiresAt, signature}`.
5. Client MUST verify the certificate signature against the issuer public key and
   MUST verify the username↔pubkey binding before persisting the claim.

Client-enforced constraints: issuer endpoints MUST be HTTPS (except localhost dev);
the issuer domain MUST match the endpoint host/parent domain; challenge bounds
(`difficulty`, `expiresAt`, required fields) MUST be validated; certificate
`username`/`userPubkey` MUST match the request and the persisted record.

> **Current Implementation Note.** This is a **centralized-issuer** trust model
> (issuer domains in an allowlist — `identityTrust.ts`), not a decentralized
> web-of-trust. It is the candidate starting point for relay-pubkey trust in
> [[IPP-07-multi-relay-quorum]] §9.

## 7. What the anti-abuse layer does NOT provide

Cryptographic Sybil resistance; anonymity against the application origin or relay
operator; protection from a compromised frontend bundle; guaranteed
duplicate-vote prevention when the backend is offline and multiple devices are
used. See the app-origin trust boundary discussion in the overview/threat text.

---

## Conformance checklist

- [ ] Anti-abuse controls are presented as mitigations, never as one-human-one-vote guarantees.
- [ ] Non-exempt sealed messages carry sufficient `_pow`; verifiers recompute and reject insufficient PoW.
- [ ] Sealed messages are rejected on stale/future `_ts` or replayed `_nonce`.
- [ ] Relay `identityKey` precedence is pubkey → deviceId → oauth; relay fails closed on missing poll policy.
- [ ] Verified-username claims (if supported) verify certificate signature and username↔pubkey binding over HTTPS issuers before persisting.
