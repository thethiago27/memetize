/**
 * Shared thresholds for the Renderer (spec sections 38-39). Kept as named
 * constants — not magic numbers — so `validateTimeline`, `validateOutput`
 * and their tests all agree on the same cutoffs.
 */
export const MIN_CLIP_MS = 300;
export const DURATION_DRIFT_MS = 100;
export const RENDERER_NAME = 'ffmpeg';
export const RENDERER_VERSION = '1.0.0';
