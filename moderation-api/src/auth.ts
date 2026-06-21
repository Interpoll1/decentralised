import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { NextFunction, Request, Response } from "express";
import { ApiKeyStore } from "./store";
import { ApiKeyScope } from "./types";

const KEY_PREFIX = "mod_sk_"; // "moderation secret key" — makes leaked keys greppable

export function generateRawApiKey(): string {
  return KEY_PREFIX + randomBytes(24).toString("base64url");
}

export function hashApiKey(rawKey: string): string {
  return createHash("sha256").update(rawKey, "utf8").digest("hex");
}

function safeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      apiKeyId?: string;
      apiKeyScopes?: ApiKeyScope[];
    }
  }
}

function extractRawKey(req: Request): string | undefined {
  const header = req.header("authorization");
  if (header?.startsWith("Bearer ")) return header.slice("Bearer ".length).trim();
  const apiKeyHeader = req.header("x-api-key");
  if (apiKeyHeader) return apiKeyHeader.trim();
  return undefined;
}

/**
 * Returns Express middleware that requires a valid, non-revoked API key
 * carrying at least one of `requiredScopes`. Mount only on the routes that
 * need it (e.g. hash ingestion) — public/read routes can skip this.
 */
export function requireAuth(apiKeyStore: ApiKeyStore, requiredScopes: ApiKeyScope[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const rawKey = extractRawKey(req);
    if (!rawKey) {
      res.status(401).json({
        error: {
          code: "missing_api_key",
          message: "Provide an API key via 'Authorization: Bearer <key>' or 'X-API-Key' header.",
        },
      });
      return;
    }

    const hashed = hashApiKey(rawKey);
    const record = await apiKeyStore.findByHashedKey(hashed);

    // Constant-time-ish check even on the not-found path to reduce timing signal.
    if (!record || !safeEqualHex(hashed, record.hashedKey)) {
      res.status(401).json({ error: { code: "invalid_api_key", message: "API key is invalid." } });
      return;
    }

    if (record.revoked) {
      res.status(401).json({ error: { code: "revoked_api_key", message: "API key has been revoked." } });
      return;
    }

    const hasScope = requiredScopes.some((s) => record.scopes.includes(s));
    if (!hasScope) {
      res.status(403).json({
        error: {
          code: "insufficient_scope",
          message: `This action requires one of the following scopes: ${requiredScopes.join(", ")}.`,
        },
      });
      return;
    }

    req.apiKeyId = record.id;
    req.apiKeyScopes = record.scopes;
    await apiKeyStore.touch(record.id);
    next();
  };
}
