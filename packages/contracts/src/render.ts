import { z } from 'zod';

/**
 * Renderer worker I/O (spec sections 36-39): the Renderer turns the latest
 * `timeline_versions` row into an MP4. It never touches a model provider —
 * only FFmpeg/ffprobe (spec section 36's "no AI").
 */

/**
 * Which source a render reads from. `final` exports from the original
 * (full-resolution) asset; `preview` may use the low-resolution proxy. The
 * default is `final` so an unqualified render never silently exports the
 * preview proxy (F06).
 */
export const RenderProfile = z.enum(['preview', 'final']);
export type RenderProfile = z.infer<typeof RenderProfile>;

export const RenderInput = z.object({
  projectId: z.string(),
  profile: RenderProfile.default('final'),
});
export type RenderInput = z.infer<typeof RenderInput>;

/** Non-blocking technical/editorial issues (spec section 38). */
export const RenderWarningCode = z.enum([
  'CLIP_TOO_SHORT',
  'TIMELINE_GAP',
  'EMPTY_TIMELINE',
  'SOURCE_SHORTER_THAN_SLOT',
  'UNKNOWN_EFFECT',
  'DURATION_DRIFT',
]);
export type RenderWarningCode = z.infer<typeof RenderWarningCode>;

export const RenderWarning = z.object({
  code: RenderWarningCode,
  clipId: z.string().optional(),
  startMs: z.number().int().nonnegative().optional(),
  endMs: z.number().int().nonnegative().optional(),
  durationMs: z.number().int().nonnegative().optional(),
  message: z.string().optional(),
});
export type RenderWarning = z.infer<typeof RenderWarning>;

/** Persisted alongside every `renders` row (spec section 38's validator output). */
export const RenderValidation = z.object({
  valid: z.boolean(),
  warnings: z.array(RenderWarning),
});
export type RenderValidation = z.infer<typeof RenderValidation>;

export const RenderOutput = z.object({
  projectId: z.string(),
  version: z.number().int().positive(),
  path: z.string(),
  durationMs: z.number().int().nonnegative(),
  warningCount: z.number().int().nonnegative(),
});
export type RenderOutput = z.infer<typeof RenderOutput>;
