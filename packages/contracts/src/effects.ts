import { z } from 'zod';

/**
 * Effects Planner worker I/O (spec sections 33, 57): runs right after
 * `TIMING`, before `RENDER`. Unlike the Director (`which` clip) and the
 * Timing Optimizer (`when` exactly), it only decides *which simple effects
 * this clip gets* — heuristic, no model. The `Timeline` document itself is
 * `@memetize/timeline`'s contract; this worker never changes its shape,
 * only `clip.effects`.
 */

export const EffectsInput = z.object({
  projectId: z.string(),
  /** Generation this run belongs to (F09/F11); absent only on legacy jobs. */
  generationId: z.string().optional(),
  /** Timeline version to plan effects on (F11); see `TimingInput`. */
  sourceTimelineVersion: z.number().int().positive().optional(),
});
export type EffectsInput = z.infer<typeof EffectsInput>;

export const EffectsOutput = z.object({
  projectId: z.string(),
  version: z.number().int().positive(),
  clipsWithEffects: z.number().int().nonnegative(),
});
export type EffectsOutput = z.infer<typeof EffectsOutput>;
