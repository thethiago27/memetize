import type { Timeline, TimelineClip, TimelineRange } from '@memetize/timeline';
import { PUNCHLINE_FUNCTIONS, PUNCHLINE_SNAP_WINDOW_MS, SNAP_WINDOW_MS } from './constants';
import type {
  SnapTarget,
  TimingAdjustment,
  TimingBeat,
  TimingContext,
  TimingResult,
} from './types';

/**
 * Realigns each clip's `timeline.startMs` to the nearest musical beat or
 * downbeat (spec section 32) without changing anything else: the slot
 * duration (`endMs - startMs`), `source`, `transform`, `effects` and
 * `reason` are all left untouched — this is the Timing Optimizer's whole
 * job, cut refinement, not clip selection (that's the Director's).
 *
 * Clips are processed in `timeline.startMs` order, each one clamped between
 * the previous clip's *already-adjusted* end and the next clip's *original*
 * start (or the timeline's `durationMs` for the last clip) — this makes
 * overlap structurally impossible no matter how far the snap target pulls,
 * without needing a second pass.
 */
export function optimizeTiming(timeline: Timeline, context: TimingContext): TimingResult {
  const sorted = [...timeline.clips].sort((a, b) => a.timeline.startMs - b.timeline.startMs);
  const adjustments: TimingAdjustment[] = [];
  const adjustedRangeById = new Map<string, TimelineRange>();

  let previousEndMs = 0;
  for (let i = 0; i < sorted.length; i++) {
    const clip = sorted[i];
    if (!clip) continue;

    const originalStartMs = clip.timeline.startMs;
    const slotMs = clip.timeline.endMs - originalStartMs;
    const nextOriginalStartMs = sorted[i + 1]?.timeline.startMs ?? timeline.durationMs;

    const windowMs = isPunchlineClip(clip, context.segmentFunctionById)
      ? PUNCHLINE_SNAP_WINDOW_MS
      : SNAP_WINDOW_MS;
    const target = findSnapTarget(context.beats, originalStartMs, windowMs);

    let adjustedStartMs = originalStartMs;
    let snappedTo: SnapTarget = 'none';
    if (target) {
      const clampedStartMs = clampMs(target.timeMs, previousEndMs, nextOriginalStartMs - slotMs);
      if (clampedStartMs !== originalStartMs) {
        adjustedStartMs = clampedStartMs;
        snappedTo = target.isDownbeat ? 'downbeat' : 'beat';
      }
    }

    const adjustedEndMs = adjustedStartMs + slotMs;
    adjustedRangeById.set(clip.id, { startMs: adjustedStartMs, endMs: adjustedEndMs });
    adjustments.push({
      clipId: clip.id,
      originalStartMs,
      adjustedStartMs,
      deltaMs: adjustedStartMs - originalStartMs,
      snappedTo,
    });
    previousEndMs = adjustedEndMs;
  }

  const clips = timeline.clips.map((clip) => {
    const range = adjustedRangeById.get(clip.id);
    return range ? { ...clip, timeline: range } : clip;
  });

  return { timeline: { ...timeline, clips }, adjustments };
}

function isPunchlineClip(
  clip: TimelineClip,
  segmentFunctionById: ReadonlyMap<string, string>,
): boolean {
  const narrativeFunction = segmentFunctionById.get(clip.reason.segmentId);
  return narrativeFunction ? PUNCHLINE_FUNCTIONS.has(narrativeFunction.toLowerCase()) : false;
}

/**
 * Picks the best beat within `windowMs` of `originalStartMs`: downbeats
 * beat plain beats, then higher onset `strength` wins, then whichever is
 * closer in time — the same priority order spec section 32 lists (downbeat
 * alignment, then audio onset).
 */
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

function clampMs(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}
