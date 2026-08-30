import { z } from 'zod';

/**
 * Domain enums shared across the whole system. Zod is the single source of
 * truth (spec section 34): TypeScript types are inferred, and the database
 * layer mirrors these values with CHECK constraints.
 */

export const JobStatus = z.enum(['PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED']);
export type JobStatus = z.infer<typeof JobStatus>;

export const ResourceClass = z.enum(['CPU_LIGHT', 'CPU_HEAVY', 'GPU', 'IO', 'RENDER']);
export type ResourceClass = z.infer<typeof ResourceClass>;

/**
 * Job types known so far. New workers add their own type here as the
 * pipeline grows (embedding, ...).
 */
export const JobType = z.enum([
  'PING',
  'VIDEO_NORMALIZE',
  'SCENE_DETECT',
  'FRAME_EXTRACT',
  'TRANSCRIPT',
  'VISION_ANALYZE',
  'MOMENT_EXTRACT',
  'EMBED',
]);
export type JobType = z.infer<typeof JobType>;

/** Granular asset lifecycle (spec section 40). */
export const AssetStatus = z.enum([
  'INGESTED',
  'NORMALIZING',
  'ANALYZING',
  'INDEXING',
  'READY',
  'FAILED',
]);
export type AssetStatus = z.infer<typeof AssetStatus>;
