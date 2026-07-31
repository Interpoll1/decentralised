# Moderation Hash-Match API — Standard (v1.0.0)

This document describes the protocol. `openapi.yaml` is the machine-readable
version of the same contract; the reference server in `src/` implements it.

## 1. Purpose

A small, self-contained service that:

1. Lets any client check whether a hash (file hash or perceptual hash) is
   present in a moderation database, via `GET`.
2. Lets *authenticated* clients add new hash records via `POST`, so the
   database can be grown by trusted sources (internal pipelines, partner
   hash-sharing feeds, manual review tooling).

This mirrors how real hash-sharing systems for harmful content are usually
built: broad, fast, low-friction read access for anything doing moderation
at the edge, and tightly gated write access so the list itself can't be
poisoned or trivially enumerated/abused by whoever controls ingestion.

## 2. Data model

A **hash record** is:

| field        | type                              | notes                                   |
|--------------|------------------------------------|------------------------------------------|
| `hash`       | string                             | lowercase hex digest                     |
| `algorithm`  | `md5 \| sha1 \| sha256 \| pdq \| phash` | `pdq`/`phash` cover perceptual hashes |
| `categories` | string[]                           | free-form tags, e.g. `["csam"]`, `["violence"]` |
| `severity`   | `low \| medium \| high \| critical`|                                          |
| `source`     | string                             | which feed/system/team contributed it    |
| `addedAt`    | ISO-8601 timestamp                 | set once, preserved on update            |
| `updatedAt`  | ISO-8601 timestamp                 | bumped on every upsert                   |
| `metadata`   | object (optional)                  | case IDs, notes, anything operator-specific |

Hashes are namespaced by `(algorithm, hash)`, so the same digest under two
algorithms is two records.

## 3. Endpoints

| Method | Path                 | Auth                | Purpose                       |
|--------|----------------------|----------------------|--------------------------------|
| GET    | `/v1/health`          | none                 | liveness + record count        |
| GET    | `/v1/hashes/:hash`    | none (configurable)  | look up a single hash          |
| POST   | `/v1/hashes`          | `write` or `admin`   | add/update one or many records |
| DELETE | `/v1/hashes/:hash`    | `write` or `admin`   | remove a record                |
| POST   | `/v1/api-keys`        | `admin`              | issue a new API key            |
| GET    | `/v1/api-keys`        | `admin`              | list keys (no secrets)         |
| DELETE | `/v1/api-keys/:id`    | `admin`              | revoke a key                   |

`GET /v1/hashes/:hash` returns `200` with `{ "match": false, ... }` for a
miss rather than `404` — a miss is meaningful moderation signal, not an
error condition.

## 4. Authentication

API keys are bearer tokens (`mod_sk_...`), sent as either:

```
Authorization: Bearer mod_sk_xxxxxxxx
```
or
```
X-API-Key: mod_sk_xxxxxxxx
```

Only a SHA-256 hash of the key is ever stored server-side; the raw key is
shown exactly once, at creation time, and cannot be retrieved again. Keys
carry one or more **scopes**:

- `read` — reserved for deployments that lock down lookups too (see §6)
- `write` — can submit and delete hash records
- `admin` — can additionally manage API keys; implies `write`/`read` in
  the reference server's bootstrap key, but scopes are independent and an
  operator may issue keys with any combination

On first boot, the server creates one bootstrap key with all three scopes
(from `BOOTSTRAP_ADMIN_KEY` env var if set, otherwise a freshly generated
key printed once to stdout). Use it to mint narrower-scoped keys for real
clients, then treat it like a root credential.

## 5. Error format

All errors share one shape:

```json
{ "error": { "code": "invalid_hash", "message": "...", "details": {} } }
```

Common codes: `missing_api_key`, `invalid_api_key`, `revoked_api_key`,
`insufficient_scope`, `invalid_query`, `invalid_hash`, `invalid_body`,
`not_found`.

## 6. Deployment notes

- **Lookups are open by default**, matching "GET searches the DB, no auth
  mentioned" in the spec this was built from. If your hash list itself is
  sensitive (e.g. you don't want adversaries probing which of their files
  are flagged), mount `requireAuth(apiKeyStore, ["read","write","admin"])`
  on the `GET /hashes/:hash` route too — the middleware already supports
  this, it's a one-line change in `src/index.ts` / `src/routes/hashes.ts`.
- **Storage is SQLite by default**, via Node's built-in `node:sqlite`
  module (`SqliteHashStore` / `SqliteApiKeyStore` in `src/sqlite-store.ts`)
  — no native compilation, no separate database server, just a file on
  disk (`DB_PATH`, default `./data/moderation.db`). This requires
  **Node ≥ 22.5**. An in-memory implementation (`STORE_DRIVER=memory`) is
  also available for tests/throwaway dev servers, but loses all data on
  restart. Both implement the same `HashStore` / `ApiKeyStore` interfaces,
  so swapping in Postgres/Redis/DynamoDB later means writing one more
  adapter, not touching the route handlers.
- The bootstrap admin key is only generated once, the first time the
  server starts against an empty database — restarts reuse whatever
  admin-scoped key(s) already exist rather than minting a new one each
  time.
- **Rate limiting** is a flat 300 req/min/IP via `express-rate-limit` as a
  starting point; tune per-route in production (writes typically need
  tighter limits than reads).
- **Batch ingestion**: `POST /v1/hashes` accepts either a single record or
  an array (≤1000) in one call, for bulk-loading a feed.
