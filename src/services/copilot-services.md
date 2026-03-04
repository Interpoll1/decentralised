# Services — `src/services/`

> **Keep this file updated** whenever you add, remove, or significantly change a service.

All services are **static classes** — never instantiated with `new`. Initialize once at startup and call with `ClassName.method()`.

## Infrastructure / Core

| File | Class | Purpose |
|---|---|---|
| `gunService.ts` | `GunService` | GunDB wrapper. `initialize()` called in `main.ts`. All data roots (`posts`, `polls`, `communities`, `users`, `comments`, `events`) are transparently namespaced under `v2` via a Proxy. Use `GunService.getGun()` to get the proxied instance. Adding a new root requires adding it to `NAMESPACED_ROOTS`. |
| `storageService.ts` | `StorageService` | IndexedDB wrapper (`idb`). Stores: `blocks`, `votes`, `receipts`, `polls`, `metadata`. DB name: `interpoll-db` v1. The `metadata` store is a generic key-value bag used by many other services. |
| `websocketService.ts` | `WebSocketService` | WebSocket peer connection to the relay server. Handles reconnection (exponential backoff, infinite retries), peer discovery, server list sharing, and message queuing when disconnected. Subscribe to message types via `.subscribe(type, callback)`. |
| `broadcastService.ts` | `BroadcastService` | Cross-tab sync via `BroadcastChannel('interpoll-sync')`. Same message types as WebSocket. Both channels are always wired in parallel in `chainStore`. |
| `keyService.ts` | `KeyService` | Persistent secp256k1 Schnorr key pair, stored in IndexedDB metadata under `'nostr-keypair'`. Auto-generates if missing. Used for block signing and Nostr-style event signing. |

## Blockchain

| File | Class | Purpose |
|---|---|---|
| `chainService.ts` | `ChainService` | Block creation, signing, validation, chain init/reset. Each block includes `previousHash`, `voteHash`, Schnorr `signature`, and `currentHash`. Legacy blocks (no `pubkey`) pass validation if hash-chain integrity holds. |
| `cryptoService.ts` | `CryptoService` | SHA-256 hashing (`@noble/hashes`), Schnorr sign/verify (`@noble/curves`), BIP-39 mnemonic generation, browser fingerprinting. |
| `voteTrackerService.ts` | `VoteTrackerService` | Device fingerprint (canvas + browser properties → SHA-256, stored in IndexedDB metadata as `'device-id'`). Tracks `vote-records` in metadata to prevent duplicate votes. |

## GunDB Domain Services

| File | Class | Purpose |
|---|---|---|
| `pollService.ts` | `PollService` | Poll CRUD, invite code generation/validation, vote recording in GunDB. Also calls `indexForSearch()` to push data to relay for full-text search. |
| `communityService.ts` | `CommunityService` | Community CRUD in GunDB. IDs are derived from lowercased name: `c-{slug}`. |
| `postService.ts` | `PostService` | Post CRUD in GunDB, image upload via `IPFSService`. |
| `commentService.ts` | `CommentService` | Comment CRUD in GunDB. |
| `userService.ts` | `UserService` | User profile CRUD in GunDB, keyed by device ID. Exposes Schnorr public key for identity. Supports `customUsername`, `showRealName` toggle, and avatar images (`avatarIPFS`/`avatarThumbnail`). |
| `chatService.ts` | `ChatService` | **Instance-based** (not static). P2P DM chat over GunDB + WebSocket. Uses RSA-OAEP for message encryption between users. Each chat session needs `new ChatService(wsUrl, userId)`. |

## Media

| File | Class | Purpose |
|---|---|---|
| `ipfsService.ts` | `IPFSService` | Image compression (`browser-image-compression`) + GunDB storage. Name is historical — no actual IPFS. Full image max 1 MB / 1920px, thumbnails max 100 KB / 800px, both base64. CIDs are `img-{timestamp}-{random}`. `downloadImage()` retrieves full-res base64 from GunDB with a 10s timeout. |
| `chatMediaService.ts` | — | Media handling for chat (images in chat messages). |

## Signing / Events

| File | Class | Purpose |
|---|---|---|
| `eventService.ts` | `EventService` | Nostr-compatible event creation and verification. Canonical serialization → SHA-256 ID → Schnorr sig. Event kinds: `100` poll create, `101` vote cast, `102` poll update, `103` post create. |
| `auditService.ts` | `AuditService` | Fire-and-forget backend calls: `logReceipt()` and `authorizeVote()`. Both fail silently — the app works offline. Calls `config.relay.api`. |

## Utilities / Support

| File | Class | Purpose |
|---|---|---|
| `searchService.ts` | `SearchService` | **Instance-based**. Full-text search via relay API (`/api/search`). 1-minute result cache. |
| `seoService.ts` | `SEOService` | Fetches posts/polls from GunDB for server-side SEO rendering. |
| `moderationService.ts` | `ModerationService` | Client-side content word filtering. Settings persisted in localStorage (`moderation_settings`). |
| `pinningService.ts` | `PinningService` | Storage quota and local caching policies for GunDB data. |
| `storageManager.ts` | — | Higher-level storage orchestration. |
| `mnemonicService.ts` | — | Mnemonic receipt lookup helpers. |
| `webrtcService.ts` | — | WebRTC peer connection utilities (direct P2P). |
| `dbWarmup.ts` | — | Pre-warms IndexedDB on startup to avoid first-access lag. |
