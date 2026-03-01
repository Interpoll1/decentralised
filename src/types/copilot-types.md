# Types — `src/types/`

> **Keep this file updated** whenever you add or change a type file.

## `chain.ts`

Core blockchain types. Import with `import type { ChainBlock, Vote, Receipt, Poll, ActionType } from '@/types/chain'`.

| Type | Notes |
|---|---|
| `ChainBlock` | Fields: `index`, `timestamp`, `previousHash`, `voteHash`, `signature`, `currentHash`, `nonce`. Optional: `pubkey` (Schnorr x-only hex), `eventId` (Nostr event ref), `actionType`, `actionLabel`. Legacy blocks omit `pubkey` — they are still valid if hash-chain holds. |
| `Vote` | `pollId`, `choice`, `timestamp`, `deviceId` |
| `Receipt` | `blockIndex`, `voteHash`, `chainHeadHash`, `mnemonic`, `timestamp`, `pollId` |
| `Poll` | Minimal chain-layer poll: `id`, `title`, `description`, `options[]`, `createdAt`. **Not** the same as `pollService.ts` `Poll` which has more fields. |
| `ActionType` | `'vote' \| 'community-create' \| 'post-create'` — extend this union to add new block action types. |

## `nostr.ts`

Nostr-compatible event protocol types. Used by `eventService.ts` and `keyService.ts`.

| Type/Const | Notes |
|---|---|
| `EventKind` | `POLL_CREATION=100`, `VOTE_CAST=101`, `POLL_UPDATE=102`, `POST_CREATION=103` |
| `NostrEvent` | Signed event: `id` (SHA-256 hex), `pubkey`, `created_at`, `kind`, `tags: string[][]`, `content` (JSON string), `sig` (Schnorr hex) |
| `UnsignedEvent` | Same minus `id` and `sig` |
| `StoredKeyPair` | `privateKey`, `publicKey` (both 64-char hex), `createdAt` |

## `supabase.ts`

Legacy schema stub (`Database.public.Tables.receipts`). Supabase was removed — this file exists for type compatibility but is not actively used.
