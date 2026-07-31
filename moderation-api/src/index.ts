import "dotenv/config";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { nanoid } from "nanoid";

import { ApiKeyStore, HashStore, InMemoryApiKeyStore, InMemoryHashStore } from "./store";
import { openDatabase, SqliteApiKeyStore, SqliteHashStore } from "./sqlite-store";
import { hashApiKey, generateRawApiKey } from "./auth";
import { buildHashRoutes } from "./routes/hashes";
import { buildApiKeyRoutes } from "./routes/api-keys";
import { buildHealthRoutes } from "./routes/health";
import { ApiKeyRecord } from "./types";

const PORT = Number(process.env.PORT ?? 3000);
// "sqlite" (default, persistent — recommended) or "memory" (dev/tests only,
// data lost on every restart).
const STORE_DRIVER = process.env.STORE_DRIVER ?? "sqlite";
const DB_PATH = process.env.DB_PATH ?? "./data/moderation.db";

function buildStores(): { hashStore: HashStore; apiKeyStore: ApiKeyStore } {
  if (STORE_DRIVER === "memory") {
    return { hashStore: new InMemoryHashStore(), apiKeyStore: new InMemoryApiKeyStore() };
  }
  const db = openDatabase(DB_PATH);
  return { hashStore: new SqliteHashStore(db), apiKeyStore: new SqliteApiKeyStore(db) };
}

/**
 * Creates an admin API key only if one doesn't already exist. With a
 * persistent store (SQLite), this means the bootstrap key is generated
 * exactly once across the database's lifetime — subsequent restarts reuse
 * whatever key(s) were already provisioned instead of minting a new one
 * every time.
 */
async function bootstrapAdminKeyIfNeeded(apiKeyStore: ApiKeyStore): Promise<void> {
  const existingKeys = await apiKeyStore.list();
  const hasActiveAdminKey = existingKeys.some((k) => !k.revoked && k.scopes.includes("admin"));
  if (hasActiveAdminKey) return;

  const fromEnv = process.env.BOOTSTRAP_ADMIN_KEY;
  const rawKey = fromEnv && fromEnv.length >= 16 ? fromEnv : generateRawApiKey();

  const record: ApiKeyRecord = {
    id: nanoid(),
    label: "bootstrap-admin",
    hashedKey: hashApiKey(rawKey),
    scopes: ["admin", "write", "read"],
    createdAt: new Date().toISOString(),
    revoked: false,
  };
  await apiKeyStore.create(record);

  if (!fromEnv) {
    // Printed once, on first run only — this is a dev convenience. In
    // production, always set BOOTSTRAP_ADMIN_KEY via a secrets manager
    // instead of relying on a generated key printed to stdout.
    // eslint-disable-next-line no-console
    console.log("\n================ ADMIN API KEY (shown once) ================");
    console.log(rawKey);
    console.log("===============================================================\n");
  }
}

async function main() {
  const { hashStore, apiKeyStore } = buildStores();
  await bootstrapAdminKeyIfNeeded(apiKeyStore);

  const app = express();
  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: "1mb" }));

  // Basic abuse protection. Tune per deployment; consider stricter limits
  // on the write path than the read path in production.
  app.use(
    rateLimit({
      windowMs: 60_000,
      max: 300,
      standardHeaders: true,
      legacyHeaders: false,
    })
  );

  app.use("/v1", buildHealthRoutes(hashStore));
  app.use("/v1", buildHashRoutes(hashStore, apiKeyStore));
  app.use("/v1", buildApiKeyRoutes(apiKeyStore));

  // 404 fallback
  app.use((_req, res) => {
    res.status(404).json({ error: { code: "not_found", message: "No such route." } });
  });

  app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`Moderation hash-match API (store: ${STORE_DRIVER}) listening on http://localhost:${PORT}`);
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Fatal startup error:", err);
  process.exit(1);
});

