# Stores — `src/stores/`

> **Keep this file updated** whenever you add, remove, or change a store.

All stores use the **Composition API form** of Pinia: `defineStore('name', () => { ... })`. Views/components consume stores; they do not call services directly.

## `chainStore.ts` — `useChainStore`

The most critical store. Owns the local blockchain.

- **Init**: Call `chainStore.initialize()` once on app start. It calls `BroadcastService.initialize()`, `RelayManager.initialize()`, `WebSocketService.initialize()`, `ChainService.initializeChain()`, then wires sync listeners for both channels.
- **Sync protocol**: On connect, sends `request-sync` with `lastIndex` (incremental — only fetches missing blocks). Responds to `sync-response` by validating and appending blocks in strict index order. Same-index hash conflicts and index gaps trigger incremental resync, but resync requests are now backoff-throttled and duplicate sync-warning logs are deduplicated to prevent console storms during relay/peer inconsistency; malformed or out-of-order blocks are dropped.
- Sync diagnostics: when `localStorage.interpoll_sync_debug === 'true'`, emits `[SyncDebug] chainStore diagnostics active` plus periodic heartbeat logs and per-second `[SyncRate]` metrics (`chain-new-block`, `chain-sync-request-sent`, `chain-sync-request-received`, `chain-sync-response-received`, `chain-sync-response-blocks`).
- **Voting**: `addVote(vote)` → creates block → broadcasts on both channels → saves receipt → calls `AuditService.logReceipt`.
- **Actions**: `addAction(actionType, data, label)` records non-vote events (community creation, post creation) as blocks.
- **Nostr events**: Every vote also creates and broadcasts a signed Nostr event via `EventService`.

Key refs: `blocks`, `isInitialized`, `chainValid`, `isWebSocketConnected`  
Key computed: `latestBlock`, `chainHead`

## `pollStore.ts` — `usePollStore`

Manages polls loaded from GunDB and cross-tab vote updates.

- Polls are keyed in a `Map<string, Poll>` for O(1) lookups.
- Subscribes to GunDB per community. Subscription lifecycle managed with `subscribedCommunities` + `unsubscribers` map — call `unsubscribe(communityId)` to clean up.
- During subscription updates, if an incoming poll patch is missing `communityId` but an existing cached poll has it, the store preserves the existing `communityId` to prevent the poll from disappearing from community-filtered views due to partial Gun records.
- Community poll loads now avoid treating local fallback cache as proof of an active live subscription: stale subscription state is cleaned and re-subscribed unless both subscription bookkeeping and community polls are already live, so network updates/deletes are not missed.
- Uses per-community initial-load tracking (`initialLoadDoneByCommId`) to avoid cross-community false "new poll" classification.
- Incoming poll updates are buffered in short flush windows (50 ms / 100 items) before being applied, with round-robin queue draining across communities so one hot stream does not starve others.
- Sync diagnostics: when `localStorage.interpoll_sync_debug === 'true'`, logs `[SyncRate] poll-incoming` and `[SyncRate] poll-flush` once per second with queue depth.
- `pendingNewPolls` only contains truly new arrivals after initial hydration; `flushNewPolls()` moves them into `pollsMap` and persists seen IDs in localStorage.
- Pagination: `visibleCount` incremented by `PAGE_SIZE` (10).
- `createPoll()` checks the current user's `showRealName` preference. Same pseudonym-vs-real-name logic as posts, and after success it broadcasts `poll-updated` over both `BroadcastService` and `WebSocketService` so newly created polls appear immediately in other tabs/peers even before Gun live subscriptions settle.
- After a successful `voteOnPoll()`, the store reloads the canonical poll from `PollService.loadPoll()` and then broadcasts `poll-updated` over both `BroadcastService` and `WebSocketService` so local tabs and online peers converge on the same Gun-backed totals immediately.

Key refs: `pollsMap`, `currentPoll`, `isLoading`, `visibleCount`  
Key computed: `polls`, `sortedPolls`

## `communityStore.ts` — `useCommunityStore`

- Has a **DB snapshot fallback** via the gun-relay's `/db/search?prefix={namespace}/communities` endpoint. If that DB endpoint is unavailable or returns no canonical community rows, it falls back again to `${config.relay.api}/api/communities`.
- The DB snapshot now merges with the API snapshot on every bootstrap pass, so communities missing from the bounded MySQL search still get hydrated into the list.
- `loadCommunities()` keeps a live Gun subscription active alongside the snapshot bootstrap so late-arriving communities continue to appear without waiting for a manual refresh.
- Post warmup re-puts into Gun remain disabled by default (`localStorage.interpoll_posts_warmup !== 'true'`) to avoid startup floods, but `loadCommunities()` now force-enables warmup when the feed is empty so users still recover posts without manual flags.
- Post warmup now has an **API fallback**: if `/db/search?prefix={namespace}/posts` is unavailable/empty, it retries with `${config.relay.api}/api/posts?limit=500` and hydrates `gun.get('posts')` in chunks.
- Community fallback now only accepts canonical top-level community nodes (`{namespace}/communities/{id}` where `id` starts with `c-`) and requires soul/id match, preventing nested poll nodes from being rendered as fake communities.
- `selectCommunity()` uses the same `/db/soul` fallback when Gun has no matching community, regardless of namespace version.
- The fallback relay base URL is derived from runtime config (`config.relay.gun`), not hardcoded, so Settings relay overrides and localhost/dev relays are respected.
- Fallback `/db/search` and `/db/soul` reads are timeboxed to avoid hanging community navigation when fallback relay requests are slow or blocked.
- Deduplicates with a `seen: Set<string>`.
- `joinedCommunities` is a `Set<string>` persisted in localStorage (`joined-communities`), then backfilled from the key vault so private invite/password joins survive refresh.
- Joined state is also synced from stored community encryption keys, so invite/password-joined private communities behave like normal joined communities after refresh.
- Encrypted communities are decrypted before surfacing when the user already has access, so joined private communities show their real names/descriptions instead of the public placeholder metadata.
- `joinCommunity()` is optimistic locally for normal joins, but first checks existing key-vault access and short-circuits without incrementing member counts when the user already holds the private-community key.
- Sync diagnostics: when `localStorage.interpoll_sync_debug === 'true'`, logs `[SyncRate] community-live` and `[SyncRate] fallback-post-warmup` once per second with event throughput.

## `postStore.ts` — `usePostStore`

- Similar structure to `pollStore`: map-based, per-community subscriptions, pagination.
- Uses per-community initial-load tracking (`communityInitialLoadDone`) plus subscription timestamps to avoid false "new post" banners from startup hydration.
- Incoming post updates are buffered in short flush windows (50 ms / 100 items) before applying to `postsMap`, using round-robin queue draining across communities to avoid starvation under bursty sync.
- `pendingNewPosts` is banner-only state; accepted posts live in `postsMap` and seen IDs are persisted (`seen-post-ids`) so accepted content survives refresh.
- `createPost()` checks the current user's `showRealName` preference. If false (default), generates a pseudonym from the pre-generated postId + authorId as the `authorName`. If true, uses the user's `customUsername`.
- `createPost()` now also enforces community membership via locally persisted joined-community state and throws `COMMUNITY_JOIN_REQUIRED` for non-members, preventing invalid post attempts from composer/direct route calls.
- Post vote totals now stay live for already-loaded posts: community subscriptions no longer ignore repeat post IDs after initial hydration, so vote/score updates for existing posts keep flowing into `postsMap` instead of getting dropped as duplicate IDs.
- Post vote mutations now broadcast `post-updated` over both sync channels, so other tabs/peers refresh like-for-like counts immediately instead of waiting on a stale feed refresh.
- `loadMorePosts()` still paginates by `PAGE_SIZE` (10), but Home feed now controls initial visibility separately (up to 50 items) so users do not need an initial scroll to reveal already-fetched content.
- Debug instrumentation logs `[PostStoreDebug]` entries for community subscription start/initial completion, injected posts, and visible-count changes to help diagnose feed hydration issues (enabled only when `localStorage.interpoll_post_debug === 'true'`).
- Sync diagnostics: when `localStorage.interpoll_sync_debug === 'true'`, logs `[SyncRate] post-incoming` and `[SyncRate] post-flush` once per second with queue depth.

## `commentStore.ts` — `useCommentStore`

- Loads and caches comments keyed by post ID.
- `createComment()` checks the current user's `showRealName` preference. Same pseudonym-vs-real-name logic as posts.

## `userStore.ts` — `useUserStore`

- Simple profile cache: `profiles: Record<string, UserProfile>`. Fetches from `UserService` on miss.
- `getProfile()` now deduplicates concurrent fetches per user ID with an in-flight promise map, so components requesting the same profile at once share one network read.
- `getCachedKarma(userId)` — used by `useModerationFilter` to hide low-karma content without a network fetch.

## `chatRoomStore.ts` — `useChatRoomStore`

Manages encrypted chat rooms via `ChatRoomService`.

- **Room lifecycle**: `loadRooms()` fetches joined rooms, `createRoom()` / `joinRoom()` add to the list, `leaveRoom()` removes.
- **Live messaging**: `enterRoom(room)` subscribes to incoming messages via `ChatRoomService.subscribeToMessages`; `leaveCurrentRoom()` unsubscribes and clears state.
- **Deduplication**: Both `enterRoom` and `sendMessage` guard against duplicate message IDs before pushing.

Key refs: `rooms`, `currentRoom`, `messages`, `loading`, `error`
Key computed: `sortedMessages` (chronological order)

## `syncStore.ts`

Currently empty/placeholder.
