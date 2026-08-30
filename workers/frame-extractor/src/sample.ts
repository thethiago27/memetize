export interface SampleOptions {
  /** Extra sampling interval for long scenes. Defaults to 750ms. */
  intervalMs?: number;
  /** Hard cap on frames per scene. Defaults to 12. */
  maxFrames?: number;
}

const DEFAULT_INTERVAL_MS = 750;
const DEFAULT_MAX_FRAMES = 12;
/** Scenes longer than this get extra samples beyond the 5 proportional anchors. */
const DENSE_SAMPLING_THRESHOLD_MS = 4000;

/**
 * Frame sampling policy (spec section 18): we never store every frame. Every
 * scene contributes 5 proportional anchors (first/25%/50%/75%/last); scenes
 * longer than 4s get extra samples every `intervalMs`, capped at `maxFrames`
 * so a long scene can't flood storage with near-duplicate frames.
 */
export function sampleFrameTimestamps(
  scene: { startMs: number; endMs: number },
  options: SampleOptions = {},
): number[] {
  const { startMs, endMs } = scene;
  const durationMs = endMs - startMs;
  if (durationMs <= 0) return [startMs];

  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const maxFrames = options.maxFrames ?? DEFAULT_MAX_FRAMES;

  // Scenes use a half-open interval [startMs, endMs) (same convention as
  // `overlaps`): sampling exactly at endMs can seek past the last decodable
  // frame, so the "last" anchor lands one ms before the boundary instead.
  const anchors = [0, 0.25, 0.5, 0.75].map((fraction) =>
    Math.round(startMs + fraction * durationMs),
  );
  anchors.push(Math.max(startMs, endMs - 1));
  const points = new Set<number>(anchors);

  if (durationMs > DENSE_SAMPLING_THRESHOLD_MS) {
    for (let t = startMs + intervalMs; t < endMs && points.size < maxFrames; t += intervalMs) {
      points.add(Math.round(t));
    }
  }

  return Array.from(points)
    .sort((a, b) => a - b)
    .slice(0, maxFrames);
}
