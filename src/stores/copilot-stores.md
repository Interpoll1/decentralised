# Stores — `src/stores/`

> **Keep this file updated** whenever you add, remove, or change a store.

All stores use the **Composition API form** of Pinia: `defineStore('name', () => { ... })`. Views/components consume stores; they do not call services directly.

## `chainStore.ts` — `useChainStore`

The most critical store. Owns the local blockchain.

- **Init**: Call `chainStore.initialize()` once on app start. It calls `BroadcastService.initialize()`, `WebSocketService.initialize()`, `ChainService.initializeChain()`, then wires sync listeners for both channels.
- **Sync protocol**: On connect, sends `request-sync` with `lastIndex` (incremental — only fetches missing blocks). Responds to `sync-response` by validating and appending blocks. Conflict resolution: same index + different hash → ignore remote block (local chain wins).
- **Voting**: `addVote(vote)` → creates block → broadcasts on both channels → saves receipt → calls `AuditService.logReceipt`.
- **Actions**: `addAction(actionType, data, label)` records non-vote events (community creation, post creation) as blocks.
- **Nostr events**: Every vote also creates and broadcasts a signed Nostr event via `EventService`.

Key refs: `blocks`, `isInitialized`, `chainValid`, `isWebSocketConnected`  
Key computed: `latestBlock`, `chainHead`

## `pollStore.ts` — `usePollStore`

Manages polls loaded from GunDB.

- Polls are keyed in a `Map<string, Poll>` for O(1) lookups.
- Subscribes to GunDB per community. Subscription lifecycle managed with `subscribedCommunities` + `unsubscribers` map — call `unsubscribe(communityId)` to clean up.
- Uses per-community initial-load tracking (`initialLoadDoneByCommId`) to avoid cross-community false "new poll" classification.
- `pendingNewPolls` only contains truly new arrivals after initial hydration; `flushNewPolls()` moves them into `pollsMap` and persists seen IDs in localStorage.
- Pagination: `visibleCount` incremented by `PAGE_SIZE` (10).
- `createPoll()` checks the current user's `showRealName` preference. Same pseudonym-vs-real-name logic as posts.

Key refs: `pollsMap`, `currentPoll`, `isLoading`, `visibleCount`  
Key computed: `polls`, `sortedPolls`

## `communityStore.ts` — `useCommunityStore`

- Has a **MySQL REST fallback** via the gun-relay's `/db/search?prefix=v2/communities` endpoint. Called when GunDB returns nothing (cold relay). This is the only store that hits the gun-relay's database endpoint directly.
- Deduplicates with a `seen: Set<string>`.
- `joinedCommunities` is a `Set<string>` persisted in GunDB under the user's node.

## `postStore.ts` — `usePostStore`

- Similar structure to `pollStore`: map-based, per-community subscriptions, pagination.
- Uses per-community initial-load tracking (`communityInitialLoadDone`) plus subscription timestamps to avoid false "new post" banners from startup hydration.
- `pendingNewPosts` is banner-only state; accepted posts live in `postsMap` and seen IDs are persisted (`seen-post-ids`) so accepted content survives refresh.
- `createPost()` checks the current user's `showRealName` preference. If false (default), generates a pseudonym from the pre-generated postId + authorId as the `authorName`. If true, uses the user's `customUsername`.

## `commentStore.ts` — `useCommentStore`

- Loads and caches comments keyed by post ID.
- `createComment()` checks the current user's `showRealName` preference. Same pseudonym-vs-real-name logic as posts.

## `userStore.ts` — `useUserStore`

- Simple profile cache: `profiles: Record<string, UserProfile>`. Fetches from `UserService` on miss.
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
