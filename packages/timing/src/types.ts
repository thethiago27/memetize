import type { Timeline } from '@memetize/timeline';

/** One point `optimizeTiming` can snap a clip's start to (spec section 32:
 * beats, downbeats and onset strength are all inputs to the same decision). */
export interface TimingBeat {
  timeMs: number;
  strength: number;
  isDownbeat: boolean;
}

export interface TimingContext {
  beats: readonly TimingBeat[];
  /** `clip.reason.segmentId` -> lowercased `narrativeFunction`, the only
   * signal available today to detect a "punchline" segment. */
  segmentFunctionById: ReadonlyMap<string, string>;
}

export type SnapTarget = 'downbeat' | 'beat' | 'none';

export interface TimingAdjustment {
  clipId: string;
  originalStartMs: number;
  adjustedStartMs: number;
  deltaMs: number;
  snappedTo: SnapTarget;
}

export interface TimingResult {
  timeline: Timeline;
  adjustments: TimingAdjustment[];
}
