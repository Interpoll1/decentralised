import { z } from "zod";

export const hashAlgorithmSchema = z.enum(["md5", "sha1", "sha256", "pdq", "phash"]);
export const severitySchema = z.enum(["low", "medium", "high", "critical"]);

function normalizeAlgorithm(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().toLowerCase();
  const compact = trimmed.replace(/[-_\s]/g, "");
  if (compact === "sha256" || compact === "sha256hex") return "sha256";
  if (compact === "sha1" || compact === "sha1hex") return "sha1";
  if (compact === "md5" || compact === "md5hex") return "md5";
  if (compact === "pdq") return "pdq";
  if (compact === "phash") return "phash";
  return undefined;
}

function normalizeSeverity(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().toLowerCase();
  if (["low", "medium", "high", "critical"].includes(trimmed)) return trimmed;
  if (trimmed === "urgent") return "critical";
  if (trimmed === "moderate") return "medium";
  return undefined;
}

function normalizeCategories(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const categories = value.flatMap((item) => {
      if (typeof item !== "string") return [];
      return item
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);
    });
    return categories.length > 0 ? categories : undefined;
  }
  if (typeof value === "string") {
    const categories = value
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    return categories.length > 0 ? categories : undefined;
  }
  return undefined;
}

function normalizeHashRecordInput(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  const record = value as Record<string, unknown>;
  const normalized: Record<string, unknown> = { ...record };

  const algorithm = normalizeAlgorithm(record.algorithm);
  if (algorithm) normalized.algorithm = algorithm;

  const severity = normalizeSeverity(record.severity);
  if (severity) normalized.severity = severity;

  const categories = normalizeCategories(record.categories ?? record.category);
  if (categories) normalized.categories = categories;

  if (typeof record.hash !== "string" && typeof record.digest === "string") {
    normalized.hash = record.digest;
  } else if (typeof record.hash !== "string") {
    const aliases = [record.hashValue, record.sha256, record.sha1, record.md5, record.value];
    const aliasValue = aliases.find((item): item is string => typeof item === "string" && item.trim().length > 0);
    if (aliasValue) normalized.hash = aliasValue;
  }

  if (typeof normalized.source !== "string" || !normalized.source.trim()) {
    normalized.source = record.source ?? record.origin ?? "client";
  }

  if (typeof normalized.source !== "string" || !normalized.source.trim()) {
    normalized.source = "client";
  }

  if (typeof normalized.metadata === "undefined") {
    normalized.metadata = record.meta ?? record.metadata;
  }

  return normalized;
}

export function normalizeSubmitHashesBody(body: unknown): unknown {
  if (Array.isArray(body)) {
    return body.map(normalizeHashRecordInput);
  }
  return normalizeHashRecordInput(body);
}

const HEX_LENGTH_BY_ALGORITHM: Record<string, number> = {
  md5: 32,
  sha1: 40,
  sha256: 64,
};

/** Validates hex-digest algorithms strictly; perceptual hashes (pdq/phash) only get a loose length/charset check. */
export function isPlausibleHash(algorithm: string, hash: string): boolean {
  if (algorithm in HEX_LENGTH_BY_ALGORITHM) {
    const expectedLen = HEX_LENGTH_BY_ALGORITHM[algorithm];
    return new RegExp(`^[a-f0-9]{${expectedLen}}$`, "i").test(hash);
  }
  // pdq/phash: typically 64-256 bit hex strings depending on implementation.
  return /^[a-f0-9]{16,256}$/i.test(hash);
}

export const hashRecordInputSchema = z
  .object({
    hash: z.string().min(8).max(256),
    algorithm: hashAlgorithmSchema,
    categories: z.array(z.string().min(1)).min(1),
    severity: severitySchema,
    source: z.string().min(1).max(128),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((val) => isPlausibleHash(val.algorithm, val.hash), {
    message: "Hash does not match expected format/length for the given algorithm.",
    path: ["hash"],
  });

export const submitHashesBodySchema = z.union([
  hashRecordInputSchema,
  z.array(hashRecordInputSchema).min(1).max(1000),
]);

export const lookupQuerySchema = z.object({
  algorithm: hashAlgorithmSchema.default("sha256"),
});

export const createApiKeyBodySchema = z.object({
  label: z.string().min(1).max(128),
  scopes: z.array(z.enum(["read", "write", "admin"])).min(1),
});
