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
 *
 * When a clip grows, the extra source is taken from both ends of the take
 * rather than only from its tail (F05): coverage centered the take inside its
 * moment to leave a handle on each side for an overlapping transition, and
 * eating the whole tail would silently downgrade a viable crossfade in Effects.
 * A clip that shrinks keeps its start, so its content does not drift.
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
    if (
      target &&
      canMoveBoundary(previous, next, previousRange, nextRange, target.timeMs, sourceById, context)
    ) {
      adjustedBoundaryMs = target.timeMs;
      snappedTo = target.isDownbeat ? 'downbeat' : 'beat';
      applyBoundary(
        previous,
        next,
        previousRange,
        nextRange,
        adjustedBoundaryMs,
        sourceById,
        context,
      );
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
  sourceById: Map<string, TimelineClip['source']>,
  context: TimingContext,
): boolean {
  const previousDuration = targetMs - previousRange.startMs;
  const nextDuration = nextRange.endMs - targetMs;
  if (previousDuration < MIN_TIMED_CLIP_MS || nextDuration < MIN_TIMED_CLIP_MS) return false;

  // Decide against the sources this pass has already rewritten, not against the
  // clip's original ones: `resizeSource` writes into `sourceById`, so reading
  // `clip.source` here meant approving a move on one state and applying it to
  // another.
  const previousSource = sourceById.get(previous.id) ?? previous.source;
  const nextSource = sourceById.get(next.id) ?? next.source;
  if (!sourceFits(previous.momentId, previousSource, previousDuration, context)) return false;
  if (!sourceFits(next.momentId, nextSource, nextDuration, context)) return false;
  return true;
}

/**
 * Whether a take of `durationMs` can be cut for this clip.
 *
 * With the moment's bounds known, `fitSource` answers it. Without them the only
 * safe answer is "not longer than the source it already has": the caller's
 * contract is that a take stays inside its moment, and growing past the current
 * range with no bounds to check against is exactly how a timeline ended up
 * pointing past the moment the catalog recorded — invisible to the renderer,
 * which only compares source length against the slot.
 */
function sourceFits(
  momentId: string,
  source: TimelineClip['source'],
  durationMs: number,
  context: TimingContext,
): boolean {
  const bounds = context.sourceBoundsByMomentId.get(momentId);
  if (!bounds) return durationMs >= 0 && durationMs <= source.endMs - source.startMs;
  return fitSource(source, durationMs, bounds) !== null;
}

/**
 * Places a take of `durationMs` inside `bounds`, starting from the current
 * source range. Shrinking keeps the start. Growing keeps the start while the
 * spare room still allows the take's current head handle; when it does not, the
 * head handle shrinks to half of the remaining spare room so head and tail keep
 * comparable handles instead of the tail collapsing to zero. Returns null when
 * the take cannot fit at all.
 */
export function fitSource(
  source: { startMs: number; endMs: number },
  durationMs: number,
  bounds: { startMs: number; endMs: number },
): { startMs: number; endMs: number } | null {
  const room = bounds.endMs - bounds.startMs;
  if (durationMs < 0 || durationMs > room) return null;
  const spare = room - durationMs;
  const currentHead = Math.max(0, source.startMs - bounds.startMs);
  const head = Math.min(currentHead, Math.floor(spare / 2));
  const startMs = bounds.startMs + head;
  return { startMs, endMs: startMs + durationMs };
}

function applyBoundary(
  previous: TimelineClip,
  next: TimelineClip,
  previousRange: TimelineRange,
  nextRange: TimelineRange,
  targetMs: number,
  sourceById: Map<string, TimelineClip['source']>,
  context: TimingContext,
): void {
  previousRange.endMs = targetMs;
  nextRange.startMs = targetMs;
  resizeSource(previous, previousRange, sourceById, context);
  resizeSource(next, nextRange, sourceById, context);
}

function resizeSource(
  clip: TimelineClip,
  range: TimelineRange,
  sourceById: Map<string, TimelineClip['source']>,
  context: TimingContext,
): void {
  const source = sourceById.get(clip.id);
  if (!source) return;
  const durationMs = range.endMs - range.startMs;
  const bounds = context.sourceBoundsByMomentId.get(clip.momentId);
  const fitted = bounds ? fitSource(source, durationMs, bounds) : null;
  if (fitted) {
    source.startMs = fitted.startMs;
    source.endMs = fitted.endMs;
  } else {
    // No bounds to fit against: shrink only, never grow past the take the
    // Director already cut (`sourceFits` refuses the move otherwise).
    source.endMs = source.startMs + Math.min(durationMs, source.endMs - source.startMs);
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
