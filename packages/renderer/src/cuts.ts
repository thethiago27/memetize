import type {
  TimelineClip,
  TimelineEffect,
  TimelineTransitionOut,
  TransitionStyle,
} from '@memetize/timeline';
import { FADE_COLOR_BY_STYLE, XFADE_TRANSITION_BY_STYLE } from './constants';

/**
 * Cut-styles spec, renderer side: the pure helpers that turn a resolved
 * `transitionOut` and the `hold` / `speed` effects into FFmpeg filter
 * fragments, plus the parsers `validateTimeline` uses to accept them.
 */

export type OverlapStyle = keyof typeof XFADE_TRANSITION_BY_STYLE;
export type FadeStyle = keyof typeof FADE_COLOR_BY_STYLE;

export function isOverlapStyle(style: TransitionStyle): style is OverlapStyle {
  return style in XFADE_TRANSITION_BY_STYLE;
}

export function isFadeStyle(style: TransitionStyle): style is FadeStyle {
  return style in FADE_COLOR_BY_STYLE;
}

export interface ParsedHold {
  startMs: number;
  endMs: number;
}

export interface ParsedSpeed {
  factor: number;
}

/** A hold is a frozen tail: a window ending exactly at the slot end. */
export function parseHoldEffect(effect: TimelineEffect, clip: TimelineClip): ParsedHold | null {
  if (effect.type !== 'hold') return null;
  if (effect.startMs >= effect.endMs) return null;
  if (effect.endMs !== clip.timeline.endMs) return null;
  if (effect.startMs <= clip.timeline.startMs) return null;
  return { startMs: effect.startMs, endMs: effect.endMs };
}

/** A speed change covers the whole slot with a positive, finite factor. */
export function parseSpeedEffect(effect: TimelineEffect, clip: TimelineClip): ParsedSpeed | null {
  if (effect.type !== 'speed') return null;
  const factor = effect.factor;
  if (typeof factor !== 'number' || !Number.isFinite(factor) || factor <= 0) return null;
  if (effect.startMs !== clip.timeline.startMs || effect.endMs !== clip.timeline.endMs) return null;
  return { factor };
}

/** The effective transition out of a clip; the last clip always cuts hard. */
export function transitionOutOf(clip: TimelineClip, isLast: boolean): TimelineTransitionOut {
  if (isLast || !clip.transitionOut) {
    return { style: 'hard', durationMs: 0, requested: clip.transitionOut?.requested ?? 'hard' };
  }
  return clip.transitionOut;
}

export interface ClipHandles {
  /** Output ms the clip must extend before its slot start (overlap in). */
  headMs: number;
  /** Output ms the clip must extend past its slot end (overlap out). */
  tailMs: number;
}

/**
 * Half of each overlapping transition's duration lands on each side of the
 * boundary. Fades and hard cuts need no handles.
 */
export function handlesFor(
  incoming: TimelineTransitionOut | null,
  outgoing: TimelineTransitionOut,
): ClipHandles {
  const headMs = incoming && isOverlapStyle(incoming.style) ? incoming.durationMs / 2 : 0;
  const tailMs = isOverlapStyle(outgoing.style) ? outgoing.durationMs / 2 : 0;
  return { headMs, tailMs };
}

/** The clip's playback factor (1 with no `speed` effect). */
export function speedFactorOf(clip: TimelineClip): number {
  for (const effect of clip.effects) {
    const parsed = parseSpeedEffect(effect, clip);
    if (parsed) return parsed.factor;
  }
  return 1;
}

/** The clip's frozen-tail length in output ms (0 with no `hold` effect). */
export function holdMsOf(clip: TimelineClip): number {
  for (const effect of clip.effects) {
    const parsed = parseHoldEffect(effect, clip);
    if (parsed) return parsed.endMs - parsed.startMs;
  }
  return 0;
}

/** How much source time a clip consumes, and where. */
export interface ClipTimeModel extends ClipHandles {
  /** Output ms of the clip's own slot. */
  slotMs: number;
  /** Output ms of the whole rendered segment: `head + slot + tail`. */
  lengthMs: number;
  factor: number;
  holdMs: number;
  /** Output ms that actually move (the frozen tail is not decoded). */
  motionMs: number;
  /** Source instant the segment starts decoding at — negative means out of bounds. */
  trimStartMs: number;
  /** Source instant it stops decoding at. */
  trimEndMs: number;
  /** Source ms consumed at or after `clip.source.startMs`. */
  consumedAfterStartMs: number;
}

/**
 * The renderer's time model for one clip — the single answer to "what source
 * does this consume", used both to build the FFmpeg trim and to validate the
 * timeline before spawning it.
 *
 * It has to be one function: the validator used to check the head handle
 * against `headMs` while the graph consumed `headMs * factor`, so a `speed_up`
 * clip with an incoming crossfade passed validation and was then trimmed from
 * before its source start. The same divergence applied to the source-length
 * check, which compared against the slot alone and ignored both the factor and
 * the outgoing handle.
 */
export function clipTimeModel(
  clip: TimelineClip,
  incoming: TimelineTransitionOut | null,
  outgoing: TimelineTransitionOut,
): ClipTimeModel {
  const slotMs = clip.timeline.endMs - clip.timeline.startMs;
  const { headMs, tailMs } = handlesFor(incoming, outgoing);
  const lengthMs = headMs + slotMs + tailMs;
  const factor = speedFactorOf(clip);
  const holdMs = holdMsOf(clip);
  // A frozen tail covers the hold and any outgoing handle; nothing after it moves.
  const motionMs = holdMs > 0 ? headMs + slotMs - holdMs : lengthMs;
  const trimStartMs = clip.source.startMs - headMs * factor;
  const trimEndMs = trimStartMs + motionMs * factor;
  return {
    slotMs,
    headMs,
    tailMs,
    lengthMs,
    factor,
    holdMs,
    motionMs,
    trimStartMs,
    trimEndMs,
    consumedAfterStartMs: trimEndMs - clip.source.startMs,
  };
}

/**
 * `fade` filters for a dip through black or white: the outgoing side fades
 * out over the last `D/2` of its rendered segment, the incoming side fades
 * in over its first `D/2`. `segmentMs` is the rendered segment length
 * (slot plus any handles), so the fade-out lands on the real tail.
 */
export function buildBoundaryFadeFilters(params: {
  incoming: TimelineTransitionOut | null;
  outgoing: TimelineTransitionOut;
  segmentMs: number;
}): string[] {
  const filters: string[] = [];
  const { incoming, outgoing } = params;
  if (incoming && isFadeStyle(incoming.style)) {
    const halfMs = incoming.durationMs / 2;
    filters.push(
      `fade=t=in:st=0:d=${toSeconds(halfMs)}:color=${FADE_COLOR_BY_STYLE[incoming.style]}`,
    );
  }
  if (isFadeStyle(outgoing.style)) {
    const halfMs = outgoing.durationMs / 2;
    filters.push(
      `fade=t=out:st=${toSeconds(params.segmentMs - halfMs)}:d=${toSeconds(halfMs)}:color=${FADE_COLOR_BY_STYLE[outgoing.style]}`,
    );
  }
  return filters;
}

/**
 * Freeze the last frame: the segment is trimmed to the motion part and the
 * final frame is cloned for the hold plus any outgoing overlap handle, so
 * the frozen frame carries the clip through a crossfade or whip.
 */
export function buildHoldFilter(holdMs: number, tailHandleMs: number): string {
  return `tpad=stop_mode=clone:stop_duration=${toSeconds(holdMs + tailHandleMs)}`;
}

/** `setpts` for a playback factor; `1` needs no filter. */
export function buildSpeedFilter(factor: number): string | null {
  if (factor === 1) return null;
  return `setpts=PTS/${factor}`;
}

export function xfadeTransitionName(style: OverlapStyle): string {
  return XFADE_TRANSITION_BY_STYLE[style];
}

export function toSeconds(ms: number): string {
  return (ms / 1000).toFixed(3);
}
