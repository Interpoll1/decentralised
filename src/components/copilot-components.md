# Components — `src/components/`

> **Keep this file updated** whenever you add, remove, or significantly change a component.

Reusable UI components built with Vue 3 Composition API + Ionic + Tailwind.

## Component Inventory

| File | Purpose | Key props/events |
|---|---|---|
| `VoteForm.vue` | Full voting form for a poll. Handles option selection, duplicate-vote checking, private-poll invite-code reservation/finalization, and calls `AuditService.authorizeVote()` before voting. Authorization passes `poll.requireLogin`; auth-required denials show a sign-in toast, persist a return URL, and redirect to OAuth instead of incorrectly setting "already voted." If the relay authorize path is unavailable/policy-conflicted, the form now continues with decentralized chain + Gun vote flow (no reservation token), and only runs backend confirm when a reservation token exists. After chain success it emits receipt immediately, then backend confirm (when token exists), Gun count sync, and invite-code finalization continue in the background so slow relays do not leave the form spinning or falsely report the whole vote as failed. Watches `poll.id` so reused `/vote/:pollId` instances refresh state instead of keeping stale "already voted" state. | `poll`, `inviteCode?`, `requiresInviteCode?`, emits `vote-submitted` |
| `VoteButtons.vue` | Lightweight vote action buttons (up/down or option buttons). Used inside `VoteForm` and `PollCard`. | `options`, `selectedOption`, emits `select` |
| `PollCard.vue` | Summary poll row shown in community/home feed. Links to `PollDetailPage`. Shows live vote counts and issuer trust badge (`username@trust_issuer` for trusted, `Unverified identity` otherwise) even when the author display name stays anonymous. The feed now uses a flatter list layout instead of boxed cards, with only a subtle divider and restrained hover styling. Trusted badge styling remains green. | `poll: Poll` |
| `PostCard.vue` | Summary post row shown in community/home feed. Shows title, author pseudonym, vote score, comment count, image thumbnail, and issuer trust badge (`username@trust_issuer` for trusted, `Unverified identity` otherwise) even when the author display name stays anonymous. The feed now uses a flatter list layout instead of boxed cards, with vote/comment controls kept inline beneath the body and a subtler hover state. Includes author-hover **Invite to chat** action (always visible on mobile) that sends a persistent Gun inbox invite to the author for next-open delivery. Trusted badge styling remains green. | `post: Post` |
| `CommentCard.vue` | Single comment row with author pseudonym, vote controls, nested replies, and issuer trust badge (`username@trust_issuer` for trusted, `Unverified identity` otherwise) even when the author display name stays anonymous. Includes author-hover **Invite to chat** action (always visible on mobile) that sends a persistent Gun inbox invite to the comment author for next-open delivery. Trusted badge styling remains green. Vote highlighting comes from `commentStore.hasUpvoted(id)` / `hasDownvoted(id)` — **not** from reading `upvoted-comments` out of localStorage inside a computed keyed on a `voteVersion` counter, which only re-evaluated when some *other* vote bumped it. A "sending…"/"not synced" chip renders from `commentStore.statusOf(id)`. Posting a reply must **not** trigger `loadCommentsForPost`: the store upserts optimistically and the subscription is live, so reloading only cancels the in-flight load. **`postId` and `communityId` are both required** — `postId` seeds the author's per-post pseudonym, so omitting it renders every comment under the wrong name. | `comment`, `postId`, `communityId`, `flagged?`, `filterAction?` |
| `CommunityCard.vue` | Community listing card with name, description, member count. | `community: Community` |
| `ChainStatus.vue` | Badge/indicator showing blockchain sync state (valid/invalid, block count, WebSocket connected). Uses `useChainStore`. | — |
| `ReceiptViewer.vue` | Displays a vote receipt (verification code + block details). Allows receipt lookup in chain explorer. | `receipt: Receipt` |
| `ImageUploader.vue` | Drag-and-drop / click-to-upload image picker. Compresses and uploads via `IPFSService`. Emits `uploaded` with `{ cid, thumbnail }`. | emits `uploaded` |
| `AppLoader.vue` | Full-screen startup loader with animated network canvas and an Interpoll wordmark centered over the scene inside a translucent card, so brand identity stays visible while peers connect. | — |
| `ConnectionBanner.vue` | Top-of-screen banner shown when WebSocket is disconnected. Uses `chainStore.isWebSocketConnected`. | — |
| `RecoveryPhraseCard.vue` | Displays a BIP-39 mnemonic receipt in a stylized card. | `mnemonic: string` |
| `ChatImageMessage.vue` | Renders an image message in the chat view with thumbnail preview. | `message: ChatMessage` |
| `EncryptedBadge.vue` | Small inline badge with lock icon indicating an encrypted community or chat room. Used in lists. | `hint?: string`, `showLabel?: boolean` |
| `ContentVerificationBadge.vue` | Inline badge showing Schnorr-signature verification status (verified/unverified/unsigned) with appropriate icon and color. | `status: 'verified'\|'unverified'\|'unsigned'`, `showLabel?: boolean`, `showUnsigned?: boolean` |
| `KeyManagementSection.vue` | Settings section for managing stored encryption keys. Lists keys with type/method badges, supports delete with confirmation, export (JSON download), and import (file picker). Calls `KeyVaultService` directly. | — |
| `PrivateCommunityToggle.vue` | Toggle + config UI for creating encrypted communities. Offers invite-link (random AES key) or password-derived key methods. Used in `CreateCommunityPage`. | emits `update:config` with `PrivateCommunityConfig` |
| `ConsentBanner.vue` | Compact inline mobile notice shown under the community description until dismissed. Warns that data is stored locally and content is unmoderated. Persists acceptance in `localStorage` (`interpoll_consent_accepted`). | — |
| `GlobalCommandPalette.vue` | App-wide command palette modal (`Ctrl/Cmd+Shift+P`) for navigation and quick create/tools actions. | `isOpen`, emits `close` |

## Conventions

- Components do **not** import services directly — they go through stores or composables.
- Author names in `PostCard`, `PollCard` and `CommentCard` are `<button class="author-link">` elements that route to `/user/:authorId`, with `@click.stop` so they don't also fire the card's own navigation. They are buttons rather than spans so they stay keyboard-reachable inside the clickable card; `.author-link` in `src/style.css` strips the button chrome. **Privacy note:** the link is keyed on `authorId`, so it makes the same author identifiable across posts even when their per-post pseudonym differs. Gate it on `authorShowRealName` if per-post unlinkability matters more than navigability.
- Author pseudonyms (shown in cards) are generated with `generatePseudonym(postId, authorId)` from `src/utils/pseudonym.ts`, not stored in GunDB. If a post/comment has `authorShowRealName: true`, the stored `authorName` is shown instead of a pseudonym.
- Ionic components (`<ion-card>`, `<ion-button>`, etc.) are used for layout and mobile-friendly interactions. Tailwind is used for spacing, color, and typography.
- Shared visual primitives for the current redesign live in `src/style.css` (`.ambient-page`, `.ambient-page__content`, `.surface-card`, `.surface-pill`, `.section-heading`, etc.). Prefer composing those shared shell/surface classes before adding new one-off gradients or blur treatments inside component-scoped CSS.
- Global keyboard shortcuts must not trigger while the user is typing in inputs/textareas/selects or editable content.

## Design system (`src/style.css`)

Three token families drive the visual layer. Compose them instead of hard-coding hex,
`monospace`, or `rgba(255,255,255,…)` values — white-alpha surfaces are a dark-theme
assumption and go invisible on the light canvas.

**Type** — `--font-display` (Bricolage Grotesque: headings, `ion-title`, wordmark),
`--font-body` (Inter: everything else), `--font-mono` (JetBrains Mono). Mono is a
*signal*, not a style: it marks values the reader can independently verify — hashes,
verification codes, block heights, tallies. Never set prose in it. Sizes come from
`--text-2xs … --text-2xl`; helpers: `.data-text`, `.data-text--hash`, `.tabular`.

**Colour** — `--app-accent` (indigo) is the primary. `--app-signal` (copper) is the one
warm colour and is reserved for proof: verified signatures, sealed receipts, confirmed
chain state, verified tallies. If the user cannot verify it, it does not get to be warm.
Absence of proof ("unverified") stays muted rather than amber, so the verified state is
what the eye catches. Feed categories use the closed `--tone-*` palette, which is tuned
per theme.

**Depth** — `--app-shadow-sm/md/lg` are a 1px ring plus a contact shadow, not a glow.
Card edges come from the ring; the blur only lifts. Dark-mode overrides key on the
`.dark` class, never `prefers-color-scheme` — the app has a manual theme toggle, so a
`prefers-color-scheme` block silently does nothing when the user switches themes.
