import { Router } from "express";
import { ApiKeyStore, HashStore } from "../store";
import { requireAuth } from "../auth";
import {
  hashAlgorithmSchema,
  isPlausibleHash,
  lookupQuerySchema,
  normalizeSubmitHashesBody,
  submitHashesBodySchema,
} from "../validation";
import { HashRecord, LookupResult } from "../types";

export function buildHashRoutes(hashStore: HashStore, apiKeyStore: ApiKeyStore): Router {
  const router = Router();

  /**
   * GET /v1/hashes/:hash?algorithm=sha256
   *
   * Looks up a single hash. No auth required by default (per the
   * standard's design: lookups are the high-volume, latency-sensitive
   * path used by upstream moderation pipelines). If you need to keep
   * your hash list confidential, mount requireAuth(['read','write','admin'])
   * on this route too — see README.
   */
  router.get("/hashes/:hash", async (req, res) => {
    const queryParse = lookupQuerySchema.safeParse(req.query);
    if (!queryParse.success) {
      res.status(400).json({
        error: { code: "invalid_query", message: "Invalid query parameters.", details: queryParse.error.flatten() },
      });
      return;
    }
    const { algorithm } = queryParse.data;
    const rawHash = req.params.hash;

    if (!isPlausibleHash(algorithm, rawHash)) {
      res.status(400).json({
        error: { code: "invalid_hash", message: `Hash is not valid for algorithm '${algorithm}'.` },
      });
      return;
    }

    const normalizedHash = rawHash.toLowerCase();
    const record = await hashStore.get(algorithm, normalizedHash);

    const result: LookupResult = {
      match: Boolean(record),
      hash: normalizedHash,
      algorithm,
      record,
    };

    res.status(200).json(result);
  });

  /**
   * POST /v1/hashes
   *
   * Submits one new hash record, or a batch (array) of up to 1000.
   * Requires an API key with 'write' or 'admin' scope.
   */
  router.post("/hashes", requireAuth(apiKeyStore, ["write", "admin"]), async (req, res) => {
    const normalizedBody = normalizeSubmitHashesBody(req.body);
    const parsed = submitHashesBodySchema.safeParse(normalizedBody);
    if (!parsed.success) {
      res.status(400).json({
        error: { code: "invalid_body", message: "Request body failed validation.", details: parsed.error.flatten() },
      });
      return;
    }

    const inputs = Array.isArray(parsed.data) ? parsed.data : [parsed.data];
    const now = new Date().toISOString();
    const saved: HashRecord[] = [];

    for (const input of inputs) {
      const existing = await hashStore.get(input.algorithm, input.hash.toLowerCase());
      const record: HashRecord = {
        hash: input.hash.toLowerCase(),
        algorithm: input.algorithm,
        categories: input.categories,
        severity: input.severity,
        source: input.source,
        metadata: input.metadata,
        addedAt: existing?.addedAt ?? now,
        updatedAt: now,
      };
      saved.push(await hashStore.upsert(record));
    }

    res.status(201).json({ created: saved.length, records: saved });
  });

  /**
   * DELETE /v1/hashes/:hash?algorithm=sha256
   *
   * Removes a hash from the database. Requires 'write' or 'admin' scope.
   */
  router.delete("/hashes/:hash", requireAuth(apiKeyStore, ["write", "admin"]), async (req, res) => {
    const algorithmParse = hashAlgorithmSchema.safeParse(req.query.algorithm ?? "sha256");
    if (!algorithmParse.success) {
      res.status(400).json({ error: { code: "invalid_query", message: "Invalid algorithm." } });
      return;
    }
    const algorithm = algorithmParse.data;
    const normalizedHash = String(req.params.hash).toLowerCase();

    const deleted = await hashStore.delete(algorithm, normalizedHash);
    if (!deleted) {
      res.status(404).json({ error: { code: "not_found", message: "No matching hash record found." } });
      return;
    }
    res.status(204).send();
  });

  return router;
}
