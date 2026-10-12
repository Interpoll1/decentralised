# IPP-10: Username Recovery and Key Succession

**Status:** Draft (spec only — nothing here is implemented)
**Version:** 0
**Extends:** [[IPP-01-identity]] §3 (backup/restore), §6 (verified usernames); [[IPP-08-anti-abuse]]; [[IPP-07-multi-relay-quorum]]

Requirements language: see [[IPP-00-overview]].

---

## 1. Problem

A username is a human-readable name bound to a public key. The key is the real
identity ([[IPP-01-identity]] §1), and it lives only on the user's device. Today:

1. **Phrase holders can recover** — `importFromMnemonic()` restores the key and the profile
   is re-fetched by public key, so the name comes back. This path works and is the
   baseline.
2. **Everyone else loses the name.** If the device is wiped and no phrase was saved, the
   username stays bound to a key nobody holds. The new key cannot claim it, and the old
   key cannot be reached.
3. **Claims are unauthenticated.** `TrustService.claimUnverifiedUsername()` writes
   `usernames/<name> = { pubkey, level, claimedAt }` with no signature. Anyone able to
   write to the Gun graph can overwrite the binding, so there is nothing to recover
   *against* until claims are signed (§4).

## 2. Goals and non-goals

**Goals**
- G1. A user who saved their phrase recovers everything (existing behaviour, kept).
- G2. A user who lost their key can recover a username they claimed, *if* they set up a
  recovery method beforehand or hold a trust-issuer verification.
- G3. Recovery MUST NOT let a third party take a name from its owner.
- G4. Works without any single relay being trusted ([[IPP-07-multi-relay-quorum]]).

**Non-goals**
- Recovering a name with no prior setup and no issuer verification. If nothing proves the
  claimant owned the name, the name is not theirs to recover.
- Recovering the *private key* itself, or any encrypted-community keys ([[IPP-09-encrypted-communities]]).
- Multi-device identity ([[IPP-01-identity]] §5) — separate work.

## 3. Threat model

| Threat | Mitigation in this spec |
|---|---|
| Squatter overwrites an unsigned claim | Signed claims, deterministic conflict rule (§4) |
| Attacker "recovers" someone else's name | Recovery needs a prior designation, a signature from the designated key, and a cancellable time lock (§6) |
| Stolen device holder rotates key to lock owner out | Rotation by the old key is allowed only with the recovery key's countersignature **or** is subject to the same time lock (§5) |
| Colluding/compromised relay forges or hides recovery events | Events are signed and replicated; clients verify signatures and require agreement from the relays they read from (§8) |
| Recovery used to harass (spam requests) | Requests are rate-limited and PoW-gated ([[IPP-08-anti-abuse]]) |

## 4. Signed username claims (prerequisite)

A claim MUST be a signed event, not a bare Gun write.

```
UsernameClaim {
  v: 1,
  username: string,            // normalized per IPP-02, lowercase
  pubkey: hex32,               // claimant
  claimedAt: ms,
  level: 'none' | 'issuer',    // 'issuer' carries an issuer certificate
  cert?: TrustCertificate,     // IPP-08, when level = 'issuer'
  sig: hex64                   // BIP-340 over canonical(UsernameClaim minus sig)
}
```

**Conflict rule.** For one `username`, the valid claim is chosen by this order:
1. a claim with a valid issuer certificate beats one without;
2. otherwise the **earliest** `claimedAt` wins;
3. ties are broken by the lexicographically lower `hash(canonical(claim))`.

A client or relay MUST reject a claim whose signature does not verify, and MUST NOT let a
later claim replace an earlier valid one except through a succession event (§5, §6).

### 4.1 Trusting time and certificates (hardening)

Authors choose their own timestamps, so a resolver MUST NOT treat them as proof of order or of elapsed time:

- **Certificates fail closed.** `level: issuer` counts only if a verifier confirms the issuer is trusted, its signature is valid, and the certificate binds *this username* to *this claimant key*. With no verifier, no certificate counts.
- **Time locks start when the observer first saw the event**, i.e. `max(declared time, first seen) + lock`. Backdating a rotation cannot shorten a lock. Events are still *sequenced* by declared time so a designation precedes the rotation that uses it.
- **Pinned holder.** Once an observer has accepted a holder for a name, a later or backdated claim by another key MUST NOT displace it; the observer flags a `conflict` instead. A pin moves only when a succession (§5, §6) actually takes effect.
- **Future-dated events** (more than 10 minutes ahead of the observer's clock) are ignored.

**Residual risk.** A brand-new observer that has never seen the name has no pin and no first-seen record, so for *claim priority* it falls back to declared time, and a backdated claim can win there. Closing this needs a witness timestamp — the relay stamping the time it first stored each claim and clients cross-checking at least two relays (§8, [[IPP-07-multi-relay-quorum]]). Until then, a name that already has a signed claim and an established holder is protected for everyone who has seen it, but a freshly-appearing observer can be misled.

## 5. Key succession (rotation)

Moves a username from `oldPubkey` to `newPubkey`.

```
KeyRotation {
  v: 1,
  username: string,
  oldPubkey: hex32,
  newPubkey: hex32,
  effectiveAt: ms,
  sigOld?: hex64,       // by oldPubkey — present when the old key still exists
  sigNew: hex64,        // by newPubkey — proves the new key is held
  sigRecovery?: hex64   // by the designated recovery key (§6)
}
```

- **Voluntary rotation** (user still has the old key): requires `sigOld` and `sigNew`.
  Takes effect after a short notice window (default 24 h) so a thief with a stolen key
  cannot rotate instantly without the owner noticing.
- **Recovery rotation** (old key lost): requires `sigNew` and `sigRecovery`, and the
  full time lock in §6.
- On acceptance, clients attribute past content signed by `oldPubkey` as before and
  show the name on content signed by `newPubkey`. Old signatures stay valid forever;
  rotation changes who *holds the name*, not history.

## 6. Recovery designation

At any time while the key is held, a user MAY register one recovery method.

### 6.1 Recovery key (default)
A second keypair generated and shown once as its own 24-word phrase ("name recovery phrase"),
kept offline by the user.

```
RecoveryDesignation {
  v: 1, username, pubkey,           // current holder
  recoveryPubkey: hex32,
  timelockMs: number,               // default 14 days, minimum 3 days
  sig: hex64                        // by pubkey
}
```

**Recovery request.** The holder of the recovery key publishes a `KeyRotation` (§5) with
`sigRecovery`. It becomes *pending*, visible to every reader, for `timelockMs`. During
that window:
- a valid event signed by the **current** key cancels it (the owner is still around);
- the app MUST surface a pending recovery loudly to the current key's devices
  (banner + Bit message) and to anyone viewing the profile ("recovery pending");
- after the window with no cancellation it takes effect.

### 6.2 Verified names (issuer certificates)
Today an issuer proves only that the claimant solved a proof-of-work puzzle ([[IPP-08-anti-abuse]]); it does **not** identify anyone. Therefore a new PoW is **not** evidence of ownership, and an issuer MUST NOT re-issue a certificate to a different pubkey on the strength of a fresh PoW alone — that would let anyone take over a verified name.

**Same-key re-issue (implemented in `trustapi.ts`).** If the requesting pubkey equals the pubkey already bound to the name, the issuer re-issues the certificate — but only on a **signed claim-v2** (the request is signed with the private key, so possessing the public key is not enough; the unsigned v1 flow is rejected with 409). A request from a *different* pubkey is rejected with 409. This is what restores a verified name after a phrase restore: same key, fresh certificate. It does nothing for a lost key.

**Different key (lost key).** A verified name moves to a new pubkey only through the recovery path below:
- the designated recovery key signs the rotation (§6.1) and the time lock applies; **and**
- the issuer, seeing a valid, un-cancelled rotation for a name it certified, MAY then issue a new certificate to the new pubkey. The issuer acts on the signed rotation, not on its own judgement of who the person is.

An issuer that does real identity checks (email, domain, ID) MAY offer a stronger path of its own, but clients MUST NOT assume one exists. If no recovery key was set, a verified name cannot be recovered; the user claims a new name.

## 7. Client behaviour

- **Claim step** (ClaimUsernamePage): after a successful claim, offer "Set up name recovery"
  with the recovery-key flow (§6.1). Skippable, but remembered so Bit can remind later.
- **Settings → Identity**: shows recovery status per username — *none*, *recovery key set*,
  *issuer verified*, *recovery pending*; actions: set up, rotate key, cancel pending.
- **Setup wizard** (`BitSetupPage`): "I lost my key" branch → enter the **name recovery
  phrase** instead of the identity phrase; the client creates a new keypair and publishes
  the recovery rotation.
- **Bit reminders**: extend the username reminder — a user with a username but no recovery
  method gets the same snooze/backoff treatment (`bitStore` reminder logic).
- **Never silent.** Any pending or completed succession is shown on the profile and in the
  chain explorer for at least 30 days.

## 8. Replication and relays

### 8.1 Relay witness (implemented)

The relay validates every event and remembers, per username, the holder and the registered recovery key.

- `POST /api/username-events` — body is one signed event. The relay checks the signature and the rules below, stamps `firstSeen` with **its own clock**, and answers `{ id, firstSeen }` or an error code (`NAME_TAKEN`, `NOT_HOLDER`, `NO_RECOVERY_KEY`, `RECOVERY_KEY_MISMATCH`, `ROTATION_PENDING`, `STALE_OR_FUTURE_EVENT`, …).
- `GET /api/username-events/:username` — `{ state, events: [{ id, firstSeen, event }] }`.
- **Rules:** the first claim the relay sees wins and later claimants get `NAME_TAKEN` whatever date they declare; only the holder can register a recovery key; a recovery request must carry a signature from the registered recovery key and its lock runs from the relay stamp; only the holder can cancel; one rotation may be pending at a time and the recovery key cannot be swapped while one is; an older designation cannot be replayed; declared times must be within 15 minutes of the relay clock.
- Clients treat the relay as a witness, not an authority: they still verify signatures, replay the events themselves, and use the relay stamps (not the author's dates) for claim priority and time locks. If the relay is unreachable, events still travel over Gun and the local first-seen ledger applies.
- Certificates: the relay does not verify issuer certificates; clients do (§4.1).

- Succession events are small signed objects stored under a dedicated Gun root
  (proposal: `username-events/<username>`), replicated like any other content.
- A relay SHOULD validate signatures and the time-lock fields before accepting, and MUST
  NOT delete or hide valid events ([[IPP-08-anti-abuse]] covers legitimate moderation).
- Readers resolve a name by replaying claim → designations → rotations → cancellations in
  `effectiveAt` order and applying §4–§6. Resolution MUST be deterministic from the event
  set alone.
- With multiple relays, a reader SHOULD fetch from at least two and treat disagreement as
  "unresolved" and warn, rather than pick one ([[IPP-07-multi-relay-quorum]]).

## 9. Privacy

Recovery designations publish a recovery *pubkey* — a pseudonymous value with no link to
an email, phone or other identity. The name recovery phrase is never transmitted.

## 10. Phased plan

| Phase | Deliverable |
|---|---|
| 0 | Done: phrase restore + profile re-fetch ([[IPP-01-identity]] §3); same-key certificate re-issue via signed claim-v2 (§6.2) |
| 1 | Signed `UsernameClaim` + conflict rule; relay and client verification; migrate existing unsigned claims by having owners re-sign on next login |
| 2 | `RecoveryDesignation` + recovery-key phrase UX at claim time |
| 3 | `KeyRotation` (voluntary + recovery) with time lock, pending banners, cancel |
| 4 | Issuer re-issue on a valid rotation (§6.2) |

## 11. Open questions

1. **Existing unsigned claims.** How long do owners have to re-sign before first-seen
   unsigned claims are treated as unowned? (Proposal: 90 days after Phase 1 ships.)
2. **Time lock length.** 14 days is safe but slow; should users choose, with a hard minimum?
3. **Name release.** Should abandoned names (no activity for N years, no recovery set) become
   claimable again?
4. **Relay-less mode.** Succession events need a path through link/QR propagation
   (link/QR propagation, see IPP-06) — do they ride along with a shared profile link?
5. **Issuer compromise.** If an issuer re-binds a name maliciously, what is the dispute path?
6. **Verified names with no recovery key.** Accept that they are unrecoverable, or let issuers define an identity-checked path?

---

## Conformance checklist

- [ ] A username claim is a signed event; unsigned claims are not authoritative.
- [ ] Claim conflicts resolve by issuer-cert → earliest `claimedAt` → lower hash.
- [ ] A recovery rotation requires `sigNew` + `sigRecovery` and survives a cancellable time lock.
- [ ] A valid event from the current key cancels a pending recovery.
- [ ] Pending and completed successions are visible to users and never silent.
- [ ] Old signatures remain valid after rotation; only name ownership moves.
- [ ] Name resolution is deterministic from the event set.
