# P2P 1:1 Video Call Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 1:1 audio/video calls from the DM view, media peer to peer over WebRTC, coturn fallback.

**Architecture:** New `callService.ts` owns one `RTCPeerConnection` per call and a pure state machine (`callMachine.ts`). Signaling reuses `SignalingService` (signed envelopes) with new `call-*` kinds routed away from the mesh handler. `callStore` exposes state; `CallOverlay.vue` is mounted in `App.vue`. Relay issues HMAC TURN credentials.

**Tech Stack:** Vue 3, Pinia, Vitest (`unit_tests/`), WebRTC, coturn, Node relay (`relay-server/`).

**Spec:** `docs/superpowers/specs/2026-10-10-p2p-video-call-design.md`

## Global Constraints

- Branch `feat/p2p-video-call`; commit trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Components use stores; stores call services. No hardcoded relay URLs: use `config` (`@/config`).
- TypeScript strict, `noUnusedLocals/Parameters` errors. Run `npm run lint` and `npm test` before each commit.
- Calls use WSS and Gun signaling tiers only, never the mesh-flood tier.
- Anonymity Mode (`config.getIceServers()` returns `[]`): calls refuse to start/accept.
- Invite TTL 30 s; ICE connect timeout 15 s; disconnected grace 5 s; max 3 invites/min per sender; one active call per user.
- Legacy `offer|answer|ice` envelope signing format must stay byte-identical (old clients must still verify).
- Relay never sees the TURN secret in client code; credentials TTL 1 h.

## Review Focus

- Call signal replayed into a different call/target: must be rejected (callId + target are signed).
- `call-*` signal arriving at `WebRTCService.handleSignal`: must never happen.
- Both users call each other simultaneously (glare): exactly one call survives (lower pubkey's invite wins).
- Permission denied / no camera: call aborts cleanly, local tracks released, `call-end` sent if already invited.
- Invite from a blocked/unknown sender or flood: no ring, no state change.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src/services/signalingService.ts` (modify) | `call-*` kinds, signed `callId`/`meta`, call listeners, no mesh tier for calls |
| `src/services/webrtcService.ts` (modify) | ignore `call-*` signals |
| `src/services/callMachine.ts` (create) | pure reducer: states, events, transitions |
| `src/services/callService.ts` (create) | media, RTCPeerConnection, timers, signaling glue |
| `src/stores/callStore.ts` (create) | Pinia state + actions for UI |
| `src/components/CallOverlay.vue` (create) | ring dialog / in-call UI |
| `src/App.vue` (modify) | mount `CallOverlay` |
| `src/views/ChatView.vue` (modify) | call buttons in DM header |
| `src/config.ts` (modify) | `getTurnServers()` fetch + cache |
| `relay-server/routes.js` (modify) | `GET /api/turn-credentials` |
| `docs/ops/coturn.md` (create) | coturn install/config/firewall |
| `unit_tests/callSignaling.test.ts`, `callMachine.test.ts`, `callService.test.ts`, `turnCredentials.test.ts` (create) | tests |
| `e2e/call.spec.ts` (create) | two-context Playwright test |
| copilot docs + README (modify) | per CLAUDE.md |

---

### Task 1: Call signal kinds in SignalingService

**Files:**
- Modify: `src/services/signalingService.ts` (kinds ~L44, envelope ~L55-75, `buildEnvelope` ~L198, `verifyEnvelope` ~L226, `signingMessage` ~L267, `sendSignal` ~L159, `emit`/`onSignal` ~L135/L393)
- Modify: `src/services/webrtcService.ts:50`
- Test: `unit_tests/callSignaling.test.ts`

**Interfaces:**
- Produces: `type SignalKind = 'offer'|'answer'|'ice'|CallSignalKind`; `type CallSignalKind = 'call-invite'|'call-accept'|'call-decline'|'call-end'|'call-offer'|'call-answer'|'call-ice'`; `isCallKind(k): k is CallSignalKind`; `InboundSignal` gains `callId?: string; meta?: Record<string, unknown>`; `SignalingService.sendSignal(target, kind, payload & { callId?: string; meta?: Record<string, unknown> })`; `SignalingService.onCallSignal(cb): () => void`.

- [ ] **Step 1: Write failing tests** (`unit_tests/callSignaling.test.ts`)

```ts
import { describe, it, expect, vi } from 'vitest';
import { SignalingService, isCallKind } from '@/services/signalingService';

describe('call signaling', () => {
  it('isCallKind only matches call-*', () => {
    expect(isCallKind('call-invite')).toBe(true);
    expect(isCallKind('offer')).toBe(false);
  });

  it('call envelope signature binds callId and target', async () => {
    await SignalingService.initialize();
    const env: any = (SignalingService as any).buildEnvelope(
      { pubkey: 'a'.repeat(64) }, 'call-invite', { callId: 'c1', meta: { video: true } }, 'peerX');
    expect((SignalingService as any).verifyEnvelope(env)).not.toBeNull();
    expect((SignalingService as any).verifyEnvelope({ ...env, callId: 'c2' })).toBeNull();
    expect((SignalingService as any).verifyEnvelope({ ...env, targetPubkey: 'b'.repeat(64) })).toBeNull();
  });

  it('legacy offer envelope has no callId in signed bytes', async () => {
    await SignalingService.initialize();
    const env: any = (SignalingService as any).buildEnvelope({ pubkey: 'a'.repeat(64) }, 'offer', { sdp: { type: 'offer', sdp: 'x' } }, 'p');
    expect(env.callId).toBeUndefined();
    expect((SignalingService as any).verifyEnvelope(env)).not.toBeNull();
  });

  it('call signals go to onCallSignal, not onSignal', () => {
    const mesh = vi.fn(); const call = vi.fn();
    SignalingService.onSignal(mesh); SignalingService.onCallSignal(call);
    (SignalingService as any).emit({ kind: 'call-invite', remoteId: 'r', reply: {}, callId: 'c' });
    expect(call).toHaveBeenCalledOnce(); expect(mesh).not.toHaveBeenCalled();
  });

  it('call kinds never use the mesh tier', async () => {
    await SignalingService.initialize();
    const ok = await SignalingService.sendSignal({ pubkey: 'a'.repeat(64) }, 'call-invite', { callId: 'c' });
    expect(ok).toBe(false); // test env: no WSS, no Gun
  });
});
```

- [ ] **Step 2: Run** `npm test -- unit_tests/callSignaling.test.ts` → FAIL (`isCallKind` undefined).

- [ ] **Step 3: Implement**
  - Export `CallSignalKind`, widen `SignalKind`, add `export const isCallKind = (k: string): k is CallSignalKind => k.startsWith('call-')`.
  - `SignedSignal`/`ParsedSignal`/`InboundSignal`: add optional `callId: string` and `meta: string` (JSON on wire; parsed object on `InboundSignal`).
  - `buildEnvelope`: if `isCallKind(kind)`, add `callId: payload.callId ?? ''`, `meta: JSON.stringify(payload.meta ?? {})` to `body` **before signing**; otherwise omit both keys.
  - `signingMessage`: legacy array unchanged; when `body.kind` is a call kind, append `body.callId, body.meta` to the array.
  - `verifyEnvelope`: allow call kinds; for call kinds require `callId` matching `/^[0-9a-f]{32}$/` and `meta` ≤ 512 chars valid JSON; pass `callId`/`meta` into `body` for verification and into the returned `ParsedSignal`.
  - `sendSignal`: for `isCallKind(kind)` skip Tier 3 (mesh) entirely; WSS tier requires `target.peerId` (unchanged).
  - `onWssSignal`/Gun inbox/`handleRelayEnvelope` `emit({...})` calls: include `callId`, `meta` (parsed).
  - `emit`: if `isCallKind(sig.kind)` call `callListeners`, else `listeners`. Add `callListeners` set and `onCallSignal` mirroring `onSignal`.
  - `webrtcService.ts`: no change needed beyond confirming (via test) that call kinds do not reach its listener; add an early `if (isCallKind(sig.kind)) return;` in `handleSignal` as a belt-and-braces guard.

- [ ] **Step 4: Run** `npm test -- unit_tests/callSignaling.test.ts` and the full `npm test` → PASS (existing signaling tests unchanged).

- [ ] **Step 5: Commit** `git add src/services/signalingService.ts src/services/webrtcService.ts unit_tests/callSignaling.test.ts && git commit -m "feat(call): signed call-* signal kinds routed away from mesh"`

---

### Task 2: Call state machine (pure)

**Files:**
- Create: `src/services/callMachine.ts`
- Test: `unit_tests/callMachine.test.ts`

**Interfaces:**
- Produces:
```ts
export type CallState = 'idle'|'outgoing-ringing'|'incoming-ringing'|'connecting'|'in-call'|'ended';
export type EndReason = 'hangup'|'declined'|'busy'|'no-answer'|'cancelled'|'failed'|'unavailable'|'permission'|'disconnected';
export type CallEvent =
  | { t: 'start'; callId: string; peer: string; video: boolean }
  | { t: 'recv-invite'; callId: string; peer: string; video: boolean }
  | { t: 'accepted' } | { t: 'declined' } | { t: 'ice-connected' }
  | { t: 'ice-failed' } | { t: 'timeout' } | { t: 'remote-end' } | { t: 'local-end' }
  | { t: 'media-error' } | { t: 'reset' };
export interface CallContext { state: CallState; callId: string; peer: string; video: boolean; endReason?: EndReason; startedAt?: number }
export const INITIAL: CallContext;
export function reduce(ctx: CallContext, ev: CallEvent, now?: number): CallContext;
export function glareWinner(myPubkey: string, peerPubkey: string): 'me'|'peer';
```

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { INITIAL, reduce, glareWinner } from '@/services/callMachine';

const start = reduce(INITIAL, { t: 'start', callId: 'c', peer: 'p', video: true });
describe('callMachine', () => {
  it('outgoing happy path', () => {
    let c = start; expect(c.state).toBe('outgoing-ringing');
    c = reduce(c, { t: 'accepted' }); expect(c.state).toBe('connecting');
    c = reduce(c, { t: 'ice-connected' }, 1000); expect(c.state).toBe('in-call'); expect(c.startedAt).toBe(1000);
    c = reduce(c, { t: 'local-end' }); expect(c).toMatchObject({ state: 'ended', endReason: 'hangup' });
  });
  it('incoming ring → timeout = no-answer', () => {
    let c = reduce(INITIAL, { t: 'recv-invite', callId: 'c', peer: 'p', video: false });
    expect(c.state).toBe('incoming-ringing');
    expect(reduce(c, { t: 'timeout' })).toMatchObject({ state: 'ended', endReason: 'no-answer' });
  });
  it('declined / ice-failed / media-error / remote-end', () => {
    expect(reduce(start, { t: 'declined' }).endReason).toBe('declined');
    expect(reduce(reduce(start, { t: 'accepted' }), { t: 'ice-failed' }).endReason).toBe('failed');
    expect(reduce(start, { t: 'media-error' }).endReason).toBe('permission');
    expect(reduce(start, { t: 'remote-end' }).state).toBe('ended');
  });
  it('invite while busy is ignored (state unchanged)', () => {
    expect(reduce(start, { t: 'recv-invite', callId: 'z', peer: 'q', video: false })).toBe(start);
  });
  it('illegal events are no-ops; reset returns to idle', () => {
    expect(reduce(INITIAL, { t: 'accepted' })).toBe(INITIAL);
    expect(reduce(reduce(start, { t: 'local-end' }), { t: 'reset' })).toEqual(INITIAL);
  });
  it('glare: lower pubkey wins', () => {
    expect(glareWinner('a', 'b')).toBe('me');
    expect(glareWinner('b', 'a')).toBe('peer');
  });
});
```

- [ ] **Step 2: Run** `npm test -- unit_tests/callMachine.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement** `callMachine.ts` with a transition table keyed by `ctx.state`; unknown (state,event) returns `ctx` unchanged (same reference). `local-end` from `outgoing-ringing` → `cancelled`, from `incoming-ringing` → `declined`, otherwise `hangup`. `timeout` in either ringing state → `no-answer`; in `connecting` → `failed`. `ice-connected` sets `startedAt = now ?? Date.now()`. `glareWinner` = `myPubkey < peerPubkey ? 'me' : 'peer'`.

- [ ] **Step 4: Run** the test → PASS.

- [ ] **Step 5: Commit** `git commit -am "feat(call): pure call state machine" -- src/services/callMachine.ts unit_tests/callMachine.test.ts` (use `git add` first for the new files).

---

### Task 3: callService (media, peer connection, signaling glue)

**Files:**
- Create: `src/services/callService.ts`
- Modify: `src/config.ts` (add `getTurnServers`, Task 4 supplies the endpoint; here define the hook with a safe empty default)
- Test: `unit_tests/callService.test.ts`

**Interfaces:**
- Consumes: `reduce/INITIAL/glareWinner` (Task 2); `SignalingService.sendSignal/onCallSignal/getMyPubkey` (Task 1); `config.getIceServers()`.
- Produces:
```ts
export interface CallSnapshot extends CallContext { muted: boolean; cameraOff: boolean; localStream: MediaStream|null; remoteStream: MediaStream|null }
export class CallService {
  static init(): void;                                   // subscribe to onCallSignal once
  static subscribe(cb: (s: CallSnapshot) => void): () => void;
  static getSnapshot(): CallSnapshot;
  static start(peerPubkey: string, opts: { video: boolean }): Promise<void>;
  static accept(): Promise<void>;
  static decline(): void;
  static end(): void;
  static toggleMute(): void;
  static toggleCamera(): void;
  static isSupported(): boolean;                         // RTCPeerConnection && getUserMedia && getIceServers().length > 0
  static onCallLogged: ((entry: { peer: string; kind: 'completed'|'missed'|'declined'|'failed'; durationMs: number; video: boolean; outgoing: boolean }) => void) | null;
}
```

- [ ] **Step 1: Write failing tests** (mock `SignalingService`, `RTCPeerConnection`, `navigator.mediaDevices.getUserMedia`; fake timers). Cover:
  1. `start` sends `call-invite` with `meta.video` and a 32-hex `callId`; 30 s without `call-accept` → state `ended`/`no-answer` and `call-end` sent.
  2. Incoming `call-invite` while `busy` → sends `call-decline` `{reason:'busy'}`; snapshot unchanged.
  3. Incoming invite when `getIceServers()` returns `[]` (Anonymity Mode) → `call-decline` `{reason:'unsupported'}`, no ring.
  4. 4th invite from the same sender within 60 s → silently dropped.
  5. Glare: we are `outgoing-ringing` to P and P's invite arrives; if `glareWinner==='peer'` we abort ours (`call-end`) and ring for theirs; otherwise we ignore theirs.
  6. `getUserMedia` rejects → state `ended`/`permission`, no stream left running (`track.stop` called on any acquired tracks), `call-end` sent if invite was sent.
  7. Signals whose `callId` ≠ current call's are ignored.
  8. `end()` stops all local tracks, closes the peer connection, and invokes `onCallLogged` once.

- [ ] **Step 2: Run** `npm test -- unit_tests/callService.test.ts` → FAIL.

- [ ] **Step 3: Implement** `callService.ts`:
  - Private `ctx`, `pc`, `localStream`, `remoteStream`, `timers`, `inviteLog: Map<string, number[]>`; `dispatch(ev)` runs `reduce`, notifies subscribers, and on entering `ended` runs `teardown()` (stop tracks, `pc.close()`, clear timers, `onCallLogged`) then `setTimeout(() => dispatch({t:'reset'}), 3000)`.
  - `start`: guard `isSupported()` (else `dispatch media-error`→ `unavailable`); resolve target via the same peer-addressing the DM view uses (`{ pubkey }`, plus `peerId` if known from `WebSocketService` peer list); `getUserMedia({audio:true, video})`; `dispatch start`; `sendSignal(target,'call-invite',{callId,meta:{video}})` → if it returns `false` dispatch `remote-end` with reason `unavailable`; start 30 s ring timer.
  - On `call-accept` (outgoing): build `pc` (`iceServers: [...config.getIceServers(), ...(await config.getTurnServers())]`), add local tracks, `createOffer`, `setLocalDescription`, send `call-offer`; arm 15 s connect timer.
  - On `call-invite`: apply busy / unsupported / rate-limit / glare rules, else `dispatch recv-invite`, 30 s ring timer.
  - `accept()`: `getUserMedia`, send `call-accept`; on `call-offer` build `pc`, `setRemoteDescription`, `createAnswer`, send `call-answer`.
  - `pc.onicecandidate` → `call-ice`; incoming `call-ice` buffered until remote description set; `pc.ontrack` → `remoteStream`; `pc.oniceconnectionstatechange`: `connected|completed` → `ice-connected`, clear connect timer; `failed` → `ice-failed`; `disconnected` → 5 s grace timer → `remote-end` reason `disconnected`.
  - `decline`/`end` send `call-decline`/`call-end` then dispatch `local-end`. `toggleMute`/`toggleCamera` flip `track.enabled` and the snapshot flags.
  - Rate limit: keep timestamps per sender, drop if ≥3 in last 60 s.

- [ ] **Step 4: Run** `npm test -- unit_tests/callService.test.ts` and `npm run lint` → PASS.

- [ ] **Step 5: Commit** `git add -A src/services unit_tests && git commit -m "feat(call): CallService with media, ICE and signaling"` (stage only the files listed above, not the untracked `relay-push/.push-notifications.*.cjs`).

---

### Task 4: TURN credentials (relay + client + coturn doc)

**Files:**
- Modify: `relay-server/routes.js` (add route next to the existing `/api/vote-authorize` handler; follow its auth/rate-limit style)
- Modify: `src/config.ts`
- Create: `docs/ops/coturn.md`
- Test: `unit_tests/turnCredentials.test.ts`

**Interfaces:**
- Produces (relay): `GET /api/turn-credentials` → `{ urls: string[], username: string, credential: string, ttl: number }`; `makeTurnCredentials(secret, subject, now, ttlSec)` exported from a small helper module `relay-server/turn.js` so it is unit-testable.
- Produces (client): `config.getTurnServers(): Promise<RTCIceServer[]>` (cached until 60 s before expiry; returns `[]` in Anonymity Mode or on any fetch failure).

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
// @ts-ignore CJS helper
import { makeTurnCredentials } from '../relay-server/turn.js';

describe('makeTurnCredentials', () => {
  it('username is expiry:subject and credential is base64 HMAC-SHA1', () => {
    const c = makeTurnCredentials('s3cret', 'abcd', 1_000_000, 3600);
    expect(c.username).toBe(`${1000 + 3600}:abcd`);
    const exp = crypto.createHmac('sha1', 's3cret').update(c.username).digest('base64');
    expect(c.credential).toBe(exp);
    expect(c.ttl).toBe(3600);
  });
  it('different subjects give different credentials', () => {
    expect(makeTurnCredentials('k', 'a', 0, 60).credential).not.toBe(makeTurnCredentials('k', 'b', 0, 60).credential);
  });
});
```

- [ ] **Step 2: Run** `npm test -- unit_tests/turnCredentials.test.ts` → FAIL.

- [ ] **Step 3: Implement**
  - `relay-server/turn.js`: `makeTurnCredentials(secret, subject, nowMs, ttlSec)` returns `{ username: \`${Math.floor(nowMs/1000)+ttlSec}:${subject}\`, credential: HMAC-SHA1 base64, ttl: ttlSec }`.
  - `routes.js`: handler returns 503 when `TURN_SECRET`/`TURN_URLS` env is unset; subject = SHA-256 of the authenticated user id (or request IP hash for anonymous), rate-limit 10/min per subject using the existing limiter in that file. `urls` from `TURN_URLS` (comma list, e.g. `turn:turn.endless.social:3478,turns:turn.endless.social:5349`).
  - `config.ts`: `getTurnServers()` fetches `${config.relay.api}/api/turn-credentials`, maps to `[{ urls, username, credential }]`, caches with expiry; `[]` if `anonymityMode` or fetch fails.
  - `docs/ops/coturn.md`: install (`apt install coturn`), `/etc/turnserver.conf` with `use-auth-secret`, `static-auth-secret=<TURN_SECRET>`, `realm`, `listening-port=3478`, `tls-listening-port=5349`, cert paths, `min-port/max-port` (e.g. 49160-49200), `no-cli`, `no-multicast-peers`, `denied-peer-ip` for RFC1918/loopback ranges; ufw rules; `TURN_SECRET`/`TURN_URLS` env on the relay; note to use ONE multiplexed SSH session (VPS bans rapid reconnects).

- [ ] **Step 4: Run** the test and `npm test` → PASS. Do **not** deploy to the VPS in this task (separate, user-approved step).

- [ ] **Step 5: Commit** `git add relay-server/turn.js relay-server/routes.js src/config.ts docs/ops/coturn.md unit_tests/turnCredentials.test.ts && git commit -m "feat(call): relay-issued TURN credentials and coturn runbook"` (note: `relay-server/` may be gitignored; if `git add` refuses, use `git add -f` only for these two files after confirming with the user, and say so).

---

### Task 5: Store, overlay UI, DM entry point

**Files:**
- Create: `src/stores/callStore.ts`, `src/components/CallOverlay.vue`
- Modify: `src/App.vue` (mount overlay inside `<ion-app>`, after `GlobalCommandPalette`), `src/views/ChatView.vue` (call buttons in header; use the route `userId` as the peer)
- Test: `unit_tests/callStore.test.ts`

**Interfaces:**
- Consumes: `CallService` API (Task 3).
- Produces: `useCallStore()` with state `{ snapshot: CallSnapshot }`, getters `isActive`, `isRinging`, `supported`, actions `start(peer, video)`, `accept()`, `decline()`, `end()`, `toggleMute()`, `toggleCamera()`.

- [ ] **Step 1: Write failing tests**: store mirrors `CallService.subscribe` snapshots; actions delegate to the service; `supported` is `false` when `CallService.isSupported()` is false.

- [ ] **Step 2: Run** `npm test -- unit_tests/callStore.test.ts` → FAIL.

- [ ] **Step 3: Implement**
  - `callStore.ts`: `defineStore('call', …)`; call `CallService.init()` and `subscribe` on first use; keep `snapshot` in a `shallowRef`-style state so `MediaStream`s are not made deeply reactive.
  - `CallOverlay.vue`: fixed full-screen layer (above header/menus; z-index higher than existing menu fix in recent commit d5e463a) with three views: incoming ring (Accept / Decline), connecting/outgoing ("Calling…", Cancel), in-call (remote `<video autoplay playsinline>` full size, local `<video muted>` picture-in-picture, mute / camera / hang-up buttons, elapsed timer from `startedAt`). Bind streams via `ref` + `watchEffect` (`el.srcObject = stream`). Show `endReason` text for 3 s on `ended`. Use existing Tailwind/ion styles; no new dependencies.
  - `ChatView.vue`: two header buttons (voice / video) calling `callStore.start(userId, video)`, hidden when `!callStore.supported`, disabled while `callStore.isActive`.
  - `App.vue`: add `<CallOverlay />`.
  - DM system message: in `callStore` set `CallService.onCallLogged` to write a line through `ChatService.sendMessage`-compatible path used for system messages (inspect `chatService.ts` for an existing local-only/system message helper first; if none exists, store the entry locally and render it from `callStore.history` in `ChatView` — do **not** send a real chat message to the peer).

- [ ] **Step 4: Run** `npm test`, `npm run lint`, `npm run build` (type-check) → PASS. Manually: `npm run dev`, open two browsers, confirm ring/accept/hang-up on LAN.

- [ ] **Step 5: Commit** `git add src/stores/callStore.ts src/components/CallOverlay.vue src/App.vue src/views/ChatView.vue unit_tests/callStore.test.ts && git commit -m "feat(call): call store, overlay, DM call buttons"`

---

### Task 6: E2E test and docs

**Files:**
- Create: `e2e/call.spec.ts` (match the location/config of the existing DM e2e test; `rg -l "chromium.launch|playwright" --glob '!node_modules'` to find it)
- Modify: `src/services/copilot-services.md`, `src/stores/copilot-stores.md`, `src/components/copilot-components.md`, `README.md`, `docs/protocol/` (add call signal kinds to the signaling IPP doc)

- [ ] **Step 1: Write the e2e test**: two browser contexts launched with `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream`; user A starts a video call to B; B sees the ring and accepts; assert B's remote `<video>` has `videoWidth > 0`; mute toggles; A hangs up and both overlays close. Second test: B declines → A sees "declined". Third: B busy → A sees "busy".
- [ ] **Step 2: Run** the e2e against local dev servers (`./run.sh`) → PASS. Do not run it against the live site without asking the user.
- [ ] **Step 3: Update docs** as listed (contracts: new `SignalKind`s, `callId`/`meta` fields, `CallService` API, `callStore`, `CallOverlay`, TURN privacy note: VPS relays DTLS-SRTP-encrypted media and sees both IPs on fallback).
- [ ] **Step 4: Run** `npm run lint && npm test && npm run build` → PASS.
- [ ] **Step 5: Commit** `git add e2e docs src/**/copilot-*.md README.md && git commit -m "test+docs(call): e2e coverage and subsystem docs"`

---

## Out of band (needs the user, not part of the tasks)

- Deploy coturn + relay env vars to the VPS (manual, one SSH session) and verify with a symmetric-NAT pair.
- Merge/PR of `feat/p2p-video-call`.
