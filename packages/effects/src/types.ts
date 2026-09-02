import type { ClipStyle, CutDowngradeReason, Timeline, TransitionStyle } from '@memetize/timeline';

export interface CutSourceBounds {
  startMs: number;
  endMs: number;
}

export interface EffectsContext {
  /** `clip.reason.segmentId` -> `{ narrativeFunction, energy }`. */
  segmentById: ReadonlyMap<string, { narrativeFunction: string; energy: number }>;
  /** Milliseconds per beat; `DEFAULT_BEAT_MS` when the project has no tempo. */
  beatMs?: number;
  /**
   * `clip.momentId` -> the moment's full source range. Source handles for
   * transitions and speed-ups may only come from inside it. A missing entry
   * means the clip's own source range is all there is.
   */
  sourceBoundsByMomentId?: ReadonlyMap<string, CutSourceBounds>;
}

/** The subset of `EffectsContext` the cut-style resolver needs. */
export type CutStylesContext = Pick<EffectsContext, 'beatMs' | 'sourceBoundsByMomentId'>;

export interface PlannedEffect {
  clipId: string;
  type: 'zoom';
  startMs: number;
  endMs: number;
  from: number;
  to: number;
}

/**
 * One resolver verdict on a Director request, recorded whenever the
 * request was not the default (`hard` / `none`). `reason` is set only
 * when the request was downgraded.
 */
export interface CutDecision {
  clipId: string;
  kind: 'transition' | 'clip';
  requested: TransitionStyle | ClipStyle;
  resolved: TransitionStyle | ClipStyle;
  durationMs: number;
  reason?: CutDowngradeReason;
}

export interface CutStylesResult {
  timeline: Timeline;
  cuts: CutDecision[];
}

export interface EffectsResult {
  timeline: Timeline;
  planned: PlannedEffect[];
  cuts: CutDecision[];
}
