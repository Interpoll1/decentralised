# Stores — `src/stores/`

> **Keep this file updated** whenever you add, remove, or change a store.

All stores use the **Composition API form** of Pinia: `defineStore('name', () => { ... })`. Views/components consume stores; they do not call services directly.

## `chainStore.ts` — `useChainStore`

The most critical store. Owns the local blockchain.

- **Init**: Call `chainStore.initialize()` once on app start. It calls `BroadcastService.initialize()`, `RelayManager.initialize()`, `WebSocketService.initialize()`, `WebRTCService.initialize()` + `MeshService.initialize()` (P2P mesh fallback), `ChainService.initializeChain()`, then wires sync listeners for all three channels.
- **Three transports**: every block/event/sync message fans out over `BroadcastService` (tabs), `WebSocketService` (relay), **and** `WebRTCService.broadcastToAll()` (mesh). Inbound handlers (`handleNewBlock`, `handleSyncRequest`, `handleSyncResponse`, `handleNewEvent`) are idempotent, so duplicate delivery across transports is safe — this is what keeps sync alive when the relays are down.
- **Sync protocol**: On connect, sends `request-sync` with `lastIndex` (incremental — only fetches missing blocks). Responds to `sync-response` by validating and appending blocks in strict index order. Same-index hash conflicts and index gaps trigger incremental resync, but resync requests are now backoff-throttled and duplicate sync-warning logs are deduplicated to prevent console storms during relay/peer inconsistency; malformed or out-of-order blocks are dropped.
- Sync diagnostics: when `localStorage.interpoll_sync_debug === 'true'`, emits `[SyncDebug] chainStore diagnostics active` plus periodic heartbeat logs and per-second `[SyncRate]` metrics (`chain-new-block`, `chain-sync-request-sent`, `chain-sync-request-received`, `chain-sync-response-received`, `chain-sync-response-blocks`).
- **Voting**: `addVote(vote)` → creates block → broadcasts on both channels → saves receipt → calls `AuditService.logReceipt`.
- **Actions**: `addAction(actionType, data, label)` records non-vote events (community creation, post creation) as blocks.
- **Nostr events**: Every vote also creates and broadcasts a signed Nostr event via `EventService`.

- **Block storage**: append through `pushBlock()`, never `blocks.value.push()` directly — it keeps the private `blockByIndex` map in sync and `markRaw`s the block. Blocks are immutable once written, so Vue's deep proxy was pure overhead, and lookups by index used to be an `Array.find()` per inbound block (O(n²) over a sync burst). `loadBlocks()`/any re-sort must call `reindexBlocks()`.

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

Holds **one post's thread at a time**. Rewritten alongside `commentService`.

- **One generation token guards every async continuation.** The old store raced a
  live subscription against four staggered refetches, all writing into the same
  array through a shared `seen` set: a comment delivered by subscription was never
  refreshed by a later fetch, a comment delivered by fetch could be re-added by the
  subscription, and navigating between posts left the previous post's listeners
  running. That is where "comments are super random" came from. Any new async work
  here must capture the token and bail when `token !== generation`.
- `loadCommentsForPost(postId)` is a fixed sequence: teardown → render
  `getLocalComments` from IndexedDB (instant, correct offline) → `isLoading = false`
  → subscribe → merge `fetchCommentsFromGun` on top → `refreshTallies` (top 30,
  concurrency 5). Comments are keyed by id in a `Map` for O(1) upsert; a record
  without content never replaces one with content.
- `createComment()` takes `authorId` from **`UserService.getCurrentUser()`**. It
  used to mint a separate `anon_<timestamp>` id in localStorage, so a commenter
  never matched their own profile — identity badges always read "unverified" and
  karma landed on an account nobody could look up. It still applies the same
  `showRealName` pseudonym logic as posts.
- **`voteVersion` is gone.** Vote state lives in the reactive `myVotes` map;
  components call `hasUpvoted(id)` / `hasDownvoted(id)` rather than reading
  `upvoted-comments` out of localStorage inside a computed (that only re-evaluated
  when some *other* vote bumped the counter). `vote()` updates optimistically, then
  reconciles against the authoritative tally from `CommentService`, rolling back on
  error.
- `statusOf(id)` / `pendingComments` surface publish state (`pending` → `published`
  → `confirmed` / `failed`) so the UI can show "sending…".
- `clearComments()` is safe to call under memory pressure — the durable copy is in
  IndexedDB, and `reloadActivePost()` brings the open thread straight back.
  `main.ts` calls both at `emergency`.
- **Do not call `loadCommentsForPost` after posting.** The store upserts
  optimistically and the subscription is live; reloading restarts the load and
  cancels the in-flight one, which is how a fresh comment could flash up and vanish.

Key refs: `comments`, `isLoading`, `error`, `activePostId`, `syncStatus`, `myVotes`

## `userStore.ts` — `useUserStore`

- Simple profile cache: `profiles: Record<string, UserProfile>`. Fetches from `UserService` on miss.
- `getProfile()` now deduplicates concurrent fetches per user ID with an in-flight promise map, so components requesting the same profile at once share one network read.
- `getCachedKarma(userId)` — used by `useModerationFilter` to hide low-karma content without a network fetch.

## `chatRoomStore.ts` — `useChatRoomStore`

Manages encrypted chat rooms via `ChatRoomService`.

- **Room lifecycle**: `loadRooms()` fetches joined rooms, `createRoom()` / `joinRoom()` add to the list, `leaveRoom()` removes.
- **`enterRoom(room)` is now async and loads history.** It renders
  `getLocalHistory()` from IndexedDB first, then subscribes, then merges
  `loadHistory()` from the graph — guarded by a generation token so switching rooms
  mid-load cannot cross two conversations. Previously it only opened a live
  subscription, so a room reopened later showed nothing until someone typed. Callers
  must `await` it. `leaveCurrentRoom()` bumps the generation, unsubscribes, clears.
- **Deduplication**: `upsert()` replaces by id everywhere — the same message arrives
  both from `sendMessage` and from the graph subscription.
- `trackDelivery()` follows a just-sent message's `syncStatus` in IndexedDB so the
  bubble stops showing "pending" as soon as the relay confirms, without waiting for
  the next full room load.

Key refs: `rooms`, `currentRoom`, `messages`, `loading`, `loadingHistory`, `error`
Key computed: `sortedMessages` — timestamp → per-sender `seq` → id, matching
`utils/messageOrder.ts`, so the room reads identically on every device.

## `syncStore.ts`

Currently empty/placeholder.

## Memory-pressure trim actions

- `postStore.trimPostsToVisible(extra?)` / `pollStore.trimPollsToVisible(extra?)` —
  shrink `postsMap`/`pollsMap` to the visible window plus the item being viewed,
  returning the number dropped. Called from the `MemoryWatchdogService.onCleanup`
  handler in `main.ts` at `aggressive` and `emergency` only; at `light` the service
  caches suffice and trimming the feed being read would cost a visible refetch.
- `pollStore` keeps any poll inside its vote protection window (below) — dropping one
  would discard a local vote count with nothing left to reconcile against. `postStore`
  no longer needs that carve-out: its counts are derived and survive a trim in
  `tallies`.

## Protecting a just-cast vote from stale echoes

Gun re-delivers a post/poll whenever any peer echoes it, and an echo can carry a
pre-vote snapshot that lands *after* our own write — visibly undoing the user's vote
seconds later.

- `pollStore` — two mechanisms, for two different counters. *Option* vote totals are
  still time-based: `recentlyVotedPolls` + `VOTE_PROTECTION_MS` (10s), within which the
  incoming copy supplies every field except the option counts. *Content* votes (the
  up/down on the poll card) now use the same permanent overlay posts do:
  `contentTallies` + `withContentTally()`, applied in `injectPoll` and `selectPoll`.
  This matters because `injectPoll` replaces a poll whenever its *option* total has not
  gone backwards — a condition that says nothing about content votes — so an echo
  arriving a second after an upvote used to put the old number straight back on screen.
- `postStore` — no window. Counts come from `PostVoteService`'s derived tally, held
  in `tallies` and overlaid onto every incoming copy by `withKnownTally()` in
  `processIncomingPost`. A derived tally outranks a post node's advisory counters
  permanently, so there is no expiry for a late echo to sneak past. The old
  `locallyVotedAt` / `LOCAL_VOTE_GRACE_MS` (15s) / `preserveFreshLocalVote()` are
  gone.

## Post vote state

`postStore` is the single decision point for post votes:

- `toggleVote(postId, direction)` — clicking the direction you already hold clears it.
  Views must not pre-decide vote-vs-unvote and call separate actions; that split
  (view reading `localStorage`, service reading the graph) is what inverted clicks.
- `clearVote(postId)`, `myVote(postId)`, `myVotes` (persisted `my-post-votes-v1`),
  `refreshVoteState(postId)` (authoritative pull — worth it on a detail page),
  `subscribeToVotes(postId)` (live tally; returns an unsubscribe).
- `upvotePost` / `downvotePost` / `removeUpvote` / `removeDownvote` are thin aliases
  kept for older callers; all route through `toggleVote`/`clearVote`.
- Optimistic counts are predicted from `myVotes` — the same state the button's
  filled/hollow rendering reads — so the number and the icon cannot disagree while a
  write is in flight. The prediction is always superseded by the returned tally.
- Cross-tab: a reconciled vote broadcasts `post-vote-tally` on its own channel.
  Do not fold tallies out of `post-updated` instead — that message also carries plain
  Gun echoes from remote peers, whose counter fields are the stale values the tally
  exists to outrank.

## Making a counter patch visible

`postsMap` is a `shallowRef`, and `sortedPosts` reads from `_sortedPostsCache` — an
array rebuilt only when `postsMap` is `triggerRef`'d. So `postsMap.value.set(id, next)`
on its own is invisible twice over: Vue does not see the mutation, *and* the rendered
array still holds the previous object. Every counter update must go through
**`patchPost(postId, patch)`**, which sets the map, swaps the entry in the sorted array
in place and notifies. Feed order is by `createdAt` alone, so a counter can never
reorder anything — patching in place is both correct and cheaper than a rebuild.

`setTally`, `setCommentCount`, `applyOptimisticToggle`, `rollbackVote` and
`reconcileVote` all route through it. They used to `set()` directly, which is why an
optimistic vote never moved the number on a feed card and the derived tally that
followed repainted only when it *disagreed* with the prediction — the number moved on
screen precisely when it was wrong.

## Comment counts

`commentCount` on a post node is an advisory mirror written read-modify-write, so it
loses increments whenever two people comment inside one Gun round trip and drifts
permanently low. Two sources correct it, and both outrank Gun echoes permanently via
`knownCommentCounts` / `withKnownTally()`:

- `commentStore.publishCommentCount(postId)` — the size of the merged local+graph
  thread the detail page already holds. Called on load, on every live comment, and
  after posting. Before the graph has answered it may only *raise* the count: the
  local mirror alone can be empty for a post with plenty of comments elsewhere, and an
  adopted count is permanent. The call after `fetchCommentsFromGun` passes
  `authoritative = true` and may correct downward.
- `dbWarmup.warmCommentCounts()` — `relayFeedService.fetchCommentCounts()` against the
  relay's index-derived batch endpoint, applied to the feed after the REST snapshot.
  Best-effort: a relay without the endpoint leaves the snapshot counts alone, and a
  reported `0` is never adopted (a relay holding the post but not its comments would
  otherwise pin a busy post at "0 comments" for the session).

## Comment vote state

`commentStore` mirrors `postStore`'s contract: `vote()` reconciles `myVotes` to the
`myVote` the service returns rather than keeping its optimistic guess, and
`refreshTallies()` pulls both the tally and this user's own vote from a single pass
over the vote set (`CommentService.getCommentVoteState`). `myVotes` is seeded from the
per-device `upvoted-comments` / `downvoted-comments` sets, so without that reconcile a
vote cast on another device rendered as un-voted and the next click removed it.


## Poll content votes

Up/down on a poll *card* is content voting, distinct from option voting, and it now
rides `PostVoteService` — the same per-user vote nodes posts use, keyed by poll id.
`PollService.voteOnPollContent()` used to read `poll.upvotes`, adjust it and write it
back; two people voting inside one round trip both read N and both wrote N+1, and
clearing wrote `put(null)`, which Gun does not propagate reliably.

- `togglePollContentVote(pollId, direction)` is the single decision point.
  `upvotePoll` / `downvotePoll` / `voteOnPollContent` are aliases.
- It reconciles `myPollContentVotes` (persisted `my-poll-content-votes-v1`) to the
  `myVote` the service returns, and records the derived counts via `setContentTally`.
- `refreshPollContentVoteState(pollId)` is the authoritative pull, called from
  `selectPoll`. Views must **not** keep their own vote sets: `CommunityPage` read the
  legacy `upvoted-polls` / `downvoted-polls` localStorage keys while the store
  maintained `myPollContentVotes`, and the two never saw each other's writes.
