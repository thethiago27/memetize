import type {
  ClipStyle,
  CutDowngradeReason,
  Timeline,
  TimelineClip,
  TimelineEffect,
  TimelineTransitionOut,
  TransitionStyle,
} from '@memetize/timeline';
import {
  DEFAULT_BEAT_MS,
  HOLD_BEAT_FRACTION,
  HOLD_CLAMP_MS,
  MAX_TRANSITION_SLOT_FRACTION,
  MIN_MOTION_BEFORE_HOLD_MS,
  SLOW_DOWN_FACTOR,
  SPEED_UP_FACTOR,
  TRANSITION_BEAT_FRACTION,
  TRANSITION_CLAMP_MS,
} from './constants';
import type { CutDecision, CutSourceBounds, CutStylesContext, CutStylesResult } from './types';

type OverlapStyle = 'crossfade' | 'whip';
type FadeStyle = 'dip_black' | 'flash';

/** What a resolved clip style means for the source the clip consumes. */
interface ClipShape {
  /** Playback rate; `1` when there is no speed effect. */
  factor: number;
  /** Source ms actually consumed from `source.startMs`. */
  consumedSourceMs: number;
  /** A frozen tail can extend into an outgoing transition for free. */
  freezesTail: boolean;
}

/**
 * Cut-styles spec: validates the Director's `direction` on every clip
 * against real source handles, tempo, and slot lengths; downgrades what
 * cannot render and records why. Two passes — clip styles first, because
 * a hold or speed change alters how much source is left for a handle;
 * then transitions in timeline order. Slots never move; only
 * `source.endMs` grows, for a speed-up.
 */
export function resolveCutStyles(timeline: Timeline, context: CutStylesContext): CutStylesResult {
  const beatMs = context.beatMs ?? DEFAULT_BEAT_MS;
  const bounds = context.sourceBoundsByMomentId ?? new Map<string, CutSourceBounds>();
  const cuts: CutDecision[] = [];

  const sorted = [...timeline.clips].sort((a, b) => a.timeline.startMs - b.timeline.startMs);

  // Resolve each clip's bounds once, from the clip as it arrived. When the
  // moment's real range is unknown `boundsFor` falls back to the clip's own
  // source, and `resolveClipStyle` normalizes that source back to
  // `[startMs, startMs + slot]` — so asking again afterwards returned bounds
  // exactly as wide as the take, leaving no handle on either side and
  // downgrading every overlapping transition on the second pass.
  const boundsByClipId = new Map(sorted.map((clip) => [clip.id, boundsFor(clip, bounds)]));
  const boundsOf = (clip: TimelineClip): CutSourceBounds =>
    boundsByClipId.get(clip.id) ?? boundsFor(clip, bounds);

  const shaped = sorted.map((clip) => {
    const result = resolveClipStyle(clip, beatMs, boundsOf(clip));
    if (result.decision) cuts.push(result.decision);
    return result;
  });

  const resolved: TimelineClip[] = [];
  for (let index = 0; index < shaped.length; index += 1) {
    const current = shaped[index];
    if (!current) continue;
    const next = shaped[index + 1];
    const { transitionOut, decision } = resolveTransition({
      clip: current.clip,
      shape: current.shape,
      bounds: boundsOf(current.clip),
      next: next ? { clip: next.clip, shape: next.shape, bounds: boundsOf(next.clip) } : null,
      beatMs,
    });
    if (decision) cuts.push(decision);
    resolved.push({ ...current.clip, transitionOut });
  }

  const byId = new Map(resolved.map((clip) => [clip.id, clip]));
  const clips = timeline.clips.map((clip) => byId.get(clip.id) ?? clip);
  return { timeline: { ...timeline, clips }, cuts };
}

function boundsFor(clip: TimelineClip, bounds: ReadonlyMap<string, CutSourceBounds>) {
  return bounds.get(clip.momentId) ?? { startMs: clip.source.startMs, endMs: clip.source.endMs };
}

// --- clip styles ---------------------------------------------------------

function resolveClipStyle(
  clip: TimelineClip,
  beatMs: number,
  bounds: CutSourceBounds,
): { clip: TimelineClip; shape: ClipShape; decision: CutDecision | null } {
  const requested = clip.direction.clipStyle;
  const slotMs = clip.timeline.endMs - clip.timeline.startMs;
  const plain: ClipShape = { factor: 1, consumedSourceMs: slotMs, freezesTail: false };
  // Normalize the clip back to its canonical base source ([startMs, startMs+slot])
  // before deriving any style, so re-resolving a timeline is idempotent (F03):
  // a prior speed-up must not compound onto an already-expanded source.endMs.
  const baseEndMs = clip.source.startMs + slotMs;
  if (clip.source.startMs < bounds.startMs || baseEndMs > bounds.endMs) {
    throw new Error(`SOURCE_OUT_OF_BOUNDS: ${clip.id}`);
  }
  const withoutStyle: TimelineClip = {
    ...clip,
    source: { ...clip.source, endMs: baseEndMs },
    effects: clip.effects.filter((effect) => !isCutEffect(effect)),
  };

  if (requested === 'none') {
    return { clip: withoutStyle, shape: plain, decision: null };
  }

  if (requested === 'hold') {
    const holdMs = fitHold(slotMs, beatMs);
    if (holdMs === null) {
      return {
        clip: withoutStyle,
        shape: plain,
        decision: clipDecision(clip.id, requested, 'none', 0, 'slot_too_short'),
      };
    }
    const effect: TimelineEffect = {
      type: 'hold',
      startMs: clip.timeline.endMs - holdMs,
      endMs: clip.timeline.endMs,
      requested,
    };
    return {
      clip: { ...withoutStyle, effects: [...withoutStyle.effects, effect] },
      shape: { factor: 1, consumedSourceMs: slotMs - holdMs, freezesTail: true },
      decision: clipDecision(clip.id, requested, 'hold', holdMs),
    };
  }

  if (requested === 'speed_up') {
    // Consumed source is derived from the canonical slot, never added onto a
    // previous result, so resolve(resolve(x)) == resolve(x).
    const consumedSourceMs = Math.ceil(slotMs * SPEED_UP_FACTOR);
    const endMs = clip.source.startMs + consumedSourceMs;
    if (endMs > bounds.endMs) {
      return {
        clip: withoutStyle,
        shape: plain,
        decision: clipDecision(clip.id, requested, 'none', 0, 'no_source_handle'),
      };
    }
    const effect = speedEffect(clip, SPEED_UP_FACTOR, requested);
    return {
      clip: {
        ...withoutStyle,
        source: { ...withoutStyle.source, endMs },
        effects: [...withoutStyle.effects, effect],
      },
      shape: { factor: SPEED_UP_FACTOR, consumedSourceMs, freezesTail: false },
      decision: clipDecision(clip.id, requested, 'speed_up', slotMs),
    };
  }

  // slow_down always fits: it consumes less source than the slot.
  const effect = speedEffect(clip, SLOW_DOWN_FACTOR, requested);
  return {
    clip: { ...withoutStyle, effects: [...withoutStyle.effects, effect] },
    shape: {
      factor: SLOW_DOWN_FACTOR,
      consumedSourceMs: Math.ceil(slotMs * SLOW_DOWN_FACTOR),
      freezesTail: false,
    },
    decision: clipDecision(clip.id, requested, 'slow_down', slotMs),
  };
}

function fitHold(slotMs: number, beatMs: number): number | null {
  const preferred = clampEven(beatMs * HOLD_BEAT_FRACTION, HOLD_CLAMP_MS);
  if (slotMs - preferred >= MIN_MOTION_BEFORE_HOLD_MS) return preferred;
  if (slotMs - HOLD_CLAMP_MS.min >= MIN_MOTION_BEFORE_HOLD_MS) return HOLD_CLAMP_MS.min;
  return null;
}

function speedEffect(clip: TimelineClip, factor: number, requested: ClipStyle): TimelineEffect {
  return {
    type: 'speed',
    startMs: clip.timeline.startMs,
    endMs: clip.timeline.endMs,
    factor,
    requested,
  };
}

/** A `hold` or `speed` effect: the two the cut-style resolver owns and rewrites. */
export function isCutEffect(effect: TimelineEffect): boolean {
  return effect.type === 'hold' || effect.type === 'speed';
}

// --- transitions ---------------------------------------------------------

interface Side {
  clip: TimelineClip;
  shape: ClipShape;
  bounds: CutSourceBounds;
}

function resolveTransition(params: {
  clip: TimelineClip;
  shape: ClipShape;
  bounds: CutSourceBounds;
  next: Side | null;
  beatMs: number;
}): { transitionOut: TimelineTransitionOut; decision: CutDecision | null } {
  const { clip } = params;
  const requested = clip.direction.transitionOut;

  if (requested === 'hard') {
    return { transitionOut: { style: 'hard', durationMs: 0, requested }, decision: null };
  }
  if (!params.next) {
    return downgradeToHard(clip.id, requested, 'last_clip');
  }

  const from: Side = { clip, shape: params.shape, bounds: params.bounds };
  const maxMs = maxTransitionMs(from.clip, params.next.clip);

  if (requested === 'crossfade' || requested === 'whip') {
    const fitted = fitOverlap(requested, from, params.next, maxMs, params.beatMs);
    if (fitted.durationMs !== null) {
      return resolvedTransition(clip.id, requested, requested, fitted.durationMs);
    }
    if (requested === 'whip') {
      return downgradeToHard(clip.id, requested, fitted.reason);
    }
    const dip = fitFade('dip_black', maxMs, params.beatMs);
    if (dip === null) return downgradeToHard(clip.id, requested, 'slot_too_short');
    return resolvedTransition(clip.id, requested, 'dip_black', dip, fitted.reason);
  }

  const fade = fitFade(requested, maxMs, params.beatMs);
  if (fade === null) return downgradeToHard(clip.id, requested, 'slot_too_short');
  return resolvedTransition(clip.id, requested, requested, fade);
}

function maxTransitionMs(a: TimelineClip, b: TimelineClip): number {
  const slotA = a.timeline.endMs - a.timeline.startMs;
  const slotB = b.timeline.endMs - b.timeline.startMs;
  return toEven(Math.floor(Math.min(slotA, slotB) * MAX_TRANSITION_SLOT_FRACTION));
}

/**
 * Tries the tempo-derived duration first, then the style's minimum. Both
 * sides must have `D/2` of output time as spare source, scaled by their
 * playback factor; a frozen tail needs nothing.
 */
function fitOverlap(
  style: OverlapStyle,
  from: Side,
  to: Side,
  maxMs: number,
  beatMs: number,
): { durationMs: number | null; reason: CutDowngradeReason } {
  const clamp = TRANSITION_CLAMP_MS[style];
  const preferred = clampEven(beatMs * TRANSITION_BEAT_FRACTION[style], clamp);
  const candidates = preferred === clamp.min ? [preferred] : [preferred, clamp.min];

  let reason: CutDowngradeReason = 'slot_too_short';
  for (const durationMs of candidates) {
    if (durationMs > maxMs) {
      reason = 'slot_too_short';
      continue;
    }
    const handleMs = durationMs / 2;
    if (!hasTailHandle(from, handleMs) || !hasHeadHandle(to, handleMs)) {
      reason = 'no_source_handle';
      continue;
    }
    return { durationMs, reason };
  }
  return { durationMs: null, reason };
}

function hasTailHandle(side: Side, handleMs: number): boolean {
  if (side.shape.freezesTail) return true;
  const consumedEndMs = side.clip.source.startMs + side.shape.consumedSourceMs;
  return side.bounds.endMs - consumedEndMs >= Math.ceil(handleMs * side.shape.factor);
}

function hasHeadHandle(side: Side, handleMs: number): boolean {
  return side.clip.source.startMs - side.bounds.startMs >= Math.ceil(handleMs * side.shape.factor);
}

/** Fades need no handles; only the slot-fraction cap applies. */
function fitFade(style: FadeStyle, maxMs: number, beatMs: number): number | null {
  const clamp = TRANSITION_CLAMP_MS[style];
  const preferred = clampEven(beatMs * TRANSITION_BEAT_FRACTION[style], clamp);
  if (preferred <= maxMs) return preferred;
  if (clamp.min <= maxMs) return clamp.min;
  return null;
}

function resolvedTransition(
  clipId: string,
  requested: TransitionStyle,
  style: TransitionStyle,
  durationMs: number,
  reason?: CutDowngradeReason,
): { transitionOut: TimelineTransitionOut; decision: CutDecision } {
  const transitionOut: TimelineTransitionOut = { style, durationMs, requested };
  const decision: CutDecision = {
    clipId,
    kind: 'transition',
    requested,
    resolved: style,
    durationMs,
  };
  if (reason) {
    transitionOut.downgradeReason = reason;
    decision.reason = reason;
  }
  return { transitionOut, decision };
}

function downgradeToHard(clipId: string, requested: TransitionStyle, reason: CutDowngradeReason) {
  return resolvedTransition(clipId, requested, 'hard', 0, reason);
}

function clipDecision(
  clipId: string,
  requested: ClipStyle,
  resolved: ClipStyle,
  durationMs: number,
  reason?: CutDowngradeReason,
): CutDecision {
  const decision: CutDecision = { clipId, kind: 'clip', requested, resolved, durationMs };
  if (reason) decision.reason = reason;
  return decision;
}

// --- helpers -------------------------------------------------------------

function clampEven(ms: number, clamp: { min: number; max: number }): number {
  return toEven(Math.min(clamp.max, Math.max(clamp.min, Math.round(ms))));
}

function toEven(ms: number): number {
  return ms - (ms % 2);
}
