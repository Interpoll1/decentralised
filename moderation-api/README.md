# Moderation Hash-Match API

A reference implementation of a small standard for content-moderation hash
lookups: `GET` a hash, get back whether it matches something in the
database; `POST` new hashes in, gated behind an API key.

Full protocol description: [`SPEC.md`](./SPEC.md)
Machine-readable contract: [`openapi.yaml`](./openapi.yaml)

## Quick start

Requires **Node ≥ 22.5** (uses the built-in `node:sqlite` module — check
with `node -v`).

```bash
npm install
cp .env.example .env   # optionally set BOOTSTRAP_ADMIN_KEY
npm run dev            # ts-node-style dev server with reload
```

By default this creates a SQLite file at `./data/moderation.db` (override
with `DB_PATH`). On first boot against an empty database (if
`BOOTSTRAP_ADMIN_KEY` isn't set) the server prints a one-time admin API
key to stdout — save it, it won't be shown again, and restarts won't
generate a new one as long as the database file persists.

## Example usage

```bash
# Look up a hash (no auth needed by default)
curl "http://localhost:3000/v1/hashes/<sha256-hex>?algorithm=sha256"

# Submit a new hash (requires write/admin scope)
curl -X POST http://localhost:3000/v1/hashes \
  -H "Authorization: Bearer mod_sk_..." \
  -H "Content-Type: application/json" \
  -d '{
        "hash": "<sha256-hex>",
        "algorithm": "sha256",
        "categories": ["abuse"],
        "severity": "high",
        "source": "manual-review"
      }'

# Mint a narrower-scoped key for a downstream service (requires admin)
curl -X POST http://localhost:3000/v1/api-keys \
  -H "Authorization: Bearer mod_sk_..." \
  -H "Content-Type: application/json" \
  -d '{"label": "ingestion-pipeline", "scopes": ["write"]}'
```

## Project layout

```
src/
  index.ts          server bootstrap, middleware, route mounting, store selection
  types.ts          HashRecord, ApiKeyRecord, LookupResult, etc.
  store.ts          HashStore / ApiKeyStore interfaces + in-memory impl (dev/tests)
  sqlite-store.ts    SQLite-backed impl of the same interfaces (default, persistent)
  auth.ts           API key hashing, generation, requireAuth middleware
  validation.ts     zod schemas + hash-format checks per algorithm
  routes/
    hashes.ts       GET/POST/DELETE /v1/hashes
    api-keys.ts     POST/GET/DELETE /v1/api-keys
    health.ts       GET /v1/health
openapi.yaml         OpenAPI 3.0 spec
SPEC.md              human-readable protocol description
```

## Deploying with PM2

This ships with `ecosystem.config.js`, set up to run the **compiled** output
(`dist/index.js`) — don't run `tsx`/dev mode under PM2 in production.

```bash
# 1. Get the code onto the server (scp/rsync the zip, or git clone), then:
cd moderation-api
npm ci                 # clean install from package-lock.json
npm run build           # compiles src/ -> dist/

# 2. Configure environment
cp .env.example .env
nano .env               # set BOOTSTRAP_ADMIN_KEY to a long random value

# 3. Install PM2 globally if it's not already on the box
npm install -g pm2

# 4. Start it
mkdir -p logs
pm2 start ecosystem.config.js

# 5. Useful PM2 commands
pm2 status
pm2 logs moderation-api
pm2 restart moderation-api
pm2 stop moderation-api

# 6. Persist across reboots
pm2 save
pm2 startup             # prints a command to copy/paste (sets up the systemd/init hook)
```

Notes:

- `ecosystem.config.js` reads `dist/index.js`, so re-run `npm run build`
  (or `pm2 reload moderation-api` after rebuilding) whenever you deploy new
  code — PM2 doesn't watch `src/` in this config.
- `BOOTSTRAP_ADMIN_KEY` and `DB_PATH` should go in `.env`, not in
  `ecosystem.config.js`, since the server loads them via `dotenv` at
  startup; keep `.env` out of version control (already in `.gitignore`).
- Data lives in `data/moderation.db` (relative to `cwd` in
  `ecosystem.config.js`) and survives PM2 restarts/redeploys — it's a
  regular file, so back it up like any other server file (`pm2 stop`
  first if you want a perfectly consistent snapshot, though WAL mode
  makes that rarely necessary).
- Requires **Node ≥ 22.5** on the server for `node:sqlite`; check with
  `node -v` before deploying, and note the console will print an
  "experimental feature" warning from Node itself on every boot — that's
  expected, not an error.
- Keep `instances: 1` / `exec_mode: "fork"` in the PM2 config. SQLite
  handles one writer at a time; PM2 cluster mode (multiple Node processes
  sharing a port) would have them contend for the same file. If you
  outgrow a single instance, that's the point to move to Postgres (see
  `SPEC.md` → Deployment notes) rather than scaling the SQLite file out.
- If you're putting this behind nginx/Caddy as a reverse proxy with TLS,
  point it at `127.0.0.1:3000` (or whatever `PORT` you set).



## Production checklist

This is a reference implementation; before deploying for real, see
"Deployment notes" in `SPEC.md` — specifically: decide whether lookups
need auth in your threat model, tune rate limits per route, and back up
`data/moderation.db` regularly (SQLite is durable, but it's still a
single file).

## Scripts

- `npm run dev` — run with auto-reload
- `npm run build` — compile to `dist/`
- `npm start` — run compiled output
