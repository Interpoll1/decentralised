# Services — `src/services/`

> **Keep this file updated** whenever you add, remove, or significantly change a service.

All services are **static classes** — never instantiated with `new`. Initialize once at startup and call with `ClassName.method()`.

## Infrastructure / Core

| File | Class | Purpose |
|---|---|---|
| `gunService.ts` | `GunService` | GunDB wrapper. `initialize()` called in `main.ts`. All data roots (`posts`, `polls`, `communities`, `users`, `comments`, `events`, `chatrooms`, `server-config`) are transparently namespaced under `v2` via a Proxy. Use `GunService.getGun()` to get the proxied instance. Adding a new root requires adding it to `NAMESPACED_ROOTS`. |
| `storageService.ts` | `StorageService` | IndexedDB wrapper (`idb`). Stores: `blocks`, `votes`, `receipts`, `polls`, `metadata`, `encryption-keys`. DB name: `interpoll-db` v2. The `metadata` store is a generic key-value bag used by many other services. The `encryption-keys` store holds `StoredEncryptionKey` entries keyed by `id`. |
| `websocketService.ts` | `WebSocketService` | WebSocket peer connection to the relay server. Handles reconnection (exponential backoff, infinite retries), peer discovery, server list sharing, and message queuing when disconnected. Subscribe to message types via `.subscribe(type, callback)`. Also supports encrypted chat room message relay: `broadcastChatRoomMessage(roomId, data)` sends an opaque encrypted blob via the relay, and `subscribeToChatRoom(roomId, callback)` receives them with per-room multiplexing. `broadcast()` is async and automatically attaches proof-of-work for content messages (via dynamic import of `PowService`). `sendRaw(message)` sends a raw message bypassing PoW/broadcast wrapping. |
| `broadcastService.ts` | `BroadcastService` | Cross-tab sync via `BroadcastChannel('interpoll-sync')`. Same message types as WebSocket. Both channels are always wired in parallel in `chainStore`. |
| `webrtcService.ts` | `WebRTCService` | WebRTC P2P DataChannel service. Uses WebSocket relay only for signaling (`rtc-offer`, `rtc-answer`, `rtc-ice`). Once connected, peers exchange data directly. Opt-in via `localStorage('interpoll_webrtc_enabled')`. Uses Google STUN servers for NAT traversal. Degrades gracefully — app continues via relay if WebRTC fails. |
| `keyService.ts` | `KeyService` | Persistent secp256k1 Schnorr key pair, stored in IndexedDB metadata under `'nostr-keypair'`. Auto-generates if missing. Used for block signing and Nostr-style event signing. |
| `relayManager.ts` | `RelayManager` | Multi-relay endpoint manager with auto-failover. Stores relay list in localStorage (`interpoll_relay_list`). Supports health probing (WS + API), priority-sorted failover, and provides Gun peer URLs for all online relays. Uses dynamic imports for `WebSocketService`/`GunService` to avoid circular deps. |
| `relayHealthService.ts` | `RelayHealthService` | Relay connectivity diagnostics. Probes WebSocket, GunDB, and API endpoints with latency measurement. Includes Tor Browser detection heuristics and censorship analysis (blocked / reachable / torRequired categorization). |

## Blockchain

| File | Class | Purpose |
|---|---|---|
| `chainService.ts` | `ChainService` | Block creation, signing, validation, chain init/reset. Each block includes `previousHash`, `voteHash`, Schnorr `signature`, and `currentHash`. Legacy blocks (no `pubkey`) pass validation if hash-chain integrity holds. |
| `cryptoService.ts` | `CryptoService` | SHA-256 hashing (`@noble/hashes`), Schnorr sign/verify (`@noble/curves`), BIP-39 mnemonic generation, browser fingerprinting. |
| `voteTrackerService.ts` | `VoteTrackerService` | Device fingerprint (canvas + browser properties → SHA-256, stored in IndexedDB metadata as `'device-id'`). Tracks `vote-records` in metadata to prevent duplicate votes. |
| `powService.ts` | `PowService` | Client-side hashcash proof-of-work. Requests a challenge from the relay via WebSocket (`request-pow` → `pow-challenge`), solves it with SHA-256 mining (async loop with event-loop yielding), and returns `{ challengeId, nonce }` ready to attach to content messages. Concurrent calls are serialised via an internal queue. Used automatically by `WebSocketService.broadcast()` for PoW-required message types. |

## GunDB Domain Services

| File | Class | Purpose |
|---|---|---|
| `pollService.ts` | `PollService` | Poll CRUD, invite code generation/validation, vote recording in GunDB. Schnorr-signs polls on create (`authorPubkey`, `contentSignature`). Community/all-poll subscriptions use hydration-first loading with batch processing plus soft/hard timeouts to avoid startup hangs while preventing startup content from being treated as "new". Cold-start `loadPoll()` / `loadPollOptions()` now try Gun cache first, then wait for live Gun relay sync, then fall back to the gun-relay MySQL search endpoint (`/db/search?prefix=v2/polls/{id}`) and warm Gun cache from that result instead of relying on `/db/soul`. Encrypts poll content (question, options, description) via `EncryptionService`/`KeyVaultService` when community has an encryption key; `decryptPoll()` reverses at read time. Also calls `indexForSearch()` to push data to relay for full-text search. |
| `communityService.ts` | `CommunityService` | Community CRUD in GunDB. IDs are derived from lowercased name: `c-{slug}`. Signs community creation with Schnorr (via `CryptoService`/`KeyService`) for anti-sabotage; includes `verifyCommunitySignature()` to check integrity. Supports private encrypted communities via `createPrivateCommunity()` (AES-256-GCM encrypted metadata, password-derived or invite-only keys), `decryptCommunityMeta()` (decrypt using stored key), and `joinPrivateCommunity()` (join with invite key or password). `subscribeToCommunitiesLive()` now forwards repeat updates so member-count and metadata changes are not dropped after first load. Uses `EncryptionService`, `KeyVaultService`, and `InviteLinkService`. |
| `postService.ts` | `PostService` | Post CRUD in GunDB, image upload via `IPFSService`. Subscription loaders (`subscribeToPostsInCommunity`, `subscribeToAllPosts`) track initial hydration with idle/hard timeouts and per-item watchdogs so startup data loads reliably without false "new content" classification. Signs post content with Schnorr (via `CryptoService`/`KeyService`) for anti-sabotage verification; exposes `verifyPostSignature()` returning `'verified' | 'unverified' | 'unsigned'`. Encrypts post content (title, body, author info, images, signature) via `EncryptionService`/`KeyVaultService` when community has an encryption key; `decryptPost()` reverses at read time with HMAC authTag verification and type-validated decryption. |
| `commentService.ts` | `CommentService` | Comment CRUD in GunDB. Schnorr-signs comment content on create/edit for anti-sabotage verification (`authorPubkey`, `contentSignature`). Encrypts comment content via `EncryptionService`/`KeyVaultService` when community has an encryption key; `decryptComment()` reverses at read time. `verifyCommentSignature()` returns `'verified' | 'unverified' | 'unsigned'`. |
| `userService.ts` | `UserService` | User profile CRUD in GunDB, keyed by device ID. Exposes Schnorr public key for identity. Supports `customUsername`, `showRealName` toggle, and avatar images (`avatarIPFS`/`avatarThumbnail`). |
| `chatService.ts` | `ChatService` | **Instance-based** (not static). P2P DM chat over GunDB + WebSocket. Uses RSA-OAEP for message encryption between users. Each chat session needs `new ChatService(wsUrl, userId)`. |

## Media

| File | Class | Purpose |
|---|---|---|
| `ipfsService.ts` | `IPFSService` | Image compression (`browser-image-compression`) + GunDB storage. Name is historical — no actual IPFS. Full image max 1 MB / 1920px, thumbnails max 100 KB / 800px, both base64. CIDs are `img-{timestamp}-{random}`. `downloadImage()` retrieves full-res base64 from GunDB with a 10s timeout. |
| `chatMediaService.ts` | — | Media handling for chat (images in chat messages). |

## Encryption

| File | Class | Purpose |
|---|---|---|
| `encryptionService.ts` | `EncryptionService` | AES-256-GCM encryption/decryption via Web Crypto API. Key generation (random or PBKDF2 password-derived), base64/base64url key export/import for storage and invite links, and HMAC-SHA256 auth tags for anti-sabotage verification. No external dependencies. |
| `inviteLinkService.ts` | `InviteLinkService` | Invite link generation and parsing. Produces URLs in the format `{origin}/join/{type}/{id}#{base64url-key}` — the encryption key lives in the URL fragment so it is never sent to the server. Parses both full URLs and path-only strings back into `InviteLinkData`. Also provides `getKeyFromCurrentUrl()` for the join page and a `copyToClipboard()` helper with legacy fallback. |
| `keyVaultService.ts` | `KeyVaultService` | Manages encryption keys in IndexedDB (`encryption-keys` store). CRUD for `StoredEncryptionKey` entries keyed by community/chatroom ID. Supports filtering by type (`community`, `chatroom`, `server`), JSON export/import for key backup, and full vault clearing. Uses `StorageService.getDB()` for database access. |
| `chatRoomService.ts` | `ChatRoomService` | Encrypted group chat rooms over GunDB. Create password-protected or invite-only rooms with AES-256-GCM encrypted metadata and messages. Room keys stored locally via `KeyVaultService`; invite links carry the key in the URL fragment. Messages include HMAC auth tags for anti-sabotage verification. Provides `subscribeToMessages()` for live decrypted message streaming and `listJoinedRooms()` to enumerate rooms the user holds keys for. Static class. |

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
| `moderationService.ts` | `ModerationService` | Client-side content word filtering plus local image-filter settings. Settings persisted in localStorage (`moderation_settings`). Image filtering is disabled by default and supports `manual`, `detail-auto`, and `all-auto` scan modes. |
| `feedPreferencesService.ts` | `FeedPreferencesService` | Local-only personalized feed settings (mode, include/exclude keywords, muted/favorite communities, content-type toggles, ranking weights). Persists in localStorage (`interpoll_feed_preferences`). |
| `pinningService.ts` | `PinningService` | Storage quota and local caching policies for GunDB data. |
| `storageManager.ts` | — | Higher-level storage orchestration. |
| `snapshotService.ts` | `SnapshotService` | Full network snapshot export/import. Collects IndexedDB chain data (blocks, votes, receipts, polls) and GunDB data (posts, communities, comments, users, events) into a single `NetworkSnapshot` JSON. Import writes data back to both stores. Includes `downloadSnapshot()` for browser file download and `parseSnapshotFile()` for validated file upload. |
| `snapshotSyncService.ts` | `SnapshotSyncService` | Peer-to-peer snapshot transfer over WebSocket. Implements a chunked (32 KB) offer→accept→chunks→complete protocol with SHA-256 integrity verification, structural validation, size limits (50 MB), transfer timeout (2 min), and progress callbacks. Uses dynamic imports for `WebSocketService` to avoid circular deps. |
| `mnemonicService.ts` | — | Mnemonic receipt lookup helpers. |
| `webrtcService.ts` | — | WebRTC peer connection utilities (direct P2P). |
| `dbWarmup.ts` | — | Pre-warms IndexedDB on startup to avoid first-access lag. |
