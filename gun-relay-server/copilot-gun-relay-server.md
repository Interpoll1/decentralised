# GunDB Relay Server — `gun-relay-server/`

> **Keep this file updated** if you add or change the relay server implementation.

## Purpose

Runs a GunDB relay node that all browser clients (and `peer.js`) connect to for distributed data replication. Gun automatically keeps all peers in sync — the relay is just a always-on node.

## Runtime

```bash
npm run dev:gun          # node gun-relay-server/gun-relay.js
```

Default port: **8765**. Frontend connects to `http://localhost:8765/gun` (or the Render deployment at `https://interpoll2.onrender.com/gun`).

## Notes

- `gun-relay.js` is not committed to the repository (absent from git tracking). It runs on the server and may contain environment-specific configuration.
- The `gun-relay-server/` directory only contains `node_modules/` locally.
- The gun-relay server also exposes a `/db/search` REST endpoint used by `communityStore` as a MySQL fallback when GunDB hasn't synced yet: `GET /db/search?prefix=v2/communities&limit=200`.
- Data is persisted in `gun-relay-server/radata/` (gitignored) and mirrored to MySQL by the relay.

## Propagation Throttle

`gun-relay.js` intercepts incoming Gun wire messages (`gun.on('in')`) and applies five layers of protection:

| Layer | What it does |
|---|---|
| **Rate limit** | Max 20 puts/minute per peer (sliding window) |
| **Size limit** | Max 512 KB per individual put (`JSON.stringify` length) |
| **Deduplication** | SHA-256 ring buffer (50 hashes, 60 s window) per peer |
| **Flood detection** | ≥ 60 puts/min (3× limit) → 30 s pause for that peer |
| **Spam scoring** | Runs `SpamScorer` on text fields (`title`, `content`, `description`, `question`). ≥ 3 matches → `_flagged: true`; ≥ 6 → 3 s propagation delay |

A cleanup timer (every 60 s) evicts stale peer tracking entries. Both `SIGINT` and `SIGTERM` trigger graceful shutdown (clears timers, drains connections).

## GunDB Namespace

All data is under the `v2` namespace (set in `src/services/gunService.ts` as `GUN_NAMESPACE`). Bumping this constant orphans all existing data on user devices and forces a fresh sync from the relay.

## WebSocket Relay (`relay-server.js`)

The WebSocket relay server (root-level `relay-server.js`, port 8080) handles P2P message forwarding, OAuth, vote authorization, and receipt logging. It supports a `chatroom-message` message type that relays encrypted chat room messages to all other connected clients without decrypting — it forwards the opaque blob as-is via `broadcastToOthers`.

### Anti-Spam Modules (integrated into relay-server.js)

Four modules provide layered anti-abuse protection:

| Module | File | Purpose |
|---|---|---|
| `RateLimiter` | `rate-limiter.js` | Sliding-window rate limiting for HTTP and WS with escalating cooldowns |
| `BotDetector` | `bot-detector.js` | Behavioral scoring (interval variance, burst rate, content diversity) |
| `SpamScorer` | `spam-scorer.js` | Multi-language profanity/spam content scoring with PoW penalty signals |
| `PowChallenge` | `pow-challenge.js` | Hashcash-style proof-of-work challenges with adaptive difficulty |

**PoW protocol:** Client sends `request-pow` → server returns challenge (prefix + difficulty) → client finds nonce → includes `{ pow: { challengeId, nonce } }` in content messages (`broadcast`, `new-poll`, `new-block`). Difficulty adapts based on bot score, spam penalty, and device trust history.
