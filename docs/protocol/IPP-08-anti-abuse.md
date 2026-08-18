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

## 8. Bought-engagement controls (likes, comments, sponsored opinions)

Batch-purchased engagement — bulk identities, bulk reactions, paid comments — is
a distinct threat from message flooding, and §1's scope statement applies to it
in full: the controls below make purchased engagement **non-transferable and
visible**, not impossible.

### 8.1 Engagement tiers

The vote tier ladder ([[IPP-05-vote-flow]], `voteTierService`) generalises to any
signed engagement over any target. An implementation SHOULD resolve a tier for
post votes and comments using the same ladder — `issuer` > `relay` > `pow` >
`anonymous` — and SHOULD display the tier split (verified vs open distinct
actors) rather than a single merged count.

Self-contained PoW pre-images are per action kind and MUST bind the actor
pubkey, the target id and the timestamp, so work solved for one target or one
kind does not transfer to another. Poll votes keep the `votepow:` pre-image of
[[IPP-05-vote-flow]]; other kinds use `engagepow:{kind}:{pubkey}:{targetId}:{createdAt}:`.

Reference difficulties: `vote` 18, `comment` 14, `post-vote` / `comment-vote` /
`follow` 12 leading zero bits.

An engagement carrying tier evidence MUST also carry a signature over its own
canonical fields, and verifiers MUST check that signature **before** resolving a
tier. Without it, evidence can be copied off another actor's action.

### 8.2 Statistical signals (advisory only)

Implementations MAY compute the following from locally held actions. Results
MUST be advisory: they MAY change a display weight or annotate a count, and MUST
NOT delete content, block an actor, or be presented as a verdict.

| Signal | Reads | Action |
|---|---|---|
| Co-engagement overlap | Jaccard of actor target-sets across unrelated targets | Down-weight a cohort of size *n* by 1/√*n* |
| Delivery shape | Inter-arrival CV/entropy, late start, round totals | Flag the target's arrival pattern |
| Cohort birth | Actors whose first observed action is minutes old | Flag the cohort |
| Template reuse | SimHash Hamming distance across distinct authors | Flag the comment cluster |

Cohorts, not individuals, SHOULD be the unit of down-weighting, and the
down-weighting SHOULD be sub-linear so a false cohort call costs influence
rather than erasing participation.

### 8.3 Limits specific to this layer

An actor who ages keys, spreads actions over months and engages organically
between orders defeats every signal in §8.2. A human paid to hold an opinion is
indistinguishable from a human holding it; only disclosure and trust weighting
touch that case. Statistical signals see only actions that reached the local
client, so two honest peers MAY disagree about a cohort, and implementations
MUST NOT present a cohort call as network consensus.

> **Current Implementation Note.** §8.1 lives in `engagementTierService.ts` +
> `utils/engagementPow.ts` (with `postVoteService` producing and verifying
> post-vote evidence); §8.2 lives in `collusionService.ts`.

---

## Conformance checklist

- [ ] Anti-abuse controls are presented as mitigations, never as one-human-one-vote guarantees.
- [ ] Non-exempt sealed messages carry sufficient `_pow`; verifiers recompute and reject insufficient PoW.
- [ ] Sealed messages are rejected on stale/future `_ts` or replayed `_nonce`.
- [ ] Relay `identityKey` precedence is pubkey → deviceId → oauth; relay fails closed on missing poll policy.
- [ ] Verified-username claims (if supported) verify certificate signature and username↔pubkey binding over HTTPS issuers before persisting.
- [ ] Engagement PoW binds actor, target and kind; evidence-bearing actions are signature-checked before a tier is resolved.
- [ ] Statistical collusion signals only weight or annotate — they never delete, block, or assert a verdict.
