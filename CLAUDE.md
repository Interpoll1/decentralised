# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**InterPoll** is a decentralized, browser-first polling and discussion platform. No single company controls the data — polls, posts, comments, and votes are replicated across peers and relay servers, and all actions are cryptographically signed and tamper-evident.

See `README.md` for feature overview and `.github/copilot-instructions.md` for detailed guidance on each subsystem.

---

## Quick Start

```bash
# Start all three services in tmux panes (recommended)
chmod +x run.sh
./run.sh

# Or manually run each:
npm run dev              # Vite frontend at http://localhost:5173
node relay-server.js     # WebSocket relay at ws://localhost:8080
cd gun-relay-server && node gun-relay.js  # GunDB relay at http://localhost:8765/gun
```

Frontend listens at `http://localhost:5173`. See `README.md` for environment variable configuration.

---

## Core Architecture

InterPoll has three runtime layers:

1. **Local blockchain (IndexedDB)** — `ChainService` + `chainStore`
   - Tamper-evident vote and action history
   - Each block links to the previous one via cryptographic hash
   - Signed by your device key; impossible to forge from a relay

2. **Distributed content graph (GunDB)** — `GunService`, `PollService`, `PostService`, `CommentService`, etc.
   - Polls, posts, comments, communities, user profiles, images, chat rooms
   - Replicated across every connected peer and relay server
   - Survives as long as any honest participant holds a copy

3. **Peer sync layer** — `WebSocketService`, `BroadcastService`
   - WebSocket relay discovers peers and broadcasts new blocks in real time
   - BroadcastChannel syncs chain state across browser tabs
   - Relay can delay/censor but **cannot forge** a signed action from your device

Read `docs/protocol-whitepaper.md` for the full technical specification.

---

## Build, Test, Lint

| Command | Purpose |
|---------|---------|
| `npm run dev` | Start Vite dev server at `http://localhost:5173` |
| `npm run build` | Type-check + production build to `dist/` |
| `npm run preview` | Serve the built `dist/` folder locally |
| `npm run lint` | ESLint with auto-fix on `.vue`, `.ts`, etc. |
| `npm test` | Run Vitest test suite (see below) |
| `npm run test:watch` | Vitest in watch mode |

**Run a single test:**
```bash
npm test -- unit_tests/pow-challenge.test.js
npm test -- -t "requiresPow"
```

**Type checking:**
- `npm run build` includes full TypeScript checking.
- No separate type-check command; linting catches most issues.

---

## Project Layout

```
src/
  components/          UI components (VoteForm, PollCard, PostCard, etc.)
  views/               Page-level components (HomePage, PollDetailPage, etc.)
  services/            Core business logic — blockchain, GunDB, crypto, storage
  stores/              Pinia state stores (chainStore, pollStore, communityStore, etc.)
  router/              Vue Router configuration
  composables/         Reusable Vue 3 composition functions
  types/               TypeScript interfaces and types
  utils/               Helper functions and utilities
  config.ts            Runtime-mutable relay URLs and app configuration
  main.ts              Vue app initialization
  App.vue              Root component
  style.css            Global Tailwind + custom CSS

relay-server.js                       Dev WebSocket relay + OAuth + vote authorization
relay-server/relay-server-enhanced.js Production relay with persisted vote registry (gitignored)
gun-relay-server/                     GunDB relay standalone server
unit_tests/                           Test files (*.test.ts)
docs/protocol-whitepaper.md           Full technical specification
.github/copilot-instructions.md       Detailed subsystem guidance
```

---

## Key Services

Each service is a static class unless noted otherwise. Import and call directly: `ServiceName.method()`.

| Service | Purpose |
|---------|---------|
| `chainService.ts` | Block creation, hashing, signing, chain validation |
| `gunService.ts` | GunDB read/write/subscribe wrapper |
| `websocketService.ts` | WebSocket connection, peer discovery, relay failover |
| `broadcastService.ts` | Cross-tab sync via BroadcastChannel API |
| `pollService.ts` | Poll CRUD, invite code generation and validation |
| `postService.ts` | Post publishing and retrieval |
| `commentService.ts` | Threaded comments on polls and posts |
| `voteTrackerService.ts` | Device fingerprinting, duplicate-vote prevention |
| `auditService.ts` | OAuth login/logout, backend vote authorization |
| `cryptoService.ts` | SHA-256 hashing, verification code generation |
| `storageService.ts` | IndexedDB wrapper for blocks, votes, receipts |
| `encryptionService.ts` | AES-256-GCM encryption for private communities |
| `keyVaultService.ts` | Local key storage, export/import |
| `integritySevice.ts` | Hash/signature/PoW/replay-attack validation |
| `integrityService.ts` | Signature verification and message validation |
| `inviteLinkService.ts` | Private community invitation link generation and verification |
| `chatService.ts` | Instance-based chat message service |
| `searchService.ts` | Instance-based search across polls and posts |

**Exception**: `ChatService` and `SearchService` are instance-based, not static.

---

## Key Stores (Pinia)

| Store | Purpose |
|-------|---------|
| `chainStore` | Local chain state, verification codes, receipts |
| `pollStore` | Poll data, results, user's own polls |
| `communityStore` | Community list, metadata, encryption keys |
| `userStore` | Current user profile, authentication state |
| `postStore` | Published posts and comments |
| `uiStore` | UI state — modals, notifications, settings |

Stores call services; components and views consume stores. Do not call services directly from components.

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

### Frontend Environment Variables
Set at build time with `VITE_` prefix:
- `VITE_WS_RELAY_URL` — WebSocket relay (default: `ws://localhost:8080`)
- `VITE_GUN_RELAY_URL` — GunDB relay (default: `http://localhost:8765/gun`)
- `VITE_API_BASE_URL` — Backend API (default: `http://localhost:8080`)

Example: `VITE_WS_RELAY_URL=wss://relay.example.com npm run build`

---

## Relay Server

**Development:** `node relay-server.js` starts a lightweight WebSocket relay + OAuth + vote authorization.

**Production:** See `relay-server/relay-server-enhanced.js` (gitignored; not in git diffs). This version adds:
- Persisted vote registry
- PM2 process management
- Enhanced logging and monitoring

**Key endpoints:**
- `GET /health` — health check
- `POST /api/vote-authorize` — issue reservation token for a vote
- `POST /api/vote-confirm` — commit vote to registry using token
- `/oauth/google/callback`, `/oauth/microsoft/callback` — OAuth callbacks
- `/gun` — GunDB relay proxy

Environment variables:
- `FRONTEND_ORIGIN` — CORS origin (default: `http://localhost:5173`)
- `SERVER_ORIGIN` — Public relay origin for OAuth callbacks (required HTTPS in production)
- `JWT_SECRET`, `VOTE_RESERVATION_SECRET` — HMAC secrets
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` — Google OAuth
- `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `MS_TENANT` — Microsoft OAuth

---

## TypeScript & Linting

- **Target:** ES2020
- **Strict mode:** ON (`strict: true`)
- **Unused variables/parameters:** Error (`noUnusedLocals`, `noUnusedParameters`)
- **No fallthroughs in switch:** Error
- **Linter:** ESLint with Vue plugin
  - Run with auto-fix: `npm run lint`
  - Scope: `.vue`, `.js`, `.jsx`, `.ts`, `.tsx`, and `.mts` files

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

## Monorepo Note

This repo contains:
- **Main frontend** (Vite + Vue 3 + Pinia) — this directory
- **Relay server** — `relay-server.js` and `relay-server/` (production version)
- **GunDB relay** — `gun-relay-server/`
- **Shared validation** — `shared-validation/` (used by both frontend and relay)

The relay server production code (`relay-server/`) is gitignored to avoid breaking changes in git diffs. It still runs in production via PM2.

---

## See Also

- `README.md` — Feature overview, threat model, quick start
- `docs/protocol-whitepaper.md` — Full technical specification
- `.github/copilot-instructions.md` — Subsystem-specific guidance
- `unit_tests/` — Example tests and Vitest configuration
