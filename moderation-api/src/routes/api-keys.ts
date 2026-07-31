import { Router } from "express";
import { nanoid } from "nanoid";
import { ApiKeyStore } from "../store";
import { generateRawApiKey, hashApiKey, requireAuth } from "../auth";
import { createApiKeyBodySchema } from "../validation";
import { ApiKeyRecord } from "../types";

export function buildApiKeyRoutes(apiKeyStore: ApiKeyStore): Router {
  const router = Router();

  /**
   * POST /v1/api-keys
   * Creates a new API key. Requires 'admin' scope.
   * The raw key is returned exactly once and is never stored or logged.
   */
  router.post("/api-keys", requireAuth(apiKeyStore, ["admin"]), async (req, res) => {
    const parsed = createApiKeyBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: { code: "invalid_body", message: "Request body failed validation.", details: parsed.error.flatten() },
      });
      return;
    }

    const rawKey = generateRawApiKey();
    const record: ApiKeyRecord = {
      id: nanoid(),
      label: parsed.data.label,
      hashedKey: hashApiKey(rawKey),
      scopes: parsed.data.scopes,
      createdAt: new Date().toISOString(),
      revoked: false,
    };
    await apiKeyStore.create(record);

    res.status(201).json({
      id: record.id,
      label: record.label,
      scopes: record.scopes,
      createdAt: record.createdAt,
      apiKey: rawKey, // shown once
    });
  });

  /** GET /v1/api-keys — lists keys (without raw key material). Requires 'admin' scope. */
  router.get("/api-keys", requireAuth(apiKeyStore, ["admin"]), async (_req, res) => {
    const keys = await apiKeyStore.list();
    res.status(200).json(
      keys.map(({ hashedKey: _hashedKey, ...safe }) => safe)
    );
  });

  /** DELETE /v1/api-keys/:id — revokes a key. Requires 'admin' scope. */
  router.delete("/api-keys/:id", requireAuth(apiKeyStore, ["admin"]), async (req, res) => {
    const revoked = await apiKeyStore.revoke(String(req.params.id));
    if (!revoked) {
      res.status(404).json({ error: { code: "not_found", message: "No such API key." } });
      return;
    }
    res.status(204).send();
  });

  return router;
}
