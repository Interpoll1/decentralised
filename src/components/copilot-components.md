# Components — `src/components/`

> **Keep this file updated** whenever you add, remove, or significantly change a component.

Reusable UI components built with Vue 3 Composition API + Ionic + Tailwind.

## Component Inventory

| File | Purpose | Key props/events |
|---|---|---|
| `VoteForm.vue` | Full voting form for a poll. Handles option selection, duplicate-vote checking, private-poll invite-code reservation/finalization, and calls `AuditService.authorizeVote()` before voting. Authorization now passes `poll.requireLogin`; auth-required denials show a sign-in toast, persist a return URL, and redirect to OAuth instead of incorrectly setting "already voted." After chain success it emits receipt immediately, then backend confirm (with reservation token + login context), Gun count sync, and invite-code finalization continue in the background so slow relays do not leave the form spinning or falsely report the whole vote as failed. Watches `poll.id` so reused `/vote/:pollId` instances refresh state instead of keeping stale "already voted" state. | `poll`, `inviteCode?`, `requiresInviteCode?`, emits `vote-submitted` |
| `VoteButtons.vue` | Lightweight vote action buttons (up/down or option buttons). Used inside `VoteForm` and `PollCard`. | `options`, `selectedOption`, emits `select` |
| `PollCard.vue` | Summary card for a poll shown in community/home feed. Links to `PollDetailPage`. Shows live vote counts and issuer trust badge (`username@trust_issuer` for trusted, `Unverified identity` otherwise) when real-name authorship is enabled. Trusted badge styling remains green. | `poll: Poll` |
| `PostCard.vue` | Summary card for a community post. Shows title, author pseudonym, vote score, comment count, image thumbnail, and issuer trust badge (`username@trust_issuer` for trusted, `Unverified identity` otherwise) when real-name authorship is enabled. Trusted badge styling remains green. | `post: Post` |
| `CommentCard.vue` | Single comment with author pseudonym, vote controls, nested replies, and issuer trust badge (`username@trust_issuer` for trusted, `Unverified identity` otherwise) when real-name authorship is enabled. Trusted badge styling remains green. | `comment`, `postId` |
| `CommunityCard.vue` | Community listing card with name, description, member count. | `community: Community` |
| `ChainStatus.vue` | Badge/indicator showing blockchain sync state (valid/invalid, block count, WebSocket connected). Uses `useChainStore`. | — |
| `ReceiptViewer.vue` | Displays a vote receipt (verification code + block details). Allows receipt lookup in chain explorer. | `receipt: Receipt` |
| `ImageUploader.vue` | Drag-and-drop / click-to-upload image picker. Compresses and uploads via `IPFSService`. Emits `uploaded` with `{ cid, thumbnail }`. | emits `uploaded` |
| `ConnectionBanner.vue` | Top-of-screen banner shown when WebSocket is disconnected. Uses `chainStore.isWebSocketConnected`. | — |
| `RecoveryPhraseCard.vue` | Displays a BIP-39 mnemonic receipt in a stylized card. | `mnemonic: string` |
| `ChatImageMessage.vue` | Renders an image message in the chat view with thumbnail preview. | `message: ChatMessage` |
| `EncryptedBadge.vue` | Small inline badge with lock icon indicating an encrypted community or chat room. Used in lists. | `hint?: string`, `showLabel?: boolean` |
| `ContentVerificationBadge.vue` | Inline badge showing Schnorr-signature verification status (verified/unverified/unsigned) with appropriate icon and color. | `status: 'verified'\|'unverified'\|'unsigned'`, `showLabel?: boolean`, `showUnsigned?: boolean` |
| `KeyManagementSection.vue` | Settings section for managing stored encryption keys. Lists keys with type/method badges, supports delete with confirmation, export (JSON download), and import (file picker). Calls `KeyVaultService` directly. | — |
| `PrivateCommunityToggle.vue` | Toggle + config UI for creating encrypted communities. Offers invite-link (random AES key) or password-derived key methods. Used in `CreateCommunityPage`. | emits `update:config` with `PrivateCommunityConfig` |
| `ConsentBanner.vue` | Compact inline mobile notice shown under the community description until dismissed. Warns that data is stored locally and content is unmoderated. Persists acceptance in `localStorage` (`interpoll_consent_accepted`). | — |

## Conventions

- Components do **not** import services directly — they go through stores or composables.
- Author pseudonyms (shown in cards) are generated with `generatePseudonym(postId, authorId)` from `src/utils/pseudonym.ts`, not stored in GunDB. If a post/comment has `authorShowRealName: true`, the stored `authorName` is shown instead of a pseudonym.
- Ionic components (`<ion-card>`, `<ion-button>`, etc.) are used for layout and mobile-friendly interactions. Tailwind is used for spacing, color, and typography.
