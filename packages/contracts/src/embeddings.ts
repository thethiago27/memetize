import { z } from 'zod';

/**
 * Semantic search contracts (spec sections 23, 28, 40): each moment gets
 * embedded from three angles so the Candidate Retriever can match a query
 * against whichever aspect it describes best.
 */

export const EmbeddingType = z.enum(['VISUAL', 'MEME', 'NARRATIVE']);
export type EmbeddingType = z.infer<typeof EmbeddingType>;

// EMBED
export const EmbedInput = z.object({
  assetId: z.string(),
});
export type EmbedInput = z.infer<typeof EmbedInput>;

export const EmbedOutput = z.object({
  assetId: z.string(),
  embeddingCount: z.number().int().nonnegative(),
  model: z.string(),
  modelVersion: z.string(),
});
export type EmbedOutput = z.infer<typeof EmbedOutput>;

/** One candidate returned by the retriever (spec section 28): `score` is
 * `1 - cosineDistance`, so 1.0 means an exact match. */
export const SearchHit = z.object({
  momentId: z.string(),
  assetId: z.string(),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
  description: z.string(),
  score: z.number(),
});
export type SearchHit = z.infer<typeof SearchHit>;
