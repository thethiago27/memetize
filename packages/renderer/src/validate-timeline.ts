import type { RenderWarning } from '@memetize/contracts';
import type { Timeline, TimelineClip, TimelineEffect } from '@memetize/timeline';
import { MAX_TRANSITION_SLOT_FRACTION, MIN_CLIP_MS } from './constants';
import {
  clipTimeModel,
  isOverlapStyle,
  parseHoldEffect,
  parseSpeedEffect,
  transitionOutOf,
} from './cuts';
import type { TimelineIssue, TimelineValidation } from './types';
import { isRenderableZoom } from './zoom';

export interface ValidateTimelineOptions {
  /**
   * The selected edit window's duration. A timeline assembled for an older
   * window must never render (renderer selected-window guard).
   */
  expectedDurationMs?: number;
  /**
   * The selected edit window's source start. Duration alone cannot tell two
   * equal-length windows apart, so a timeline whose audio is cut from a
   * different offset than the selected window must not render (F11): e.g. an old
   * 0-60s timeline must never satisfy a new 60-120s window.
   */
  expectedWindowStartMs?: number;
}

/**
 * Validates a `Timeline` before any FFmpeg spawn. Overlaps, out-of-range
 * clips, empty coverage, any positive gap, source-short slots, a duration
 * that disagrees with the selected window, and transitions the cut-style
 * time model cannot honor are hard failures — the Renderer must never hand
 * a broken graph to FFmpeg. Short slots and unsupported effects remain
 * warnings.
 */
export function validateTimeline(
  timeline: Timeline,
  options: ValidateTimelineOptions = {},
): TimelineValidation {
  const errors: TimelineIssue[] = [];
  const warnings: RenderWarning[] = [];

  if (
    options.expectedDurationMs !== undefined &&
    timeline.durationMs !== options.expectedDurationMs
  ) {
    errors.push({
      code: 'TIMELINE_DURATION_MISMATCH',
      message: `timeline durationMs (${timeline.durationMs}ms) differs from the selected edit-window duration (${options.expectedDurationMs}ms); regenerate the timeline`,
    });
  }

  if (
    options.expectedWindowStartMs !== undefined &&
    timeline.audio.sourceStartMs !== options.expectedWindowStartMs
  ) {
    errors.push({
      code: 'TIMELINE_WINDOW_MISMATCH',
      message: `timeline audio starts at ${timeline.audio.sourceStartMs}ms but the selected edit window starts at ${options.expectedWindowStartMs}ms; regenerate the timeline`,
    });
  }

  if (timeline.clips.length === 0) {
    errors.push({
      code: 'EMPTY_TIMELINE',
      message: 'timeline has no clips',
    });
    return { ok: false, errors, warnings };
  }

  for (const clip of timeline.clips) {
    const { startMs, endMs } = clip.timeline;
    if (startMs >= endMs) {
      errors.push({
        code: 'INVALID_RANGE',
        clipId: clip.id,
        message: `clip "${clip.id}" has startMs (${startMs}) >= endMs (${endMs})`,
      });
      continue;
    }
    if (endMs > timeline.durationMs) {
      errors.push({
        code: 'CLIP_OUT_OF_BOUNDS',
        clipId: clip.id,
        message: `clip "${clip.id}" ends at ${endMs}ms, past the timeline's durationMs (${timeline.durationMs}ms)`,
      });
    }
  }

  const sorted = sortByStart(timeline.clips);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    if (!prev || !curr) continue;
    if (curr.timeline.startMs < prev.timeline.endMs) {
      errors.push({
        code: 'CLIP_OVERLAP',
        clipId: curr.id,
        message: `clip "${curr.id}" (starts ${curr.timeline.startMs}ms) overlaps clip "${prev.id}" (ends ${prev.timeline.endMs}ms)`,
      });
    }
  }

  for (const clip of timeline.clips) {
    const slotMs = clip.timeline.endMs - clip.timeline.startMs;
    if (slotMs > 0 && slotMs < MIN_CLIP_MS) {
      warnings.push({ code: 'CLIP_TOO_SHORT', clipId: clip.id, durationMs: slotMs });
    }

    if (clip.effects.some((effect) => !isRenderableEffect(effect, clip))) {
      warnings.push({
        code: 'UNKNOWN_EFFECT',
        clipId: clip.id,
        message: `clip "${clip.id}" has an unsupported or malformed effect; it is ignored`,
      });
    }
  }

  validateFrameGrid(sorted, timeline.canvas.fps, errors);
  validateTransitions(sorted, errors);

  let cursorMs = 0;
  for (const clip of sorted) {
    const gapMs = clip.timeline.startMs - cursorMs;
    if (gapMs > 0) {
      errors.push({
        code: 'TIMELINE_GAP',
        message: `timeline has a ${gapMs}ms gap from ${cursorMs}ms to ${clip.timeline.startMs}ms`,
      });
    }
    cursorMs = Math.max(cursorMs, clip.timeline.endMs);
  }
  const trailingGapMs = timeline.durationMs - cursorMs;
  if (trailingGapMs > 0) {
    errors.push({
      code: 'TIMELINE_GAP',
      message: `timeline has a ${trailingGapMs}ms gap from ${cursorMs}ms to ${timeline.durationMs}ms`,
    });
  }

  return { ok: errors.length === 0, errors, warnings };
}

function isRenderableEffect(effect: TimelineEffect, clip: TimelineClip): boolean {
  return (
    isRenderableZoom(effect, clip) ||
    parseHoldEffect(effect, clip) !== null ||
    parseSpeedEffect(effect, clip) !== null
  );
}

/**
 * Every clip must occupy at least one frame of the output grid. The graph
 * cannot render one that does not — it used to drop it, which desynchronized
 * the join, because its neighbour had already extended into a transition the
 * dropped clip was supposed to complete.
 */
function validateFrameGrid(
  sorted: readonly TimelineClip[],
  fps: number,
  errors: TimelineIssue[],
): void {
  for (let index = 0; index < sorted.length; index += 1) {
    const clip = sorted[index];
    if (!clip) continue;
    const previous = sorted[index - 1] ?? null;
    const incoming = previous ? transitionOutOf(previous, false) : null;
    const outgoing = transitionOutOf(clip, index === sorted.length - 1);
    const frameAt = (ms: number) => Math.round((ms * fps) / 1000);
    const slotFrames = frameAt(clip.timeline.endMs) - frameAt(clip.timeline.startMs);
    const headFrames =
      incoming && isOverlapStyle(incoming.style) ? Math.floor(frameAt(incoming.durationMs) / 2) : 0;
    const outgoingFrames = isOverlapStyle(outgoing.style) ? frameAt(outgoing.durationMs) : 0;
    const tailFrames = outgoingFrames - Math.floor(outgoingFrames / 2);
    if (slotFrames + headFrames + tailFrames <= 0) {
      errors.push({
        code: 'CLIP_HAS_NO_FRAMES',
        clipId: clip.id,
        message: `clip "${clip.id}" occupies no frame at ${fps}fps (${clip.timeline.startMs}ms-${clip.timeline.endMs}ms)`,
      });
    }
  }
}

/**
 * Cut-styles time model: a transition is capped at a third of the smaller
 * neighboring slot, an overlapping one needs its head handle to exist in
 * source time, a clip's incoming plus outgoing transitions must fit inside
 * its slot, and its declared source must cover everything the graph decodes.
 *
 * The handle and source checks go through `clipTimeModel`, the same function
 * the graph builds its trim from. They used to be spelled out here in output
 * ms and so ignored the playback factor, which let a `speed_up` clip with an
 * incoming crossfade pass validation and then be trimmed from before its
 * source start.
 */
function validateTransitions(sorted: readonly TimelineClip[], errors: TimelineIssue[]): void {
  for (let index = 0; index < sorted.length; index += 1) {
    const clip = sorted[index];
    if (!clip) continue;
    const previous = sorted[index - 1] ?? null;
    const next = sorted[index + 1] ?? null;
    const incoming = previous ? transitionOutOf(previous, false) : null;
    const outgoing = transitionOutOf(clip, next === null);
    const model = clipTimeModel(clip, incoming, outgoing);
    const { slotMs } = model;

    if (next && outgoing.durationMs > 0) {
      const nextSlotMs = next.timeline.endMs - next.timeline.startMs;
      const maxMs = Math.floor(Math.min(slotMs, nextSlotMs) * MAX_TRANSITION_SLOT_FRACTION);
      if (outgoing.durationMs > maxMs) {
        errors.push({
          code: 'TRANSITION_TOO_LONG',
          clipId: clip.id,
          message: `clip "${clip.id}" ${outgoing.style} of ${outgoing.durationMs}ms exceeds a third of the smaller neighboring slot (${maxMs}ms)`,
        });
      }
    }

    if (model.headMs > 0 && model.trimStartMs < 0) {
      errors.push({
        code: 'TRANSITION_HANDLE_OUT_OF_BOUNDS',
        clipId: clip.id,
        message: `clip "${clip.id}" needs a ${model.headMs}ms head handle at ${model.factor}x (${model.headMs * model.factor}ms of source) but its source starts at ${clip.source.startMs}ms`,
      });
    }

    const sourceMs = clip.source.endMs - clip.source.startMs;
    if (sourceMs < model.consumedAfterStartMs) {
      errors.push({
        code: 'SOURCE_SHORTER_THAN_SLOT',
        clipId: clip.id,
        message: `clip "${clip.id}" source (${sourceMs}ms) is shorter than the ${model.consumedAfterStartMs}ms it must supply for its ${slotMs}ms slot at ${model.factor}x`,
      });
    }

    const incomingMs = incoming?.durationMs ?? 0;
    if (incomingMs + outgoing.durationMs > slotMs) {
      errors.push({
        code: 'OVERLAPPING_TRANSITIONS',
        clipId: clip.id,
        message: `clip "${clip.id}" incoming (${incomingMs}ms) plus outgoing (${outgoing.durationMs}ms) transitions exceed its ${slotMs}ms slot`,
      });
    }
  }
}

function sortByStart(clips: readonly TimelineClip[]): TimelineClip[] {
  return [...clips].sort((a, b) => a.timeline.startMs - b.timeline.startMs);
}
