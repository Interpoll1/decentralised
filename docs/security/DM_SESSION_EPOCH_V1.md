# DM session epoch contract v1

## Authority and identifiers

The F01 account-authorized device binding remains the trust root. Wire v5 adds an epoch certificate signed by the initiating device's authorized messaging ECDSA key. This certificate is not authority merely because it is signed: the expected account/device chain, persisted continuity, parent and generation must all match.

Certificate canonical JSON array: ["interpoll/dm/epoch",1,generation,parentSessionId-or-null,authContext,bootstrapEphemeralKey,initialRatchetKey,signature]. Signature is canonical base64 P1363 ECDSA P-256/SHA-256 over UTF-8 JSON of the first seven fields. Session ID / bootstrap ID is lowercase SHA-256 hex of those same bytes (signature randomness and outer IDs/timestamps are excluded). authContext is the existing canonical identity/prekey context, including both account/device identities, IKs, SPK IDs/generations and explicit OPK selection/null. Every v5 message binds the complete certificate in AEAD AAD. Later ratchet messages retain it unchanged.

Generation is a positive safe integer. Initial generation is 1 with null parent, admissible only without previously recorded epoch authority or legacy session state. Replacement requires generation=current+1 and parent=current session ID, authenticated by the initiating device and successful ciphertext authentication. A public explicit reset API requires the caller to name the current session ID; no failure, missing state, changed DH, count threshold, discovery response or relay control can authorize reset. A device may authorize replacement of its own pair's session; this does not bypass identity continuity or authorize another device.

## Durable authority and replay

A directional per-account/peer epoch record stores current session ID, generation, candidate certificates, accepted incoming bootstrap IDs and receive-only simultaneous branches. Epoch metadata and cryptographic/session/OPK/accepted-message changes share one CAS transaction. Accepted bootstrap IDs and authority certificates have no time-based expiry; retain them for the lifetime of the local relationship. Deleting only ratchet state does not remove authority memory or allow generation 1 again. Whole database rollback/erasure is outside this local persistence guarantee.

An incoming bootstrap must match the certificate's initial ephemeral and DH keys and position n=0,pn=0. A bootstrap already accepted is rejected regardless of outer message ID, timestamp, transport or restart. An unaccepted historical generation cannot replace a newer generation. Ordinary messages require a known matching current certificate or an explicitly retained simultaneous branch. Missing ratchet state fails closed; it does not authorize implicit X3DH.

Validate identity/prekey chain, certificate signature and transition structure, then authenticate ciphertext on tentative state, then CAS all admissibility/history/state changes. Any failure commits nothing. Replays may be rejected earlier without decrypting; no rejected input changes durable state.

## Simultaneous initiation and replacement

Two opposite initiators may propose one candidate each for the same generation and parent. The candidate whose initiator account ID is lexicographically smaller wins. IDs are verified lowercase hex keys, so the ordering is stable and symmetric; arrival order, mutable metadata and random signatures cannot change it. Two different candidates from the same initiator for the same generation/parent are rejected. Sibling admission requires that the current authority is still that generation/parent; it cannot override a later generation.

A locally sent candidate is provisional until authenticated non-bootstrap peer traffic arrives on the selected current certificate. Local reset is forbidden until that confirmation is persisted (`settled`). A losing receive-only branch cannot supply confirmation. This prevents a device advancing a provisional losing candidate while a simultaneous winning bootstrap is delayed. An authenticated incoming successor referencing the current parent remains admissible. If the smaller-account candidate arrives later, atomically move the old ratchet into a receive-only branch and select the winner. If the incoming candidate loses, authenticate/accept its first message into a receive-only branch without changing the current session. Subsequent sends always use the winner once known. Receive-only branches allow in-flight messages from the losing candidate to arrive exactly once and cannot regain sending/replacement authority. Advancing to a later generation discards their key state; delayed traffic from older generations is rejected. Convergence assumes both valid bootstraps are eventually delivered; permanent transport loss cannot guarantee liveness.

## Reset, restart, devices and compatibility

The explicit reset API produces an immutable signed replacement bootstrap and commits it with generation/parent authority and outgoing journal. Retries reuse that envelope. A duplicate reset bootstrap is rejected, not a second transition. Concurrent opposite resets use the same sibling rule. A stale reset or a reset for an unrelated parent fails closed. No unauthenticated remote reset request exists. A reset cannot silently swap a pinned account/device/IK.

One pinned device per account remains the supported model; cross-device identity approval and multi-device fanout remain outside scope. Replay/epoch records survive process and IndexedDB reopen. No record expiry or garbage collection is introduced.

Legacy v3/v4 sessions and queued envelopes are preserved as LEGACY_UNAUTHENTICATED with respect to epoch authority, quarantined rather than promoted. There is no automatic migration that invents historical epoch continuity. Fresh installations may start generation 1; existing legacy relationships require a future explicit authenticated migration/approval procedure. This pass does not implement that UI or claim live relay/native compatibility.

This contract targets authenticated replay-resistant replacement and local epoch continuity only, not Signal compatibility, complete E2EE, database anti-rollback, transport liveness or delayed-key conformance outside this epoch boundary.

## Implementation, storage and exact AAD

`dmSessionEpoch.ts` verifies certificates and computes tentative authority transitions. `SignalSession.encrypt/resetSession/decrypt` commits `dm-session-epoch-v1:<localAccount>:<peerAccount>` alongside the existing ratchet, immutable envelope journal, OPK ledger and message acceptance using StorageService CAS. Record version 1 denotes authenticated epoch state; typed errors distinguish STALE, RESET_PENDING and LEGACY_UNAUTHENTICATED. Existing device/prekey binding formats remain unchanged.

v5 AEAD AAD is UTF-8 JSON.stringify(["interpoll/dm/message",5,senderIK,dh,n,pn,eph-or-null,opkId-or-null,auth,epochCertificate]). The receipt digest extends the existing v4 fields with epochCertificate. Bootstrap ID does not include ciphertext, signature randomness, outer message ID, timestamp or transport; those cannot manufacture another authority event.

Explicit local API: resetSession(plaintext, localBundle, peerBundle, expectedCurrentSessionId, immutableMessageId). Caller supplies a current authenticated available OPK selection or explicit no-OPK selection under the existing F07 rules. This pass provides the protocol API, not a reset approval UI or automatic recovery loop. An old outgoing envelope remains immutable after replacement; retransmitting it cannot make the recipient accept an old epoch. Such pending messages may require an explicit future application-level decision, not silent re-encryption.

Candidate certificates and accepted-ID history persist without expiry. Receive-only branch private ratchets remain until the next generation, so there is additional abandoned-branch key retention while allowing in-flight delivery; no stronger forward-secrecy claim is inferred. Complete DB deletion/backup rollback, old writers that bypass the new transaction contract, compromised authorized signing devices, and permanent transport suppression are not solved here. Upgrade every context sharing storage. A peer can authorize a successor under this contract; this is not proof of user consent or of device non-compromise.

The relay chat-start/chat-invite handlers no longer delete state; discovery is not reset authority. Legacy clearSession uses CAS against both legacy ratchet and absent epoch authority, preventing a concurrent authenticated initialization from being erased. Regression coverage: unit_tests/sessionEpochSecurity.test.ts. Existing v4 session semantics are historical and not backfilled with epoch trust.
