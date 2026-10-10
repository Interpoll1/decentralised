# P2P 1:1 Video Call — Design

Date: 2026-10-10 · Branch: `feat/p2p-video-call` · Status: draft, awaiting review

## Goal

Direct 1:1 audio/video calls between two users from the DM (Messages) UI. Media flows
peer to peer over WebRTC. No media server. Signaling reuses the existing signed
`SignalingService`. Signaling is shaped so group calls (mesh) can be added later
without a rewrite.

## Decisions (from brainstorming)

| Topic | Decision |
|-------|----------|
| Scope | 1:1 in DMs now; one `CallSession` per remote peer so a mesh can come later |
| NAT fallback | Self-hosted **coturn** on the VPS; relay issues short-lived HMAC credentials |
| Notification | In-app ring only. Callee must have a tab open. Otherwise caller sees "unavailable" and a missed-call message is written to the DM |
| Anonymity Mode | Calls disabled (`config.getIceServers()` already returns `[]`) |
| Concurrency | One active call per user. A second invite is auto-declined (`busy`) |

## Non-goals (v1)

Group calls, screen share, push-notification ringing, call recording, TURN for
third-party providers, call history UI beyond a DM system message.

## Architecture

Calls get their **own** `RTCPeerConnection`, separate from the data-channel mesh in
`webrtcService.ts`. Reusing mesh connections was rejected: renegotiating a connection
that carries sync traffic risks breaking sync when a call fails.

```
CallOverlay.vue (app root)  ──reads──▶  callStore (Pinia)
                                           │ actions
                                           ▼
                                      callService.ts (static)
                          ┌────────────────┼──────────────────┐
                          ▼                ▼                  ▼
                 SignalingService    RTCPeerConnection   getUserMedia
                 (signed envelopes)  (per CallSession)   (local tracks)
                          │
                 WSS / Gun / mesh tiers (existing)
```

Components follow the repo rule: views/components talk to `callStore`, the store calls
`CallService`.

### 1. Signaling (`signalingService.ts`)

Extend `SignalKind` with call kinds:
`call-invite | call-accept | call-decline | call-end | call-offer | call-answer | call-ice`.

Required changes, because `SignalingService` currently hands **every** inbound signal
to `WebRTCService.handleSignal` (`webrtcService.ts:50`):

- Inbound dispatch must route by kind: `offer|answer|ice` → `WebRTCService`;
  `call-*` → `CallService`. A call signal must never reach the mesh handler.
- Envelope gains an optional `callId` (random 128-bit, chosen by the caller) so
  signals are bound to one call. The envelope signature covers it.
- Call signals use the **WSS and Gun tiers only**. The mesh-flood tier is not used for
  calls (hop-flooding SDP for a real-time call adds latency and exposes call metadata
  to unrelated peers). If neither tier is up, `sendSignal` returns `false` and the
  caller sees "can't reach".
- Signal TTL: `call-invite` expires after 30 s; the same replay guard (`seen`) applies.

### 2. `callService.ts` (static class)

State machine per call:

```
idle ─invite─▶ outgoing-ringing ─accept─▶ connecting ─ICE connected─▶ in-call ─end─▶ ended
idle ─recv invite─▶ incoming-ringing ─accept─▶ connecting …
ringing ─decline/timeout(30s)/cancel─▶ ended
any ─ICE failed (15 s) / peer closed─▶ ended
```

- **Caller:** `startCall(peerPubkey, {video})` → `getUserMedia` → send `call-invite`
  → on `call-accept` create offer → `call-offer` → `call-answer` → trickle `call-ice`.
- **Callee:** on `call-invite` with a verified sender, ring (unless busy / blocked /
  Anonymity Mode → auto `call-decline`). On accept → `getUserMedia`, send
  `call-accept`, answer the offer.
- Only the **caller** creates the offer, so there is no glare. An invite arriving while
  we are already outgoing-ringing to the same peer is resolved by lower pubkey wins.
- ICE servers: `config.getIceServers()` plus relay-issued TURN credentials (see §4),
  fetched when the call starts.
- Tracks: audio always; video optional and togglable mid-call (`track.enabled`).
- On end: stop all local tracks, close the peer connection, clear timers, write a DM
  system message (`Call · 3:12`, `Missed call`, `Declined`).

### 3. `callStore` + UI

- `callStore`: `{ state, callId, peerPubkey, isVideo, muted, cameraOff, startedAt, error }`
  and actions `start`, `accept`, `decline`, `end`, `toggleMute`, `toggleCamera`.
- `CallOverlay.vue` mounted in `App.vue` so a call survives route changes: incoming
  ring dialog, in-call view (remote video full size, self-view picture-in-picture,
  mute / camera / hang-up), connecting and error states.
- A call button in the DM thread header. Hidden/disabled when Anonymity Mode is on or
  `RTCPeerConnection`/`getUserMedia` is unavailable.
- Permission-denied and no-device errors are shown in the overlay, not thrown.

### 4. TURN (coturn on the VPS)

- Install coturn on the VPS with `use-auth-secret` (REST-API credentials), TLS on 5349
  and UDP/TCP 3478, relay port range restricted and firewalled.
- Relay exposes `GET /api/turn-credentials` (auth: existing session or a signed request
  from the device key; rate-limited) returning
  `{ urls, username: "<expiry>:<pubkey-hash>", credential: HMAC-SHA1(secret, username), ttl }`
  with a 1 h TTL.
- The TURN shared secret is a new env var (`TURN_SECRET`) on the relay and coturn only;
  never shipped to the client.
- Privacy note for the README/settings: when a call falls back to TURN, the VPS relays
  **DTLS-SRTP encrypted** media and can see the two IPs and traffic volume, but not
  content. Direct (host/srflx) candidates are always preferred.
- If the credential fetch fails, the call proceeds with STUN only (direct attempts
  still work).

### 5. Security

- Every call signal is Schnorr-signed by the sender (existing envelope); the callee
  only rings for a verified `fromPubkey`, and `callId` + `targetPubkey` are inside the
  signed payload so signals can't be replayed into a different call or to a different
  target.
- Media is DTLS-SRTP (WebRTC default). Fingerprints travel in the signed SDP, so a
  relay can drop or delay a call but cannot MITM it.
- Spam control: rate-limit incoming invites per sender (e.g. max 3 / minute), ignore
  invites from blocked users, and require an existing DM thread or contact for a
  ring (unknown senders → silent decline + one-line notice).
- Anonymity Mode: `callService` refuses to start/accept; no ICE servers are ever
  requested.

### 6. Error handling

| Case | Behavior |
|------|----------|
| No signaling tier available | "Can't reach {user}" at invite |
| No answer in 30 s | Caller: "No answer"; callee: missed-call DM message |
| Permission denied / no device | Overlay error, call aborted, `call-end` sent if already invited |
| ICE fails in 15 s | "Couldn't connect" (TURN already included if available) |
| Peer tab closes mid-call | ICE `disconnected` → 5 s grace → ended |
| Busy | Auto `call-decline` with reason `busy` |

## Testing

- **Unit (Vitest, `unit_tests/`)**: state machine transitions incl. glare, timeouts,
  busy, Anonymity Mode refusal; signal dispatch (call kinds never reach
  `WebRTCService`); envelope signature binds `callId`/target; invite rate limit;
  TURN credential generation (relay) and expiry.
- **Integration (Playwright, two contexts, fake media devices)**: ring → accept →
  remote video track present → mute → hang up; decline; no-answer; busy. Run against
  the live site as in the existing DM e2e test.
- **Manual**: two networks behind symmetric NAT to verify TURN fallback.

## Docs to update when implementing

`src/services/copilot-services.md`, `src/stores/copilot-stores.md`,
`src/components/copilot-components.md`, README (feature + TURN privacy note), and a new
section in the IPP protocol docs for the call signal kinds.

## Open items for the implementation plan

- Confirm the exact relay file/endpoint layout for `/api/turn-credentials` (the root
  `relay-server.js` referenced in CLAUDE.md was not found at the repo root; check
  `relay-server/` and `relay-push/`).
- Confirm where the DM thread header lives (`ChatView.vue` vs `ChatRoomPage.vue`) and
  how DM system messages are written through `chatService`.
- coturn install/firewall steps on the VPS (manual deploy, one multiplexed SSH
  session — see SSH rate-limit note).
