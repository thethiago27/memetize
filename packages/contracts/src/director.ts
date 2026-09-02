import { ClipStyle, TransitionStyle } from '@memetize/timeline';
import { z } from 'zod';

/**
 * Timeline Director worker I/O (spec sections 31, 39): unlike `MATCH`, the
 * Director never touches the catalog directly — it only picks one moment
 * per narrative segment out of the shortlist `MATCH` already produced. The
 * assembled `Timeline` document itself is `@memetize/timeline`'s contract,
 * not this one.
 */

export const DirectorInput = z.object({
  projectId: z.string(),
});
export type DirectorInput = z.infer<typeof DirectorInput>;

export const DirectorOutput = z.object({
  projectId: z.string(),
  version: z.number().int().positive(),
  clipCount: z.number().int().nonnegative(),
});
export type DirectorOutput = z.infer<typeof DirectorOutput>;

/**
 * One choice out of a segment's shortlist. Assemble fills in ranges/transform.
 * The cut styles (cut-styles spec) are proposals: Assemble puts `clipStyle`
 * on the segment's primary clip and `transitionOut` on its last clip, and
 * the Effects resolver may downgrade either against real source handles.
 */
export const DirectorPick = z.object({
  segmentId: z.string(),
  momentId: z.string(),
  clipStyle: ClipStyle.default('none'),
  transitionOut: TransitionStyle.default('hard'),
});
export type DirectorPick = z.infer<typeof DirectorPick>;
