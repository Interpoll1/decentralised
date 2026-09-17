# Security remediation handoff — September 2026

## Review baseline

Branch: `security/e2ee-remediation-2026-09`.

Fetched base and merge base: `710e83ed88fe710a70d3a0d7db8c6a3a9fa63f21` (`origin/master`, commit date `2026-09-15T14:58:44-04:00`). Production revision verified: `73a5f83ffde2112d6e106e778bd32560b0b8c258`. This handoff adds documentation only after 38 remediation commits. History is preserved; nothing has been pushed or submitted as a PR.

The branch includes the completed ratchet/media/delivery, identity/prekey, session-epoch, receive-state and group passes. The ancient audit revision has no common ancestor with this base; review the current implementation and regression tests, not old patch offsets.

## Scope completed

F01, F02, F03, F05, F06, F07, F08, F09, F10, F11 and F21, within the contracts and limitations below. This is a handoff for review, not a release or whole-protocol security certification. F04, F12–F20 and F22 are not resolved by this branch.

## What changed

- **Account/device/messaging identity:** the requested account Schnorr public key verifies a signed device binding authorizing the messaging ECDH IK and ECDSA signing key. Discovery does not choose the signing authority. Persisted continuity rejects unexpected replacement.
- **SPK and OPK:** signed SPK identifiers/generations and signed identified OPKs are checked under that authorized binding. Receiver consumption and consumed-ID persistence commit only with authenticated bootstrap acceptance. Sender selection reuse is detected; explicit no-OPK selection is transcript-bound.
- **Ratchet and authentication-before-commit:** IndexedDB compare-and-swap serializes competing state consumers. Tentative decrypt/bootstrap state commits only after authentication. Immutable outgoing envelope journals prevent retry re-encryption. ChatService no longer destroys valid state on an incoming decrypt failure.
- **Session epochs:** wire v5 binds an authorized device-signed generation/parent certificate. Durable replay history prevents old bootstraps regaining authority. Explicit resets require the current parent; simultaneous initiation has a deterministic account-order rule and receive-only losing branch.
- **Receive ordering/retries:** bounded skipped keys survive ratchet transitions and authentication failures. Pending observations are separate from authenticated acceptance. Session state, acceptance/dedup evidence, skipped-key consumption and pending removal share the durable acceptance transaction.
- **DM media:** every active attachment path encrypts before upload. Fresh media keys and authenticated metadata travel only inside the protected DM envelope. Restored history uses the saved descriptor to decrypt.
- **Delivery evidence:** persistence/publication and exact authenticated peer receipts have separate meanings. Timeout is not acknowledgement; failures remain retryable. `confirmed` requires the defined exact-envelope receipt, not merely a successful send attempt.
- **Group messages:** new g1 rooms bind all accepted context through AEAD, an account-authorized individual device signature and a creator publication receipt. Possession of the shared group key alone cannot establish another member's authorship.
- **Membership/key epochs:** creator-authorized membership changes rotate fresh keys and individually seal them to retained devices. Sealed proposals and a shared publication/rekey CAS prevent a stale sender from publishing new plaintext under a revoked old key. Epoch pins survive restart.

## Verification

Fresh local verification at the production revision above; the following handoff commit changes no executable code. Evidence logs and patch artifacts are deliberately outside tracked source.

| Check | Result | Classification |
| --- | --- | --- |
| Focused security tests | **148 passed, 11 files passed**, exit 0; 93 DM + 55 group | PASS |
| `npm test` | **630 passed, 3 failed assertions**; **56 passed / 9 failed files**, 65 total; exit 1 | PRE-EXISTING failures; identical failure-name list to the completed group-pass baseline |
| `node node_modules/vue-tsc/bin/vue-tsc.js --noEmit` | **313 diagnostics**, exit 2; normalized comparison: **0 added, 0 removed** | PRE-EXISTING |
| `npm run build` | Exit 0; Vite completed in **17.39 s**; PWA `generateSW` completed, **133 precache entries**, both service-worker outputs generated | PASS; prior stall did not reproduce |
| `git diff --check` and branch-delta whitespace check | No errors | PASS |
| Lint | ESLint unavailable in the installed environment, unchanged; no auto-fix run | ENVIRONMENTAL / unavailable |

Full-suite failures: seven suites fail during Gun import with `document is not defined` (`critical2-e2e`, `gunServiceReconnect`, `meshWireBridge`, `postVoteTally`, `voteTallyService`, `voteTierService`, `webrtcAnonymity`); `outboxService.test.ts` imports absent `src/services/outboxService`; `moderationService.test.ts` has the three failing assertions. These failures remain visible. No newly introduced verification failure was observed. A merge policy requiring a fully green suite/typecheck is not satisfied by this baseline.

Exact focused command:

```sh
node node_modules/vitest/vitest.mjs run --config unit_tests/vitest.config.ts unit_tests/ratchetSecurity.test.ts unit_tests/bootstrapSecurity.test.ts unit_tests/mediaSecurity.test.ts unit_tests/deliverySecurity.test.ts unit_tests/identityPrekeySecurity.test.ts unit_tests/identityPrekeyIntegration.test.ts unit_tests/identityPrekeyBaseline.test.ts unit_tests/sessionEpochSecurity.test.ts unit_tests/receiveStateSecurity.test.ts unit_tests/groupSecurity.test.ts unit_tests/groupLegacySecurity.test.ts
```

Tests use local doubles/fake IndexedDB. Passing them is evidence for the exercised properties, not proof of production interoperability or complete protocol security.

## Compatibility

| Situation | Status | Exact boundary |
| --- | --- | --- |
| Upgraded client ↔ upgraded client | **SUPPORTED** | Matching current formats, valid account/device credentials and admissible local state; no deployed/native interoperability claim. |
| Upgraded client ↔ legacy client | **UNSUPPORTED** | No authenticated legacy-wire fallback for active DM or g1 group exchange. |
| Legacy DM sessions | **QUARANTINED / REQUIRES MIGRATION** | v3/v4 state is retained, not upgraded to v5 authority. Already-decrypted local history remains readable. A future explicit authenticated migration/approval procedure is required; there is no completed legacy re-handshake UI. |
| Legacy group rooms | **READ-ONLY / REQUIRES MIGRATION** | Existing local archive is unverified. New sends/joins are blocked. Create a new g1 room and explicitly reapprove current devices. |
| New authenticated DM sessions | **SUPPORTED** | v1 bundles and v5 epochs, one pinned device per peer account; replacement uses the documented parent-bound reset API. |
| New epoch group rooms | **SUPPORTED** | Approved devices, intact authoritative creator database and online creator for publication/membership operations; service APIs exist, approval UI does not. |
| Old encrypted media history | **READ-ONLY** | Saved decrypted inline/URL history remains renderable if bytes are available. No promise of fresh legacy-envelope decryption or compatibility with every obsolete descriptor. Previously exposed plaintext cannot become retrospectively confidential. |
| New encrypted media | **SUPPORTED** | v1 authenticated descriptor in accepted DM payload, correct retained media key and available ciphertext blob. |
| Pending/outbox messages created before upgrade | **QUARANTINED / REQUIRES MIGRATION** for legacy envelopes | Original v3/v4 bytes are retained and not silently re-encrypted. Current v5 envelopes retry immutably only under admissible epoch/context; old-epoch pending messages may require an explicit future application decision. Unencrypted pending rows still require valid current prerequisites. |
| Identity/prekey legacy state | **REQUIRES MIGRATION / QUARANTINED** | Local material can be lazily bound only by the actual account signer with consistency checks. Remote legacy bundles/pins never acquire authority from presence on disk. Missing or mismatched authority fails closed. |

## Rollout requirements

Coordinate client upgrades before enabling current authenticated exchanges. All writers sharing one database must implement the transaction contract; close old tabs/processes. Mixed-version active peers are unsupported. Do not advertise transparent backward compatibility.

New relationships with no conflicting legacy authority may initialize normally. Existing legacy DM relationships need a separately reviewed authenticated migration path; deleting stored pins, replay history or the database is not a safe migration instruction. Changed device/IK approval and session-reset user workflows remain absent. The reset protocol API is not automatic recovery authorization.

Legacy groups require new rooms, explicit current-device approval and rejoining; old keys/member lists are not migration authority. Public epoch-v1 invite pointers do not grant membership. The creator must be available for approvals, peer publications and revoking leaves. Owner loss requires trusted local restoration or a new room. Key-vault markers alone are not a group backup.

Never silently relabel legacy sessions, messages, delivery receipts, group rooms or membership as authenticated. Never recycle historical consumed OPK IDs or re-encrypt an immutable pending message merely to make it deliver. There is no global migration-complete flag or database schema-version bump; new namespaced records are initialized/validated at the relevant atomic operation.

## Known limitations

- No Signal-conformance, MLS-conformance, complete-E2EE or complete group-security claim.
- Account authority means the caller-selected public key. Human-name/account ownership is not independently verified; discovery cannot supply that missing assurance.
- No global relay OPK reservation/freshness guarantee. Different senders may select the same candidate; only one receiver consumption succeeds. Relays can suppress candidates before an explicit no-OPK bootstrap is formed.
- One pinned messaging device per account; no transparent multi-device fanout, device-change approval UI or general rotation workflow. Reset protocol API exists; reset UI does not.
- Legacy rooms remain read-only pending explicit new-room migration. Group approval UI is absent; password/bearer enrollment is not supported for new rooms.
- Groups require an honest single creator authority database/device and online publication approval. Cloned authority, owner equivocation, owner compromise, offline-authority fallback and ownership transfer are not solved.
- Revocation cuts over at the atomic authorization transition. Already-authorized old-epoch traffic may arrive later; previously obtained plaintext/keys cannot be revoked. Authorized members can leak keys. No ratcheted group forward secrecy or post-compromise recovery is claimed.
- Whole-database rollback/erasure and untrusted backup restoration are not protected. Key-vault exports alone do not preserve full group authority/state. Old writers bypassing the new storage contract are unsupported.
- Retention is bounded, not lossless: DM skipped keys allow a maximum gap of 1,000 and four receive-DH transitions; pending receive state is capped at 64 entries, 2 MiB total, 256 KiB per envelope and 24 hours. Exact policies are in the receive contract. Group limits are in the group contract. Pruned/stale traffic can be rejected.
- Replay/epoch authority history and OPK tombstones intentionally persist without time-based garbage collection. Global storage quotas and relay/Gun denial-of-service resistance are not established.
- Publication/receipt evidence does not prove human reading, durable remote retention forever or transport liveness. Censorship, metadata visibility and blob availability remain limitations.
- Production relay, native-platform and deployed mixed-version interoperability have not been tested. Browser-local test doubles do not establish those properties.
- Remaining findings F04, F12–F20 and F22 are outside this completed scope. Other community, voting, snapshot, trust and WebRTC subsystems were not remediated here.

## Review order

1. `docs/security/*`: begin with this handoff and `SECURITY_INVARIANTS.md`; read the five protocol contracts. Identity/prekey v4 sections are historical; the epoch contract and follow-up specify current v5.
2. `src/services/signalProtocol.ts`, with `dmIdentity.ts` and `dmSessionEpoch.ts`: authenticate authority, tentative state, CAS, key consumption and epoch transitions.
3. `src/services/chatService.ts`, `dmDelivery.ts`, `dmReceiveState.ts`: active integration, immutable retries, receipt predicates, acceptance transaction and quarantine.
4. `src/services/chatMediaService.ts`: every active upload path, AAD/descriptor and restored history.
5. `src/services/groupSecurity.ts`, `groupRoomTransport.ts`, `chatRoomService.ts`: creator publication barrier, individual authorship, key wraps, epoch pins and revocation races.
6. `src/services/storageService.ts`: transaction boundaries and conflict/failure behavior.
7. The 11 security test files and shared fixture: negative reproductions, concurrency, restart, failure injection and protocol boundaries.

## Reviewer-facing commit map

The 38-commit remediation sequence remains intact, including failing reproductions before their fixes. This final handoff is a separate documentation commit. No squashing or rewriting has been performed.

| Topic | Principal implementation and regression commits |
| --- | --- |
| A. DM identity and prekeys | `e3432a2`, `7ff13c2`, `aee4c73`, `772f949`, `928f9c0` |
| B. DM ratchet/state correctness | `28d412a`, `61061ef`, `0a4bae1`, `bfa8e6b`, `0684cc8`; epochs: `a078fe4`, `19e41bd`, `6c1fbf0`, `dd94f12`, `f870639`, `cb0c3da` |
| C. DM media and delivery evidence | `250cb4b`, `26f24c7`, `61fcabd`, `eb3323c`, `accd110`, `6f8c366`, `bf1585c`, `d995d9d`, `61f9edd` |
| D. Receive ordering/retries | `8d1e4f6`, `780c7e9`, `1a69588`, `e215086`, `c37ddba` |
| E. Group authentication | `4978599`, `c63fab7`, `22ac81c`, `645f52b`, `9a10c63` |
| F. Group membership/key epochs | `645f52b`, `22ac81c`, `73a5f83`; these overlap E because authorship and the publication/rekey barrier share the same authority transaction |
| G. Security documentation/tests | Contract and test commits above, plus `4dc2deb`, `c39903e` and this handoff; SI-01 through SI-26 map implementation to regressions |

## Changed-file classification

Every branch-changed file is classified below. No unrelated files were identified. No generated artifacts, logs, evidence, temporary files, patch outputs or local machine paths were added in this branch history. Pattern scanning found no credential/private-key-PEM/token matches; fixed test keys are public dummy fixtures, not deployed credentials. This is inspection evidence, not an exhaustive secret-scanner guarantee. Generated Android assets already tracked in the base are unchanged.

| File | Classification / reason |
| --- | --- |
| `src/services/chatMediaService.ts` | Required production — media AEAD and descriptors |
| `src/services/chatRoomService.ts` | Required production — active epoch-room integration and legacy quarantine |
| `src/services/chatService.ts` | Required production — authenticated DM integration, retries, media and receipts |
| `src/services/dmDelivery.ts` | Required production — exact envelope/receipt evidence |
| `src/services/dmIdentity.ts` | Required production — account/device/prekey chain and continuity |
| `src/services/dmReceiveState.ts` | Required production — pending/acceptance/dedup state |
| `src/services/dmSessionEpoch.ts` | Required production — epoch/reset/replay authority |
| `src/services/groupRoomTransport.ts` | Required production — sealed owner proposals and publication retry |
| `src/services/groupSecurity.ts` | Required production — authorship, key epochs and atomic transitions |
| `src/services/signalProtocol.ts` | Required production — transactional ratchets, OPKs and retained skipped keys |
| `src/services/storageService.ts` | Required production — coherent CAS and message acceptance |
| `src/types/social.ts` | Required production — typed delivery evidence |
| `src/views/ChatView.vue` | Required production — one media-type union correction for file attachments |
| `unit_tests/bootstrapSecurity.test.ts` | Required test — unauthenticated bootstrap state preservation |
| `unit_tests/deliverySecurity.test.ts` | Required test — delivery evidence and immutable retries |
| `unit_tests/dmIdentityFixture.ts` | Required test support — local authorized identity fixtures |
| `unit_tests/groupLegacySecurity.test.ts` | Required test — legacy group quarantine |
| `unit_tests/groupSecurity.test.ts` | Required test — group context/authorship/epochs/revocation/races |
| `unit_tests/identityPrekeyBaseline.test.ts` | Required test — baseline identity/prekey reproductions |
| `unit_tests/identityPrekeyIntegration.test.ts` | Required test — active identity/prekey integration |
| `unit_tests/identityPrekeySecurity.test.ts` | Required test — identity chain, continuity and OPK consumption |
| `unit_tests/mediaSecurity.test.ts` | Required test — relay-facing ciphertext and media authentication |
| `unit_tests/ratchetSecurity.test.ts` | Required test — concurrent ratchet consumers/retries/restart |
| `unit_tests/receiveStateSecurity.test.ts` | Required test — retention, retry/dedup and atomic receive |
| `unit_tests/sessionEpochSecurity.test.ts` | Required test — replay/reset/restart/simultaneous initiation |
| `docs/security/DM_DELIVERY_V1.md` | Required security documentation |
| `docs/security/DM_IDENTITY_PREKEY_V1.md` | Required security documentation |
| `docs/security/DM_RECEIVE_STATE_V1.md` | Required security documentation |
| `docs/security/DM_SESSION_EPOCH_V1.md` | Required security documentation |
| `docs/security/GROUP_SECURITY_V1.md` | Required security documentation |
| `docs/security/SECURITY_INVARIANTS.md` | Required security documentation |
| `docs/security/SECURITY_REMEDIATION_HANDOFF_2026-09.md` | Required security documentation — this handoff |
| `package.json` | Package/tooling — pinned fake IndexedDB test dependency only |
| `package-lock.json` | Package/tooling — matching dependency lock entry |

Totals including this handoff: **13 production, 12 test/support, 7 security documentation, 2 package/tooling, 0 unrelated**. No new runtime dependency is introduced.
