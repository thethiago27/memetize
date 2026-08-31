import type { Timeline } from '@memetize/timeline';

export interface EffectsContext {
  /** `clip.reason.segmentId` -> `{ narrativeFunction, energy }`. */
  segmentById: ReadonlyMap<string, { narrativeFunction: string; energy: number }>;
}

export interface PlannedEffect {
  clipId: string;
  type: 'zoom';
  startMs: number;
  endMs: number;
  from: number;
  to: number;
}

export interface EffectsResult {
  timeline: Timeline;
  planned: PlannedEffect[];
}
