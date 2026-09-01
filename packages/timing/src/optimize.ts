import type { Timeline, TimelineClip, TimelineRange } from '@memetize/timeline';
import {
  MIN_TIMED_CLIP_MS,
  PUNCHLINE_FUNCTIONS,
  PUNCHLINE_SNAP_WINDOW_MS,
  SNAP_WINDOW_MS,
} from './constants';
import type {
  SnapTarget,
  TimingAdjustment,
  TimingBeat,
  TimingContext,
  TimingResult,
} from './types';

/**
 * Snaps shared internal cut boundaries to beats without creating gaps.
 * Timeline 0 and `durationMs` stay fixed; source ranges resize so each
 * source duration stays equal to its slot and inside moment bounds.
 */
export function optimizeTiming(timeline: Timeline, context: TimingContext): TimingResult {
  const sorted = [...timeline.clips].sort((a, b) => a.timeline.startMs - b.timeline.startMs);
  if (sorted.length === 0) {
    return { timeline, adjustments: [] };
  }

  const rangeById = new Map<string, TimelineRange>(
    sorted.map((clip) => [clip.id, { ...clip.timeline }]),
  );
  const sourceById = new Map(sorted.map((clip) => [clip.id, { ...clip.source }]));
  const adjustments: TimingAdjustment[] = [];

  for (let index = 0; index < sorted.length - 1; index += 1) {
    const previous = sorted[index];
    const next = sorted[index + 1];
    if (!previous || !next) continue;

    const previousRange = rangeById.get(previous.id);
    const nextRange = rangeById.get(next.id);
    if (!previousRange || !nextRange) continue;

    const originalBoundaryMs = previousRange.endMs;
    const windowMs =
      isPunchlineClip(previous, context.segmentFunctionById) ||
      isPunchlineClip(next, context.segmentFunctionById)
        ? PUNCHLINE_SNAP_WINDOW_MS
        : SNAP_WINDOW_MS;
    const target = findSnapTarget(context.beats, originalBoundaryMs, windowMs);

    let snappedTo: SnapTarget = 'none';
    let adjustedBoundaryMs = originalBoundaryMs;
    if (target && canMoveBoundary(previous, next, previousRange, nextRange, target.timeMs, context)) {
      adjustedBoundaryMs = target.timeMs;
      snappedTo = target.isDownbeat ? 'downbeat' : 'beat';
      applyBoundary(previous, next, previousRange, nextRange, adjustedBoundaryMs, sourceById);
    }

    adjustments.push({
      clipId: next.id,
      originalStartMs: originalBoundaryMs,
      adjustedStartMs: adjustedBoundaryMs,
      deltaMs: adjustedBoundaryMs - originalBoundaryMs,
      snappedTo,
    });
  }

  const clips = timeline.clips.map((clip) => {
    const range = rangeById.get(clip.id);
    const source = sourceById.get(clip.id);
    return range && source ? { ...clip, timeline: range, source } : clip;
  });

  return { timeline: { ...timeline, clips }, adjustments };
}

function canMoveBoundary(
  previous: TimelineClip,
  next: TimelineClip,
  previousRange: TimelineRange,
  nextRange: TimelineRange,
  targetMs: number,
  context: TimingContext,
): boolean {
  const previousDuration = targetMs - previousRange.startMs;
  const nextDuration = nextRange.endMs - targetMs;
  if (previousDuration < MIN_TIMED_CLIP_MS || nextDuration < MIN_TIMED_CLIP_MS) return false;

  const previousSource = previous.source;
  const nextSource = next.source;
  if (!sourceFits(previous.momentId, previousSource.startMs, previousDuration, context)) return false;
  if (!sourceFits(next.momentId, nextSource.startMs, nextDuration, context)) return false;
  return true;
}

function sourceFits(
  momentId: string,
  sourceStartMs: number,
  durationMs: number,
  context: TimingContext,
): boolean {
  const bounds = context.sourceBoundsByMomentId.get(momentId);
  if (!bounds) return durationMs >= 0;
  const sourceEndMs = sourceStartMs + durationMs;
  return sourceStartMs >= bounds.startMs && sourceEndMs <= bounds.endMs;
}

function applyBoundary(
  previous: TimelineClip,
  next: TimelineClip,
  previousRange: TimelineRange,
  nextRange: TimelineRange,
  targetMs: number,
  sourceById: Map<string, TimelineClip['source']>,
): void {
  previousRange.endMs = targetMs;
  nextRange.startMs = targetMs;
  const previousSource = sourceById.get(previous.id);
  const nextSource = sourceById.get(next.id);
  if (previousSource) {
    previousSource.endMs = previousSource.startMs + (previousRange.endMs - previousRange.startMs);
  }
  if (nextSource) {
    nextSource.endMs = nextSource.startMs + (nextRange.endMs - nextRange.startMs);
  }
}

function isPunchlineClip(
  clip: TimelineClip,
  segmentFunctionById: ReadonlyMap<string, string>,
): boolean {
  const narrativeFunction = segmentFunctionById.get(clip.reason.segmentId);
  return narrativeFunction ? PUNCHLINE_FUNCTIONS.has(narrativeFunction.toLowerCase()) : false;
}

function findSnapTarget(
  beats: readonly TimingBeat[],
  originalStartMs: number,
  windowMs: number,
): TimingBeat | null {
  let best: TimingBeat | null = null;
  let bestDistanceMs = Number.POSITIVE_INFINITY;

  for (const beat of beats) {
    const distanceMs = Math.abs(beat.timeMs - originalStartMs);
    if (distanceMs > windowMs) continue;

    if (!best) {
      best = beat;
      bestDistanceMs = distanceMs;
      continue;
    }
    if (beat.isDownbeat !== best.isDownbeat) {
      if (beat.isDownbeat) {
        best = beat;
        bestDistanceMs = distanceMs;
      }
      continue;
    }
    if (beat.strength !== best.strength) {
      if (beat.strength > best.strength) {
        best = beat;
        bestDistanceMs = distanceMs;
      }
      continue;
    }
    if (distanceMs < bestDistanceMs) {
      best = beat;
      bestDistanceMs = distanceMs;
    }
  }

  return best;
}
