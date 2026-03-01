# Copilot Instructions — InterPoll
## Agent running
If you edit frontend, please iteratively run the vue-code-reviewer agent until it return no errors or all clear. If you touch the backend, run iteratively the ts-backend-security-auditor
If there is conflict between the agents use agent-arbitrator for final decision.

## Submodule Documentation

Each source folder has a dedicated file describing its contents. **Read the relevant file before editing that area, and update it whenever you add, remove, or significantly change something in that folder.**

| Folder | Documentation file |
|---|---|
| `src/services/` | [`src/services/copilot-services.md`](../src/services/copilot-services.md) |
| `src/stores/` | [`src/stores/copilot-stores.md`](../src/stores/copilot-stores.md) |
| `src/components/` | [`src/components/copilot-components.md`](../src/components/copilot-components.md) |
| `src/views/` | [`src/views/copilot-views.md`](../src/views/copilot-views.md) |
| `src/composables/` | [`src/composables/copilot-composables.md`](../src/composables/copilot-composables.md) |
| `src/types/` | [`src/types/copilot-types.md`](../src/types/copilot-types.md) |
| `src/utils/` | [`src/utils/copilot-utils.md`](../src/utils/copilot-utils.md) |
| `src/router/` | [`src/router/copilot-router.md`](../src/router/copilot-router.md) |
| `gun-relay-server/` | [`gun-relay-server/copilot-gun-relay-server.md`](../gun-relay-server/copilot-gun-relay-server.md) |

---

## Build & Run

```bash
npm run dev          # Vite dev server (localhost:5173)
npm run build        # Type-check + production build
npm run preview      # Serve dist/ locally
npm run lint         # ESLint --fix (.vue/.ts/.js)
npm run dev:relay    # WebSocket relay server (port 8080)
npm run dev:gun      # GunDB relay server (port 8765)
npm run dev:peer     # Headless peer node (peer.js)
./run.sh             # All three in a tmux session (creates/attaches)
```

There is no test runner. `npm run build` runs `vue-tsc` as the type check.

---

## Architecture

Three processes must run together for full functionality:

```
Browser (Vue SPA)
  ├── IndexedDB (blockchain: blocks, votes, receipts)
  ├── GunDB ←→ gun-relay-server/:8765  (polls, communities, users, posts, images)
  └── WebSocket ←→ relay-server.js/:8080  (peer sync, chat routing, OAuth, vote auth)
       └── BroadcastChannel (cross-tab sync, no network needed)
```

**`peer.js`** is an optional headless node that stays online to ensure data is always available for new clients requesting sync.

**`seed.js`** seeds communities/posts/polls into a live deployment via the relay's `/api/seed` endpoint.

---

## Key Conventions

### Config — always use `@/config`

```ts
import config from '@/config';
config.relay.websocket  // WebSocket URL (runtime-mutable)
config.relay.gun        // GunDB URL   (runtime-mutable)
config.relay.api        // API base URL (runtime-mutable)
```

Never hardcode relay URLs. The config reads localStorage overrides (`interpoll_relay_config`) and falls back to Render deployment defaults. Users change these at runtime from SettingsPage.

### Services — static classes, never instantiated

All services in `src/services/` are static classes. Call `ServiceName.method()`. They are initialized once (typically in `main.ts` or `chainStore.initialize()`). Two exceptions: `ChatService` and `SearchService` are instance-based.

### Stores — Composition API Pinia, consume in views/components

```ts
export const useMyStore = defineStore('name', () => {
  const data = ref<...>(...);
  // ...
  return { data, ... };
});
```

Views and components use stores. Stores use services. Components do not call services directly.

### GunDB namespace

All GunDB data roots are transparently namespaced under `v2` by a Proxy in `gunService.ts`. Callers use `gun.get('polls')` — it routes to `gun.get('v2').get('polls')` automatically. To add a new root, add it to `NAMESPACED_ROOTS` in `gunService.ts`.

### Blockchain sync — dual channel

Both `BroadcastService` (cross-tab) and `WebSocketService` (cross-device) use the same message types: `new-block`, `request-sync`, `sync-response`, `new-event`. They are always wired in parallel in `chainStore`. Sync is incremental: clients send their `lastIndex` and only receive missing blocks.

### Block types

To add a new action type to the blockchain, extend `ActionType` in `src/types/chain.ts` and call `chainStore.addAction(actionType, data, label)`.

### Path alias

`@/` = `src/`. Configured in both `vite.config.ts` and `tsconfig.json`.

### TypeScript

Strict mode enabled (`strict`, `noUnusedLocals`, `noUnusedParameters`). `moduleResolution: "bundler"`. Import types with `import type { ... }`.

### Images

Stored in GunDB (not IPFS, despite `ipfsService.ts` name). Compressed client-side: full image ≤500 KB, thumbnails ≤20 KB, both base64-encoded. CIDs are `img-{timestamp}-{random}`.

### Pseudonyms

Author names in posts/comments are generated at render time from `generatePseudonym(postId, authorId)` (`src/utils/pseudonym.ts`). They are deterministic but not stored — same user gets a different name in each post.

### Anti-fraud layers (vote integrity)

Four independent mechanisms, any subset may be active: device fingerprint (IndexedDB), backend registry (`pollId:deviceId` in-memory on relay), single-use invite codes (GunDB), OAuth gating (optional).
