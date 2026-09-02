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
import { resolveCutStyles } from './cut-styles';
import type { EffectsContext, EffectsResult, PlannedEffect } from './types';

/**
 * Decides which simple effects each clip gets: first the Director's cut
 * styles (cut-styles spec), resolved against real source handles; then a
 * Ken Burns zoom on the tail of a punchline clip (spec sections 33, 57).
 * The zoom is always rebuilt from scratch so a Timing+Effects re-run
 * cannot accumulate zooms; the resolver likewise replaces its own hold
 * and speed entries. `timeline` / `transform` / `reason` stay identical —
 * this planner never moves or resizes a slot.
 */
export function planEffects(timeline: Timeline, context: EffectsContext): EffectsResult {
  const resolved = resolveCutStyles(timeline, context);
  const planned: PlannedEffect[] = [];
  const clips = resolved.timeline.clips.map((clip) => {
    const cutEffects = clip.effects.filter(isCutEffect);
    const zoom = planPunchlineZoom(clip, cutEffects, context);
    if (zoom) planned.push(zoom);
    return { ...clip, effects: zoom ? [...cutEffects, toTimelineEffect(zoom)] : cutEffects };
  });

  return { timeline: { ...resolved.timeline, clips }, planned, cuts: resolved.cuts };
}

function isCutEffect(effect: TimelineEffect): boolean {
  return effect.type === 'hold' || effect.type === 'speed';
}

/**
 * The zoom window ends where a hold starts (zooming a frozen frame reads
 * as a glitch) and is skipped entirely on a slowed-down clip, whose
 * drama comes from the tempo change.
 */
function planPunchlineZoom(
  clip: TimelineClip,
  cutEffects: readonly TimelineEffect[],
  context: EffectsContext,
): PlannedEffect | null {
  const segment = context.segmentById.get(clip.reason.segmentId);
  if (!segment) return null;
  if (!PUNCHLINE_FUNCTIONS.has(segment.narrativeFunction.toLowerCase())) return null;
  if (cutEffects.some((effect) => effect.type === 'speed' && Number(effect.factor) < 1)) {
    return null;
  }

  const hold = cutEffects.find((effect) => effect.type === 'hold');
  const motionEndMs = hold ? hold.startMs : clip.timeline.endMs;
  const slotMs = motionEndMs - clip.timeline.startMs;
  if (slotMs <= 0) return null;

  const windowMs = zoomWindowMs(slotMs);
  const startMs = motionEndMs - windowMs;
  const endMs = motionEndMs;
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
