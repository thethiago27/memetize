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
