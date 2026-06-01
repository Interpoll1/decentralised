# Router — `src/router/`

> **Keep this file updated** whenever you add, remove, or change routes.

Single file: `index.ts`. Uses `@ionic/vue-router` (`createRouter` from Ionic for native transitions).

## Route Table

| Path | Name | Component | Props |
|---|---|---|---|
| `/` | — | redirect → `/home` | — |
| `/home` | `Home` | `HomePage` | — |
| `/community/:communityId` | `Community` | `CommunityPage` | `communityId` via route fn |
| `/community/:communityId/create-post` | `CreatePost` | `CreatePostPage` | `true` |
| `/community/:communityId/poll/:pollId` | `PollDetail` | `PollDetailPage` | `true` |
| `/post/:postId` | `PostDetail` | `PostDetailPage` | `true` |
| `/create-community` | `CreateCommunity` | `CreateCommunityPage` | — |
| `/create-poll` | `CreatePoll` | `CreatePollPage` | — |
| `/profile` | `Profile` | `ProfilePage` | — |
| `/user/:userId` | `UserProfile` | `UserProfileView` | `true` |
| `/settings` | `Settings` | `SettingsPage` | — |
| `/chain-explorer` | `ChainExplorer` | `ChainExplorerPage` | — |
| `/vote/:pollId` | `Vote` | `VotePage` | `true` |
| `/results/:pollId` | `Results` | `ResultsPage` | `true` |
| `/receipt/:verificationCode?` | `Receipt` | `ReceiptPage` | — |
| `/search` | `Search` | `SearchView` | — |
| `/chat/:userId` | `Chat` | `ChatView` | `true` |
| `/chatrooms` | `ChatRoomList` | `ChatRoomListPage` | — |
| `/chatroom/:roomId` | `ChatRoom` | `ChatRoomPage` | `true` |
| `/join/:type/:id` | `JoinPrivate` | `JoinPrivatePage` | — |
| `/resilience` | `Resilience` | `ResiliencePage` | — |
| `/:pathMatch(.*)*` | — | redirect → `/home` | — |

## Notes

- All components are lazy-loaded.
- `router.beforeEach` is currently a passthrough — add auth guards here if needed.
- History mode: `createWebHistory('/')` — the server (or `dist/`) must handle SPA fallback.
- Internal same-origin anchor links are intercepted in `App.vue` and forwarded through Vue Router so `/community/...`, `/chat...`, and `/join/...` links stay in-app instead of forcing a browser reload.
- `JoinPrivatePage` supports community, chatroom, and server invite routes.
- `ResiliencePage` is directly routable from `/resilience` (not beta-gated).
- `App.vue` supplies the Ion router-outlet animation so page swaps use a shorter fade/slide and the outgoing page clears promptly.
