import { z } from 'zod';

/**
 * `Timeline` — one of the system's central contracts (spec section 34): the
 * single document the Renderer (a later phase) turns into an MP4. Zod is
 * the TypeScript source of truth; `toTimelineJsonSchema` exports the same
 * shape for external validation. Every time value is an integer number of
 * milliseconds (spec section 4.4); every score is a plain number in `[0, 1]`.
 */

export const TIMELINE_SCHEMA_VERSION = '1.0';

export const DEFAULT_CANVAS = { width: 1080, height: 1920, fps: 30 } as const;

export const TimelineCanvas = z.object({
  width: z.number().int().positive().default(DEFAULT_CANVAS.width),
  height: z.number().int().positive().default(DEFAULT_CANVAS.height),
  fps: z.number().int().positive().default(DEFAULT_CANVAS.fps),
});
export type TimelineCanvas = z.infer<typeof TimelineCanvas>;

export const TimelineAudio = z.object({
  /** Repo-relative path (spec section 11), mirrors `project_audio.originalPath`. */
  path: z.string(),
  timelineStartMs: z.number().int().nonnegative(),
  sourceStartMs: z.number().int().nonnegative(),
  volume: z.number().nonnegative().default(1),
});
export type TimelineAudio = z.infer<typeof TimelineAudio>;

export const TimelineRange = z.object({
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
});
export type TimelineRange = z.infer<typeof TimelineRange>;

export const TimelineClipSource = z.object({
  assetId: z.string(),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
});
export type TimelineClipSource = z.infer<typeof TimelineClipSource>;

export const TimelineTransform = z.object({
  scale: z.number().positive().default(1),
  positionX: z.number().min(0).max(1).default(0.5),
  positionY: z.number().min(0).max(1).default(0.5),
  cropMode: z.enum(['cover', 'contain']).default('cover'),
});
export type TimelineTransform = z.infer<typeof TimelineTransform>;

export const DEFAULT_TRANSFORM: TimelineTransform = {
  scale: 1,
  positionX: 0.5,
  positionY: 0.5,
  cropMode: 'cover',
};

/**
 * Deliberately loose (spec section 33 decides zoom/hard-cut/etc. in a later
 * phase, the Effects Planner): only `type` and a time range are required so
 * this schema doesn't need to change every time a new effect kind is added.
 * This increment always assembles `effects: []`.
 */
export const TimelineEffect = z
  .object({
    type: z.string(),
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().nonnegative(),
  })
  .catchall(z.unknown());
export type TimelineEffect = z.infer<typeof TimelineEffect>;

/** Why this particular moment was picked, kept for debugging/inspection (spec section 64). */
export const TimelineClipReason = z.object({
  segmentId: z.string(),
  semanticScore: z.number().min(0).max(1),
  finalScore: z.number().min(0).max(1),
});
export type TimelineClipReason = z.infer<typeof TimelineClipReason>;

export const TimelineClip = z.object({
  id: z.string(),
  momentId: z.string(),
  timeline: TimelineRange,
  source: TimelineClipSource,
  transform: TimelineTransform.default(DEFAULT_TRANSFORM),
  effects: z.array(TimelineEffect).default([]),
  reason: TimelineClipReason,
});
export type TimelineClip = z.infer<typeof TimelineClip>;

export const Timeline = z.object({
  schemaVersion: z.literal(TIMELINE_SCHEMA_VERSION).default(TIMELINE_SCHEMA_VERSION),
  projectId: z.string(),
  canvas: TimelineCanvas.default(DEFAULT_CANVAS),
  durationMs: z.number().int().positive(),
  audio: TimelineAudio,
  clips: z.array(TimelineClip),
});
export type Timeline = z.infer<typeof Timeline>;

/** JSON Schema export (spec section 34): lets non-TS consumers validate `timeline.json` too. */
export function toTimelineJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(Timeline);
}
