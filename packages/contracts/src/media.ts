import { z } from 'zod';

/**
 * Media probe + worker I/O contracts for the catalog pipeline.
 * All time values are integer milliseconds (spec section 4.4); frame rate is
 * stored as milli-fps (e.g. 30000 == 30fps, 29970 == 29.97fps).
 */

export const AssetProbe = z.object({
  durationMs: z.number().int().nonnegative(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fpsMilli: z.number().int().nonnegative(),
  contentType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
});
export type AssetProbe = z.infer<typeof AssetProbe>;

// VIDEO_NORMALIZE
export const NormalizeInput = z.object({
  assetId: z.string(),
  originalPath: z.string(),
});
export type NormalizeInput = z.infer<typeof NormalizeInput>;

export const NormalizeOutput = z.object({
  proxyPath: z.string(),
  analysisPath: z.string(),
  thumbnailPath: z.string(),
});
export type NormalizeOutput = z.infer<typeof NormalizeOutput>;

// SCENE_DETECT
export const SceneDetectInput = z.object({
  assetId: z.string(),
  analysisPath: z.string(),
});
export type SceneDetectInput = z.infer<typeof SceneDetectInput>;

export const SceneInterval = z.object({
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
});
export type SceneInterval = z.infer<typeof SceneInterval>;

/** Raw contract emitted by the Python scene detector (spec section 16). */
export const SceneDetectionOutput = z.object({
  assetId: z.string(),
  detector: z.string(),
  detectorVersion: z.string(),
  scenes: z.array(SceneInterval),
});
export type SceneDetectionOutput = z.infer<typeof SceneDetectionOutput>;

// FRAME_EXTRACT
export const FrameExtractInput = z.object({
  assetId: z.string(),
  analysisPath: z.string(),
});
export type FrameExtractInput = z.infer<typeof FrameExtractInput>;

export const ExtractedFrame = z.object({
  timestampMs: z.number().int().nonnegative(),
  path: z.string(),
});
export type ExtractedFrame = z.infer<typeof ExtractedFrame>;

export const FrameExtractOutput = z.object({
  sceneCount: z.number().int().nonnegative(),
  frameCount: z.number().int().nonnegative(),
});
export type FrameExtractOutput = z.infer<typeof FrameExtractOutput>;

// TRANSCRIPT
export const TranscriptInput = z.object({
  assetId: z.string(),
  originalPath: z.string(),
});
export type TranscriptInput = z.infer<typeof TranscriptInput>;

export const TranscriptWord = z.object({
  text: z.string(),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
});
export type TranscriptWord = z.infer<typeof TranscriptWord>;

export const TranscriptSegment = z.object({
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
  text: z.string(),
  words: z.array(TranscriptWord).default([]),
});
export type TranscriptSegment = z.infer<typeof TranscriptSegment>;

/** Raw contract emitted by the Python transcript worker (spec section 17). */
export const TranscriptOutput = z.object({
  assetId: z.string(),
  segments: z.array(TranscriptSegment),
  model: z.string(),
  modelVersion: z.string(),
});
export type TranscriptOutput = z.infer<typeof TranscriptOutput>;

// VISION_ANALYZE
export const VisionInput = z.object({
  assetId: z.string(),
});
export type VisionInput = z.infer<typeof VisionInput>;

export const EmotionPoint = z.object({
  timeMs: z.number().int().nonnegative(),
  emotion: z.string(),
  intensity: z.number().min(0).max(1),
});
export type EmotionPoint = z.infer<typeof EmotionPoint>;

/** Structured, two-level scene interpretation (spec section 19): an objective
 * summary plus an editorial read of how the scene could be used as a meme. */
export const VisionSceneAnalysis = z.object({
  summary: z.string(),
  subjects: z.array(z.object({ type: z.string(), description: z.string() })).default([]),
  actions: z.array(z.string()).default([]),
  emotionTrajectory: z.array(EmotionPoint).default([]),
  visualEnergy: z.number().min(0).max(1),
  camera: z.object({ movement: z.string(), shotType: z.string() }),
  memeFunctions: z.array(z.string()).default([]),
  quality: z.object({ usable: z.boolean(), score: z.number().min(0).max(1) }),
});
export type VisionSceneAnalysis = z.infer<typeof VisionSceneAnalysis>;

export const VisionOutput = z.object({
  assetId: z.string(),
  sceneCount: z.number().int().nonnegative(),
  model: z.string(),
  modelVersion: z.string(),
  promptVersion: z.string(),
});
export type VisionOutput = z.infer<typeof VisionOutput>;

// MOMENT_EXTRACT
export const MomentExtractInput = z.object({
  assetId: z.string(),
});
export type MomentExtractInput = z.infer<typeof MomentExtractInput>;

/** One editorial unit suggested for a scene (spec section 21). */
export const MomentCandidate = z.object({
  sceneId: z.string(),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
  description: z.string(),
  primaryEmotion: z.string().nullable().default(null),
  emotionIntensity: z.number().min(0).max(1).nullable().default(null),
  visualEnergy: z.number().min(0).max(1).nullable().default(null),
  qualityScore: z.number().min(0).max(1).nullable().default(null),
  metadata: z.record(z.string(), z.unknown()).default({}),
});
export type MomentCandidate = z.infer<typeof MomentCandidate>;

export const MomentExtractOutput = z.object({
  assetId: z.string(),
  moments: z.array(MomentCandidate),
  extractor: z.string(),
  extractorVersion: z.string(),
});
export type MomentExtractOutput = z.infer<typeof MomentExtractOutput>;
