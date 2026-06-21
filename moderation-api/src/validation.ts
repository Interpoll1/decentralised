import { z } from "zod";

export const hashAlgorithmSchema = z.enum(["md5", "sha1", "sha256", "pdq", "phash"]);
export const severitySchema = z.enum(["low", "medium", "high", "critical"]);

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
