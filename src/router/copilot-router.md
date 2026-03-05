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
| `/receipt/:mnemonic?` | `Receipt` | `ReceiptPage` | — |
| `/search` | `Search` | `SearchView` | — |
| `/chat/:userId` | `Chat` | `ChatView` | `true` |
| `/resilience` | `Resilience` | `ResiliencePage` | — |
| `/:pathMatch(.*)*` | — | redirect → `/home` | — |

## Notes

- All components are lazy-loaded.
- `router.beforeEach` is a passthrough — add auth guards here if needed.
- History mode: `createWebHistory('/')` — the server (or `dist/`) must handle SPA fallback.
