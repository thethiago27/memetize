import type { Timeline, TimelineClip, TimelineEffect } from '@memetize/timeline';
import {
  HIGH_ENERGY,
  MIN_ZOOM_MS,
  PUNCHLINE_FUNCTIONS,
  ZOOM_FROM,
  ZOOM_TAIL_FRACTION,
  ZOOM_TAIL_MS,
  ZOOM_TO,
  ZOOM_TO_HIGH,
} from './constants';
import type { EffectsContext, EffectsResult, PlannedEffect } from './types';

/**
 * Decides which simple effects each clip gets (spec sections 33, 57): a
 * Ken Burns zoom on the tail of a punchline clip, nothing else. Always
 * *replaces* `clip.effects` from scratch so a Timing+Effects re-run cannot
 * accumulate zooms. `timeline` / `source` / `transform` / `reason` stay
 * identical — this planner never moves or resizes a slot.
 */
export function planEffects(timeline: Timeline, context: EffectsContext): EffectsResult {
  const planned: PlannedEffect[] = [];
  const clips = timeline.clips.map((clip) => {
    const zoom = planPunchlineZoom(clip, context);
    if (zoom) planned.push(zoom);
    return { ...clip, effects: zoom ? [toTimelineEffect(zoom)] : [] };
  });

  return { timeline: { ...timeline, clips }, planned };
}

function planPunchlineZoom(clip: TimelineClip, context: EffectsContext): PlannedEffect | null {
  const segment = context.segmentById.get(clip.reason.segmentId);
  if (!segment) return null;
  if (!PUNCHLINE_FUNCTIONS.has(segment.narrativeFunction.toLowerCase())) return null;

  const slotMs = clip.timeline.endMs - clip.timeline.startMs;
  if (slotMs <= 0) return null;

  const windowMs = zoomWindowMs(slotMs);
  const startMs = clip.timeline.endMs - windowMs;
  const endMs = clip.timeline.endMs;
  if (startMs >= endMs) return null;
  if (startMs < clip.timeline.startMs) return null;

  return {
    clipId: clip.id,
    type: 'zoom',
    startMs,
    endMs,
    from: ZOOM_FROM,
    to: segment.energy >= HIGH_ENERGY ? ZOOM_TO_HIGH : ZOOM_TO,
  };
}

function zoomWindowMs(slotMs: number): number {
  const preferred = Math.min(ZOOM_TAIL_MS, Math.floor(slotMs * ZOOM_TAIL_FRACTION));
  return Math.max(preferred, Math.min(MIN_ZOOM_MS, slotMs));
}

function toTimelineEffect(effect: PlannedEffect): TimelineEffect {
  return {
    type: effect.type,
    startMs: effect.startMs,
    endMs: effect.endMs,
    from: effect.from,
    to: effect.to,
  };
}
