import { z } from 'zod';
import { RetrievedCandidate } from './match';

/**
 * Editorial memory contracts (editorial-memory spec): every swap, rating,
 * ban, note, and system placement is one append-only `feedback_events` row.
 * Aggregation, evaluation, and Director lessons are pure functions of these
 * rows, so the context snapshot must carry everything they need.
 */

export const FeedbackKind = z.enum([
  'SWAP_OUT',
  'SWAP_IN',
  'CLIP_UP',
  'CLIP_DOWN',
  'VIDEO_RATING',
  'BAN_MOMENT',
  'UNBAN_MOMENT',
  'BAN_ASSET',
  'UNBAN_ASSET',
  'NOTE',
  'PLACED',
  'EXCLUDE_RANGE',
  'INCLUDE_RANGE',
]);
export type FeedbackKind = z.infer<typeof FeedbackKind>;

export const FeedbackSource = z.enum(['USER', 'SYSTEM']);
export type FeedbackSource = z.infer<typeof FeedbackSource>;

export const FeedbackPolarity = z.enum(['POSITIVE', 'NEGATIVE']);
export type FeedbackPolarity = z.infer<typeof FeedbackPolarity>;

/** One clip of a rated timeline (VIDEO_RATING context). */
export const FeedbackPlacement = z.object({
  momentId: z.string(),
  segmentId: z.string(),
  narrativeFunction: z.string(),
});
export type FeedbackPlacement = z.infer<typeof FeedbackPlacement>;

/**
 * Snapshot of the narrative segment (and its retrieval pool) at event time.
 * Every field is optional so all kinds share one column; kinds that need a
 * segment fill the segment fields, `VIDEO_RATING` fills `placements`.
 */
export const FeedbackContext = z.object({
  segmentId: z.string().optional(),
  startMs: z.number().int().nonnegative().optional(),
  endMs: z.number().int().nonnegative().optional(),
  emotion: z.string().optional(),
  narrativeFunction: z.string().optional(),
  visualIdeas: z.array(z.string()).optional(),
  energy: z.number().min(0).max(1).optional(),
  lyrics: z.string().optional(),
  meaning: z.string().optional(),
  retrieved: z.array(RetrievedCandidate).optional(),
  placements: z.array(FeedbackPlacement).optional(),
});
export type FeedbackContext = z.infer<typeof FeedbackContext>;

export const FEEDBACK_RATING_MIN = 1;
export const FEEDBACK_RATING_MAX = 5;

// FEEDBACK_EMBED
export const FeedbackEmbedInput = z.object({
  feedbackEventId: z.string(),
});
export type FeedbackEmbedInput = z.infer<typeof FeedbackEmbedInput>;

export const FeedbackEmbedOutput = z.object({
  feedbackEventId: z.string(),
  embedded: z.boolean(),
  polarity: FeedbackPolarity.nullable(),
  model: z.string().nullable(),
  modelVersion: z.string().nullable(),
});
export type FeedbackEmbedOutput = z.infer<typeof FeedbackEmbedOutput>;

/** `POST /v1/projects/:id/feedback` body. */
export const ProjectFeedbackInput = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('VIDEO_RATING'),
    value: z.number().int().min(FEEDBACK_RATING_MIN).max(FEEDBACK_RATING_MAX),
  }),
  z.object({ kind: z.literal('CLIP_UP'), clipId: z.string().min(1) }),
  z.object({ kind: z.literal('CLIP_DOWN'), clipId: z.string().min(1) }),
  z.object({ kind: z.literal('NOTE'), note: z.string().trim().min(1).max(2000) }),
]);
export type ProjectFeedbackInput = z.infer<typeof ProjectFeedbackInput>;

/** `POST /v1/feedback/notes` body (global note). */
export const NoteInput = z.object({
  note: z.string().trim().min(1).max(2000),
});
export type NoteInput = z.infer<typeof NoteInput>;

/** Optional reason on `POST /v1/moments/:id/ban` and `POST /v1/assets/:id/ban`. */
export const BanInput = z.object({
  note: z.string().trim().max(2000).optional(),
});
export type BanInput = z.infer<typeof BanInput>;

/** `POST` / `DELETE /v1/assets/:id/exclusions` body: a source-time range in ms. */
export const ExclusionInput = z
  .object({
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().positive(),
    note: z.string().trim().max(2000).optional(),
  })
  .refine((value) => value.endMs > value.startMs, { message: 'endMs must be after startMs' });
export type ExclusionInput = z.infer<typeof ExclusionInput>;
