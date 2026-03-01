# Components — `src/components/`

> **Keep this file updated** whenever you add, remove, or significantly change a component.

Reusable UI components built with Vue 3 Composition API + Ionic + Tailwind.

## Component Inventory

| File | Purpose | Key props/events |
|---|---|---|
| `VoteForm.vue` | Full voting form for a poll. Handles option selection, duplicate-vote checking, and calls `chainStore.addVote()`. | `pollId`, emits `voted` |
| `VoteButtons.vue` | Lightweight vote action buttons (up/down or option buttons). Used inside `VoteForm` and `PollCard`. | `options`, `selectedOption`, emits `select` |
| `PollCard.vue` | Summary card for a poll shown in community/home feed. Links to `PollDetailPage`. Shows live vote counts. | `poll: Poll` |
| `PostCard.vue` | Summary card for a community post. Shows title, author pseudonym, vote score, comment count. | `post: Post` |
| `CommentCard.vue` | Single comment with author pseudonym, vote controls, and nested replies. | `comment`, `postId` |
| `CommunityCard.vue` | Community listing card with name, description, member count. | `community: Community` |
| `ChainStatus.vue` | Badge/indicator showing blockchain sync state (valid/invalid, block count, WebSocket connected). Uses `useChainStore`. | — |
| `ReceiptViewer.vue` | Displays a vote receipt (mnemonic + block details). Allows receipt lookup in chain explorer. | `receipt: Receipt` |
| `ImageUploader.vue` | Drag-and-drop / click-to-upload image picker. Compresses and uploads via `IPFSService`. Emits `uploaded` with `{ cid, thumbnail }`. | emits `uploaded` |
| `ConnectionBanner.vue` | Top-of-screen banner shown when WebSocket is disconnected. Uses `chainStore.isWebSocketConnected`. | — |
| `RecoveryPhraseCard.vue` | Displays a BIP-39 mnemonic receipt in a stylized card. | `mnemonic: string` |
| `ChatImageMessage.vue` | Renders an image message in the chat view with thumbnail preview. | `message: ChatMessage` |

## Conventions

- Components do **not** import services directly — they go through stores or composables.
- Author pseudonyms (shown in cards) are generated with `generatePseudonym(postId, authorId)` from `src/utils/pseudonym.ts`, not stored in GunDB.
- Ionic components (`<ion-card>`, `<ion-button>`, etc.) are used for layout and mobile-friendly interactions. Tailwind is used for spacing, color, and typography.
