import { z } from 'zod';

/**
 * HTTP I/O for the Studio API (spec sections 6, 58). The Fastify layer
 * validates these shapes and then calls the same package helpers the CLI
 * already uses — no processing logic lives here.
 */

export const ProjectReprocessFrom = z.enum([
  'audio',
  'lyrics',
  'narrative',
  'match',
  'director',
  'timing',
  'effects',
  'render',
]);
export type ProjectReprocessFrom = z.infer<typeof ProjectReprocessFrom>;

export const AssetReprocessFrom = z.enum([
  'frames',
  'transcript',
  'vision',
  'moments',
  'embeddings',
]);
export type AssetReprocessFrom = z.infer<typeof AssetReprocessFrom>;

export const ReprocessBody = z.object({
  from: z.string(),
});
export type ReprocessBody = z.infer<typeof ReprocessBody>;

export const SwapClipInput = z.object({
  momentId: z.string().min(1),
  /**
   * Timeline version the editor is looking at (F09). When present the swap is
   * refused with `409 VERSION_CONFLICT` if a newer version exists, so two edits
   * on the same version never silently drop one another.
   */
  expectedTimelineVersion: z.number().int().positive().optional(),
});
export type SwapClipInput = z.infer<typeof SwapClipInput>;

export const SearchQuery = z.object({
  q: z.string().min(1),
  type: z.string().default('MEME'),
  limit: z.coerce.number().int().positive().max(50).default(20),
});
export type SearchQuery = z.infer<typeof SearchQuery>;
