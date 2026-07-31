# Copilot Instructions — InterPoll

## Required context before edits

- Read and follow the submodule documentation for the area you change, then update that doc if behavior/contracts changed:
  - `src/services/copilot-services.md`
  - `src/stores/copilot-stores.md`
  - `src/components/copilot-components.md`
  - `src/views/copilot-views.md`
  - `src/composables/copilot-composables.md`
  - `src/types/copilot-types.md`
  - `src/utils/copilot-utils.md`
  - `src/router/copilot-router.md`
  - `gun-relay-server/copilot-gun-relay-server.md`

## Build, test, lint

```bash
npm run dev
npm run build
npm run preview
npm run lint
npm test
```

Single test/file examples:

```bash
npm test -- unit_tests/pow-challenge.test.js
npm test -- -t "requiresPow"
```

Linux tooling wrappers used by docs/CI:

```bash
./tools/linux/test.sh --test-filter pow-challenge.test.js
./tools/linux/validate.sh
./tools/linux/security-smoke.sh
```

## High-level architecture

- InterPoll is a browser-first decentralized app with three core runtime layers:
  1. **Local blockchain in IndexedDB** (`ChainService` + `chainStore`) for tamper-evident vote/action history.
  2. **GunDB replicated content graph** (`GunService`, `PollService`, `PostService`, `CommentService`, etc.) for polls, posts, communities, users, images, and chat-room data.
  3. **WebSocket relay + BroadcastChannel sync** (`WebSocketService`, `BroadcastService`) for cross-device and cross-tab propagation of chain events and updates.
- Integrity path for mutating relay messages is hash/signature/PoW/replay protection (`IntegrityService` + `shared-validation/*`).
- Vote backend flow is two-phase authorize/confirm with reservation tokens (`AuditService`, relay `/api/vote-authorize` + `/api/vote-confirm|record`).
- Relay discovery and failover combine signed Gun discovery entries and websocket server-list broadcasts (`DiscoveryService`, `RelayManager`, `WebSocketService`).
- Private communities/chats use local key storage + encrypted payloads (`EncryptionService`, `KeyVaultService`, `InviteLinkService`, `ChatRoomService`).

## Key conventions

- **Use runtime config, never hardcoded endpoints**: `import config from '@/config'`; use `config.relay.websocket`, `config.relay.gun`, `config.relay.api`.
- **Service pattern**: services are static classes; use `ServiceName.method()`. Main exceptions are instance-based `ChatService` and `SearchService`.
- **Store/component layering**: views/components consume Pinia stores; stores call services; components should not call services directly.
- **Gun namespace contract**: Gun roots are proxied under `GUN_NAMESPACE` (currently `v3` in `gunService.ts`); callers use logical roots (e.g., `gun.get('polls')`). If adding a root, update `NAMESPACED_ROOTS`.
- **Identity/signing model**:
  - user/device signing keys come from `KeyService` and are persisted in IndexedDB metadata.
  - user profiles in GunDB include public key and identity trust metadata (`identityUsername`, `identityIssuer`, `identityTrustLevel`).
  - post/poll/comment author display follows `showRealName`; anonymous mode uses deterministic pseudonyms from `generatePseudonym(postId, authorId)`.
- **Backend source of truth note**: production relay implementation is in `relay-server/relay-server-enhanced.js` (the `relay-server/` directory is gitignored in this repo, so edits there do not appear in git status/diffs).
- **Review agent convention used in this repo**:
  - Frontend changes: iterate with `vue-code-reviewer` until all clear.
  - Backend/security changes: iterate with `ts-backend-security-auditor` until all clear.
  - If agents conflict, use `agent-arbitrator`.
IMPORTANT:
- Read only files that are directly relevant.
- Do not scan the entire repository.
- Do not create a multi-step plan unless requested.
- Make the smallest possible change.
- Ask before reading additional files.
- Output only the final patch and a brief explanation.
i am short on tokens. if you find you are too powerful for task. tell me
Do not perform multi-step environment discovery unless the file is missing.
Ask for missing paths once instead of searching repeatedly.
Assume tools are available unless failure occurs.