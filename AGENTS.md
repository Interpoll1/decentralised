# AGENTS.md — working on InterPoll with an AI assistant

> Cross-tool guide for AI coding assistants (GitHub Copilot, Cursor, Claude Code,
> Zed, etc.). InterPoll is built entirely on **GenosDB** — a peer-to-peer graph
> database with built-in cryptographic identity. There is no backend and no relay
> server. GenosDB's documentation is extensive, so when in doubt, read the linked
> official docs below: they are what make building (and AI pair-programming) on
> GenosDB comfortable and correct.

## Architecture in one screen

- **One database.** `src/services/gdbServices.ts` exports
  `db = await gdb('interpoll', { rtc: true, sm: { superAdmins, customRoles } })`.
  It provides identity + signing (Security Manager), OPFS storage (Web Worker,
  cross-tab via BroadcastChannel), and P2P sync (GenosRTC over WebRTC, Nostr for
  signaling only) — all built in.
- **Everything is a signed node**, read reactively with `db.map({ query }, cb)`.
  Vote-style data (`vote`, `postVote`, `commentVote`, `membership`) is one signed
  node per identity; **counts are derived, never mutated** → no last-write-wins races.
- **Identity** is the active SM address (`db.sm.getActiveEthAddress()`). Reactive
  auth state is in `stores/authStore.ts`; `components/OnboardingModal.vue` gates the
  app until an identity exists.
- **Open RBAC.** InterPoll is a public platform, so `sm.customRoles` grants the base
  `guest` role `write`/`link` — anyone posts/votes immediately. Authenticity is still
  enforced (every op signed + peer-verified); only authorization is opened.
- **Tamper-evident log** = signed `chainAction` nodes ordered by the Hybrid Logical
  Clock (`stores/chainStore.ts`); receipts are nodes.

## Conventions

- Import the single instance: `import { db } from '@/services/gdbServices'`. Never
  add a relay/WebSocket transport — sync is native.
- Use `await gdb(...)` top-level await; `db.put(value, id)`, `db.get(id)`,
  `db.map({ query }, cb)`.
- **Always store and call the `unsubscribe`** returned by a realtime `db.map`
  (use `onScopeDispose` in Pinia stores) — it is the #1 documented best practice.
- Prefer destructured callbacks: `({ id, value, action }) => …`.
- Stores call services; views/components call stores (not services directly).

## Build, test

```bash
pnpm install
pnpm dev       # Vite dev server (http://localhost:5173)
pnpm build
pnpm test      # Vitest
```

GenosDB lazy-loads modules via `import(new URL(...))`, so `vite.config.ts` sets
`optimizeDeps.exclude: ['genosdb']` and `build.target: 'es2022'`.

---

## GenosDB official documentation (read these)

### API & core
- [GDB API Reference](https://github.com/estebanrfp/gdb/blob/main/docs/genosdb-api-reference.md)
- [Features & architecture](https://github.com/estebanrfp/gdb/blob/main/docs/genosdb-features.md)
- [Examples & community projects](https://github.com/estebanrfp/gdb/blob/main/docs/genosdb-examples.md)
- [Distributed Trust Model](https://github.com/estebanrfp/gdb/blob/main/docs/genosdb-distributed-trust-model.md)
- [Zero-Trust Security Model (Guest → SuperAdmin)](https://github.com/estebanrfp/gdb/blob/main/docs/zero-trust-security-model.md)
- [Cursor-based pagination](https://github.com/estebanrfp/gdb/blob/main/docs/cursor‐based-pagination.md)
- [Resources](https://github.com/estebanrfp/gdb/blob/main/docs/genosdb-resources.md)

### CRUD
- [CRUD overview](https://github.com/estebanrfp/gdb/blob/main/docs/crud-operations-guide.md)
- [PUT](https://github.com/estebanrfp/gdb/blob/main/docs/put-guide.md) · [GET](https://github.com/estebanrfp/gdb/blob/main/docs/get-guide.md) · [MAP (queries, realtime, $edge)](https://github.com/estebanrfp/gdb/blob/main/docs/map-guide.md) · [REMOVE](https://github.com/estebanrfp/gdb/blob/main/docs/remove-guide.md) · [LINK](https://github.com/estebanrfp/gdb/blob/main/docs/link-guide.md)

### GenosRTC (P2P real-time)
- [GenosRTC API Reference](https://github.com/estebanrfp/gdb/blob/main/docs/genosrtc-api-reference.md)
- [GenosRTC Architecture](https://github.com/estebanrfp/gdb/blob/main/docs/genosrtc-architecture.md)
- [GenosRTC Guide](https://github.com/estebanrfp/gdb/blob/main/docs/genosrtc-guide.md)
- [Cellular Mesh (O(N) scaling)](https://github.com/estebanrfp/gdb/blob/main/docs/genosrtc-cells.md)

### Security Manager
- [SM API Reference (RBAC, WebAuthn/mnemonic, signing)](https://github.com/estebanrfp/gdb/blob/main/docs/sm-api-reference.md)
- [SM Architecture](https://github.com/estebanrfp/gdb/blob/main/docs/sm-architecture.md)
- [SM ACLs (node-level permissions)](https://github.com/estebanrfp/gdb/blob/main/docs/sm-acls-module.md)

### Optional modules & internals
- [Radix index (rx)](https://github.com/estebanrfp/gdb/blob/main/docs/rx-radix-tree.md) · [Audit](https://github.com/estebanrfp/gdb/blob/main/docs/audit.md) · [NLQ](https://github.com/estebanrfp/gdb/blob/main/docs/nlq-module.md) · [Geo](https://github.com/estebanrfp/gdb/blob/main/docs/geo-module.md)
- [Worker / persistence](https://github.com/estebanrfp/gdb/blob/main/docs/genosdb-worker-architecture.md) · [Hybrid Delta Protocol](https://github.com/estebanrfp/gdb/blob/main/docs/genosdb-hybrid-delta-protocol.md) · [Hybrid Logical Clock](https://github.com/estebanrfp/gdb/blob/main/docs/genosdb-hybrid-logical-clock.md) · [Bundler config](https://github.com/estebanrfp/gdb/blob/main/docs/bundler-configuration.md)

> Official repository: https://github.com/estebanrfp/gdb · npm: `genosdb`
> Claude Code users also get this as a skill at `.claude/skills/genosdb/`.
