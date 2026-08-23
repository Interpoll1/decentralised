# CLAUDE.md


This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**InterPoll** is a decentralized, browser-first polling and discussion platform. No single company controls the data — polls, posts, comments, and votes are replicated across peers and relay servers, and all actions are cryptographically signed and tamper-evident.

See `README.md` for feature overview and `.github/copilot-instructions.md` for detailed guidance on each subsystem.

---

## Working Style

Deliver what was asked, at the scope intended. Make routine judgment calls yourself, and
check in only when different readings of the request would lead to materially different
work. If the request seems mistaken or a better approach exists, say so in a sentence and
continue with the task as asked rather than quietly narrowing, widening, or transforming
it. Finish the whole task, and stop short of actions that are clearly beyond what was asked.

---

## Quick Start

`./run.sh` starts all three services (frontend, WebSocket relay, GunDB relay) in tmux panes.
See `README.md` for environment variable configuration.

---

## Core Architecture

Three runtime layers, each with a different trust property:

1. **Local blockchain (IndexedDB)** — `ChainService` + `chainStore`. Signed by your device key; **impossible to forge from a relay**.
2. **Distributed content graph (GunDB)** — replicated across every peer and relay; survives as long as any honest participant holds a copy.
3. **Peer sync layer** — `WebSocketService` (peers/blocks) + `BroadcastService` (cross-tab). The relay can delay or censor but **cannot forge** a signed action from your device.

Read `docs/protocol/IPP-00-overview.md` (index of the numbered IPP specification series) for the full technical specification. The old single-file `docs/protocol-whitepaper.md` is now a superseded redirect stub.

---

## Services & Stores

Services in `src/services/` are **static classes** — import and call directly: `ServiceName.method()`.
**Exception**: `ChatService` and `SearchService` are instance-based, not static.

Note `src/services/integritySevice.ts` (typo'd filename, hash/signature/PoW/replay validation) and
`src/services/integrityService.ts` (signature verification) are two distinct files — check which one you mean.

Stores call services; components and views consume stores. **Do not call services directly from components.**

---

## Important Conventions

### Configuration & Endpoints
- **Always use runtime config, never hardcode**: `import config from '@/config'`
- Access via: `config.relay.websocket`, `config.relay.gun`, `config.relay.api`
- Users can change relay URLs at runtime in Settings (persisted to `localStorage`)

### Gun Namespace
- All Gun roots are proxied under `GUN_NAMESPACE` (currently `v3` in `gunService.ts`)
- Callers use logical roots (e.g., `gun.get('polls')` not `gun.get('v3/polls')`)
- Adding a new root? Update `NAMESPACED_ROOTS` in `gunService.ts`

### Identity & Signing
- User/device signing keys: `KeyService` → IndexedDB metadata
- User profiles in GunDB: include public key + identity metadata (`identityUsername`, `identityIssuer`, `identityTrustLevel`)
- Display: real name if `showRealName` is true; otherwise deterministic pseudonym from `generatePseudonym(postId, authorId)`

### Anti-Fraud Layers
- Device fingerprinting (SHA-256 of browser properties)
- Two-phase vote authorization: `/api/vote-authorize` → `/api/vote-confirm`
- Invite codes (single-use, consumed atomically in GunDB)
- Optional OAuth gating (Google, Microsoft)
- Rate limiting and bot scoring on relay

---

## Subsystem Documentation

Each major subsystem has a `copilot-*.md` file with detailed contracts, patterns, and gotchas:

- `src/services/copilot-services.md` — Service dependencies, Gun query patterns, WebSocket message format
- `src/stores/copilot-stores.md` — Store state shape, mutation patterns
- `src/components/copilot-components.md` — Component composition, common patterns, event handling
- `src/views/copilot-views.md` — Page-level routing and state management
- `src/composables/copilot-composables.md` — Composition function utilities
- `src/types/copilot-types.md` — Core TypeScript interfaces
- `src/utils/copilot-utils.md` — Utility functions and helpers
- `src/router/copilot-router.md` — Routing structure and navigation
- `gun-relay-server/copilot-gun-relay-server.md` — GunDB relay configuration and operation

**When editing a subsystem, read and update its copilot-*.md file if contracts or behavior changed.**

---

## Vote Flow (High Level)

1. User submits a vote on a poll
2. A new block is created with vote payload + timestamp + user device key
3. Block is hashed (SHA-256) and linked to previous block
4. Block is signed with device key and saved to IndexedDB
5. Receipt with verification code is generated and shown to user
6. Block is broadcast to all peers via WebSocket and BroadcastChannel
7. Relay receives block and issues a short-lived reservation token via `/api/vote-authorize`
8. Frontend confirms the vote with the token via `/api/vote-confirm` → vote is committed to relay registry
9. User can verify via Chain Explorer using the verification code

---

## Development Patterns

### Working with Gun
- Use `gunService.get()` and `gunService.set()` to wrap Gun operations
- Subscribe to changes: `gunService.on(path, callback)`
- All Gun writes go through the Gun namespace proxy automatically
- Query patterns and Gun sync semantics: see `src/services/copilot-services.md`

### Adding a New Service
1. Create `src/services/yourService.ts` as a static class
2. Implement methods and export the class
3. Import and call via `YourService.method()`
4. Document in `src/services/copilot-services.md`

### Adding a New Store
1. Create in `src/stores/yourStore.ts` using `defineStore()`
2. Define state, getters, actions
3. Actions call services; do not call services from components directly
4. Document state shape and action contracts in `src/stores/copilot-stores.md`

### Working with Private Communities
- Encryption/decryption via `EncryptionService`
- Keys stored in `KeyVaultService`
- Invite links generated and verified via `InviteLinkService`
- Private community state: `CommunityStore`

---

## Relay Server

**Development:** `node relay-server.js` — WebSocket relay + OAuth + vote authorization.
Endpoints and env vars are defined in that file; frontend `VITE_*` build vars are in `src/config.ts`.

**Production:** `relay-server/relay-server-enhanced.js` is **gitignored** — it will not appear in
`ls` or git diffs, but it is the code actually running in production (via PM2), with a persisted
vote registry. Changes to the dev relay do not reach production automatically.

---

## Common Gotchas

1. **Always check relay URLs at runtime** — users may change them in Settings. Use `config.relay.*` from `src/config.ts`.

2. **Gun operations are async** — use `await` or `.on()` subscriptions; `get()` does not return data immediately.

3. **Store actions call services** — components should not call services directly. Use stores.

4. **IndexedDB is persistent** — test data is not cleared between runs. Use DevTools to inspect.

5. **BroadcastChannel only syncs within the same origin** — separate tabs of different origins do not sync.

6. **Private community keys are local only** — if you lose your key, data is unrecoverable (by design).

7. **Vote two-phase flow is strict** — `/api/vote-authorize` issues a token, `/api/vote-confirm` commits it. Skipping either step fails the vote.

8. **Device fingerprinting is deterministic** — the same browser on the same device gets the same fingerprint. Clear browser data to reset.

---

## Desktop App (Tauri) — in progress

`src-tauri/` is a Cargo workspace building a native desktop shell that reuses the
existing Vue UI. The goal is the things a browser structurally cannot do: seed
from the tray with the window closed, keep unlimited history with offline search,
reach peers directly over the LAN, seal the signing key outside JS, and route
over Tor (via `arti`) while publishing the embedded relay as an onion service.

Platform differences live behind the `@platform` seam — see the "platform-adapter
seam" section of `src/services/copilot-services.md` before touching
`src/config.ts`, `src/main.ts` or `src/services/storageService.ts`.

- `npm run dev:desktop` / `npm run build:desktop` (needs a Rust toolchain)
- **Linux build deps:** `libwebkit2gtk-4.1-dev libgtk-3-dev
  libayatana-appindicator3-dev librsvg2-dev libsoup-3.0-dev build-essential`
- Phase 0 (shell, seam, tray, settings) is done. Storage, the Rust Gun wire
  implementation, the embedded relay hub, key sealing, native P2P and Tor are
  phased in behind the seam; the frontend does not change when they land.
- `src-tauri/crates/ip-crypto/` — canonical JSON, verified byte-for-byte against
  `shared-validation/canonical.js`. **Never** "simplify" it to `serde_json` or an
  RFC 8785 crate; both format numbers differently from `JSON.stringify` and would
  silently break signatures on the live network.

---

## Monorepo Note

This repo contains:
- **Main frontend** (Vite + Vue 3 + Pinia) — this directory
- **Desktop shell** — `src-tauri/` (Tauri v2 + Rust, gitignored build output)
- **Relay server** — `relay-server.js` and `relay-server/` (production version)
- **GunDB relay** — `gun-relay-server/`
- **Shared validation** — `shared-validation/` (used by both frontend and relay)

The relay server production code (`relay-server/`) is gitignored to avoid breaking changes in git diffs. It still runs in production via PM2.

---

## See Also

- `README.md` — Feature overview, threat model, quick start
- `docs/protocol/IPP-00-overview.md` — Numbered IPP specification series (supersedes `docs/protocol-whitepaper.md`)
- `.github/copilot-instructions.md` — Subsystem-specific guidance
- `unit_tests/` — Example tests and Vitest configuration
