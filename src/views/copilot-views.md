# Views — `src/views/`

> **Keep this file updated** whenever you add, remove, or change a view/route.

Page-level components. Each maps to a route in `src/router/index.ts`. All routes are lazy-loaded with `() => import(...)`.

## Route Map

| File | Route | Purpose |
|---|---|---|
| `HomePage.vue` | `/home` | Main feed entry point. Merges posts + polls and supports personalized ranking (`For You`) vs chronological mode (`Latest`) using `useFeedPreferences` + `feedRanking` utilities. |
| `CommunityPage.vue` | `/community/:communityId` | Community detail: post/poll lists, join button, and mode-aware personalized ordering (same `For You`/`Latest` preference model as Home) layered on top of moderation filters. Handles encrypted communities: checks `KeyVaultService.hasKey` for access, decrypts metadata via `CommunityService.decryptCommunityMeta`, decrypts posts/polls via `PostService.decryptPost`/`PollService.decryptPoll`, shows locked state with join link when no key, and offers "Share Invite" button for members with access. |
| `CreateCommunityPage.vue` | `/create-community` | Form to create a new community. Calls `CommunityService` + `chainStore.addAction`. |
| `CreatePollPage.vue` | `/create-poll` | Poll creation form. Supports expiry, multiple choice, login gate, private/invite. |
| `CreatePostPage.vue` | `/community/:communityId/create-post` | Post creation with optional image upload. |
| `PollDetailPage.vue` | `/community/:communityId/poll/:pollId` | Full poll view with results and `VoteForm`. |
| `PostDetailPage.vue` | `/post/:postId` | Post with comments. |
| `VotePage.vue` | `/vote/:pollId` | Standalone voting page (used for direct-link voting). |
| `ResultsPage.vue` | `/results/:pollId` | Poll results with charts. |
| `ChainExplorerPage.vue` | `/chain-explorer` | Browse local blockchain blocks, validate chain, look up receipts. |
| `ReceiptPage.vue` | `/receipt/:mnemonic?` | Verify a vote receipt by mnemonic. |
| `SettingsPage.vue` | `/settings` | Multi-tab settings hub for general, feed personalization, moderation, relay/network config, and local data controls. Feed tab manages keywords, muted/favorite communities, feed mode, and ranking weights (local-only). |
| `ProfilePage.vue` | `/profile` | Current user's profile. Editable: custom username, display name, bio, avatar (via IPFSService), and "Show username on posts" toggle (anonymous by default). |
| `UserProfileView.vue` | `/user/:userId` | Another user's public profile. |
| `SearchView.vue` | `/search` | Full-text search results. Uses `useSearch` composable. |
| `ChatView.vue` | `/chat/:userId` | P2P encrypted DM chat with a user. Uses `ChatService` instance. |
| `ChatRoomPage.vue` | `/chatroom/:roomId` | Encrypted group chat room. Uses `useChatRoomStore` for live messages, `KeyVaultService` for access check, `InviteLinkService` for sharing invite links. |
| `ResiliencePage.vue` | `/resilience` | Anti-censorship tools: relay health scanning, relay management, snapshot export/import/P2P share, Tor support, guides. |
| `AuthCallbackPage.vue` | (OAuth redirect) | Handles Google/Microsoft OAuth redirect, exchanges code for session. |
| `ChatRoomListPage.vue` | `/chatrooms` | List of joined chat rooms. Pull-to-refresh, create-room modal (name, description, optional password), invite-link copy, swipe-to-leave. Navigates to `/chatroom/:roomId`. Uses `useChatRoomStore`, `UserService.getCurrentUser()`. |
| `JoinPrivatePage.vue` | `/join/:type/:id` | Handles invite links and password-based joining for encrypted communities/chatrooms/servers. Reads base64url AES key from URL fragment for auto-join; falls back to password form. Uses `InviteLinkService`, `CommunityService.joinPrivateCommunity()`, `KeyVaultService`. |

## Routing Notes

- All unmatched paths redirect to `/home`.
- `router.beforeEach` is a passthrough (no auth guard currently). If adding auth gates, this is the place.
- Props are passed via route params for detail pages (`props: true` or `props: route => (...)`).
- The router uses `createWebHistory('/')` — server must serve `index.html` for all paths.

## `.env` in views/

`src/views/.env` contains view-level environment defaults (not committed). Prefer `src/config.ts` for runtime-mutable values.
