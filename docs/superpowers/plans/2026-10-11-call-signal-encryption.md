# Call Signal Encryption (Sealed Envelopes) Plan

**Status:** planned, not started (user: "plan it, don't do it now").

**Goal:** Call signals in the public Gun inbox `server-config/rtc-signal/<pubkey>` must not reveal SDP/ICE (IPs), call kind, callId or meta to observers.

**Also in scope:** the review finding that opening a DM link (`/chat#id=<pk>`) is enough to whitelist a caller.

## Design

- **Key agreement:** ephemeral-static ECDH on secp256k1 (`@noble/curves`, already a dependency).
  - The recipient's static key is their Schnorr x-only pubkey, lifted to the even-Y point (`02` + pubkey).
  - The sender generates an ephemeral keypair for each message.
  - `shared = secp256k1.getSharedSecret(ephPriv, '02'+recipientPk)`
  - `key = HKDF-SHA256(shared, salt=ephPub, info='interpoll-call-v1')`
- **Cipher:** AES-256-GCM via WebCrypto, with a random 12-byte IV.
- **Wire format:** `{ v:1, to:<recipientPk>, eph:<hex>, iv:<hex>, ct:<b64>, ts }`
  - Only `to` and `ts` stay in the clear. They're needed for routing and TTL cleanup.
  - The sender pubkey, kind and callId move inside `ct`.
- **Plaintext:** the existing signed envelope, unchanged.
  - The Schnorr signature is still verified after decryption, so authenticity and target binding stay as they are.
  - Encryption adds confidentiality only.
- **Scope:** encrypt only call kinds (`call-*`).
  - Legacy mesh `offer/answer/ice` stays as-is for now. It's a separate follow-up, because old clients read it.
- **Compatibility:** receivers accept only `v:1` sealed envelopes for call kinds and drop plaintext call envelopes.
  - Calls between an old client and a new client fail as "unavailable" until both reload. That's acceptable because the feature shipped only today.

## Tasks

1. **`src/services/callCrypto.ts`** (new, pure)
   - Functions: `seal(env, recipientPk) → sealed` and `open(sealed, myPriv) → env | null`.
   - Tests in `unit_tests/callCrypto.test.ts`:
     - round-trip
     - a wrong recipient fails
     - a tampered `ct`/`iv`/`eph` fails
     - no plaintext substrings (callId, `sdp`, sender pk) appear in the output
     - odd-Y recipient keys work (the lift is correct for x-only keys)
2. **`signalingService.ts`**
   - In the Gun send path for call kinds, `seal()` before the `put`.
   - In `subscribeGunInbox`, try `open()` first, then `verifyEnvelope`. Drop plaintext call kinds.
   - Tests in `callSignaling.test.ts`:
     - the Gun `put` payload contains no callId or SDP
     - the sealed envelope round-trips to a call listener
     - plaintext call-kind envelopes are dropped
3. **Known-caller gate fix** (`callStore.ts`, `ChatView.vue`)
   - Remove `markKnown` on DM open.
   - Mark a peer as known only when either:
     - there is at least one exchanged message (from the chat-list cache, or the first message sent or received), or
     - you start a call to them yourself.
   - Test: opening a DM to a stranger does not let them ring you.
4. **Docs**
   - IPP-06 §7: the sealed envelope format.
   - `copilot-services.md`.
   - `docs/ops/coturn.md`: update the privacy note.
5. **Verify**
   - Run `npm test` and `npm run build`.
   - Run the two-context e2e (`e2e/call.spec.mjs`) locally.
   - Then merge to master, push, and run `./deploy-ftp.sh`.

## Remaining leakage (accepted)

- Observers still see that *someone* wrote to recipient X's inbox, and when.
- The sender is hidden, but timing correlation is possible.
- With TURN fallback, the VPS still sees both IPs.

## Effort

About 1–1.5 h. Frontend only, so no VPS changes.
