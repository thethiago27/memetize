import { z } from 'zod';

/**
 * Timing Optimizer worker I/O (spec sections 32, 56): runs right after
 * `DIRECTOR`, before `EFFECTS`. Unlike the Director, it never picks *which*
 * moment plays — it only nudges *when* each already-picked clip starts and
 * ends, snapping to the nearest musical beat/downbeat. The adjusted
 * `Timeline` document itself is `@memetize/timeline`'s contract, not this
 * one — this worker never changes its shape.
 */

export const TimingInput = z.object({
  projectId: z.string(),
});
export type TimingInput = z.infer<typeof TimingInput>;

export const TimingOutput = z.object({
  projectId: z.string(),
  version: z.number().int().positive(),
  clipsAdjusted: z.number().int().nonnegative(),
});
export type TimingOutput = z.infer<typeof TimingOutput>;
