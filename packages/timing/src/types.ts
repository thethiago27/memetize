import type { Timeline } from '@memetize/timeline';

/** One point `optimizeTiming` can snap a shared cut to. */
export interface TimingBeat {
  timeMs: number;
  strength: number;
  isDownbeat: boolean;
}

export interface TimingSourceBounds {
  startMs: number;
  endMs: number;
}

export interface TimingContext {
  beats: readonly TimingBeat[];
  /** `clip.reason.segmentId` -> lowercased `narrativeFunction`. */
  segmentFunctionById: ReadonlyMap<string, string>;
  sourceBoundsByMomentId: ReadonlyMap<string, TimingSourceBounds>;
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
