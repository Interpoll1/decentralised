# Copilot Instructions — InterPoll

## Required context before edits

- **Read [`AGENTS.md`](../AGENTS.md) first** — the cross-tool guide with the full
  GenosDB architecture summary and the official documentation index. GenosDB's docs
  are extensive; lean on them.
- InterPoll is a browser-first decentralized app built entirely on **GenosDB**
  (peer-to-peer graph database with built-in cryptographic identity). There is no
  backend and no relay server.
- The data/identity/sync layer lives behind a single instance exported from
  `src/services/gdbServices.ts`. Read it first.

## Build, test, lint

```bash
pnpm install
pnpm dev       # Vite dev server (http://localhost:5173)
pnpm build     # production build
pnpm preview   # serve the built dist/ folder
pnpm lint
pnpm test
```

Single test/file examples:

```bash
pnpm test -- unit_tests/<file>.test.ts
pnpm test -- -t "<test name>"
```

## High-level architecture

- **One database.** `gdbServices.ts` exports `db = await gdb('interpoll', { rtc: true, sm: { superAdmins } })`. It provides:
  - **Identity & signing** via the Security Manager (`db.sm`): WebAuthn passkey or BIP39 mnemonic; every `db.put` is signed automatically and verified by peers.
  - **Storage** in an OPFS-backed Web Worker (IndexedDB fallback), with cross-tab sync via BroadcastChannel — all built in.
  - **P2P sync** via GenosRTC (WebRTC) using decentralized Nostr relays for signaling only.
- **Everything is a signed node**, read reactively with `db.map({ query }, cb)`. Vote-style data (`vote`, `postVote`, `commentVote`, `membership`) is one signed node per identity; **counts are derived, never mutated**, so there are no last-write-wins races.
- **Ordering / tamper-evidence** comes from the Hybrid Logical Clock + signatures. The integrity "chain" is just signed `chainAction` nodes (see `chainStore`).
- **Encryption**: private communities, group chat rooms and DMs use AES-256-GCM (`EncryptionService` + `KeyVaultService`); only the data layer changes, content stays encrypted in the browser.

## Key conventions

- **Single source of data**: `import { db } from '@/services/gdbServices'`. Never reintroduce a relay/WebSocket transport — sync is native.
- **Service pattern**: most services are static classes (`ServiceName.method()`); `ChatService` and `SearchService` are instance-based.
- **Store/component layering**: views/components consume Pinia stores; stores call services; components do not call services directly.
- **Identity model**: the active identity is `db.sm.getActiveEthAddress()`; `userService` keys profiles by that address. Reactive auth state lives in `authStore` (driven by `db.sm.setSecurityStateChangeCallback`). The `OnboardingModal` gates the app until an identity is active.
- **Author display** follows `showRealName`; anonymous mode uses deterministic pseudonyms from `generatePseudonym(postId, authorId)`.
- **Querying**: filter with `db.map({ query: { type: '...' } })`; subscribe for live updates and always store/call the returned `unsubscribe`.

## Editing guidance

- Make the smallest change that fits the existing patterns; prefer reusing a store/service over adding a new transport or cache.
- Read only files directly relevant to the change.
- Output the final patch and a brief explanation.
