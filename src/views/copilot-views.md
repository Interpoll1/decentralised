# Views — `src/views/`

> **Keep this file updated** whenever you add, remove, or change a view/route.

Page-level components. Each maps to a route in `src/router/index.ts`. All routes are lazy-loaded with `() => import(...)`.

## Route Map

| File | Route | Purpose |
|---|---|---|
| `HomePage.vue` | `/home` | Feed of communities and trending polls. Entry point. |
| `CommunityPage.vue` | `/community/:communityId` | Community detail: post/poll lists, join button. |
| `CreateCommunityPage.vue` | `/create-community` | Form to create a new community. Calls `CommunityService` + `chainStore.addAction`. |
| `CreatePollPage.vue` | `/create-poll` | Poll creation form. Supports expiry, multiple choice, login gate, private/invite. |
| `CreatePostPage.vue` | `/community/:communityId/create-post` | Post creation with optional image upload. |
| `PollDetailPage.vue` | `/community/:communityId/poll/:pollId` | Full poll view with results and `VoteForm`. |
| `PostDetailPage.vue` | `/post/:postId` | Post with comments. |
| `VotePage.vue` | `/vote/:pollId` | Standalone voting page (used for direct-link voting). |
| `ResultsPage.vue` | `/results/:pollId` | Poll results with charts. |
| `ChainExplorerPage.vue` | `/chain-explorer` | Browse local blockchain blocks, validate chain, look up receipts. |
| `ReceiptPage.vue` | `/receipt/:mnemonic?` | Verify a vote receipt by mnemonic. |
| `SettingsPage.vue` | `/settings` | Relay URL overrides (saved to localStorage), key management, moderation settings. |
| `ProfilePage.vue` | `/profile` | Current user's profile. Editable: custom username, display name, bio, avatar (via IPFSService), and "Show username on posts" toggle (anonymous by default). |
| `UserProfileView.vue` | `/user/:userId` | Another user's public profile. |
| `SearchView.vue` | `/search` | Full-text search results. Uses `useSearch` composable. |
| `ChatView.vue` | `/chat/:userId` | P2P encrypted DM chat with a user. Uses `ChatService` instance. |
| `AuthCallbackPage.vue` | (OAuth redirect) | Handles Google/Microsoft OAuth redirect, exchanges code for session. |

## Routing Notes

- All unmatched paths redirect to `/home`.
- `router.beforeEach` is a passthrough (no auth guard currently). If adding auth gates, this is the place.
- Props are passed via route params for detail pages (`props: true` or `props: route => (...)`).
- The router uses `createWebHistory('/')` — server must serve `index.html` for all paths.

## `.env` in views/

`src/views/.env` contains view-level environment defaults (not committed). Prefer `src/config.ts` for runtime-mutable values.
