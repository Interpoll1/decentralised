# Composables — `src/composables/`

> **Keep this file updated** whenever you add, remove, or change a composable.

Vue 3 composables that bridge stores/services with component logic.

## Inventory

| File | Export | Purpose |
|---|---|---|
| `useChainSync.ts` | `useChainSync()` | Polls `chainStore.chainHead` every 10 seconds and calls `checkForDowngrade()`. Returns `downgradeDetected` (ref), `lastSync` (ref), `resetDowngradeAlert()`. Mount in `App.vue` or a top-level layout component. |
| `useChat.ts` | `useChat()` | Manages a `ChatService` instance for the current user. Handles init, message sending, and reactive message list. |
| `useFingerprint.ts` | `useFingerprint()` | Wraps `CryptoService.generateFingerprint()`. Returns `fingerprint` (ref), `isLoading` (ref), `generateFingerprint()`. |
| `useModerationFilter.ts` | `useModerationFilter()` | Exposes moderation settings and filter functions. Uses `ModerationService` + `userStore`. `shouldShow(item)` checks both karma and content score. `getContentAction(text)` returns `blur`/`hide`/`flag`/`show`. |
| `useSearch.ts` | `useSearch(apiUrl?)` | Wraps `SearchService` instance with reactive state (`results`, `loading`, `error`, pagination). Provides `search()`, `searchPosts()`, `searchPolls()`, `searchInCommunity()`, `nextPage()`, `previousPage()`. |
| `useProofOfWork.ts` | `useProofOfWork()` | Wraps `PowService.getProof()` with reactive state for UI feedback. Returns `solving` (ref), `error` (ref), `getProof(action)`. Guards against concurrent calls. For transparent PoW (no UI), `WebSocketService.broadcast()` handles it automatically. |

## Conventions

- Composables call stores or services — not other composables.
- Always clean up subscriptions/intervals inside `onUnmounted` if the composable registers them.
